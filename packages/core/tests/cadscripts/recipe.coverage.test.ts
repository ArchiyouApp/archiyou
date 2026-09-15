/**
 * recipe.coverage.test.ts — how much of each cadscript the recipe recorder captures.
 *
 * Every script runs once with recipe recording on. For each visible solid in the scene the test asks
 * whether its recipe is still procedural (primitives, extrusions, transforms and booleans all the way
 * down) or baked somewhere in its tree, and why. The table is a file snapshot
 * (recipe.coverage.txt, refresh with `vitest -u`), so a change in capture shows up as a readable diff.
 *
 * This is the probe for the OpenSCAD exporter (plans/OPENSCAD.md, Part 1): the exporter can only emit
 * CSG for what is captured here. It requests `default/model/scad`, which switches recording on, checks
 * that the exporter writes CSG for exactly the solids captured here, and keeps every script's .scad
 * under tests/outputs/cadscripts for reading.
 */

import fs from 'node:fs'
import { describe, it, expect, beforeAll } from 'vitest'

import { Runner } from '../../src/runner/Runner'
import { recipeOf, resolveRecipe, verifyRecipe, explainRecipe, type RecipeNode } from '../../src/modeler/Recipe'

const SCRIPTS = fs.readdirSync('./tests/cadscripts/scripts').filter(f => f.endsWith('.js')).sort()

interface Coverage { script: string; solids: number; procedural: number; baked: number; unrecorded: number; reasons: Map<string, number>; unverified: string[]; csgParts?: number; error?: string }

/** The first baked reason anywhere in a resolved tree, or null when it is procedural throughout */
function bakedReason(node: RecipeNode): string | null
{
    if (node.kind === 'baked') return node.reason
    if (node.kind === 'boolean') return [node.base, ...node.tools].map(bakedReason).find(Boolean) ?? null
    return null
}

/** A reason without the numbers that make it unique per shape */
const reasonKey = (reason: string) => reason.replace(/-?\d+(\.\d+)?/g, '#')

function coverageOf(script: string, scene: any): Coverage
{
    const c: Coverage = { script, solids: 0, procedural: 0, baked: 0, unrecorded: 0, reasons: new Map(), unverified: [] }
    const walk = (node: any, hidden: boolean) =>
    {
        const isHidden = hidden || node.style?.visible === false
        const shape = node.shape?.()
        if (shape && !isHidden && shape.style?.visible !== false && shape.type === 'Mesh')
        {
            c.solids++
            const recipe = recipeOf(shape)
            if (!recipe) c.unrecorded++
            else
            {
                const reason = bakedReason(resolveRecipe(recipe))
                if (reason === null)
                {
                    c.procedural++
                    // the recipe's bounds must match the real geometry (exact for a leaf, containing it for a boolean)
                    const check = verifyRecipe(shape, recipe)
                    if (!check.ok) c.unverified.push(`${node.path()}: ${check.reason}\n${explainRecipe(shape)}`)
                }
                else
                {
                    c.baked++
                    const key = reasonKey(reason)
                    c.reasons.set(key, (c.reasons.get(key) ?? 0) + 1)
                }
            }
        }
        node.children?.().forEach((child: any) => walk(child, isHidden))
    }
    walk(scene, false)
    return c
}

function table(rows: Coverage[]): string
{
    const pct = (n: number, d: number) => d ? `${Math.round(100 * n / d)}%` : '-'
    const lines = rows.map(r => r.error
        ? `${r.script.padEnd(24)} FAILED: ${r.error}`
        : `${r.script.padEnd(24)} ${String(r.solids).padStart(4)} solids  ${String(r.procedural).padStart(4)} procedural ${pct(r.procedural, r.solids).padStart(4)}  ${String(r.baked).padStart(3)} baked  ${String(r.unrecorded).padStart(2)} unrecorded`
            + (r.reasons.size ? `\n${[...r.reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${' '.repeat(26)}${n} × ${k}`).join('\n')}` : ''))
    const solids = rows.reduce((a, r) => a + r.solids, 0)
    const procedural = rows.reduce((a, r) => a + r.procedural, 0)
    return [...lines, '', `${'corpus'.padEnd(24)} ${String(solids).padStart(4)} solids  ${String(procedural).padStart(4)} procedural ${pct(procedural, solids).padStart(4)}`, ''].join('\n')
}

describe('recipe coverage of the cadscripts', () =>
{
    const rows: Coverage[] = []

    beforeAll(async () =>
    {
        const runner = await new Runner().load()
        for (const filename of SCRIPTS)
        {
            const code = fs.readFileSync('./tests/cadscripts/scripts/' + filename, 'utf8')
            const script = filename.replace('.js', '')
            const result = await runner.execute({ kernel: 'mesh', script: { name: script, code, params: {} }, outputs: ['default/model/scad'] } as any)
            if (result.status !== 'success') { rows.push({ script, solids: 0, procedural: 0, baked: 0, unrecorded: 0, reasons: new Map(), unverified: [], error: String(result.errors?.[0]?.message) }); continue }
            const row = coverageOf(script, runner.getScope('default').modeler.scene())
            const scad = result.outputs?.find((o: any) => o.path?.requestedPath === 'default/model/scad')?.output as string | undefined
            if (scad)
            {
                fs.mkdirSync('./tests/outputs/cadscripts', { recursive: true })
                fs.writeFileSync(`./tests/outputs/cadscripts/${script}.scad`, scad)
                row.csgParts = Number(/\/\/ Parts: (\d+) CSG/.exec(scad)?.[1] ?? NaN)
            }
            rows.push(row)
        }
    }, 900_000)

    const row = (script: string) => rows.find(r => r.script === script)!

    it('reads as the checked-in coverage table', async () =>
    {
        await expect(table(rows)).toMatchFileSnapshot('./recipe.coverage.txt')
    })

    it('records every procedural solid correctly: its recipe matches its geometry', () =>
    {
        expect(rows.flatMap(r => r.unverified.map(u => `${r.script} ${u}`))).toEqual([])
        expect(rows.filter(r => r.error).map(r => `${r.script}: ${r.error}`)).toEqual([])
    })

    it('writes every captured solid as OpenSCAD CSG', () =>
    {
        rows.filter(r => !r.error).forEach(r => expect(r.csgParts, r.script).toBe(r.procedural))
    })

    it('never bakes a boxbetween or a planar extrusion for lack of a row', () =>
    {
        rows.forEach(r => [...r.reasons.keys()].forEach(reason =>
            expect(reason, r.script).not.toMatch(/made by Mesh\.BoxBetween|made by Mesh\.fromPolygons\(\)$/)))
    })

    it('captures the boxbetween and extrusion scripts completely', () =>
    {
        ;['artcrate', 'workbench', 'strawwall', 'timberfloor', 'boxpubtest', 'programmaticparams'].forEach(script =>
            expect(row(script).procedural, `${script}\n${table([row(script)])}`).toBe(row(script).solids))
    })
})
