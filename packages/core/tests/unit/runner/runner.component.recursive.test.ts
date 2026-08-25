import { describe, it, expect, afterEach } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { NATIVE_CONSOLE } from '../../../src/console/Console'
import type { ScriptData } from '../../../src/execution/types'
import type { SceneNodeData } from '../../../src/modeler/types'

/**
 * RECURSIVE components: a script uses a component, and that component uses a component
 * of its own.
 *
 * $component() executes synchronously (so scripts never have to write `await`), which is
 * why every referenced component has to be resolved up-front by
 * Runner._prefetchComponentScripts(). Nesting used to break in three separate ways:
 *
 *   1. the nested prefetch was `forEach(async cs => await ...)` — the promises were
 *      discarded, so execute() ran before depth >= 2 was cached;
 *   2. deleteLocalScope() always returned to the 'default' scope, so after an inner
 *      component finished, the still-running OUTER component's next $component() bound to
 *      the MAIN scope and grafted its geometry onto the main scene;
 *   3. a cycle recursed until the JS stack blew.
 *
 * Each test below pins one of those.
 *
 * NOTE: a fresh Runner per test — _componentScripts is never cleared between runs, so a
 * shared Runner would let one test's cache mask another's failure.
 */

afterEach(() => { globalThis.console = NATIVE_CONSOLE })

/** A number param definition in the shape a saved workspace Script carries.
 *  Components need real definitions: _executionStartRunInScope() builds the ParamManager
 *  from script.params and only matches passed values ONTO existing definitions, so a
 *  component without them silently runs on its defaults. */
const numberParam = (name: string, def: number) => ({
    name,
    type: 'number',
    default: def,
    schema: { type: 'number', default: def, minimum: 1, maximum: 100000 },
})

//// THE 3-LEVEL CHAIN: main -> table -> leg ////

const LEG: ScriptData = {
    name: 'leg',
    params: { LEG_HEIGHT: numberParam('LEG_HEIGHT', 100) } as any,
    code: `
        print('leg height=' + $LEG_HEIGHT);
        legShape = box(50, 50, $LEG_HEIGHT).color('brown');
    `,
}

/** A SECOND, different component used by 'table'. This is the defect-2 probe: under the
 *  old scope handling the first $component() call deleted its scope and reset the active
 *  scope to 'default', so this one landed in the MAIN scene instead of the table's. */
const TOP: ScriptData = {
    name: 'top',
    code: `topShape = box(400, 400, 20).color('red');`,
}

const TABLE: ScriptData = {
    name: 'table',
    params: { TABLE_HEIGHT: numberParam('TABLE_HEIGHT', 700) } as any,
    code: `
        print('table height=' + $TABLE_HEIGHT);
        legA = $component('./leg', { LEG_HEIGHT: $TABLE_HEIGHT }).model();
        legB = $component('./leg', { LEG_HEIGHT: $TABLE_HEIGHT }).model();
        tableTop = $component('./top').model();
    `,
}

const MAIN_CODE = `
    ownBox = box(1000, 1000, 10).color('green');
    myTable = $component('./table', { TABLE_HEIGHT: 900 }).model();
`

const script = (data: ScriptData): Script =>
{
    const s = Script.fromData(data)
    if (!s) throw new Error(`fixture '${data.name}' failed Script validation`)
    return s
}

//// SCENEGRAPH HELPERS ////

/** Every node in the tree, depth-first. */
function allNodes(n: SceneNodeData | undefined): Array<SceneNodeData>
{
    if (!n) return []
    return [n, ...(n.children ?? []).flatMap(c => allNodes(c))]
}

/** Nodes that actually carry geometry (SceneNodeData.shape is a shape id, or null). */
const shapeNodes = (n: SceneNodeData | undefined) => allNodes(n).filter(x => x.shape)

/** First node whose name contains `part`.
 *
 *  Two naming rules meet in a nested scene, and the tests lean on both:
 *   - a component's subtree ROOT is renamed after the variable it is assigned to
 *     (`myTable = $component('./table').model()`), by the scope Proxy's set trap;
 *   - everything below it keeps the label prefix toComponentGraph() adds at each level,
 *     so a leg two levels down reads `./table_./leg_legShape`.
 */
const findNode = (n: SceneNodeData | undefined, part: string) =>
    allNodes(n).find(x => (x.name ?? '').includes(part))

const printed = (result: any): string =>
    (result.messages ?? []).filter((m: any) => m.type === 'user').map((m: any) => m.message).join(' | ')

const runMain = (runner: Runner, code: string = MAIN_CODE) =>
    runner.execute({
        kernel: 'mesh',
        script: { code },
        outputs: ['default/model/glb'],
        messages: ['user', 'error'],
    } as any)

describe('Runner: recursive components ($component inside a component)', () =>
{
    it('prefetches the whole chain, not just the top level', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([script(TABLE), script(LEG), script(TOP)])

        // Deliberately awaited ONCE and asserted immediately: the old fire-and-forget
        // recursion only ever passed because execute() happened to await other things
        // afterwards, draining a microtask tick per nesting level.
        await runner._prefetchComponentScripts(MAIN_CODE)

        expect(runner.getComponentScriptFromCache('./table')).not.toBeNull()  // depth 1
        expect(runner.getComponentScriptFromCache('./leg')).not.toBeNull()    // depth 2
        expect(runner.getComponentScriptFromCache('./top')).not.toBeNull()    // depth 2
    }, 60000)

    it('brings geometry from the deepest component through to the main scene', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([script(TABLE), script(LEG), script(TOP)])

        const result = await runMain(runner)

        if (result.status !== 'success') console.error('Execution failed:', result.errors)
        expect(result.status).toBe('success')

        const tree = result.state?.scenegraph as SceneNodeData
        // main's own box + 2 legs + 1 table top. The legs are depth 3: they only get here
        // by chaining toComponentGraph() -> _recreateComponentObjTree() twice.
        expect(shapeNodes(tree)).toHaveLength(4)
        expect(findNode(tree, './leg')).toBeDefined()

        // A GLB proves the shapes were rebound to the MAIN modeler on the way up —
        // a shape still pointing at a deleted scope's Modeler cannot be exported.
        const glb = result.outputs?.find(o => o.path.format === 'glb')
        expect(glb?.output).toBeDefined()
    }, 60000)

    it('threads params down through every level', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([script(TABLE), script(LEG), script(TOP)])

        const result = await runMain(runner)
        expect(result.status).toBe('success')

        // Component print() output bubbles up the Console parent chain (createScope wires
        // setParent). 900 reaching the leg means it crossed BOTH boundaries: the main
        // script passed it to table, and table forwarded its own $TABLE_HEIGHT to leg.
        const out = printed(result)
        expect(out).toContain('table height=900')
        expect(out).toContain('leg height=900')
        expect(out).not.toContain('leg height=100') // the leg's own default never applied
    }, 60000)

    it('keeps a second nested component in its parent component, not the main scene', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([script(TABLE), script(LEG), script(TOP)])

        const result = await runMain(runner)
        expect(result.status).toBe('success')

        const tree = result.state?.scenegraph as SceneNodeData
        // The table's subtree root carries the main script's variable name.
        const tableNode = (tree.children ?? []).find(c => c.name === 'myTable')
        expect(tableNode).toBeDefined()

        // All three of the table's sub-components (2 legs + top) must sit UNDER the table.
        // Before the deleteLocalScope() restore fix, the 2nd and 3rd $component() calls
        // inside 'table' resolved getActiveScope() to the main scope, so their geometry was
        // grafted onto the scene ROOT instead — same total, wrong tree.
        expect(shapeNodes(tableNode)).toHaveLength(3)

        // ...so the main scene has exactly two direct children: its own box and the table.
        expect(tree.children ?? []).toHaveLength(2)
    }, 60000)

    it('reports a component missing at depth 2 up front, like a top-level one', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([script(TABLE), script(TOP)]) // './leg' deliberately absent

        const result = await runMain(runner)

        expect(result.status).toBe('error')
        // From execute()'s pre-flight check, NOT the importer's mid-run cache miss.
        expect(JSON.stringify(result.errors)).toContain('Component not found')
        expect(JSON.stringify(result.errors)).toContain('./leg')
    }, 60000)

    it('fails cleanly on a circular component reference instead of blowing the stack', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([
            script({ name: 'ping', code: `p = $component('./pong').model();` }),
            script({ name: 'pong', code: `q = $component('./ping').model();` }),
        ])

        // The prefetch must terminate on its own: both scripts resolve fine, only the
        // execution is circular.
        const { missing } = await runner._prefetchComponentScripts(`$component('./ping').model();`)
        expect(missing).toEqual([])

        const result = await runMain(runner, `start = $component('./ping').model();`)

        expect(result.status).toBe('error')
        const errors = JSON.stringify(result.errors)
        expect(errors).toMatch(/circular component reference/i)
        expect(errors).toContain('./ping')
        expect(errors).toContain('./pong')
        expect(errors).not.toMatch(/Maximum call stack/i)
    }, 60000)

    it('refuses a chain nested deeper than the limit', async () =>
    {
        const runner = await new Runner().load()

        // level0 -> level1 -> ... -> levelN, one deeper than the Runner allows.
        const DEPTH = 14
        const chain = Array.from({ length: DEPTH }, (_, i) => script({
            name: `level${i}`,
            code: (i === DEPTH - 1)
                ? `leaf = box(10, 10, 10);`
                : `next${i} = $component('./level${i + 1}').model();`,
        }))
        runner.linkComponentScripts(chain)

        const result = await runMain(runner, `deep = $component('./level0').model();`)

        expect(result.status).toBe('error')
        expect(JSON.stringify(result.errors)).toMatch(/nested deeper than/i)
    }, 120000)
})
