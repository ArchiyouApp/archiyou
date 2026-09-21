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
 * 
 */

// Vector/toRad come from the MESH kernel on purpose. They used to be imported from
// ./modeler/brep, which pulled the 10MB OpenCascade barrel into every mesh-only run — and
// worse, brep's Point constructor calls getOc(), so `new Vector(1,0,0)` below threw outright
// whenever the brep kernel had not been loaded.
import { Vector } from '@archiyou/meshup'
import { rad as toRad } from '@archiyou/meshup'
import type { ArchiyouData } from './modeler/brep/types'
import { Document, Accessor, Animation, AnimationChannel, AnimationSampler, Scene as GltfScene, Node as GltfNode } from '@gltf-transform/core'

import {
    createNodeIO,
} from '@archiyou/meshup'

import { GLTFJsonDocumentToString } from '@archiyou/meshup'
import type {
    LayoutAnimationInterpolation,
    LayoutAnimationOptions,
    LayoutTransformationResult,
} from './modeler/types'

export type {
    LayoutAnimationOptions,
} from './modeler/types'

type CachedLayoutAnimationDefinition = {
    result: LayoutTransformationResult
    options?: LayoutAnimationOptions
}

export const EASED_KEYFRAME_SAMPLE_COUNT = 17
export const SPRING_KEYFRAME_SAMPLE_COUNT = 25

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


/** Identity rotation, [x, y, z, w]. */
const IDENTITY_QUATERNION: [number, number, number, number] = [0, 0, 0, 1]

/** Where one part is during one step of an instructable, as a node's own transform. */
interface InstructPose
{
    translation: [number, number, number]
    rotation: [number, number, number, number]
    /** Easing to use for the transition INTO this pose. */
    interpolation: LayoutAnimationInterpolation
}

export class GLTFBuilder
{
    //// SETTINGS ////
    SUBSHAPE_OUTPUT_NAME_SEPERATOR: string = '___';

    private doc: Document;
    private scene: GltfScene;
    private _initialGlb: Uint8Array | null = null;
    private _modified = false;
    private _docLoaded = false;

    constructor(glb?: ArrayBuffer | Uint8Array)
    {
        if (glb)
        {
            this._initialGlb = (glb instanceof ArrayBuffer) ? new Uint8Array(glb) : glb;
            console.info(`GLTFBuilder: Initialized with GLB of size ${this._initialGlb.byteLength} bytes.`)
        }
        this.doc = new Document();
        this.scene = this.doc.createScene('scene');
    }

    /** Return the (possibly modified) GLB. If unmodified and a source GLB was provided, returns it directly. */
    async toGLB(): Promise<Uint8Array>
    {
        if (!this._modified && this._initialGlb)
        {
            return this._initialGlb;
        }
        return createNodeIO().writeBinary(this.doc);
    }

    /** Convert to a self-contained GLTF JSON string. */
    async toGLTF(): Promise<string>
    {
        const glb = await this.toGLB();
        return createNodeIO().readBinary(glb).then(doc => createNodeIO().writeJSON(doc)).then(GLTFJsonDocumentToString);
    }

    //// GLTF KEYFRAME ANIMATIONS ////
    // TODO: this was old code, needs to be re-implemented and tested
    
    /** Build animated GLTF from per-frame GLB buffers */
    /*
    async createAnimation(frameGLBs: Array<Uint8Array>)
    {
        const GLTF_TRANSFORM_FUNCTIONS_MODULE = '@gltf-transform/functions';
        let sequence;
        try
        {
            sequence = (await import(GLTF_TRANSFORM_FUNCTIONS_MODULE))?.sequence;
            if (!sequence) { throw new Error('sequence function not found'); }
        }
        catch (error)
        {
            console.error(`GLTFBuilder::createAnimation(): Error loading GLTF transform functions: ${error}. Add the @gltf-transform/functions package to your project.`);
            return;
        }
        await this.loadFramesIntoScene(frameGLBs);
        let sequenceOptions = { fps: 24, pattern: /FrameShapes[0-9]+/, animation: 'ParamAnimation', sort: false };
        this.doc.transform(sequence(sequenceOptions));
    }
    */
    /** Load a single GLB frame into the scene as a named node */
    /*
    async frameGLBToNode(GLBBuffer: Uint8Array, nodeName: string)
    {
        const io = createNodeIO();
        let frameGlbDoc = await io.readBinary(GLBBuffer);
        let incomingNode = frameGlbDoc.getRoot().listScenes()[0].listChildren()[0];
        incomingNode.setName(nodeName);

        this.doc = this.doc.merge(frameGlbDoc);
        let addedScene = this.doc.getRoot().listScenes()[1];
        let addedNode = addedScene.listChildren()[0];

        let rotationQuaternion = this._quaternionFromAxisAngle(new Vector(1, 0, 0), -90);
        addedNode.setRotation(rotationQuaternion);

        this.scene.addChild(addedNode);
        addedScene.dispose();
    }

    async loadFramesIntoScene(frameGLBs: Array<Uint8Array>)
    {
        for (let i = 0; i < frameGLBs.length; i++)
        {
            await this.frameGLBToNode(frameGLBs[i], `FrameShapes${i}`);
        }
        const buffer = this.doc.getRoot().listBuffers()[0];
        this.doc.getRoot().listAccessors().forEach((a: any) => a.setBuffer(buffer));
        this.doc.getRoot().listBuffers().forEach((b: any, index: number) => index > 0 ? b.dispose() : null);
    }
    */

    //// SPECIAL ARCHIYOU GLTF ADDITIONS ////

    /** Lazily read the source GLB into a gltf-transform Document exactly once,
     *  so addData() and addAnimations() compose instead of clobbering each other. */
    private async _ensureDoc(): Promise<Document>
    {
        if (!this._docLoaded)
        {
            if (!this._initialGlb) { throw new Error('GLTFBuilder._ensureDoc(): no GLB source provided — pass a GLB to the constructor.') }
            this.doc = await createNodeIO().readBinary(this._initialGlb)
            this._docLoaded = true
        }
        return this.doc
    }

    /** Put arbitrary data into the root extras of the GLB. Merges with any existing extras. */
    async addData(data: Record<string, unknown>): Promise<this>
    {
        await this._ensureDoc()
        const existing = (this.doc.getRoot().getExtras() ?? {}) as Record<string, unknown>
        this.doc.getRoot().setExtras({ ...existing, ...data })
        this._modified = true
        return this
    }

    //// ANIMATION VIEWS ////

    async addAnimation(
        result: LayoutTransformationResult,
        options: LayoutAnimationOptions = {},
    ): Promise<this>
    {
        await this.addAnimations([{ result, options }])
        return this
    }

    async addAnimations(
        definitions: Array<CachedLayoutAnimationDefinition>,
    ): Promise<this>
    {
        if (!this._initialGlb) { throw new Error('GLTFBuilder.addAnimations(): no GLB source provided — pass a GLB to the constructor.') }

        await this._ensureDoc();

        const root = this.doc.getRoot();
        const buffer = root.listBuffers()[0] ?? this.doc.createBuffer();

        /*  Targets are resolved by SCENE PATH, not by name.
            `SceneNode.name` is not unique among siblings — four legs of a table are four nodes
            all called `leg`, and the glTF node is created with that raw name — so a name-keyed
            Map kept only the last of them and every one of the four transforms landed on that
            single node: three legs never moved and one moved four times. Uniqueness lives in
            `SceneNode.path()` (the `name[i]` sibling-suffix rule), which is also what the
            viewer keys its object map on. */
        const nodesByPath = this._nodesByScenePath();
        const nodesByName = new Map<string, any>(
            root.listNodes().map((node: any) => [node.getName(), node] as [string, any])
        );

        definitions.forEach(({ result, options }) =>
        {
            const duration = options?.duration ?? 1.0
            const interpolation = options?.interpolation ?? options?.tween ?? 'easeInOut'
            const anim = this.doc.createAnimation(options?.animationName ?? result.name)
            const targeted = new Set<any>()

            result.transforms.forEach(({ sceneNode, translation, rotation, scale }) =>
            {
                const node = this._resolveTargetNode(sceneNode, nodesByPath, nodesByName)
                if (!node) { return }

                /*  Two transforms on one node means the resolution above failed to tell two
                    scene nodes apart — the exact failure this method used to have silently.
                    The channels would stack and the result would be wrong in a way that looks
                    like a layout bug, so say so. */
                if (targeted.has(node))
                {
                    console.warn(`GLTFBuilder::addAnimations(): animation "${anim.getName()}" targets `
                        + `glTF node "${node.getName()}" more than once — two scene nodes resolved to it. `
                        + `Their keyframes will stack. This usually means the GLB was not written from `
                        + `the scene these transforms came from.`)
                }
                targeted.add(node)

                if (rotation && !this._isIdentityQuaternion(rotation)) // just raw from layouter
                {
                    const gltfRotation = this._worldToGltfQuaternion(rotation)
                    const rotTimeAcc = this.doc.createAccessor()
                        .setType('SCALAR').setArray(this._createAnimationTimeSamples(duration, interpolation)).setBuffer(buffer)
                    const rotAcc = this.doc.createAccessor()
                        .setType('VEC4')
                        .setArray(this._createQuaternionAnimationSamples([0, 0, 0, 1], gltfRotation, interpolation))
                        .setBuffer(buffer)
                    const rotSampler = this.doc.createAnimationSampler()
                        .setInput(rotTimeAcc).setOutput(rotAcc).setInterpolation('LINEAR')
                    const rotChannel = this.doc.createAnimationChannel()
                        .setSampler(rotSampler).setTargetNode(node).setTargetPath('rotation')

                    anim.addSampler(rotSampler).addChannel(rotChannel)
                }

                if (translation && !this._isZeroVector(translation)) // just raw from layouter
                {
                    const gltfTranslation = this._worldToGltfTranslation(translation)
                    const translationStart = result.translationMode === 'relative'
                        ? node.getTranslation() as [number, number, number]
                        : [0, 0, 0] as [number, number, number]
                    const translationEnd = result.translationMode === 'relative'
                        ? this._addPoint(translationStart, gltfTranslation)
                        : gltfTranslation

                    const transTimeAcc = this.doc.createAccessor()
                        .setType('SCALAR').setArray(this._createAnimationTimeSamples(duration, interpolation)).setBuffer(buffer)
                    const transAcc = this.doc.createAccessor()
                        .setType('VEC3')
                        .setArray(this._createVector3AnimationSamples(translationStart, translationEnd, interpolation))
                        .setBuffer(buffer)
                    const transSampler = this.doc.createAnimationSampler()
                        .setInput(transTimeAcc).setOutput(transAcc).setInterpolation('LINEAR')
                    const transChannel = this.doc.createAnimationChannel()
                        .setSampler(transSampler).setTargetNode(node).setTargetPath('translation')

                    anim.addSampler(transSampler).addChannel(transChannel)
                }

                if (scale && !this._isIdentityScale(scale)) // just raw from layouter
                {
                    const scaleTimeAcc = this.doc.createAccessor()
                        .setType('SCALAR').setArray(this._createAnimationTimeSamples(duration, interpolation)).setBuffer(buffer)
                    const scaleAcc = this.doc.createAccessor()
                        .setType('VEC3')
                        .setArray(this._createVector3AnimationSamples([1, 1, 1], scale, interpolation))
                        .setBuffer(buffer)
                    const scaleSampler = this.doc.createAnimationSampler()
                        .setInput(scaleTimeAcc).setOutput(scaleAcc).setInterpolation('LINEAR')
                    const scaleChannel = this.doc.createAnimationChannel()
                        .setSampler(scaleSampler).setTargetNode(node).setTargetPath('scale')

                    anim.addSampler(scaleSampler).addChannel(scaleChannel)
                }
            })
        })
        this._modified = true
        return this;
    }

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
    private _nodesByScenePath(): Map<string, any>
    {
        const out = new Map<string, any>()
        const scene = this.doc.getRoot().listScenes()[0]
        if (!scene) { return out }

        /*  The scene's own children are the exported roots. There is one in every GLB the
            Modeler writes (the scene root, named 'root'), and `SceneNode.path()` calls it
            'Scene' whatever it was named — so map it to that. Anything beyond the first is a
            GLB assembled some other way and is keyed by its own name instead. */
        const roots = scene.listChildren().filter((n: any) => !n.getMesh())

        const walk = (node: any, path: string): void =>
        {
            out.set(path, node)
            const children = node.listChildren().filter((c: any) => !c.getMesh())
            const names = siblingDisplayNames(children.map((c: any) => c.getName()))
            children.forEach((child: any, i: number) =>
                walk(child, `${path}/${encodeURIComponent(names[i])}`))
        }

        roots.forEach((rootNode: any, i: number) =>
            walk(rootNode, i === 0 ? encodeURIComponent('Scene') : encodeURIComponent(rootNode.getName())))

        return out
    }

    /** The glTF node a layout transform belongs to.
     *
     *  By scene path first (see _nodesByScenePath). The name lookup behind it is the old
     *  behaviour, kept for a SceneNode that cannot answer `path()` and for a GLB that was not
     *  written from this scene — it is wrong for duplicate names, which is why the caller
     *  warns when two transforms land on one node. */
    private _resolveTargetNode(sceneNode: any, byPath: Map<string, any>, byName: Map<string, any>): any
    {
        const path = (typeof sceneNode?.path === 'function') ? sceneNode.path() : undefined
        if (path && byPath.has(path)) { return byPath.get(path) }
        return byName.get(sceneNode?.name)
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
     *  ## What the animation can and cannot say
     *
     *  glTF animates translation, rotation, scale and weights — and nothing else. It cannot
     *  hide a part and it cannot recolour one. So the movie shows every part at all times, and
     *  a part that arrives in step 5 is PARKED at its approach position until then, which is
     *  what makes the whole thing read as an assembly rather than as a finished model with one
     *  twitching component. Hiding and highlighting are the viewer's job, off `extras.instruct`.
     */
    async addInstruct(data: any, options?: { cameras?: boolean }): Promise<this>
    {
        if (!this._initialGlb) { throw new Error('GLTFBuilder.addInstruct(): no GLB source provided — pass a GLB to the constructor.') }

        await this._ensureDoc()

        const steps = data?.steps ?? []
        if (steps.length)
        {
            this._addInstructAnimation(data)
            if (options?.cameras !== false) { this._addInstructCameras(data) }
        }

        await this.addData({ instruct: data })
        this._modified = true

        return this
    }

    /** The one clip. Targets nodes by scene path — see addAnimations() for why a name will
     *  not do.
     *
     *  ## One track per part, not one per event
     *
     *  A part can be asked to be in two places over a manual: laid out in a row for the "here
     *  is what you need" step, and sliding into the assembly for the step that fits it. glTF
     *  allows exactly ONE channel per node per target path in an animation, so those cannot be
     *  written as two independent motions — they have to be resolved into a single position
     *  track over the whole timeline first, which is what _instructTrack() does.
     */
    private _addInstructAnimation(data: any): void
    {
        const steps = data.steps ?? []
        const nodesByPath = this._nodesByScenePath()

        /*  Every part any step has an opinion about. A part no step lays out or moves stays
            where the model has it and needs no channel at all. */
        const paths = [...new Set<string>(steps.flatMap((step: any) => [
            ...(step.placements ?? []).map((p: any) => p.path),
            ...((step.move && step.subject?.length) ? step.subject : []),
        ]))]

        if (!paths.length) { return }

        const buffer = this.doc.getRoot().listBuffers()[0] ?? this.doc.createBuffer()
        const anim = this.doc.createAnimation(data.name ?? 'instruct')

        paths.forEach((path: string) =>
        {
            const node = nodesByPath.get(path)
            if (!node) { return }

            const authored = node.getTranslation() as [number, number, number]
            const { initial, poses } = this._instructTrack(path, steps, authored)

            this._addInstructTranslation(anim, buffer, node, initial, poses, steps, data.duration, authored)
            this._addInstructRotation(anim, buffer, node, initial, poses, steps, data.duration)
        })
    }

    /** Where one part is during each step: its local translation and rotation, in order.
     *
     *  Three things can put it somewhere other than where the model has it:
     *
     *   - a `layout()` places it, as a rigid transform about its own centre. The node sits at
     *     the origin with the geometry hanging off it at the part's centre (meshup writes it
     *     that way), so `p' = R(p − centre) + position` becomes node rotation `R` and node
     *     translation `position − R·centre`.
     *   - it is the subject of a step with a `move()`: it ARRIVES during that step, so it
     *     starts one `distance` back along the motion.
     *   - before that step it is parked at that same approach position — which is what makes
     *     the clip read as an assembly rather than as a finished model with one twitching
     *     component, since glTF cannot hide anything.
     */
    private _instructTrack(path: string, steps: Array<any>, authored: [number, number, number]):
        { initial: InstructPose, poses: Array<InstructPose> }
    {
        const moves = steps.filter((step: any) => step.move && step.subject?.includes(path))
        const arrival = moves.length ? steps.indexOf(moves[0]) : -1

        /*  One approach per part. A part that is the subject of two moving steps would have to
            leave and arrive twice, which no manual means — and there is one track per part, so
            there is nowhere to put a second departure anyway. */
        if (moves.length > 1)
        {
            console.warn(`GLTFBuilder::addInstruct(): "${path}" moves in more than one step. `
                + `Only the first move is animated; the later ones are step data only.`)
        }

        const approach = (arrival < 0) ? authored : this._subtract(
            authored, this._scaleVector(moves[0].move.direction, moves[0].move.distance))

        /** Where the part sits at the END of a step. `-1` asks where it sits before the first
         *  one — parked at its approach position, or laid out if the first step lays it out. */
        const poseAfter = (index: number): InstructPose =>
        {
            const step = steps[Math.max(index, 0)]
            const placement = (step?.placements ?? []).find((p: any) => p.path === path)
            const interpolation = (step?.move?.interpolation ?? 'easeInOut') as LayoutAnimationInterpolation

            if (placement)
            {
                const rotation = placement.rotation as [number, number, number, number]
                return {
                    translation: this._worldToGltfTranslation(this._subtract(
                        placement.position, this._rotatePoint(rotation, placement.centre))),
                    // glTF requires unit quaternions on a rotation channel; a layout hands
                    // its own back raw
                    rotation: this._normalizeQuaternion(this._worldToGltfQuaternion(rotation)),
                    interpolation,
                }
            }

            return {
                // before its own step, and at the end of every step before it, it is parked
                translation: (arrival >= 0 && index < arrival) ? approach : authored,
                rotation: IDENTITY_QUATERNION,
                interpolation,
            }
        }

        return { initial: poseAfter(-1), poses: steps.map((_: any, i: number) => poseAfter(i)) }
    }

    /** The position channel for one part: hold, then ease across the step that changes it. */
    private _addInstructTranslation(anim: any, buffer: any, node: any,
        initial: InstructPose, poses: Array<InstructPose>, steps: Array<any>, duration: number,
        authored: [number, number, number]): void
    {
        const times: Array<number> = []
        const values: Array<number> = []

        let previous = initial.translation
        times.push(0)
        values.push(...previous)

        poses.forEach((pose, i) =>
        {
            if (this._isSameVector(pose.translation, previous)) { return }

            // held where it was until this step starts…
            this._pushSample(times, values, steps[i].tStart, previous)

            // …then across it, with the easing baked into the samples (see addAnimations)
            const progress = this._createAnimationProgressSamples(pose.interpolation)
            const from = previous
            progress.forEach((p, s) =>
            {
                this._pushSample(times, values,
                    steps[i].tStart + (steps[i].tEnd - steps[i].tStart) * (s / (progress.length - 1)),
                    [
                        this._lerpNumber(from[0], pose.translation[0], p),
                        this._lerpNumber(from[1], pose.translation[1], p),
                        this._lerpNumber(from[2], pose.translation[2], p),
                    ])
            })

            previous = pose.translation
        })

        /*  A part that never departs from where the model has it needs no channel. One that
            never MOVES but sits somewhere else the whole time — a single-step manual that only
            lays its parts out — needs a constant one, because a glTF animation is the only
            place a file can say a part is anywhere but where its node puts it. */
        if (times.length < 2 && this._isSameVector(previous, authored)) { return }

        this._pushSample(times, values, duration, previous)

        this._addInstructChannel(anim, buffer, node, 'translation', 'VEC3', times, values)
    }

    /** The rotation channel, when a layout turns the part. Written as two keyframes per
     *  change and left to the viewer to slerp: glTF requires LINEAR on a rotation channel to
     *  be spherical, so pre-baked samples would only make a worse arc out of it. */
    private _addInstructRotation(anim: any, buffer: any, node: any,
        initial: InstructPose, poses: Array<InstructPose>, steps: Array<any>, duration: number): void
    {
        if ([initial, ...poses].every(pose => this._isIdentityQuaternion(pose.rotation))) { return }

        const times: Array<number> = []
        const values: Array<number> = []

        let previous = initial.rotation
        times.push(0)
        values.push(...previous)

        poses.forEach((pose, i) =>
        {
            if (this._isSameQuaternion(pose.rotation, previous)) { return }

            this._pushSample(times, values, steps[i].tStart, previous)
            this._pushSample(times, values, steps[i].tEnd, pose.rotation)
            previous = pose.rotation
        })

        // some pose turns it, or the every() above would have returned — so always a channel,
        // constant when the turn never comes undone
        this._pushSample(times, values, duration, previous)

        this._addInstructChannel(anim, buffer, node, 'rotation', 'VEC4', times, values)
    }

    /** Append a keyframe, unless the timeline is already there — glTF sampler inputs have to
     *  increase strictly, and two steps of zero length between the same two poses would
     *  otherwise write the same time twice. */
    private _pushSample(times: Array<number>, values: Array<number>,
        time: number, value: Array<number>): void
    {
        if (time <= times[times.length - 1]) { return }
        times.push(time)
        values.push(...value)
    }

    private _addInstructChannel(anim: any, buffer: any, node: any, target: string,
        type: 'VEC3' | 'VEC4', times: Array<number>, values: Array<number>): void
    {
        const input = this.doc.createAccessor()
            .setType('SCALAR').setArray(new Float32Array(times) as any).setBuffer(buffer)
        const output = this.doc.createAccessor()
            .setType(type).setArray(new Float32Array(values) as any).setBuffer(buffer)
        const sampler = this.doc.createAnimationSampler()
            .setInput(input).setOutput(output).setInterpolation('LINEAR')
        const channel = this.doc.createAnimationChannel()
            .setSampler(sampler).setTargetNode(node).setTargetPath(target as any)

        anim.addSampler(sampler).addChannel(channel)
    }

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

            const camera = this.doc.createCamera(`${data.name}-step-${step.number}`)

            if (cam.projection === 'perspective')
            {
                camera.setType('perspective').setYFov(45 * Math.PI / 180)
                    .setZNear(Math.max(distance - radius * 2, distance / 100))
                    .setZFar(distance + radius * 4)
            }
            else
            {
                /*  An orthographic camera has no field of view, so its magnification IS the
                    framing: half the extent it shows, in world units. Sized off the step's own
                    bbox with a little air. */
                camera.setType('orthographic')
                    .setXMag(radius * 1.2).setYMag(radius * 1.2)
                    .setZNear(Math.max(distance - radius * 4, 0.01))
                    .setZFar(distance + radius * 4)
            }

            const node = this.doc.createNode(`${data.name}-step-${step.number}-camera`)
                .setCamera(camera)
                .setTranslation(eye)
                .setRotation(this._lookAtQuaternion(eye, target))

            scene.addChild(node)
        })
    }

    /** Half the diagonal of a flat [minX,minY,minZ,maxX,maxY,maxZ]. */
    private _bboxRadius(bbox?: Array<number>): number
    {
        if (!bbox || bbox.length < 6) { return 0 }
        return Math.hypot(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]) / 2
    }

    /** Orientation of a camera at `eye` looking at `target`.
     *
     *  A glTF camera looks down its own **-Z** with +Y up, so the node's rotation is the basis
     *  that maps those onto the world. World up is +Z — the GLB carries the kernel's native
     *  Z-up (see _worldToGltfTranslation) — with a fallback for looking straight up or down,
     *  where "up" and the view direction are parallel and the cross product collapses. */
    _lookAtQuaternion(eye: Array<number>, target: Array<number>): [number, number, number, number]
    {
        const sub = (a: Array<number>, b: Array<number>) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
        const cross = (a: Array<number>, b: Array<number>) =>
            [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
        const norm = (v: Array<number>) =>
        {
            const l = Math.hypot(v[0], v[1], v[2])
            return (l < 1e-9) ? [0, 0, 1] : [v[0]/l, v[1]/l, v[2]/l]
        }

        const forward = norm(sub(target, eye))
        const z = [-forward[0], -forward[1], -forward[2]]        // camera looks down -Z

        let up = [0, 0, 1]
        if (Math.abs(forward[0]*up[0] + forward[1]*up[1] + forward[2]*up[2]) > 0.999)
        {
            up = [0, 1, 0]      // looking straight up or down — pick another reference
        }

        const x = norm(cross(up, z))
        const y = cross(z, x)

        // rotation matrix [x y z] as columns → quaternion
        const [m00, m10, m20] = x
        const [m01, m11, m21] = y
        const [m02, m12, m22] = z
        const trace = m00 + m11 + m22

        if (trace > 0)
        {
            const sq = Math.sqrt(trace + 1) * 2
            return this._normalizeQuaternion([
                (m21 - m12) / sq, (m02 - m20) / sq, (m10 - m01) / sq, sq / 4,
            ])
        }
        if (m00 > m11 && m00 > m22)
        {
            const sq = Math.sqrt(1 + m00 - m11 - m22) * 2
            return this._normalizeQuaternion([
                sq / 4, (m01 + m10) / sq, (m02 + m20) / sq, (m21 - m12) / sq,
            ])
        }
        if (m11 > m22)
        {
            const sq = Math.sqrt(1 + m11 - m00 - m22) * 2
            return this._normalizeQuaternion([
                (m01 + m10) / sq, sq / 4, (m12 + m21) / sq, (m02 - m20) / sq,
            ])
        }
        const sq = Math.sqrt(1 + m22 - m00 - m11) * 2
        return this._normalizeQuaternion([
            (m02 + m20) / sq, (m12 + m21) / sq, sq / 4, (m10 - m01) / sq,
        ])
    }

    //// READ-ONLY FUNCTIONS ////

    /** Get data from GLTF binary */
    async readData(gltf: ArrayBuffer | Uint8Array): Promise<ArchiyouData>
    {
        const io = createNodeIO();
        const buffer = this._convertArrayBufferToUint8Array(gltf);
        const doc = await io.readBinary(buffer);
        return (doc.getRoot().getAsset()?.extras as any)?.archiyou as ArchiyouData;
    }

    //// UTILS ////

    _quaternionFromAxisAngle(axis: Vector, angleDeg: number): Array<number>
    {
        let angleRad = toRad(angleDeg);
        let c = Math.cos(angleRad / 2);
        let s = Math.sin(angleRad / 2);
        return [axis.x * s, axis.y * s, axis.z * s, c]; // [X, Y, Z, W] in GLTF
    }

    _convertArrayBufferToUint8Array(buffer: ArrayBuffer | Uint8Array): Uint8Array
    {
        return (buffer instanceof ArrayBuffer) ? new Uint8Array(buffer) : buffer;
    }

    // The GLB now carries the kernel's native Z-up coordinates unchanged
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

    _createAnimationTimeSamples(duration: number, interpolation: LayoutAnimationInterpolation): Float32Array
    {
        const sampleCount = this._animationSampleCount(interpolation)

        if (sampleCount === 2)
        {
            return new Float32Array([0, duration])
        }

        return new Float32Array(
            Array.from({ length: sampleCount }, (_, index) => (duration * index) / (sampleCount - 1))
        )
    }

    _createAnimationProgressSamples(interpolation: LayoutAnimationInterpolation): Array<number>
    {
        const sampleCount = this._animationSampleCount(interpolation)

        if (sampleCount === 2)
        {
            return [0, 1]
        }

        return Array.from({ length: sampleCount }, (_, index) =>
        {
            if (index === 0) { return 0 }
            if (index === sampleCount - 1) { return 1 }

            const time = index / (sampleCount - 1)
            return this._applyAnimationInterpolation(time, interpolation)
        })
    }

    _createVector3AnimationSamples(
        start: [number, number, number],
        end: [number, number, number],
        interpolation: LayoutAnimationInterpolation,
    ): Float32Array
    {
        return new Float32Array(
            this._createAnimationProgressSamples(interpolation).flatMap(progress => [
                this._lerpNumber(start[0], end[0], progress),
                this._lerpNumber(start[1], end[1], progress),
                this._lerpNumber(start[2], end[2], progress),
            ])
        )
    }

    _createQuaternionAnimationSamples(
        start: [number, number, number, number],
        end: [number, number, number, number],
        interpolation: LayoutAnimationInterpolation,
    ): Float32Array
    {
        return new Float32Array(
            this._createAnimationProgressSamples(interpolation).flatMap(progress => this._slerpQuaternion(start, end, progress))
        )
    }

    _animationSampleCount(interpolation: LayoutAnimationInterpolation): number
    {
        switch (interpolation)
        {
            case 'linear':
                return 2
            case 'spring':
                return SPRING_KEYFRAME_SAMPLE_COUNT
            default:
                return EASED_KEYFRAME_SAMPLE_COUNT
        }
    }

    _applyAnimationInterpolation(progress: number, interpolation: LayoutAnimationInterpolation): number
    {
        const t = Math.min(1, Math.max(0, progress))

        switch (interpolation)
        {
            case 'easeIn':
                return t * t * t
            case 'easeOut':
                return 1 - Math.pow(1 - t, 3)
            case 'easeInOut':
                return t < 0.5
                    ? 4 * t * t * t
                    : 1 - Math.pow(-2 * t + 2, 3) / 2
            case 'spring':
            {
                if (t === 0 || t === 1)
                {
                    return t
                }

                const c4 = (2 * Math.PI) / 3
                return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
            }
            case 'linear':
            default:
                return t
        }
    }

    _lerpNumber(start: number, end: number, progress: number): number
    {
        return start + (end - start) * progress
    }

    _isZeroVector(value: [number, number, number]): boolean
    {
        return value.every(component => Math.abs(component) < 1e-9)
    }

    _isIdentityScale(value: [number, number, number]): boolean
    {
        return value.every(component => Math.abs(component - 1) < 1e-9)
    }

    _isIdentityQuaternion(value: [number, number, number, number]): boolean
    {
        return Math.abs(value[0]) < 1e-9 &&
            Math.abs(value[1]) < 1e-9 &&
            Math.abs(value[2]) < 1e-9 &&
            Math.abs(value[3] - 1) < 1e-9
    }

    _addPoint(
        pointA: [number, number, number],
        pointB: [number, number, number],
    ): [number, number, number]
    {
        return [pointA[0] + pointB[0], pointA[1] + pointB[1], pointA[2] + pointB[2]]
    }

    _subtract(
        pointA: [number, number, number],
        pointB: [number, number, number],
    ): [number, number, number]
    {
        return [pointA[0] - pointB[0], pointA[1] - pointB[1], pointA[2] - pointB[2]]
    }

    _scaleVector(value: Array<number>, factor: number): [number, number, number]
    {
        return [value[0] * factor, value[1] * factor, value[2] * factor]
    }

    _isSameVector(a: Array<number>, b: Array<number>): boolean
    {
        return a.every((component, i) => Math.abs(component - b[i]) < 1e-9)
    }

    /** Quaternions are double-covered — q and −q are the same rotation — so compare the
     *  rotation, not the four numbers. */
    _isSameQuaternion(a: Array<number>, b: Array<number>): boolean
    {
        return Math.abs(a.reduce((dot, component, i) => dot + component * b[i], 0)) > 1 - 1e-9
    }

    /** A point turned by a quaternion: `q * (0,p) * q⁻¹`, written out. */
    _rotatePoint(
        quaternion: [number, number, number, number],
        point: [number, number, number],
    ): [number, number, number]
    {
        const [x, y, z, w] = this._normalizeQuaternion(quaternion)
        const [px, py, pz] = point

        // t = 2 * (q.xyz × p)
        const tx = 2 * (y * pz - z * py)
        const ty = 2 * (z * px - x * pz)
        const tz = 2 * (x * py - y * px)

        return [
            px + w * tx + (y * tz - z * ty),
            py + w * ty + (z * tx - x * tz),
            pz + w * tz + (x * ty - y * tx),
        ]
    }

    _multiplyQuaternion(
        quaternionA: [number, number, number, number],
        quaternionB: [number, number, number, number],
    ): [number, number, number, number]
    {
        const [ax, ay, az, aw] = quaternionA
        const [bx, by, bz, bw] = quaternionB

        return [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ]
    }

    _slerpQuaternion(
        start: [number, number, number, number],
        end: [number, number, number, number],
        progress: number,
    ): [number, number, number, number]
    {
        let [sx, sy, sz, sw] = start
        let [ex, ey, ez, ew] = end
        let dot = sx * ex + sy * ey + sz * ez + sw * ew

        if (dot < 0)
        {
            ex = -ex
            ey = -ey
            ez = -ez
            ew = -ew
            dot = -dot
        }

        if (dot > 0.9995)
        {
            return this._normalizeQuaternion([
                this._lerpNumber(sx, ex, progress),
                this._lerpNumber(sy, ey, progress),
                this._lerpNumber(sz, ez, progress),
                this._lerpNumber(sw, ew, progress),
            ])
        }

        const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)))
        const sinTheta0 = Math.sin(theta0)
        const theta = theta0 * progress
        const sinTheta = Math.sin(theta)
        const scaleStart = Math.cos(theta) - dot * sinTheta / sinTheta0
        const scaleEnd = sinTheta / sinTheta0

        return this._normalizeQuaternion([
            sx * scaleStart + ex * scaleEnd,
            sy * scaleStart + ey * scaleEnd,
            sz * scaleStart + ez * scaleEnd,
            sw * scaleStart + ew * scaleEnd,
        ])
    }

    _normalizeQuaternion(value: [number, number, number, number]): [number, number, number, number]
    {
        const length = Math.hypot(value[0], value[1], value[2], value[3])

        if (length < 1e-9)
        {
            return [0, 0, 0, 1]
        }

        return [
            value[0] / length,
            value[1] / length,
            value[2] / length,
            value[3] / length,
        ]
    }
}
