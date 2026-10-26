/**
 *  The animations in a script's code, as the editor's Animation tool edits them: the standard
 *  ones written out as their calls, and finding, renaming and removing one.
 */

import { describe, expect, it } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { Animator, PRESET_KINDS } from '../../../src/animator/Animator'
import { createNodeIO } from '../../../src/GLTFBuilder'
import {
    animationsInCode, appendAnimation, exampleCode, isAnimationName, newAnimationCode, removeAnimation,
    renameAnimation, uniqueName, variableFor,
} from '../../../src/animator/code'

const MODEL = `legs = group('legs',
    box(44,44,700).moveTo(0,0,350).name('leg'),
    box(44,44,700).moveTo(1100,0,350).name('leg'));
top = box(1200,600,18).moveTo(550,250,709).name('top');
`

/** The model with an instructable, so every example has what it needs. */
const MANUAL = MODEL + `
manual = docs.instruct('assembly').duration(1).parts({ print: false, table: false });
manual.step('The legs').shapes('A').subject('A');
manual.step('The top on').shapes('A', 'B').subject('B');
`

async function run(code: string, outputs: Array<string>)
{
    const runner = new Runner()
    await runner.load()
    const result = await runner.execute({ script: { code }, outputs, kernel: 'mesh', messages: ['user', 'warn'] } as RunnerScriptExecutionRequest)
    const warnings = (result.messages ?? []).filter((m: any) => m.type === 'warn').map((m: any) => m.message).join('\n')
    const bytes = result.outputs?.find((o: any) => o.path.format === 'glb')?.output as any
    const doc = bytes ? await createNodeIO().readBinary(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) : null
    const animations = ((doc?.getRoot().getExtras() as any)?.animations ?? []) as Array<any>
    return { result, warnings, doc, animations }
}

describe('the standard animations written out', () =>
{
    it('each runs and bakes, keyed shape by shape and the camera key by key', async () =>
    {
        const code = PRESET_KINDS.reduce((c, kind) => appendAnimation(c, exampleCode(kind, kind, variableFor(kind, c))), MANUAL)
        const { result, warnings, animations } = await run(code, ['default/model/glb?animations=declared'])

        expect(result.status).not.toBe('error')
        expect(warnings).not.toMatch(/Animator|animation/i)
        expect(animations.map(a => a.name)).toEqual(PRESET_KINDS)

        const byName = Object.fromEntries(animations.map(a => [a.name, a]))
        expect(byName.turntable.duration).toBe(8)
        expect(byName.turntable.camera.keys.length).toBe(37)
        expect(byName.flyin.duration).toBe(3)
        expect(byName.build.tracks.every((t: any) => t.visible?.length)).toBe(true)
        expect(byName.exploded.loop).toBe('pingpong')
        expect(byName.assembly.chapters.length).toBe(2)
    })

    it('the fly-in starts where animator.preset() starts it: in the stacks of stock', async () =>
    {
        const code = appendAnimation(MODEL, exampleCode('flyin', 'flyin', 'flyin')) + `animator.preset('flyin', { name: 'preset' });\n`
        const { animations } = await run(code, ['default/model/glb?animations=flyin,preset'])
        const startOf = (a: any) => Object.fromEntries(a.tracks.map((t: any) => [t.path, t.pose[0].position]))
        const [written, preset] = ['flyin', 'preset'].map(n => startOf(animations.find(a => a.name === n)))

        expect(Object.keys(preset).length).toBe(3)
        expect(Object.keys(written).sort()).toEqual(Object.keys(preset).sort())
        Object.keys(preset).forEach(path => written[path].forEach((v: number, i: number) => expect(v).toBeCloseTo(preset[path][i], 6)))
    })

    it('is found again in the script as one animation, its loops and blocks included', () =>
    {
        PRESET_KINDS.forEach(kind =>
        {
            const snippet = exampleCode(kind, kind, kind)
            const [found] = animationsInCode(appendAnimation(MODEL, snippet))!
            expect(found.name, kind).toBe(kind)
            expect(found.code, kind).toBe(snippet)
        })
    })

    it('reads as a script would write it, comments in a column', () =>
    {
        const code = exampleCode('exploded', 'apart', 'apart')
        expect(code).toBe([
            `// Exploded: the model comes apart along its explode directions.`,
            `apart = animator.create('apart').duration(1).loop('pingpong');`,
            `animator.layout('exploded').forEach(part =>`,
            `{`,
            `    apart.key(0, part.shape, {});                           // as modelled`,
            `    apart.key(1, part.shape, { position: part.position });  // pulled apart`,
            `});`,
        ].join('\n'))
    })

    it('animator.layout() says where each shape lies, as a pose', async () =>
    {
        const code = MODEL + `
laid = animator.layout('stacks');
print(JSON.stringify({ n: laid.length, named: laid.every(l => typeof l.shape.name === 'function'), p: laid[0].position.length, r: laid[0].rotation.length }));
`
        const { result } = await run(code, [])
        expect(JSON.stringify(result.messages)).toContain('{\\"n\\":3,\\"named\\":true,\\"p\\":3,\\"r\\":4}')
        expect(() => new Animator().layout('pile' as any)).toThrow(/"pile" is not a layout/)
    })
})

describe('the preset', () =>
{
    it('options tune it, and the calls after it win', () =>
    {
        const a = new Animator()
        expect(a.preset('turntable', { degrees: 180, duration: 5 })._spec).toMatchObject({ turntable: { degrees: 180 }, duration: 5, loop: 'loop' })
        expect(a.preset('flyin', { stagger: 0.2, turntable: 90, interpolation: 'linear' })._spec)
            .toMatchObject({ stagger: 0.2, turntable: { degrees: 90 }, easing: 'linear', layout: { kind: 'partstack', direction: 'from' } })
        expect(a.preset('build', { name: 'b' }).duration(6)._spec).toMatchObject({ name: 'b', build: {}, order: 'bottomUp', duration: 6 })
        expect(a.get('b')!.info()).toMatchObject({ preset: { kind: 'build' } })
    })

    it('a new one bakes on any model', async () =>
    {
        const code = appendAnimation(MODEL, newAnimationCode('animation', variableFor('animation', MODEL)))
        const { result, warnings, doc } = await run(code, ['default/model/glb?animations=animation'])

        expect(result.status).not.toBe('error')
        expect(warnings).not.toMatch(/Animator/)
        expect((result.state as any).animations.map((a: any) => a.name)).toEqual(['animation'])
        const [clip] = doc!.getRoot().listAnimations()
        expect(clip?.getName()).toBe('animation')
        expect(clip.listChannels().map((c: any) => c.getTargetPath())).toContain('translation')
    })
})

describe('finding animations in code', () =>
{
    const CODE = MODEL + `
// the top swings open
swing = animator.create('swing').duration(2);
swing.key(0, top, {});   // as modelled
other = box(10);
swing.key(2, top, { rotation: [0, 0, 90] });
animator.get('swing').hide(legs, 1);

animator.preset('flyin', { duration: 4 });
animator.preset('build');

[1, 2].forEach(i => animator.create('loop' + i));
if (true) { animator.create('inner') }
`

    it('finds each with its lines: the comment above, its variable, animator.get()', () =>
    {
        const found = animationsInCode(CODE)!
        expect(found.map(a => a.name)).toEqual(['swing', 'flyin', 'build', 'inner'])

        const swing = found[0]
        expect(swing.variable).toBe('swing')
        expect(swing.code).toBe([
            `// the top swings open`,
            `swing = animator.create('swing').duration(2);`,
            `swing.key(0, top, {});   // as modelled`,
            `swing.key(2, top, { rotation: [0, 0, 90] });`,
            `animator.get('swing').hide(legs, 1);`,
        ].join('\n'))
        expect(swing.names.map(r => CODE.slice(r.from, r.to))).toEqual([`'swing'`, `'swing'`])

        expect(found[1].code).toBe(`animator.preset('flyin', { duration: 4 });`)
        expect(found[3]).toMatchObject({ removable: false, code: `if (true) { animator.create('inner') }` })
    })

    it('is null for code that does not parse', () =>
    {
        expect(animationsInCode(`animator.create('a').duration(`)).toBeNull()
        expect(animationsInCode(`box(10)`)).toEqual([])
    })

    it('removes one without leaving its lines or a second blank line', () =>
    {
        const found = animationsInCode(CODE)!
        const without = removeAnimation(CODE, found[0])
        expect(without).not.toMatch(/swing/)
        expect(without).toContain(`other = box(10);\n\nanimator.preset('flyin'`)
        expect(without).not.toMatch(/\n\s*\n\s*\n/)
        expect(animationsInCode(without)!.map(a => a.name)).toEqual(['flyin', 'build', 'inner'])

        // the last thing in the script: the script ends where the code before it did
        const end = MODEL + `\nanimator.preset('flyin');\n`
        expect(removeAnimation(end, animationsInCode(end)![0])).toBe(MODEL)

        // not one of its own: left alone
        expect(removeAnimation(CODE, found[3])).toBe(CODE)
    })

    it('renames every literal of its name, and gives a preset one when it has none', () =>
    {
        const found = animationsInCode(CODE)!
        const renamed = renameAnimation(CODE, found[0], 'door')
        expect(renamed).toContain(`swing = animator.create('door').duration(2);`)
        expect(renamed).toContain(`animator.get('door').hide(legs, 1);`)

        expect(renameAnimation(CODE, found[1], 'fly')).toContain(`animator.preset('flyin', { name: 'fly', duration: 4 });`)
        expect(renameAnimation(CODE, found[2], 'b')).toContain(`animator.preset('build', { name: 'b' });`)
        const empty = `animator.preset('build', {});`
        expect(renameAnimation(empty, animationsInCode(empty)![0], 'b')).toBe(`animator.preset('build', { name: 'b' });`)

        expect(animationsInCode(renameAnimation(CODE, found[2], 'b'))!.map(a => a.name)).toContain('b')
    })
})

describe('adding animations', () =>
{
    it('appends after a blank line', () =>
    {
        expect(appendAnimation('box(10);\n\n\n', exampleCode('turntable', 'turntable', 'turntable'))).toMatch(/^box\(10\);\n\n\/\/ Turntable: .*\n$/s)
        expect(appendAnimation('', `animator.preset('build');`)).toBe(`animator.preset('build');\n`)
    })

    it('picks a name and a variable that are not taken', () =>
    {
        expect(uniqueName('flyin', [])).toBe('flyin')
        expect(uniqueName('flyin', ['flyin', 'flyin-2'])).toBe('flyin-3')
        expect(variableFor('flyin-slow', '')).toBe('flyinSlow')
        expect(variableFor('animation', 'animation = 1; animation2 = 2;')).toBe('animation3')
        expect(variableFor('2d', '')).toBe('animation2d')
        expect(isAnimationName('flyin-2')).toBe(true)
        expect(isAnimationName('fly in')).toBe(false)
        expect(isAnimationName('a,b')).toBe(false)
    })
})
