import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, beforeAll } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'
// The parser is pure TS in the editor UI package; only this test reaches across for it.
import { parseHelpDoc, codeAt } from '../../../../ui/src/editor/help/help-content'

/**
 * Every tutorial step in help/<locale>/tutorials/ runs.
 *
 * The help panel puts a step's code in the editor and executes it, so a tutorial
 * whose code no longer matches the API breaks in front of a beginner. Each step is
 * run as the editor would run it: the tutorial's code folded up to that block.
 */

const TIMEOUT = 30000; // WASM kernel load
const HELP_DIR = path.resolve(import.meta.dirname, '../../../../../help')

const TUTORIALS = (fs.readdirSync(HELP_DIR, { recursive: true }) as string[])
    .map(f => f.split(path.sep).join('/'))
    .filter(f => /^[^/]+\/tutorials\/.+\.md$/.test(f))
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
