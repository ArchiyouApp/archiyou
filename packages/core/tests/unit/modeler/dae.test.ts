import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'

/**
 * COLLADA (.dae) export for the Modeler pipeline.
 * Covers n-gon <polylist> faces, vertex welding, the scene-graph hierarchy, materials,
 * curves-as-lines and the asset header. See src/modeler/DAEExporter.ts.
 */
describe('Modeler DAE export', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler() // mesh kernel, 'mm'
        await modeler.load()

        annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    })

    beforeEach(() =>
    {
        modeler.reset()
        annotator.reset()
    })

    /** Pull the numeric `count` off the first matching element. */
    const attrCount = (dae: string, element: string): number | null =>
    {
        const m = dae.match(new RegExp(`<${element}[^>]*\\scount="(\\d+)"`))
        return m ? parseInt(m[1], 10) : null
    }

    /** Number of floats in a named float_array. */
    const floatArrayCount = (dae: string, idSuffix: string): number | null =>
    {
        const m = dae.match(new RegExp(`<float_array id="[^"]*${idSuffix}" count="(\\d+)"`))
        return m ? parseInt(m[1], 10) : null
    }

    const countAll = (dae: string, re: RegExp): number => (dae.match(re) ?? []).length

    //// N-GONS + WELDING ////

    it('keeps a box as six welded quads, not a triangle soup', async () =>
    {
        modeler.box(100, 100, 100)

        const dae = await modeler.toDAE()
        expect(dae).toBeTruthy()

        // n-gons survive: 6 faces of 4 vertices each
        expect(attrCount(dae!, 'polylist')).toBe(6)
        expect(dae).toContain('<vcount>4 4 4 4 4 4</vcount>')
        expect(dae).not.toContain('<triangles')

        // welding: a cube has 8 distinct corners (24 floats) and 6 distinct face normals
        expect(floatArrayCount(dae!, 'positions-array')).toBe(24)
        expect(floatArrayCount(dae!, 'normals-array')).toBe(18)
    })

    it('falls back to triangles when ngons is false', async () =>
    {
        modeler.box(100, 100, 100)

        const dae = await modeler.toDAE({ ngons: false })
        expect(dae).toBeTruthy()

        expect(dae).toContain('<triangles')
        expect(dae).not.toContain('<polylist')
        // a cube is 12 triangles, and welding still collapses to 8 corners
        expect(attrCount(dae!, 'triangles')).toBe(12)
        expect(floatArrayCount(dae!, 'positions-array')).toBe(24)
    })

    it('honours weld: 0 by leaving vertices unwelded', async () =>
    {
        modeler.box(100, 100, 100)

        const dae = await modeler.toDAE({ weld: 0 })
        expect(dae).toBeTruthy()

        // 6 quads x 4 vertices = 24 loose face-vertices = 72 floats
        expect(floatArrayCount(dae!, 'positions-array')).toBe(72)
    })

    it('exports curved solids without error', async () =>
    {
        modeler.cylinder(20, 100)

        const dae = await modeler.toDAE()
        expect(dae).toBeTruthy()
        expect(dae).toContain('<polylist')
        expect(attrCount(dae!, 'polylist')).toBeGreaterThan(0)
    })

    //// HIERARCHY ////

    it('preserves the scene graph as nested nodes', async () =>
    {
        modeler.layer('walls')
        modeler.box(10, 10, 10)

        const dae = await modeler.toDAE()
        expect(dae).toBeTruthy()

        const root = dae!.indexOf('name="root"')
        const walls = dae!.indexOf('name="walls"')
        // 'Mesh:Box' with the ':' sanitized away — every 1.4.1 `name` is an xs:NCName
        const shape = dae!.indexOf('name="Mesh_Box"')
        const instance = dae!.indexOf('<instance_geometry')

        // root > walls > shape, each written inside the previous, with the geometry
        // instance innermost
        expect(root).toBeGreaterThan(-1)
        expect(walls).toBeGreaterThan(root)
        expect(shape).toBeGreaterThan(walls)
        expect(instance).toBeGreaterThan(shape)

        // and they genuinely nest rather than being siblings
        const nodeOpens = countAll(dae!, /<node /g)
        const nodeCloses = countAll(dae!, /<\/node>/g)
        expect(nodeOpens).toBe(nodeCloses)
        expect(nodeOpens).toBe(3) // root + walls + shape
        // the first close comes only after ALL three opens
        expect(dae!.indexOf('</node>')).toBeGreaterThan(shape)
    })

    it('drops hidden subtrees unless all is set', async () =>
    {
        modeler.layer('visible')
        modeler.box(10, 10, 10)
        const hidden = modeler.layer('secret')
        modeler.box(10, 10, 10).move(50, 0, 0)
        hidden.hide()

        const dae = await modeler.toDAE()
        expect(dae).toBeTruthy()
        expect(dae).not.toContain('name="secret"')

        const withAll = await modeler.toDAE({ all: true })
        expect(withAll).toContain('name="secret"')
    })

    //// MATERIALS ////

    it('emits one material per distinct colour and binds it by symbol', async () =>
    {
        modeler.box(10, 10, 10).color('red')
        modeler.box(10, 10, 10).move(50, 0, 0).color('blue')

        const dae = await modeler.toDAE()
        expect(dae).toBeTruthy()

        expect(countAll(dae!, /<material id=/g)).toBe(2)
        expect(countAll(dae!, /<effect id=/g)).toBe(2)
        expect(dae).toContain('<color sid="diffuse">1 0 0 1</color>')
        expect(dae).toContain('<color sid="diffuse">0 0 1 1</color>')

        // every instance binds, and the symbol matches the one on the primitive
        expect(countAll(dae!, /<instance_material /g)).toBe(2)
        expect(dae).toContain('<polylist material="material"')

        // libraries appear in dependency order
        const fx = dae!.indexOf('<library_effects>')
        const mats = dae!.indexOf('<library_materials>')
        const geo = dae!.indexOf('<library_geometries>')
        expect(fx).toBeLessThan(mats)
        expect(mats).toBeLessThan(geo)
    })

    it('reuses one material for shapes sharing a colour', async () =>
    {
        modeler.box(10, 10, 10).color('red')
        modeler.box(10, 10, 10).move(50, 0, 0).color('red')

        const dae = await modeler.toDAE()
        expect(countAll(dae!, /<material id=/g)).toBe(1)
        expect(countAll(dae!, /<instance_material /g)).toBe(2)
    })

    //// CURVES ////

    it('exports curves as lines', async () =>
    {
        modeler.line([0, 0, 0], [100, 0, 0])

        const dae = await modeler.toDAE()
        expect(dae).toBeTruthy()
        expect(dae).toContain('<lines')
        expect(attrCount(dae!, 'lines')).toBeGreaterThanOrEqual(1)
        // a line geometry carries positions but no normals
        expect(dae).not.toContain('normals-array')
    })

    //// ASSET HEADER ////

    it('writes the model units and a Z-up axis', async () =>
    {
        modeler.box(10, 10, 10)

        const mm = await modeler.toDAE()
        expect(mm).toContain('<unit name="millimeter" meter="0.001" />')
        expect(mm).toContain('<up_axis>Z_UP</up_axis>')

        modeler.units('m')
        const m = await modeler.toDAE()
        expect(m).toContain('<unit name="meter" meter="1" />')
        modeler.units('mm')
    })

    it('is a well-formed COLLADA 1.4.1 document', async () =>
    {
        modeler.layer('walls')
        modeler.box(10, 10, 10).color('red')
        modeler.line([0, 0, 0], [50, 0, 0])

        const dae = await modeler.toDAE()
        expect(dae).toContain('<?xml version="1.0" encoding="utf-8"?>')

        // Parse it for real rather than string-matching — this is the offline stand-in for
        // `xmllint --schema collada_schema_1_4_1.xsd`.
        const { XMLParser, XMLValidator } = await import('fast-xml-parser')

        expect(XMLValidator.validate(dae!)).toBe(true)

        const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' }).parse(dae!)
        const collada = doc.COLLADA
        expect(collada).toBeDefined()
        expect(collada['@version']).toBe('1.4.1')
        expect(collada['@xmlns']).toBe('http://www.collada.org/2005/11/COLLADASchema')

        // asset header
        expect(collada.asset.up_axis).toBe('Z_UP')
        expect(collada.asset.unit['@name']).toBe('millimeter')

        // every referenced id must actually exist — a dangling url is the classic way a
        // hand-rolled COLLADA file "looks fine" but imports empty
        const ids = new Set<string>()
        const collectIds = (node: any): void =>
        {
            if (!node || typeof node !== 'object') return
            if (Array.isArray(node)) { node.forEach(collectIds); return }
            if (typeof node['@id'] === 'string') ids.add(node['@id'])
            Object.values(node).forEach(collectIds)
        }
        collectIds(collada)

        const refs = [...dae!.matchAll(/(?:url|source|target)="#([^"]+)"/g)].map(m => m[1])
        expect(refs.length).toBeGreaterThan(0)
        const dangling = refs.filter(r => !ids.has(r))
        expect(dangling).toEqual([])

        // the scene points at the visual_scene we emitted
        expect(collada.scene.instance_visual_scene['@url']).toBe('#Scene')
    })

    //// EMPTY ////

    it('returns null for an empty scene', async () =>
    {
        const dae = await modeler.toDAE()
        expect(dae).toBeNull()
    })
})
