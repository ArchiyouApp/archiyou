/**
 * thumbnailLog.ts — one append-only file recording the whole thumbnail lifecycle.
 *
 * WHY THIS EXISTS: a thumbnail is attached to a publish/share as a side effect, and every
 * failure along the way is deliberately silent (see ThumbnailStore.write) — a share must
 * never fail over a preview. The result is that "this script has no thumbnail" carries no
 * information at all: a request that arrived without a drawing, one whose SVG was refused
 * by the allowlist, and one the server could not write to disk all end the same way.
 *
 * This file separates them. Every thumbnail that arrives is recorded with its size and
 * what became of it, and so is every reason one was dropped.
 *
 * Format is JSON Lines: one self-contained JSON object per line, so it greps like text
 * and parses like data (`jq -c 'select(.event=="rejected")' thumbnails.log`).
 *
 * This is a diagnostic, never a dependency. Writes are queued behind one promise chain
 * (so lines can't interleave), never awaited by a request handler, and every error is
 * swallowed — an unwritable log must not turn into a failed publish, which is exactly
 * the failure mode the log was added to investigate.
 */

import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { config } from '../config';

/** What happened, emitted by ThumbnailStore and the publish/share routes. */
export type ThumbnailLogEvent =
  | 'received'        // a publish/share request reached the server (with or without SVG)
  | 'stored'          // SVG validated and written; `url` is now on the row
  | 'rejected'        // the allowlist refused it — `reason` says which rule
  | 'unsafe-path'     // author/fileId/versionId would not make a safe filename
  | 'write-failed'    // disk error (permissions, full volume, missing mount)
  | 'removed';        // thumbnails deleted (file deleted, version superseded)

export interface ThumbnailLogRecord {
  event: ThumbnailLogEvent;
  author?: string | null;
  fileId?: string | null;
  versionId?: string | null;
  /** 'share' | 'publish' | 'configurator-edit' — which flow produced the request. */
  kind?: string | null;
  /** Byte size of the SVG as received/stored. */
  bytes?: number | null;
  /** Why it was rejected, or the error message when a write failed. */
  reason?: string | null;
  /** Resulting public URL, on `stored`. */
  url?: string | null;
  /** Anything else worth keeping; values are stringified and truncated. */
  detail?: Record<string, unknown> | null;
}

/** Cap on any single logged string, so a stack trace or a hostile "reason" can never
 *  make the log the biggest file on the volume. */
const MAX_FIELD = 500;

function trim(value: unknown): unknown {
  if (typeof value === 'string') return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  try {
    const json = JSON.stringify(value);
    return json.length > MAX_FIELD ? `${json.slice(0, MAX_FIELD)}…` : JSON.parse(json);
  } catch {
    return '[unserializable]';
  }
}

/** Serial write chain: appendFile calls are not ordered against each other, and a
 *  half-line interleaved with another is worse than no line at all. */
let queue: Promise<void> = Promise.resolve();
let dirReady = false;

async function rotateIfNeeded(path: string, maxBytes: number): Promise<void> {
  if (maxBytes <= 0) return;
  try {
    const info = await stat(path);
    if (info.size < maxBytes) return;
    // One generation only. This is a debugging aid; keeping a deep archive of it would
    // be its own maintenance problem.
    await rename(path, `${path}.1`);
  } catch {
    // No file yet (the common case) — nothing to rotate.
  }
}

/**
 * Append one record. Fire-and-forget by design: callers do not await it, and it never
 * rejects. Returns the queued promise purely so tests can flush.
 */
export function logThumbnail(record: ThumbnailLogRecord): Promise<void> {
  if (!config.thumbnails.logPath) return Promise.resolve();
  const path = config.thumbnails.logPath;

  const line: Record<string, unknown> = { at: new Date().toISOString() };
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    line[key] = trim(value);
  }

  queue = queue.then(async () => {
    try {
      if (!dirReady) {
        await mkdir(dirname(path), { recursive: true });
        dirReady = true;
      }
      await rotateIfNeeded(path, config.thumbnails.logMaxBytes);
      await appendFile(path, `${JSON.stringify(line)}\n`, 'utf8');
    } catch {
      // A diagnostic that breaks the thing it diagnoses is worse than no diagnostic.
      // Re-check the directory next time though: if it was removed under us (a wiped
      // volume, a cleaned data dir), the cached "it exists" would keep every later line
      // failing for the lifetime of the process.
      dirReady = false;
    }
  });
  return queue;
}

/** Resolve once every queued line has been written. Tests only. */
export function flushThumbnailLog(): Promise<void> {
  return queue;
}
