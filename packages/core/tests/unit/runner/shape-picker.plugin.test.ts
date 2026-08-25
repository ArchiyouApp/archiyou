import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import type { ScriptData, ScriptParamData } from '../../../src/execution/types'
import { Runner } from '../../../src/runner/Runner'
// The actual example-plugin main script (single source of truth).
import shapePicker from '../../../../../plugins/shape-picker/scripts/main'

/** A comparable size for the gltf model output (proxy for distinct geometry). */
function modelSize(result: any): number
{
  const o = result?.outputs?.find((x: any) => x.path?.requestedPath === 'default/model/gltf')?.output
  const data = (o && typeof o === 'object' && 'data' in o) ? o.data : o
  if (typeof data === 'string') return data.length
  if (data instanceof ArrayBuffer) return data.byteLength
  return JSON.stringify(data ?? '').length
}

/**
 * Regression for the param-binding fix: run the shape-picker main script the way
 * PluginManager does — with the param definitions in `script.params` so the
 * submitted `params` values bind. Each SHAPE must yield DISTINCT geometry.
 *
 * The earlier smoke test only asserted `status: success`, which is why the bug
 * (every shape silently rendered the default cube) slipped through — all three
 * happen to share bbox ±50 at size 100, so only the output payload reveals it.
 */
describe('shape-picker example plugin — param binding & distinct geometry', () =>
{
  it('binds SHAPE and produces distinct geometry for cube / sphere / cylinder', async () =>
  {
    const runner = await new Runner().load()

    // Bootstrap: first run declares the params; capture the defs (as PluginManager does).
    const boot = await runner.execute({
      kernel: 'mesh', script: { code: shapePicker.code }, outputs: ['default/model/gltf'],
    } as RunnerScriptExecutionRequest)
    expect(boot.status).toBe('success')

    const defs: Record<string, ScriptParamData> = {}
    for (const p of boot.state.managedParams!.new) defs[p.name] = p
    expect(Object.keys(defs)).toEqual(expect.arrayContaining(['SHAPE', 'SIZE']))

    const sizeFor = async (shape: string): Promise<number> =>
    {
      const script = { code: shapePicker.code, params: defs } as ScriptData
      const r = await runner.execute({
        kernel: 'mesh', script, params: { SHAPE: shape }, outputs: ['default/model/gltf'],
      } as RunnerScriptExecutionRequest)
      expect(r.status).toBe('success')
      return modelSize(r)
    }

    const cube     = await sizeFor('cube')
    const sphere   = await sizeFor('sphere')
    const cylinder = await sizeFor('cylinder')

    // Distinct shapes → distinct geometry. A regression in param binding would
    // collapse these to a single value (every run falls back to the default cube).
    expect(new Set([cube, sphere, cylinder]).size).toBe(3)
  })
})
