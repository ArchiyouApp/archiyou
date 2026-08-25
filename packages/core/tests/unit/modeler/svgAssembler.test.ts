/** buildSVGDocument() — the single writer of an Archiyou drawing.
 *
 *  Contributors (a geometry kernel, the annotator, a view's caption) hand it elements and the
 *  room they take; it decides the frame, the stylesheet and the line weight. Those are
 *  properties of the document, and a document has exactly one of each — which is precisely
 *  what went wrong while every kernel wrote its own.
 */
import { describe, expect, it } from 'vitest'

import { buildSVGDocument, type SVGLayer } from '../../../src/modeler/SVGExporter'

const layer = (elements: Array<string>, box: SVGLayer['box'], cssClass?: string): SVGLayer =>
    ({ elements, box, cssClass })

const box = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY })

const line = '<path class="line" d="M 0 0 L 100 0"/>'

const viewBoxOf = (svg: string) => svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number)
const extentsOf = (svg: string) => svg.match(/data-extents="([^"]+)"/)![1].split(/\s+/).map(Number)

describe('buildSVGDocument', () =>
{
    it('returns null when there is nothing to draw', () =>
    {
        expect(buildSVGDocument({ layers: [] })).toBeNull()
        expect(buildSVGDocument({ layers: [layer([], box(0, 0, 10, 10))] })).toBeNull()
        expect(buildSVGDocument({ layers: [layer([line], null)] })).toBeNull() // no room, no frame
    })

    it('frames the union of its layers and publishes the unframed extents', () =>
    {
        const svg = buildSVGDocument({
            layers: [
                layer([line], box(0, 0, 100, 10)),
                layer(['<line class="annotation"/>'], box(-30, -5, 100, 10)), // a dimension, outside the geometry
            ],
            frame: { mode: 'fit', padding: 0 },
        })!

        expect(viewBoxOf(svg)).toEqual([-30, -5, 130, 15])
        expect(extentsOf(svg)).toEqual([-30, -5, 130, 15])
    })

    it('imposes a scale: the viewBox spans the page area, whatever the drawing measures', () =>
    {
        // 40x20mm of page at 100 model units per mm = a 4000x2000 unit window
        const svg = buildSVGDocument({
            layers: [layer([line], box(0, 0, 1000, 500))],
            frame: { mode: 'scale', unitsPerMm: 100, wMm: 40, hMm: 20 },
        })!

        const vb = viewBoxOf(svg)
        expect(vb[2]).toBeCloseTo(4000, 6)
        expect(vb[3]).toBeCloseTo(2000, 6)
        // centered by default: equal slack on both sides
        expect(vb[0]).toBeCloseTo(0 - (4000 - 1000) / 2, 6)
        expect(vb[1]).toBeCloseTo(0 - (2000 - 500) / 2, 6)

        // the drawing keeps its own size — 1000 units is 10mm on a 40mm-wide view
        expect(1000 / (vb[2] / 40)).toBeCloseTo(10, 6)
    })

    it('anchors a scaled frame per align', () =>
    {
        const at = (align: any) => viewBoxOf(buildSVGDocument({
            layers: [layer([line], box(0, 0, 1000, 500))],
            frame: { mode: 'scale', unitsPerMm: 100, wMm: 40, hMm: 20, align },
        })!)

        expect(at(['left', 'top'])[0]).toBeCloseTo(0, 6)
        expect(at(['left', 'top'])[1]).toBeCloseTo(0, 6)          // svg y: 'top' is the box start
        expect(at(['right', 'bottom'])[0]).toBeCloseTo(1000 - 4000, 6)
        expect(at(['right', 'bottom'])[1]).toBeCloseTo(500 - 2000, 6)
    })

    it('draws in device pixels by default and in real millimeters when asked', () =>
    {
        const device = buildSVGDocument({ layers: [layer([line], box(0, 0, 100, 10))] })!
        expect(device).toContain('vector-effect:non-scaling-stroke')

        // 0.25mm at 100 units/mm is 25 units of stroke
        const paper = buildSVGDocument({
            layers: [layer([line], box(0, 0, 100, 10))],
            stroke: { mode: 'mm', widthMm: 0.25, unitsPerMm: 100 },
        })!
        expect(paper).toContain('stroke-width:25')
        expect(paper).not.toContain('vector-effect')
    })

    it('scopes its stylesheet so two drawings on one page cannot restyle each other', () =>
    {
        const svg = buildSVGDocument({
            layers: [layer([line], box(0, 0, 100, 10))],
            stroke: { mode: 'mm', widthMm: 0.25, unitsPerMm: 100 },
            scoped: 'ay-view-2',
        })!

        expect(svg).toContain('.ay-view-2 .line{')
        expect(svg).toContain('<g class="ay-view-2">')
        expect(svg).not.toMatch(/<style>[^<]*[^ ]\.line\{/) // no unscoped .line rule
    })

    it('wraps a layer in its own group when it names a class', () =>
    {
        const svg = buildSVGDocument({
            layers: [
                layer([line], box(0, 0, 100, 10)),
                layer(['<g class="dimensionline"/>'], box(0, -20, 100, 10), 'annotations'),
            ],
        })!

        expect(svg).toContain('<g class="annotations"><g class="dimensionline"/></g>')
    })
})
