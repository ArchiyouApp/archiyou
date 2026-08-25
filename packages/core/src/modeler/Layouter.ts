import { Vector as MeshupVector } from '@archiyou/meshup'
import { ShapeCollection } from '@archiyou/meshup'
import { isKernelShapeCollection } from './typeguards'
import { SceneNode as MeshupSceneNode } from '@archiyou/meshup'

import type {
    ExplodedViewOptions,
    LayoutAnimationOptions,
    LayoutTransformation,
    LayoutTransformationResult,
    LayoutViewOptions,
    AnyShape,
} from './types'

import { TOLERANCE } from '@archiyou/meshup'

export class Layouter
{
    private _scene: MeshupSceneNode
    private _result: LayoutTransformationResult | null = null

    constructor(sceneOrShapes: MeshupSceneNode | ShapeCollection<any>)
    {
        this._scene = this._normalizeInput(sceneOrShapes)
    }

    scene(): MeshupSceneNode
    {
        return this._scene
    }

    /** Copied flattened shapes of scene to do stuff with */
    workNodeShapes(): Array<{ node: MeshupSceneNode, shape: AnyShape }>
    {
        return this._shapeNodes().map(s => 
        {
            return {
                node: s,
                shape: this._copyShapeDetached(s.shape()), // detached workshape - does not pollute the scene
            }
        });
    }

    /** Turn flattened node shapes into a ShapeCollection */
    shapeCollection(): ShapeCollection
    {
        const shapes = this._shapeNodes()
                        .map((n) => n.shape()).filter(shape => shape !== null)
        return new ShapeCollection(shapes); // NOTE: reference, not copy
    }

    result(): LayoutTransformationResult
    {
        return this._requireResult()
    }

    reset(): this
    {
        this._result = null
        return this
    }
    
    //// LAYOUT METHODS ////

    /** Generate transforms for the exploded view layout 
     *  Because we need check distances between shape we work with detached copies of shapes
     *   to not pollute the scene with temporary transforms.
    */
    exploded(options: ExplodedViewOptions = {}): this
    {
        const t = performance.now();
        console.info('Layouter::exploded(): Starting exploded view layout...');

        let distance = options?.distance;
        if(!distance)
        {
            // auto distance based on bbox size
            distance = this.shapeCollection().bbox().maxSize()/10.0;
            console.info(`Layouter.explodedView: auto distance set to ${distance.toFixed(2)}`);
        }

        // Step to increase distance for each shape to ensure separation
        const DISTANCE_STEP = distance / 2; 
        const MAX_ITERATIONS = 10; // to prevent infinite loops

        const shapeNodes = this.workNodeShapes(); 

        // Pick a center of the exploded view
        const colCenter = this.shapeCollection().bbox().center(); 
        // First order shapes by distance to center (closest first), then by area.
        shapeNodes.sort((a, b) =>
        {
            const distanceDelta = a.shape.distance(colCenter) - b.shape.distance(colCenter)
            if (Math.abs(distanceDelta) > TOLERANCE) { return distanceDelta }
            return (a.shape?.area?.() ?? 0) - (b.shape?.area?.() ?? 0)
        });

        const placedShapeNodes = [
            shapeNodes[0] // start with first
        ]
        
        // Now iterate over Shapes and move along explode vector until no collision with previously placed shapes
        shapeNodes.forEach(({ node, shape }, index) =>
        {
            const ts = performance.now();

            const explodeDir = shape.center().toVector().subtract(colCenter).normalize();
            // If shape is at the center, assign an arbitrary direction
            if (explodeDir.length() < 1e-6){ explodeDir.set(1, 0, 0);}

            // Find a position for the shape that does not collide with previously placed shapes
            if(index > 0) // skip first shape
            {
                let shapeBbox = shape.bbox();
                let iterations = 0;
                
                while(placedShapeNodes
                                .map(n => n.shape.bbox())
                                .reduce((minDist, s) => Math.min(minDist, shapeBbox.distance(s)), Infinity) < distance)
                {
                    // prevent infinite loop
                    if (++iterations > MAX_ITERATIONS)
                    { 
                        console.error(`Layouter.explodedView: Max iterations reached for shape ${index}.`);
                        break; 
                    } 
                    // Move shape along explodeDir by DISTANCE_STEP
                    shape.move(explodeDir.copy().scale(DISTANCE_STEP));
                    shapeBbox = shape.bbox(); // update bbox after moving
                }
                // done with this shape, add to placed list
                console.info(`Placed shape ${index} after ${iterations} iterations. Took ${(performance.now() - ts).toFixed(2)} ms.`);
                placedShapeNodes.push({ node, shape });
            }
        });

        // placedShapeNodes now has the final positions for each shape, we can generate transforms
        const transforms: Array<LayoutTransformation> = placedShapeNodes.map(({ node, shape }) =>
        {
            const translation = shape.center().toVector().subtract(node.shape().center()).toArray() as [number, number, number];
            return {
                sceneNode: node,
                translation,
                rotation: [0, 0, 0, 1] as [number, number, number, number],
                scale: [1, 1, 1] as [number, number, number],
            }
        });

        this._result = {
            name: 'exploded',
            translationMode: 'relative',
            transforms
        }

        console.info(`Layouter::exploded(): Completed in ${(performance.now() - t).toFixed(2)} ms.`);

        return this
    }

    /** Layout all shapes in an orthographic row layout.
     *  For 3D shapes use OBbox for orientation with smallest dimension parallel to Z axis.
     */
    rowOrtho(options: LayoutViewOptions = {}): this
    {
        const t = performance.now();
        console.info('Layouter::rowOrtho(): Starting orthographic row layout...');

        const spacing = options.spacing ?? 5;

        let lastX = 0;
        const transforms = this._shapeNodes().map((node, i) =>
        {
            const obbox = node.shape().obbox();
            const quaternion = obbox.toOrthoQuaternion();
            // NOTE: we don't really need to work with shapes here
            const translate = obbox.center().toVector().reverse() // to origin
                                    .add([lastX + obbox.width()/2, 0, 0]); // then in row            

            lastX += obbox.width() + spacing; // update lastX for next shape, add spacing

            return {
                sceneNode: node,
                translation: translate.toArray() as [number, number, number],
                rotation: Object.values(quaternion) as [number, number, number, number],
                scale: [1, 1, 1] as [number, number, number],
            }
        }) as Array<LayoutTransformation>; 

        this._result = {
            name: 'layout',
            translationMode: 'relative',
            transforms,
        }

        console.info(`Layouter::rowOrtho(): Completed in ${(performance.now() - t).toFixed(2)} ms.`);

        return this;
    }

    apply(): this
    {
        this._applyTransforms(this._requireResult().transforms)
        return this
    }

    applyAsCopy(): MeshupSceneNode
    {
        const result = this._requireResult()
        const cloned = this._cloneSceneNode(this._scene)
        const transforms = result.transforms
            .map(transform =>
            {
                const copiedNode = cloned.map.get(transform.sceneNode)
                if (!copiedNode) { return null }
                const copiedTransform: LayoutTransformation = {
                    sceneNode: copiedNode,
                    translation: [...transform.translation] as [number, number, number],
                    rotation: [...transform.rotation] as [number, number, number, number],
                    scale: [...transform.scale] as [number, number, number],
                }
                return copiedTransform
            })
            .filter((transform): transform is LayoutTransformation => transform !== null)

        this._applyTransforms(transforms)
        return cloned.scene
    }

    async saveAsAnimation(gltfContent: ArrayBuffer | Uint8Array, options: LayoutAnimationOptions = {}): Promise<Uint8Array>
    {
        const { GLTFBuilder } = await import('../GLTFBuilder')
        return new GLTFBuilder(gltfContent).addAnimation(this._requireResult(), options).then(b => b.toGLB())
    }

    private _shapeNodes(): Array<MeshupSceneNode>
    {
        return [this._scene, ...this._scene.descendants()].filter(node => node.hasShape()) as Array<MeshupSceneNode>
    }

    /** If ShapeCollection turn it into a Scene */
    private _normalizeInput(sceneOrShapes: MeshupSceneNode | ShapeCollection<any>): MeshupSceneNode
    {
        if (sceneOrShapes instanceof MeshupSceneNode)
        {
            return sceneOrShapes
        }

        // Kernel-neutral: a brep ShapeCollection must take this branch too
        if (isKernelShapeCollection(sceneOrShapes))
        {
            return this._sceneFromCollection(sceneOrShapes as ShapeCollection<any>)
        }

        throw new Error('Layouter: expected a SceneNode or ShapeCollection input.')
    }

    /** Convert a ShapeCollection into a MeshupSceneNode */
    private _sceneFromCollection(shapes: ShapeCollection<any>): MeshupSceneNode
    {
        const root = MeshupSceneNode.root('root')

        shapes.toArray().forEach(shape =>
        {
            const nodeName = shape?._node?.name ?? MeshupSceneNode.getName(shape)
            const child = new MeshupSceneNode(nodeName)
            child.setStyle(shape?._node?.style?.explicitData?.() ?? {})
            ;(child as any)._shape = shape
            root.addChild(child)
        })

        return root
    }

    private _requireResult(): LayoutTransformationResult
    {
        if (!this._result)
        {
            throw new Error('Layouter: no cached layout. Call exploded(), layoutView(), or flatLayout() first.')
        }

        return this._result
    }

    private _applyTransforms(transforms: Array<LayoutTransformation>): void
    {
        transforms.forEach(transform =>
        {
            const shape = transform.sceneNode.shape()
            if (!shape) { return }

            if (!this._isIdentityQuaternion(transform.rotation))
            {
                shape.rotateQuaternion?.({
                    w: transform.rotation[3],
                    x: transform.rotation[0],
                    y: transform.rotation[1],
                    z: transform.rotation[2],
                })
            }

            if (!this._isZeroVector(transform.translation))
            {
                shape.translate?.(transform.translation)
            }

            if (!this._isIdentityScale(transform.scale))
            {
                this._applyScale(shape, transform.scale)
            }
        })
    }

    private _applyScale(shape: any, scale: [number, number, number]): void
    {
        const isUniformScale = Math.abs(scale[0] - scale[1]) < 1e-9 && Math.abs(scale[1] - scale[2]) < 1e-9
        if (isUniformScale)
        {
            shape.scale?.(scale[0])
            return
        }

        if (shape?.mode === 'mesh')
        {
            shape.scale?.(scale)
            return
        }

        throw new Error('Layouter: non-uniform scale is not supported for this shape kernel.')
    }

    private _cloneSceneNode(source: MeshupSceneNode): { scene: MeshupSceneNode; map: Map<MeshupSceneNode, MeshupSceneNode> }
    {
        const node = new MeshupSceneNode(source.name)
        node.setStyle(source.style.explicitData())

        const map = new Map<MeshupSceneNode, MeshupSceneNode>([[source, node]])

        if (source.hasShape())
        {
            node.setShape(this._copyShapeDetached(source.shape()) as any)
        }

        source.children().forEach(child =>
        {
            const clonedChild = this._cloneSceneNode(child)
            node.addChild(clonedChild.scene)
            clonedChild.map.forEach((value, key) => map.set(key, value))
        })

        return { scene: node, map }
    }

    private _copyShapeDetached(shape: any): any
    {
        const modeler = shape?._modeler ?? null
        const node = shape?._node ?? null

        shape._modeler = null
        shape._node = null
        const copy = shape.copy()
        shape._modeler = modeler
        shape._node = node

        copy._modeler = modeler
        copy._node = null

        return copy
    }

    //// UTILS ////

    private _isZeroVector(vector: [number, number, number]): boolean
    {
        return Math.sqrt(vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2) < TOLERANCE
    }

    private _isIdentityQuaternion(rotation: [number, number, number, number]): boolean
    {
        return Math.abs(rotation[0]) < TOLERANCE
            && Math.abs(rotation[1]) < TOLERANCE
            && Math.abs(rotation[2]) < TOLERANCE
            && Math.abs(rotation[3] - 1) < TOLERANCE
    }

    private _isIdentityScale(scale: [number, number, number]): boolean
    {
        return Math.abs(scale[0] - 1) < TOLERANCE
            && Math.abs(scale[1] - 1) < TOLERANCE
            && Math.abs(scale[2] - 1) < TOLERANCE
    }
}