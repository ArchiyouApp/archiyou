/* tslint:disable */
/* eslint-disable */

/**
 * Builds one COLLADA document. See the module docs for the two-phase usage.
 */
export class ColladaWriter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A tessellated polyline -> `<lines>`. `positions` is a flat xyz point run; it is
     * expanded into (n-1) two-index segments.
     *
     * Returns false when there was no polyline to write and no `<geometry>` was emitted.
     */
    addLinesGeometry(id: string, name: string, positions: Float32Array): boolean;
    /**
     * Register a material. `id` is what `attach_geometry()` references. RGBA is 0..1.
     */
    addMaterial(id: string, name: string, r: number, g: number, b: number, a: number): void;
    /**
     * Raw indexed triangles -> `<triangles>`. The `ngons: false` fallback path, fed
     * straight from meshup's `Mesh.toBuffer()`.
     *
     * Returns false when nothing survived and no `<geometry>` was emitted.
     */
    addMeshGeometry(id: string, name: string, positions: Float32Array, normals: Float32Array, indices: Uint32Array, weld_tolerance: number): boolean;
    /**
     * N-gon faces -> `<polylist>`. `positions`/`normals` are per face-vertex (interleaved
     * xyz, unwelded, in face order); `vcount[i]` is the vertex count of face i.
     *
     * This is the default mesh path: it preserves meshup's n-gon topology, where
     * `Mesh.toBuffer()` would have flattened it into a triangle soup.
     *
     * Returns false when nothing survived and no `<geometry>` was emitted, so the caller
     * knows not to reference it.
     */
    addPolylistGeometry(id: string, name: string, positions: Float32Array, normals: Float32Array, vcount: Uint32Array, weld_tolerance: number): boolean;
    /**
     * Attach an `<instance_geometry>` (optionally material-bound) to the open node.
     */
    attachGeometry(geom_id: string, material_id?: string | null): void;
    /**
     * Open a `<node>`. Nodes nest: every `begin_node` must be matched by an `end_node`.
     */
    beginNode(id: string, name: string): void;
    /**
     * Close the open `<node>`, appending it to its parent (or to the scene roots).
     */
    endNode(): void;
    /**
     * `unit_name` is the COLLADA unit name (e.g. "millimeter"), `meter` how many metres one
     * model unit is (mm -> 0.001). `up_axis` is one of "X_UP" / "Y_UP" / "Z_UP" — Archiyou
     * passes "Z_UP", since meshup is natively Z-up and COLLADA can say so (unlike glTF).
     * `created_iso` is an ISO-8601 timestamp; the caller supplies it so this crate needs no
     * clock (and therefore no chrono).
     */
    constructor(unit_name: string, meter: number, up_axis: string, created_iso: string);
    /**
     * Serialize the document. Errors on unbalanced `begin_node`/`end_node`.
     *
     * The error is a plain `String` rather than a `JsError` so this stays callable from
     * native `cargo test` — constructing a `JsError` panics off-wasm. `ColladaWriter.ts`
     * turns it back into a real `Error` on the JS side.
     */
    toStringDae(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_colladawriter_free: (a: number, b: number) => void;
    readonly colladawriter_addLinesGeometry: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly colladawriter_addMaterial: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly colladawriter_addMeshGeometry: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly colladawriter_addPolylistGeometry: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly colladawriter_attachGeometry: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly colladawriter_beginNode: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly colladawriter_endNode: (a: number) => void;
    readonly colladawriter_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly colladawriter_toStringDae: (a: number) => [number, number, number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
