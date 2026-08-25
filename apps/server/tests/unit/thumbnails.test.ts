/**
 * tests/unit/thumbnails.test.ts — thumbnail validation, storage and serving.
 *
 * Two properties matter most and are asserted directly:
 *
 *   1. A thumbnail can NEVER fail a publish. It is a nicety attached after the row is
 *      already committed, so a malformed, oversized, hostile or simply absent SVG must
 *      still leave the caller with a published script (just without a preview).
 *   2. The bytes reach us through a client-controlled request body and are afterwards
 *      served from our own origin as a file, so they are allowlist-validated, not
 *      blocklist-scanned. Anything our exporter would not emit is rejected outright.
 *
 * Runs against a throwaway SQLite file and a throwaway thumbnail directory, both set
 * before the modules that read them are imported.
 */

import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

import type { ScriptData } from '@archiyou/core/src/execution/types';

let store: typeof import('../../src/services/ScriptStore').scriptStore;
let thumbnails: typeof import('../../src/services/ThumbnailStore').thumbnailStore;
let checkThumbnailSvg: typeof import('../../src/services/svgSanitize').checkThumbnailSvg;
let flushThumbnailLog: typeof import('../../src/services/thumbnailLog').flushThumbnailLog;

const AUTHOR = 'tester';
let THUMB_ROOT: string;
let LOG_PATH: string;

/** Every line written to the diagnostic log so far, parsed. */
async function logLines(): Promise<Array<Record<string, unknown>>> {
  await flushThumbnailLog();
  if (!existsSync(LOG_PATH)) return [];
  return readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** A minimal document in exactly the shape SVGExporter emits. */
const GOOD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" data-units="mm">'
  + '<style>svg{color:#1f2937}.line{fill:none;stroke:currentColor;vector-effect:non-scaling-stroke}</style>'
  + '<path d="M0 0 L100 100" class="line"/></svg>';

beforeAll(async () => {
  process.env.SERVER_DATABASE_FILE = join(mkdtempSync(join(tmpdir(), 'ay-thumbs-db-')), 'test.db');
  THUMB_ROOT = mkdtempSync(join(tmpdir(), 'ay-thumbs-'));
  process.env.SERVER_THUMBNAIL_PATH = THUMB_ROOT;
  // Keep the diagnostic log out of the repo's data/ directory during tests.
  LOG_PATH = join(THUMB_ROOT, 'logs', 'thumbnails.log');
  process.env.SERVER_THUMBNAIL_LOG = LOG_PATH;

  const { runMigrations } = await import('../../src/db/migrate');
  runMigrations();
  store = (await import('../../src/services/ScriptStore')).scriptStore;
  thumbnails = (await import('../../src/services/ThumbnailStore')).thumbnailStore;
  checkThumbnailSvg = (await import('../../src/services/svgSanitize')).checkThumbnailSvg;
  flushThumbnailLog = (await import('../../src/services/thumbnailLog')).flushThumbnailLog;
});

function payload(over: Partial<ScriptData> = {}): Record<string, unknown> {
  return { name: 'thing', code: 'const a = 1;', ...over } as Record<string, unknown>;
}

describe('svgSanitize — allowlist', () => {
  it('accepts what the exporter actually emits', () => {
    expect(checkThumbnailSvg(GOOD_SVG, 65536).ok).toBe(true);
  });

  it.each([
    ['script element',       GOOD_SVG.replace('</svg>', '<script>alert(1)</script></svg>')],
    ['event handler',        GOOD_SVG.replace('<path ', '<path onload="alert(1)" ')],
    ['xlink:href',           GOOD_SVG.replace('</svg>', '<use xlink:href="#x"/></svg>')],
    ['foreignObject',        GOOD_SVG.replace('</svg>', '<foreignObject><b>x</b></foreignObject></svg>')],
    ['external image',       GOOD_SVG.replace('</svg>', '<image href="http://evil/x.png"/></svg>')],
    ['anchor',               GOOD_SVG.replace('</svg>', '<a href="javascript:alert(1)">x</a></svg>')],
    ['entity declaration',   `<!DOCTYPE svg [<!ENTITY x "y">]>${GOOD_SVG}`],
    ['CSS url()',            GOOD_SVG.replace('svg{color:#1f2937}', 'svg{background:url(http://evil/x)}')],
    ['animation element',    GOOD_SVG.replace('</svg>', '<animate attributeName="x"/></svg>')],
    ['two roots',            `${GOOD_SVG}${GOOD_SVG}`],
    ['not an svg',           '<html><body>hi</body></html>'],
    ['empty',                ''],
  ])('rejects %s', (_label, hostile) => {
    expect(checkThumbnailSvg(hostile, 65536).ok).toBe(false);
  });

  it('rejects anything over the byte cap', () => {
    const huge = GOOD_SVG.replace('M0 0 L100 100', 'M0 0' + ' L1 1'.repeat(20000));
    expect(checkThumbnailSvg(huge, 1024).ok).toBe(false);
  });
});

describe('ThumbnailStore', () => {
  it('writes a content-addressed file and returns its URL', async () => {
    const url = await thumbnails.write(AUTHOR, 'file-1', 'version-1', GOOD_SVG);
    expect(url).toMatch(/^\/thumbnails\/tester\/file-1\/version-1-[0-9a-f]{8}\.svg$/);
    expect(existsSync(join(THUMB_ROOT, 'tester', 'file-1', url!.split('/').pop()!))).toBe(true);
  });

  it('gives a regenerated thumbnail a NEW url and removes the old file', async () => {
    const first = await thumbnails.write(AUTHOR, 'file-2', 'version-2', GOOD_SVG);
    const changed = GOOD_SVG.replace('M0 0 L100 100', 'M0 0 L200 200');
    const second = await thumbnails.write(AUTHOR, 'file-2', 'version-2', changed);

    // Content-addressed: a different drawing must never reuse the old URL, which is
    // what makes Cache-Control: immutable safe on the static mount.
    expect(second).not.toBe(first);
    expect(readdirSync(join(THUMB_ROOT, 'tester', 'file-2'))).toEqual([second!.split('/').pop()]);
  });

  it('returns null (never throws) for absent or hostile input', async () => {
    for (const bad of [undefined, null, '', '<script>alert(1)</script>', 42, {}]) {
      await expect(thumbnails.write(AUTHOR, 'file-3', 'version-3', bad)).resolves.toBeNull();
    }
    expect(existsSync(join(THUMB_ROOT, 'tester', 'file-3'))).toBe(false);
  });

  it('refuses path traversal in the id segments', async () => {
    for (const evil of ['..', '../..', 'a/../../b', '/etc/passwd']) {
      await expect(thumbnails.write(evil, 'f', 'v', GOOD_SVG)).resolves.toBeNull();
      await expect(thumbnails.write(AUTHOR, evil, 'v', GOOD_SVG)).resolves.toBeNull();
      await expect(thumbnails.write(AUTHOR, 'f', evil, GOOD_SVG)).resolves.toBeNull();
    }
  });

  it('removes a whole file directory on delete', async () => {
    await thumbnails.write(AUTHOR, 'file-4', 'version-4', GOOD_SVG);
    expect(existsSync(join(THUMB_ROOT, 'tester', 'file-4'))).toBe(true);
    await thumbnails.remove(AUTHOR, 'file-4');
    expect(existsSync(join(THUMB_ROOT, 'tester', 'file-4'))).toBe(false);
  });
});

/**
 * The diagnostic log (services/thumbnailLog.ts). Its whole reason to exist is that
 * dropping a thumbnail is silent everywhere else, so what is asserted here is that the
 * silent paths — no SVG at all, and a rejected one — each still leave a line behind, with
 * the reason attached.
 */
describe('thumbnail log', () => {
  it('records a stored thumbnail with its size and url', async () => {
    const url = await thumbnails.write(AUTHOR, 'log-1', 'v1', GOOD_SVG, 'share');
    const stored = (await logLines()).filter((l) => l.event === 'stored' && l.fileId === 'log-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'share', versionId: 'v1', url });
    expect(stored[0].bytes).toBe(Buffer.byteLength(GOOD_SVG, 'utf8'));
  });

  it('records the silent no-thumbnail case — the usual reason a preview is missing', async () => {
    await thumbnails.write(AUTHOR, 'log-2', 'v1', undefined, 'share');
    const line = (await logLines()).find((l) => l.fileId === 'log-2');
    expect(line).toMatchObject({ event: 'received', bytes: 0, reason: 'no thumbnailSvg in request' });
  });

  it('records why a thumbnail was rejected', async () => {
    await thumbnails.write(AUTHOR, 'log-3', 'v1', '<svg><script>alert(1)</script></svg>', 'publish');
    const line = (await logLines()).find((l) => l.event === 'rejected' && l.fileId === 'log-3');
    expect(line).toBeTruthy();
    expect(String(line!.reason)).toContain('script');
    expect(line!.kind).toBe('publish');
  });

  it('survives a record it cannot serialize, and truncates long fields', async () => {
    const { logThumbnail } = await import('../../src/services/thumbnailLog');
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    // A log that can throw is a log that can break a publish — the one thing this must
    // never do, since it exists to diagnose publishes that already go wrong quietly.
    await expect(logThumbnail({
      event: 'write-failed', author: AUTHOR, fileId: 'log-4',
      reason: 'x'.repeat(5000), detail: circular,
    })).resolves.toBeUndefined();

    const line = (await logLines()).find((l) => l.fileId === 'log-4');
    expect(line).toBeTruthy();
    expect(String(line!.reason).length).toBeLessThan(600);
    expect(line!.detail).toBe('[unserializable]');
  });
});

describe('ScriptStore — thumbnail column', () => {
  it('round-trips a stamped url and never persists one the client supplied', () => {
    const fileId = store.create(AUTHOR, payload()).fileId as string;

    // A client-set `thumbnail` is meaningless: the routes overwrite it from the file they
    // actually wrote. What matters here is that the column round-trips a server value.
    const version = store.publish(AUTHOR, fileId, payload({
      version: '1.0.0',
      published: { public: true },
    }));
    expect(version.thumbnail).toBeNull();

    store.setThumbnail(AUTHOR, version.id as string, '/thumbnails/tester/x/y.svg');
    const reloaded = store.listPublishedVersionsForAuthor(AUTHOR).find((s) => s.id === version.id);
    expect(reloaded?.thumbnail).toBe('/thumbnails/tester/x/y.svg');
  });

  it('does not let another author stamp your thumbnail', () => {
    const fileId = store.create(AUTHOR, payload({ name: 'mine' })).fileId as string;
    const version = store.publish(AUTHOR, fileId, payload({
      name: 'mine', version: '1.0.0', published: { public: true },
    }));

    store.setThumbnail('someone-else', version.id as string, '/thumbnails/evil.svg');

    const reloaded = store.listPublishedVersionsForAuthor(AUTHOR).find((s) => s.id === version.id);
    expect(reloaded?.thumbnail).toBeNull();
  });
});

/**
 * End to end over HTTP: publish carries the SVG, the response comes back with a URL, and
 * that URL actually resolves through the static mount with the caching + hardening headers.
 * A URL nothing serves would be worse than no thumbnail at all.
 */
describe('publish → serve (HTTP)', () => {
  const SECRET = 'test-secret-for-thumbnails';
  let app: FastifyInstance;
  let fileId: string;

  beforeAll(async () => {
    const { registerScriptRoutes } = await import('../../src/routes/scripts');
    const { userService } = await import('../../src/services/UserService');
    const { config } = await import('../../src/config');

    // publish sits behind requireVerified — give the test author a verified account.
    // The handle is derived from the email local part, so `tester@…` yields AUTHOR.
    await userService.register(`${AUTHOR}@example.com`, 'test1234', 'Tester').catch(() => undefined);
    const user = userService.findByUsername(AUTHOR);
    expect(user, 'test author account').toBeTruthy();
    userService.markEmailVerified(user!.id);

    app = Fastify();
    await app.register(import('@fastify/jwt'), { secret: SECRET });
    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      try { await request.jwtVerify(); }
      catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
    });
    await app.register(import('@fastify/static'), {
      root: resolve(config.thumbnails.path),
      prefix: `${config.thumbnails.urlPrefix}/`,
      index: false, dotfiles: 'deny', immutable: true, maxAge: '1y',
      setHeaders: (res) => {
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      },
    });
    // Mirror the store-error mapping the real server installs in plugin.ts — routes let
    // ScriptStoreError propagate rather than handling not-found themselves, so without it
    // an unowned version would look like a 500 here and like a 404 in production.
    const { ScriptStoreError } = await import('../../src/services/ScriptStore');
    app.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof ScriptStoreError) {
        return reply.code(error.code === 'not_found' ? 404 : 422).send({ success: false, error: error.message });
      }
      return reply.code(error.statusCode ?? 500).send({ success: false, error: error.message });
    });

    await app.register(registerScriptRoutes);
    await app.ready();

    fileId = store.create(AUTHOR, payload({ name: 'http-thing' })).fileId as string;
  });

  const auth = () => ({ authorization: `Bearer ${app.jwt.sign({ sub: AUTHOR, email: 'tester@example.com', name: 'T' })}` });

  const publish = (version: string, thumbnailSvg?: unknown) => app.inject({
    method: 'POST',
    url: `/scripts/${AUTHOR}/${fileId}/publish`,
    headers: auth(),
    payload: { name: 'http-thing', code: 'const a = 1;', version, published: { public: true }, thumbnailSvg },
  });

  it('stamps a working URL and serves the file with cache + hardening headers', async () => {
    const published = await publish('1.0.0', GOOD_SVG);
    expect(published.statusCode).toBe(201);

    const url = published.json().thumbnail as string;
    expect(url).toMatch(/^\/thumbnails\//);
    // The raw SVG must never come back in the API response — only the URL.
    expect(published.body).not.toContain('<svg');

    const served = await app.inject({ method: 'GET', url });
    expect(served.statusCode).toBe(200);
    expect(served.body).toBe(GOOD_SVG);
    expect(served.headers['content-type']).toContain('image/svg+xml');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toContain('sandbox');
    expect(served.headers['cache-control']).toContain('immutable');

    // Conditional request → 304, so list views don't re-download every icon.
    const revalidated = await app.inject({
      method: 'GET', url, headers: { 'if-none-match': served.headers.etag as string },
    });
    expect(revalidated.statusCode).toBe(304);
  });

  it.each([
    ['a hostile svg',  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['a non-svg',      'not an svg at all'],
    ['nothing',        undefined],
  ])('still publishes (201, thumbnail null) when given %s', async (_label, svg) => {
    const version = `1.${_label.length}.0`;
    const res = await publish(version, svg);
    expect(res.statusCode).toBe(201);
    expect(res.json().thumbnail).toBeNull();
  });

  /**
   * The deferred attach. This exists because the drawing is generated in the background
   * and the share does not wait for it: for a slow script the share request carries no
   * SVG at all, and without this endpoint that version could never get a preview.
   */
  describe('PUT …/versions/:versionId/thumbnail', () => {
    const attach = (fid: string, versionId: string, thumbnailSvg?: unknown) => app.inject({
      method: 'PUT',
      url: `/scripts/${AUTHOR}/${fid}/versions/${versionId}/thumbnail`,
      headers: auth(),
      payload: { thumbnailSvg },
    });

    it('attaches a preview to a version that was shared without one', async () => {
      const published = await publish('3.0.0');
      expect(published.json().thumbnail).toBeNull();
      const versionId = published.json().id as string;

      const res = await attach(fileId, versionId, GOOD_SVG);
      expect(res.statusCode).toBe(200);
      const url = res.json().thumbnail as string;

      // The URL must actually resolve, and the row must now carry it.
      const served = await app.inject({ method: 'GET', url });
      expect(served.statusCode).toBe(200);
      expect(served.body).toBe(GOOD_SVG);
      const row = store.findVersionById(AUTHOR, versionId);
      expect(row?.thumbnail).toBe(url);
    });

    it('replaces an existing preview with a new url (content-addressed)', async () => {
      const published = await publish('3.1.0', GOOD_SVG);
      const versionId = published.json().id as string;
      const first = published.json().thumbnail as string;

      const changed = GOOD_SVG.replace('M0 0 L100 100', 'M0 0 L300 300');
      const second = (await attach(fileId, versionId, changed)).json().thumbnail as string;

      expect(second).not.toBe(first);
      expect(store.findVersionById(AUTHOR, versionId)?.thumbnail).toBe(second);
      // The superseded drawing is gone, so nothing can serve the old picture.
      const stale = await app.inject({ method: 'GET', url: first });
      expect(stale.statusCode).toBe(404);
    });

    it('422s a refused svg without saying why (the reason is logged, not returned)', async () => {
      const versionId = (await publish('3.2.0')).json().id as string;
      const res = await attach(fileId, versionId, '<svg><script>alert(1)</script></svg>');
      expect(res.statusCode).toBe(422);
      expect(res.json().error).not.toContain('script element');
      expect(store.findVersionById(AUTHOR, versionId)?.thumbnail).toBeNull();

      const line = (await logLines()).find((l) => l.event === 'rejected' && l.versionId === versionId);
      expect(line).toMatchObject({ kind: 'deferred' });
    });

    it('404s a version that is not the caller\'s (or does not exist)', async () => {
      const versionId = (await publish('3.3.0')).json().id as string;
      // Right version, wrong file — the ownership gate is (author, fileId, versionId).
      const otherFile = store.create(AUTHOR, payload({ name: 'other-thing' })).fileId as string;
      expect((await attach(otherFile, versionId, GOOD_SVG)).statusCode).toBe(404);
      expect((await attach(fileId, 'no-such-version', GOOD_SVG)).statusCode).toBe(404);
    });
  });


  it('404s a thumbnail that was never written', async () => {
    const res = await app.inject({ method: 'GET', url: '/thumbnails/tester/nope/nope-00000000.svg' });
    expect(res.statusCode).toBe(404);
  });
});
