/** A layer colour must survive .dashed() / .lineWidth() on the shapes inside it.
 *
 *  REGRESSION: those two set `style.stroke`, and meshup's Style used to mark the WHOLE stroke
 *  object explicit — so explicitData() handed the cascade SHAPE_DEFAULT_STYLE's red stroke
 *  colour as if the author had picked it, and every dashed line came out red on a blue layer.
 *  Reported from a URBENT script: `layer('diagram').color('blue')` + `polyline(...).dashed()`.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Style } from '@archiyou/meshup'
import { Modeler } from '../../../src/modeler/Modeler'

/** The style a shape actually renders with: its scene node's cascaded style as the base, its
 *  own explicit properties on top. Exactly what GLTFBuilder does when it exports the shape. */
const rendered = (shape: any): Style =>
{
    const node = shape.node?.() ?? null
    const eff = new Style(node ? node.effectiveStyle().toData() : undefined)
    eff.merge(shape.style.explicitData() as any)
    return eff
}

describe('layer colour cascades onto dashed shapes', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    it('a dashed polyline on a blue layer is blue, not red', () =>
    {
        m.layer('diagram').color('blue')
        const roofLine = m.polyline([0, 0, 0], [1000, 0, 500], [2000, 0, 300]).dashed() as any

        const style = rendered(roofLine)
        expect(style.strokeColor).toBe('#0000ff')
        expect(style.strokeColor).not.toBe('#ff0000')
        expect(style.color).toBe('#0000ff')
        expect(style.strokeDash.length).toBeGreaterThan(0)
    })

    it('a dashed line on a blue layer is blue', () =>
    {
        m.layer('diagram').color('blue')
        const line = m.line([0, 0, 0], [2000, 0, 500]).dashed() as any

        expect(rendered(line).strokeColor).toBe('#0000ff')
    })

    it('the shape only claims the dash, nothing else', () =>
    {
        m.layer('diagram').color('blue')
        const line = m.line([0, 0, 0], [1000, 0, 0]).dashed() as any

        // The whole point: a dash must not drag stroke.color/width along into the cascade.
        expect(Object.keys(line.style.explicitData().stroke ?? {})).toEqual(['dash'])
    })

    it('a colour set on the shape itself still wins over the layer', () =>
    {
        m.layer('diagram').color('blue')
        const line = m.line([0, 0, 0], [1000, 0, 0]).dashed().color('green') as any

        expect(rendered(line).strokeColor).toBe('#008000')
    })

    it('a layer stroke width survives a shape that only dashes', () =>
    {
        const layer = m.layer('diagram')
        layer.color('blue')
        layer.style.strokeWidth = 7

        const line = m.line([0, 0, 0], [1000, 0, 0]).dashed() as any

        const style = rendered(line)
        expect(style.strokeWidth).toBe(7)
        expect(style.strokeColor).toBe('#0000ff')
    })
})
