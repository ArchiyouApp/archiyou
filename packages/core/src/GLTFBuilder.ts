/**
 * GLTFBuilder.ts
 *
 *  Archiyou leans on GLTF quite a bit: as basic vizualisation format and as advanced usage:
 *
 *  - The Archiyou viewer is a GLTF viewer with Archiyou-specific extensions
 *  - These extensions include: line rendering (following the Cesium/Bentley standard),
 *        animations, and Archiyou-specific extras (scenegraph, annotations, managed handles)
 *
 *  Our default geometry kernel Meshup writes GLTF, but the GLTFBuilder extends it.
 *
 *  ## Animations
 *
 *  Every animation the builder writes — a layout, an instructable, an animator animation —
 *  goes through one baker, addAnimationData(), which takes resolved AnimationData
 *  (animator/types.ts): keyframes per scene path, in seconds. What glTF can say is written as
 *  channels:
 *
 *   - a POSE as translation/rotation/scale channels on the part's container node, sampled as
 *     one rigid transform about the part's own centre;
 *   - VISIBILITY as a STEP scale channel on the part's geometry nodes (1 ↔ 1e-4);
 *   - COLOUR and OPACITY as KHR_animation_pointer channels on the part's materials;
 *   - a CAMERA as an animated camera node.
 *
 *  The AnimationData itself goes into the root extras (`extras.animations`), for the viewer.
 */

import { Document, Primitive, type Material, type Node as GltfNode, type Animation } from '@gltf-transform/core'
import { createNodeIO as createMeshupNodeIO, GLTFJsonDocumentToString } from '@archiyou/meshup'

import type { ArchiyouData } from './modeler/brep/types'
import type {
    LayoutAnimationOptions,
    LayoutTransformationResult,
} from './modeler/types'
import type { AnimationData, Easing, Quat, TrackData, Vec3, VisibleKey } from './animator/types'

import { AnimationPointerExtension, BASE_COLOR_FACTOR, KHR_ANIMATION_POINTER, POINTER_TARGET_PATH } from './animator/AnimationPointerExtension'
import {
    EASED_KEYFRAME_SAMPLE_COUNT,
    HIDDEN_SCALE,
    IDENTITY_QUATERNION,
    add, bakeKeys, hexToLinear, isIdentityQuat, isSameQuat, isSameVec, lerpVec,
    lookAtQuaternion, multiplyVec, normalizeQuat, rotatePoint, sampleAt, sampleCount, slerp, subtract,
} from './animator/sampling'
import { instructToAnimation } from './animator/instruct'
import { mergeParamFrames, type ParamFramesData, type ParamFramesReport } from './animator/frames'
import { placementsOf } from './modeler/placements'

export type {
    LayoutAnimationOptions,
} from './modeler/types'

export { EASED_KEYFRAME_SAMPLE_COUNT, SPRING_KEYFRAME_SAMPLE_COUNT } from './animator/sampling'

type CachedLayoutAnimationDefinition = {
    result: LayoutTransformationResult
    options?: LayoutAnimationOptions
}


/** glTF primitive modes that draw faces; the rest (points, lines) are line-work. */
const TRIANGLE_MODES = new Set([4, 5, 6])

/** meshup's IO, with KHR_animation_pointer registered too: every GLB this builder reads or
 *  writes may carry colour and opacity channels, and an IO without the extension would drop
 *  their pointers. */
export function createNodeIO()
{
    return createMeshupNodeIO().registerExtensions([AnimationPointerExtension])
}

/** Display names for one set of siblings: a name shared by more than one of them gets a
 *  `[i]` suffix, in order.
 *
 *  This mirrors meshup's `SceneNode._siblingDisplayNames`, which is the rule `SceneNode.path()`
 *  is built from. It is duplicated here rather than imported because the nodes being named on
 *  this side are glTF nodes, not SceneNodes — the viewer's `_buildPathMap()` duplicates it for
 *  the same reason. `gltfBuilder.scenePaths.test.ts` pins the two against each other, which is
 *  what stops them drifting. */
function siblingDisplayNames(names: Array<string>): Array<string>
{
    const counts: Record<string, number> = {}
    names.forEach(n => { counts[n] = (counts[n] ?? 0) + 1 })
    const seen: Record<string, number> = {}
    return names.map(n =>
    {
        if (counts[n] > 1)
        {
            const idx = seen[n] = (seen[n] ?? 0) + 1
            return `${n}[${idx - 1}]`
        }
        return n
    })
}

const GLB_MAGIC = 0x46546C67       // 'glTF'
const GLB_CHUNK_JSON = 0x4E4F534A  // 'JSON'

/** The GLB with `extras` merged into its root extras, or null when it is not a GLB we can
 *  read. Only the JSON chunk is rewritten; the binary chunk is copied as it is. Reading the
 *  whole GLB into a Document and writing it out again, only to add the Archiyou state, took
 *  about as long as building the GLB in the first place. */
function glbWithRootExtras(glb: Uint8Array, extras: Record<string, unknown>): Uint8Array | null
{
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
    if (glb.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== GLB_CHUNK_JSON) return null

    const jsonLength = view.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)))
    json.extras = { ...(json.extras ?? {}), ...extras }

    const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
    const paddedLength = Math.ceil(jsonBytes.byteLength / 4) * 4 // chunks are 4-byte aligned
    const rest = glb.subarray(20 + jsonLength) // the binary chunk, with its own header

    const out = new Uint8Array(20 + paddedLength + rest.byteLength)
    const outView = new DataView(out.buffer)
    out.set(glb.subarray(0, 8)) // magic and version
    outView.setUint32(8, out.byteLength, true)
    outView.setUint32(12, paddedLength, true)
    outView.setUint32(16, GLB_CHUNK_JSON, true)
    out.set(jsonBytes, 20)
    out.fill(0x20, 20 + jsonBytes.byteLength, 20 + paddedLength) // the JSON chunk pads with spaces
    out.set(rest, 20 + paddedLength)
    return out
}

/** A part's pose with every field filled: where its centre is, how it is turned and scaled
 *  about that centre. */
interface FullPose
{
    position: Vec3
    rotation: Quat
    scale: Vec3
}

export interface AddAnimationDataOptions
{
    /** Write the AnimationData into `extras.animations` too. Default true. */
    extras?: boolean
}

export class GLTFBuilder
{
    //// SETTINGS ////
    SUBSHAPE_OUTPUT_NAME_SEPERATOR: string = '___';

    private doc: Document;
    private _initialGlb: Uint8Array | null = null;
    private _modified = false;
    private _docLoaded = false;
    /** Root extras from addData() while the source GLB is not read into a Document (see toGLB()) */
    private _pendingExtras: Record<string, unknown> | null = null;
    /** What has gone into `extras.animations` so far: addData() merges top-level keys only, so
     *  the list is kept here and written whole. */
    private _animationsExtras: Array<AnimationData> = [];

    constructor(glb?: ArrayBuffer | Uint8Array)
    {
        if (glb)
        {
            this._initialGlb = (glb instanceof ArrayBuffer) ? new Uint8Array(glb) : glb;
        }
        this.doc = new Document();
        this.doc.createScene('scene');
    }

    /** Return the (possibly modified) GLB. If unmodified and a source GLB was provided, returns it directly. */
    async toGLB(): Promise<Uint8Array>
    {
        if (!this._modified && this._initialGlb)
        {
            return this._initialGlb;
        }
        // Only data was added: put it into the source GLB as it is
        if (!this._docLoaded && this._pendingExtras && this._initialGlb)
        {
            const glb = glbWithRootExtras(this._initialGlb, this._pendingExtras);
            if (glb) return glb;
            await this._ensureDoc(); // not a GLB we can patch: take the long way
        }
        return createNodeIO().writeBinary(this.doc);
    }

    /** Convert to a self-contained GLTF JSON string. */
    async toGLTF(): Promise<string>
    {
        const glb = await this.toGLB();
        return createNodeIO().readBinary(glb).then(doc => createNodeIO().writeJSON(doc)).then(GLTFJsonDocumentToString);
    }

    //// SPECIAL ARCHIYOU GLTF ADDITIONS ////

    /** Lazily read the source GLB into a gltf-transform Document exactly once,
     *  so addData() and the animations compose instead of clobbering each other. */
    private async _ensureDoc(): Promise<Document>
    {
        if (!this._docLoaded)
        {
            if (!this._initialGlb) { throw new Error('GLTFBuilder._ensureDoc(): no GLB source provided — pass a GLB to the constructor.') }
            this.doc = await createNodeIO().readBinary(this._initialGlb)
            this._docLoaded = true
            if (this._pendingExtras)
            {
                const existing = (this.doc.getRoot().getExtras() ?? {}) as Record<string, unknown>
                this.doc.getRoot().setExtras({ ...existing, ...this._pendingExtras })
                this._pendingExtras = null
            }
        }
        return this.doc
    }

    /** Put arbitrary data into the root extras of the GLB. Merges with any existing extras.
     *  Held back while nothing else needs the GLB read into a Document: toGLB() then writes it
     *  into the source GLB directly. */
    async addData(data: Record<string, unknown>): Promise<this>
    {
        if (!this._docLoaded && this._initialGlb)
        {
            this._pendingExtras = { ...(this._pendingExtras ?? {}), ...data }
            this._modified = true
            return this
        }
        await this._ensureDoc()
        const existing = (this.doc.getRoot().getExtras() ?? {}) as Record<string, unknown>
        this.doc.getRoot().setExtras({ ...existing, ...data })
        this._modified = true
        return this
    }

    //// ANIMATIONS ////

    /** Bake resolved animations into the GLB: one clip each, and the data in
     *  `extras.animations`. See the header for what becomes which channel. */
    async addAnimationData(data: AnimationData | Array<AnimationData>, options: AddAnimationDataOptions = {}): Promise<this>
    {
        if (!this._initialGlb) { throw new Error('GLTFBuilder.addAnimationData(): no GLB source provided — pass a GLB to the constructor.') }

        await this._ensureDoc()

        const list = Array.isArray(data) ? data : [data]
        const baked = list.filter(animation => this._bake(animation))

        if (options.extras !== false && baked.length)
        {
            this._animationsExtras = [...this._animationsExtras, ...baked]
            await this.addData({ animations: this._animationsExtras })
        }

        this._modified = true
        return this
    }

    /** A parameter sweep: the GLBs of the other frames, each a run of the script with that
     *  frame's values, merged into this one (frame 0) as one clip. A part that keeps its mesh
     *  morphs from frame to frame, one that does not is played as a flipbook
     *  (animator/frames.ts). Its data goes into `extras.animations`, with the frames' values.
     *  @returns what the merge did; nothing is written when nothing changes over the frames */
    async addParamFrames(frames: Array<ArrayBuffer | Uint8Array>, data: ParamFramesData & { values?: Array<Record<string, any>> }): Promise<ParamFramesReport>
    {
        if (!this._initialGlb) { throw new Error('GLTFBuilder.addParamFrames(): no GLB source provided — pass the first frame\'s GLB to the constructor.') }

        await this._ensureDoc()
        const io = createNodeIO()
        const docs = await Promise.all(frames.map(f => io.readBinary((f instanceof ArrayBuffer) ? new Uint8Array(f) : f)))
        const report = mergeParamFrames(this.doc, docs, data)

        if (report.animated)
        {
            const entry: AnimationData = {
                name: data.name,
                ...(data.title ? { title: data.title } : {}),
                duration: data.duration,
                loop: data.loop,
                tracks: [],
                params: { frames: data.values ?? [] },
            }
            this._animationsExtras = [...this._animationsExtras, entry]
            await this.addData({ animations: this._animationsExtras })
            this._modified = true
        }
        return report
    }

    //// LAYOUT ANIMATIONS ////

    async addAnimation(
        result: LayoutTransformationResult,
        options: LayoutAnimationOptions = {},
    ): Promise<this>
    {
        await this.addAnimations([{ result, options }])
        return this
    }

    /** A clip per layout: from where the model has every part to where the layout puts it.
     *
     *  Layouts go through placementsOf(): a layout turns a part about its own centre (see
     *  modeler/placements.ts), and the baker writes that about the centre too. */
    async addAnimations(
        definitions: Array<CachedLayoutAnimationDefinition>,
    ): Promise<this>
    {
        if (!this._initialGlb) { throw new Error('GLTFBuilder.addAnimations(): no GLB source provided — pass a GLB to the constructor.') }

        const animations = definitions.map(({ result, options }) =>
            layoutToAnimation(result, options ?? {}))

        // the layout clips are two fixed views of the model, not authored animations: no extras
        return this.addAnimationData(animations, { extras: false })
    }

    //// INSTRUCTABLES ////

    /** Write an instructable into the GLB: one continuous animation, a camera per step, and
     *  the step data itself in root extras.
     *
     *  ## Why one clip and not one per step
     *
     *  A viewer that knows nothing about Archiyou can only play animations. Given N clips it
     *  shows a list of twenty unnamed entries and there is nothing to scrub. Given ONE clip
     *  spanning the whole build it plays the assembly as a movie, which is a genuinely useful
     *  artefact in Blender or <model-viewer>. Archiyou's own viewer reads
     *  `extras.instruct.steps[i].tStart` and seeks, so it loses nothing by sharing.
     *
     *  ## What the animation says
     *
     *  Where every part is over the manual (animator/instruct.ts): parked at its approach until
     *  its step, laid out where a step lays it out. Hiding and highlighting per step stay the
     *  viewer's job, off `extras.instruct`.
     */
    async addInstruct(data: any, options?: { cameras?: boolean }): Promise<this>
    {
        if (!this._initialGlb) { throw new Error('GLTFBuilder.addInstruct(): no GLB source provided — pass a GLB to the constructor.') }

        await this._ensureDoc()

        const steps = data?.steps ?? []
        if (steps.length)
        {
            const nodesByPath = this._nodesByScenePath()
            const animation = instructToAnimation(data, path =>
            {
                const node = nodesByPath.get(path)
                return node ? this._centreOfNode(node) ?? undefined : undefined
            })
            this._bake(animation)
            if (options?.cameras !== false) { this._addInstructCameras(data) }
        }

        await this.addData({ instruct: data })
        this._modified = true

        return this
    }

    //// THE BAKER ////

    /** One clip for one animation. False when it came out empty (nothing it names is in the
     *  file, or nothing moves): glTF requires a clip to have channels, so none is written. */
    private _bake(data: AnimationData): boolean
    {
        const root = this.doc.getRoot()

        if (root.listAnimations().some(a => a.getName() === data.name))
        {
            console.warn(`GLTFBuilder: the file already has an animation "${data.name}", so a second one `
                + `of that name was not written.`)
            return false
        }

        /*  Targets are resolved by SCENE PATH, not by name.
            `SceneNode.name` is not unique among siblings — four legs of a table are four nodes
            all called `leg`, and the glTF node is created with that raw name — so a name-keyed
            Map kept only the last of them and every one of the four transforms landed on that
            single node: three legs never moved and one moved four times. Uniqueness lives in
            `SceneNode.path()` (the `name[i]` sibling-suffix rule), which is also what the
            viewer keys its object map on. The name is a fallback for a GLB that was not
            written from this scene, and wrong for duplicate names, hence the warning below. */
        const nodesByPath = this._nodesByScenePath()
        const nodesByName = new Map<string, GltfNode>(
            root.listNodes().map(node => [node.getName(), node] as [string, GltfNode]))

        const nodeOf = (path: string): GltfNode | undefined =>
            nodesByPath.get(path) ?? nodesByName.get(decodeURIComponent(path.split('/').pop() ?? path))

        const buffer = root.listBuffers()[0] ?? this.doc.createBuffer()
        const anim = this.doc.createAnimation(data.name)
        const duration = data.duration
        const posed = new Set<GltfNode>()
        const visibility = new Map<GltfNode, Array<Array<VisibleKey>>>()

        data.tracks.forEach(track =>
        {
            const node = nodeOf(track.path)
            if (!node) { return }

            if (track.pose?.length)
            {
                /*  Two pose tracks on one node means the resolution above failed to tell two
                    scene nodes apart. The channels would stack and the result would be wrong in a
                    way that looks like a layout bug, so say so. */
                if (posed.has(node))
                {
                    console.warn(`GLTFBuilder: animation "${data.name}" targets glTF node "${node.getName()}" `
                        + `more than once — two scene nodes resolved to it. Their keyframes will stack. `
                        + `This usually means the GLB was not written from the scene these came from.`)
                }
                posed.add(node)
                this._bakePose(anim, buffer, node, track, duration)
            }

            if (track.visible?.length)
            {
                this._meshNodesUnder(node).forEach(mesh =>
                    visibility.set(mesh, [...(visibility.get(mesh) ?? []), track.visible!]))
            }

            if (track.color?.length || track.opacity?.length)
            {
                this._bakeStyle(anim, buffer, node, track, duration)
            }
        })

        visibility.forEach((lists, mesh) => this._bakeVisibility(anim, buffer, mesh, lists, duration))

        if (data.camera?.keys?.length) { this._bakeCamera(anim, buffer, data) }

        if (!anim.listChannels().length)
        {
            anim.dispose()
            return false
        }

        this._modified = true
        return true
    }

    /** The node's translation, rotation and scale over time, sampled as one rigid transform.
     *
     *  A pose turns and scales the part about its own centre `c` and moves the centre to
     *  `position`. The part's geometry hangs off its container node (meshup writes it that
     *  way), so for a container at its authored translation `a` that is node rotation `R`,
     *  scale `S` and translation
     *
     *      position + R·S·(a − c)
     *
     *  Sampled TOGETHER rather than channel by channel: interpolating translation and rotation
     *  apart makes a turning part swing off the path its centre is given. So a segment that
     *  turns gets eased samples even when it is linear. Rotation is eased like translation. */
    private _bakePose(anim: Animation, buffer: any, node: GltfNode, track: TrackData, duration: number): void
    {
        const authored = node.getTranslation() as Vec3
        const centre = track.centre ?? this._centreOfNode(node) ?? authored

        const keys = (track.pose ?? []).map(k => ({
            t: k.t,
            easing: k.easing,
            value: {
                position: k.position ?? centre,
                rotation: normalizeQuat(k.rotation ?? IDENTITY_QUATERNION),
                scale: k.scale ?? [1, 1, 1],
            } as FullPose,
        }))

        const turns = (a: FullPose, b: FullPose) =>
            !isSameQuat(a.rotation, b.rotation) || !isSameVec(a.scale, b.scale)

        const baked = bakeKeys<FullPose>(keys, {
            same: (a, b) => isSameVec(a.position, b.position) && !turns(a, b),
            interpolate: (a, b, e) => ({
                position: lerpVec(a.position, b.position, e),
                rotation: slerp(a.rotation, b.rotation, e),
                scale: lerpVec(a.scale, b.scale, e),
            }),
            samples: (a, b) => (b.easing === 'linear' && turns(a.value, b.value))
                ? EASED_KEYFRAME_SAMPLE_COUNT
                : sampleCount(b.easing),
            duration,
        })

        const offset = subtract(authored, centre)
        const translations = baked.values.map(p => add(p.position, rotatePoint(p.rotation, multiplyVec(p.scale, offset))))
        const rotations = baked.values.map(p => p.rotation)
        const scales = baked.values.map(p => p.scale)

        const writeTranslation = translations.some(t => !isSameVec(t, authored))
        const writeRotation = rotations.some(r => !isIdentityQuat(r))
        const writeScale = scales.some(s => !isSameVec(s, [1, 1, 1]))
        if (!writeTranslation && !writeRotation && !writeScale) { return }

        const input = this._accessor(buffer, 'SCALAR', baked.times)

        if (writeRotation) { this._channel(anim, input, this._accessor(buffer, 'VEC4', rotations.flat()), node, 'rotation') }
        if (writeTranslation) { this._channel(anim, input, this._accessor(buffer, 'VEC3', translations.flat()), node, 'translation') }
        if (writeScale) { this._channel(anim, input, this._accessor(buffer, 'VEC3', scales.flat()), node, 'scale') }
    }

    /** A geometry node shown and hidden: a STEP scale channel, its own scale or HIDDEN_SCALE.
     *  Several tracks can reach one mesh (a layer hidden while one of its parts is hidden too):
     *  it is visible while all of them say so. Before a track's first key, its first value
     *  holds. */
    private _bakeVisibility(anim: Animation, buffer: any, mesh: GltfNode, lists: Array<Array<VisibleKey>>, duration: number): void
    {
        const sorted = lists.map(keys => [...keys].sort((a, b) => a.t - b.t))
        const valueAt = (keys: Array<VisibleKey>, t: number) =>
            keys.reduce((value, k) => (k.t <= t) ? k.value : value, keys[0].value)
        const visibleAt = (t: number) => sorted.every(keys => valueAt(keys, t))

        const times = [...new Set([0, ...sorted.flatMap(keys => keys.map(k => k.t))])]
            .filter(t => t >= 0 && t <= duration)
            .sort((a, b) => a - b)

        // STEP: a sample only where the value changes, and one at the end so the clip is long enough
        const changes = times.reduce((acc, t) =>
        {
            const visible = visibleAt(t)
            return (acc.length && acc[acc.length - 1].visible === visible) ? acc : [...acc, { t, visible }]
        }, [] as Array<{ t: number, visible: boolean }>)

        if (changes.every(c => c.visible)) { return }

        const last = changes[changes.length - 1]
        const samples = (last.t < duration) ? [...changes, { t: duration, visible: last.visible }] : changes

        const own = mesh.getScale() as Vec3
        const values = samples.flatMap(s => s.visible ? own : own.map(v => v * HIDDEN_SCALE))

        this._channel(anim, this._accessor(buffer, 'SCALAR', samples.map(s => s.t)),
            this._accessor(buffer, 'VEC3', values), mesh, 'scale', 'STEP')
    }

    /** Colour and opacity of a part, as KHR_animation_pointer channels on its materials'
     *  baseColorFactor: RGB from the colour keys, A from the opacity keys times the
     *  material's own alpha.
     *
     *  Colour goes to the faces (or to the line-work of a part that has no faces); opacity to
     *  everything the part draws, its edges included, so edges fade with their faces. A
     *  material another part shares is cloned first, so recolouring one part never recolours
     *  another. */
    private _bakeStyle(anim: Animation, buffer: any, node: GltfNode, track: TrackData, duration: number): void
    {
        const { faces, lines, edges } = this._materialsUnder(node)
        const colourTargets = new Set(faces.length ? faces : lines)

        const colourKeysOf = (own: Vec3) => (track.color ?? []).map(k => ({
            t: k.t, easing: k.easing, value: k.value ? hexToLinear(k.value) as Array<number> : own,
        }))
        const opacityKeys = (track.opacity ?? []).map(k => ({
            t: k.t, easing: k.easing, value: [Math.min(1, Math.max(0, k.value))],
        }))

        const vecOptions = {
            same: (a: Array<number>, b: Array<number>) => isSameVec(a, b),
            interpolate: (a: Array<number>, b: Array<number>, e: number) => lerpVec(a, b, e),
            duration,
        }
        const opacity = opacityKeys.length ? bakeKeys<Array<number>>(opacityKeys, vecOptions) : null
        const clamp = (v: number) => Math.min(1, Math.max(0, v))

        const materials = [...new Set([...faces, ...lines, ...edges])]
        materials.forEach(material =>
        {
            const base = material.getBaseColorFactor() as [number, number, number, number]
            const own: Vec3 = [base[0], base[1], base[2]]
            const colour = (track.color?.length && colourTargets.has(material))
                ? bakeKeys<Array<number>>(colourKeysOf(own), vecOptions)
                : null
            if (!colour && !opacity) { return }

            const times = [...new Set([...(colour?.times ?? []), ...(opacity?.times ?? [])])].sort((a, b) => a - b)
            const rgba = times.map(t =>
            {
                const rgb = colour ? sampleAt(colour, t).map(clamp) : own
                const alpha = base[3] * (opacity ? clamp(sampleAt(opacity, t)[0]) : 1)
                return [rgb[0], rgb[1], rgb[2], alpha]
            })

            if (rgba.every(v => isSameVec(v, base, 1e-6))) { return }
            if (rgba.some(v => v[3] < 1)) { material.setAlphaMode('BLEND') }

            const channel = this._channel(anim, this._accessor(buffer, 'SCALAR', times),
                this._accessor(buffer, 'VEC4', rgba.flat()), null, POINTER_TARGET_PATH)
            channel.setExtension(KHR_ANIMATION_POINTER, this._pointerExtension().createPointer(material, BASE_COLOR_FACTOR))
        })
    }

    /** An animated camera node, `<animation>-camera`, from the animation's camera keys. */
    private _bakeCamera(anim: Animation, buffer: any, data: AnimationData): void
    {
        const cam = data.camera!
        const scene = this.doc.getRoot().listScenes()[0]
        if (!scene) { return }

        const keys = cam.keys.map(k => ({ t: k.t, easing: k.easing as Easing, value: [...k.position, ...k.lookAt] }))
        const baked = bakeKeys<Array<number>>(keys, {
            same: (a, b) => isSameVec(a, b),
            interpolate: (a, b, e) => lerpVec(a, b, e),
            duration: data.duration,
        })

        const eyes = baked.values.map(v => [v[0], v[1], v[2]] as Vec3)
        const rotations = baked.values.map(v => lookAtQuaternion([v[0], v[1], v[2]], [v[3], v[4], v[5]]))
        const first = cam.keys[0]
        const distance = Math.hypot(...subtract(first.lookAt, first.position)) || cam.radius || 1

        const camera = this._createCamera(`${data.name}-camera`, cam.projection, cam.radius || 1, distance)
        const node = this.doc.createNode(`${data.name}-camera`)
            .setCamera(camera)
            .setTranslation(eyes[0])
            .setRotation(rotations[0])
        scene.addChild(node)

        const input = this._accessor(buffer, 'SCALAR', baked.times)
        this._channel(anim, input, this._accessor(buffer, 'VEC3', eyes.flat()), node, 'translation')
        this._channel(anim, input, this._accessor(buffer, 'VEC4', rotations.flat()), node, 'rotation')
    }

    private _accessor(buffer: any, type: 'SCALAR' | 'VEC3' | 'VEC4', values: Array<number>)
    {
        return this.doc.createAccessor().setType(type).setArray(new Float32Array(values) as any).setBuffer(buffer)
    }

    private _channel(anim: Animation, input: any, output: any, node: GltfNode | null, path: string,
        interpolation: 'LINEAR' | 'STEP' = 'LINEAR')
    {
        const sampler = this.doc.createAnimationSampler()
            .setInput(input).setOutput(output).setInterpolation(interpolation)
        const channel = this.doc.createAnimationChannel()
            .setSampler(sampler).setTargetPath(path as any)
        if (node) { channel.setTargetNode(node) }
        anim.addSampler(sampler).addChannel(channel)
        return channel
    }

    /** Created on first use only: a file without colour or opacity channels does not list the
     *  extension. */
    private _pointerExtension(): AnimationPointerExtension
    {
        const existing = this.doc.getRoot().listExtensionsUsed()
            .find(e => e.extensionName === KHR_ANIMATION_POINTER) as AnimationPointerExtension | undefined
        return existing ?? this.doc.createExtension(AnimationPointerExtension).setRequired(false)
    }

    //// THE GLTF TREE ////

    /** Every node of the exported scene tree, keyed by the scene path it came from.
     *
     *  The glTF tree mirrors the SceneNode tree one for one: `_sceneNodeToGLTFNode()` makes a
     *  container node per SceneNode and hangs the node's geometry off it as a child. The two
     *  kinds are told apart structurally rather than by name — **a geometry node carries a
     *  mesh and a container never does** — so this needs no agreement about the
     *  `${name}_shape_0` convention, only about the shape of the tree.
     *
     *  Keys match `SceneNode.path()`: the root is always `Scene`, each segment is
     *  URI-encoded, and duplicate siblings carry a `[i]` suffix.
     */
    private _nodesByScenePath(): Map<string, GltfNode>
    {
        const out = new Map<string, GltfNode>()
        const scene = this.doc.getRoot().listScenes()[0]
        if (!scene) { return out }

        /*  The scene's own children are the exported roots. There is one in every GLB the
            Modeler writes (the scene root, named 'root'), and `SceneNode.path()` calls it
            'Scene' whatever it was named — so map it to that. Anything beyond the first is a
            GLB assembled some other way (or a camera node an animation added) and is keyed by
            its own name instead. */
        const roots = scene.listChildren().filter(n => !n.getMesh())

        const walk = (node: GltfNode, path: string): void =>
        {
            out.set(path, node)
            const children = node.listChildren().filter(c => !c.getMesh())
            const names = siblingDisplayNames(children.map(c => c.getName()))
            children.forEach((child, i) =>
                walk(child, `${path}/${encodeURIComponent(names[i])}`))
        }

        roots.forEach((rootNode, i) =>
            walk(rootNode, i === 0 ? encodeURIComponent('Scene') : encodeURIComponent(rootNode.getName())))

        return out
    }

    /** The geometry nodes of a subtree: the node itself when it carries a mesh, and every
     *  descendant that does. */
    private _meshNodesUnder(node: GltfNode): Array<GltfNode>
    {
        return [
            ...(node.getMesh() ? [node] : []),
            ...node.listChildren().flatMap(child => this._meshNodesUnder(child)),
        ]
    }

    /** Centre of a subtree's geometry in world coordinates, from the POSITION bounds of its
     *  meshes. Assumes, as meshup writes them, that the containers carry translations only and
     *  that every container above this one sits at the origin. Null when there is no geometry
     *  under it. */
    private _centreOfNode(node: GltfNode): Vec3 | null
    {
        const bounds = (n: GltfNode, offset: Vec3): Array<[Vec3, Vec3]> =>
        {
            const here = add(offset, n.getTranslation() as Vec3)
            const own = (n.getMesh()?.listPrimitives() ?? []).flatMap(prim =>
            {
                const position = prim.getAttribute('POSITION')
                if (!position || !position.getCount()) { return [] }
                return [[add(here, position.getMin([]) as Vec3), add(here, position.getMax([]) as Vec3)] as [Vec3, Vec3]]
            })
            return [...own, ...n.listChildren().flatMap(child => bounds(child, here))]
        }

        const all = bounds(node, [0, 0, 0])
        if (!all.length) { return null }

        const axis = (i: number) =>
            (Math.min(...all.map(b => b[0][i])) + Math.max(...all.map(b => b[1][i]))) / 2
        return [axis(0), axis(1), axis(2)]
    }

    /** The materials a subtree draws with: faces, line-work, and the edge materials
     *  EXT_mesh_primitive_edge_visibility hangs off its faces. Each one exclusive to this
     *  subtree: a material any primitive outside it also uses is cloned, and the clone put on
     *  the primitives inside. */
    private _materialsUnder(node: GltfNode): { faces: Array<Material>, lines: Array<Material>, edges: Array<Material> }
    {
        const prims = this._meshNodesUnder(node).flatMap(mesh => mesh.getMesh()!.listPrimitives())
        const inside = new Set<Primitive>(prims)
        const clones = new Map<Material, Material>()

        const exclusive = (prim: Primitive): Material | null =>
        {
            const material = prim.getMaterial()
            if (!material) { return null }

            const shared = material.listParents().some(p => p instanceof Primitive && !inside.has(p))
            if (!shared) { return material }

            const clone = clones.get(material) ?? material.clone()
            clones.set(material, clone)
            prim.setMaterial(clone)
            return clone
        }

        const faces: Array<Material> = []
        const lines: Array<Material> = []
        const edges: Array<Material> = []

        prims.forEach(prim =>
        {
            const material = exclusive(prim)
            if (material) { (TRIANGLE_MODES.has(prim.getMode()) ? faces : lines).push(material) }

            const edgeMaterial = (prim.getExtension('EXT_mesh_primitive_edge_visibility') as any)?.edgeMaterial as Material | undefined
            if (edgeMaterial) { edges.push(edgeMaterial) }
        })

        return { faces: [...new Set(faces)], lines: [...new Set(lines)], edges: [...new Set(edges)] }
    }

    //// INSTRUCT CAMERAS ////

    /** A camera node per step, so the file means something in Blender and <model-viewer>.
     *
     *  Separate cameras rather than one animated camera node: animating the view would fight
     *  the viewer's own orbit controls and make the movie lurch at every step boundary. A
     *  picker with "step 3" in it is more use than that.
     *
     *  This is also the only place `perspective()` becomes visible outside Archiyou — the
     *  printed drawings are orthographic whatever it says, because the kernel's hidden-line
     *  removal has no perspective mode. */
    private _addInstructCameras(data: any): void
    {
        const scene = this.doc.getRoot().listScenes()[0]
        if (!scene) { return }

        (data.steps ?? []).forEach((step: any) =>
        {
            const cam = step.camera
            if (!cam?.position || !cam?.lookAt) { return }

            const eye = cam.position as [number, number, number]
            const target = cam.lookAt as [number, number, number]
            const radius = this._bboxRadius(step.bbox) || 1
            const distance = Math.hypot(
                target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]) || radius

            const camera = this._createCamera(`${data.name}-step-${step.number}`, cam.projection, radius, distance)

            const node = this.doc.createNode(`${data.name}-step-${step.number}-camera`)
                .setCamera(camera)
                .setTranslation(eye)
                .setRotation(this._lookAtQuaternion(eye, target))

            scene.addChild(node)
        })
    }

    /** A glTF camera framing a sphere of `radius` from `distance` away. An orthographic camera
     *  has no field of view, so its magnification IS the framing: half the extent it shows, in
     *  world units, with a little air. */
    private _createCamera(name: string, projection: string, radius: number, distance: number)
    {
        const camera = this.doc.createCamera(name)

        if (projection === 'perspective')
        {
            camera.setType('perspective').setYFov(45 * Math.PI / 180)
                .setZNear(Math.max(distance - radius * 2, distance / 100))
                .setZFar(distance + radius * 4)
        }
        else
        {
            camera.setType('orthographic')
                .setXMag(radius * 1.2).setYMag(radius * 1.2)
                .setZNear(Math.max(distance - radius * 4, 0.01))
                .setZFar(distance + radius * 4)
        }

        return camera
    }

    /** Half the diagonal of a flat [minX,minY,minZ,maxX,maxY,maxZ]. */
    private _bboxRadius(bbox?: Array<number>): number
    {
        if (!bbox || bbox.length < 6) { return 0 }
        return Math.hypot(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]) / 2
    }

    /** Orientation of a camera at `eye` looking at `target`. See sampling.lookAtQuaternion(). */
    _lookAtQuaternion(eye: Array<number>, target: Array<number>): [number, number, number, number]
    {
        return lookAtQuaternion(eye, target)
    }

    //// READ-ONLY FUNCTIONS ////

    /** Get data from GLTF binary */
    async readData(gltf: ArrayBuffer | Uint8Array): Promise<ArchiyouData>
    {
        const buffer = this._convertArrayBufferToUint8Array(gltf);
        const doc = await createNodeIO().readBinary(buffer);
        return (doc.getRoot().getAsset()?.extras as any)?.archiyou as ArchiyouData;
    }

    //// UTILS ////

    _convertArrayBufferToUint8Array(buffer: ArrayBuffer | Uint8Array): Uint8Array
    {
        return (buffer instanceof ArrayBuffer) ? new Uint8Array(buffer) : buffer;
    }

    // The GLB carries the kernel's native Z-up coordinates unchanged
    // (meshup GLTFBuilder exports Z-up; the viewer is configured Z-up via
    // VIEWER_MODEL_COORDSYSTEM). Layouter transforms are already in that same
    // Z-up world space, so animation keyframes pass through without conversion.
    _worldToGltfTranslation(translation: [number, number, number]): [number, number, number]
    {
        return [translation[0], translation[1], translation[2]]
    }

    _worldToGltfQuaternion(rotation: [number, number, number, number]): [number, number, number, number]
    {
        return rotation
    }
}

/** A layout as an animation: from where the model has every part to where the layout puts
 *  it, over `duration`, eased. */
/** A parameter sweep's frames, each the GLB of a run with that frame's values, as one GLB with
 *  the sweep as a clip: the first frame with the others merged in (GLTFBuilder.addParamFrames).
 *  What the editor's worker and `archiyou animate` call. */
export async function mergeParamFrameGlbs(frames: Array<ArrayBuffer | Uint8Array>, data: ParamFramesData & { values?: Array<Record<string, any>> }): Promise<{ glb: Uint8Array, report: ParamFramesReport }>
{
    if (!frames.length) { throw new Error('mergeParamFrameGlbs(): no frames to merge.') }
    const builder = new GLTFBuilder(frames[0])
    const report = await builder.addParamFrames(frames.slice(1), data)
    return { glb: await builder.toGLB(), report }
}

export function layoutToAnimation(result: LayoutTransformationResult, options: LayoutAnimationOptions = {}): AnimationData
{
    const duration = options.duration ?? 1.0
    const easing = (options.interpolation ?? options.tween ?? 'easeInOut') as Easing

    return {
        name: options.animationName ?? result.name,
        duration,
        loop: 'none',
        tracks: placementsOf(result).map(p => ({
            path: p.path,
            centre: p.centre,
            pose: [
                { t: 0, easing: 'linear' },
                { t: duration, position: p.position, rotation: p.rotation, scale: p.scale, easing },
            ],
        })),
    }
}
