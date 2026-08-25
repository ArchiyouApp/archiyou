/**
 * End-to-end check of the material render path with the REAL materials database:
 *   MaterialManager.renderSpec → meshup Style.material → GLTFBuilder → GLB document.
 *
 * The meshup-side tests use hand-written specs; this one guards the seam between the
 * two packages, so a change to materials.json (texture sizes, pbr, edge defaults)
 * that breaks the exporter is caught here rather than in the viewer.
 */

import { beforeAll, describe, it, expect } from 'vitest'

import { initAsync } from '@archiyou/meshup'
import { Mesh } from '@archiyou/meshup'
import { GLTFBuilder } from '@archiyou/meshup'

import { MaterialManager } from '../../../src/materials/MaterialManager'
import type { ArchiyouModules } from '../../../src/types'

beforeAll(async () => { await initAsync() })

function makeManager(): MaterialManager
{
    const mgr = new MaterialManager()
    mgr.setArchiyou({
        modeler: { unitSystem: () => 'metric', units: () => 'mm' },
    } as unknown as ArchiyouModules)
    return mgr
}

/** Apply a real material to a box and export, returning the GLTF document. */
async function exportWith(mgr: MaterialManager, name: string, box: any)
{
    const spec = mgr.renderSpec(mgr.get(name)!)
    // The async export path fills in the base64 texture payloads.
    box.style.material = spec
    await mgr.embedTexturesInShapes([box])
    return (new GLTFBuilder().add(box).applyExtensions() as any)._doc
}

describe('real material → GLB', () =>
{
    it('gives a douglas beam a darkened-timber hairline outline', async () =>
    {
        const mgr = makeManager()
        const doc = await exportWith(mgr, 'douglas', Mesh.Box(100, 2000, 100))

        const edge = doc.getRoot().listMaterials().find((m: any) => m.getName() === 'material_edge')
        expect(edge).toBeTruthy()
        const [r, g, b, a] = edge.getBaseColorFactor()
        expect(a).toBeCloseTo(1.0, 6)
        // Keeps the timber hue (warm: red > blue) but dark enough to read as a contour.
        expect(r).toBeGreaterThan(b)
        expect(r).toBeLessThan(0.5)
        // Hairline by default: the viewer draws width 1 with LineBasicMaterial (the
        // cheap path). Above 1 it switches to LineSegments2, which costs more per line.
        expect(edge.getExtension('BENTLEY_materials_line_style').width).toBe(1)
    })

    it('splits the beam into textured sides + section primitives', async () =>
    {
        const mgr = makeManager()
        const doc = await exportWith(mgr, 'douglas', Mesh.Box(100, 2000, 100))

        const prims = doc.getRoot().listMeshes()[0].listPrimitives()
        expect(prims.length).toBe(2)
        for (const p of prims)
        {
            expect(p.getMaterial().getBaseColorTexture()).toBeTruthy()
            expect(p.getAttribute('TEXCOORD_0')).toBeTruthy()
        }
    })

    it('tiles a beam longer than the texture, crops one that fits', async () =>
    {
        const mgr = makeManager()
        const sides = mgr.get('douglas')!.viz!.textures!.sides!
        expect(sides.repeat).toBe(false)

        const wrapOf = async (lengthMM: number) =>
        {
            const doc = await exportWith(mgr, 'douglas', Mesh.Box(100, lengthMM, 100))
            const prim = doc.getRoot().listMeshes()[0].listPrimitives()
                .find((p: any) => p.getMaterial().getName() === 'mesh_sides')
            return prim.getMaterial().getBaseColorTextureInfo().getWrapS()
        }

        // Comfortably inside the tile → clamp to the crop.
        expect(await wrapOf(Math.floor(sides.realHeight / 2))).toBe(33071) // CLAMP_TO_EDGE
        // Well past it → must repeat, or the edge pixel smears down the beam.
        expect(await wrapOf(sides.realHeight * 4)).toBe(10497)             // REPEAT
    })

    it('still outlines a material that has no textures at all', async () =>
    {
        const mgr = makeManager()
        // A material whose viz has no texture block still gets its edge style,
        // because renderSpec() is built from the settings, not from viz.
        const spec = mgr.renderSpec({ name: 'x', group: 'other' } as any)
        expect(spec.textures).toBeUndefined()
        expect(spec.edge?.opacity).toBe(1.0)
        expect(spec.edge?.width).toBe(1)
    })
})
