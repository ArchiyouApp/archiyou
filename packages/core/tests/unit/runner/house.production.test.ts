/**
 * house.production.test.ts — the real `archiyou/housetest:0.1` script, end to end.
 *
 * A production-shaped model: a timber-framed building at MILLIMETRE scale
 * (2500 x 4000 x 2550), assembled from two component scripts (`./timberwall`, `./urroof`),
 * ending in `structureElems.iso()` over the whole assembly. This is the heaviest real
 * exercise of the Runner in the suite — component resolution, dozens of touching parts,
 * booleans, wall openings, a roof, dimension lines and a part list.
 *
 * The three scripts are checked in under tests/fixtures/house/ so the test is hermetic;
 * they are verbatim copies from the library. `$component('./name')` resolves through
 * Runner.linkComponentScripts(), which is how the editor supplies an author's own scripts.
 *
 * ── Known open bug this model exposes ────────────────────────────────────────────────
 * `structureElems.iso()` returns points that are NOT on the projection plane. Measured on
 * this assembly: ~3382 mm of z spread, on a building 4 m deep. Because
 * `Mesh._flattenProjectionToScreen` ROTATES the projection onto XY rather than
 * re-projecting, that non-planarity survives into the drawing as lines off the XY plane.
 *
 * It is not asserted here: script scope is sandboxed (no globalThis, `Error` shadowed,
 * `print()` writes to a stdout vitest owns), so getting a measurement back out of a
 * running script is not worth the contortion. The reduced case IS asserted, in
 * packages/meshup/tests/unit/isoPlanarity.test.ts, which pins the same failure on a plain
 * 4000-unit box and on a synthetic frame of this house's dimensions.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import type { ScriptData } from '../../../src/ScriptSchema'

const FIXTURES = join(__dirname, '../../fixtures/house')

/** The author's saved configuration — the one this was reported against. */
const PARAMS = {
    WIDTH: 2500, DEPTH: 4000, WALL_HEIGHT: 2550,
    ROOF_HEIGHT: 1997, OVERHANG_SIDE: 377, OVERHANG_FRONT: 554,
}

function fixtureData(name: string): ScriptData
{
    return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as ScriptData
}

function fixture(name: string): Script
{
    const script = Script.fromData(fixtureData(name))
    if (!script) throw new Error(`fixture "${name}" failed Script validation`)
    return script
}

async function runHouse(params: Record<string, unknown>): Promise<any>
{
    const runner = await new Runner().load()
    runner.linkComponentScripts([fixture('timberwall'), fixture('urroof')])
    return runner.execute({
        script: fixtureData('housetest'),
        params,
        outputs: ['default/model/glb'],
    } as any)
}

describe('housetest:0.1 — production assembly', () =>
{
    let result: any

    beforeAll(async () => { result = await runHouse(PARAMS) }, 900000)

    it('resolves both components and executes cleanly', () =>
    {
        expect(result.status, JSON.stringify(result.errors ?? []).slice(0, 600)).toBe('success')
    })

    it('produces a model', () =>
    {
        expect(result.state?.scenegraph).toBeTruthy()
        const glb = result.outputs?.find((o: any) => o.path?.requestedPath === 'default/model/glb')
        expect(glb?.output).toBeTruthy()
    })

    it('stays within a workable execution time', () =>
    {
        // Not a micro-benchmark — a guard against an order-of-magnitude regression. The
        // projection dominates: it re-projects per pair of touching parts, so cost grows
        // with the assembly rather than with the model's complexity.
        expect(result.duration).toBeLessThan(120_000)
    })
})

describe('housetest:0.1 — parameter defaults', () =>
{
    it.fails('survives its own default ROOF_HEIGHT of 0', async () =>
    {
        // housetest declares ROOF_HEIGHT with default 0, and urroof then builds
        // `line([SPAN/2, 0, HEIGHT], [SPAN/2, 0, 0])` — a zero-length line, which throws:
        //   "Cannot create a zero-length line — start and end are the same point"
        // So opening this configurator on its defaults fails outright. Separate from the
        // projection bug; either urroof should handle a flat roof or the default should
        // not be 0.
        const result = await runHouse({ ...PARAMS, ROOF_HEIGHT: 0 })
        expect(result.status).toBe('success')
    }, 900000)
})
