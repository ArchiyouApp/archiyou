/**
 * tests/unit/proxy.test.ts — the asset proxy route behind editor $import().
 *
 * Registered in isolation (no Redis/DB/JWT) so the SSRF guards, size cap, timeout
 * and rate limit can be exercised with app.inject(). Hosts are literal public IPs
 * so the SSRF DNS-resolve path is skipped and no real network/DNS is needed;
 * global fetch is stubbed for the upstream.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerProxyRoutes, _resetProxyState } from '../../src/routes/proxy';
import { config } from '../../src/config';

// A public, routable literal IP (skips DNS + passes SSRF). Documentation range 203.0.113.0/24.
const PUBLIC = '203.0.113.10';

function fakeRes(opts: {
    status?: number; contentType?: string; contentLength?: string; location?: string; bytes?: Uint8Array;
}): any
{
    const headers = new Map<string, string>();
    if(opts.contentType)  headers.set('content-type', opts.contentType);
    if(opts.contentLength) headers.set('content-length', opts.contentLength);
    if(opts.location)     headers.set('location', opts.location);
    const status = opts.status ?? 200;
    const bytes = opts.bytes ?? new Uint8Array();
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
        body: null, // force the arrayBuffer() path in readCapped
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    };
}

let app: FastifyInstance;
const saved = { ...config.proxy, allowlist: [...config.proxy.allowlist] };

beforeEach(async () =>
{
    _resetProxyState();
    app = Fastify({ logger: false });
    await app.register(registerProxyRoutes);
    await app.ready();
});

afterEach(async () =>
{
    await app.close();
    vi.unstubAllGlobals();
    Object.assign(config.proxy, saved); // restore any per-test config tweaks
});

describe('GET /proxy — validation & SSRF', () =>
{
    it('400 when url is missing', async () =>
    {
        const r = await app.inject({ method: 'GET', url: '/proxy' });
        expect(r.statusCode).toBe(400);
    });

    it('400 for a non-http(s) scheme', async () =>
    {
        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent('ftp://x/y')}` });
        expect(r.statusCode).toBe(400);
    });

    it('403 for a loopback host', async () =>
    {
        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent('http://127.0.0.1/secret')}` });
        expect(r.statusCode).toBe(403);
    });

    it('403 for a private host', async () =>
    {
        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent('http://10.0.0.5/x')}` });
        expect(r.statusCode).toBe(403);
    });

    it('403 for a host outside the allowlist when one is configured', async () =>
    {
        config.proxy.allowlist = ['assets.archiyou.com'];
        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent(`http://${PUBLIC}/x.svg`)}` });
        expect(r.statusCode).toBe(403);
    });
});

describe('GET /proxy — fetching', () =>
{
    it('200 returns bytes with the upstream Content-Type echoed', async () =>
    {
        const bytes = new TextEncoder().encode('<svg/>');
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ contentType: 'image/svg+xml', bytes })));

        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent(`http://${PUBLIC}/logo.svg`)}` });
        expect(r.statusCode).toBe(200);
        expect(r.headers['content-type']).toContain('image/svg+xml');
        expect(r.headers['access-control-allow-origin']).toBe('*');
        expect(r.rawPayload.toString()).toBe('<svg/>');
    });

    it('declaws the response so a proxied document cannot run as first-party script', async () =>
    {
        // The whole point of the guard: an attacker picks the Content-Type, and in the
        // recommended single-host deploy this route answers on the app's own origin.
        const bytes = new TextEncoder().encode('<script>alert(document.domain)</script>');
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ contentType: 'text/html', bytes })));

        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent(`http://${PUBLIC}/evil`)}` });
        expect(r.statusCode).toBe(200);
        // Content-Type still echoed — the importer relies on it as the format signal.
        expect(r.headers['content-type']).toContain('text/html');
        expect(r.headers['x-content-type-options']).toBe('nosniff');
        expect(r.headers['content-security-policy']).toContain('sandbox');
        expect(r.headers['content-disposition']).toBe('attachment');
    });

    it('sends the guard headers on error responses too', async () =>
    {
        // Error bodies are just as navigable as success ones.
        const r = await app.inject({ method: 'GET', url: '/proxy?url=http://127.0.0.1/x' });
        expect(r.statusCode).toBe(403);
        expect(r.headers['x-content-type-options']).toBe('nosniff');
        expect(r.headers['content-security-policy']).toContain('sandbox');
    });

    it('413 when Content-Length exceeds the cap', async () =>
    {
        config.proxy.maxBytes = 100;
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ contentType: 'model/stl', contentLength: '999999' })));

        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent(`http://${PUBLIC}/big.stl`)}` });
        expect(r.statusCode).toBe(413);
    });

    it('413 when the streamed body exceeds the cap (no Content-Length)', async () =>
    {
        config.proxy.maxBytes = 4;
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ contentType: 'model/stl', bytes: new Uint8Array(50) })));

        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent(`http://${PUBLIC}/big.stl`)}` });
        expect(r.statusCode).toBe(413);
    });

    it('403 when a redirect points at a private address', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ status: 302, location: 'http://169.254.169.254/latest/meta-data' })));

        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent(`http://${PUBLIC}/redir`)}` });
        expect(r.statusCode).toBe(403);
    });

    it('propagates a 404 from upstream', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ status: 404 })));
        const r = await app.inject({ method: 'GET', url: `/proxy?url=${encodeURIComponent(`http://${PUBLIC}/missing`)}` });
        expect(r.statusCode).toBe(404);
    });
});

describe('GET /proxy — rate limiting', () =>
{
    it('429 after the per-IP limit is exceeded', async () =>
    {
        config.proxy.rateLimit = 2;
        config.proxy.rateWindowMs = 60_000;
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ contentType: 'text/plain', bytes: new Uint8Array([1]) })));

        const url = `/proxy?url=${encodeURIComponent(`http://${PUBLIC}/a`)}`;
        const codes = [
            (await app.inject({ method: 'GET', url })).statusCode,
            (await app.inject({ method: 'GET', url })).statusCode,
            (await app.inject({ method: 'GET', url })).statusCode,
        ];
        expect(codes[0]).toBe(200);
        expect(codes[1]).toBe(200);
        expect(codes[2]).toBe(429);
    });
});
