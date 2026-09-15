/**
 * scad.roundtrip.test.ts — every cadscript exported to OpenSCAD and rendered back by real OpenSCAD.
 *
 * Each script runs through the Runner with `default/model/scad`. Every 3D part of the file is rendered
 * on its own with OpenSCAD 2025.01 (WASM build, a devDependency), with the Manifold and the CGAL engine,
 * and compared with the Archiyou shape it came from: same volume, same bounds. The table is a file
 * snapshot (scad.roundtrip.txt, refresh with `vitest -u`); a part that renders differently from the
 * model fails the test.
 *
 * Synthetic constructs are covered in tests/unit/modeler/scad.roundtrip.test.ts.
 */

import fs from 'node:fs'
import { describe, it, expect, beforeAll } from 'vitest'

import { Runner } from '../../src/runner/Runner'
import { buildSCAD } from '../../src/modeler/SCADExporter'
import { renderPart, compareWithShape, type SCADBackend } from '../unit/modeler/scad.render'

const SCRIPTS = fs.readdirSync('./tests/cadscripts/scripts').filter(f => f.endsWith('.js')).sort()
const BACKENDS: SCADBackend[] = ['Manifold', 'CGAL']

interface PartResult { script: string; module: string; kind: string; results: Record<SCADBackend, { match: boolean; detail: string; warnings: string[] }> }

describe('OpenSCAD round trip of the cadscripts', () =>
{
    const parts: PartResult[] = []
    const failures: string[] = []

    beforeAll(async () =>
    {
        const runner = await new Runner().load()
        for (const filename of SCRIPTS)
        {
            const script = filename.replace('.js', '')
            const code = fs.readFileSync('./tests/cadscripts/scripts/' + filename, 'utf8')
            const result = await runner.execute({ kernel: 'mesh', script: { name: script, code, params: {} }, outputs: ['default/model/scad'] } as any)
            const text = result.outputs?.find((o: any) => o.path?.requestedPath === 'default/model/scad')?.output as string | undefined
            if (result.status !== 'success' || !text) { failures.push(`${script}: ${result.errors?.[0]?.message ?? 'no output'}`); continue }

            const scene = runner.getScope('default').modeler.scene()
            const shapes = new Map(scene.descendants().filter((n: any) => n.shape()).map((n: any) => [n.path(), n.shape()]))
            // the same export again, for the part list with scene paths (the Runner returns the text only)
            const exported = buildSCAD(scene, { units: runner.getScope('default').modeler.units() })!
            for (const part of exported.parts.filter(p => p.kind !== '2d'))
            {
                expect(text, `${script} ${part.module}`).toContain(`module ${part.module}() {`)
                const module = text.slice(text.indexOf(`module ${part.module}() {`))
                const curved = /\bsphere\(/.test(module.slice(0, module.indexOf('\n}')))
                const row: PartResult = { script, module: part.module, kind: part.kind, results: {} as PartResult['results'] }
                for (const backend of BACKENDS)
                {
                    const rendered = await renderPart(text, part.module, backend)
                    const c = compareWithShape(rendered, shapes.get(part.path), curved ? 1e-3 : 1e-5, curved ? 1e-2 : 1e-5)
                    row.results[backend] = { match: c.match, detail: c.detail, warnings: rendered.warnings }
                }
                parts.push(row)
            }
        }
    }, 1_800_000)

    function table(): string
    {
        const lines: string[] = []
        for (const script of [...new Set(parts.map(p => p.script))])
        {
            const rows = parts.filter(p => p.script === script)
            const count = (b: SCADBackend) => rows.filter(r => r.results[b].match).length
            const warned = rows.filter(r => r.results.CGAL.warnings.length).length
            lines.push(`${script.padEnd(22)} ${String(rows.length).padStart(3)} parts  Manifold ${String(count('Manifold')).padStart(3)} match  CGAL ${String(count('CGAL')).padStart(3)} match${warned ? `  (${warned} with CGAL warnings)` : ''}`)
            for (const r of rows) for (const b of BACKENDS)
            {
                const res = r.results[b]
                if (!res.match) lines.push(`    ${b.padEnd(8)} ${r.module} (${r.kind}): ${res.detail}`)
                else if (res.warnings.length) lines.push(`    ${b.padEnd(8)} ${r.module} (${r.kind}) matches, warning: ${[...new Set(res.warnings)].join('; ')}`)
            }
        }
        const total = (b: SCADBackend) => parts.filter(p => p.results[b].match).length
        lines.push('', `${'corpus'.padEnd(22)} ${String(parts.length).padStart(3)} parts  Manifold ${String(total('Manifold')).padStart(3)} match  CGAL ${String(total('CGAL')).padStart(3)} match`, '')
        return lines.join('\n')
    }

    it('reads as the checked-in round-trip table', async () =>
    {
        expect(failures).toEqual([])
        await expect(table()).toMatchFileSnapshot('./scad.roundtrip.txt')
    })

    for (const backend of BACKENDS)
    {
        it(`renders every part with ${backend} to the model's volume and bounds`, () =>
        {
            expect(parts.length).toBeGreaterThan(300)
            expect(parts.filter(p => !p.results[backend].match).map(p => `${p.script} ${p.module} (${p.kind}): ${p.results[backend].detail}`)).toEqual([])
        })
    }
})
