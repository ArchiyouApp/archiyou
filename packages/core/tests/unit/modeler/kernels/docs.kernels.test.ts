/**
 *  Doc pipelines and SVG export must work on BOTH kernels.
 *
 *  The docs module used to typeguard with `instanceof meshup.Shape`, which silently rejected
 *  everything the brep kernel produces — a brep doc pipeline failed with
 *  "not a Shape or ShapeCollection (got _ShapeCollection)". The guards are structural now
 *  (see modeler/typeguards.ts), and each shape is drawn by its OWN kernel's exporter:
 *  wrapping brep geometry in a meshup ShapeCollection renders nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Runner } from '../../../../src/runner/Runner'

/** The starter script: a boolean, a doc pipeline feeding an isometry view, and a metric. */
const CODE = `
myMainBox = box($SIZE).color($COLOR);
myMainBox.subtract(
      box($SIZE*0.5).color('blue')
        .moveTo(myMainBox.bbox().corner('leftfronttop'))
        .hide()
    )

doc.create('myDoc')
.pipeline(() => {
  iso = myMainBox.iso();
  return { iso }
})
.page('myPage')
.view('isometry')
.shapes('iso')
.text('MyText')

calc.metric('volume', Math.round(myMainBox.volume()), { unit: 'mm3', icon: 'box'})
`

const PARAMS = {
    SIZE:  { name: 'SIZE',  type: 'number', default: 100,   _value: 100 },
    COLOR: { name: 'COLOR', type: 'text',   default: 'red', _value: 'red' },
}

describe('doc pipeline + SVG export on both kernels', () =>
{
    let runner: Runner
    beforeAll(async () => { runner = await new Runner().load() }, 120_000)

    for (const kernel of ['mesh', 'brep'] as const)
    {
        it(`runs and renders the isometry view on ${kernel}`, async () =>
        {
            const result: any = await runner.execute({
                kernel,
                script: { code: CODE, params: PARAMS },
                outputs: ['default/model/glb', 'default/docs/*/svg'],
                messages: ['error'],
            } as any)

            expect(result.errors ?? []).toEqual([])
            expect(result.status).toEqual('success')

            const svgOutput = result.outputs?.find((o: any) =>
                String(o.path.requestedPath).includes('svg'))
            const svg = typeof svgOutput?.output === 'string' ? svgOutput.output : ''

            // real drawn geometry, not just an empty frame
            expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(0)
            expect(svg).toContain('MyText')

            // …and it must be VISIBLE: SVG's default stroke is `none`, so the drawing only
            // renders because it ships a stylesheet. Both kernels must supply one.
            //
            // NOTE: the rule is SCOPED to the view that owns it. A page holds several
            // drawings whose stylesheets all land in one document (each view's outer <svg> is
            // stripped when it is placed), so a page-wide `.line{stroke-width:…}` from one
            // view restyled every other drawing on the page — last one winning.
            expect(svg).toMatch(/\.ay-[a-z0-9-]+ \.line\{fill:none;stroke:black;stroke-width:[\d.]+;/)
        }, 180_000)
    }
})
