/**
 * tests/unit/library.shared.test.ts — who sees a shared script in the shared library
 * (routes/library.ts). A share with an `onlyUsers` list is for its author and those users
 * only, in the list by author as well as on its own: both carry the code.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

let app: FastifyInstance;

const as = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub })}` });

const names = async (url: string, sub?: string) =>
  (await app.inject({ method: 'GET', url, headers: sub ? as(sub) : {} })).json().data.map((d: { name: string }) => d.name).sort();

beforeAll(async () =>
{
  process.env.SERVER_DATABASE_URL = 'memory://';
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();
  const { scriptStore } = await import('../../src/services/ScriptStore');

  const shareAs = async (name: string, onlyUsers?: string[]) =>
  {
    const file = await scriptStore.create('alice', { name, code: 'box(1);' });
    await scriptStore.share('alice', file.fileId as string, { name, code: 'box(1);', version: '1.0.0', shared: { created: new Date().toISOString(), ...(onlyUsers ? { onlyUsers } : {}) } });
  };
  await shareAs('for-everyone');
  await shareAs('for-bob', ['bob']);

  app = Fastify();
  await app.register(import('@fastify/jwt'), { secret: 'test-secret-for-the-library' });
  const { registerLibraryRoutes } = await import('../../src/routes/library');
  await app.register(registerLibraryRoutes);
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe('an author\'s shared scripts', () =>
{
  it('lists a restricted share only for its author and the users it names', async () =>
  {
    expect(await names('/scripts/shared/alice')).toEqual(['for-everyone']);
    expect(await names('/scripts/shared/alice', 'carol')).toEqual(['for-everyone']);
    expect(await names('/scripts/shared/alice', 'bob')).toEqual(['for-bob', 'for-everyone']);
    expect(await names('/scripts/shared/alice', 'alice')).toEqual(['for-bob', 'for-everyone']);
  });

  it('gates the single script the same way', async () =>
  {
    expect((await app.inject({ method: 'GET', url: '/scripts/shared/alice/for-bob' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/scripts/shared/alice/for-bob', headers: as('bob') })).statusCode).toBe(200);
  });
});
