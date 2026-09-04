/**
 *   
 *   Modeler.ts
 * 
 *   General modeling API wrapping Brep and Mesh modeling. 
 *   
 *   - Multimode shapes: Modeler can switch between different modes: mesh or brep
 *      - Mesh is using Meshup and is faster, more robust and smaller WASM size, but less accurate
 *      - BREP is using OpenCascade and is more accurate, but slow, brittle and big WASM
 
 *   - SmartShapes: Offer unified interface over different kernel shapes, with automatic conversion and delegation to the underlying kernel shape.
 *  
 *   Basic functionality of modeler:
 *    - Basic settings: units(), 
 *    - Explicit switching of mode: mesh(), brep() [hopefully not needed]
 *    - Create primitive shapes: box(), sphere(), boxbetween()
 *    - Add shapes automatically to shape at appropriate place
 *    - 2D sketching: sketch('xy).lineTo(100,10) ...
 *    - Scene management:
 *          - create layers: layer('diagram').color
 *          - capture shapes at given code intervals (TODO)
 * 
 *   TODO:
 *      - bring API of Meshup and Brep kernels closer together
 *          for example: Meshup.Mesh.Box() vs Brep.Solid.makeBox()
 *  
 */


import type { ArchiyouModules, ArchiyouStateData } from "../types";
import type { ModelMode, ModelUnits, KernelClasses, ModelerSceneExportGLTFOptions, ModelerTextOptions } from "./types";

import { ModelModeSchema, ModelUnitsSchema, PointLikeSchema } from "./schemas";

import { Type } from 'typebox'

import { validate, optional } from "../decorators";
import { type AnyShape, isAnyShape } from "./types";

import { buildDXF, type toDXFOptions } from "./DXFExporter";
import { detectExportFrame } from "./utils";
import { buildSVG, buildProjectionSVG, buildThumbnailSVG, buildThumbnailSVGFromCurves,
    type toSVGOptions, type toProjectionSVGOptions,
    type ThumbnailSVGOptions, type ThumbnailSVGResult } from "./SVGExporter";
// Type-only: ./DAEExporter is reached through a dynamic import in toDAE() so the COLLADA
// writer and its ~171 KB of base64 WASM stay out of the eager bundle. See DAEExporter.ts.
import type { toDAEOptions } from "./DAEExporter";

// Meshup namespace — imported as value (for instanceof) and type
import * as meshup from '@archiyou/meshup'

// Side-effect import: augments meshup Shape/SceneNode/ShapeCollection prototypes with the
// visual/app methods (dimension, label, material, onClick, addToScene, toDXF, …). Must load
// before any script runs so those methods exist on the meshup shapes the modeler returns.
import './shapeAnnotations'
import { applyShapeAnnotations } from './shapeAnnotations'

import type { Brep } from './brep/index'
// Type-only namespace import: gives us brepTypes.Point / .AnyShape etc. for the union types
// below WITHOUT pulling the OpenCascade barrel into the module graph at runtime.
import type * as brepTypes from './brep/index'

/** The meshup module namespace as a type. meshup no longer exports this alias itself:
 *  a self-referential `typeof import('./index')` inside its barrel broke its dts rollup. */
type Meshup = typeof import('@archiyou/meshup')

import { defaultTextFont, getFont, registerFont, fetchFont } from "./TextFonts";
import { SceneNodeGraphNode, isPointLike } from "@archiyou/meshup";
import { Layouter } from "./Layouter";
import { GLTFBuilder } from "../GLTFBuilder";
import { Make } from './Make';
import { brepShapeToMeshup, isBrepShape, DEFAULT_MESHING_QUALITY } from './brep/toMeshup';

import { GLTF_ANIMATION_DURATION } from '../constants';

// Union classes that combine meshup and brep
type PointLike = meshup.PointLike // only use one
type Point = meshup.Point | brepTypes.Point
type Vector = meshup.Vector | brepTypes.Vector
type Vertex = meshup.Vertex | brepTypes.Vertex
/** Anything a Modeler primitive can hand back, from either kernel. Scripts mostly chain on
 *  this, so it stays deliberately loose — the concrete class depends on the active kernel. */
type AnyKernelShape = meshup.Mesh | meshup.Curve | meshup.Polygon | meshup.Vertex | brepTypes.AnyShape


export class Modeler
{
    private _mode: ModelMode = 'mesh'
    
    private _kernels = {
        mesh: null as Meshup | null,
        brep: null as Brep | null, // loaded lazily by _loadBrep() - the OC WASM is 10MB
    } as Record<ModelMode, any>

    declare private _modules: ArchiyouModules
    private _units: ModelUnits
    // Display preference (metric/imperial) — presentation only, does not change
    // geometry. Set from the execution request; read by dimension-line SVG etc.
    private _unitSystem: 'metric'|'imperial' = 'metric'

    declare private _scene: meshup.SceneNode
    declare private _activeLayer: meshup.SceneNode | null
    declare private _activeSketch: any
    declare private _make: Make
    /** Cached brep view of `classes` — see the getter. */
    private _brepClasses: KernelClasses | null = null

    /** Serial-id sequence for shapes adopted into this modeler's scene. One counter per
     *  Modeler — Runner.initLocalArchiyou() builds a fresh Modeler per scope, so the main
     *  run and every $component() activation number independently and cannot interleave.
     *  Rebased by reset(); the scene root pulls from it via setSidProvider(). */
    private _sidSeq = 0
    
    stats:Record<string,any> = {}; // stats of last operation

    constructor(mode: ModelMode = 'mesh', units: ModelUnits = 'mm')
    {
        this._mode = mode;
        this._units = units;

        this.reset();

        console.info('Modeler initialized. Please use load() to load primary shape kernel. Use setArchiyou() to set archiyou modules.')
    }

    setArchiyou(modules: ArchiyouModules)
    {
        this._modules = modules;
        this.setMake();
    }

    /** Make are some handy modules. 
     *  Set it on this Modeler instance
     *  user can access them with modeler.make.wall()  */
    setMake()
    {
        this._make = new Make(this);
        this._make.setArchiyou(this._modules);
    }

    /** Public access to the archiyou modules (annotator, calc, docs, console, ...) */
    get modules(): ArchiyouModules
    {
        return this._modules;
    }

    /** Alias for modules */
    get archiyou(): ArchiyouModules
    {
        return this._modules;
    }

    /** Can instance of Make */
    get make(): Make
    {
        if(!this._make) throw new Error('Make module not set. Call setArchiyou() first.');
        return this._make;
    }

    /** Reset state */
    reset()
    {
        this._scene = meshup.SceneNode.root('root'); // new scene root
        this._sidSeq = 0; // a run starts numbering from 1 again
        this._scene.setSidProvider(() => this._nextSid());
        this._setActiveLayer(this._scene);
        this.setMake();
    }

    /** Hand out the next shape serial id. Installed on the scene root as a provider by
     *  reset(), so the meshup scene layer can number adopted shapes without knowing about
     *  the Modeler — the same arrangement as the active layer below. */
    private _nextSid(): number
    {
        return ++this._sidSeq
    }

    /** Highest serial id handed out so far (= number of shapes adopted this run). */
    lastSid(): number
    {
        return this._sidSeq
    }

    /** Set the active layer (where new shapes land) and mirror it onto the scene root so
     *  the meshup scene decorators can resolve it from any in-scene shape via
     *  `node.root().activeLayer()`. */
    private _setActiveLayer(node: meshup.SceneNode | null): void
    {
        this._activeLayer = node;
        this._scene?.setActiveLayer(node);
    }

    /** Adopt a freshly-created meshup shape into this modeler: tag it with the modeler
     *  back-reference (so its augmented visual methods can reach the app modules) and add it
     *  to the scene at the active layer. Returns the same shape for chaining. */
    private _adopt<T>(shape: T): T
    {
        if (shape === null || shape === undefined)
        {
            // A kernel factory returned nothing. Say so here — otherwise this surfaces to the
            // script author as "Cannot set properties of null (setting '_modeler')".
            throw new Error(
                `Modeler: the ${this._mode} kernel could not build that shape (it returned nothing). ` +
                `Check the arguments — for example, that the points span the plane or volume you expect.`);
        }
        (shape as any)._modeler = this;
        this.addToScene(shape);
        return shape;
    }

    /** Guard for primitives only the brep kernel provides (spiral, helix, cone, basePlane). */
    private _requireBrep(method: string): void
    {
        if (this._mode !== 'brep')
        {
            throw new Error(
                `Modeler::${method}(): only available in brep mode — the mesh kernel has no ` +
                `${method} primitive. Switch kernels with mode('brep') or run with kernel: 'brep'.`);
        }
    }

    /** Get active kernel */
    kernel(): Meshup|Brep
    {
        return this._kernels[this._mode];
    }

    /** Switch model kernels, load if needed */
    async switch():Promise<ModelMode>
    {
        this._mode = this._mode === 'mesh' ? 'brep' : 'mesh';
        await this.load();
        return this._mode;
    }

    //// LOADING OF KERNELS ////

    /** Load the kernels this Modeler needs.
     *
     *  The MESH kernel is always loaded, in both modes. It is not just a geometry kernel here:
     *  it owns the scene graph (SceneNode), the style model and the GLTF/SVG exporters that
     *  both kernels share, and Modeler.sketch() uses meshup.Sketch whatever the mode. The brep
     *  kernel is loaded on top of it only when brep mode is selected — its OpenCascade WASM is
     *  ~10MB, so a mesh-only run must never pay for it. */
    async load(): Promise<this>
    {
        try
        {
            if(!this._kernels.mesh)
            {
                await this._loadMeshup();
            }
            if(this._mode === 'brep' && !this._kernels.brep)
            {
                await this._loadBrep();
            }
        }
        catch (e)
        {
            console.error(`Failed to load ${this._mode} kernel:`, e);
            throw e;
        }

        return this;
    }

    async _loadMeshup()
    {
        console.info('Modeler: Loading Meshup kernel...');
        const t = performance.now();
        this._kernels.mesh = (await import('@archiyou/meshup')) as Meshup;
        await this._kernels.mesh.init(); // load wasm
        console.info(`Modeler: Meshup loaded successfully in ${Math.round(performance.now() - t)} ms.`);
        console.info(`With these methods/classes: "${Object.keys(this._kernels.mesh)}"`);
    }

    async _loadBrep()
    {
        console.info('Modeler: Loading BREP kernel...');
        const t = performance.now();
        this._kernels.brep = (await import('./brep/index')) as Brep;
        const oc = await this._kernels.brep.init(); // load wasm

        // Give brep Shapes the same app-level methods (.dim(), .label(), .material(), …).
        // Done here, not at import time, so a mesh-only run never touches the OC barrel.
        applyShapeAnnotations(this._kernels.brep.Shape, this._kernels.brep.ShapeCollection, 'brep');

        console.info(`Modeler: BREP kernel loaded successfully in ${Math.round(performance.now() - t)} ms.`);
        console.info(`With these methods/classes: "${Object.keys(this._kernels.brep)}"`);
    }

    /* At least one kernel is loaded */
    loaded():boolean
    {
        return !!this._kernels.mesh || !!this._kernels.brep;
    }

    /** Copy already-loaded kernel references from another Modeler (e.g. the Runner's pre-loaded modeler) */
    inheritKernels(source: Modeler): this
    {
        (Object.keys(source._kernels) as ModelMode[]).forEach(mode =>
        {
            if (source._kernels[mode] && !this._kernels[mode])
                this._kernels[mode] = source._kernels[mode];
        });
        return this;
    }


    /** Kernel classes under ONE set of names, whichever kernel is active.
     *
     *  App modules (the Annotator above all) build helper geometry through this — `classes.
     *  Curve.Line(a, b)`, `new classes.Point(...)` — and must not care which kernel is running.
     *  The mesh kernel already uses these names; brep names its equivalents differently
     *  (Edge/Solid) and builds via `new Edge().makeLine()` rather than a static, so brep gets a
     *  thin adapter. Built once per kernel and cached. */
    get classes(): KernelClasses
    {
        const k = this.kernel();
        if (!k) throw new Error(`Modeler.classes: kernel '${this._mode}' is not loaded. Call load() first.`);

        if (this._mode !== 'brep') { return k as KernelClasses } // meshup already matches

        if (!this._brepClasses)
        {
            const K = k as Brep;
            // A Curve that behaves like meshup's: same constructor, plus the static factories
            // the app calls. brep's linear shape is Edge.
            class BrepCurve extends (K.Edge as any)
            {
                static Line(start: any, end: any) { return new K.Edge().makeLine(start, end) }
                static Arc(start: any, mid: any, end: any) { return new K.Edge().makeArc(start, mid, end) }
            }

            this._brepClasses = {
                Point:           K.Point,
                Vector:          K.Vector,
                Vertex:          K.Vertex,
                Shape:           K.Shape,
                Curve:           BrepCurve,
                Mesh:            K.Solid,   // brep's volumetric shape
                ShapeCollection: K.ShapeCollection,
                Bbox:            K.Bbox,
            } as unknown as KernelClasses;
        }

        return this._brepClasses;
    }

    scene(): meshup.SceneNode
    {
        return this._scene;
    }

    layouter(): Layouter
    {
        return new Layouter(this._scene)
    }

    /** Add a meshup shape (or array of shapes) to the scene at the active layer. Tags each
     *  with the modeler back-reference so its augmented visual methods can reach the app. */
    addToScene(shape: any | Array<any>): meshup.SceneNode
    {
        const shapes = Array.isArray(shape) ? shape : [shape];
        // Structural check, not an instanceof one: brep Shapes answer isShapeClass() too, and
        // both kernels' shapes go into the same scene.
        if (!shapes.every(s => isAnyShape(s) || s?.isShapeClass?.()))
        {
            throw new Error('Modeler::addToScene(): argument must be a Shape (mesh or brep) or an array of them.');
        }
        shapes.forEach(s =>
        {
            (s as any)._modeler = this;
            // A shape marked tmp() opts out of the scene.
            if ((s as any)._suppressScene) return;
            this._activeLayer!.addShape(s as any);
        });
        return this._activeLayer!;
    }

    /** Set Modeler mode: mesh (default) or brep */
    @validate(ModelModeSchema)
    mode(m?:ModelMode):ModelMode
    {
        if(m){ this._mode = m } // setter
        return this._mode;
    }

    @validate(ModelUnitsSchema)
    units(u?:ModelUnits):ModelUnits
    {
        if(u){ this._units = u } // setter
        return this._units;
    }

    /** Display unit system (metric/imperial) — presentation preference only. */
    unitSystem(s?:'metric'|'imperial'):'metric'|'imperial'
    {
        if(s){ this._unitSystem = s } // setter
        return this._unitSystem;
    }

    //// ==== MODELING PRIMITIVES ==== ////

    /*  Every primitive dispatches on the active kernel. The mesh branch builds meshup shapes;
        the brep branch builds OpenCascade ones. Both land in the SAME scene via _adopt(), and
        both are exported by the same pipeline — see Modeler._exportGLBWithOptions().

        NOTE: the @validate schemas are shared by both branches. They use meshup's isPointLike,
        so brep's extra coord forms (relative strings like '+10') are not accepted at this
        level — use the brep classes directly if you need those. */

    /** The loaded brep kernel namespace. Throws a useful error when brep mode was selected but
     *  the kernel never loaded (load() is async and must have completed). */
    private _brep(): Brep
    {
        const k = this._kernels.brep as Brep | null;
        if (!k)
        {
            throw new Error(
                `Modeler: brep mode is selected but the BREP kernel is not loaded. ` +
                `Call \`await modeler.load()\` (or set the kernel on the run request) first.`);
        }
        return k;
    }

    //// POINTLIKES ////

    /** Creates a 2D/3D Point */
    @validate(PointLikeSchema)
    point(xp?:PointLike, y?:number, z?:number): Point
    {
        if (this._mode === 'brep') return new (this._brep().Point)(xp as any, y, z)
        return new meshup.Point(xp, y, z) as meshup.Point
    }

    /** Creates a 2D/3D Vector */
    @validate(PointLikeSchema)
    vector(xp?:PointLike, y?:number, z?:number): Vector
    {
        if (this._mode === 'brep') return new (this._brep().Vector)(xp as any, y, z)
        return new meshup.Vector(xp, y, z) as meshup.Vector
    }


    /** Creates a Vertex and adds it to the scene so .color()/.name()/etc. work and the
     *  point is exported to the GLB. */
    @validate(PointLikeSchema)
    vertex(xp?:PointLike, y?:number, z?:number): Vertex
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Vertex)(xp as any, y, z))
        return this._adopt(new meshup.Vertex(meshup.Point.from(xp, y, z)) as meshup.Vertex)
    }


    //// LINEAR SHAPES ////

    /** Creates a Line Curve */
    @validate(PointLikeSchema, PointLikeSchema)
    line(start: PointLike, end: PointLike): AnyKernelShape
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Edge)().makeLine(start as any, end as any))
        return this._adopt(meshup.Curve.Line(start, end) as meshup.Curve)
    }

    /** Makes an Arc through start, mid and end Point */
    @validate(PointLikeSchema, PointLikeSchema, PointLikeSchema)
    arc(start: PointLike, mid: PointLike, end: PointLike): AnyKernelShape
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Edge)().makeArc(start as any, mid as any, end as any))
        return this._adopt(meshup.Curve.Arc(start, mid, end) as meshup.Curve)
    }

    /** Makes a Spline going through given Points */
    spline(...points: PointLike[]): AnyKernelShape
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Edge)().makeSpline(points as any))
        return this._adopt(meshup.Curve.Interpolated(...points) as meshup.Curve)
    }

    /** Makes a Polyline through multiple points */
    polyline(points: PointLike | PointLike[], ...args: PointLike[]): AnyKernelShape
    {
        if (this._mode === 'brep')
        {
            const pts = (isPointLike(points) ? [points, ...args] : [...(points as PointLike[]), ...args]);
            return this._adopt(new (this._brep().Wire)(pts as any))
        }
        return this._adopt(meshup.Curve.Polyline(points, ...args) as meshup.Curve)
    }

    /** Makes a 2D Spiral. brep only — meshup has no spiral primitive yet. */
    spiral(firstRadius: number = 20, secondRadius: number = 50, angle: number = 360, lefthand: boolean = false): AnyKernelShape
    {
        this._requireBrep('spiral');
        return this._adopt(new (this._brep().Wire)().makeSpiral(firstRadius, secondRadius, angle, lefthand))
    }

    /** Makes a Helix. brep only — meshup has no helix primitive yet. */
    helix(radius: number = 50, height: number = 100, angle: number = 360, pivot?: PointLike,
          direction?: PointLike, lefthand: boolean = false, coneSemiAngle?: number): AnyKernelShape
    {
        this._requireBrep('helix');
        return this._adopt(new (this._brep().Wire)().makeHelix(
            radius, height, angle, pivot as any, direction as any, lefthand, coneSemiAngle))
    }

    //// CLOSED 2D SHAPES ////

    /** Creates a rectangular outline.
     *  Both kernels return the OUTLINE, not a surface: a Curve on mesh, a Wire on brep. Use
     *  plane() for the filled version. (Getting this wrong made brep rects answer to the
     *  surface API instead of the curve API — .segment()/.extend()/.toPolygon() all missed.) */
    rect(width: number = 100, depth: number = 100, center: PointLike = [0, 0, 0]): AnyKernelShape
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Wire)().makeRect(width, depth, center as any))
        return this._adopt(meshup.Curve.Rect(width, depth, center) as meshup.Curve)
    }

    /** Creates a rectangular Curve between two Points */
    @validate(PointLikeSchema, PointLikeSchema)
    rectBetween(from: PointLike, to: PointLike): AnyKernelShape
    {
        // Outline, like rect(). makePlaneBetween (not makeRectBetween) because the latter is
        // XY-only, while the mesh kernel accepts two points spanning any base plane; the
        // resulting Face is reduced to its outer Wire.
        if (this._mode === 'brep')
        {
            const face = new (this._brep().Face)().makePlaneBetween(from as any, to as any);
            return this._adopt(face ? (face as any).outerWire?.() ?? face : face)
        }
        return this._adopt(meshup.Curve.RectBetween(from, to) as meshup.Curve)
    }

    /** Creates a closed planar Polygon from 3+ points.
     *  Accepts either an array — polygon([p1, p2, p3]) — or flat args — polygon(p1, p2, p3). */
    polygon(vertices: PointLike | PointLike[], ...args: PointLike[]): AnyKernelShape
    {
        const points = (isPointLike(vertices) ? [vertices, ...args] : [...(vertices as PointLike[]), ...args]) as PointLike[];
        if (this._mode === 'brep') return this._adopt(new (this._brep().Face)().fromVertices(points as any))
        return this._adopt(new meshup.Polygon(points) as meshup.Polygon)
    }

    /** Creates a circular outline — a Curve on mesh, a circular Edge on brep. */
    circle(radius: number = 50, center: PointLike = [0, 0, 0]): AnyKernelShape
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Edge)().makeCircle(radius, center as any))
        return this._adopt(meshup.Curve.Circle(radius, center) as meshup.Curve)
    }

    /** Creates a planar surface */
    plane(...args: any[]): AnyKernelShape
    {
        const [
            width = 50,
            depth = 50,
            position = [0, 0, 0],
            normal = [0, 0, 1],
        ] = args as [number?, number?, PointLike?, PointLike?]

        if (this._mode === 'brep')
        {
            return this._adopt(new (this._brep().Face)().makePlane(width, depth, position as any, normal as any))
        }

        // A plane is a flat surface, so build it as a Polygon (not a solid Mesh): flat shapes
        // are cut in 2D (see Polygon.cutoff), whereas Mesh.cutoff needs a solid.
        const basePolygon = meshup.Curve.Rect(width, depth, [0, 0, 0]).toPolygon()
        if (!basePolygon)
        {
            throw new Error('plane(): failed to create mesh plane surface.')
        }

        const shape = basePolygon as meshup.Polygon
        const normalVector = new meshup.Vector(normal)
        if (normalVector.length() === 0)
        {
            throw new Error('plane(): normal must be a non-zero vector.')
        }

        const targetNormal = normalVector.normalize()
        const baseNormal = new meshup.Vector(0, 0, 1)
        if (!baseNormal.equals(targetNormal))
        {
            shape.rotateQuaternion(baseNormal.rotationBetween(targetNormal))
        }

        shape.move(position)
        return this._adopt(shape)
    }

    /** Creates a planar Face between two Points */
    @validate(PointLikeSchema, PointLikeSchema)
    planeBetween(from: PointLike, to: PointLike): AnyKernelShape
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Face)().makePlaneBetween(from as any, to as any))
        return this._adopt(meshup.Polygon.planeBetween(from, to) as meshup.Polygon)
    }

    /** Creates a base plane along a main axis. brep only — it needs the kernel's notion of
     *  a workplane, which meshup does not have. */
    basePlane(axis: string = 'xy', size: number = 100): AnyKernelShape
    {
        this._requireBrep('basePlane');
        return this._adopt(new (this._brep().Face)().makeBasePlane(axis as any, size))
    }

    //// 3D SHAPES ////

    /** Creates a Box shape */
    @validate(Type.Number(), Type.Number(), Type.Number(), optional(PointLikeSchema))
    box(width: number = 100, depth?: number, height?: number, position?: PointLike): AnyKernelShape
    {
        if (this._mode === 'brep')
        {
            return this._adopt(new (this._brep().Solid)().makeBox(width, depth, height, position as any))
        }
        const shape = meshup.Mesh.Box(width, depth, height) as meshup.Mesh
        if (position) { shape.move(position) }
        return this._adopt(shape)
    }

    /** Alias for box */
    @validate(Type.Number(), Type.Number(), Type.Number(), optional(PointLikeSchema))
    cube(width: number = 100, depth?: number, height?: number, position?: PointLike): AnyKernelShape
    {
        return this.box(width, depth, height, position)
    }

    /** Creates a Box shape between two Points */
    @validate(PointLikeSchema, PointLikeSchema)
    boxBetween(from: PointLike, to: PointLike): AnyKernelShape
    {
        if (this._mode === 'brep')
        {
            const box = new (this._brep().Solid)().makeBoxBetween(from as any, to as any);
            if (!box)
            {
                throw new Error(`boxBetween(): failed to create a Box between ${from} and ${to}. Do the points span a 3D space?`);
            }
            return this._adopt(box)
        }
        return this._adopt(meshup.Mesh.BoxBetween(from, to) as meshup.Mesh)
    }

    /** Creates a Sphere shape */
    @validate(Type.Number(), PointLikeSchema)
    sphere(radius: number = 50, position?: PointLike): AnyKernelShape
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Solid)().makeSphere(radius, position as any))
        const shape = meshup.Mesh.Sphere(radius) as meshup.Mesh
        if (position) { shape.move(position) }
        return this._adopt(shape)
    }

    /** Creates a Cone. brep only — meshup has no cone primitive yet. */
    cone(bottomRadius: number = 50, topRadius: number = 0, height: number = 100, position?: PointLike): AnyKernelShape
    {
        this._requireBrep('cone');
        // NOTE: makeCone builds from the base up; recentre it on the origin like the other solids
        const cone = new (this._brep().Solid)().makeCone(bottomRadius, topRadius, height, position as any, 360)
            .move(0, 0, -height / 2);
        return this._adopt(cone)
    }

    /** Creates a Cylinder shape */
    @validate(Type.Number(), Type.Number(), PointLikeSchema)
    cylinder(radius: number = 50, height: number = 100, position?: PointLike): AnyKernelShape
    {
        if (this._mode === 'brep') return this._adopt(new (this._brep().Solid)().makeCylinder(radius, height, position as any))
        const shape = meshup.Mesh.Cylinder(radius, height) as meshup.Mesh
        if (position) { shape.move(position) }
        return this._adopt(shape)
    }

    //// ==== SCENE MANAGEMENT ==== ////

    activeLayer(): meshup.SceneNode | null
    {
        return this._activeLayer;
    }

    layerShapes(): meshup.ShapeCollection
    {
        return this._activeLayer ? this._activeLayer.shapes() : new meshup.ShapeCollection();
    }

    /** Create or activate a named layer
     *  a layer is always created as sibling of the active layer, and becomes the new active layer.
    */
    layer(name?: string): meshup.SceneNode
    {
        if (!name) { return this._activeLayer ?? this._scene }

        // Check if layer name exists
        const existingLayers = this.scene()
            .findAll(n => n.name === name);

        if(existingLayers.length > 0)
        {
            if(existingLayers.length > 1){ console.warn(`Multiple layers with name "${name}" found. Getting the first one.`) }
            return existingLayers[0];
        }

        const layer = new meshup.SceneNode(name);
        (this._activeLayer!.parent() || this._activeLayer!).addChild(layer);
        this._setActiveLayer(layer);
        console.info(`Modeler::layer(): Created and switched to layer "${name}".`);
        return this._activeLayer!;
    }

    /** Return all Shapes in the scene as a ShapeCollection */
    all(): meshup.ShapeCollection
    {
        if(!this._scene){ return new meshup.ShapeCollection(); }
        return new meshup.ShapeCollection(this._scene.shapes());
    }

    /** @alias all */
    allShapes(): meshup.ShapeCollection
    {
        return this.all();
    }

    /** Create a ShapeCollection that only REFERENCES its shapes: the scene graph is left
     *  exactly as it is, so shapes keep the layer they were made in. Safe to build anywhere,
     *  including as a throwaway argument (`make.partList(collection(a,b))`).
     *
     *  Use group() when you also want the shapes gathered under a layer in the scene. */
    collection(...args: Array<any>): meshup.ShapeCollection
    {
        const col = new meshup.ShapeCollection() // empty: keep constructor scene-agnostic
        col._modeler = this
        args.forEach(arg => col.add(arg))
        return col
    }

    /** Create a scene-backed ShapeCollection: a new layer under the current active layer,
     *  with every given Shape MOVED into it - from any layer it was in, because the scene is
     *  a tree and a Shape lives in exactly one place. Shapes added later (`g.add(...)`) are
     *  moved in too.
     *
     *  `group(a, b)` names the layer after the variable it is assigned to (the Runner's
     *  auto-namer); `group('table', a, b)` names it explicitly.
     *
     *  Use collection() when you only want to reference shapes without restructuring. */
    group(...args: Array<any>): meshup.ShapeCollection
    {
        const name = (typeof args[0] === 'string') ? args.shift() as string : null

        const col = new meshup.ShapeCollection() // empty: keep constructor scene-agnostic
        col._modeler = this
        const layer = new meshup.SceneNode(name ?? col._name)
        this._activeLayer!.addChild(layer) // child of active layer; do NOT reassign _activeLayer
        col._layer = layer
        if (name){ col.name(name) }
        args.forEach(arg => col.add(arg)) // ShapeCollection.add() re-parents into col._layer
        return col
    }


    /** Select shapes by a selection string — delegates to the active sketch when in sketch mode. */
    select(selectionString: string): any
    {
        if (this._activeSketch && typeof this._activeSketch.select === 'function')
        {
            return this._activeSketch.select(selectionString)
        }
        console.warn('Modeler::select(): only available inside a sketch or in brep mode')
    }

    /** Operate at vertices — delegates to active sketch. */
    atVertices(): any
    {
        if (this._activeSketch && typeof this._activeSketch.atVertices === 'function')
        {
            return this._activeSketch.atVertices()
        }
        console.warn('Modeler::atVertices(): only available inside a sketch or in brep mode')
    }

    //// ==== SKETCH API ==== ////

    /** Start a 2D sketch on a given base plane.
     *
     *  ALWAYS a meshup.Sketch, in both kernels. brep had its own Sketch implementation but it
     *  was built around the deleted Brep god-class (layers, activeSketch) and duplicated what
     *  meshup.Sketch already does; sketching in brep mode therefore produces meshup Curves in
     *  the shared scene. That is fine — the scene and the exporters are kernel-agnostic — and a
     *  brep-native sketch can be reintroduced later without changing this entry point. */
    sketch(plane: any = 'xy', _yAxis?: any): meshup.Sketch
    {
        this._activeSketch = new meshup.Sketch(plane);
        // we register a callback to capture the result and add to scene
        this._activeSketch.onEnd((curves) =>
        {
            const sketchCurves = (curves as meshup.ShapeCollection<meshup.Curve>).toArray();
            this.addToScene(sketchCurves);
            return sketchCurves.length === 1 ? sketchCurves[0] : new meshup.ShapeCollection(...sketchCurves);
        });
        return this._activeSketch
    }

    //// TEXT ////

    /** Render `text` as native geometry and add it to the scene (mesh mode only).
     *
     *  Styles:
     *   - `'outline'` (default): filled glyph contours as 2-D curves (holes for
     *      counters). Uses a TrueType/OpenType font.
     *   - `'solid'`: the outline extruded into a 3-D solid (`opts.depth`, default 2).
     *   - `'stroke'` (alias `'engrave'`): single-stroke Hershey line curves, ideal
     *      for CNC engraving / pen plotting.
     *
     *  Fonts:
     *   - outline/solid: `opts.font` accepts raw TTF/OTF `Uint8Array`/`ArrayBuffer`,
     *     or the name of a font previously registered with {@link Modeler.loadFont}.
     *     Omitted → the bundled default (Outfit).
     *   - stroke: `opts.font` is a bundled Hershey name (`'sans'`, `'serif'`,
     *     `'script'`, `'gothic'`, `'greek'`), raw `.jhf` text, or omitted for `'sans'`.
     *
     *  Text is laid out on the XY plane from the origin; use `opts.at` to position it. */
    text(text: string, opts: ModelerTextOptions = {}): meshup.ShapeCollection | meshup.Curve | meshup.Mesh
    {
        if (this.mode() !== 'mesh')
        {
            throw new Error('Modeler::text(): native text is only available in mesh mode.')
        }
        if (typeof text !== 'string')
        {
            throw new Error('Modeler::text(): `text` must be a string.')
        }

        const style = opts.style ?? 'outline'
        const align = opts.align ?? 'left'

        if (style === 'stroke' || style === 'engrave')
        {
            // Hershey stroke fonts: forward a bundled name, raw .jhf text or bytes.
            const curves = meshup.Sketch.textStroke(text, { font: opts.font, size: opts.size ?? 5, align })
            return this._addTextCurves(curves, opts.at)
        }

        const fontBytes = this._resolveTextFont(opts.font)

        if (style === 'solid')
        {
            const mesh = meshup.Sketch.textSolid(text, { font: fontBytes, size: opts.size ?? 20, depth: opts.depth ?? 2, align }) as meshup.Mesh
            if (opts.at) { mesh.move(opts.at) }
            return this._adopt(mesh)
        }

        if (style !== 'outline')
        {
            throw new Error(`Modeler::text(): unknown style '${style}'. Use 'outline', 'solid', or 'stroke'.`)
        }

        const curves = meshup.Sketch.textOutline(text, { font: fontBytes, size: opts.size ?? 20, align })
        return this._addTextCurves(curves, opts.at)
    }

    /** Register a font (TTF/OTF) by name for use with {@link Modeler.text}.
     *  `source` may be raw bytes (`Uint8Array`/`ArrayBuffer`) or a URL to a `.ttf`
     *  /`.otf` file (fetched here). Returns the font bytes. woff2 is not supported —
     *  for Google Fonts pass a direct TTF URL, not the CSS API. */
    async loadFont(name: string, source: string | Uint8Array | ArrayBuffer): Promise<Uint8Array>
    {
        if (!name) { throw new Error('Modeler::loadFont(): a non-empty `name` is required.') }
        let bytes: Uint8Array
        if (source instanceof Uint8Array) { bytes = source }
        else if (source instanceof ArrayBuffer) { bytes = new Uint8Array(source) }
        else if (typeof source === 'string') { bytes = await fetchFont(source) }
        else { throw new Error('Modeler::loadFont(): `source` must be a URL string, Uint8Array or ArrayBuffer.') }
        registerFont(name, bytes)
        return bytes
    }

    /** @internal Resolve an outline-text font option to raw bytes. */
    private _resolveTextFont(font?: ModelerTextOptions['font']): Uint8Array
    {
        if (font == null) { return defaultTextFont() }
        if (font instanceof Uint8Array) { return font }
        if (font instanceof ArrayBuffer) { return new Uint8Array(font) }
        if (typeof font === 'string')
        {
            const registered = getFont(font)
            if (!registered)
            {
                throw new Error(`Modeler::text(): unknown font '${font}'. Register it first with loadFont('${font}', <url|bytes>), or pass raw TTF/OTF bytes.`)
            }
            return registered
        }
        throw new Error('Modeler::text(): `font` must be a name, Uint8Array or ArrayBuffer.')
    }

    /** @internal Position text curves, add them to the scene, return one or a collection. */
    private _addTextCurves(curves: meshup.ShapeCollection<meshup.Curve>, at?: PointLike): meshup.ShapeCollection | meshup.Curve
    {
        const shapes = curves.toArray() as meshup.Curve[]
        if (at) { shapes.forEach(s => s.move(at)) }
        this.addToScene(shapes)
        return shapes.length === 1 ? shapes[0] : new meshup.ShapeCollection(...shapes)
    }


    //// OUTPUT ////

    toGraph():SceneNodeGraphNode
    {
        return this.scene().toGraph()
    }

    async toGLB(options?: ModelerSceneExportGLTFOptions): Promise<Uint8Array>
    {
        return this._exportGLBWithOptions(options)
    }

    async toGLTF(options?: ModelerSceneExportGLTFOptions): Promise<string>
    {
        const glb = await this._exportGLBWithOptions(options)
        return new GLTFBuilder(glb).toGLTF();
    }


    /** Export the scene's 2D shapes to an SVG string. Returns null when the scene
     *  has no 2D geometry, so exporters don't hand the user an empty drawing.
     *
     *  Called with no options this is the SCENE, drawn by SceneNode.toSVG(): a node tree of
     *  nested `<g>`s with per-shape inline styling. That hierarchy is the point of the model
     *  export — it is what survives into Illustrator as layers — and it is the one thing the
     *  drawing assembler (which frames one flat drawing) cannot express, so this path stays
     *  where it is rather than being folded into it. See runner.svg.test.ts, which pins it.
     *
     *  Pass options to opt into the richer serializer (padding, square framing, relative
     *  coordinate precision, theme-aware stroke) — that one is the assembler. */
    toSVG(options?: toSVGOptions): string | null
    {
        const exportScene = this._exportScene();
        // Asked of the drawing plane, not of is2D(): that tests a bbox extent for an EXACT
        // zero, and a rect rotated onto XZ keeps ~1e-15 of it, so a model built by rotation
        // was turned away as "no 2D shapes in scene".
        if (!detectExportFrame(exportScene.shapes().toArray()))
        {
            console.warn('Modeler::toSVG(): No 2D shapes in scene. Nothing to export.')
            return null
        }
        if (!options || Object.keys(options).length === 0) return exportScene.toSVG()

        // The whole collection, not just its curves(): the exporter picks the drawable shapes
        // itself (curves and flat faces alike), and curves() strips the projection groups it
        // reads hidden lines from — a copy is a new collection with no groups on it.
        return buildSVG(exportScene.shapes(), { units: this.units(), ...options })
    }

    /** Hidden-line projection of every Mesh in the scene to a 2D SVG line drawing.
     *  Unlike toSVG() this does not need the script to have authored any 2D geometry —
     *  it projects the 3D model on demand. Does NOT mutate the scene.
     *  Returns null when the scene holds no meshes. */
    toProjectionSVG(options?: toProjectionSVGOptions): string | null
    {
        const meshes = this._sceneMeshCollection('toProjectionSVG')
        if (!meshes) return null
        return buildProjectionSVG(meshes, { units: this.units(), ...(options ?? {}) })
    }

    /** Size-capped SVG for use as a thumbnail or list icon.
     *
     *  Two sources, in order: a hidden-line projection of the scene's meshes, or — for a
     *  scene that has none — the 2D geometry the script authored, drawn as it lies. The
     *  fallback matters more than it sounds: a 2D-only script (plate layouts, nesting
     *  sheets, anything from rect/circle/offset) previously got NO thumbnail whatsoever,
     *  silently, because this path only ever consumed meshes.
     *
     *  Returns null only when the scene holds no drawable geometry at all, or when even
     *  the degraded drawing exceeds the hard byte cap — callers then show a placeholder
     *  rather than storing something unusable. */
    toThumbnailSVG(options?: ThumbnailSVGOptions): ThumbnailSVGResult | null
    {
        const opts = { units: this.units(), ...(options ?? {}) }
        const exportScene = this._exportScene()

        const meshes = exportScene.shapes().meshes()
        if (meshes && meshes.length > 0) return buildThumbnailSVG(meshes, opts)

        // No 3D to project — draw the 2D geometry itself. `view`/`cam` do not apply.
        const thumb = buildThumbnailSVGFromCurves(exportScene.shapes(), opts)
        if (!thumb)
        {
            console.warn('Modeler::toThumbnailSVG(): No Meshes and no 2D geometry in scene. Nothing to export.')
        }
        return thumb
    }

    /** The scene's Meshes as a ShapeCollection (the projection entrypoints live on the
     *  collection, not on a plain array). Warns and returns null when there is no 3D geometry. */
    private _sceneMeshCollection(method: string): any | null
    {
        const meshes = this._exportScene().shapes().meshes()
        if (!meshes || meshes.length === 0)
        {
            console.warn(`Modeler::${method}(): No Meshes in scene. Nothing to export.`)
            return null
        }
        return meshes
    }

    /** Export all Meshes in the scene to one binary STL. Non-mesh shapes (curves,
     *  polygons, vertices) are skipped. Returns null when the scene has no meshes.
     *  The per-mesh binary STLs are merged by concatenating their triangle records
     *  (binary STL = 80 byte header + uint32 count + 50 bytes per triangle). */
    toSTL(): Uint8Array | null
    {
        const meshes = this._sceneMeshes('toSTL')
        if (meshes.length === 0) return null

        const TRI_BYTES = 50;
        const triangleChunks:Array<Uint8Array> = []
        let numTriangles = 0;

        meshes.forEach((mesh) =>
        {
            const stl = mesh.toSTLBinary?.() as Uint8Array | undefined
            if (!stl || stl.byteLength < 84) return;

            const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
            const count = view.getUint32(80, true);
            if (count === 0) return;

            // Guard against a truncated/invalid record block
            const avail = Math.min(count, Math.floor((stl.byteLength - 84) / TRI_BYTES));
            if (avail === 0) return;

            triangleChunks.push(stl.subarray(84, 84 + avail * TRI_BYTES));
            numTriangles += avail;
        })

        if (numTriangles === 0)
        {
            console.warn('Modeler::toSTL(): Meshes in scene produced no triangles.')
            return null
        }

        const out = new Uint8Array(84 + numTriangles * TRI_BYTES);
        // Header (80 bytes, zero-filled except a short signature) + triangle count
        new TextEncoder().encodeInto('Archiyou binary STL export', out.subarray(0, 80));
        new DataView(out.buffer).setUint32(80, numTriangles, true);

        let offset = 84;
        triangleChunks.forEach((chunk) => { out.set(chunk, offset); offset += chunk.byteLength; })

        return out
    }

    /** All Meshes in the scene, in scene order. Warns (with the calling method's name)
     *  and returns [] when the scene holds no 3D geometry. */
    private _sceneMeshes(method: string): Array<any>
    {
        const meshes = this._exportScene().shapes().toArray()
            .filter((s:any) => s?.type === 'Mesh') as Array<any>

        if (meshes.length === 0)
        {
            console.warn(`Modeler::${method}(): No Meshes in scene. Nothing to export.`)
        }
        return meshes
    }

    /** AMF unit name for the modeler's current units. AMF 1.1 only knows
     *  micron/millimeter/centimeter/inch/feet/meter — anything else falls back to millimeter. */
    private _amfUnit(): string
    {
        const AMF_UNITS: Record<string, string> = {
            mm: 'millimeter', cm: 'centimeter', m: 'meter', inch: 'inch', feet: 'feet',
        };
        return AMF_UNITS[this.units()] ?? 'millimeter';
    }

    /** Export all Meshes in the scene to one AMF document (XML string). Each mesh becomes
     *  its own <object> in a shared <amf> root; non-mesh shapes are skipped. Returns null
     *  when the scene has no meshes.
     *  NOTE: the kernel emits one single-object document per mesh, so the objects are
     *  lifted out of those documents and renumbered into one document here. */
    toAMF(): string | null
    {
        const meshes = this._sceneMeshes('toAMF')
        if (meshes.length === 0) return null

        const unit = this._amfUnit()
        const objects: Array<string> = []

        meshes.forEach((mesh, i) =>
        {
            const doc = mesh.toAMF?.(mesh.name?.() ?? `object${i}`, unit) as string | undefined
            if (!doc) return;

            // Lift the <object …>…</object> block out of the single-object document
            const start = doc.indexOf('<object');
            const end = doc.lastIndexOf('</object>');
            if (start === -1 || end === -1) return;

            const object = doc.slice(start, end + '</object>'.length)
                // AMF ids must be integers — the kernel writes the object name there
                .replace(/^<object\s+id="[^"]*"/, `<object id="${objects.length}"`);

            objects.push(object);
        })

        if (objects.length === 0)
        {
            console.warn('Modeler::toAMF(): Meshes in scene produced no AMF geometry.')
            return null
        }

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<amf unit="${unit}" version="1.1">`,
            '  <metadata type="producer">Archiyou</metadata>',
            ...objects,
            '</amf>',
            '',
        ].join('\n')
    }

    /** Export the whole scene's 2D shapes (and all dimension annotations) to a DXF
     *  string. Non-2D shapes are skipped. The drawing plane is detected from the geometry
     *  itself — a model standing on XZ exports as a front elevation without being rotated
     *  first — or forced with `options.plane`. Returns null when the scene holds no 2D
     *  geometry at all. This is the scene-level entry used by the Runner's `dxf` model
     *  output. */
    toDXF(options?: toDXFOptions): string | null
    {
        const shapes = this._exportScene().shapes().toArray()
        const annotations = this._modules?.annotator?.getAnnotations?.() ?? []
        return buildDXF(shapes as any, annotations, { units: this.units(), ...(options ?? {}) })
    }

    /** Export the whole scene to a COLLADA (.dae) document. Unlike the other exporters this
     *  takes the scene ROOT, not a flat shape list — the node hierarchy is preserved as
     *  nested COLLADA <node>s. Meshes keep their n-gon faces and are welded; Curves become
     *  <lines>. Returns null when the scene holds no exportable geometry. */
    async toDAE(options?: toDAEOptions): Promise<string | null>
    {
        const { buildDAE } = await import('./DAEExporter')
        return buildDAE(this._exportScene(), { units: this.units(), ...(options ?? {}) })
    }

    /** Build the ArchiyouStateData payload (scenegraph + annotations + managedHandles) used by
     *  RunnerScriptExecutionResult.state and embedded in GLB extras. */
    toArchiyouState(annotations: Array<any> = [], managedHandles?: import('../interaction/types').ManagedHandlesData, interactiveShapes?: Array<string>): ArchiyouStateData
    {
        const sceneRoot = this.scene();
        sceneRoot?.pruneEmptyNodes();
        return {
            scenegraph: sceneRoot ? sceneRoot.toData(true) : undefined,
            annotations,
            ...(managedHandles !== undefined ? { managedHandles } : {}),
            ...(interactiveShapes !== undefined ? { interactiveShapes } : {}),
        };
    }

    //// UTILS ////

    /** @internal Ensure an active sketch exists; throws a descriptive error if not. */
    private _requireSketch(method: string): any
    {
        if (!this._activeSketch)
        {
            throw new Error(
                `Modeler::${method}(): no active sketch. Call sketch() first.`
            )
        }
        return this._activeSketch
    }

    /** The scene as the exporters should see it.
     *
     *  All output (GLB/SVG/DXF/STL/DAE) is produced by the mesh-kernel exporters walking a
     *  SceneNode graph, so brep geometry has to be tessellated into meshup shapes first (see
     *  brep/toMeshup.ts). This returns a parallel node tree — same names, same hierarchy, same
     *  styles — with brep shapes swapped for their stand-ins.
     *
     *  In a pure mesh run it returns the live scene untouched, so nothing about the existing
     *  mesh output changes.
     *
     *  NOTE: the tree references the ORIGINAL meshup shapes rather than copies, and assigns
     *  them via the node's private `_shape` on purpose: SceneNode.setShape() would re-point
     *  each shape's `_node` at the export tree and tear the live scene apart — and the scene
     *  is still needed afterwards for toArchiyouState().
     */
    private _exportScene(quality?: any): meshup.SceneNode
    {
        const scene = this.scene();
        const hasBrep = scene.shapes().toArray().some((s: any) => isBrepShape(s));
        if (!hasBrep) { return scene }

        const build = (src: meshup.SceneNode): meshup.SceneNode =>
        {
            const out = new meshup.SceneNode(src.name);
            out.setStyle(src.style.explicitData());

            const shape = src.shape() as any;
            if (shape)
            {
                const exported = isBrepShape(shape)
                    ? brepShapeToMeshup(shape, quality ?? DEFAULT_MESHING_QUALITY)
                    : shape;

                if (exported)
                {
                    if ((exported as any).isShapeCollection?.())
                    {
                        // one brep Shape became several meshup ones (mesh + its edges):
                        // nest them so the node keeps one identity in the scene graph
                        (exported as meshup.ShapeCollection).toArray().forEach((s: any, i: number) =>
                        {
                            const child = new meshup.SceneNode(`${src.name}_${i}`);
                            (child as any)._shape = s;
                            out.addChild(child);
                        })
                    }
                    else
                    {
                        (out as any)._shape = exported;
                    }
                }
            }

            src.children().forEach(child => out.addChild(build(child)));
            return out;
        }

        return build(scene);
    }

    private async _exportGLBWithOptions(options?: ModelerSceneExportGLTFOptions): Promise<Uint8Array>
    {
        // Settings
        const ANIMATION_DEFS = [
            {
                name: 'exploded',
                build: (layouter: Layouter) => layouter.exploded(),
            },
            {
                name: 'layout',
                build: (layouter: Layouter) => layouter.rowOrtho(),
            },
        ]

        console.info(`Modeler::toGLB(): exporting scene with ${this.scene().shapes().length} shapes...`);

        // Remove empty container nodes before export (e.g. pre-allocated Make group slots)
        this.scene().pruneEmptyNodes();

        // Embed material textures (async, cached) into shape styles so the GLTF
        // builder can bake them into the GLB. No-op when no materials carry textures.
        await this._modules?.materials?.embedTexturesInShapes?.(this.scene().shapes());

        // Base GLB — from an export view of the scene, which converts any brep geometry to
        // its meshup equivalent (see _exportScene). In a pure mesh run this IS the scene.
        const glb = await this._exportScene().toGLB();
        const builder = new GLTFBuilder(glb);

        // Animations
        if (options?.animations)
        {
            const animations = ANIMATION_DEFS.map(({ name, build }) =>
            {
                const layouter = build(new Layouter(this.scene()))
                return {
                    result: layouter.result(),
                    options: {
                        duration: options?.duration ?? GLTF_ANIMATION_DURATION,
                        interpolation: options?.interpolation,
                        animationName: name,
                    },
                }
            });

            await builder.addAnimations(animations);
        }

        // Archiyou state in GLTF extras: scenegraph (path-keyed) + annotations.
        // Mirrors RunnerScriptExecutionResult.state so a standalone .glb still
        // carries the data the viewer/scene-navigator need. Legacy `annotations`
        // key is also written for one back-compat cycle on the read side.
        const anns = options?.annotations
            ? (this._modules?.annotator?.getAnnotationsData?.() ?? [])
            : [];
        const archiyouState = this.toArchiyouState(anns);
        await builder.addData({ state: archiyouState });
        if (anns.length)
        {
            await builder.addData({ annotations: anns });
        }

        // finalize GLB
        return await builder.toGLB();
    }

    /** @internal Guard for mesh-only sketch methods. */
    private _requireMeshSketch(method: string): void
    {
        if (this._mode !== 'mesh')
        {
            throw new Error(
                `Modeler::${method}(): only available on a mesh-mode sketch.`
            )
        }
    }

}