import { describe, it } from 'vitest'
import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { NATIVE_CONSOLE } from '../../../src/console/Console'

const LOG = (m: string) => process.stderr.write(m + '\n')
const mb = (n:number) => (n/1e6).toFixed(1).padStart(6)

const COMPONENT_CODE = `
studs = collection();
for(i = 0; i < 30; i++){ studs.add(box(38, 100, 2000).move(i*300, 0, 0)); }
plate = box(9000, 100, 38).move(0,0,-38);
wall = collection(studs, plate).name('wall');
isoview = wall.iso();
doc('spec')
  .page('main')
    .view('iso').shapes(isoview).width('80%').height('80%');
`

async function run(label:string, code:string, forceGc:boolean, runs=4)
{
  const r = await new Runner().load()
  r.linkComponentScripts([Script.fromData({ name: 'synthwall', code: COMPONENT_CODE })!])
  const script = Script.fromData({ name: 'parent', code })!
  LOG(`\n--- ${label} (forceGc=${forceGc}) ---`)
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    const res:any = await r.execute({ script, params: {}, outputs: ['default/model/gltf'] } as any)
    globalThis.console = NATIVE_CONSOLE
    const ms = performance.now() - t
    if (forceGc && (globalThis as any).gc) { (globalThis as any).gc(); (globalThis as any).gc() }
    const mu = process.memoryUsage()
    LOG(`  #${i}: ${ms.toFixed(0).padStart(6)}ms status=${res?.status} err=${JSON.stringify(res?.errors)?.slice(0,400)} external=${mb(mu.external)}MB heap=${mb(mu.heapUsed)}MB`)
  }
}

describe('wasm growth', () => {
  it('component docs path', async () => {
    LOG(`gc exposed: ${typeof (globalThis as any).gc === 'function'}`)
    const docs = `x = $component('./synthwall').get('default/docs/*/internal');`
    await run('COMPONENT docs', docs, false)
    await run('COMPONENT docs', docs, true)
    globalThis.console = NATIVE_CONSOLE
  }, 600000)
})
