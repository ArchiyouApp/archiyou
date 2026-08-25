/**
 * ColladaWriter — a typed wrapper around the WebAssembly COLLADA (.dae) writer.
 *
 * Usage:
 *
 * ```ts
 * const writer = await createColladaWriter({ unitName: 'millimeter', meter: 0.001 });
 * try {
 *     writer.addMaterial('mat_0', 'Oak', 0.8, 0.6, 0.3, 1);
 *     writer.addPolylistGeometry('geom_0', 'Box', positions, normals, vcount);
 *     writer.beginNode('walls', 'walls');
 *         writer.beginNode('geom_0_node', 'Box');
 *         writer.attachGeometry('geom_0', 'mat_0');
 *         writer.endNode();
 *     writer.endNode();
 *     const dae = writer.toStringDae();
 * } finally {
 *     writer.free();
 * }
 * ```
 *
 * The document is built in two phases, matching COLLADA's own structure: geometries go into
 * a flat pool, while the nodes that reference them form a tree via beginNode/endNode.
 */

import { loadAsync } from './loader';
import type { ColladaWriter as RawColladaWriter } from './wasm/collada_wasm.js';

/** Which axis points up in the exported file. */
export type ColladaUpAxis = 'X_UP' | 'Y_UP' | 'Z_UP';

export interface ColladaWriterOptions
{
    /** COLLADA unit name, e.g. 'millimeter'. Default 'millimeter'. */
    unitName?: string;
    /** How many metres one model unit is; mm -> 0.001. Default 0.001. */
    meter?: number;
    /**
     * Default 'Z_UP'. meshup is natively Z-up and COLLADA can declare that, so unlike the
     * glTF export there is no axis remapping to do.
     */
    upAxis?: ColladaUpAxis;
    /** ISO-8601 timestamp for `<created>`/`<modified>`. Defaults to now. */
    created?: string;
}

/** Default weld tolerance in model units. 0 disables welding. */
export const DEFAULT_WELD_TOLERANCE = 1e-5;

/**
 * Id suffixes the writer derives from a geometry id (see `push_geometry` in src/lib.rs).
 *
 * Every COLLADA id is an `xs:ID` sharing one document-wide namespace, so a caller minting
 * geometry ids has to keep these derived names free as well: a shape called
 * `Mesh-positions` would otherwise claim the source id derived for a shape called `Mesh`.
 */
export const GEOMETRY_DERIVED_ID_SUFFIXES = [
    '-positions', '-positions-array', '-normals', '-normals-array', '-vertices',
] as const;

/** As above, for the effect id derived from a material id (see `add_material`). */
export const MATERIAL_DERIVED_ID_SUFFIXES = ['-effect'] as const;

/**
 * Thin TS facade over the wasm-bindgen class: typed options instead of positional
 * arguments, real `Error`s instead of thrown strings, and a `free()` that is safe to
 * call twice.
 */
export class ColladaWriter
{
    #raw: RawColladaWriter | null;

    constructor(raw: RawColladaWriter)
    {
        this.#raw = raw;
    }

    #inner(): RawColladaWriter
    {
        if (!this.#raw) { throw new Error('ColladaWriter: writer has already been freed'); }
        return this.#raw;
    }

    /** Register a material. `id` is what `attachGeometry()` references. RGBA components are 0..1. */
    addMaterial(id: string, name: string, r: number, g: number, b: number, a = 1): this
    {
        this.#inner().addMaterial(id, name, r, g, b, a);
        return this;
    }

    /**
     * N-gon faces -> `<polylist>`. `positions`/`normals` are per face-vertex (interleaved
     * xyz, in face order); `vcount[i]` is the vertex count of face i. Vertices are welded
     * on the Rust side, which also drops faces that welding leaves degenerate.
     *
     * Returns false when every face was degenerate, so no `<geometry>` exists to reference.
     */
    addPolylistGeometry(
        id: string, name: string,
        positions: Float32Array, normals: Float32Array, vcount: Uint32Array,
        weldTolerance = DEFAULT_WELD_TOLERANCE): boolean
    {
        return this.#inner().addPolylistGeometry(id, name, positions, normals, vcount, weldTolerance);
    }

    /**
     * Indexed triangles -> `<triangles>`. The fallback path when n-gons are not wanted.
     * Returns false when no triangle survived welding.
     */
    addMeshGeometry(
        id: string, name: string,
        positions: Float32Array, normals: Float32Array, indices: Uint32Array,
        weldTolerance = DEFAULT_WELD_TOLERANCE): boolean
    {
        return this.#inner().addMeshGeometry(id, name, positions, normals, indices, weldTolerance);
    }

    /**
     * A tessellated polyline -> `<lines>`, expanded into (n-1) segments.
     * Returns false when there were fewer than two points to join.
     */
    addLinesGeometry(id: string, name: string, positions: Float32Array): boolean
    {
        return this.#inner().addLinesGeometry(id, name, positions);
    }

    /** Open a `<node>`. Every beginNode() needs a matching endNode(). */
    beginNode(id: string, name: string): this
    {
        this.#inner().beginNode(id, name);
        return this;
    }

    /** Attach an `<instance_geometry>` to the open node, optionally bound to a material. */
    attachGeometry(geomId: string, materialId?: string | null): this
    {
        this.#inner().attachGeometry(geomId, materialId ?? undefined);
        return this;
    }

    /** Close the open `<node>`. */
    endNode(): this
    {
        this.#inner().endNode();
        return this;
    }

    /** Serialize to a COLLADA document. Throws if any node is left open. */
    toStringDae(): string
    {
        try
        {
            return this.#inner().toStringDae();
        }
        catch (e)
        {
            // The Rust side returns Result<String, String> (so the error path stays testable
            // under native `cargo test`), which wasm-bindgen throws as a bare string.
            throw (e instanceof Error) ? e : new Error(String(e));
        }
    }

    /** Release the underlying WASM memory. Safe to call more than once. */
    free(): void
    {
        this.#raw?.free();
        this.#raw = null;
    }
}

/** Load the WASM module (once) and start a new document. */
export async function createColladaWriter(options: ColladaWriterOptions = {}): Promise<ColladaWriter>
{
    const wasm = await loadAsync();
    const raw = new wasm.ColladaWriter(
        options.unitName ?? 'millimeter',
        options.meter ?? 0.001,
        options.upAxis ?? 'Z_UP',
        options.created ?? new Date().toISOString(),
    );
    return new ColladaWriter(raw);
}

/** Ensure the WASM module is loaded without creating a writer. */
export async function colladaReady(): Promise<void>
{
    await loadAsync();
}
