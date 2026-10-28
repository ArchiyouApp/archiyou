/**
 *  animator/code.ts
 *
 *  The animations in a script's code, for a tool that edits them (the editor's Animation tool):
 *  where each one is, and the edits that add, rename and remove one. It reads the code with
 *  acorn and never runs it.
 *
 *  The code of an animation is the statement that declares it, `animator.create('name')` or
 *  `animator.preset('kind', ...)`, with the comment right above it. When that statement keeps
 *  it in a variable (`swing = animator.create('swing')`), every later statement that uses the
 *  variable (`swing.key(...)`, a loop that keys it) or calls on `animator.get('swing')` is part
 *  of it too:
 *
 *      // the door swings open                          ┐
 *      swing = animator.create('swing').duration(2);    │ swing
 *      swing.key(0, door, {});                          │
 *      swing.key(2, door, { rotation: [0, 0, -95] });   ┘
 *
 *  Only statements at the top of the script are taken apart like this. A declaration inside a
 *  loop, a function or a block is found and can be renamed, but not removed: its statement
 *  holds more than the animation.
 */

import { Parser } from 'acorn'

import { PARAM_FRAMES_DEFAULT, PRESETS } from './standard'
import type { PresetKind } from './types'

export interface CodeRange
{
    from: number
    to: number
}

export interface AnimationCode
{
    name: string
    /** The variable the script keeps it in. */
    variable?: string
    /** Whole lines: the declaration with the comment above it, then the statements on its
     *  variable. Empty for a declaration that is not a statement of its own. */
    ranges: Array<CodeRange>
    /** The code as the script has it: the lines of `ranges`, or the statement around a
     *  declaration that is not one of its own. */
    code: string
    /** Its lines can be taken out of the script without taking anything else. */
    removable: boolean
    /** The string literals that write its name. */
    names: Array<CodeRange>
    /** A preset() without a name of its own, `animator.preset('flyin')`: renaming adds one.
     *  The end of its first argument, and its options object when it has one. */
    unnamedPreset?: { after: number, options?: CodeRange }
}

const ACORN_OPTIONS = {
    ecmaVersion: 'latest' as const,
    sourceType: 'script' as const,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowHashBang: true,
}

/** Indentation of the code this module writes, as the scripts and the guide have it. */
const INDENT = '    '

/** The animations declared with a literal name, in the order of the code. Null when the code
 *  does not parse (half typed): there is nothing to edit then. */
export function animationsInCode(code: string): Array<AnimationCode> | null
{
    const parsed = parse(code)
    if (!parsed) { return null }
    const { program, comments } = parsed

    const found: Array<AnimationCode> = []
    const byName = new Map<string, AnimationCode>()
    const byVariable = new Map<string, AnimationCode>()
    const topLevel = new Set<any>()

    program.body.forEach((statement: any) =>
    {
        const { variable, chain } = chainOf(statement)
        const call = chain ? animatorCallOf(chain) : null
        const range = statementLines(code, statement, comments)

        if (call && (call.verb === 'create' || call.verb === 'preset'))
        {
            const declared = declarationOf(call.node)
            if (!declared) { return }
            topLevel.add(call.node)

            // a second declaration of a name adds to the first, as animator.create() does
            const existing = byName.get(declared.name)
            const animation: AnimationCode = existing ?? {
                name: declared.name, ranges: [], code: '', removable: true, names: [],
                ...(declared.unnamedPreset ? { unnamedPreset: declared.unnamedPreset } : {}),
            }
            animation.ranges.push(range)
            animation.names.push(...declared.names)
            if (variable) { animation.variable = variable; byVariable.set(variable, animation) }
            if (!existing) { byName.set(declared.name, animation); found.push(animation) }
            return
        }

        // a statement on a declared animation: swing.key(...), a loop that keys it,
        // animator.get('swing').hide(...)
        const onGet = (call?.verb === 'get') ? byName.get(stringOf(call.node.arguments[0]) ?? '') : undefined
        const used = [...byVariable.entries()].find(([name]) => name !== variable && usesIdentifier(statement, name))
        const owner = onGet ?? used?.[1]
        if (owner)
        {
            owner.ranges.push(range)
            if (onGet) { owner.names.push(literalRange(call!.node.arguments[0])) }
        }

        // the variable now holds something else
        if (variable && byVariable.has(variable)) { byVariable.delete(variable) }
    })

    // declarations inside other statements: there, but not to take out
    program.body.forEach((statement: any) => walk(statement, (node: any) =>
    {
        const call = animatorCall(node)
        if (!call || (call.verb !== 'create' && call.verb !== 'preset') || topLevel.has(node)) { return }
        const declared = declarationOf(node)
        if (!declared || byName.has(declared.name)) { return }

        const animation: AnimationCode = {
            name: declared.name, ranges: [], removable: false, names: declared.names,
            code: code.slice(statement.start, statement.end),
            ...(declared.unnamedPreset ? { unnamedPreset: declared.unnamedPreset } : {}),
        }
        byName.set(declared.name, animation)
        found.push(animation)
    }))

    found.forEach(a =>
    {
        a.ranges.sort((x, y) => x.from - y.from)
        if (a.removable) { a.code = a.ranges.map(r => code.slice(r.from, r.to)).join('\n') }
    })
    return found
}

/** The script with `snippet` at its end, after a blank line. */
export function appendAnimation(code: string, snippet: string): string
{
    const body = code.replace(/\s+$/, '')
    return (body ? `${body}\n\n` : '') + snippet.replace(/\s+$/, '') + '\n'
}

/** The script without the lines of `animation`, and without the blank line that would leave
 *  two in a row. Unchanged when it is not removable. */
export function removeAnimation(code: string, animation: AnimationCode): string
{
    if (!animation.removable || !animation.ranges.length) { return code }

    return [...animation.ranges].sort((a, b) => b.from - a.from).reduce((text, r) =>
    {
        const to = (text[r.to] === '\n') ? r.to + 1 : r.to
        return tidyAt(text.slice(0, r.from) + text.slice(to), r.from)
    }, code)
}

/** The script with `animation` under another name: every literal that writes its name, or a
 *  `name` option added to a preset() that has none. Its variable stays as it is. */
export function renameAnimation(code: string, animation: AnimationCode, name: string): string
{
    const edits: Array<{ from: number, to: number, text: string }> = animation.names.map(r => ({
        ...r, text: quoted(name, code[r.from]),
    }))

    const preset = animation.unnamedPreset
    if (preset)
    {
        const options = preset.options
        const inner = options ? code.slice(options.from + 1, options.to - 1) : ''
        edits.push(!options
            ? { from: preset.after, to: preset.after, text: `, { name: ${quoted(name)} }` }
            : !inner.trim()
                ? { from: options.from, to: options.to, text: `{ name: ${quoted(name)} }` }
                : { from: options.from + 1, to: options.from + 1, text: ` name: ${quoted(name)},` })
    }

    return [...edits].sort((a, b) => b.from - a.from)
        .reduce((text, e) => text.slice(0, e.from) + e.text + text.slice(e.to), code)
}

//// CODE TO ADD ////

/** A standard animation written out in full, to put in a script as an example to change:
 *  the keys of every shape and of the camera, worked out from the model when the script runs,
 *  so they follow its parameters. `animator.preset(kind)` is about the same animation in one
 *  line; the editor's Animation tool writes these.
 *  @param variable what the script keeps it in, see variableFor() */
export function exampleCode(kind: PresetKind, name: string, variable: string): string
{
    const { title, description } = PRESETS[kind]
    const v = variable
    const n = quoted(name)
    const I = INDENT
    const lines: Record<PresetKind, Array<string>> = {
        flyin: [
            `${v} = animator.create(${n}).duration(3);`,
            `animator.layout('partstack')`,
            `${I}.sort((a, b) => a.shape.bbox().min().z - b.shape.bbox().min().z)    // lowest first`,
            `${I}.forEach((stock, i, stacks) =>`,
            `${I}{`,
            `${I}${I}const leave = 1.8 * i / Math.max(1, stacks.length - 1);  // the last one leaves at 1.8 s`,
            `${I}${I}const lying = { position: stock.position, rotation: stock.rotation };`,
            `${I}${I}${v}.key(0, stock.shape, lying);  // in the stacks,`,
            `${I}${I}${v}.key(leave, stock.shape, lying);  // until it leaves,`,
            `${I}${I}${v}.key(leave + 1.2, stock.shape, {}, 'easeOut');  // to its place in the model`,
            `${I}});`,
        ],
        exploded: [
            `${v} = animator.create(${n}).duration(1).loop('pingpong');`,
            `animator.layout('exploded').forEach(part =>`,
            `{`,
            `${I}${v}.key(0, part.shape, {});  // as modelled`,
            `${I}${v}.key(1, part.shape, { position: part.position });  // pulled apart`,
            `});`,
        ],
        layout: [
            `${v} = animator.create(${n}).duration(1).loop('pingpong');`,
            `animator.layout('row').forEach(flat =>`,
            `{`,
            `${I}${v}.key(0, flat.shape, {});`,
            `${I}${v}.key(1, flat.shape, { position: flat.position, rotation: flat.rotation });`,
            `});`,
        ],
        turntable: [
            `${v} = animator.create(${n}).loop('loop');`,
            `{`,
            `${I}const seconds = 8;`,
            `${I}const model = all().bbox();`,
            `${I}const centre = model.center();`,
            `${I}const distance = 2.5 * Math.max(model.width(), model.depth(), model.height());`,
            `${I}const up = toRad(35);  // how high it looks from`,
            `${I}${v}.duration(seconds);`,
            `${I}Array.from({ length: 37 }, (_, i) => i * 10).forEach(degrees =>  // a key every 10 degrees`,
            `${I}{`,
            `${I}${I}const round = toRad(degrees - 135);  // from the front left, as an iso view`,
            `${I}${I}${v}.camera(seconds * degrees / 360, [`,
            `${I}${I}${I}centre.x + distance * Math.cos(up) * Math.cos(round),`,
            `${I}${I}${I}centre.y + distance * Math.cos(up) * Math.sin(round),`,
            `${I}${I}${I}centre.z + distance * Math.sin(up),`,
            `${I}${I}], centre, 'linear');`,
            `${I}});`,
            `}`,
        ],
        build: [
            `${v} = animator.create(${n});`,
            `{`,
            `${I}const each = 0.25;  // seconds per shape`,
            `${I}const drop = 0.15 * all().bbox().height();`,
            `${I}const shapes = all().sort((a, b) => a.bbox().min().z - b.bbox().min().z);  // lowest first`,
            `${I}shapes.forEach((shape, i) =>`,
            `${I}{`,
            `${I}${I}${v}.show(shape, i * each);  // hidden until its turn,`,
            `${I}${I}${v}.key(i * each, shape, { move: [0, 0, drop] });  // then above its place,`,
            `${I}${I}${v}.key((i + 1) * each, shape, {}, 'easeOut');  // and dropped in`,
            `${I}});`,
            `${I}${v}.duration(Math.max(1, shapes.length * each));`,
            `}`,
        ],
        assembly: [
            `${v} = animator.create(${n}).steps();  // the steps of the first instructable`,
        ],
    }

    return [`// ${title}: ${description.charAt(0).toLowerCase()}${description.slice(1)}`, ...alignComments(lines[kind])].join('\n')
}

/** The comments at the ends of lines that follow each other, in one column. */
function alignComments(lines: Array<string>): Array<string>
{
    const split = lines.map(line =>
    {
        const at = line.indexOf('  // ')
        return (at < 0) ? { code: line } : { code: line.slice(0, at).trimEnd(), comment: line.slice(at + 2) }
    })
    // the width of the run of commented lines each line is in
    const widths = split.map((_, i) =>
    {
        if (split[i].comment === undefined) { return 0 }
        const run = (step: number, j: number): Array<number> =>
            (split[j]?.comment !== undefined) ? [split[j].code.length, ...run(step, j + step)] : []
        return Math.max(...run(-1, i), ...run(1, i))
    })
    return split.map((l, i) => (l.comment === undefined) ? l.code : `${l.code.padEnd(widths[i])}  ${l.comment}`)
}

/** A new animation of the script's own, with two keys to start from. `'A'` is the first part
 *  as an instructable labels them, which every model with a shape has. */
export function newAnimationCode(name: string, variable: string): string
{
    return [
        `// ${name}: your own. A key is a pose of a part at a time, in seconds; 'A' is the first`,
        `// part, as an instructable labels them. A shape, a group or a layer name works too.`,
        `${variable} = animator.create(${quoted(name)})`,
        `${INDENT}.duration(2)`,
        `${INDENT}.loop('pingpong');`,
        `${variable}.key(0, 'A', {});`,
        `${variable}.key(2, 'A', { move: [0, 0, 100] });`,
    ].join('\n')
}

/** A parameter, and the values it goes from and to in an animation of the parameters. */
export interface ParamRange
{
    name: string
    from: number
    to: number
}

/** The most parameters the Animation tool animates at once: each frame is a run of the script
 *  with all of them set, so more only makes the frames harder to read. */
export const PARAMS_ANIMATED_MAX = 5

/** An animation of the script's parameters: all of them from their start to their end value
 *  together, over the same frames, a run of the script per frame (a parameter sweep). */
export function paramsAnimationCode(name: string, variable: string, params: Array<ParamRange>): string
{
    const number = (v: number) => String(Math.round(v * 1e6) / 1e6)
    return [
        `// ${name}: the model as its parameters go from one value to another, together. Each`,
        `// frame is a run of the script; make it in the Animation tool, or with archiyou animate.`,
        `${variable} = animator.create(${quoted(name)})`,
        ...params.map(p => `${INDENT}.param(${quoted(p.name)}, { from: ${number(p.from)}, to: ${number(p.to)}, frames: ${PARAM_FRAMES_DEFAULT} })`),
        `${INDENT}.duration(3)`,
        `${INDENT}.loop('pingpong');`,
    ].join('\n')
}

/** `base`, or `base-2`, `base-3`... whichever is not taken. */
export function uniqueName(base: string, taken: Iterable<string>): string
{
    const names = new Set(taken)
    return Array.from({ length: names.size + 1 }, (_, i) => i ? `${base}-${i + 1}` : base).find(n => !names.has(n))!
}

/** A variable for `name` that the code does not use yet: 'flyin-slow' is flyinSlow. */
export function variableFor(name: string, code: string): string
{
    const words = name.split(/[^\p{L}\p{N}_$]+/u).filter(Boolean)
    const camel = words.map((w, i) => i ? w.charAt(0).toUpperCase() + w.slice(1) : w).join('') || 'animation'
    const base = /^[\p{L}_$]/u.test(camel) ? camel : `animation${camel}`

    const used = new Set<string>()
    const parsed = parse(code)
    if (parsed) { walk(parsed.program, (node: any) => { if (node.type === 'Identifier') { used.add(node.name) } }) }
    return Array.from({ length: used.size + 1 }, (_, i) => i ? `${base}${i + 1}` : base).find(v => !used.has(v))!
}

/** A name the export options and the tool can carry: letters, digits, - and _. */
export function isAnimationName(name: string): boolean
{
    return /^[\p{L}\p{N}_-]+$/u.test(name)
}

//// READING ////

function parse(code: string): { program: any, comments: Array<any> } | null
{
    const comments: Array<any> = []
    try
    {
        return { program: Parser.parse(code, { ...ACORN_OPTIONS, onComment: comments }) as any, comments }
    }
    catch
    {
        return null
    }
}

function walk(node: any, visit: (node: any) => void): void
{
    if (!node || typeof node.type !== 'string') { return }
    visit(node)
    Object.values(node).forEach((value: any) =>
    {
        if (Array.isArray(value)) { value.forEach(child => walk(child, visit)) }
        else if (value && typeof value.type === 'string') { walk(value, visit) }
    })
}

/** The expression a top-level statement is, and the variable it assigns it to. */
function chainOf(statement: any): { variable?: string, chain?: any }
{
    if (statement.type === 'ExpressionStatement')
    {
        const e = statement.expression
        return (e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'Identifier')
            ? { variable: e.left.name, chain: e.right }
            : { chain: e }
    }
    if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1)
    {
        const d = statement.declarations[0]
        return (d.id.type === 'Identifier' && d.init) ? { variable: d.id.name, chain: d.init } : {}
    }
    return {}
}

/** `animator.create(...)` and friends: the call and its verb. */
function animatorCall(node: any): { node: any, verb: string } | null
{
    const callee = node?.type === 'CallExpression' ? node.callee : null
    return (callee?.type === 'MemberExpression' && !callee.computed
        && callee.object.type === 'Identifier' && callee.object.name === 'animator')
        ? { node, verb: callee.property.name }
        : null
}

/** The animator call a chain starts from: `animator.create('x')` in
 *  `animator.create('x').duration(2).loop()`. */
function animatorCallOf(chain: any): { node: any, verb: string } | null
{
    const own = animatorCall(chain)
    if (own) { return own }
    if (chain?.type === 'CallExpression') { return animatorCallOf(chain.callee) }
    if (chain?.type === 'MemberExpression') { return animatorCallOf(chain.object) }
    return null
}

/** Whether code reads a variable: `swing` in `swing.key(...)` or `[a].forEach(s => swing.show(s))`,
 *  not in `door.swing` or `{ swing: 1 }`. */
function usesIdentifier(node: any, name: string): boolean
{
    if (!node || typeof node.type !== 'string') { return false }
    if (node.type === 'Identifier') { return node.name === name }
    return Object.entries(node).some(([key, value]: [string, any]) =>
    {
        const isName = !node.computed && ((key === 'property' && node.type === 'MemberExpression')
            || (key === 'key' && node.type === 'Property'))
        if (isName) { return false }
        return Array.isArray(value)
            ? value.some(child => usesIdentifier(child, name))
            : (!!value && typeof value.type === 'string' && usesIdentifier(value, name))
    })
}

/** The name a create() or preset() call declares, and where it is written. */
function declarationOf(call: any): { name: string, names: Array<CodeRange>, unnamedPreset?: AnimationCode['unnamedPreset'] } | null
{
    const [first, options] = call.arguments
    const verb = call.callee.property.name
    const kind = stringOf(first)
    if (kind === null) { return null }
    if (verb === 'create') { return { name: kind, names: [literalRange(first)] } }

    const named = (options?.type === 'ObjectExpression')
        ? options.properties.find((p: any) => p.type === 'Property' && !p.computed
            && ((p.key.type === 'Identifier' && p.key.name === 'name') || p.key.value === 'name'))
        : undefined
    if (named)
    {
        const name = stringOf(named.value)
        return (name === null) ? null : { name, names: [literalRange(named.value)] }
    }
    return {
        name: kind, names: [],
        unnamedPreset: { after: first.end,
            ...(options?.type === 'ObjectExpression' ? { options: { from: options.start, to: options.end } } : {}) },
    }
}

function stringOf(node: any): string | null
{
    return (node?.type === 'Literal' && typeof node.value === 'string') ? node.value : null
}

function literalRange(node: any): CodeRange
{
    return { from: node.start, to: node.end }
}

/** A statement as whole lines: from the start of its line, or of the comment right above it,
 *  to the end of its last line when only a comment follows it there. */
function statementLines(code: string, statement: any, comments: Array<any>): CodeRange
{
    const lineStart = (at: number) => code.lastIndexOf('\n', at - 1) + 1
    const ownLine = (at: number) => /^[ \t]*$/.test(code.slice(lineStart(at), at))

    // the comments directly above, without a blank line between
    const above = (from: number): number =>
    {
        const comment = comments.filter(c => c.end <= from).pop()
        return (comment && /^[ \t]*\r?\n[ \t]*$/.test(code.slice(comment.end, from)) && ownLine(comment.start))
            ? above(comment.start)
            : from
    }

    const start = ownLine(statement.start) ? above(statement.start) : statement.start
    const lineEnd = code.indexOf('\n', statement.end)
    const end = (lineEnd < 0) ? code.length : lineEnd
    const rest = code.slice(statement.end, end)
    const trailing = /^\s*(\/\/.*)?$/.test(rest) || /^\s*\/\*.*\*\/\s*$/.test(rest)

    return { from: ownLine(start) ? lineStart(start) : start, to: trailing ? end : statement.end }
}

/** After a removal at `at`: no two blank lines in a row there, and no blank lines at the end. */
function tidyAt(code: string, at: number): string
{
    const before = code.slice(0, at)
    const after = code.slice(at)
    if (!after.trim()) { return before.replace(/\s+$/, '') + (before.trim() ? '\n' : '') }
    return (/\n[ \t]*\n$/.test(before) || at === 0) && /^[ \t]*\n/.test(after)
        ? before + after.replace(/^[ \t]*\n/, '')
        : code
}

//// WRITING ////

function quoted(text: string, quote: string = "'"): string
{
    const q = (quote === '"' || quote === '`') ? quote : "'"
    return q + text.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`) + q
}
