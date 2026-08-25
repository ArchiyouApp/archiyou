/**
 * The `isotest` script still runs.
 *
 * `isotest` lives in the Archiyou script database and was written to
 * demonstrate hidden-line-removal defects — its comments name them
 * ("big-small ortho contact => dropped seperating edge"). Executing it through
 * the Runner is a core concern: it exercises script evaluation, the modeler
 * API surface the script uses, and glTF output.
 *
 * The HLR strategies the script motivated are compared in meshup, where they
 * live: packages/meshup/tests/examples/isometry-benchmark.test.ts. That suite
 * rebuilds these same geometry cases and measures each solver on them.
 *
 * The script is inlined rather than living in tests/cadscripts/scripts/, which
 * is for application-like scripts; this one is a test fixture.
 */
import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../src/runner/types'
import { Runner } from '../../src/runner/Runner'

const ISOTEST_SCRIPT = String.raw`
box().iso().move(-400)

// stack some boxes

b1 = box(100,100,10);
c = b1.replicate($NUM, (s,i ) => s.move(0,0,10*i))
c.merge().iso().move(200); // OK
iso = c.iso().move(200,400);
modeler.scene().add(c.isoTest().move(200,600));


// another stack like in art crate
bigbox = box(400, 200,10).move(0,-300);
sm = box(5,200, 5).align(bigbox, 'leftfrontbottom', 'leftfronttop')

c2 = collection(bigbox,sm);
c2.merge().iso([1,1,1]).move(500,-400); // big-small ortho contact => dropped seperating edge
c2.iso([1,1,1], false, false, 100, 10).move(500,-800);
//modeler.scene().add(c2.isoTest([1,1,1], false, false, 100, 10).move(500,-1400));


// beams
bs = box(5,500,20).move(500).row(5,45)

bhf = boxbetween(
    bs.bbox().corner('leftfrontbottom'),
    bs.bbox().corner('rightfrontop').moveY(-10)
)
bhb = bhf.copy().mirrorY();
floor = collection(bs,bhf, bhb);
floor.merge().iso([-1,-1,1], false, false, 100, 40).move(1100);
floor.iso([-1,-1,1], false, false, 200, 10).move(1500);
//modeler.scene().add(floor.isoTest([-1,-1,1], false, false, 200, 10).move(2000));

// grid of boxes
grid = box().grid(3,3,3, [150,150,150]).move(-1000);
grid.iso().move(-1000,1000)
//modeler.scene().add(
//  grid.isoTest().move(-1000,2000));
`

describe('isotest', () =>
{
    it('runs end to end through the Runner', async () =>
    {
        const runner = await new Runner().load()
        const request: RunnerScriptExecutionRequest = {
            kernel: 'mesh',
            script: { name: 'isotest', code: ISOTEST_SCRIPT, params: {} },
            outputs: ['default/model/gltf'],
        }
        const result = await runner.execute(request)
        expect(result.status, result.errors?.[0]?.message ?? '').toBe('success')
        expect(result.outputs[0].path.resolvedPath).toBe('default/model/gltf')
    }, 600_000)
})
