/**
 * kernel.parity.test.ts — does a whole cadscript model the same thing on both kernels?
 *
 * Every script in tests/cadscripts/scripts runs twice, on mesh (the default kernel, so the
 * reference) and on brep. After each run the scene is walked and every shape is recorded by its
 * scene path with its kernel-neutral family (Mesh ↔ Solid, Curve ↔ Edge/Wire, Polygon ↔ Face,
 * Vertex) and its bounding box. Shapes are then matched across the two runs — by normalised path
 * first, by creation order (sid) for what is left — and each matched pair's bbox is compared with
 * the tolerance formula from tests/unit/modeler/kernels/parity-measure.ts. Solids also compare
 * volume.
 *
 * The result is a table, snapshotted in kernel.parity.txt (refresh with `vitest -u`): per script
 * the brep status, how many shapes matched, how many bboxes are off, how many shapes exist on one
 * kernel only, and the first divergence. A kernel fix shows up as a readable diff of that file.
 * The floor tests below pin what already works so it cannot silently regress.
 *
 * Why not compare names literally: a shape that was never named is labelled by the kernel type
 * that made it ('Mesh:Box' on mesh, 'Solid:Box' on brep), so the label is normalised to the
 * family. Everything else in the path — layers, groups, explicit names, sibling indexes — has to
 * agree, because a script reads its own scene by those.
 */

import fs from 'node:fs'
import { describe, it, expect, beforeAll } from 'vitest'

import { Runner } from '../../src/runner/Runner'
import { EXACT, TESSELATED, familyOf, familyOfTypeLabel, mismatches, round,
    type Family, type Mismatch } from '../../tests/unit/modeler/kernels/parity-measure'

//// SETTINGS ////

const ONLY = process.env.CADSCRIPT // run a single script by filename (without .js)
const SCRIPTS = fs.readdirSync('./tests/cadscripts/scripts')
                  .filter(f => f.endsWith('.js'))
                  .filter(f => !ONLY || f === ONLY || f === `${ONLY}.js`)
                  .sort()

/** Per-run wall-clock ceiling: a hung kernel must not take the whole table down. */
const RUN_TIMEOUT_MS = 60_000

//// RECORDING A SCENE ////

interface Recorded
{
    path: string          // decoded scene path, e.g. Scene/legs/leg long[0]
    key: string           // the path with kernel type labels normalised to a family
    sid: number
    type: string
    family: Family
    hidden: boolean
    shape: any
}

/** Normalise one path segment: 'Mesh:Box' → 'solid:Box', 'Curve:Line' → 'linear:Line', and
 *  the meshup row/grid suffix `name1` ↔ brep's sibling index `name[0]` (see divergence 19). */
function normaliseSegment(segment: string): string
{
    const typed = /^([A-Z][a-zA-Z]+)(:.*)?$/.exec(segment)
    if (typed)
    {
        const family = familyOfTypeLabel(typed[1])
        if (family) return `${family}${typed[2] ?? ''}`
    }
    const rowSuffix = /^(.*\D)(\d+)$/.exec(segment)
    if (rowSuffix) return `${rowSuffix[1]}[${Number(rowSuffix[2]) - 1}]`
    return segment
}

function record(scene: any): Array<Recorded>
{
    const out: Array<Recorded> = []
    const walk = (node: any, hidden: boolean) =>
    {
        const isHidden = hidden || node.style?.visible === false
        const shape = node.shape?.()
        if (shape)
        {
            const path = decodeURIComponent(node.path())
            out.push({
                path,
                key: path.split('/').map(normaliseSegment).join('/'),
                sid: Number(shape.sid?.() ?? shape._sid ?? 0),
                type: String(shape.type),
                family: familyOf(shape),
                hidden: isHidden || shape.style?.visible === false,
                shape,
            })
        }
        node.children?.().forEach((child: any) => walk(child, isHidden))
    }
    walk(scene, false)
    return out
}

//// RUNNING ////

interface Run
{
    status: 'success' | 'error' | 'threw'
    error?: string
    ms: number
    shapes: Array<Recorded>
}

/** The `- error:` line of the Runner's banner, on one line, or the first line of whatever it is. */
function errorLine(raw: unknown): string
{
    const text = String((raw as any)?.message ?? raw ?? '')
    const line = /^- error:\s*'?([\s\S]*?)'?\s*$/m.exec(text)?.[1] ?? text.split('\n').find(l => l.trim()) ?? ''
    return line.replace(/\s+/g, ' ').trim().slice(0, 110)
}

/** A small seeded PRNG (mulberry32), so a script that places things with Math.random()
 *  (urhousesketch's windows) draws the same numbers on both kernels — and on every run, so
 *  the table stays a snapshot. Installed for the duration of one script run. */
function seededRandom(seed: number): () => number
{
    let a = seed >>> 0
    return () =>
    {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

async function run(runner: Runner, name: string, code: string, kernel: 'mesh' | 'brep'): Promise<Run>
{
    const started = performance.now()
    const realRandom = Math.random
    Math.random = seededRandom(1234)
    try
    {
        const result: any = await Promise.race([
            runner.execute({ kernel, script: { name, code, params: {} }, outputs: ['default/model/glb'], messages: ['error'] } as any),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${RUN_TIMEOUT_MS}ms`)), RUN_TIMEOUT_MS)),
        ])
        const shapes = record(runner.getScope('default').modeler.scene())
        return {
            status: result.status === 'success' ? 'success' : 'error',
            error: result.status === 'success' ? undefined : errorLine(result.errors?.[0]),
            ms: Math.round(performance.now() - started),
            shapes,
        }
    }
    catch (e: any)
    {
        return { status: 'threw', error: errorLine(e), ms: Math.round(performance.now() - started), shapes: [] }
    }
    finally { Math.random = realRandom }
}

//// COMPARING ////

interface Pair { mesh: Recorded, brep: Recorded, off: Array<Mismatch>, familyMismatch: boolean }

interface Row
{
    script: string
    mesh: Run
    brep: Run
    pairs: Array<Pair>
    onlyMesh: Array<Recorded>
    onlyBrep: Array<Recorded>
}

/** A solid whose brep side has any non-planar face went through meshup's tessellation. */
function toleranceFor(pair: { mesh: Recorded, brep: Recorded }): number
{
    if (pair.mesh.family === 'point') return EXACT
    try
    {
        const brep = pair.brep.shape
        const curved = brep.faces?.().toArray?.().some((f: any) => f.surfaceType?.() !== 'Plane' && !f.isPlanar?.())
            ?? brep.edges?.().toArray?.().some((e: any) => e.edgeType?.() !== 'Line')
        return curved ? TESSELATED : EXACT
    }
    catch { return TESSELATED }
}

function matchUp(mesh: Array<Recorded>, brep: Array<Recorded>): Pick<Row, 'pairs' | 'onlyMesh' | 'onlyBrep'>
{
    const pairs: Array<Pair> = []
    const brepLeft = [...brep]

    const take = (predicate: (b: Recorded) => boolean): Recorded | undefined =>
    {
        const i = brepLeft.findIndex(predicate)
        return (i === -1) ? undefined : brepLeft.splice(i, 1)[0]
    }
    const compare = (m: Recorded, b: Recorded): Pair => ({
        mesh: m, brep: b,
        familyMismatch: m.family !== b.family,
        off: (m.family === b.family)
            ? mismatches(m.shape, b.shape, toleranceFor({ mesh: m, brep: b }), m.family, { bboxOnly: m.family !== 'solid' })
                .filter(x => x.key.startsWith('bbox.') || x.key === 'volume')
            : [],
    })

    // 1. same normalised path
    const meshLeft = mesh.filter(m =>
    {
        const b = take(x => x.key === m.key)
        if (b) pairs.push(compare(m, b))
        return !b
    })
    // 2. what is left in the same layer, of the same family, paired in creation order — a
    //    shape that lost its name on one kernel (brep ops that rebuild the shape used to drop
    //    it) is still the n-th unnamed solid of that layer. sid itself is not comparable
    //    across kernels: brep hands a fresh sid to every rebuilt shape.
    const parent = (r: Recorded) => r.key.slice(0, r.key.lastIndexOf('/'))
    const onlyMesh: Array<Recorded> = []
    const byGroup = new Map<string, Array<Recorded>>()
    meshLeft.forEach(m =>
    {
        const g = `${parent(m)}|${m.family}`
        byGroup.set(g, [...(byGroup.get(g) ?? []), m])
    })
    byGroup.forEach((meshes, g) =>
    {
        const breps = brepLeft.filter(b => `${parent(b)}|${b.family}` === g).sort((a, b) => a.sid - b.sid)
        meshes.sort((a, b) => a.sid - b.sid).forEach((m, i) =>
        {
            const b = breps[i]
            if (b) { pairs.push(compare(m, b)); brepLeft.splice(brepLeft.indexOf(b), 1) }
            else onlyMesh.push(m)
        })
    })

    pairs.sort((a, b) => a.mesh.sid - b.mesh.sid)
    return { pairs, onlyMesh, onlyBrep: brepLeft }
}

//// THE TABLE ////

const pad = (s: string | number, n: number) => String(s).padEnd(n)
const num = (n: number, w = 4) => String(n).padStart(w)

function bboxOf(r: Recorded): string
{
    try
    {
        const b = r.shape.bbox()
        return `[${[b.min().x, b.min().y, b.min().z, b.max().x, b.max().y, b.max().z].map(round).join(',')}]`
    }
    catch { return '[?]' }
}

function table(rows: Array<Row>): string
{
    const lines: Array<string> = []
    lines.push(`${pad('script', 20)} ${pad('brep', 8)} ${num('mesh')} ${num('brep')} ${num('match', 5)} ${num('ok', 4)} ${num('off', 4)} ${num('only m', 6)} ${num('only b', 6)}  first divergence`)
    rows.forEach(r =>
    {
        const off = r.pairs.filter(p => p.off.length || p.familyMismatch)
        const first = off[0]
        const firstText = !first ? ''
            : first.familyMismatch ? `${first.mesh.path}: ${first.mesh.type} on mesh, ${first.brep.type} on brep`
            : `${first.mesh.path}: ${first.off[0].key} mesh=${round(first.off[0].mesh)} brep=${round(first.off[0].brep)}`
        lines.push(`${pad(r.script, 20)} ${pad(r.brep.status, 8)} ${num(r.mesh.shapes.length)} ${num(r.brep.shapes.length)} ${num(r.pairs.length, 5)} ${num(r.pairs.length - off.length, 4)} ${num(off.length, 4)} ${num(r.onlyMesh.length, 6)} ${num(r.onlyBrep.length, 6)}  ${firstText}`)
        if (r.brep.status !== 'success') lines.push(`${' '.repeat(29)}brep: ${r.brep.error}`)
        if (r.mesh.status !== 'success') lines.push(`${' '.repeat(29)}MESH FAILED: ${r.mesh.error}`)
        off.slice(1, 4).forEach(p => lines.push(`${' '.repeat(29)}off: ${p.mesh.path} mesh=${bboxOf(p.mesh)} brep=${bboxOf(p.brep)} (${p.familyMismatch ? 'family' : p.off.map(o => o.key).join(',')})`))
        if (off.length > 4) lines.push(`${' '.repeat(29)}… ${off.length - 4} more off`)
        r.onlyMesh.slice(0, 3).forEach(m => lines.push(`${' '.repeat(29)}only mesh: ${m.path} [${m.type}]`))
        if (r.onlyMesh.length > 3) lines.push(`${' '.repeat(29)}… ${r.onlyMesh.length - 3} more only on mesh`)
        r.onlyBrep.slice(0, 3).forEach(b => lines.push(`${' '.repeat(29)}only brep: ${b.path} [${b.type}]`))
        if (r.onlyBrep.length > 3) lines.push(`${' '.repeat(29)}… ${r.onlyBrep.length - 3} more only on brep`)
    })

    const ok = rows.filter(r => r.brep.status === 'success').length
    const pairs = rows.reduce((a, r) => a + r.pairs.length, 0)
    const off = rows.reduce((a, r) => a + r.pairs.filter(p => p.off.length || p.familyMismatch).length, 0)
    const lonely = rows.reduce((a, r) => a + r.onlyMesh.length + r.onlyBrep.length, 0)
    lines.push('')
    lines.push(`corpus: ${ok}/${rows.length} scripts run on brep, ${pairs} shapes matched, ${off} off, ${lonely} on one kernel only`)
    lines.push('')
    return lines.join('\n')
}

//// SUITE ////

describe('mesh ↔ brep parity of the cadscripts', () =>
{
    const rows: Array<Row> = []

    beforeAll(async () =>
    {
        const runner = await new Runner().load()
        for (const filename of SCRIPTS)
        {
            const script = filename.replace('.js', '')
            const code = fs.readFileSync('./tests/cadscripts/scripts/' + filename, 'utf8')
            const mesh = await run(runner, script, code, 'mesh')
            const brep = await run(runner, script, code, 'brep')
            rows.push({ script, mesh, brep, ...matchUp(mesh.shapes, brep.shapes) })
        }
    }, 1_800_000)

    const row = (script: string) => rows.find(r => r.script === script)!
    const offIn = (r: Row) => r.pairs.filter(p => p.off.length || p.familyMismatch)

    it('reads as the checked-in parity table', async () =>
    {
        await expect(table(rows)).toMatchFileSnapshot('./kernel.parity.txt')
    })

    it('every script still runs on mesh', () =>
    {
        expect(rows.filter(r => r.mesh.status !== 'success').map(r => `${r.script}: ${r.mesh.error}`)).toEqual([])
    })

    /*  The floor: what parity already holds today, so a kernel change cannot take it away
        unnoticed. Widen these lists as the divergences in kernel-divergences.test.ts get fixed. */
    const RUNS_ON_BREP = ['artcrate', 'boxpubtest', 'gardenchair', 'kakpinchedstool', 'programmaticparams', 'sedia', 'slidercabinet', 'strawwall', 'timberfloor', 'tomy', 'urhousesketch', 'workbench']
    const CLEAN_ON_BREP = ['artcrate', 'boxpubtest', 'gardenchair', 'kakpinchedstool', 'programmaticparams', 'sedia', 'workbench', 'slidercabinet', 'strawwall', 'timberfloor']
    /*  Scripts that use the make module stop at its mesh-only error on brep — by design until
        Make builds through the Modeler API. */
    const MESH_ONLY_BY_DESIGN = ['timberwall', 'timberwallopenings', 'maritavolo', 'simplestep']

    it('stops make-module scripts on brep with the mesh-only message', () =>
    {
        if (ONLY) return
        MESH_ONLY_BY_DESIGN.forEach(s => expect(row(s).brep.error, s).toMatch(/only available in mesh mode/))
    })

    it('keeps running on brep the scripts that already do', () =>
    {
        if (ONLY) return
        RUNS_ON_BREP.forEach(s => expect(row(s).brep.status, `${s}: ${row(s).brep.error ?? ''}`).toBe('success'))
    })

    it('keeps every matched bbox in agreement for the scripts that already agree', () =>
    {
        if (ONLY) return
        CLEAN_ON_BREP.forEach(s =>
            expect(offIn(row(s)).map(p => `${p.mesh.path}: ${p.off.map(o => o.key).join(',') || 'family'}`), s).toEqual([]))
    })
})
