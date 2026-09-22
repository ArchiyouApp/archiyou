import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, it, expect, beforeAll } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'

/**
 * Everything the help panel offers to run, runs:
 *
 *  - every tutorial step in help/tutorials/<locale>/, as the editor runs it: the
 *    tutorial's code folded up to that block
 *  - every `@example` in the API reference (packages/ui/src/editor/help/api.generated.json,
 *    made from the doc comments by scripts/generate-api.ts)
 *
 * Help whose code no longer matches the API breaks in front of a beginner.
 */

const TIMEOUT = 30000; // WASM kernel load
const HELP_DIR = path.resolve(import.meta.dirname, '../../../../../help')
const API_FILE = path.resolve(import.meta.dirname, '../../../../ui/src/editor/help/api.generated.json')

// The parser is pure TS in the editor UI package. Loaded by path rather than imported, so
// core's program (rootDir) does not take in a file of another package.
const { parseHelpDoc, codeAt } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../../../ui/src/editor/help/help-content.ts')).href)

const API_EXAMPLES: Array<{ id: string, code: string }> = (JSON.parse(fs.readFileSync(API_FILE, 'utf8')).entries as Array<{ id: string, examples?: string[] }>)
    .flatMap(e => (e.examples ?? []).map((code, i) => ({ id: e.examples!.length > 1 ? `${e.id} #${i + 1}` : e.id, code })))

/** Examples written as fragments (`bbox.corner('topleft')`) before examples had to run.
 *  They live in packages/meshup (a submodule); rewrite them as small whole scripts there
 *  and take them off this list. Skipped, so they stay visible in the test output. */
const FRAGMENTS = [
    'Mesh.align', 'Curve.align', 'Polygon.align', 'ShapeCollection.align', 'Vertex.align', // Shape.align
    'Curve.fillet', 'Bbox.corner', 'Bbox.getSidesShapes',
]
const isFragment = (id: string) => FRAGMENTS.includes(id.replace(/ #\d+$/, ''))

const TUTORIALS = (fs.readdirSync(HELP_DIR, { recursive: true }) as string[])
    .map(f => f.split(path.sep).join('/'))
    .filter(f => /^tutorials\/[^/]+\/.+\.md$/.test(f))
    .sort()

describe('Runner runs every help tutorial step', () =>
{
    let runner: Runner

    beforeAll(async () =>
    {
        runner = await new Runner().load()
    }, TIMEOUT)

    it('finds tutorials', () =>
    {
        expect(TUTORIALS.length).toBeGreaterThan(0)
    })

    TUTORIALS.forEach(file =>
    {
        const doc = parseHelpDoc(fs.readFileSync(path.join(HELP_DIR, file), 'utf8'))

        doc.steps.forEach((step, stepIndex) =>
        {
            step.blocks.forEach((block, blockIndex) =>
            {
                if (block.kind !== 'code' || !block.action) return

                it(`${file} · ${step.title} · block ${blockIndex + 1}`, async () =>
                {
                    const code = codeAt(doc, stepIndex, blockIndex) as string
                    const result = await runner.execute({
                        script: { name: 'tutorial', code, params: {} },
                        messages: ['error'],
                    } as RunnerScriptExecutionRequest)

                    expect(result.status, `${result.errors?.[0]?.message ?? ''}\n--- code ---\n${code}`).toBe('success')
                    expect(result.errors ?? []).toHaveLength(0)
                    expect(result.meta?.numShapes ?? 0).toBeGreaterThan(0)
                }, TIMEOUT)
            })
        })
    })
})

describe('Runner runs every example in the API reference', () =>
{
    let runner: Runner

    beforeAll(async () =>
    {
        runner = await new Runner().load()
    }, TIMEOUT)

    API_EXAMPLES.forEach(({ id, code }) =>
    {
        (isFragment(id) ? it.skip : it)(id, async () =>
        {
            const result = await runner.execute({
                script: { name: 'example', code, params: {} },
                messages: ['error'],
            } as RunnerScriptExecutionRequest)

            expect(result.status, `${result.errors?.[0]?.message ?? ''}\n--- example ---\n${code}`).toBe('success')
            expect(result.errors ?? []).toHaveLength(0)
        }, TIMEOUT)
    })
})
