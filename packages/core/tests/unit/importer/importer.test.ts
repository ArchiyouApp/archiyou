/**
 * tests/unit/importer/importer.test.ts
 *
 * Core auto-mode Importer: proxy fetch (mocked), extension-independent format
 * detection, auto-center + auto-scale, GeoJSON metadata, scene attachment.
 * Uses the real openlayers / W3C fixtures under tests/fixtures/importer.
 */
import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { Importer, type AssetPayload } from '../../../src/importer/Importer';
import { initAsync, ShapeCollection } from '@archiyou/meshup';

beforeAll(async () => { await initAsync(); });

//// fixtures ////

const fx = (name: string): Uint8Array =>
    new Uint8Array(readFileSync(new URL(`../../fixtures/importer/${name}`, import.meta.url)));

const SVG_VENUS = fx('venus.svg');
const SVG_POI = fx('poi.svg');
const GEO_SWITZERLAND = fx('switzerland.geojson');
const GEO_VIENNA = fx('vienna-streets.geojson');

//// helpers ////

/** Minimal Response stand-in for the mocked global fetch. */
function fakeResponse(bytes: Uint8Array, contentType: string, init: { ok?: boolean; status?: number } = {}): any
{
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    };
}

function stubFetch(bytes: Uint8Array, contentType: string, init?: { ok?: boolean; status?: number }): void
{
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(bytes, contentType, init)));
}

/** A fake console + modeler for build(). modeler.group() returns a real
 *  (non-scene-backed) meshup ShapeCollection so add()/bbox()/scale() work; scene
 *  membership itself is covered by the Runner integration tests. */
function makeCtx()
{
    const messages: Array<{ level: string; msg: string }> = [];
    const con = {
        info: (m: string) => messages.push({ level: 'info', msg: m }),
        warn: (m: string) => messages.push({ level: 'warn', msg: m }),
        error: (m: string) => messages.push({ level: 'error', msg: m }),
        user: (m: string) => messages.push({ level: 'user', msg: m }),
    };
    const layers: any[] = [];
    const modeler = { group: () => { const c = new ShapeCollection(); layers.push(c); return c; } };
    return { con, modeler, messages, layers, ctx: { modeler, console: con } };
}

const payload = (bytes: Uint8Array, contentType: string, url: string): AssetPayload =>
    ({ url, bytes, contentType, warnings: [], fetchMs: 1 });

afterEach(() => { vi.unstubAllGlobals(); });

//// format detection ////

describe('Importer.detectFormat priority', () =>
{
    it('explicit opts.format wins over everything', () =>
    {
        const p = payload(GEO_SWITZERLAND, 'image/svg+xml', 'http://x/thing.svg');
        expect(Importer.detectFormat(p, { format: 'geojson' })).toBe('geojson');
    });

    it('uses the HTTP Content-Type for an extension-less URL', () =>
    {
        const p = payload(GEO_SWITZERLAND, 'application/geo+json', 'http://api.example.com/features?bbox=1,2,3,4');
        expect(Importer.detectFormat(p)).toBe('geojson');
    });

    it('falls back to content sniffing when Content-Type is generic', () =>
    {
        const p = payload(GEO_SWITZERLAND, 'text/plain', 'http://api.example.com/features');
        expect(Importer.detectFormat(p)).toBe('geojson');
    });

    it('falls back to the URL extension as a last resort', () =>
    {
        // Bytes that sniff to nothing, no Content-Type → extension decides.
        const p = payload(new Uint8Array([1, 2, 3, 4]), '', 'http://x/model.stl');
        expect(Importer.detectFormat(p)).toBe('stl');
    });
});

describe('Importer._scaleFactor', () =>
{
    it('fits tiny (degree-sized) models to a ~1000 scene', () =>
    {
        // vienna ≈ 0.03°, switzerland ≈ 4.4° → largest dimension becomes ~1000
        expect(0.03 * Importer._scaleFactor(0.03)).toBeCloseTo(1000, 3);
        expect(4.4 * Importer._scaleFactor(4.4)).toBeCloseTo(1000, 3);
    });
    it('fits huge models down to a ~1000 scene', () =>
    {
        expect(50000 * Importer._scaleFactor(50000)).toBeCloseTo(1000, 3);
    });
    it('leaves models already in range alone', () =>
    {
        expect(Importer._scaleFactor(250)).toBe(1);
        expect(Importer._scaleFactor(10)).toBe(1);
        expect(Importer._scaleFactor(10000)).toBe(1);
        expect(Importer._scaleFactor(0)).toBe(1);
    });
});

//// fetch ////

describe('Importer.fetch (proxied)', () =>
{
    it('fetches bytes + content-type via the proxy URL', async () =>
    {
        const spy = vi.fn(async () => fakeResponse(SVG_VENUS, 'image/svg+xml'));
        vi.stubGlobal('fetch', spy);

        const p = await Importer.fetch('https://host/venus.svg', { proxyUrl: 'https://api.test' });
        expect(spy).toHaveBeenCalledWith('https://api.test/proxy?url=https%3A%2F%2Fhost%2Fvenus.svg');
        expect(p.error).toBeUndefined();
        expect(p.contentType).toBe('image/svg+xml');
        expect(p.bytes.byteLength).toBe(SVG_VENUS.byteLength);
    });

    it('reports a non-ok upstream as payload.error (no throw)', async () =>
    {
        stubFetch(new TextEncoder().encode('{"error":"not found"}'), 'application/json', { ok: false, status: 404 });
        const p = await Importer.fetch('https://host/missing.svg', { proxyUrl: 'https://api.test' });
        expect(p.error).toContain('404');
    });

    it('reports a network failure as payload.error (no throw)', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
        const p = await Importer.fetch('https://host/x.svg', { proxyUrl: 'https://api.test' });
        expect(p.error).toContain('could not reach');
    });
});

//// build: SVG ////

describe('Importer.build (SVG)', () =>
{
    it('parses, centers on origin and returns a collection built via modeler.group()', () =>
    {
        const { ctx, layers } = makeCtx();
        const col = Importer.build(payload(SVG_VENUS, 'image/svg+xml', 'http://x/venus.svg'), {}, ctx);

        const shapes = (col as any).toArray();
        expect(shapes.length).toBeGreaterThan(0);
        expect(layers.length).toBe(1);        // one dedicated layer/collection created
        expect(col).toBe(layers[0]);          // the returned collection is that layer

        const c = (col as any).bbox().center();
        expect(Math.abs(c.x)).toBeLessThan(1e-6);
        expect(Math.abs(c.y)).toBeLessThan(1e-6);
    });

    it('imports poi.svg (previously failed with "elliptical arc by") via $import', () =>
    {
        const { ctx } = makeCtx();
        // The exact file the user reported. Its circular arcs now import as native arcs.
        const col = Importer.build(payload(SVG_POI, 'image/svg+xml', 'https://dev.w3.org/.../poi.svg'), {}, ctx);
        const shapes = (col as any).toArray();
        expect(shapes.length).toBeGreaterThan(0);
        expect(shapes.some((s: any) => s.inner?.().hasArcs?.() === true)).toBe(true);
    });

    it('reports an unknown-format payload as a console error', () =>
    {
        const { ctx, messages } = makeCtx();
        const col = Importer.build(payload(new Uint8Array([9, 9, 9]), '', 'http://x/mystery'), {}, ctx);
        expect((col as any).toArray().length).toBe(0);
        expect(messages.some(m => m.level === 'error' && /could not determine/.test(m.msg))).toBe(true);
    });

    it('surfaces a fetch error on the console and returns empty', () =>
    {
        const { ctx, messages } = makeCtx();
        const p: AssetPayload = { url: 'http://x/a.svg', bytes: new Uint8Array(), contentType: '', warnings: [], fetchMs: 1, error: 'boom 500' };
        const col = Importer.build(p, {}, ctx);
        expect((col as any).toArray().length).toBe(0);
        expect(messages.some(m => m.level === 'error' && m.msg === 'boom 500')).toBe(true);
    });
});

//// build: GeoJSON (auto-scale + metadata) ////

describe('Importer.build (GeoJSON)', () =>
{
    it('auto-scales degree-sized coordinates to a ~1000 scene and warns', () =>
    {
        const { ctx, messages } = makeCtx();
        const col = Importer.build(payload(GEO_SWITZERLAND, 'application/geo+json', 'http://x/switzerland'), {}, ctx);

        const max = (col as any).bbox().maxSize();
        expect(max).toBeCloseTo(Importer.SCALE_TARGET, 0); // was ~4.4°, fitted to ~1000
        expect(messages.some(m => m.level === 'warn' && /auto-scaled ×/.test(m.msg))).toBe(true);
        expect(messages.some(m => m.level === 'warn' && /not a georeferenced projection/.test(m.msg))).toBe(true);
    });

    it('carries feature properties onto shape.metadata', () =>
    {
        const { ctx } = makeCtx();
        const col = Importer.build(payload(GEO_VIENNA, 'application/geo+json', 'http://x/vienna'), {}, ctx);
        const shapes = (col as any).toArray();
        expect(shapes.length).toBeGreaterThan(0);
        // At least one street carries an OSM 'highway' tag in its metadata.
        expect(shapes.some((s: any) => s.metadata && 'highway' in s.metadata)).toBe(true);
    });

    it('honours { autoScale:false, center:false }', () =>
    {
        const { ctx, messages } = makeCtx();
        const col = Importer.build(payload(GEO_SWITZERLAND, 'application/geo+json', 'http://x/s'),
            { autoScale: false, center: false }, ctx);
        const max = (col as any).bbox().maxSize();
        expect(max).toBeLessThan(10); // untouched, still degree-sized
        expect(messages.some(m => /auto-scaled/.test(m.msg))).toBe(false);
    });
});
