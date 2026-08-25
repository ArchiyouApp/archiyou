import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'
import { Interactor } from '../../../src/interaction/Interactor'
import type { SceneNodeData } from '../../../src/modeler/types'

/** Walk a serialised scenegraph, returning shape-id → canonical encoded path,
 *  reproducing the viewer's buildScenegraphPath (encodeURIComponent per segment,
 *  root already named 'Scene' by toData(true)). */
function shapePathsFromData(root: SceneNodeData): Map<string, string>
{
    const out = new Map<string, string>()
    const walk = (node: SceneNodeData, parentPath: string) =>
    {
        const seg = encodeURIComponent(node.name)
        const path = parentPath ? `${parentPath}/${seg}` : seg
        if (node.shape) out.set(node.shape, path)
        node.children.forEach(c => walk(c, path))
    }
    walk(root, '')
    return out
}

describe('SmartSceneNode.path()', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    it('matches the path the serialised scenegraph assigns to each shape', () =>
    {
        const a = m.box(10, 10, 10) as any
        const b = m.box(20, 20, 20) as any   // sibling same auto-name → [idx] suffix

        const data = m.scene().toData(true)
        const byId = shapePathsFromData(data)

        expect(a.node()).toBeTruthy()
        expect(b.node()).toBeTruthy()
        expect(a.node().path()).toBe(byId.get(a.id()))
        expect(b.node().path()).toBe(byId.get(b.id()))
        // The two siblings must have distinct paths (the [idx] suffix rule).
        expect(a.node().path()).not.toBe(b.node().path())
    })

    it('roots the path at "Scene"', () =>
    {
        const box = m.box(10, 10, 10) as any
        expect(box.node().path().startsWith('Scene')).toBe(true)
    })
})

describe('Interactor selection', () =>
{
    it('beginRun stores selected paths; isSelected reflects them', () =>
    {
        const it_ = new Interactor()
        it_.beginRun('k', [], ['Scene/Box'])
        expect(it_.isSelected('Scene/Box')).toBe(true)
        expect(it_.isSelected('Scene/Other')).toBe(false)
        expect(it_.isSelected(null)).toBe(false)
    })

    it('markInteractive collects unique paths; cleared each run', () =>
    {
        const it_ = new Interactor()
        it_.beginRun('k', [], [])
        it_.markInteractive('Scene/A')
        it_.markInteractive('Scene/A')   // dedup
        it_.markInteractive('Scene/B')
        it_.markInteractive(null)        // ignored
        expect(it_.interactivePaths()).toEqual(['Scene/A', 'Scene/B'])

        it_.beginRun('k', [], [])        // new run resets
        expect(it_.interactivePaths()).toEqual([])
    })
})

describe('shape.onClick() / shape.selected()', () =>
{
    let m: Modeler
    let interactor: Interactor
    beforeEach(async () =>
    {
        m = new Modeler(); await m.load()
        interactor = new Interactor()
        // onClick/selected only touch _ay.interactor — a partial modules object suffices.
        m.setArchiyou({ interactor } as any)
    })

    it('onClick marks the shape interactive and runs cb only when selected', () =>
    {
        const box = m.box(10, 10, 10) as any
        const path = box.node().path()

        // Not selected → cb does not run, but the shape is still marked interactive.
        interactor.beginRun('k', [], [])
        let ran = 0
        box.onClick(() => { ran++ })
        expect(ran).toBe(0)
        expect(box.selected()).toBe(false)
        expect(interactor.interactivePaths()).toContain(path)

        // Selected → cb runs synchronously.
        interactor.beginRun('k', [], [path])
        box.onClick(() => { ran++ })
        expect(ran).toBe(1)
        expect(box.selected()).toBe(true)
        expect(interactor.interactivePaths()).toContain(path)
    })

    it('onClick on a shape not in the scene is a no-op (warns)', () =>
    {
        const box = m.box(10, 10, 10) as any
        box.removeFromScene()
        interactor.beginRun('k', [], [])
        let ran = 0
        expect(() => box.onClick(() => { ran++ })).not.toThrow()
        expect(ran).toBe(0)
        expect(interactor.interactivePaths()).toEqual([])
    })
})
