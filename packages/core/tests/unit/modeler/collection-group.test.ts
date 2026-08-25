/** collection() vs group():
 *   - collection() only REFERENCES shapes — the scene graph is untouched
 *   - group() creates a layer under the active layer and MOVES the shapes into it,
 *     out of whatever layer they were in
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'

/** Names of the shapes held directly by the layer `name` (not its sub-layers) */
const shapesIn = (m: any, name: string): Array<string> =>
{
    const layer = m.scene().findAll((n: any) => n.name === name)[0]
    return layer ? layer.children().filter((c: any) => c.hasShape()).map((c: any) => c.shape().name()) : []
}

describe('collection() vs group()', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    it('collection() leaves shapes in the layer they were made in', () =>
    {
        m.layer('sides')
        const a = m.box(10, 10, 10).name('sideA') as any
        const b = m.box(10, 10, 10).moveX(20).name('sideB') as any
        m.layer('tabletop')
        const t = m.box(100, 100, 2).name('top') as any

        const col = m.collection(a, b, t)
        col.name('table')

        expect(col.length).toBe(3)
        expect(col._layer).toBe(null)                       // no scene node of its own
        expect(shapesIn(m, 'sides')).toEqual(['sideA', 'sideB'])
        expect(shapesIn(m, 'tabletop')).toEqual(['top'])
        expect(m.scene().findAll((n: any) => n.name === 'table').length).toBe(0)
    })

    it('group() pulls shapes in from any layer, into a layer under the active one', () =>
    {
        m.layer('sides')
        const a = m.box(10, 10, 10).name('sideA') as any
        m.layer('tabletop')
        const t = m.box(100, 100, 2).name('top') as any

        const g = m.group(a, t)
        g.name('table')

        expect(shapesIn(m, 'sides')).toEqual([])            // moved out
        expect(shapesIn(m, 'table')).toEqual(['sideA', 'top'])
        expect(g._layer?.parent()?.name).toBe('tabletop')   // under the ACTIVE layer
    })

    it('group() takes an explicit name as first argument, and adopts shapes added later', () =>
    {
        m.layer('parts')
        const a = m.box(10, 10, 10).name('a') as any

        const g = m.group('assembly', a)
        const b = m.box(5, 5, 5).name('b') as any           // created into the active layer 'parts'
        g.add(b)

        expect(g.name()).toBe('assembly')
        expect(shapesIn(m, 'assembly')).toEqual(['a', 'b'])
        expect(shapesIn(m, 'parts')).toEqual([])
    })

    it('registers named sub-collections as groups', () =>
    {
        m.layer('sides')
        const sideFront = m.collection(m.box(10, 10, 10), m.box(10, 10, 10).moveX(20)).name('sideFront') as any
        m.layer('tabletop')
        const topPlanks = m.collection(m.box(100, 10, 2), m.box(100, 10, 2).moveY(20)).name('topPlanks') as any

        const table = m.collection(sideFront, topPlanks) as any

        expect(table.length).toBe(4)                            // shapes are flattened in, as before
        expect(table.groupNames()).toEqual(['sideFront', 'topPlanks'])
        expect(table.getGroup('topPlanks').length).toBe(2)
        expect(table.topPlanks.length).toBe(2)                  // shortcut property
        expect(table.group('sideFront')).toBe(table.getGroup('sideFront'))
    })

    it('does not group unnamed sub-collections', () =>
    {
        const table = m.collection(
            m.collection(m.box(10, 10, 10)),                    // still the default 'collection' name
            m.box(5, 5, 5),
        ) as any

        expect(table.length).toBe(2)
        expect(table.groupNames()).toEqual([])
    })

    it('group() also nests a named sub-collection as a sub-layer', () =>
    {
        m.layer('sides')
        const sideFront = m.collection(m.box(10, 10, 10).name('sideA')).name('sideFront') as any
        m.layer('tabletop')
        const top = m.box(100, 100, 2).name('top') as any

        const table = m.group(sideFront, top) as any
        table.name('table')

        expect(table.getGroup('sideFront').length).toBe(1)
        expect(shapesIn(m, 'sideFront')).toEqual(['sideA'])     // sub-layer under 'table'
        expect(shapesIn(m, 'table')).toEqual(['top'])           // ungrouped shapes stay flat
        expect(m.scene().findAll((n: any) => n.name === 'sideFront')[0].parent().name).toBe('table')
    })
})
