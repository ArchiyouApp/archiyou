/**
 *  SVG styling: only DELIBERATE styling is written inline.
 *
 *  Anything the author did not set is left to the document's CSS classes (`line`, `dashed`, …),
 *  which is what the mesh kernel does — it emits bare `<path class="line silhouette"/>`. brep
 *  used to bake the kernel defaults into every path, so the same drawing came out thick and red
 *  on brep and thin and black on mesh, and a projection looked like the object it came from.
 */
import { describe, test, beforeAll, expect } from 'vitest'
import * as brep from '../../../src/modeler/brep/index'

const firstPath = (svg: string) => (svg.match(/<path[^>]*>/) ?? [''])[0]

beforeAll(async () => { await brep.init() })

describe('brep SVG styling', () =>
{
    test('the drawing ships a stylesheet, so unstyled lines are visible', () =>
    {
        // SVG's default stroke is `none` — without this block a drawing with no inline
        // styling renders as nothing at all. Matches the mesh kernel's block exactly.
        const svg = new brep.Wire().makeRect(100, 50).toSVG()
        expect(svg).toMatch(/<style>\.line\{fill:none;stroke:black;stroke-width:[\d.]+;/)
    })

    test('an unstyled Shape writes NO inline styling — the stylesheet decides', () =>
    {
        const path = firstPath(new brep.Wire().makeRect(100, 50).toSVG())
        expect(path).not.toMatch(/style="/)
        expect(path).toContain('class="line"')
    })

    test('deliberate styling IS written inline', () =>
    {
        // as an inline STYLE, not a presentation attribute: CSS rules beat presentation
        // attributes, so `stroke="blue"` would lose to the .line rule above
        const path = firstPath(new brep.Wire().makeRect(100, 50).color('blue').lineWidth(3).toSVG())
        expect(path).toContain('style="')
        expect(path).toContain('stroke:#0000ff')
        expect(path).toContain('stroke-width:3')
    })

    test('dashed() writes the pattern only — not the default colour and width', () =>
    {
        const path = firstPath(new brep.Wire().makeRect(100, 50).dashed([4, 4]).toSVG())
        expect(path).toContain('stroke-dasharray:4 4')
        expect(path).toContain('dashed')
        // meshup's Style marks the whole `stroke` object explicit when any part is set; those
        // still-default values must not leak out as if the author chose them
        expect(path).not.toMatch(/stroke:#/)
        expect(path).not.toMatch(/stroke-width:/)
    })

    test('style set on a Wire reaches the Edges it is drawn from', () =>
    {
        // the author styles the Wire; toSVG() draws its Edges, which carry no style of their own
        const path = firstPath(new brep.Wire().makeRect(100, 50).color('blue').toSVG())
        expect(path).toContain('stroke:#0000ff')
    })

    test('a projection does not inherit the styling of the shape it came from', () =>
    {
        const box = new brep.Solid().makeBox(100).color('blue')
        const iso = box.iso() as any
        const path = firstPath(iso.toSVG())

        // a technical drawing is its own thing — neutral, for the stylesheet to render
        expect(path).not.toMatch(/style="/)
    })
})

describe('SVG orientation', () =>
{
    test('the drawing is flipped in Y, not X — SVG y-axis points down', () =>
    {
        // asymmetric on purpose: a symmetric shape hides a wrong flip
        const w = new brep.Wire().fromVertices([[0, 0, 0], [100, 0, 0], [0, 50, 0]] as any).close()
        const svg = w.toSVG()

        const coords: Array<[number, number]> = []
        ;(svg.match(/ d="([^"]*)"/g) ?? []).forEach(d =>
        {
            const c = (d.match(/-?[\d.]+/g) ?? []).map(Number)
            for (let i = 0; i + 1 < c.length; i += 2) coords.push([c[i], c[i + 1]])
        })

        const xs = coords.map(c => c[0])
        const ys = coords.map(c => c[1])

        // world x stays 0..100, world y 0..50 becomes -50..0
        expect(Math.min(...xs)).toBeCloseTo(0, 1)
        expect(Math.max(...xs)).toBeCloseTo(100, 1)
        expect(Math.min(...ys)).toBeCloseTo(-50, 1)
        expect(Math.max(...ys)).toBeCloseTo(0, 1)

        // ...and the viewBox frames exactly that, so nothing lands outside the drawing
        const vb = (svg.match(/viewBox="([^"]*)"/) ?? [])[1]?.split(' ').map(Number) ?? []
        expect(vb[1]).toBeLessThan(0)                       // starts above the flipped geometry
        expect(vb[1] + vb[3]).toBeGreaterThanOrEqual(0)     // ...and reaches past its bottom

        // Dimension-line annotations negate y themselves (AnnotatorDimensionLine.toSVG), so
        // geometry must use the SAME axis or annotations sit on the wrong side.
    })
})
