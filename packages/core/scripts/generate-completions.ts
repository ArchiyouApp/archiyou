/**
 * generate-completions.ts
 *
 * Build-time script that reads the archiyou-core-next TypeScript source and
 * generates `completions-data.generated.ts` consumed by the web editor's
 * CodeMirror autocomplete system.
 *
 * Run from the archiyou-core-next package root:
 *   pnpm run generate:completions
 *
 * Scripts now use the meshup classes directly. The SmartShape layer (SmartMixin.ts,
 * SmartShapes.ts, SmartShapeCollection.ts) was refactored away; the app-level methods it
 * used to provide (dimension, label, material, onClick, addToScene, toDXF, …) are now
 * prototype-augmented onto the meshup classes by src/modeler/shapeAnnotations.ts, whose
 * `declare module` interface blocks are the source of truth for their signatures.
 *
 * Sources read:
 *   src/constants.ts                  → MODELER_METHODS_INTO_GLOBAL (which methods go global)
 *   src/modeler/Modeler.ts            → modelerFunctions
 *   src/modeler/shapeAnnotations.ts   → annotation methods per augmented meshup class
 *   ../meshup/src/Shape.ts            → shared transform/info methods
 *   ../meshup/src/Mesh.ts             → Mesh members
 *   ../meshup/src/Curve.ts            → Curve members
 *   ../meshup/src/Polygon.ts          → Polygon members (plane(), planeBetween())
 *   ../meshup/src/ShapeCollection.ts  → ShapeCollection members
 *   ../meshup/src/SceneNode.ts        → SceneNode members
 *   ../meshup/src/Sketch.ts           → Sketch members
 *   ../meshup/src/Point.ts            → Point members
 *   ../meshup/src/Vector.ts           → Vector members
 *   ../meshup/src/Vertex.ts           → Vertex members
 *   ../meshup/src/Bbox.ts             → Bbox members
 *   ../meshup/src/OBbox.ts            → OBbox members
 *
 * The brep classes (Solid/Edge/Wire/Face) are deliberately NOT emitted: brep mode is not
 * wired after the SmartShape removal — Modeler._brepNotWired() throws for every brep-only
 * factory — so offering completions for them would advertise an API that cannot run.
 */

import { Project, SyntaxKind, Scope, type ClassDeclaration, type MethodDeclaration, type MethodSignature, type GetAccessorDeclaration } from 'ts-morph'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface MethodInfo
{
    label: string
    detail: string
    info?: string
    type: 'function' | 'property'
}

interface ShapeClassInfo
{
    label: string
    detail: string
    statics?: MethodInfo[]
    members: MethodInfo[]
}

/* ------------------------------------------------------------------ */
/*  ts-morph project setup                                              */
/* ------------------------------------------------------------------ */

const project = new Project({
    tsConfigFilePath: join(ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false, // include all files from tsconfig
})

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Symbols that exist on all JS objects — exclude these from completions. */
const OBJECT_PROTOTYPE_METHODS = new Set([
    'constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty',
    'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__', '__defineSetter__',
    '__lookupGetter__', '__lookupSetter__', '__proto__',
])

/** Known internal/private names to exclude even without underscore prefix. */
const INTERNAL_NAMES = new Set([
    'inner', 'type', 'subtype', 'isShape', 'isShapeCollection', 'dispose',
    'id', 'csgrs', 'style', 'metadata',
    // duck-type guards
    'isShapeClass',
    // low-level kernel bridges not useful in user scripts
    'rotateQuaternion', 'update', 'addAnnotations',
    // brep internals
    'oc', 'ocShape', 'ocVertex', 'ocEdge', 'ocWire', 'ocFace', 'ocShell', 'ocSolid',
    'applyTransform', 'fromOcShape', 'toOcShape', 'boundingBox',
])

function isPublic(method: MethodDeclaration | GetAccessorDeclaration): boolean
{
    const name = method.getName()
    if (name.startsWith('_')) return false
    if (OBJECT_PROTOTYPE_METHODS.has(name)) return false
    if (INTERNAL_NAMES.has(name)) return false
    const scope = method.getScope()
    return scope !== Scope.Private && scope !== Scope.Protected
}

function formatMethodSignature(method: MethodDeclaration | MethodSignature): string
{
    const params = method.getParameters().map(p =>
    {
        const opt = p.isOptional() || p.isRestParameter() ? '?' : ''
        const rest = p.isRestParameter() ? '...' : ''
        const typeNode = p.getTypeNode()
        const typeText = typeNode ? typeNode.getText() : 'any'
        return `${rest}${p.getName()}${opt}: ${typeText}`
    }).join(', ')

    const returnNode = method.getReturnTypeNode()
    const returnText = returnNode ? returnNode.getText() : 'any'

    return `(${params}): ${returnText}`
}

function getJsDoc(method: MethodDeclaration | MethodSignature): string | undefined
{
    const own = method.getJsDocs()[0]?.getDescription()?.trim()
    if (own) return own

    // an overloaded method carries its doc on the first overload, not on the implementation
    const overloads = (method as MethodDeclaration).getOverloads?.() ?? []
    for (const overload of overloads)
    {
        const doc = overload.getJsDocs()[0]?.getDescription()?.trim()
        if (doc) return doc
    }
    return undefined
}

/** Extract all public instance methods from a class, excluding Object prototype methods. */
function extractPublicMethods(cls: ClassDeclaration, excludeNames?: Set<string>): MethodInfo[]
{
    const results: MethodInfo[] = []
    const seen = new Set<string>()

    for (const method of cls.getInstanceMethods())
    {
        if (!isPublic(method)) continue
        const name = method.getName()
        if (excludeNames?.has(name)) continue
        if (seen.has(name)) continue
        seen.add(name)

        results.push({
            label: name,
            detail: formatMethodSignature(method),
            info: getJsDoc(method),
            type: 'function',
        })
    }

    return results
}

/** Get a class from a source file by class name, throwing if not found. */
function getClass(relativeFilePath: string, className: string): ClassDeclaration
{
    const absPath = join(ROOT, relativeFilePath)
    const file = project.getSourceFile(absPath) ?? project.addSourceFileAtPath(absPath)
    const cls = file.getClass(className)
    if (!cls) throw new Error(`Class '${className}' not found in ${relativeFilePath}`)
    return cls
}

/** Merge MethodInfo arrays, keeping first occurrence only (dedup by label). */
function mergeMembers(...arrays: MethodInfo[][]): MethodInfo[]
{
    const seen = new Set<string>()
    const result: MethodInfo[] = []
    for (const arr of arrays)
    {
        for (const m of arr)
        {
            if (!seen.has(m.label))
            {
                seen.add(m.label)
                result.push(m)
            }
        }
    }
    return result
}

/* ------------------------------------------------------------------ */
/*  Extract: Modeler global functions                                   */
/* ------------------------------------------------------------------ */

// Read MODELER_METHODS_INTO_GLOBAL directly from constants.ts via ts-morph
const constantsFile = project.getSourceFileOrThrow(join(ROOT, 'src/constants.ts'))
const modelerMethodsDecl = constantsFile.getVariableDeclarationOrThrow('MODELER_METHODS_INTO_GLOBAL')
const modelerMethodsInit = modelerMethodsDecl.getInitializerOrThrow()
const globalMethodNames = new Set(
    modelerMethodsInit
        .asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
        .getElements()
        .map(e => e.getText().replace(/['"]/g, '')),
)

const modelerClass = getClass('src/modeler/Modeler.ts', 'Modeler')
const modelerFunctions: MethodInfo[] = []

for (const method of modelerClass.getInstanceMethods())
{
    const name = method.getName()
    if (!globalMethodNames.has(name)) continue
    if (name.startsWith('_')) continue
    if (method.getScope() === Scope.Private || method.getScope() === Scope.Protected) continue

    modelerFunctions.push({
        label: name,
        detail: formatMethodSignature(method),
        info: getJsDoc(method),
        type: 'function',
    })
}

// Sort to match MODELER_METHODS_INTO_GLOBAL insertion order
modelerFunctions.sort((a, b) =>
{
    const ia = [...globalMethodNames].indexOf(a.label)
    const ib = [...globalMethodNames].indexOf(b.label)
    return ia - ib
})

/* ------------------------------------------------------------------ */
/*  Extract: annotation methods added onto the meshup classes           */
/* ------------------------------------------------------------------ */

// shapeAnnotations.ts patches meshup prototypes at runtime and declares the matching types
// as module augmentations:
//     declare module '@archiyou/meshup/src/Shape' { interface Shape { dimension(...): any } }
// The interface blocks carry the signatures and JSDoc, so read those rather than trying to
// reverse-engineer the prototype assignments below them.
const annotationsFile = project.getSourceFileOrThrow(join(ROOT, 'src/modeler/shapeAnnotations.ts'))

/** Annotation methods declared for one augmented meshup class, e.g. ('Shape') or ('SceneNode'). */
function extractAnnotationMethods(interfaceName: string): MethodInfo[]
{
    const results: MethodInfo[] = []
    const seen = new Set<string>()

    for (const mod of annotationsFile.getModules())
    {
        for (const iface of mod.getInterfaces())
        {
            if (iface.getName() !== interfaceName) continue

            for (const method of iface.getMethods())
            {
                const name = method.getName()
                if (name.startsWith('_')) continue
                if (OBJECT_PROTOTYPE_METHODS.has(name)) continue
                if (INTERNAL_NAMES.has(name)) continue
                if (seen.has(name)) continue
                seen.add(name)

                results.push({
                    label: name,
                    detail: formatMethodSignature(method),
                    info: getJsDoc(method),
                    type: 'function',
                })
            }
        }
    }

    if (results.length === 0)
    {
        // Loud rather than silently emitting a thinner API than scripts actually have.
        throw new Error(
            `No annotation methods found for 'interface ${interfaceName}' in shapeAnnotations.ts. ` +
            `Did the augmented class or its module specifier change?`,
        )
    }

    return results
}

const shapeAnnotationMethods      = extractAnnotationMethods('Shape')
const sceneNodeAnnotationMethods  = extractAnnotationMethods('SceneNode')
const collectionAnnotationMethods = extractAnnotationMethods('ShapeCollection')

/* ------------------------------------------------------------------ */
/*  Extract: Kernel shape methods from meshup                           */
/* ------------------------------------------------------------------ */

const meshupShapeMethods      = extractPublicMethods(getClass('../meshup/src/Shape.ts', 'Shape'))
const meshupMeshMethods       = extractPublicMethods(getClass('../meshup/src/Mesh.ts',    'Mesh'),    new Set(['type', 'constructor']))
const meshupCurveMethods      = extractPublicMethods(getClass('../meshup/src/Curve.ts',   'Curve'),   new Set(['type', 'constructor']))
const meshupPolygonMethods    = extractPublicMethods(getClass('../meshup/src/Polygon.ts', 'Polygon'), new Set(['type', 'constructor']))
const meshupSceneNodeMethods  = extractPublicMethods(getClass('../meshup/src/SceneNode.ts', 'SceneNode'))
const meshupCollectionMethods = extractPublicMethods(
    getClass('../meshup/src/ShapeCollection.ts', 'ShapeCollection'),
    new Set(['type', 'isShape', 'isShapeCollection', 'isEmpty', 'children', 'getShapes', 'merge',
             'getShapesByType', 'getShapesByTypes']),
)

/* ------------------------------------------------------------------ */
/*  Extract: Math types (Point, Vector, Bbox, OBbox)                    */
/* ------------------------------------------------------------------ */

const pointMethods  = extractPublicMethods(getClass('../meshup/src/Point.ts',  'Point'),  new Set(['from', 'type', 'isPoint']))
const vectorMethods = extractPublicMethods(getClass('../meshup/src/Vector.ts', 'Vector'), new Set(['from', 'isVector']))
const vertexMethods = extractPublicMethods(getClass('../meshup/src/Vertex.ts', 'Vertex'), new Set(['from']))
const bboxMethods   = extractPublicMethods(getClass('../meshup/src/Bbox.ts',   'Bbox'),   new Set(['from', 'fromMesh']))
const obboxMethods  = extractPublicMethods(getClass('../meshup/src/OBbox.ts',  'OBbox'),  new Set(['from', 'fromPoints', 'fromMesh']))

/* ------------------------------------------------------------------ */
/*  Extract: Statics for math types                                     */
/* ------------------------------------------------------------------ */

function extractStatics(relPath: string, cls: string, includeNames: string[]): MethodInfo[]
{
    const klass = getClass(relPath, cls)
    return klass.getStaticMethods()
        .filter(m => includeNames.includes(m.getName()))
        .map(m => ({
            label: m.getName(),
            detail: formatMethodSignature(m),
            info: getJsDoc(m),
            type: 'function' as const,
        }))
}

const pointStatics  = extractStatics('../meshup/src/Point.ts',  'Point',  ['from'])
const vectorStatics = extractStatics('../meshup/src/Vector.ts', 'Vector', ['from'])
const bboxStatics   = extractStatics('../meshup/src/Bbox.ts',   'Bbox',   ['fromMesh'])
const obboxStatics  = extractStatics('../meshup/src/OBbox.ts',  'OBbox',  ['fromPoints', 'fromMesh'])

/* ------------------------------------------------------------------ */
/*  Assemble: shapeClasses                                              */
/* ------------------------------------------------------------------ */

// Every meshup shape inherits from Shape, and shapeAnnotations patches Shape.prototype,
// so both sets are common to Mesh / Curve / Polygon.
const shapeCommonMembers = mergeMembers(meshupShapeMethods, shapeAnnotationMethods)

const shapeClasses: ShapeClassInfo[] = [
    {
        label: 'Mesh',
        detail: 'mesh geometry shape (box, sphere, cylinder, …)',
        members: mergeMembers(shapeCommonMembers, meshupMeshMethods),
    },
    {
        label: 'Curve',
        detail: 'curve / wire (line, arc, spline, rect, circle, …)',
        members: mergeMembers(shapeCommonMembers, meshupCurveMethods),
    },
    {
        label: 'Polygon',
        detail: 'planar face (plane, planeBetween)',
        members: mergeMembers(shapeCommonMembers, meshupPolygonMethods),
    },
    {
        label: 'ShapeCollection',
        detail: 'collection of shapes',
        members: mergeMembers(meshupCollectionMethods, collectionAnnotationMethods),
    },
    {
        label: 'SceneNode',
        detail: 'scene graph node / layer',
        members: mergeMembers(meshupSceneNodeMethods, sceneNodeAnnotationMethods),
    },
    {
        label: 'Sketch',
        detail: '2D sketch on a plane',
        members: extractPublicMethods(getClass('../meshup/src/Sketch.ts', 'Sketch'), new Set(['type'])),
    },
    {
        label: 'Point',
        detail: '3D point',
        statics: pointStatics,
        members: pointMethods,
    },
    {
        label: 'Vector',
        detail: '3D vector',
        statics: vectorStatics,
        members: vectorMethods,
    },
    {
        label: 'Vertex',
        detail: '3D vertex (a Point that lives in the scene)',
        members: vertexMethods,
    },
    {
        label: 'Bbox',
        detail: 'axis-aligned bounding box',
        statics: bboxStatics,
        members: bboxMethods,
    },
    {
        label: 'OBbox',
        detail: 'oriented bounding box',
        statics: obboxStatics,
        members: obboxMethods,
    },
]

/* ------------------------------------------------------------------ */
/*  Render helpers                                                       */
/* ------------------------------------------------------------------ */

function renderMethodInfo(m: MethodInfo, indent: string): string
{
    const info = m.info ? `\n${indent}  info: ${JSON.stringify(m.info)},` : ''
    return (
        `${indent}{ label: ${JSON.stringify(m.label)}, detail: ${JSON.stringify(m.detail)},${info}\n` +
        `${indent}  type: '${m.type}' },`
    )
}

function renderShapeClass(cls: ShapeClassInfo): string
{
    const indent = '  '
    const memberLines = cls.members.map(m => renderMethodInfo(m, indent + '  ')).join('\n')
    let staticsBlock = ''
    if (cls.statics && cls.statics.length > 0)
    {
        const staticLines = cls.statics.map(m => renderMethodInfo(m, indent + '  ')).join('\n')
        staticsBlock = `\n${indent}  statics: [\n${staticLines}\n${indent}  ],`
    }
    return (
        `  {\n` +
        `    label: ${JSON.stringify(cls.label)},\n` +
        `    detail: ${JSON.stringify(cls.detail)},${staticsBlock}\n` +
        `    members: [\n${memberLines}\n${indent}  ],\n` +
        `  },`
    )
}

/* ------------------------------------------------------------------ */
/*  Write output                                                         */
/* ------------------------------------------------------------------ */

const OUTPUT_PATH = resolve(
    ROOT,
    '../ui/src/editor/completions-data.generated.ts',
)

const header = `\
/**
 * completions-data.generated.ts
 *
 * AUTO-GENERATED by packages/core/scripts/generate-completions.ts
 * Run: pnpm --filter @archiyou/core generate:completions
 *
 * Do NOT edit manually — changes will be overwritten on next generation.
 */

/* eslint-disable */
/* prettier-ignore */

`

const output =
    header +
    `export interface MethodInfo {\n` +
    `  label: string;\n  detail: string;\n  info?: string;\n  type: 'function' | 'property';\n}\n\n` +
    `export interface ShapeClassInfo {\n` +
    `  label: string;\n  detail: string;\n  statics?: MethodInfo[];\n  members: MethodInfo[];\n}\n\n` +
    `export const modelerFunctions: MethodInfo[] = [\n` +
    modelerFunctions.map(m => renderMethodInfo(m, '  ')).join('\n') +
    `\n];\n\n` +
    `export const shapeClasses: ShapeClassInfo[] = [\n` +
    shapeClasses.map(renderShapeClass).join('\n') +
    `\n];\n`

mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
writeFileSync(OUTPUT_PATH, output, 'utf-8')
console.log(`✓ Wrote completions data to ${OUTPUT_PATH}`)
console.log(`  modelerFunctions: ${modelerFunctions.length} entries`)
console.log(`  shapeClasses: ${shapeClasses.length} classes`)
shapeClasses.forEach(c => console.log(`    ${c.label}: ${c.members.length} members`))
