/**
 * scad.render.ts — render an exported .scad part with real OpenSCAD and compare it with the Archiyou shape.
 *
 * Uses the OpenSCAD WASM build (`openscad-wasm-prebuilt`, OpenSCAD 2025.01.19). It is GPL-2.0-or-later
 * and a devDependency only: it never reaches the published bundle. Shared by scad.roundtrip.test.ts and
 * the corpus round trip in tests/cadscripts.
 *
 * An Emscripten module runs `main` once, so every render gets a fresh instance.
 */

import { createOpenSCAD } from 'openscad-wasm-prebuilt'

export type V3 = [number, number, number]
export type SCADBackend = 'CGAL' | 'Manifold'

export interface RenderedPart
{
    /** Rendered to a non-empty STL without an error */
    ok: boolean
    volume: number
    min: V3
    max: V3
    triangles: number
    warnings: string[]
    errors: string[]
    ms: number
}

/** Render one module of a file (selected with -D PART="module") to binary STL and measure it */
export async function renderPart(text: string, part: string, backend: SCADBackend = 'Manifold'): Promise<RenderedPart>
{
    const started = performance.now()
    const log: string[] = []
    const openscad = (await createOpenSCAD({ print: (t: string) => log.push(t), printErr: (t: string) => log.push(t) })).getInstance()
    openscad.FS.writeFile('/part.scad', text)
    let exit: unknown = 0
    try { exit = openscad.callMain(['/part.scad', '-D', `PART="${part}"`, '--backend', backend, '--export-format', 'binstl', '-o', '/part.stl']) }
    catch (e) { exit = e }
    let stl: Uint8Array | null = null
    try { stl = openscad.FS.readFile('/part.stl') as Uint8Array } catch { /* no output */ }
    const stats = stl ? stlStats(stl) : null
    // "ERROR:" and "WARNING:" as OpenSCAD prints them (Manifold also logs "Status: NoError")
    const errors = log.filter(l => /\bERROR:/.test(l))
    const warnings = log.filter(l => /\bWARNING:/.test(l))
    return {
        ok: exit === 0 && !!stats && stats.triangles > 0 && errors.length === 0,
        volume: stats?.volume ?? 0,
        min: stats?.min ?? [0, 0, 0],
        max: stats?.max ?? [0, 0, 0],
        triangles: stats?.triangles ?? 0,
        warnings, errors,
        ms: Math.round(performance.now() - started),
    }
}

/** Volume (from the triangles' signed tetrahedra), bounds and triangle count of a binary STL */
export function stlStats(stl: Uint8Array): { volume: number; min: V3; max: V3; triangles: number }
{
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
    const count = stl.byteLength >= 84 ? view.getUint32(80, true) : 0
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity]
    let volume6 = 0
    for (let t = 0; t < count; t++)
    {
        const base = 84 + t * 50 + 12
        if (base + 36 > stl.byteLength) break
        const p = (k: number): V3 => [view.getFloat32(base + 12 * k, true), view.getFloat32(base + 12 * k + 4, true), view.getFloat32(base + 12 * k + 8, true)]
        const [a, b, c] = [p(0), p(1), p(2)]
        volume6 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
        for (const q of [a, b, c]) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], q[i]); max[i] = Math.max(max[i], q[i]) }
    }
    return { volume: volume6 / 6, min, max, triangles: count }
}

export interface PartComparison
{
    match: boolean
    /** |rendered − model| / model volume */
    volumeError: number
    /** Largest difference of any bounds coordinate, in model units */
    boundsError: number
    detail: string
}

/** Rendered part against the Archiyou shape: same volume and the same bounds, within tolerances.
 *  `volumeTolerance` is relative; the bounds tolerance is relative to the shape's size, with a floor for
 *  the STL's 32-bit floats. */
export function compareWithShape(rendered: RenderedPart, shape: any, volumeTolerance = 1e-5, boundsTolerance = 1e-5): PartComparison
{
    const volume = Math.abs(shape.volume?.() ?? 0)
    const b = shape.bbox?.()
    const min: V3 = b ? [b.min().x, b.min().y, b.min().z] : [0, 0, 0]
    const max: V3 = b ? [b.max().x, b.max().y, b.max().z] : [0, 0, 0]
    const span = Math.max(1, ...[0, 1, 2].map(i => max[i] - min[i]))
    const volumeError = volume > 0 ? Math.abs(rendered.volume - volume) / volume : Math.abs(rendered.volume)
    const boundsError = Math.max(...[0, 1, 2].flatMap(i => [Math.abs(rendered.min[i] - min[i]), Math.abs(rendered.max[i] - max[i])]))
    // STL coordinates are 32-bit floats: about 1e-7 relative, so 1e-3 covers models up to kilometres in mm
    const boundsLimit = Math.max(boundsTolerance * span, 1e-3)
    const match = rendered.ok && volumeError <= volumeTolerance && boundsError <= boundsLimit
    const f = (n: number) => Number(n.toPrecision(6))
    const detail = !rendered.ok
        ? `did not render: ${[...rendered.errors, `${rendered.triangles} triangles`].join('; ')}`
        : `volume ${f(rendered.volume)} vs ${f(volume)} (${f(volumeError)}), bounds off by ${f(boundsError)}`
    return { match, volumeError, boundsError, detail }
}
