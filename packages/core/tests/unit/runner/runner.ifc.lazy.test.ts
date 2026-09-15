import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'

/**
 * The IFC classifier is loaded on demand (Modeler.loadIFCModule). explainIFC() is synchronous for
 * scripts, so the Runner loads the module before a run whose script or components call it. This file
 * runs in its own module registry, so the module starts unloaded: a successful explainIFC() inside a
 * component proves the Runner looked into the component's code too.
 */
describe('Runner — IFC loaded on demand', () =>
{
    it('loads the IFC classifier for explainIFC() called inside a component', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([Script.fromData({ name: 'post', code: `post = box(100, 100, 2600); explainIFC();` })!])
        const result: any = await runner.execute({
            script: Script.fromData({ name: 'host', code: `$component('./post').model();` })!,
            params: {},
            outputs: ['default/model/gltf'],
            messages: ['user', 'error'],
        } as any)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        const text = (result.messages ?? []).map((m: any) => m.message).join('\n')
        expect(text).toMatch(/IfcBuildingStorey/)
    }, 60000)

    it('writes an IFC output without any explainIFC() in the script', async () =>
    {
        const runner = await new Runner().load()
        const result: any = await runner.execute({
            script: Script.fromData({ name: 'plain', code: `wall = boxbetween([0, 0, 0], [3000, 200, 2600]);` })!,
            params: {},
            outputs: ['default/model/ifc'],
        } as any)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        const ifc = result.outputs?.find((o: any) => o.path?.requestedPath === 'default/model/ifc')?.output as string
        expect(ifc).toContain("FILE_SCHEMA(('IFC4'));")
        expect(ifc).toContain('IFCWALL(')
    }, 60000)
})
