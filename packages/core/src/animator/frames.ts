/**
 *  animator/frames.ts
 *
 *  A parameter sweep as one glTF clip. The host runs the script once per frame with that
 *  frame's values (`animation.param('WIDTH', { from: 400, to: 800 })`), and the GLBs of the
 *  runs are merged into the first one here, geometry node by geometry node:
 *
 *  - **unchanged** in every frame: kept once, nothing to animate;
 *  - **the same mesh, other numbers** (same primitives, modes, vertex counts and indices): one
 *    mesh with a morph target per frame and a LINEAR `weights` channel, so a box whose width
 *    is the parameter grows smoothly between the frames: exact where the geometry follows the
 *    parameter linearly, a blend elsewhere. meshup centres every mesh on its node, so a part
 *    that grows also moves: its node gets a LINEAR translation (rotation, scale) channel too;
 *  - **another mesh** (other topology, or a part only some frames have): a flipbook. The
 *    frames' meshes are copied in as siblings of the first, each shown for its own frames only
 *    by a STEP scale channel, the visibility convention of the other clips. A flipbook shows
 *    the frame nearest in time, where the morphing and moving parts are: it switches halfway
 *    between two frames, so the last frame shows for the last half frame, also in a loop.
 *
 *  Node names, materials and the Archiyou extras stay those of the first frame. Copied meshes
 *  reuse the first frame's material of the same primitive where it has the same name, so the
 *  usual case (one part, other geometry) adds no materials; others are copied, base colour
 *  texture included.
 *
 *  Costs, in the plan's words: a morph target is the positions (and normals) of the changed
 *  parts once per frame; a flipbook is the whole changed geometry once per distinct frame.
 *  Frames that repeat the one before are not copied again.
 */

import type { Accessor, Document, Material, Mesh, Node, Primitive } from '@gltf-transform/core'

import type { AnimationLoop } from './types'
import { HIDDEN_SCALE } from './sampling'

export interface ParamFramesData
{
    name: string
    title?: string
    /** Seconds from the first frame to the last; frames are evenly spaced over it. */
    duration: number
    loop: AnimationLoop
}

/** What the merge did, for the host to say. */
export interface ParamFramesReport
{
    frames: number
    /** Geometry nodes kept as they are, morphed, moved only, and played as a flipbook. */
    unchanged: number
    morphed: number
    moved: number
    flipbook: number
    /** Whether the clip was written: not when nothing changes over the frames. */
    animated: boolean
}

const EDGE_VISIBILITY = 'EXT_mesh_primitive_edge_visibility'
/** meshup's material styles, and their plain values. */
const STYLES: Record<string, Array<string>> = {
    BENTLEY_materials_line_style: ['width', 'pattern'],
    AY_materials_point_style: ['size', 'shape'],
}

/** The times of `count` evenly spaced frames over `duration` seconds. */
export function frameTimes(count: number, duration: number): Array<number>
{
    return Array.from({ length: count }, (_, i) => (count > 1) ? duration * i / (count - 1) : 0)
}

/** Merge the GLBs of frames 1.. into `base`, frame 0, as one clip named `data.name`. */
export function mergeParamFrames(base: Document, frames: Array<Document>, data: ParamFramesData): ParamFramesReport
{
    const count = frames.length + 1
    const report: ParamFramesReport = { frames: count, unchanged: 0, morphed: 0, moved: 0, flipbook: 0, animated: false }
    if (count < 2) { return report }

    const buffer = base.getRoot().listBuffers()[0] ?? base.createBuffer()
    const times = frameTimes(count, data.duration)
    const anim = base.createAnimation(data.name)
    const input = base.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer)
    const channel = (node: Node, path: 'translation' | 'rotation' | 'scale' | 'weights', type: 'VEC3' | 'VEC4' | 'SCALAR',
        values: Array<number>, interpolation: 'LINEAR' | 'STEP' = 'LINEAR', at: Accessor = input) =>
    {
        const output = base.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer)
        const sampler = base.createAnimationSampler().setInput(at).setOutput(output).setInterpolation(interpolation)
        anim.addSampler(sampler).addChannel(base.createAnimationChannel().setSampler(sampler).setTargetNode(node).setTargetPath(path))
    }
    // a flipbook's keys: the first frame from the start, each next one from halfway to it, and
    // a key at the end that holds the last frame and keeps the clip its length
    let switches: Accessor | null = null
    const switchTimes = () => switches ??= base.createAccessor().setType('SCALAR').setBuffer(buffer)
        .setArray(new Float32Array([0, ...times.slice(1).map((t, k) => (times[k] + t) / 2), data.duration]))

    const baseNodes = geometryNodes(base)
    const frameNodes = frames.map(geometryNodes)
    const keys = [...new Set([...baseNodes.keys(), ...frameNodes.flatMap(f => [...f.keys()])])]
    const copier = new Copier(base, buffer, frames)

    keys.forEach(key =>
    {
        const chain = [baseNodes.get(key) ?? null, ...frameNodes.map(f => f.get(key) ?? null)]
        const first = chain[0]

        if (first && chain.every(n => n && sameTopology(first.getMesh()!, n.getMesh()!)))
        {
            const nodes = chain as Array<Node>
            const moved = (['translation', 'rotation', 'scale'] as const).filter(path =>
                nodes.some(n => !sameNumbers(trs(n, path), trs(first, path))))
            moved.forEach(path => channel(first, path, (path === 'rotation') ? 'VEC4' : 'VEC3', nodes.flatMap(n => trs(n, path))))

            const morphed = nodes.some(n => !sameGeometry(first.getMesh()!, n.getMesh()!))
            if (morphed) { addMorphTargets(base, buffer, first, nodes.map(n => n.getMesh()!), (values) => channel(first, 'weights', 'SCALAR', values)) }

            if (morphed) { report.morphed++ }
            else if (moved.length) { report.moved++ }
            else { report.unchanged++ }
            return
        }

        // a flipbook: one node per run of frames that show the same geometry
        report.flipbook++
        const runs = chain.reduce((acc, node, k) =>
        {
            const last = acc[acc.length - 1]
            const same = last && ((!node && !last.node) || (node && last.node && sameTopology(node.getMesh()!, last.node.getMesh()!)
                && sameGeometry(node.getMesh()!, last.node.getMesh()!) && sameTransform(node, last.node)))
            if (same) { last.to = k + 1; return acc }
            return [...acc, { node, from: k, to: k + 1 }]
        }, [] as Array<{ node: Node | null, from: number, to: number }>)

        const parent = parentFor(key, first, base)
        runs.filter(r => r.node).forEach(r =>
        {
            const shown = (r.from === 0) ? first! : copier.node(r.node!, first, parent)
            const own = shown.getScale()
            const hidden = own.map(v => v * HIDDEN_SCALE)
            // STEP: visible from halfway before its first frame to halfway after its last one
            const frameKeys = [...times.keys(), count - 1]
            channel(shown, 'scale', 'VEC3', frameKeys.flatMap(k => (k >= r.from && k < r.to) ? own : hidden), 'STEP', switchTimes())
        })
    })

    report.animated = anim.listChannels().length > 0
    if (!report.animated)
    {
        anim.listSamplers().forEach(s => s.dispose())
        anim.dispose()
        input.dispose()
    }
    return report
}

//// MORPH TARGETS ////

/** A morph target per frame on every primitive of the node's mesh, and the weights that play
 *  them: frame k is target k at weight 1, frame 0 none. */
function addMorphTargets(base: Document, buffer: any, node: Node, meshes: Array<Mesh>, weights: (values: Array<number>) => void): void
{
    const mesh = ownMesh(node)
    const targets = meshes.length - 1
    mesh.listPrimitives().forEach((prim, i) =>
    {
        const semantics = ['POSITION', 'NORMAL'].filter(s => prim.getAttribute(s))
        meshes.slice(1).forEach(other =>
        {
            const target = base.createPrimitiveTarget()
            semantics.forEach(semantic =>
            {
                const from = prim.getAttribute(semantic)!.getArray()!
                const to = other.listPrimitives()[i].getAttribute(semantic)!.getArray()!
                const delta = new Float32Array(from.length).map((_, j) => Number(to[j]) - Number(from[j]))
                target.setAttribute(semantic, base.createAccessor().setType('VEC3').setArray(delta).setBuffer(buffer))
            })
            prim.addTarget(target)
        })
    })
    mesh.setWeights(new Array(targets).fill(0))
    weights(Array.from({ length: targets + 1 }, (_, k) =>
        Array.from({ length: targets }, (_, j) => (j === k - 1) ? 1 : 0)).flat())
}

/** The node's mesh, made its own first when other nodes draw it too: targets go on its
 *  primitives, which must not change another node's geometry. */
function ownMesh(node: Node): Mesh
{
    const mesh = node.getMesh()!
    const users = mesh.listParents().filter(p => p.propertyType === 'Node')
    if (users.length <= 1) { return mesh }
    const own = mesh.clone()
    own.listPrimitives().forEach(prim => { own.removePrimitive(prim); own.addPrimitive(prim.clone()) })
    node.setMesh(own)
    return own
}

//// COMPARING ////

function sameTopology(a: Mesh, b: Mesh): boolean
{
    const pa = a.listPrimitives()
    const pb = b.listPrimitives()
    return pa.length === pb.length && pa.every((p, i) =>
    {
        const q = pb[i]
        const sa = p.listSemantics().sort().join()
        const ia = p.getIndices()?.getArray()
        const ib = q.getIndices()?.getArray()
        return p.getMode() === q.getMode() && sa === q.listSemantics().sort().join()
            && p.getAttribute('POSITION')?.getCount() === q.getAttribute('POSITION')?.getCount()
            && (!ia && !ib || (!!ia && !!ib && sameNumbers(ia, ib, 0)))
    })
}

/** Same topology, and the same positions and normals too. */
function sameGeometry(a: Mesh, b: Mesh): boolean
{
    const pb = b.listPrimitives()
    return a.listPrimitives().every((p, i) => ['POSITION', 'NORMAL'].every(semantic =>
    {
        const x = p.getAttribute(semantic)?.getArray()
        const y = pb[i].getAttribute(semantic)?.getArray()
        return (!x && !y) || (!!x && !!y && sameNumbers(x, y))
    }))
}

function sameTransform(a: Node, b: Node): boolean
{
    return (['translation', 'rotation', 'scale'] as const).every(path => sameNumbers(trs(a, path), trs(b, path)))
}

function trs(node: Node, path: 'translation' | 'rotation' | 'scale'): Array<number>
{
    return [...((path === 'translation') ? node.getTranslation() : (path === 'rotation') ? node.getRotation() : node.getScale())]
}

function sameNumbers(a: ArrayLike<number>, b: ArrayLike<number>, tolerance: number = 1e-6): boolean
{
    if (a.length !== b.length) { return false }
    return Array.from({ length: a.length }, (_, i) => i).every(i => Math.abs(Number(a[i]) - Number(b[i])) <= tolerance)
}

//// THE TREE ////

/** Every node that draws a mesh, by the path of names from the scene root; a name its
 *  siblings share gets `#2`, `#3`, as the frames list them in the same order. */
function geometryNodes(doc: Document): Map<string, Node>
{
    const out = new Map<string, Node>()
    const walk = (nodes: Array<Node>, path: string) =>
    {
        const seen = new Map<string, number>()
        nodes.forEach(node =>
        {
            const name = node.getName()
            const n = (seen.get(name) ?? 0) + 1
            seen.set(name, n)
            const here = `${path}/${encodeURIComponent(name)}${(n > 1) ? `#${n}` : ''}`
            if (node.getMesh()) { out.set(here, node) }
            walk(node.listChildren(), here)
        })
    }
    walk(doc.getRoot().listScenes()[0]?.listChildren() ?? [], '')
    return out
}

/** Where the copies of a node go: beside the first frame's node, or in the container the key
 *  names, or at the top of the scene. */
function parentFor(key: string, first: Node | null, base: Document): Node | null
{
    const parent = first?.getParentNode()
    if (parent) { return parent }
    const containers = new Map<string, Node>()
    const walk = (list: Array<Node>, path: string) => list.forEach(node =>
    {
        const here = `${path}/${encodeURIComponent(node.getName())}`
        if (!containers.has(here)) { containers.set(here, node) }
        walk(node.listChildren(), here)
    })
    walk(base.getRoot().listScenes()[0]?.listChildren() ?? [], '')
    const up = key.slice(0, key.lastIndexOf('/')).replace(/#\d+$/, '')
    return containers.get(up) ?? base.getRoot().listScenes()[0]?.listChildren()[0] ?? null
}

//// COPYING INTO THE FIRST FRAME ////

/** Copies nodes, meshes and materials from the other frames' documents into the first. */
class Copier
{
    _materials = new Map<Material, Material>()

    constructor(private base: Document, private buffer: any, private frames: Array<Document>) {}

    /** A copy of a frame's geometry node, under `parent`, with its own transform. */
    node(node: Node, first: Node | null, parent: Node | null): Node
    {
        const copy = this.base.createNode(node.getName())
            .setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale())
            .setMesh(this.mesh(node.getMesh()!, first?.getMesh() ?? null))
        if (node.getExtras()) { copy.setExtras({ ...node.getExtras() }) }
        if (parent) { parent.addChild(copy) }
        else { this.base.getRoot().listScenes()[0]?.addChild(copy) }
        return copy
    }

    mesh(mesh: Mesh, like: Mesh | null): Mesh
    {
        const copy = this.base.createMesh(mesh.getName())
        const likePrims = like?.listPrimitives() ?? []
        mesh.listPrimitives().forEach((prim, i) =>
        {
            const out = this.base.createPrimitive().setMode(prim.getMode())
            prim.listSemantics().forEach(semantic => out.setAttribute(semantic, this.accessor(prim.getAttribute(semantic)!)))
            const indices = prim.getIndices()
            if (indices) { out.setIndices(this.accessor(indices)) }
            const material = prim.getMaterial()
            if (material) { out.setMaterial(this.material(material, likePrims[i]?.getMaterial() ?? null)) }
            this.edges(prim, out, likePrims[i] ?? null)
            copy.addPrimitive(out)
        })
        return copy
    }

    accessor(accessor: Accessor): Accessor
    {
        return this.base.createAccessor(accessor.getName())
            .setType(accessor.getType())
            .setArray(accessor.getArray()!.slice() as any)
            .setNormalized(accessor.getNormalized())
            .setBuffer(this.buffer)
    }

    /** The first frame's material where the other frame has the same one by name, else a copy. */
    material(material: Material, like: Material | null): Material
    {
        if (like && like.getName() === material.getName()) { return like }
        const known = this._materials.get(material)
        if (known) { return known }

        const copy = this.base.createMaterial(material.getName())
            .setBaseColorFactor(material.getBaseColorFactor())
            .setEmissiveFactor(material.getEmissiveFactor())
            .setMetallicFactor(material.getMetallicFactor())
            .setRoughnessFactor(material.getRoughnessFactor())
            .setAlphaMode(material.getAlphaMode())
            .setAlphaCutoff(material.getAlphaCutoff())
            .setDoubleSided(material.getDoubleSided())
        const texture = material.getBaseColorTexture()
        if (texture)
        {
            const image = texture.getImage()
            const info = material.getBaseColorTextureInfo()
            const own = this.base.createTexture(texture.getName()).setMimeType(texture.getMimeType())
            if (image) { own.setImage(image.slice()) }
            copy.setBaseColorTexture(own)
            if (info) { copy.getBaseColorTextureInfo()!.setWrapS(info.getWrapS()).setWrapT(info.getWrapT()).setTexCoord(info.getTexCoord()) }
        }
        this.styles(material, copy)
        this._materials.set(material, copy)
        return copy
    }

    /** The line and point styles of Archiyou's materials: plain values on the extension. */
    styles(from: Material, to: Material): void
    {
        Object.entries(STYLES).forEach(([name, fields]) =>
        {
            const prop = from.getExtension<any>(name)
            const own = prop && this.extension(name)?.createProperty?.()
            if (!own) { return }
            fields.forEach(field => { own[field] = prop[field] })
            to.setExtension(name, own)
        })
    }

    /** CAD edges: the visibility of each triangle edge, and the material they are drawn in. */
    edges(from: Primitive, to: Primitive, like: Primitive | null): void
    {
        const prop = from.getExtension<any>(EDGE_VISIBILITY)
        const own = prop && this.extension(EDGE_VISIBILITY)?.createProperty?.()
        if (!own) { return }
        if (prop.visibilityAccessor) { own.visibilityAccessor = this.accessor(prop.visibilityAccessor) }
        if (prop.edgeMaterial)
        {
            const likeEdge = like?.getExtension<any>(EDGE_VISIBILITY)?.edgeMaterial ?? null
            own.edgeMaterial = this.material(prop.edgeMaterial, likeEdge)
        }
        to.setExtension(EDGE_VISIBILITY, own)
    }

    /** The first frame's extension of that name, or a new one of the class the other frames
     *  read it with. */
    extension(name: string): any
    {
        const used = (doc: Document) => doc.getRoot().listExtensionsUsed().find(e => e.extensionName === name)
        const own = used(this.base)
        if (own) { return own }
        const other = this.frames.map(used).find(Boolean)
        return other ? this.base.createExtension(other.constructor as any) : null
    }
}
