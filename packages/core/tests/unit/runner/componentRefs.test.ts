import { describe, it, expect } from 'vitest'

import {
    localComponentName,
    localComponentNames,
    collectComponentDependencies,
    extractTopLevelComponentCalls,
} from '../../../src/runner/componentRefs'

/**
 * The $component() reference parser, split out of Runner so the editor can find a
 * script's dependencies without loading the kernel. Publishing relies on this to
 * decide which of the author's scripts to auto-share — miss one and the published
 * configurator cannot resolve it for a visitor.
 */
describe('localComponentName (which references point at a workspace script)', () =>
{
    it('accepts the relative and bare forms the Runner resolves locally', () =>
    {
        expect(localComponentName('./timberwall')).toBe('timberwall')
        expect(localComponentName('timberwall')).toBe('timberwall')
        expect(localComponentName('./TimberWall')).toBe('timberwall') // Script.fromData lowercases
        expect(localComponentName('  ./timberwall  ')).toBe('timberwall')
    })

    it('rejects references that are not a workspace script', () =>
    {
        expect(localComponentName('archiyou/wall:1.0')).toBeNull()        // library path
        expect(localComponentName('https://lib.x.com/a/b:1.0')).toBeNull() // external library
        expect(localComponentName('./myComponent.js')).toBeNull()          // local file (node only)
        expect(localComponentName('box(10,10,10);')).toBeNull()            // inline code
        expect(localComponentName('')).toBeNull()
    })
})

describe('localComponentNames (all local references in a script)', () =>
{
    it('deduplicates repeated references', () =>
    {
        const code = `
            a = $component('./timberwall', { WIDTH: 100 }).model();
            b = $component('./timberwall', { WIDTH: 200 }).model();
            c = $component('./urroof').model();
        `
        expect(localComponentNames(code)).toEqual(['timberwall', 'urroof'])
    })

    it('is not confused by a second argument containing commas, braces or parens', () =>
    {
        const code = `x = $component('./wall', { W: max(1,2), OPTS: { a: 1, b: 2 } }).model();`
        expect(localComponentNames(code)).toEqual(['wall'])
    })

    it('ignores inline-code and library components', () =>
    {
        const code = `
            a = $component('myBox = box(10,10,10);').model();
            b = $component('archiyou/wall:1.0').model();
            c = $component('./real').model();
        `
        expect(localComponentNames(code)).toEqual(['real'])
    })

    it('returns nothing for code without components', () =>
    {
        expect(localComponentNames('box(10,10,10);')).toEqual([])
        expect(localComponentNames('')).toEqual([])
    })

    it('skips $component() calls nested inside another one (they are found by recursing)', () =>
    {
        const code = `a = $component('inner = $component("./nested").model();').model();`
        // The outer call is inline code, so nothing local at THIS level.
        expect(extractTopLevelComponentCalls(code)).toHaveLength(1)
        expect(localComponentNames(code)).toEqual([])
    })
})

describe('collectComponentDependencies (what publishing has to share)', () =>
{
    const ws = (name: string, code: string) => ({ name, code })

    it('follows the tree transitively', () =>
    {
        const root = ws('house', `$component('./wall').model();`)
        const workspace = [
            ws('wall', `$component('./stud').model(); $component('./insulation').model();`),
            ws('stud', `box(10,10,100);`),
            ws('insulation', `box(50,50,10);`),
            ws('unrelated', `box(1,1,1);`),
        ]

        const { found, missing } = collectComponentDependencies(root, workspace)

        expect(found.map(s => s.name).sort()).toEqual(['insulation', 'stud', 'wall'])
        expect(missing).toEqual([])
    })

    it('reports references that match no workspace script', () =>
    {
        const root = ws('house', `$component('./wall').model(); $component('./ghost').model();`)
        const { found, missing } = collectComponentDependencies(root, [ws('wall', 'box(1,1,1);')])

        expect(found.map(s => s.name)).toEqual(['wall'])
        expect(missing).toEqual(['ghost'])
    })

    it('terminates on a cycle and never returns the root itself', () =>
    {
        const root = ws('a', `$component('./b').model();`)
        const workspace = [
            ws('a', `$component('./b').model();`),
            ws('b', `$component('./a').model();`), // points back at the root
        ]

        const { found } = collectComponentDependencies(root, workspace)

        expect(found.map(s => s.name)).toEqual(['b'])
    })

    it('matches names case-insensitively in both directions', () =>
    {
        const root = ws('house', `$component('./TimberWall').model();`)
        const { found, missing } = collectComponentDependencies(root, [ws('TIMBERWALL', 'box(1,1,1);')])

        expect(found.map(s => s.name)).toEqual(['TIMBERWALL'])
        expect(missing).toEqual([])
    })
})
