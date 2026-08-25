import { describe, it, expect, beforeAll } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'
import { ShapeCollection as SmartShapeCollection } from '@archiyou/meshup'

describe('SmartShapeCollection.elevation', async () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
    })

    it('box().row() returns SmartShapeCollection', async () =>
    {
        const c = modeler.box(10, 100, 10)
        const row = (c as any).row(5, 10)
        console.log('row type:', row.constructor.name)
        expect(row).toBeInstanceOf(SmartShapeCollection)
    })

    it('box().row().elevation() is SmartShapeCollection added to elevation layer', async () =>
    {
        modeler = new Modeler()
        await modeler.load()

        const c = (modeler.box(10, 100, 10) as any).row(5, 10)
        console.log('c type:', c.constructor.name, 'length:', c.length)
        expect(c).toBeInstanceOf(SmartShapeCollection)

        const elev = c.elevation('top')
        console.log('elev type:', elev.constructor.name, 'length:', elev.length)

        const elevLayer = modeler.scene().find('elevation')
        console.log('elevation layer shapes:', elevLayer?.shapes().length)

        expect(elev).toBeInstanceOf(SmartShapeCollection)
        expect(elev.length).toBeGreaterThan(0)
        expect(elevLayer).toBeDefined()
        expect(elevLayer!.shapes().length).toBeGreaterThan(0)
        expect(elevLayer!.shapes().length).toBe(elev.length)
    })
})
