/**
 * make-db-content — the snapshot of the product sheet a run reckons with, fetched from the
 * app's own server before the run: signed in only, a version kept for the session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let token: string | null = 'tok';
vi.mock('../src/services/auth-service.js', () => ({ authService: { getToken: async () => token } }));

const { resolveMakeDb } = await import('../src/services/make-db-content.js');

describe('resolveMakeDb', () =>
{
  beforeEach(() => { token = 'tok'; });

  it('fetches the snapshots the needs name, with the sign-in, once per version', async () =>
  {
    const fetch = vi.fn(async (url: string, init?: RequestInit) =>
    {
      expect((init?.headers as any).Authorization).toBe('Bearer tok');
      const id = decodeURIComponent(url.split('/makedb/')[1]!);
      return new Response(JSON.stringify({ version: '2026-11-24.1' }), { headers: { 'X-Make-Db-Version': id === 'latest' ? '2026-11-24.1' : id } });
    });
    vi.stubGlobal('fetch', fetch);

    const { content, problems } = await resolveMakeDb([{ kind: 'make-db', id: 'latest' }, { kind: 'make-db', id: '2026-11-20.1' }, { kind: 'google-sheet', id: 'x' }]);
    expect(problems).toEqual([]);
    expect(Object.keys(content)).toEqual(['make-db:latest', 'make-db:2026-11-20.1']);
    expect(content['make-db:latest']).toMatchObject({ kind: 'make-db', id: 'latest', version: '2026-11-24.1' });

    await resolveMakeDb([{ kind: 'make-db', id: '2026-11-20.1' }]);
    expect(fetch).toHaveBeenCalledTimes(2);   // the version was kept
  });

  it('says why when it cannot: not signed in, or no such snapshot', async () =>
  {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect((await resolveMakeDb([{ kind: 'make-db', id: '2026-11-21.3' }])).problems).toEqual(["make.db('2026-11-21.3'): the server keeps no such snapshot of the product sheet"]);
    token = null;
    expect((await resolveMakeDb([{ kind: 'make-db', id: '2026-11-22.1' }])).problems[0]).toMatch(/sign in/);
  });
});
