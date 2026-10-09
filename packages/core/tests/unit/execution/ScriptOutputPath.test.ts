import { describe, it, expect } from 'vitest'

import { ScriptOutputPath } from '../../../src/execution/ScriptOutputPath'
import { ScriptOutputManager } from '../../../src/execution/ScriptOutputManager'
import type { ScriptMeta } from '../../../src/execution/types'

const META = { docs: ['spec', 'parts'], tables: ['bom'], metrics: ['area'], pipelines: ['drawings'] } as ScriptMeta

describe('ScriptOutputPath', () =>
{
    it('parses pipeline, category, entity, format and options', () =>
    {
        const path = new ScriptOutputPath('drawings/docs/spec/pdf?scale=2')

        expect(path.valid).toBe(true)
        expect([path.pipeline, path.category, path.entityName, path.format]).toEqual(['drawings', 'docs', 'spec', 'pdf'])
        expect(path.formatOptions).toEqual({ scale: 2 })
    })

    it('accepts a wildcard category', () =>
    {
        const path = new ScriptOutputPath('default/*/*/json')

        expect(path.valid).toBe(true)
        expect(path.category).toBe('*')
    })

    it('resolves wildcard entities from the script meta', () =>
    {
        const resolved = new ScriptOutputPath('default/docs/*/svg').resolveVerbose(META).resolved

        expect(resolved.map(p => p.entityName)).toEqual(['spec', 'parts'])
    })
})

describe('ScriptOutputManager', () =>
{
    it('gives the requested pipelines with default first, wildcards that resolve to nothing included', () =>
    {
        const manager = new ScriptOutputManager().loadRequest({
            outputs: ['drawings/docs/*/svg', 'default/model/glb', 'drawings/model/dxf', 'offer/tables/*/json'],
        } as any, undefined, false)

        expect(manager.getRequestedPipelines()).toEqual(['default', 'drawings', 'offer'])
        expect(manager.getRequestedPathsOfPipeline('drawings')).toEqual(['drawings/docs/*/svg', 'drawings/model/dxf'])
    })
})
