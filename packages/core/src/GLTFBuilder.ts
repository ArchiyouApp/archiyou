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

const EASED_KEYFRAME_SAMPLE_COUNT = 17
const SPRING_KEYFRAME_SAMPLE_COUNT = 25


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
        const nodesByName = new Map<string, any>(
            root.listNodes().map((node: any) => [node.getName(), node] as [string, any])
        );

        definitions.forEach(({ result, options }) =>
        {
            const duration = options?.duration ?? 1.0
            const interpolation = options?.interpolation ?? options?.tween ?? 'easeInOut'
            const anim = this.doc.createAnimation(options?.animationName ?? result.name)

            result.transforms.forEach(({ sceneNode, translation, rotation, scale }) =>
            {
                const node = nodesByName.get(sceneNode.name)
                if (!node) { return }

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
