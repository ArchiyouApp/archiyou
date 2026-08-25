/**
 * Document images are fetched once per URL — not once per output, per page.
 *
 * Regression: a titleblock places a (remote) logo, and the editor asks for BOTH
 * `docs/*​/svg` and `docs/*​/svg-pages`. Each render built its own cache, so the same
 * image was downloaded once per output. With a slow or unreachable host that turned a
 * ~200ms document into a multi-second one (6s here, 15s+ in the browser, where the
 * request additionally goes through the server proxy), and there was no timeout at all.
 */

import { describe, it, expect, afterEach } from 'vitest'

import { Runner } from '../../../src/runner/Runner'

const DOC_OUTPUTS = ['default/docs/*/svg', 'default/docs/*/svg-pages']

/** Script placing `url` as an image in a one-page document. */
const scriptWithImage = (url: string) => `
box(100);
doc.create('imgDoc')
   .page('imgPage')
   .image('${url}')
   .width('30mm')
   .height('8mm');
`

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** Replace fetch with a stub returning a 1x1 PNG, and count the calls per URL. */
function stubFetch(): { calls: string[] }
{
    const calls: string[] = []
    globalThis.fetch = (async (input: any) => {
        calls.push(String(input))
        return {
            status: 200,
            arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
            text: async () => '<svg></svg>',
        } as any
    }) as any
    return { calls }
}

describe('Doc images', () =>
{
    it('fetches an image once even though the doc is rendered for several outputs', async () =>
    {
        const { calls } = stubFetch()
        // Unique per test: the cache is module-level and shared across runs by design.
        const url = 'https://example.test/logo-once.png'

        const runner = await new Runner().load()
        const result = await runner.execute({ script: { code: scriptWithImage(url) }, outputs: DOC_OUTPUTS } as any)

        expect(result.status).toBe('success')
        expect(result.outputs.length).toBe(2)              // both renders happened
        expect(calls.filter(u => u === url).length).toBe(1) // …off one download
    }, 120000)

    it('reuses the cached image on a re-run (the editor re-runs on every param change)', async () =>
    {
        const { calls } = stubFetch()
        const url = 'https://example.test/logo-rerun.png'
        const runner = await new Runner().load()

        await runner.execute({ script: { code: scriptWithImage(url) }, outputs: DOC_OUTPUTS } as any)
        const before = calls.filter(u => u === url).length
        await runner.execute({ script: { code: scriptWithImage(url) }, outputs: DOC_OUTPUTS } as any)

        expect(before).toBe(1)
        expect(calls.filter(u => u === url).length).toBe(1) // second run added none
    }, 120000)

    it('keeps rendering the document when an image cannot be loaded', async () =>
    {
        globalThis.fetch = (async () => { throw new Error('host unreachable') }) as any

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: scriptWithImage('https://example.test/does-not-exist.png') },
            outputs: DOC_OUTPUTS,
        } as any)

        // The image is skipped; the document itself still exports.
        expect(result.status).toBe('success')
        expect(typeof result.outputs[0].output).toBe('string')
    }, 120000)
})
