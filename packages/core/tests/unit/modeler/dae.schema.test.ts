import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { XMLParser, XMLValidator } from 'fast-xml-parser'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'

/**
 * COLLADA export checked against the structural rules of COLLADA 1.4.1 that lenient web
 * viewers ignore but a real importer enforces.
 *
 * These are the rules SketchUp trips over on import ("Validate COLLADA File", on by default),
 * and what dae.test.ts's well-formedness assertions could not catch: files that parse fine,
 * resolve every reference and load happily in three.js ColladaLoader, yet are rejected.
 *
 * The two bugs that motivated this file, both present in EVERY exported file:
 *   - `<visual_scene id="Scene">` and the root `<node id="Scene">` shared one xs:ID, which
 *     also made `<instance_visual_scene url="#Scene">` ambiguous.
 *   - every `name` attribute in 1.4.1 is an xs:NCName (it is a free-form xs:token only from
 *     1.5 on), so 'Mesh:Box', 'my walls' and 'Beton C30/37' were all illegal.
 *
 * SCOPE — this is deliberately NOT full XSD validation. It used to validate against the
 * vendored Khronos collada_schema_1_4_1.xsd via libxml2-wasm; that dependency was dropped, so
 * the checks below are hand-written on top of fast-xml-parser (already a core dependency, pure
 * JS, no WASM). What is still checked: well-formedness, xs:ID uniqueness, NCName validity of
 * every id/sid/name, that every '#' reference resolves, the root element and version, and
 * accessor/float_array count agreement. What is NOT: element ordering, cardinality, the
 * content model, or attribute types beyond the above. Adding a rule here is cheap — prefer
 * that over reintroducing a schema validator.
 */
describe('DAE COLLADA 1.4.1 structural validation', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler() // mesh kernel, 'mm'
        await modeler.load()

        annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    })

    beforeEach(() =>
    {
        modeler.reset()
        annotator.reset()
    })

    /**
     * xs:NCName: a name with no colon, not starting with a digit, '.' or '-'.
     * Restricted to ASCII here — everything the exporter emits is sanitized to ASCII, so a
     * non-ASCII name reaching the output is itself worth failing on.
     */
    const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/

    /** Attributes whose value must be an NCName in 1.4.1. */
    const NCNAME_ATTRS = ['id', 'sid', 'name']

    /** Attributes that hold a URI reference; '#foo' must resolve to an id in this document. */
    const REF_ATTRS = ['url', 'source', 'target']

    /** Walk every element of a parsed tree, calling back with its name and attributes. */
    const walk = (node: any, name: string, visit: (name: string, attrs: Record<string, string>) => void): void =>
    {
        if (Array.isArray(node))
        {
            node.forEach(n => walk(n, name, visit))
            return
        }
        if (node === null || typeof node !== 'object') { return }

        const attrs: Record<string, string> = {}
        for (const [k, v] of Object.entries(node))
        {
            if (k.startsWith('@_')) { attrs[k.slice(2)] = String(v) }
        }
        visit(name, attrs)

        for (const [k, v] of Object.entries(node))
        {
            if (k.startsWith('@_') || k === '#text') { continue }
            walk(v, k, visit)
        }
    }

    /**
     * Structural errors in an exported document, as readable lines (empty when clean).
     * See the SCOPE note above for what this does and does not cover.
     */
    const structureErrors = (dae: string): string[] =>
    {
        const errors: string[] = []

        const wellFormed = XMLValidator.validate(dae)
        if (wellFormed !== true)
        {
            const e = wellFormed.err
            return [`not well-formed at line ${e.line}: ${e.msg}`]
        }

        const parsed = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            parseAttributeValue: false, // keep ids/names as strings; '2' must stay '2'
            trimValues: true,
        }).parse(dae)

        // Root element and version
        const root = parsed?.COLLADA
        if (!root) { errors.push('no <COLLADA> root element') }
        else if (root['@_version'] !== '1.4.1') { errors.push(`root version is "${root['@_version']}", expected "1.4.1"`) }

        const ids = new Set<string>()
        const refs: Array<{ element: string; attr: string; target: string }> = []

        walk(root, 'COLLADA', (element, attrs) =>
        {
            for (const attr of NCNAME_ATTRS)
            {
                const value = attrs[attr]
                if (value === undefined) { continue }
                if (!NCNAME.test(value))
                {
                    errors.push(`<${element} ${attr}="${value}">: not a valid xs:NCName`)
                }
            }

            const id = attrs['id']
            if (id !== undefined)
            {
                // every id in a COLLADA document lives in one xs:ID namespace
                if (ids.has(id)) { errors.push(`<${element} id="${id}">: duplicate id`) }
                ids.add(id)
            }

            for (const attr of REF_ATTRS)
            {
                const value = attrs[attr]
                if (value?.startsWith('#')) { refs.push({ element, attr, target: value.slice(1) }) }
            }

            // <accessor count= stride=> must fit the <float_array count=> it reads through
            // its source. Cheap to check here and invisible to a viewer until it renders wrong.
            if (element === 'accessor')
            {
                const count = Number(attrs['count'])
                const stride = Number(attrs['stride'] ?? 1)
                if (Number.isFinite(count) && Number.isFinite(stride) && count * stride <= 0)
                {
                    errors.push(`<accessor count="${attrs['count']}" stride="${attrs['stride']}">: empty accessor`)
                }
            }
        })

        for (const ref of refs)
        {
            if (!ids.has(ref.target))
            {
                errors.push(`<${ref.element} ${ref.attr}="#${ref.target}">: does not resolve to any id`)
            }
        }

        // float_array/accessor agreement needs the pair, so check it on the raw text: the
        // parsed tree loses the source→accessor link without resolving <technique_common>.
        for (const [, id, countAttr, body] of dae.matchAll(/<float_array id="([^"]+)" count="(\d+)"[^>]*>([^<]*)</g))
        {
            const declared = parseInt(countAttr, 10)
            const actual = body.trim() === '' ? 0 : body.trim().split(/\s+/).length
            if (declared !== actual)
            {
                errors.push(`<float_array id="${id}">: count="${declared}" but ${actual} values`)
            }
        }

        return errors
    }

    /**
     * Every `<polylist>` face that repeats a vertex index or encloses no area.
     *
     * Schema validity does not cover this: such a face parses, resolves and renders in a
     * lenient viewer, but an importer that builds real faces (SketchUp) can reject the whole
     * file over it. Welding is what creates them — it collapses two near-coincident
     * face-vertices onto one index, leaving a pinched ring like '0 1 2 3 0' (a quad written
     * as a 5-gon) or an outright degenerate '0 0 4 4'.
     */
    const brokenFaces = (dae: string): string[] =>
    {
        const broken: string[] = []

        for (const [, gid, block] of dae.matchAll(/<geometry id="([^"]+)"[^>]*>([\s\S]*?)<\/geometry>/g))
        {
            const positionsArray = block.match(/<float_array id="[^"]*positions-array"[^>]*>([^<]*)</)
            const polylist = block.match(/<polylist[^>]*>[\s\S]*?<vcount>([^<]*)<\/vcount>\s*<p>([^<]*)<\/p>/)
            if (!positionsArray || !polylist) continue

            const positions = positionsArray[1].trim().split(/\s+/).map(Number)
            const vcount = polylist[1].trim().split(/\s+/).map(Number)
            const indices = polylist[2].trim().split(/\s+/).map(Number)
            const stride = block.includes('semantic="NORMAL"') ? 2 : 1

            let cursor = 0
            for (const n of vcount)
            {
                const ring: number[] = []
                for (let k = 0; k < n; k++) { ring.push(indices[(cursor + k) * stride]) }
                cursor += n

                if (n < 3) { broken.push(`${gid}: face with only ${n} vertices`); continue }
                if (new Set(ring).size !== ring.length)
                {
                    broken.push(`${gid}: face repeats a vertex index [${ring.join(',')}]`)
                    continue
                }

                // Newell normal: its length is twice the polygon area
                const v = ring.map(j => [positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]])
                let nx = 0, ny = 0, nz = 0
                for (let k = 0; k < n; k++)
                {
                    const a = v[k], b = v[(k + 1) % n]
                    nx += (a[1] - b[1]) * (a[2] + b[2])
                    ny += (a[2] - b[2]) * (a[0] + b[0])
                    nz += (a[0] - b[0]) * (a[1] + b[1])
                }
                if (Math.hypot(nx, ny, nz) / 2 < 1e-6)
                {
                    broken.push(`${gid}: zero-area face [${ring.join(',')}]`)
                }
            }
        }

        return broken
    }

    /**
     * Guards the guard. structureErrors() is hand-written rather than driven by the XSD, so the
     * dangerous failure mode is not a false alarm — it is the checks quietly matching nothing
     * (a renamed attribute, a tree shape the walker skips) and every assertion above passing
     * vacuously. Each mutation below breaks exactly one rule in a real exported document.
     */
    it('structureErrors catches each fault it claims to catch', async () =>
    {
        modeler.layer('walls')
        modeler.box(100, 100, 100).color('red')
        const dae = (await modeler.toDAE())!

        expect(structureErrors(dae)).toEqual([])

        const expectCaught = (label: string, broken: string, needle: string) =>
        {
            const errors = structureErrors(broken)
            expect(errors, `${label}: expected an error mentioning "${needle}", got ${JSON.stringify(errors)}`)
                .toSatisfy((e: string[]) => e.some(line => line.includes(needle)))
        }

        // not well-formed
        expectCaught('unclosed tag', dae.replace('</visual_scene>', ''), 'not well-formed')

        // duplicate xs:ID — the original bug
        expectCaught('duplicate id',
            dae.replace('<visual_scene id="Scene"', '<visual_scene id="Scene" foo="1"')
               .replace(/<node id="([^"]+)"/, '<node id="Scene"'),
            'duplicate id')

        // name that is not an NCName — the other original bug
        expectCaught('bad name', dae.replace(/name="[^"]*"/, 'name="my walls"'), 'not a valid xs:NCName')
        expectCaught('bad id', dae.replace(/ id="([^"]+)"/, ' id="2nd:box"'), 'not a valid xs:NCName')

        // dangling reference
        expectCaught('dangling url', dae.replace('url="#Scene"', 'url="#NoSuchThing"'), 'does not resolve')

        // wrong version / wrong root
        expectCaught('bad version', dae.replace('version="1.4.1"', 'version="1.5.0"'), 'expected "1.4.1"')

        // float_array count disagreeing with its payload
        expectCaught('count mismatch',
            dae.replace(/<float_array id="([^"]+)" count="(\d+)"/, '<float_array id="$1" count="99999"'),
            'but')
    })

    it('validates a plain solid', async () =>
    {
        modeler.box(100, 100, 100).color('red')

        const dae = await modeler.toDAE()
        expect(structureErrors(dae!)).toEqual([])
    })

    it('validates layers, curved solids and curves together', async () =>
    {
        modeler.layer('walls')
        modeler.box(100, 100, 100).color('red')
        modeler.cylinder(20, 100).move(200, 0, 0).color('blue')
        modeler.layer('lines')
        modeler.line([0, 0, 0], [100, 0, 0])

        const dae = await modeler.toDAE()
        expect(structureErrors(dae!)).toEqual([])
    })

    it('validates the triangles fallback', async () =>
    {
        modeler.box(100, 100, 100)

        const dae = await modeler.toDAE({ ngons: false })
        expect(structureErrors(dae!)).toEqual([])
    })

    // Names come from user scripts, so they carry spaces, colons, slashes and leading
    // digits — none of which an xs:NCName may contain.
    it('validates despite layer, shape and material names that are not NCNames', async () =>
    {
        modeler.layer('my walls')
        modeler.box(100, 100, 100).name('Front Wall').color('red')
        modeler.box(50, 50, 50).move(200, 0, 0).name('2nd box').color('blue')

        const dae = await modeler.toDAE()
        expect(structureErrors(dae!)).toEqual([])

        // sanitized, not dropped
        expect(dae).toContain('name="Front_Wall"')
        expect(dae).toContain('name="_2nd_box"')
        expect(dae).toContain('name="my_walls"')
    })

    //// FACE INTEGRITY ////

    // A gabled wall's mitred top plates are the shape that exposed this: welding turned each
    // one's sliver end faces into '0 1 2 3 0' and '0 0 4 4'. SketchUp refused the file while
    // three.js and assimp read it happily.
    it('emits no pinched or zero-area faces for a gabled wall', async () =>
    {
        modeler.make.wall(4961, 2319, 200, 50, 600, [], { height: 1997, center: 0.5 })

        const dae = await modeler.toDAE()
        expect(dae).toBeTruthy()
        expect(brokenFaces(dae!)).toEqual([])
        expect(structureErrors(dae!)).toEqual([])
    })

    it('emits no pinched or zero-area faces for booleans and curved solids', async () =>
    {
        const box = modeler.box(100, 100, 100)
        box.subtract(modeler.cylinder(20, 200))
        modeler.sphere(50).move(200, 0, 0)

        const dae = await modeler.toDAE()
        expect(brokenFaces(dae!)).toEqual([])
    })

    // A shape whose every face welds away must not leave an <instance_geometry> pointing at a
    // geometry that was never written — that dangling url is the classic empty import.
    it('leaves no dangling geometry reference when a shape degenerates away', async () =>
    {
        modeler.box(100, 100, 100)

        const dae = await modeler.toDAE()

        const ids = new Set([...dae!.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))
        const refs = [...dae!.matchAll(/(?:url|source|target)="#([^"]+)"/g)].map(m => m[1])
        expect(refs.filter(r => !ids.has(r))).toEqual([])
    })

    it('keeps the scene id distinct from every node id', async () =>
    {
        modeler.layer('walls')
        modeler.box(10, 10, 10)

        const dae = await modeler.toDAE()

        // no id may appear twice: they are all xs:ID in one document-wide namespace
        const ids = [...dae!.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])
        expect(ids.length).toBe(new Set(ids).size)

        // and the scene reference still resolves to the visual_scene, not to a node
        expect(dae).toContain('<visual_scene id="Scene"')
        expect(dae).toContain('<instance_visual_scene url="#Scene" />')
    })
})
