/**
 * tests/unit/runner/runner.import.test.ts
 *
 * End-to-end $import(): the runner pre-fetches string-literal asset URLs (global
 * fetch is stubbed to serve the local fixtures via the proxy path), then a
 * synchronous, no-await $import() in the script parses + attaches them to the scene.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

import type { RunnerScriptExecutionResult } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'

const fx = (name: string): Uint8Array =>
    new Uint8Array(readFileSync(new URL(`../../fixtures/importer/${name}`, import.meta.url)))

const SVG_VENUS = fx('venus.svg')
const GEO_SWITZERLAND = fx('switzerland.geojson')

/** Stub global fetch: map a proxied `/proxy?url=<enc>` back to a fixture. */
function stubProxy(map: Record<string, { bytes: Uint8Array; contentType: string }>): void
{
    vi.stubGlobal('fetch', vi.fn(async (input: string) =>
    {
        const url = decodeURIComponent(String(input).split('url=')[1] ?? '')
        const hit = map[url]
        if(!hit) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: 'no fixture' }) } as any
        return {
            ok: true,
            status: 200,
            headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? hit.contentType : null) },
            arrayBuffer: async () => hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength),
        } as any
    }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Runner — $import()', () =>
{
    it('imports an SVG with no await, names it, and adds it to the scene', async () =>
    {
        stubProxy({ 'http://assets/venus.svg': { bytes: SVG_VENUS, contentType: 'image/svg+xml' } })

        const runner = await new Runner().load()
        const result: RunnerScriptExecutionResult = await runner.execute({
            script: { code: `logo = $import('http://assets/venus.svg');` },
            outputs: ['default/model/glb'],
            assetProxyUrl: 'https://api.test',
        } as any)

        expect(result.status).toBe('success')

        const scope = runner.getActiveScope() as any
        expect(scope.logo?.isShapeCollection?.()).toBe(true)
        expect(scope.logo._name).toBe('logo')           // auto-named after the variable
        const shapes = scope.logo.toArray()
        expect(shapes.length).toBeGreaterThan(0)

        // The import sits under its own scene layer, named after the variable.
        expect(scope.logo._layer).toBeTruthy()
        expect(scope.logo._layer.name).toBe('logo')
        const importLayer = scope.modeler.scene().findAll((n: any) => n.name === 'logo')
        expect(importLayer.length).toBe(1)

        // Scene membership: the imported shapes are in the modeler scene.
        const sceneShapes = scope.modeler.all().toArray()
        expect(sceneShapes.length).toBeGreaterThanOrEqual(shapes.length)
    })

    it('auto-scales a degree-sized GeoJSON and warns on the console', async () =>
    {
        stubProxy({ 'http://api/ch': { bytes: GEO_SWITZERLAND, contentType: 'application/geo+json' } })

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: `ch = $import('http://api/ch');` },
            outputs: ['default/model/glb'],
            assetProxyUrl: 'https://api.test',
        } as any)

        expect(result.status).toBe('success')

        const scope = runner.getActiveScope() as any
        const max = scope.ch.bbox().maxSize()
        expect(max).toBeCloseTo(1000, 0) // fitted to a ~1000 scene

        const warns = scope._archiyou.console.getBufferedMessages(['warn']).map((m: any) => m.message).join('\n')
        expect(warns).toMatch(/auto-scaled ×/)
    })

    it('works in per-statement mode too', async () =>
    {
        stubProxy({ 'http://assets/venus.svg': { bytes: SVG_VENUS, contentType: 'image/svg+xml' } })

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: `base = box(5,5,5);\nlogo = $import('http://assets/venus.svg');` },
            outputs: ['default/model/glb'],
            assetProxyUrl: 'https://api.test',
            perStatement: true,
        } as any)

        expect(result.status).toBe('success')
        const scope = runner.getActiveScope() as any
        expect(scope.logo.toArray().length).toBeGreaterThan(0)
    })

    it('errors clearly when $import receives a dynamic (non-literal) URL', async () =>
    {
        stubProxy({}) // nothing pre-fetched

        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: `u = 'http://assets/venus.svg';\nbad = $import(u);` },
            outputs: ['default/model/glb'],
            assetProxyUrl: 'https://api.test',
        } as any)

        expect(result.status).toBe('error')
        const text = JSON.stringify(result.errors ?? result.messages ?? '')
        expect(text).toMatch(/string-literal URL/)
    })
})
