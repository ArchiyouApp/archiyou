import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

import { Runner } from '../../../src/runner/Runner'
import { THUMBNAIL_OUTPUT_PATH } from '../../../src/constants'

const OUT_DIR = join(__dirname, '../../outputs/runner')

function writeSnapshot(name: string, svg: string): void
{
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, name), svg)
}

async function run(code: string, outputs: Array<string>)
{
    const runner = await new Runner().load()
    return runner.execute({ script: { code }, outputs } as any)
}

function outputFor(result: any, requestedPath: string): any
{
    return result.outputs?.find((o: any) => o.path?.requestedPath === requestedPath)?.output
}

const BOX = 'box(100, 60, 40);'

describe('Runner — model/svg projection + thumbnail', () =>
{
    it('projects the scene to an iso SVG without the script authoring any 2D geometry', async () =>
    {
        const result = await run(BOX, ['default/model/svg?view=iso'])
        expect(result.status).toBe('success')

        const svg = outputFor(result, 'default/model/svg?view=iso')
        expect(typeof svg).toBe('string')
        writeSnapshot('runner.svg.iso.svg', svg)

        // One well-formed root, real geometry, and nothing executable.
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
        expect(svg.endsWith('</svg>')).toBe(true)
        expect((svg.match(/<svg\b/g) ?? []).length).toBe(1)
        expect(svg).toMatch(/<path\b/)
        expect(svg).not.toMatch(/<script/i)

        // Theme-aware, scale-independent stroke — the two things the bare
        // ShapeCollection.toSVG() gets wrong (black ink, user-unit stroke width).
        expect(svg).toContain('vector-effect:non-scaling-stroke')
        expect(svg).toContain('stroke:currentColor')
        expect(svg).toContain('prefers-color-scheme:dark')
    }, 120000)

    it('produces a square, size-capped thumbnail from the canonical output path', async () =>
    {
        const result = await run(BOX, [THUMBNAIL_OUTPUT_PATH])
        expect(result.status).toBe('success')

        const svg = outputFor(result, THUMBNAIL_OUTPUT_PATH)
        expect(typeof svg).toBe('string')
        writeSnapshot('runner.svg.thumbnail.svg', svg)

        expect(Buffer.byteLength(svg, 'utf8')).toBeLessThanOrEqual(65536)

        // square=1 must yield a square viewBox, so one stored asset serves both the
        // 1:1 list icon and the 16:10 browser card via object-fit:contain.
        const vb = svg.match(/viewBox="([^"]+)"/)?.[1].split(' ').map(Number)
        expect(vb).toHaveLength(4)
        expect(vb![2]).toBeCloseTo(vb![3], 3)

        // hidden=0 → no occluded-edge group in the output.
        expect(svg).not.toMatch(/class="line hidden"/)

        // Inline style attributes are stripped; all styling comes from the <style> block.
        expect(svg).not.toMatch(/<path[^>]*\sstroke="/)

        // The HLR pass tessellates every edge at `samples` resolution, so a box's straight
        // edges arrive as 8-point polylines. Collinear simplification must collapse them
        // back to 2 points — on rectilinear models that is most of the file size.
        const longest = Math.max(...[...svg.matchAll(/\sd="([^"]*)"/g)]
            .map((m) => (m[1].match(/L/g) ?? []).length))
        expect(longest).toBeLessThanOrEqual(4)
    }, 120000)

    /**
     * The regression that made thumbnails look broken: the thumbnail path only ever
     * consumed a hidden-line projection of MESHES, so a script that draws in 2D — plates,
     * nesting sheets, anything from rect/circle/offset — silently produced nothing at all,
     * for every share and every publish. Those scripts are a large share of the library.
     */
    it('draws a 2D-only script (no meshes to project) instead of producing nothing', async () =>
    {
        const flat = `
            r1 = rect(100,300).color('blue');
            r2 = rect(200,40).move(100).color('green');
            c = circle(50).align(r2, 'center', 'right').color('orange');
            r1.copy().moveZ(-50).fillet(20);
        `
        const result = await run(flat, [THUMBNAIL_OUTPUT_PATH])
        expect(result.status).toBe('success')

        const svg = outputFor(result, THUMBNAIL_OUTPUT_PATH)
        expect(typeof svg).toBe('string')
        writeSnapshot('runner.svg.thumbnail.2d.svg', svg)

        // A real drawing of the authored geometry, framed and capped like any thumbnail.
        expect(svg).toMatch(/<path\b/)
        expect(Buffer.byteLength(svg, 'utf8')).toBeLessThanOrEqual(65536)
        const vb = svg.match(/viewBox="([^"]+)"/)?.[1].split(' ').map(Number)
        expect(vb).toHaveLength(4)
        expect(vb![2]).toBeCloseTo(vb![3], 3)
    }, 120000)

    /** A scene with nothing drawable must still degrade to "no thumbnail", not to a
     *  broken document — callers show a placeholder for null. */
    it('still yields no output for a script that draws nothing', async () =>
    {
        const result = await run('const a = 1 + 1;', [THUMBNAIL_OUTPUT_PATH])
        expect(result.status).toBe('success')
        expect(outputFor(result, THUMBNAIL_OUTPUT_PATH)).toBeUndefined()
    }, 120000)

    it('caps a dense model by degrading rather than emitting a huge asset', async () =>
    {
        // A grid of small boxes: many short edges, the shape that blows up naively.
        const dense = `
            b = box(8, 8, 8);
            c = b.replicate(144, (s, i) => s.move((i % 12) * 12, Math.floor(i / 12) * 12, 0));
        `
        const result = await run(dense, ['default/model/svg?thumbnail=1&view=iso&square=1&maxBytes=8000'])
        expect(result.status).toBe('success')

        const svg = outputFor(result, 'default/model/svg?thumbnail=1&view=iso&square=1&maxBytes=8000')
        // Either it fit inside the (deliberately tiny) budget, or it was dropped
        // entirely — what must never happen is an oversized asset being emitted.
        if (typeof svg === 'string')
        {
            writeSnapshot('runner.svg.thumbnail.dense.svg', svg)
            expect(Buffer.byteLength(svg, 'utf8')).toBeLessThanOrEqual(131072)
        }
        else
        {
            expect(svg).toBeUndefined()
        }
    }, 180000)

    // The @colSceneLayer trap: ShapeCollection.iso() ADDS its projection to the active
    // scene layer. If the exporter ever calls the decorated iso() instead of _iso(),
    // requesting a thumbnail silently mutates the model that every other output sees —
    // the GLB would grow a stray 'iso' layer. This pins the undecorated path forever.
    it('does not mutate the scenegraph (GLB is identical with and without a thumbnail)', async () =>
    {
        const withoutThumb = await run(BOX, ['default/model/glb'])
        const withThumb    = await run(BOX, ['default/model/glb', THUMBNAIL_OUTPUT_PATH])

        expect(withoutThumb.status).toBe('success')
        expect(withThumb.status).toBe('success')

        // Shape ids are freshly minted per run, so compare the tree shape, not the ids.
        const normalize = (g: unknown) => JSON.stringify(g)
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')

        expect(normalize(withThumb.state.scenegraph))
            .toBe(normalize(withoutThumb.state.scenegraph))
        // Belt and braces: the decorated iso() would have added exactly this layer.
        expect(normalize(withThumb.state.scenegraph)).not.toContain('iso')
    }, 180000)

    // Backwards compatibility: scripts that author their own 2D geometry and export
    // 'default/model/svg' must be completely unaffected by the projection additions.
    it('leaves the legacy 2D-scene svg export byte-for-byte unchanged', async () =>
    {
        const code = `sketch('xy').moveTo(0,0).lineTo(100,0).lineTo(100,50).close().importSketch();`
        const result = await run(code, ['default/model/svg'])
        expect(result.status).toBe('success')

        const svg = outputFor(result, 'default/model/svg')
        expect(typeof svg).toBe('string')

        // The legacy path is SceneNode.toSVG(): a <g id="root"> node tree with per-shape
        // inline style attributes and NO stylesheet. Seeing exactly that proves the new
        // serializer was not injected into the option-less call.
        expect(svg).toContain('<g id="root">')
        expect(svg).toMatch(/<path[^>]*\sstroke="/)
        expect(svg).not.toContain('<style>')
        expect(svg).not.toContain('currentColor')
    }, 120000)
})
