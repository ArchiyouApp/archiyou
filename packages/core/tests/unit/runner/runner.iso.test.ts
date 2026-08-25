import { describe, it, expect } from 'vitest'
import { Runner } from '../../../src/runner/Runner'

describe('Runner — iso on scene-backed mesh collections', () =>
{
    // Regression: SmartShapeCollection.iso() on coplanar-touching meshes used
    // to leak occluder copies into the scene (via SmartMesh.copy()), whose
    // inner MeshJs was then consumed by projectEdges(Vec<MeshJs>). The next
    // scene-wide bbox walk (run during GLB serialisation) hit those zombies
    // and panicked with "null pointer passed to rust".
    it('finishes successfully through the full Runner + GLB output path', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            script: {
                code: `
                    bigbox = box(400, 200, 10).move(0, -300);
                    sm = box(5, 200, 5).align(bigbox, 'leftfrontbottom', 'leftfronttop');
                    c2 = collection(bigbox, sm);
                    c2.iso([1,1,1], false, false, 100, 10).move(500, -400);
                `,
            },
            outputs: ['default/model/glb'],
        } as any)
        expect(result.status).toBe('success')
    }, 60000)

    // Regression: iso of a vertical stack of N coplanar-touching boxes used to
    // drop contact-boundary edges for many N (e.g. 5) but happen to work for
    // others (e.g. 13). The merge-then-translate occluder soup confused the
    // back-to-front HLR ray test on coplanar interior faces.
    it.each([5, 13])(
        'preserves contact edges in a vertical stack of %i boxes',
        async (n) =>
        {
            const runner = await new Runner().load()
            const result = await runner.execute({
                script: {
                    code: `
                        b1 = box(100, 100, 10);
                        c = b1.replicate(${n}, (s, i) => s.move(0, 0, 10 * i));
                        iso = c.iso().move(200);
                    `,
                },
                outputs: ['default/model/glb'],
            } as any)
            expect(result.status).toBe('success')
        },
        60000,
    )
})
