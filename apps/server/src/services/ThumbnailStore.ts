/**
 * ThumbnailStore.ts — thumbnail PNGs as files on disk, a URL on the Script.
 *
 * Thumbnails are renders produced in the BROWSER: the viewer draws the model of a run it
 * just did off screen (packages/ui model-viewer's renderModelThumbnail) and the editor
 * uploads the PNG in the background — after a run, after a share/publish, or when the
 * browser page backfills scripts that have none (apps/editor/src/services/thumbnails.ts).
 * Server-side script execution is disabled by design, so the server never generates one
 * itself: this store checks and writes the bytes and hands back a URL, which is persisted.
 *
 * Why files rather than a DB column or table: every library list response already carries
 * each script's full `code`, and `GET /scripts/published` returns them all. Tens of KB of
 * image per script in that payload would make the very lists this feature exists to improve
 * markedly worse. A ~60-byte URL costs nothing, and the bytes are then served by a plain
 * static mount with proper caching (see plugin.ts) instead of through the JSON API.
 *
 * Layout, content-addressed:
 *     {config.thumbnails.path}/{author}/{fileId}/{versionId}-{hash8}.png   a stored version
 *     {config.thumbnails.path}/{author}/{fileId}/working-{hash8}.png       the working copy
 *
 * A shared or published version is immutable, so its preview is keyed by the version id.
 * The working copy is a NEW row on every save (ScriptStore appends), so keying its preview
 * by row id would leave a file behind per keystroke; it gets one `working-*` file per file
 * instead, replaced on every regeneration, and ScriptStore.saveVersion() carries the URL
 * forward from row to row.
 *
 * The content hash in the filename is load-bearing: the URL changes whenever the picture
 * changes, which makes `Cache-Control: immutable` unconditionally correct (no `?v=` query
 * dance), guarantees a regenerated thumbnail can never be served stale, and makes the
 * filename unguessable — the only protection a restricted (`onlyUsers`) share's thumbnail
 * has, since a static mount cannot run the access check. That is a knowing trade for a
 * line drawing whose URL is only ever handed out in an access-gated API response.
 *
 * The check on the way in is a shape check, not a sanitiser: a PNG is inert, but the bytes
 * still arrive in a client-controlled body and are served from our own origin, so they must
 * at least BE a PNG of sane dimensions under the byte cap before they are written.
 *
 * EVERY failure here is silent and returns null. A thumbnail is a nicety; an upload that
 * 500s because a directory was not writable is not. Silent to the CALLER, that is: every
 * outcome — including the do-nothing ones — is recorded in the thumbnail log (see
 * services/thumbnailLog.ts), which is the only thing that makes a missing preview
 * explainable after the fact.
 */

import { createHash } from 'node:crypto';
import { mkdir, rename, unlink, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { config } from '../config';
import { logThumbnail } from './thumbnailLog';

/** Path segments come from server-controlled ids, but they end up as filesystem paths —
 *  a traversal check on anything that becomes a path is not optional. */
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/** The filename stem of a working copy's preview (a version's stem is its id). */
const WORKING_STEM = 'working';

/** Largest side a thumbnail may have. The client renders 512; this leaves room for a
 *  retina variant without accepting a poster. */
export const MAX_THUMBNAIL_DIMENSION = 2048;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngCheckResult {
  ok: boolean;
  /** Why it was refused. Logged, never returned to the client. */
  reason?: string;
  width?: number;
  height?: number;
}

/** Is this a PNG we are prepared to store? Signature, an IHDR chunk in the mandatory first
 *  position, sane dimensions, and the byte cap — checked first, so nothing else ever looks
 *  at an unbounded body. Nothing here decodes pixels: a PNG cannot carry script, and the
 *  static mount serves it with `nosniff` + a sandboxing CSP regardless (plugin.ts). */
export function checkThumbnailPng(bytes: unknown, maxBytes: number): PngCheckResult {
  const png = asBuffer(bytes);
  if (!png || png.length === 0) return { ok: false, reason: 'not a non-empty buffer' };
  if (png.length > maxBytes) return { ok: false, reason: `too large (${png.length} > ${maxBytes} bytes)` };
  // Signature (8) + IHDR chunk: length (4) + type (4) + width (4) + height (4) + …
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return { ok: false, reason: 'not a PNG (bad signature)' };
  if (png.toString('latin1', 12, 16) !== 'IHDR') return { ok: false, reason: 'not a PNG (no IHDR)' };
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width === 0 || height === 0 || width > MAX_THUMBNAIL_DIMENSION || height > MAX_THUMBNAIL_DIMENSION) {
    return { ok: false, reason: `unreasonable dimensions (${width}x${height})` };
  }
  return { ok: true, width, height };
}

/** The body as a Buffer, or null when it is not bytes at all. `ArrayBuffer.isView` rather than
 *  `Buffer.isBuffer`: the latter is an instanceof check, which fails across realms (vitest
 *  gives test and module different globals), and any byte view is fine here anyway. */
function asBuffer(bytes: unknown): Buffer | null {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return null;
}

function safeSegments(...segments: Array<string | undefined | null>): string[] | null {
  const out: string[] = [];
  for (const s of segments) {
    if (typeof s !== 'string' || s.length === 0 || s.length > 128) return null;
    if (s === '.' || s === '..' || !SAFE_SEGMENT.test(s)) return null;
    out.push(s);
  }
  return out;
}

function contentHash(png: Buffer): string {
  return createHash('sha256').update(png).digest('hex').slice(0, 8);
}

/** Every preview file for a stem: `{stem}-{hash}.png`, or the `.svg` an older client wrote. */
function isPreviewOf(stem: string, filename: string): boolean {
  return filename.startsWith(`${stem}-`) && /\.(png|svg)$/.test(filename);
}

export class ThumbnailStore {
  private readonly root = config.thumbnails.path;
  private readonly urlPrefix = config.thumbnails.urlPrefix.replace(/\/+$/, '');

  /**
   * Check + store `png` for one stored (shared/published) version and return its public
   * URL. Returns null when there is nothing to store or anything at all goes wrong.
   *
   * `kind` ('share' | 'publish' | 'configurator-edit' | 'backfill' | …) only labels the log
   * lines — the flows are otherwise identical here, but which one dropped a thumbnail is
   * the first question anyone asks.
   */
  async write(
    author: string,
    fileId: string,
    versionId: string,
    png: unknown,
    kind?: string,
  ): Promise<string | null> {
    const segments = safeSegments(author, fileId, versionId);
    if (!segments) return this.refuseUnsafePath(author, fileId, versionId, kind);
    const [authorSeg, fileSeg, versionSeg] = segments;
    return this.store(authorSeg, fileSeg, versionSeg, png, kind);
  }

  /**
   * As {@link write}, for a file's WORKING copy: one `working-*` file per file id, replaced
   * on every regeneration, whatever row happens to be the latest at the time (the route
   * stamps that row; saveVersion() carries the URL to the rows that follow).
   */
  async writeWorking(author: string, fileId: string, png: unknown, kind?: string): Promise<string | null> {
    const segments = safeSegments(author, fileId);
    if (!segments) return this.refuseUnsafePath(author, fileId, WORKING_STEM, kind);
    const [authorSeg, fileSeg] = segments;
    return this.store(authorSeg, fileSeg, WORKING_STEM, png, kind);
  }

  private refuseUnsafePath(author: string, fileId: string, versionId: string, kind?: string): null {
    console.warn(`ThumbnailStore: refusing unsafe path segments for ${author}/${fileId}`);
    void logThumbnail({
      event: 'unsafe-path', kind, author, fileId, versionId,
      reason: 'author/fileId/versionId is not a safe path segment',
    });
    return null;
  }

  /** The shared half of write()/writeWorking(): `stem` is the version id, or 'working'. */
  private async store(authorSeg: string, fileSeg: string, stem: string, body: unknown, kind?: string): Promise<string | null> {
    const versionId = stem;
    const png = asBuffer(body);
    if (body === undefined || body === null || (png && png.length === 0)) {
      void logThumbnail({
        event: 'received', kind, author: authorSeg, fileId: fileSeg, versionId, bytes: 0,
        reason: 'no thumbnail in request',
      });
      return null;
    }

    const bytes = png ? png.length : null;
    void logThumbnail({ event: 'received', kind, author: authorSeg, fileId: fileSeg, versionId, bytes });

    const check = checkThumbnailPng(png, config.thumbnails.maxBytes);
    if (!check.ok || !png) {
      console.warn(`ThumbnailStore: rejected thumbnail for ${authorSeg}/${fileSeg}: ${check.reason}`);
      void logThumbnail({
        event: 'rejected', kind, author: authorSeg, fileId: fileSeg, versionId, bytes, reason: check.reason,
        // The first bytes tell "our own PNG, one unexpected thing" from "something else
        // entirely was posted", without keeping the picture itself.
        detail: { head: png ? png.subarray(0, 16).toString('hex') : typeof body },
      });
      return null;
    }
    const source = png;

    try {
      const dir = join(this.root, authorSeg, fileSeg);
      await mkdir(dir, { recursive: true });

      const filename = `${stem}-${contentHash(source)}.png`;
      const target = join(dir, filename);

      // Write to a temp file then rename: a reader (the static mount) can only ever see
      // a complete file, never a half-written one.
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, source);
      await rename(tmp, target);

      // Drop any earlier picture for this same stem — its URL is already superseded.
      await this.removeOthers(dir, stem, filename);

      const url = `${this.urlPrefix}/${authorSeg}/${fileSeg}/${filename}`;
      void logThumbnail({
        event: 'stored', kind, author: authorSeg, fileId: fileSeg, versionId, bytes, url,
        detail: { width: check.width, height: check.height },
      });
      return url;
    } catch (error) {
      console.warn(`ThumbnailStore: failed to write thumbnail for ${authorSeg}/${fileSeg}:`, (error as Error).message);
      void logThumbnail({
        event: 'write-failed', kind, author: authorSeg, fileId: fileSeg, versionId, bytes,
        reason: (error as Error)?.message ?? String(error),
        detail: { root: this.root },
      });
      return null;
    }
  }

  /** Remove a single version's thumbnail, or the whole file's directory when `versionId`
   *  is omitted (un-publish, delete). Silent — a missing file is the desired end state. */
  async remove(author: string, fileId: string, versionId?: string): Promise<void> {
    const segments = safeSegments(author, fileId);
    if (!segments) return;
    const [authorSeg, fileSeg] = segments;

    // Deletion is the one way a thumbnail that DID exist stops existing, so it belongs in
    // the same log — otherwise a vanished preview looks like it was never written.
    void logThumbnail({ event: 'removed', author: authorSeg, fileId: fileSeg, versionId });

    try {
      const dir = join(this.root, authorSeg, fileSeg);
      if (!versionId) {
        await rm(dir, { recursive: true, force: true });
        return;
      }
      const versionSeg = safeSegments(versionId)?.[0];
      if (!versionSeg) return;
      await this.removeOthers(dir, versionSeg, null);
    } catch {
      // Nothing to do — the point of this call is for the file not to exist.
    }
  }

  /** Delete every preview file for `stem` except `keep` (null ⇒ delete them all). */
  private async removeOthers(dir: string, stem: string, keep: string | null): Promise<void> {
    try {
      const entries = await readdir(dir);
      await Promise.all(
        entries
          .filter((f) => f !== keep && isPreviewOf(stem, f))
          .map((f) => unlink(join(dir, f)).catch(() => undefined)),
      );
    } catch {
      // Directory may not exist yet — fine.
    }
  }
}

export const thumbnailStore = new ThumbnailStore();
