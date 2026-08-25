/**
 * Document images are fetched through the Archiyou asset proxy.
 *
 * Regression: the default titleblock logo silently vanished from documents on a
 * deployed editor while it rendered fine on a localhost dev server. A doc image is a
 * cross-origin GET from the browser, so it needs the same-origin proxy $import() uses —
 * without it CORS kills it, and behind a CSP with `connect-src 'self'` the request is
 * refused before it is even sent. The proxy was never wired into Docs at all, and the
 * fallback code POSTed a JSON body to a route that answers `GET /proxy?url=…`.
 */

import { describe, it, expect, afterEach } from 'vitest'

import { Runner } from '../../../src/runner/Runner'

const DOC_OUTPUTS = ['default/docs/*/svg']

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
afterEach(() => {
    globalThis.fetch = realFetch
    delete (globalThis as any).location
})

/** Pretend the run happens in a page served from `origin` (node has no location). */
function serveFrom(origin: string)
{
    ;(globalThis as any).location = { origin, href: `${origin}/editor` }
}

/** Replace fetch with a stub returning a 1x1 PNG; record url + init of every call. */
function stubFetch(): { calls: Array<{ url: string; init: any }> }
{
    const calls: Array<{ url: string; init: any }> = []
    globalThis.fetch = (async (input: any, init?: any) => {
        calls.push({ url: String(input), init })
        return {
            status: 200,
            arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
            text: async () => '<svg></svg>',
        } as any
    }) as any
    return { calls }
}

describe('Doc images through the asset proxy', () =>
{
    it('fetches through the request\'s assetProxyUrl, as a GET on /proxy?url=', async () =>
    {
        const { calls } = stubFetch()
        // Unique per test: the image cache is module-level and shared across runs.
        const url = 'https://cms.example.test/archiyou_logo.png'

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: scriptWithImage(url) },
            outputs: DOC_OUTPUTS,
            assetProxyUrl: '/api',
        } as any)

        expect(result.status).toBe('success')

        const imageCall = calls.find(c => c.url.includes(encodeURIComponent(url)))
        expect(imageCall).toBeDefined()
        expect(imageCall!.url).toBe(`/api/proxy?url=${encodeURIComponent(url)}`)
        // The proxy route answers GET with the url in the query — not a POSTed JSON body.
        expect(imageCall!.init?.method).toBe('GET')
        expect(imageCall!.init?.body).toBeUndefined()
        // ...and the third-party host is never contacted directly from the run.
        expect(calls.some(c => c.url === url)).toBe(false)
    }, 120000)

    it('treats an empty assetProxyUrl as the root-relative proxy', async () =>
    {
        const { calls } = stubFetch()
        const url = 'https://cms.example.test/logo-root-relative.png'

        const runner = await new Runner().load()
        await runner.execute({
            script: { code: scriptWithImage(url) },
            outputs: DOC_OUTPUTS,
            assetProxyUrl: '',
        } as any)

        expect(calls.some(c => c.url === `/proxy?url=${encodeURIComponent(url)}`)).toBe(true)
    }, 120000)

    it('fetches directly when no proxy is configured (server-side runs have no CORS)', async () =>
    {
        const { calls } = stubFetch()
        const url = 'https://cms.example.test/logo-direct.png'

        const runner = await new Runner().load()
        await runner.execute({ script: { code: scriptWithImage(url) }, outputs: DOC_OUTPUTS } as any)

        expect(calls.some(c => c.url === url)).toBe(true)
    }, 120000)
})

describe('Doc images on the app\'s own origin', () =>
{
    it('fetches a relative url straight off the page origin, never through the proxy', async () =>
    {
        // Shaped like the default titleblock logo: shipped by the editor at /img/, not a
        // remote host. (A distinct filename — the image cache is module-level, and the
        // real default path is exercised end-to-end further down.)
        serveFrom('https://next.example.test')
        const { calls } = stubFetch()

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: scriptWithImage('/img/relative-logo.png') },
            outputs: DOC_OUTPUTS,
            assetProxyUrl: '/api',
        } as any)

        expect(result.status).toBe('success')
        // Resolved against the ORIGIN explicitly — a blob: worker base would not resolve it.
        expect(calls.some(c => c.url === 'https://next.example.test/img/relative-logo.png')).toBe(true)
        // The proxy rejects relative urls ("Only http(s) URLs are allowed"), so sending
        // this one through it would break the one case that needs no help.
        expect(calls.some(c => c.url.includes('/proxy?url='))).toBe(false)
    }, 120000)

    it('does not proxy an absolute url that is already same-origin', async () =>
    {
        serveFrom('https://next.example.test')
        const { calls } = stubFetch()
        const url = 'https://next.example.test/img/same-origin-logo.png'

        const runner = await new Runner().load()
        await runner.execute({
            script: { code: scriptWithImage(url) },
            outputs: DOC_OUTPUTS,
            assetProxyUrl: '/api',
        } as any)

        expect(calls.some(c => c.url === url)).toBe(true)
        expect(calls.some(c => c.url.includes('/proxy?url='))).toBe(false)
    }, 120000)

    it('resolves a relative url against appBaseUrl when there is no page origin', async () =>
    {
        // A node-side run (POST /scripts/published/execute) has no location at all.
        // ExecutionWorker stamps appBaseUrl from the server's FRONTEND_URL.
        const { calls } = stubFetch()

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: scriptWithImage('/img/server-side-logo.png') },
            outputs: DOC_OUTPUTS,
            appBaseUrl: 'https://next.example.test',
        } as any)

        expect(result.status).toBe('success')
        expect(calls.some(c => c.url === 'https://next.example.test/img/server-side-logo.png')).toBe(true)
        expect(calls.some(c => c.url.includes('/proxy?url='))).toBe(false)
    }, 120000)

    it('prefers the real page origin over appBaseUrl', async () =>
    {
        // In the browser the origin the page is actually served from is the truth —
        // an appBaseUrl carried along from elsewhere must not override it.
        serveFrom('https://real.example.test')
        const { calls } = stubFetch()

        const runner = await new Runner().load()
        await runner.execute({
            script: { code: scriptWithImage('/img/origin-wins.png') },
            outputs: DOC_OUTPUTS,
            appBaseUrl: 'https://stale.example.test',
        } as any)

        expect(calls.some(c => c.url === 'https://real.example.test/img/origin-wins.png')).toBe(true)
        expect(calls.some(c => c.url.includes('stale.example.test'))).toBe(false)
    }, 120000)

    it('skips a relative image server-side with no origin AND no appBaseUrl, but still renders', async () =>
    {
        const { calls } = stubFetch()   // no serveFrom(): a node run has no location

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: scriptWithImage('/img/no-origin-here.png') },
            outputs: DOC_OUTPUTS,
        } as any)

        expect(result.status).toBe('success')
        expect(typeof result.outputs[0].output).toBe('string')
        // Nothing is guessed at: no half-formed url is requested.
        expect(calls.some(c => c.url.includes('no-origin-here'))).toBe(false)
    }, 120000)
})

describe('the default titleblock logo', () =>
{
    it('is the editor\'s own /img asset and ends up embedded in the document', async () =>
    {
        // The reported bug: on a deployed editor the titleblock logo was simply absent.
        serveFrom('https://next.example.test')
        const { calls } = stubFetch()

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: `
box(100);
doc.create('spec')
   .page('main')
   .titleblock({ title: 'Test', designer: 'Archiyou' });
` },
            outputs: DOC_OUTPUTS,
            assetProxyUrl: '/api',
        } as any)

        expect(result.status).toBe('success')
        expect(calls.some(c => c.url === 'https://next.example.test/img/archiyou_logo_header.png')).toBe(true)
        // …and the bytes are inlined into the svg, so the export carries its own logo.
        expect(String(result.outputs[0].output)).toContain('data:image/png;base64,')
    }, 120000)
})
