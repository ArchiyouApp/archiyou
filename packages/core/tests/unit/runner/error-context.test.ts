import { describe, it, expect } from 'vitest'
import { Runner } from '../../../src/runner/Runner'

describe('execution error context (gutter, marker, no cut-off)', () =>
{
    it('marks the error line and shows ample trailing context', async () =>
    {
        const code = [
            `notAFunc(1, 2, 3)`,  // 1 <- error
            `l2 = 2`,             // 2
            `l3 = 3`,             // 3
            `l4 = 4`,             // 4
            `l5 = 5`,             // 5
            `l6 = 6`,             // 6
            `l7 = 7`,             // 7  (6 lines after the error)
            `l8 = 8`,             // 8
        ].join('\n')

        const runner = await new Runner().load()
        const result = await runner.execute({ script: { code }, outputs: ['default/model/glb'] })
        const err = result.errors![0]
        const ctx = err.message as string
        console.log('===CTX-START===\n' + ctx + '\n===CTX-END===')

        expect(err.lineStart).toBe(1)
        expect(ctx).toMatch(/>\s*1 \| notAFunc\(1, 2, 3\)/) // marker + gutter on error line
        expect(ctx).not.toContain('^')                      // no misleading caret
        expect(ctx).toContain('l7 = 7')                     // 6 trailing lines → not cut off (old: ~2)
    })
})
