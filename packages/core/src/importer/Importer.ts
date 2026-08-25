/**
 *  importer/Importer.ts — the auto-mode asset importer behind `$import()`.
 *
 *  meshup's `Importer` (packages/meshup) does the actual parsing (SVG/GeoJSON/DXF →
 *  curves, STL/OBJ/glTF/AMF/3MF → mesh) synchronously from already-fetched bytes.
 *  This core wrapper adds the app-level concerns the editor needs:
 *
 *    - FETCH through the backend asset proxy (browser CORS workaround).
 *    - DETECT the format without relying on a file extension (Content-Type →
 *      content sniffing → extension), so extension-less API responses work.
 *    - AUTO-CENTER on the origin and AUTO-SCALE by powers of ten into a workable
 *      size range, with verbose warnings on the Archiyou console.
 *    - ATTACH the result to the modeler scene so it renders like any shape.
 *
 *  Fetch is async (done up-front by Runner._prefetchImportAssets); building is
 *  synchronous so the scope-level `$import(url)` needs no `await`.
 */

import { Importer as MeshupImporter, ShapeCollection } from '@archiyou/meshup';
import type { ImportFormat } from '@archiyou/meshup';

import { assetProxyUrlFor } from '../utils';

export interface AssetImportOptions
{
    /** Force a format instead of auto-detecting. */
    format?: ImportFormat;
    /** Center the result on the origin (default true). */
    center?: boolean;
    /** Rescale by powers of ten into a workable range (default true). */
    autoScale?: boolean;
}

/** The raw result of fetching an asset — cached by Runner and handed to build(). */
export interface AssetPayload
{
    url: string;
    bytes: Uint8Array;
    contentType: string;
    /** Non-fatal notes gathered during fetch, flushed to the console at build time. */
    warnings: string[];
    fetchMs: number;
    /** Set when the fetch failed outright; build() reports it and returns empty. */
    error?: string;
}

/** Host-provided handles used while building (scene attachment + user warnings). */
export interface ImportContext
{
    modeler: any;   // core Modeler (has addToScene)
    console: any;   // Archiyou Console (user/warn/info/error)
}

/** MIME → meshup format. Covers the common asset content-types. */
const MIME_TO_FORMAT: Record<string, ImportFormat> = {
    'image/svg+xml': 'svg',
    'application/geo+json': 'geojson',
    'application/vnd.geo+json': 'geojson',
    'model/gltf-binary': 'glb',
    'model/gltf+json': 'gltf',
    'model/stl': 'stl',
    'application/sla': 'stl',
    'application/vnd.ms-pki.stl': 'stl',
    'model/obj': 'obj',
    'text/plain; charset=obj': 'obj',
    'application/dxf': 'dxf',
    'image/vnd.dxf': 'dxf',
    'application/x-amf': 'amf',
    'model/3mf': '3mf',
    'application/vnd.ms-package.3dmanufacturing-3dmodel+xml': '3mf',
};

const EXT_TO_FORMAT: Record<string, ImportFormat> = {
    svg: 'svg', geojson: 'geojson', json: 'geojson', dxf: 'dxf',
    stl: 'stl', obj: 'obj', ply: 'ply', amf: 'amf', '3mf': '3mf',
    gltf: 'gltf', glb: 'glb',
};

export class Importer
{
    /** Warn when the upstream fetch takes longer than this (ms). */
    static SLOW_MS = 1000;
    /** When an import is out of range it is scaled so its largest dimension becomes
     *  ~this (a ~1000×1000 scene). */
    static SCALE_TARGET = 1000;
    /** Only auto-scale when the largest dimension falls outside [SCALE_MIN, SCALE_MAX];
     *  models already in this band are left at their original size. */
    static SCALE_MIN = 10;
    static SCALE_MAX = 10_000;

    /** Proxy URL for a remote asset. `${base}/proxy?url=<encoded>`; base '' → root-relative.
     *  Shared with the docs Image loader — see assetProxyUrlFor(). */
    static proxyUrlFor(url: string, proxyBase = ''): string
    {
        return assetProxyUrlFor(url, proxyBase);
    }

    /** Fetch an asset through the proxy. Never throws — failures come back on
     *  `payload.error` so the sync build path can report them cleanly. */
    static async fetch(url: string, opts: { proxyUrl?: string } = {}): Promise<AssetPayload>
    {
        const warnings: string[] = [];
        const started = Date.now();
        const proxied = Importer.proxyUrlFor(url, opts.proxyUrl ?? '');

        try
        {
            const res = await fetch(proxied);
            const fetchMs = Date.now() - started;

            if(!res.ok)
            {
                let detail = '';
                try { detail = ((await res.json()) as any)?.error ?? ''; } catch { /* non-JSON body */ }
                return {
                    url, bytes: new Uint8Array(), contentType: '', warnings, fetchMs,
                    error: `$import('${url}'): fetch failed (${res.status}${detail ? ` — ${detail}` : ''}).`,
                };
            }

            if(fetchMs > Importer.SLOW_MS)
            {
                warnings.push(`$import('${url}'): slow response (${fetchMs}ms).`);
            }

            const bytes = new Uint8Array(await res.arrayBuffer());
            const contentType = res.headers.get('content-type') ?? '';
            if(bytes.byteLength === 0)
            {
                warnings.push(`$import('${url}'): the source returned an empty response.`);
            }
            return { url, bytes, contentType, warnings, fetchMs };
        }
        catch(e)
        {
            return {
                url, bytes: new Uint8Array(), contentType: '', warnings,
                fetchMs: Date.now() - started,
                error: `$import('${url}'): could not reach the asset proxy (${(e as Error)?.message ?? e}).`,
            };
        }
    }

    /** Turn a fetched payload into a scene-attached ShapeCollection. Synchronous.
     *  All fetch/parse/scale warnings are flushed to `ctx.console` here. */
    static build(payload: AssetPayload, opts: AssetImportOptions, ctx: ImportContext): ShapeCollection
    {
        const con = ctx?.console;
        payload.warnings.forEach(w => con?.warn?.(w));

        if(payload.error)
        {
            con?.error?.(payload.error);
            return Importer._empty();
        }

        const format = Importer.detectFormat(payload, opts);
        if(!format)
        {
            con?.error?.(
                `$import('${payload.url}'): could not determine the file format. ` +
                `Pass a format, e.g. $import('${payload.url}', { format: 'stl' }). ` +
                `Supported: svg, geojson, dxf, stl, obj, gltf, glb, amf, 3mf.`);
            return Importer._empty();
        }

        let collection: ShapeCollection;
        try
        {
            // up:'y' — assets fetched by $import() come from other tools (Blender,
            // three.js, model libraries), which write conforming Y-up glTF. meshup's
            // importer defaults to 'z' instead, because that is what meshup itself
            // *writes* (the Archiyou stack keeps the kernel's Z-up all the way to a Z-up
            // viewer) and its round trip has to be the identity. Nothing in a glTF says
            // which convention it used, so the two callers have to differ. Only glTF
            // reads this; every other format ignores it.
            collection = MeshupImporter.load(payload.bytes, { format, up: 'y' });
        }
        catch(e)
        {
            con?.error?.(`$import('${payload.url}'): could not parse ${format.toUpperCase()} — ${(e as Error)?.message ?? e}`);
            return Importer._empty();
        }

        const parsedShapes = (collection as any).toArray();
        const count = parsedShapes.length;
        if(count === 0)
        {
            con?.warn?.(`$import('${payload.url}'): parsed ${format.toUpperCase()} but found no geometry.`);
            return collection;
        }

        // Put the whole import under its own scene-backed layer so it is easy to
        // manage as one unit (hide/move/name). modeler.group() creates a new layer
        // parented at the active layer and moves the shapes into it; naming the returned
        // collection (the Runner auto-names it after the assigned variable) renames the
        // layer too. (collection() would only reference the shapes, leaving them loose.)
        // Fall back to the raw parsed collection when no scene-backed modeler is present.
        let result: ShapeCollection = collection;
        if(typeof ctx?.modeler?.group === 'function')
        {
            try
            {
                result = ctx.modeler.group();
                (result as any).add(parsedShapes);
            }
            catch(e)
            {
                con?.warn?.(`$import('${payload.url}'): could not create a layer — ${(e as Error)?.message ?? e}`);
                result = collection;
            }
        }

        Importer._centerAndScale(result, format, opts, con);

        con?.info?.(`$import('${payload.url}'): loaded ${count} ${format.toUpperCase()} shape(s) into a new layer.`);
        return result;
    }

    /** Center on the origin and rescale by powers of ten, warning on the console. */
    private static _centerAndScale(collection: ShapeCollection, format: ImportFormat, opts: AssetImportOptions, con: any): void
    {
        const center = opts.center !== false;
        const autoScale = opts.autoScale !== false;

        const bb = (collection as any).bbox?.();
        if(!bb) return;

        const bbCenter = bb.center();

        if(center)
        {
            (collection as any).moveTo(0, 0, 0);
        }

        if(autoScale)
        {
            const maxDim: number = bb.maxSize();
            const factor = Importer._scaleFactor(maxDim);
            if(factor !== 1)
            {
                // Centered → scale about the origin; otherwise about the bbox center so it stays put.
                const origin = center ? { x: 0, y: 0, z: 0 } : bbCenter;
                (collection as any).scale(factor, origin);
                con?.warn?.(
                    `$import: auto-scaled ×${Importer._fmtFactor(factor)} to fit a ~${Importer.SCALE_TARGET} scene ` +
                    `(source max dimension was ${Importer._round(maxDim)}). Set { autoScale: false } to keep the original size.`);
                if(format === 'geojson')
                {
                    con?.warn?.(
                        `$import: GeoJSON coordinates are raw lon/lat degrees — the result is a crude ` +
                        `visibility fit, not a georeferenced projection.`);
                }
            }
        }
    }

    /** Factor that fits `maxDim` to SCALE_TARGET (~1000-unit scene) when it is
     *  outside [SCALE_MIN, SCALE_MAX]; otherwise 1 (leave in-range models alone). */
    static _scaleFactor(maxDim: number): number
    {
        if(!(maxDim > 0)) return 1;
        if(maxDim >= Importer.SCALE_MIN && maxDim <= Importer.SCALE_MAX) return 1;
        return Importer.SCALE_TARGET / maxDim;
    }

    /** Detection priority: explicit opts.format → Content-Type → content sniff → extension. */
    static detectFormat(payload: AssetPayload, opts: AssetImportOptions = {}): ImportFormat | undefined
    {
        if(opts.format) return opts.format;
        return Importer.mimeToFormat(payload.contentType)
            ?? MeshupImporter.detectFormat(payload.bytes)
            ?? Importer.formatFromExtension(payload.url);
    }

    /** Map an HTTP Content-Type to a meshup format (ignores charset/params). */
    static mimeToFormat(contentType: string): ImportFormat | undefined
    {
        if(!contentType) return undefined;
        const mime = contentType.split(';')[0].trim().toLowerCase();
        return MIME_TO_FORMAT[mime];
    }

    /** Last-resort format guess from a URL's file extension. */
    static formatFromExtension(url: string): ImportFormat | undefined
    {
        try
        {
            const path = new URL(url, 'http://x').pathname;
            const ext = path.split('.').pop()?.toLowerCase() ?? '';
            return EXT_TO_FORMAT[ext];
        }
        catch { return undefined; }
    }

    private static _empty(): ShapeCollection
    {
        return new ShapeCollection();
    }

    private static _round(n: number): number
    {
        return Math.round(n * 1000) / 1000;
    }

    /** Human-readable scale factor: whole numbers when large, 2 sig figs when < 1. */
    private static _fmtFactor(f: number): string
    {
        return f >= 1 ? String(Math.round(f)) : String(Number(f.toPrecision(2)));
    }
}
