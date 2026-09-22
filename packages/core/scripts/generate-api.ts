/**
 * generate-api.ts
 *
 * Build-time script: reads the doc comments of the script API with TypeDoc and writes
 * the slim reference the editor's help panel searches and looks up
 * (packages/ui/src/editor/help/api.generated.json, format: help-reference.ts ApiEntry).
 *
 * Run from the core package root:
 *   pnpm run generate:api
 *
 * What a script can use, and so what is documented:
 *   - global functions  : Modeler methods listed in MODELER_METHODS_INTO_GLOBAL (constants.ts)
 *   - other globals      : the ScriptGlobals interface in runner/Runner.ts ($component,
 *                          doc, calc, $PARAMS, print, …)
 *   - classes            : CLASSES below, with their public methods and properties. Methods that
 *                          shapeAnnotations.ts adds to the meshup classes arrive merged in.
 *
 * TypeDoc's own JSON is a full reflection dump (MBs); this keeps one flat entry per
 * symbol with types already written out as text. Members marked `@internal` are left
 * out, as are the names in HIDDEN. The same TypeDoc run can later feed a docs site
 * through typedoc-plugin-markdown.
 */

import { Application, type JSONOutput } from 'typedoc'
import { writeFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { MODELER_METHODS_INTO_GLOBAL, FACTORY_RETURN_TYPES } from '../src/constants'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = resolve(ROOT, '../ui/src/editor/help/api.generated.json')

//// SETTINGS ////

const ENTRY_POINTS = [
    'src/modeler/Modeler.ts',
    'src/modeler/shapeAnnotations.ts',
    'src/runner/Runner.ts',
    'src/runner/RunnerComponentImporter.ts',
    'src/docs/Docs.ts',
    'src/docs/Document.ts',
    'src/calc/Calc.ts',
    'src/modeler/Make.ts',
    'src/modeler/Fab.ts',
    'src/materials/MaterialManager.ts',
    'src/execution/ParamManager.ts',
    'src/interaction/Handle.ts',
    '../meshup/src/index.ts',
].map(p => join(ROOT, p))

/** Classes (and interfaces) documented with their members, in reference order */
const CLASSES = [
    'Mesh', 'Curve', 'Polygon', 'ShapeCollection', 'SceneNode', 'Sketch',
    'Point', 'Vector', 'Vertex', 'Bbox', 'OBbox',
    'Docs', 'Document', 'Calc', 'Make', 'FabFacade', 'MaterialManager',
    'ParamManager', 'RunnerComponentImporter', 'Handle',
]

/** Public for the engine's sake, not for scripts */
const HIDDEN = new Set(['constructor', 'setArchiyou', 'setParent', 'init', 'reset', 'toData', 'fromData', 'inner', 'update', 'generateName'])

//// TYPES ////

export interface ApiParam
{
    name: string
    type: string
    optional?: boolean
    default?: string
    doc?: string
}

export interface ApiEntry
{
    /** 'box', 'Mesh', 'Mesh.move', '$component' */
    id: string
    name: string
    /** Class the member belongs to; absent for globals and classes */
    owner?: string
    kind: 'function' | 'method' | 'property' | 'class' | 'module'
    static?: boolean
    /** '(x: number, y?: number): this' */
    sig?: string
    /** Other overloads */
    alt?: string[]
    /** Class name of the result, for walking a chain like box().move().color() */
    returns?: string
    /** Markdown */
    doc?: string
    returnsDoc?: string
    params?: ApiParam[]
    examples?: string[]
    extends?: string
    deprecated?: boolean
}

type Reflection = JSONOutput.DeclarationReflection
type Signature = JSONOutput.SignatureReflection
type SomeType = JSONOutput.SomeType

const KIND = { Class: 128, Interface: 256, Property: 1024, Method: 2048, Accessor: 262144 } as const

//// MAIN ////

async function main()
{
    const app = await Application.bootstrap({
        entryPoints: ENTRY_POINTS,
        tsconfig: join(ROOT, 'tsconfig.json'),
        // The API documents fine with the core's known type errors; checking them is the typecheck's job
        skipErrorChecking: true,
        excludePrivate: true,
        excludeProtected: true,
        excludeInternal: true,
        excludeExternals: true,
        logLevel: 'Error',
    })

    const project = await app.convert()
    if (!project) throw new Error('generate-api: TypeDoc could not convert the project')

    const json = app.serializer.projectToObject(project, ROOT)
    const all = collect(json as unknown as Reflection)
    const byName = (name: string, kinds: number[]) => all.find(r => r.name === name && kinds.includes(r.kind))

    const modeler = byName('Modeler', [KIND.Class])
    const globalsIface = byName('ScriptGlobals', [KIND.Interface])
    if (!modeler || !globalsIface) throw new Error('generate-api: Modeler or ScriptGlobals not found')

    const globalNames = new Set(MODELER_METHODS_INTO_GLOBAL)
    const entries: ApiEntry[] = [
        ...members(modeler).filter(m => globalNames.has(m.name)).map(m => concreteFactory(toEntry(m, undefined))),
        ...members(globalsIface).map(m => toEntry(m, undefined)),
        ...CLASSES.flatMap(name =>
        {
            const cls = byName(name, [KIND.Class, KIND.Interface])
            if (!cls)
            {
                console.warn(`generate-api: class ${name} not found`)
                return []
            }
            return [classEntry(cls), ...members(cls).map(m => toEntry(m, name))]
        }),
    ]

    const unique = [...new Map(entries.map(e => [e.id, e])).values()]
    writeFileSync(OUTPUT, JSON.stringify({ entries: unique }, null, 0).replace(/},{/g, '},\n{') + '\n')
    console.log(`generate-api: ${unique.length} entries → ${OUTPUT}`)
}

//// REFLECTIONS ////

/** Every reflection in the tree, depth first */
function collect(node: Reflection): Reflection[]
{
    return (node.children ?? []).flatMap(child => [child, ...collect(child)])
}

/** Documented members of a class or interface */
function members(cls: Reflection): Reflection[]
{
    return (cls.children ?? []).filter(m =>
        [KIND.Method, KIND.Property, KIND.Accessor].includes(m.kind as any)
        && !m.name.startsWith('_')
        && !m.name.startsWith('[')
        && !HIDDEN.has(m.name))
}

/** Modeler types its factories with the kernel-neutral AnyKernelShape; a script gets the
 *  mesh class, which is the one worth showing and linking to */
function concreteFactory(entry: ApiEntry): ApiEntry
{
    const concrete = entry.returns === 'AnyKernelShape' ? FACTORY_RETURN_TYPES[entry.name] : undefined
    return concrete
        ? { ...entry, returns: concrete, sig: entry.sig?.replace(/: AnyKernelShape$/, `: ${concrete}`) }
        : entry
}

function classEntry(cls: Reflection): ApiEntry
{
    const parent = cls.extendedTypes?.[0]
    return clean({
        id: cls.name,
        name: cls.name,
        kind: 'class',
        doc: commentText(cls.comment),
        extends: parent ? typeName(parent) : undefined,
        examples: examples(cls.comment),
    })
}

function toEntry(m: Reflection, owner: string | undefined): ApiEntry
{
    const id = owner ? `${owner}.${m.name}` : m.name
    const isStatic = !!m.flags?.isStatic

    if (m.kind === KIND.Method)
    {
        const [sig, ...rest] = m.signatures ?? []
        const documented = (m.signatures ?? []).find(s => s.comment) ?? sig
        return clean({
            id,
            name: m.name,
            owner,
            kind: owner ? 'method' : 'function',
            static: isStatic || undefined,
            sig: sig ? signatureText(sig) : undefined,
            alt: rest.length ? rest.map(signatureText) : undefined,
            returns: sig?.type ? returnsName(sig.type, owner) : undefined,
            doc: commentText(documented?.comment),
            returnsDoc: blockTag(documented?.comment, '@returns'),
            params: (documented?.parameters ?? []).map(paramInfo),
            examples: examples(documented?.comment),
            deprecated: isDeprecated(documented?.comment),
        })
    }

    // Property or accessor
    const type = m.type ?? m.getSignature?.type
    const comment = m.comment ?? m.getSignature?.comment
    return clean({
        id,
        name: m.name,
        owner,
        kind: owner ? 'property' : 'module',
        static: isStatic || undefined,
        sig: type ? `: ${typeText(type)}` : undefined,
        returns: type ? returnsName(type, owner) : undefined,
        doc: commentText(comment),
        examples: examples(comment),
        deprecated: isDeprecated(comment),
    })
}

function paramInfo(p: JSONOutput.ParameterReflection): ApiParam
{
    return clean({
        name: p.flags?.isRest ? `...${p.name}` : p.name,
        type: p.type ? typeText(p.type) : 'any',
        optional: (p.flags?.isOptional || p.defaultValue !== undefined) || undefined,
        default: p.defaultValue,
        doc: commentText(p.comment),
    })
}

function signatureText(sig: Signature): string
{
    const params = (sig.parameters ?? []).map(p =>
    {
        const optional = p.flags?.isOptional || p.defaultValue !== undefined
        return `${p.flags?.isRest ? '...' : ''}${p.name}${optional ? '?' : ''}: ${p.type ? typeText(p.type) : 'any'}`
    })
    return `(${params.join(', ')})${sig.type ? `: ${typeText(sig.type)}` : ''}`
}

//// COMMENTS ////

function partsText(parts: JSONOutput.CommentDisplayPart[] | undefined): string
{
    return dedent((parts ?? []).map(p => p.text).join('')).trim()
}

/** Comments written as ` *  text` come through with the lines after the first indented
 *  by the extra space. Remove the indent those lines share, keeping relative indentation
 *  (an example's chained `.page()` lines). */
function dedent(text: string): string
{
    const [first, ...rest] = text.split('\n')
    const indents = rest.filter(l => l.trim()).map(l => l.match(/^ */)![0].length)
    const common = indents.length ? Math.min(...indents) : 0
    return [first, ...rest.map(l => l.slice(Math.min(common, l.match(/^ */)![0].length)))].join('\n')
}

/** Summary plus @remarks, as markdown */
function commentText(comment: JSONOutput.Comment | undefined): string | undefined
{
    if (!comment) return undefined
    const text = [partsText(comment.summary), blockTag(comment, '@remarks')].filter(Boolean).join('\n\n')
    return text || undefined
}

function blockTag(comment: JSONOutput.Comment | undefined, tag: string): string | undefined
{
    const found = comment?.blockTags?.find(b => b.tag === tag)
    return found ? partsText(found.content) || undefined : undefined
}

/** @example blocks as plain code: TypeDoc wraps an example without fences in ```ts */
function examples(comment: JSONOutput.Comment | undefined): string[] | undefined
{
    const found = (comment?.blockTags ?? [])
        .filter(b => b.tag === '@example')
        .map(b => dedent(b.content.map(p => p.text).join('').trim().replace(/^```\w*\n?/, '').replace(/\n?```$/, '')).trim())
        .filter(Boolean)
    return found.length ? found : undefined
}

function isDeprecated(comment: JSONOutput.Comment | undefined): boolean | undefined
{
    return comment?.blockTags?.some(b => b.tag === '@deprecated') || undefined
}

//// TYPES AS TEXT ////

function typeText(t: SomeType): string
{
    switch (t.type)
    {
        case 'intrinsic':        return t.name
        case 'literal':          return t.value === null ? 'null' : typeof t.value === 'object' ? String(t.value.value) : JSON.stringify(t.value)
        case 'reference':        return t.typeArguments?.length ? `${t.name}<${t.typeArguments.map(typeText).join(', ')}>` : t.name
        case 'array':            return `${wrap(t.elementType)}[]`
        case 'union':            return t.types.map(typeText).join(' | ')
        case 'intersection':     return t.types.map(typeText).join(' & ')
        case 'tuple':            return `[${(t.elements ?? []).map(typeText).join(', ')}]`
        case 'namedTupleMember': return `${t.name}${t.isOptional ? '?' : ''}: ${typeText(t.element)}`
        case 'optional':         return `${typeText(t.elementType)}?`
        case 'rest':             return `...${typeText(t.elementType)}`
        case 'query':            return `typeof ${typeText(t.queryType)}`
        case 'typeOperator':     return `${t.operator} ${typeText(t.target)}`
        case 'indexedAccess':    return `${typeText(t.objectType)}[${typeText(t.indexType)}]`
        case 'predicate':        return t.targetType ? `${t.name} is ${typeText(t.targetType)}` : 'boolean'
        case 'templateLiteral':  return 'string'
        case 'reflection':       return reflectionText(t.declaration)
        default:                 return (t as { name?: string }).name ?? 'object'
    }
}

/** Parenthesise what would read wrong in front of [] */
function wrap(t: SomeType): string
{
    const text = typeText(t)
    return t.type === 'union' || t.type === 'intersection' || t.type === 'reflection' ? `(${text})` : text
}

function reflectionText(d: Reflection): string
{
    const sig = d.signatures?.[0]
    if (sig) return `(${(sig.parameters ?? []).map(p => `${p.name}: ${p.type ? typeText(p.type) : 'any'}`).join(', ')}) => ${sig.type ? typeText(sig.type) : 'void'}`
    const props = (d.children ?? []).map(c => `${c.name}${c.flags?.isOptional ? '?' : ''}: ${c.type ? typeText(c.type) : 'any'}`)
    if (!props.length) return '{}'
    return props.length > 6 ? `{ ${props.slice(0, 6).join('; ')}; … }` : `{ ${props.join('; ')} }`
}

/** The class a result is an instance of: `this` is the owner; for a union, the first class in it */
function returnsName(t: SomeType, owner: string | undefined): string | undefined
{
    if (t.type === 'intrinsic') return t.name === 'this' ? owner : undefined
    if (t.type === 'reference') return t.name
    if (t.type === 'array') return undefined
    if (t.type === 'union') return t.types.map(u => returnsName(u, owner)).find(Boolean)
    return undefined
}

function typeName(t: SomeType): string
{
    return t.type === 'reference' ? t.name : typeText(t)
}

/** Drop undefined and empty fields so the JSON stays small */
function clean<T extends object>(o: T): T
{
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as T
}

main().catch(err =>
{
    console.error(err)
    process.exit(1)
})
