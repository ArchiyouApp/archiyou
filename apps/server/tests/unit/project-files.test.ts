/**
 * tests/unit/project-files.test.ts — a project's dossier (routes/projects.ts,
 * services/ProjectFileStore.ts) and its files as delivery attachments, up to the client's
 * page (routes/client.ts). See plans/PROJECTS.md.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

let app: FastifyInstance;

const PDF = Buffer.from('%PDF-1.7 a supplier quote');
const JPG = Buffer.from('\xff\xd8\xff fake photo', 'latin1');
const GLB = Buffer.from('glTF fake model');

const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub })}` });

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, sub = 'pro') =>
  app.inject({ method, url, headers: auth(sub), ...(payload !== undefined ? { payload: payload as object } : {}) });

const raw = (method: 'POST' | 'PUT', url: string, body: Buffer, sub = 'pro') =>
  app.inject({ method, url, headers: { ...auth(sub), 'content-type': 'application/octet-stream' }, payload: body });

const keep = (projectId: string, name: string, body: Buffer, sub = 'pro') =>
  raw('POST', `/projects/${projectId}/files/${encodeURIComponent(name)}`, body, sub);

async function project(sub = 'pro'): Promise<{ id: string; configurationId: string }>
{
  const res = await call('POST', '/projects', {
    title: 'Garden house',
    client: { email: 'jan@example.com', name: 'Jan de Vries' },
    configuration: {
      script: { name: 'shed', code: 'box($WIDTH, 500, 750);', params: { WIDTH: { type: 'number', name: 'WIDTH', default: 1000, schema: { type: 'number', minimum: 100, maximum: 3000 } } } },
      values: { WIDTH: 1600 },
    },
  }, sub);
  const data = res.json().data;
  if (!data) throw new Error(`project: ${res.statusCode} ${res.body}`);
  return { id: data.id, configurationId: data.configurations[0].id };
}

beforeAll(async () =>
{
  const { tmpdir } = await import('node:os');
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_DELIVERY_PATH = `${tmpdir()}/archiyou-dossier-deliveries-${process.pid}`;
  process.env.SERVER_PROJECT_FILE_PATH = `${tmpdir()}/archiyou-dossier-test-${process.pid}`;
  process.env.SERVER_THUMBNAIL_PATH = `${tmpdir()}/archiyou-dossier-thumbs-${process.pid}`;
  process.env.SERVER_PROJECT_FILE_MAX_BYTES = '2000';
  process.env.SERVER_PROJECT_FILE_QUOTA_BYTES = '5000';
  process.env.SERVER_DELIVERY_RATE_LIMIT = '10000';
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();

  const { userService } = await import('../../src/services/UserService');
  for (const name of ['pro', 'other', 'full'])
  {
    await userService.register(`${name}@example.com`, 'password123', name);
    await userService.markEmailVerified((await userService.findByUsername(name))!.id);
  }

  app = Fastify();
  await app.register(import('@fastify/jwt'), { secret: 'test-secret-for-dossiers' });
  await app.register(import('@fastify/rate-limit'), { global: false });
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) =>
  {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
  });
  const { requireVerified, setupErrorHandling } = await import('../../src/plugin');
  app.decorate('requireVerified', requireVerified);
  const { config } = await import('../../src/config');
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: config.deliveries.maxFileBytes },
    (_request, body, done) => done(null, body));
  setupErrorHandling(app);
  const { registerProjectRoutes } = await import('../../src/routes/projects');
  const { registerClientRoutes } = await import('../../src/routes/client');
  await app.register(registerProjectRoutes);
  await app.register(registerClientRoutes);
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe('the dossier', () =>
{
  it('keeps documents, pictures and drawings under the name they had, newest first', async () =>
  {
    const p = await project();
    const quote = await keep(p.id, 'Offerte leverancier (2).pdf', PDF);
    expect(quote.statusCode).toBe(201);
    expect(quote.json().data).toMatchObject({ name: 'Offerte leverancier (2).pdf', mime: 'application/pdf', bytes: PDF.length });
    expect((await keep(p.id, 'site photo.JPG', JPG)).statusCode).toBe(201);

    const files = (await call('GET', `/projects/${p.id}`)).json().data.files;
    expect(files.map((f: { name: string }) => f.name)).toEqual(['site photo.JPG', 'Offerte leverancier (2).pdf']);
  });

  it('refuses what could run in a browser, and a name without a type', async () =>
  {
    const p = await project();
    expect((await keep(p.id, 'page.html', Buffer.from('<script>alert(1)</script>'))).statusCode).toBe(422);
    expect((await keep(p.id, 'logo.svg', Buffer.from('<svg onload="x()"/>'))).statusCode).toBe(422);
    expect((await keep(p.id, 'notes', Buffer.from('text'))).statusCode).toBe(422);
    expect((await keep(p.id, 'empty.pdf', Buffer.alloc(0))).statusCode).toBe(422);
  });

  it('gives a file back only to its professional, as a download under its own name', async () =>
  {
    const p = await project();
    const file = (await keep(p.id, 'Tekening één.pdf', PDF)).json().data;

    const res = await call('GET', `/projects/${p.id}/files/${file.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PDF)).toBe(true);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="Tekening __n.pdf"; filename*=UTF-8''${encodeURIComponent('Tekening één.pdf')}`);

    expect((await call('GET', `/projects/${p.id}/files/${file.id}`, undefined, 'other')).statusCode).toBe(404);
    expect((await call('DELETE', `/projects/${p.id}/files/${file.id}`, undefined, 'other')).statusCode).toBe(404);
    expect((await keep(p.id, 'mine.pdf', PDF, 'other')).statusCode).toBe(404);
  });

  it('caps a file and all of a professional\'s files', async () =>
  {
    const p = await project('full');
    expect((await keep(p.id, 'huge.pdf', Buffer.alloc(4000), 'full')).statusCode).toBe(413);
    // 1900 + 1500 + 1500 fits the 5000 of the quota; another 1500 does not
    expect((await keep(p.id, 'big.pdf', Buffer.alloc(1900), 'full')).statusCode).toBe(201);
    for (let i = 0; i < 2; i++) expect((await keep(p.id, `part${i}.pdf`, Buffer.alloc(1500), 'full')).statusCode).toBe(201);
    expect((await keep(p.id, 'one more.pdf', Buffer.alloc(1500), 'full')).statusCode).toBe(429);
  });

  it('forgets a deleted file, and a deleted project\'s files', async () =>
  {
    const p = await project();
    const file = (await keep(p.id, 'old.pdf', PDF)).json().data;
    expect((await call('DELETE', `/projects/${p.id}/files/${file.id}`)).statusCode).toBe(204);
    expect((await call('GET', `/projects/${p.id}/files/${file.id}`)).statusCode).toBe(404);

    const kept = (await keep(p.id, 'kept.pdf', PDF)).json().data;
    expect((await call('DELETE', `/projects/${p.id}`)).statusCode).toBe(204);
    const { projectFileStore } = await import('../../src/services/ProjectFileStore');
    expect(await projectFileStore.read('pro', p.id, kept.id)).toBeNull();
  });
});

describe('a dossier file in a delivery', () =>
{
  it('goes as a copy the client can open, and stays when the dossier file goes', async () =>
  {
    const p = await project();
    const quote = (await keep(p.id, 'Offerte leverancier (2).pdf', PDF)).json().data;
    const photo = (await keep(p.id, 'site photo.JPG', JPG)).json().data;

    const delivery = (await call('POST', `/projects/${p.id}/deliveries`, { configurationId: p.configurationId, title: 'Offer' })).json().data;
    expect((await raw('PUT', `/projects/${p.id}/deliveries/${delivery.id}/files/shed.glb`, GLB)).statusCode).toBe(200);
    expect((await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/attachments`, { fileId: quote.id })).statusCode).toBe(200);
    const attached = await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/attachments`, { fileId: photo.id });
    expect(attached.json().data.files.map((f: { name: string; kind: string }) => `${f.name}:${f.kind}`))
      .toEqual(['shed.glb:model', 'Offerte_leverancier_2.pdf:attachment', 'site_photo.jpg:attachment']);

    const sent = (await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/send`)).json().data;
    const token = (sent.link as string).split('/d/')[1];
    expect((await call('DELETE', `/projects/${p.id}/files/${quote.id}`)).statusCode).toBe(204);

    const pdf = await app.inject({ method: 'GET', url: `/d/${token}/files/Offerte_leverancier_2.pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.equals(PDF)).toBe(true);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/^inline/);

    const view = (await app.inject({ method: 'GET', url: `/d/${token}` })).json().data;
    expect(view.files.map((f: { kind: string }) => f.kind)).toEqual(['model', 'attachment', 'attachment']);
  });

  it('can go with another author\'s configurator too, but not once sent', async () =>
  {
    const p = await project();
    const file = (await keep(p.id, 'drawing.dxf', Buffer.from('0\nSECTION'))).json().data;
    const res = await call('POST', '/projects/' + p.id + '/configurations', {
      script: { name: 'theirs', author: 'someone', code: 'box(1,1,1);', params: {}, published: { fulfillments: [] } },
    });
    const foreign = res.json().data.id;
    const delivery = (await call('POST', `/projects/${p.id}/deliveries`, { configurationId: foreign, title: 'Theirs' })).json().data;
    expect((await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/attachments`, { fileId: file.id })).statusCode).toBe(200);

    const sent = await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/send`);
    expect(sent.statusCode).toBe(200);
    expect((await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/attachments`, { fileId: file.id })).statusCode).toBe(409);

    const token = (sent.json().data.link as string).split('/d/')[1];
    const dxf = await app.inject({ method: 'GET', url: `/d/${token}/files/drawing.dxf` });
    expect(dxf.headers['content-disposition']).toMatch(/^attachment/);
  });
});
