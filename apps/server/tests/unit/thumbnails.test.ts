/**
 * tests/unit/thumbnails.test.ts — thumbnail checking, storage and serving.
 *
 * Three properties matter most and are asserted directly:
 *
 *   1. A thumbnail can NEVER fail a share or publish. It is a nicety the editor attaches
 *      afterwards, in the background, so the share/publish routes do not even take one.
 *   2. The bytes reach us through a client-controlled request body and are afterwards
 *      served from our own origin as a file, so they must at least BE a PNG of sane size
 *      before they are written — anything else is refused (and the reason logged).
 *   3. The working copy is a new row per save, so its preview is keyed by FILE, replaced
 *      in place, and carried forward by saveVersion() — never lost to a keystroke.
 *
 * Runs against a throwaway SQLite file and a throwaway thumbnail directory, both set
 * before the modules that read them are imported.
 */

import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

import type { ScriptData } from '@archiyou/core/src/execution/types';

let store: typeof import('../../src/services/ScriptStore').scriptStore;
let thumbnails: typeof import('../../src/services/ThumbnailStore').thumbnailStore;
let checkThumbnailPng: typeof import('../../src/services/ThumbnailStore').checkThumbnailPng;
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A structurally valid PNG (signature, IHDR, IEND). `salt` lands in a tEXt chunk so two
 *  pictures of the same size can still differ in content — and so in their hash. */
function png(width = 512, height = 512, salt = ''): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); // crc unchecked
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('tEXt', Buffer.from(`salt\0${salt}`, 'latin1')), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const GOOD_PNG = png();

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
  const storeModule = await import('../../src/services/ThumbnailStore');
  thumbnails = storeModule.thumbnailStore;
  checkThumbnailPng = storeModule.checkThumbnailPng;
  flushThumbnailLog = (await import('../../src/services/thumbnailLog')).flushThumbnailLog;
});

function payload(over: Partial<ScriptData> = {}): Record<string, unknown> {
  return { name: 'thing', code: 'const a = 1;', ...over } as Record<string, unknown>;
}

describe('checkThumbnailPng — is this a picture we will store?', () => {
  it('accepts what the browser renders', () => {
    expect(checkThumbnailPng(GOOD_PNG, 512 * 1024)).toMatchObject({ ok: true, width: 512, height: 512 });
  });

  it.each([
    ['not a buffer',        'a string'],
    ['empty',               Buffer.alloc(0)],
    ['a wrong signature',   Buffer.concat([Buffer.from('GIF89a'), GOOD_PNG.subarray(6)])],
    // Buffer.from() copies: a subarray shares memory, and .fill() on it would corrupt GOOD_PNG.
    ['no IHDR first',       Buffer.concat([PNG_SIGNATURE, Buffer.from(GOOD_PNG.subarray(8)).fill(0x20, 4, 8)])],
    ['a zero dimension',    png(0, 100)],
    ['a poster',            png(4096, 4096)],
    ['a truncated header',  GOOD_PNG.subarray(0, 20)],
  ])('rejects %s', (_label, bad) => {
    expect(checkThumbnailPng(bad, 512 * 1024).ok).toBe(false);
  });

  it('rejects anything over the byte cap, before looking at it', () => {
    expect(checkThumbnailPng(GOOD_PNG, GOOD_PNG.length - 1)).toMatchObject({ ok: false, reason: expect.stringContaining('too large') });
  });
});

describe('ThumbnailStore', () => {
  it('writes a content-addressed .png and returns its URL', async () => {
    const url = await thumbnails.write(AUTHOR, 'file-1', 'version-1', GOOD_PNG);
    expect(url).toMatch(/^\/thumbnails\/tester\/file-1\/version-1-[0-9a-f]{8}\.png$/);
    expect(existsSync(join(THUMB_ROOT, 'tester', 'file-1', url!.split('/').pop()!))).toBe(true);
  });

  it('gives a regenerated thumbnail a NEW url and removes the old file — and an old .svg too', async () => {
    const dir = join(THUMB_ROOT, 'tester', 'file-2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'version-2-deadbeef.svg'), '<svg/>'); // what an older client stored

    const first = await thumbnails.write(AUTHOR, 'file-2', 'version-2', GOOD_PNG);
    const second = await thumbnails.write(AUTHOR, 'file-2', 'version-2', png(512, 512, 'changed'));

    // Content-addressed: a different picture must never reuse the old URL, which is what
    // makes Cache-Control: immutable safe on the static mount.
    expect(second).not.toBe(first);
    expect(readdirSync(dir)).toEqual([second!.split('/').pop()]);
  });

  it('keeps one working-copy picture per file, next to the versions', async () => {
    const dir = join(THUMB_ROOT, 'tester', 'file-w');
    const version = await thumbnails.write(AUTHOR, 'file-w', 'version-1', GOOD_PNG);
    const first = await thumbnails.writeWorking(AUTHOR, 'file-w', png(512, 512, 'run 1'));
    expect(first).toMatch(/^\/thumbnails\/tester\/file-w\/working-[0-9a-f]{8}\.png$/);

    const second = await thumbnails.writeWorking(AUTHOR, 'file-w', png(512, 512, 'run 2'));
    expect(second).not.toBe(first);
    // The previous working picture is gone; the version's is untouched.
    expect(readdirSync(dir).sort()).toEqual([second!.split('/').pop(), version!.split('/').pop()].sort());
  });

  it('returns null (never throws) for absent or hostile input', async () => {
    for (const bad of [undefined, null, Buffer.alloc(0), '<script>alert(1)</script>', 42, {}, Buffer.from('not a png')]) {
      await expect(thumbnails.write(AUTHOR, 'file-3', 'version-3', bad)).resolves.toBeNull();
      await expect(thumbnails.writeWorking(AUTHOR, 'file-3', bad)).resolves.toBeNull();
    }
    expect(existsSync(join(THUMB_ROOT, 'tester', 'file-3'))).toBe(false);
  });

  it('refuses path traversal in the id segments', async () => {
    for (const evil of ['..', '../..', 'a/../../b', '/etc/passwd']) {
      await expect(thumbnails.write(evil, 'f', 'v', GOOD_PNG)).resolves.toBeNull();
      await expect(thumbnails.write(AUTHOR, evil, 'v', GOOD_PNG)).resolves.toBeNull();
      await expect(thumbnails.write(AUTHOR, 'f', evil, GOOD_PNG)).resolves.toBeNull();
      await expect(thumbnails.writeWorking(evil, 'f', GOOD_PNG)).resolves.toBeNull();
      await expect(thumbnails.writeWorking(AUTHOR, evil, GOOD_PNG)).resolves.toBeNull();
    }
  });

  it('removes a whole file directory on delete', async () => {
    await thumbnails.write(AUTHOR, 'file-4', 'version-4', GOOD_PNG);
    expect(existsSync(join(THUMB_ROOT, 'tester', 'file-4'))).toBe(true);
    await thumbnails.remove(AUTHOR, 'file-4');
    expect(existsSync(join(THUMB_ROOT, 'tester', 'file-4'))).toBe(false);
  });
});

/**
 * The diagnostic log (services/thumbnailLog.ts). Its whole reason to exist is that
 * dropping a thumbnail is silent everywhere else, so what is asserted here is that the
 * silent paths — no picture at all, and a rejected one — each still leave a line behind,
 * with the reason attached.
 */
describe('thumbnail log', () => {
  it('records a stored thumbnail with its size, dimensions and url', async () => {
    const url = await thumbnails.write(AUTHOR, 'log-1', 'v1', GOOD_PNG, 'version');
    const stored = (await logLines()).filter((l) => l.event === 'stored' && l.fileId === 'log-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'version', versionId: 'v1', url, bytes: GOOD_PNG.length });
    expect(stored[0].detail).toMatchObject({ width: 512, height: 512 });
  });

  it('records the silent no-thumbnail case', async () => {
    await thumbnails.writeWorking(AUTHOR, 'log-2', undefined, 'working');
    const line = (await logLines()).find((l) => l.fileId === 'log-2');
    expect(line).toMatchObject({ event: 'received', kind: 'working', versionId: 'working', bytes: 0, reason: 'no thumbnail in request' });
  });

  it('records why a thumbnail was rejected', async () => {
    await thumbnails.write(AUTHOR, 'log-3', 'v1', Buffer.from('<svg><script>alert(1)</script></svg>'), 'backfill');
    const line = (await logLines()).find((l) => l.event === 'rejected' && l.fileId === 'log-3');
    expect(line).toBeTruthy();
    expect(String(line!.reason)).toContain('signature');
    expect(line!.kind).toBe('backfill');
  });

  it('survives a record it cannot serialize, and truncates long fields', async () => {
    const { logThumbnail } = await import('../../src/services/thumbnailLog');
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    // A log that can throw is a log that can break an upload — the one thing this must
    // never do, since it exists to diagnose uploads that already go wrong quietly.
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
    const fileId = store.create(AUTHOR, payload({ thumbnail: '/thumbnails/evil.png' } as Partial<ScriptData>)).fileId as string;
    expect(store.getFile(AUTHOR, fileId).thumbnail).toBeNull();

    const version = store.publish(AUTHOR, fileId, payload({
      version: '1.0.0',
      published: { public: true },
      thumbnail: '/thumbnails/evil.png',
    } as Partial<ScriptData>));
    expect(version.thumbnail).toBeNull();

    store.setThumbnail(AUTHOR, version.id as string, '/thumbnails/tester/x/y.png');
    const reloaded = store.listPublishedVersionsForAuthor(AUTHOR).find((s) => s.id === version.id);
    expect(reloaded?.thumbnail).toBe('/thumbnails/tester/x/y.png');
  });

  it('does not let another author stamp your thumbnail', () => {
    const fileId = store.create(AUTHOR, payload({ name: 'mine' })).fileId as string;
    const version = store.publish(AUTHOR, fileId, payload({
      name: 'mine', version: '1.0.0', published: { public: true },
    }));

    store.setThumbnail('someone-else', version.id as string, '/thumbnails/evil.png');
    expect(() => store.setFileThumbnail('someone-else', fileId, '/thumbnails/evil.png')).toThrow();

    const reloaded = store.listPublishedVersionsForAuthor(AUTHOR).find((s) => s.id === version.id);
    expect(reloaded?.thumbnail).toBeNull();
    expect(store.getFile(AUTHOR, fileId).thumbnail).toBeNull();
  });

  it('stamps the working copy on the latest row and carries it across saves, ignoring the client', () => {
    const fileId = store.create(AUTHOR, payload({ name: 'wip' })).fileId as string;

    const stamped = store.setFileThumbnail(AUTHOR, fileId, '/thumbnails/tester/wip/working-1.png');
    expect(stamped.thumbnail).toBe('/thumbnails/tester/wip/working-1.png');
    expect(store.getFile(AUTHOR, fileId).thumbnail).toBe('/thumbnails/tester/wip/working-1.png');

    // A save appends a new row; the URL follows — and a client's own value is ignored.
    const saved = store.saveVersion(AUTHOR, fileId, payload({ name: 'wip', code: 'box(1);', thumbnail: '/thumbnails/evil.png' } as Partial<ScriptData>));
    expect(saved.id).not.toBe(stamped.id);
    expect(saved.thumbnail).toBe('/thumbnails/tester/wip/working-1.png');
    expect(store.listForUser(AUTHOR).find((s) => s.fileId === fileId)?.thumbnail).toBe('/thumbnails/tester/wip/working-1.png');

    // A stored version starts without one: its own picture is attached afterwards.
    const shared = store.share(AUTHOR, fileId, payload({ name: 'wip', version: '0.1.0', shared: { created: new Date().toISOString() } } as Partial<ScriptData>));
    expect(shared.thumbnail).toBeNull();
  });
});

/**
 * End to end over HTTP: the upload routes take the PNG as the body, the response comes back
 * with a URL, and that URL actually resolves through the static mount with the caching +
 * hardening headers. A URL nothing serves would be worse than no thumbnail at all.
 */
describe('upload → serve (HTTP)', () => {
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
    // Mirror plugin.ts: the PNG body parser and the static mount with its per-type headers.
    app.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: config.thumbnails.maxBytes + 1024 },
      (_request, body, done) => done(null, body));
    await app.register(import('@fastify/static'), {
      root: resolve(config.thumbnails.path),
      prefix: `${config.thumbnails.urlPrefix}/`,
      index: false, dotfiles: 'deny', immutable: true, maxAge: '1y',
      setHeaders: (res, path) => {
        res.setHeader('Content-Type', path.endsWith('.svg') ? 'image/svg+xml; charset=utf-8' : 'image/png');
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

  const publish = (version: string) => app.inject({
    method: 'POST',
    url: `/scripts/${AUTHOR}/${fileId}/publish`,
    headers: auth(),
    payload: { name: 'http-thing', code: 'const a = 1;', version, published: { public: true } },
  });

  const attach = (fid: string, versionId: string, body: Buffer | string, query = '') => app.inject({
    method: 'PUT',
    url: `/scripts/${AUTHOR}/${fid}/versions/${versionId}/thumbnail${query}`,
    headers: { ...auth(), 'content-type': 'image/png' },
    payload: body,
  });

  const attachWorking = (fid: string, body: Buffer | string, query = '') => app.inject({
    method: 'PUT',
    url: `/scripts/${AUTHOR}/${fid}/thumbnail${query}`,
    headers: { ...auth(), 'content-type': 'image/png' },
    payload: body,
  });

  it('publishes without a thumbnail (201, null) — the picture follows on its own', async () => {
    const published = await publish('1.0.0');
    expect(published.statusCode).toBe(201);
    expect(published.json().thumbnail).toBeNull();
  });

  describe('PUT …/versions/:versionId/thumbnail', () => {
    it('attaches a preview and serves it with cache + hardening headers', async () => {
      const versionId = (await publish('3.0.0')).json().id as string;

      const res = await attach(fileId, versionId, GOOD_PNG);
      expect(res.statusCode).toBe(200);
      const url = res.json().thumbnail as string;
      expect(url).toMatch(/\.png$/);

      // The URL must actually resolve, and the row must now carry it.
      const served = await app.inject({ method: 'GET', url });
      expect(served.statusCode).toBe(200);
      expect(served.rawPayload.equals(GOOD_PNG)).toBe(true);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-security-policy']).toContain('sandbox');
      expect(served.headers['cache-control']).toContain('immutable');
      expect(store.findVersionById(AUTHOR, versionId)?.thumbnail).toBe(url);

      // Conditional request → 304, so list views don't re-download every icon.
      const revalidated = await app.inject({
        method: 'GET', url, headers: { 'if-none-match': served.headers.etag as string },
      });
      expect(revalidated.statusCode).toBe(304);
    });

    it('replaces an existing preview with a new url (content-addressed)', async () => {
      const versionId = (await publish('3.1.0')).json().id as string;
      const first = (await attach(fileId, versionId, GOOD_PNG)).json().thumbnail as string;
      const second = (await attach(fileId, versionId, png(512, 512, 'changed'))).json().thumbnail as string;

      expect(second).not.toBe(first);
      expect(store.findVersionById(AUTHOR, versionId)?.thumbnail).toBe(second);
      // The superseded picture is gone, so nothing can serve the old one.
      const stale = await app.inject({ method: 'GET', url: first });
      expect(stale.statusCode).toBe(404);
    });

    it('422s a refused body without saying why (the reason is logged, with the flow that sent it)', async () => {
      const versionId = (await publish('3.2.0')).json().id as string;
      const res = await attach(fileId, versionId, '<svg><script>alert(1)</script></svg>', '?kind=backfill');
      expect(res.statusCode).toBe(422);
      expect(res.json().error).not.toContain('signature');
      expect(store.findVersionById(AUTHOR, versionId)?.thumbnail).toBeNull();

      const line = (await logLines()).find((l) => l.event === 'rejected' && l.versionId === versionId);
      expect(line).toMatchObject({ kind: 'backfill' });
    });

    it('404s a version that is not the caller\'s (or does not exist)', async () => {
      const versionId = (await publish('3.3.0')).json().id as string;
      // Right version, wrong file — the ownership gate is (author, fileId, versionId).
      const otherFile = store.create(AUTHOR, payload({ name: 'other-thing' })).fileId as string;
      expect((await attach(otherFile, versionId, GOOD_PNG)).statusCode).toBe(404);
      expect((await attach(fileId, 'no-such-version', GOOD_PNG)).statusCode).toBe(404);
    });
  });

  describe('PUT …/:fileId/thumbnail (the working copy)', () => {
    it('stamps the latest row, survives a save, and keeps one file per file', async () => {
      const wip = store.create(AUTHOR, payload({ name: 'wip-http' })).fileId as string;

      const first = await attachWorking(wip, png(512, 512, 'run 1'), '?kind=working');
      expect(first.statusCode).toBe(200);
      const firstUrl = first.json().thumbnail as string;
      expect(firstUrl).toMatch(new RegExp(`^/thumbnails/${AUTHOR}/${wip}/working-[0-9a-f]{8}\\.png$`));
      expect(store.getFile(AUTHOR, wip).thumbnail).toBe(firstUrl);
      expect((await app.inject({ method: 'GET', url: firstUrl })).statusCode).toBe(200);

      // An ordinary save (a new row) keeps pointing at the picture.
      const saved = await app.inject({
        method: 'PUT', url: `/scripts/${AUTHOR}/${wip}`, headers: auth(),
        payload: { name: 'wip-http', code: 'box(2);' },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().thumbnail).toBe(firstUrl);

      // The next run replaces it: new URL on the (new) latest row, old file gone.
      const secondUrl = (await attachWorking(wip, png(512, 512, 'run 2'))).json().thumbnail as string;
      expect(secondUrl).not.toBe(firstUrl);
      expect(store.getFile(AUTHOR, wip).thumbnail).toBe(secondUrl);
      expect(readdirSync(join(THUMB_ROOT, AUTHOR, wip))).toEqual([secondUrl.split('/').pop()]);
      expect((await app.inject({ method: 'GET', url: firstUrl })).statusCode).toBe(404);
    });

    it('404s a file that is not the caller\'s, before writing anything', async () => {
      const foreign = store.create('someone-else', payload({ name: 'theirs' })).fileId as string;
      expect((await attachWorking(foreign, GOOD_PNG)).statusCode).toBe(404);
      expect(existsSync(join(THUMB_ROOT, AUTHOR, foreign))).toBe(false);
      expect((await attachWorking('no-such-file', GOOD_PNG)).statusCode).toBe(404);
    });

    it('422s a body that is not a PNG', async () => {
      const res = await attachWorking(fileId, Buffer.from('definitely not a png'));
      expect(res.statusCode).toBe(422);
      expect(store.getFile(AUTHOR, fileId).thumbnail).toBeNull();
    });
  });

  it('still serves a thumbnail an older client stored as SVG, as SVG', async () => {
    const dir = join(THUMB_ROOT, AUTHOR, 'legacy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'v1-0ldsvg00.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await app.inject({ method: 'GET', url: `/thumbnails/${AUTHOR}/legacy/v1-0ldsvg00.svg` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  it('404s a thumbnail that was never written', async () => {
    const res = await app.inject({ method: 'GET', url: '/thumbnails/tester/nope/nope-00000000.png' });
    expect(res.statusCode).toBe(404);
  });
});
