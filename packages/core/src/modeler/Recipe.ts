/**
 * Recipe.ts
 *
 * A kernel-neutral record of HOW a shape was made, read by the procedural exporters (FreeCAD,
 * STEP, IFC, BTLx, OpenSCAD) so they can emit parametric constructs instead of facets.
 * Design and rationale: plans/RECIPE.md.
 *
 * The pipeline is three stages, each readable on its own:
 *
 *      record  ->  classify (rules add tags)  ->  map (rows keyed by tag, then by op)
 *
 * Sections
 *   1. Types             RecipeStep, Recipe, RecipeNode
 *   2. Affine math       3x4 matrices: compose, apply, invert, per-step matrices, frames
 *   3. Capture table     MESH_OPS: kernel method -> recipe step. THE place to add coverage.
 *   4. Recorder          installRecipeRecorder(), setRecipeRecording(), recipeOf()
 *   5. Resolve + verify  resolveRecipe() -> RecipeNode tree; verifyRecipe()
 *   6. Match helpers     leafNodes(), asCuboid()
 *   7. Classification    classify()
 *   8. Mapping           mapRecipe(), RecipeReport
 *   9. Explain           explainRecipe(), explainNode()
 *
 * Three properties the rest of the file relies on:
 *
 *  - Recipes are IMMUTABLE. Every recorded op makes a new frozen Recipe. A copy simply points at
 *    the same Recipe, so meshup's shallow metadata copy (Mesh._copy) cannot leak state between
 *    instances, and a boolean tool's recipe is a snapshot by construction.
 *  - Change detection is by IDENTITY. Every meshup op returns a new MeshJs, so the inner mesh
 *    object is an exact fingerprint: if it differs from the one seen after the last recorded op,
 *    something unrecorded changed the geometry and the recipe is dead. No measuring needed.
 *  - Unknown means baked. An op without a row either goes through recorded rows (composites such
 *    as moveTo or alignByPoints) or it changes the fingerprint and kills the recipe, with the
 *    method name as the reason. The output is never wrong, only less parametric.
 */

import * as meshup from '@archiyou/meshup'

import { SCRIPT_OUTPUT_RECIPE_FORMATS, outputsNeedRecipes } from '../constants'

//// 1. TYPES ////

export type Vec3 = readonly [number, number, number]

/** A number today. The OpenSCAD tracer will widen this to carry a symbolic expression too. */
export type Value = number

/** A primitive the kernel made. Each has a fixed local frame, documented per op. */
export type LeafStep =
    | { op: 'box'; size: Vec3 }                                  // centred on the origin
    | { op: 'cylinder'; radius: Value; height: Value }           // axis +Z, base at z = 0
    | { op: 'sphere'; radius: Value }                            // centred on the origin
    | { op: 'cone'; r1: Value; r2: Value; height: Value }        // axis +Z, base (r1) at z = 0

export type TransformStep =
    | { op: 'translate'; v: Vec3 }
    | { op: 'rotate'; angle: Value; axis: Vec3; pivot: Vec3 }    // degrees, right-handed, unit axis
    | { op: 'scale'; f: Vec3; origin: Vec3 }
    | { op: 'mirror'; normal: Vec3; origin: Vec3 }               // unit normal

export type BooleanOp = 'cut' | 'fuse' | 'common'

/** `cut` = base minus the union of the tools, `fuse` = base plus the tools,
 *  `common` = base intersected with every tool. */
export type BooleanStep = { op: BooleanOp; tools: readonly Recipe[] }

/** From here on the shape is only known as geometry. Always the last step of a recipe. */
export type BakedStep = { op: 'baked'; reason: string }

export type RecipeStep = LeafStep | TransformStep | BooleanStep | BakedStep
export type RecipeOp = RecipeStep['op']

export interface Recipe
{
    readonly steps: readonly RecipeStep[]
}

/** The resolved form exporters map: transforms are pushed down into one matrix per leaf and
 *  consecutive booleans of the same kind are merged, so a tree node is always either a
 *  primitive in a frame, a boolean of nodes, or baked geometry. */
export type LeafNode = { kind: 'leaf'; step: LeafStep; matrix: Affine }
export type BooleanNode = { kind: 'boolean'; op: BooleanOp; base: RecipeNode; tools: RecipeNode[] }
export type BakedNode = { kind: 'baked'; reason: string }
export type RecipeNode = LeafNode | BooleanNode | BakedNode

/** The key a mapping row or classification rule is registered under for a node. */
export type NodeKey = LeafStep['op'] | BooleanOp | 'baked'

export function nodeKey(node: RecipeNode): NodeKey
{
    switch (node.kind)
    {
        case 'leaf': return node.step.op;
        case 'boolean': return node.op;
        case 'baked': return 'baked';
    }
}

const LEAF_OPS: ReadonlySet<string> = new Set(['box', 'cylinder', 'sphere', 'cone']);
const TRANSFORM_OPS: ReadonlySet<string> = new Set(['translate', 'rotate', 'scale', 'mirror']);
const BOOLEAN_OPS: ReadonlySet<string> = new Set(['cut', 'fuse', 'common']);

export function isLeafStep(step: RecipeStep): step is LeafStep { return LEAF_OPS.has(step.op); }
export function isTransformStep(step: RecipeStep): step is TransformStep { return TRANSFORM_OPS.has(step.op); }
export function isBooleanStep(step: RecipeStep): step is BooleanStep { return BOOLEAN_OPS.has(step.op); }

/** True when the recipe still describes the shape procedurally (no baked step). */
export function isRecipeLive(recipe: Recipe | null | undefined): recipe is Recipe
{
    return !!recipe && recipe.steps.length > 0 && recipe.steps[recipe.steps.length - 1].op !== 'baked';
}

export { outputsNeedRecipes };

function freezeRecipe(steps: RecipeStep[]): Recipe
{
    steps.forEach(step => Object.freeze(step));
    return Object.freeze({ steps: Object.freeze(steps) });
}

function appendStep(recipe: Recipe, step: RecipeStep): Recipe
{
    return freezeRecipe([...recipe.steps, step]);
}

function bakedRecipe(reason: string, prior?: Recipe | null): Recipe
{
    return appendStep(prior ?? freezeRecipe([]), { op: 'baked', reason });
}

//// 2. AFFINE MATH ////

/** Row-major 3x4 affine matrix: [a b c tx | d e f ty | g h i tz]. Columns 0..2 of the linear
 *  part are the images of the local x, y and z axes. */
export type Affine = readonly number[]

export const IDENTITY: Affine = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

/** A after B: apply B first. */
export function affineCompose(A: Affine, B: Affine): Affine
{
    const r: number[] = new Array(12);
    for (let i = 0; i < 3; i++)
    {
        const a0 = A[i * 4], a1 = A[i * 4 + 1], a2 = A[i * 4 + 2];
        r[i * 4] = a0 * B[0] + a1 * B[4] + a2 * B[8];
        r[i * 4 + 1] = a0 * B[1] + a1 * B[5] + a2 * B[9];
        r[i * 4 + 2] = a0 * B[2] + a1 * B[6] + a2 * B[10];
        r[i * 4 + 3] = a0 * B[3] + a1 * B[7] + a2 * B[11] + A[i * 4 + 3];
    }
    return r;
}

export function affineApply(A: Affine, p: Vec3): Vec3
{
    return [
        A[0] * p[0] + A[1] * p[1] + A[2] * p[2] + A[3],
        A[4] * p[0] + A[5] * p[1] + A[6] * p[2] + A[7],
        A[8] * p[0] + A[9] * p[1] + A[10] * p[2] + A[11],
    ];
}

export function affineDeterminant(A: Affine): number
{
    return A[0] * (A[5] * A[10] - A[6] * A[9])
         - A[1] * (A[4] * A[10] - A[6] * A[8])
         + A[2] * (A[4] * A[9] - A[5] * A[8]);
}

/** Inverse, or null for a singular matrix (a zero scale). */
export function affineInverse(A: Affine): Affine | null
{
    const det = affineDeterminant(A);
    if (Math.abs(det) < 1e-300) return null;
    const [a, b, c, , d, e, f, , g, h, i] = A;
    const inv = [
        (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
        (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
        (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
    ];
    const t: Vec3 = [A[3], A[7], A[11]];
    return [
        inv[0], inv[1], inv[2], -(inv[0] * t[0] + inv[1] * t[1] + inv[2] * t[2]),
        inv[3], inv[4], inv[5], -(inv[3] * t[0] + inv[4] * t[1] + inv[5] * t[2]),
        inv[6], inv[7], inv[8], -(inv[6] * t[0] + inv[7] * t[1] + inv[8] * t[2]),
    ];
}

export function translationMatrix(v: Vec3): Affine
{
    return [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2]];
}

/** Rotation by `angleDeg` (right-handed) around a unit `axis` through `pivot` (Rodrigues). */
export function rotationMatrix(angleDeg: number, axis: Vec3, pivot: Vec3 = [0, 0, 0]): Affine
{
    const [x, y, z] = normalize(axis);
    const a = angleDeg * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    const L = [
        c + x * x * t, x * y * t - z * s, x * z * t + y * s,
        y * x * t + z * s, c + y * y * t, y * z * t - x * s,
        z * x * t - y * s, z * y * t + x * s, c + z * z * t,
    ];
    return linearAbout(L, pivot);
}

export function scaleMatrix(f: Vec3, origin: Vec3 = [0, 0, 0]): Affine
{
    return linearAbout([f[0], 0, 0, 0, f[1], 0, 0, 0, f[2]], origin);
}

/** Reflection across the plane with unit `normal` through `origin`. */
export function mirrorMatrix(normal: Vec3, origin: Vec3 = [0, 0, 0]): Affine
{
    const [x, y, z] = normalize(normal);
    const L = [
        1 - 2 * x * x, -2 * x * y, -2 * x * z,
        -2 * y * x, 1 - 2 * y * y, -2 * y * z,
        -2 * z * x, -2 * z * y, 1 - 2 * z * z,
    ];
    return linearAbout(L, origin);
}

/** x' = L (x - p) + p, for a row-major 3x3 L. */
function linearAbout(L: number[], p: Vec3): Affine
{
    const Lp = [
        L[0] * p[0] + L[1] * p[1] + L[2] * p[2],
        L[3] * p[0] + L[4] * p[1] + L[5] * p[2],
        L[6] * p[0] + L[7] * p[1] + L[8] * p[2],
    ];
    return [
        L[0], L[1], L[2], p[0] - Lp[0],
        L[3], L[4], L[5], p[1] - Lp[1],
        L[6], L[7], L[8], p[2] - Lp[2],
    ];
}

export function stepMatrix(step: TransformStep): Affine
{
    switch (step.op)
    {
        case 'translate': return translationMatrix(step.v);
        case 'rotate': return rotationMatrix(step.angle, step.axis, step.pivot);
        case 'scale': return scaleMatrix(step.f, step.origin);
        case 'mirror': return mirrorMatrix(step.normal, step.origin);
    }
}

/** The matrix read as a local frame: where the local axes point, how long they are, and whether
 *  they are still perpendicular. A frame that is `orthogonal` is a rotation (possibly mirrored,
 *  `handedness` -1) times a per-axis scale, which is what every primitive can absorb into its
 *  own dimensions. */
export interface AffineFrame
{
    origin: Vec3
    axes: [Vec3, Vec3, Vec3]            // unit images of local x, y, z
    scales: Vec3                         // lengths of those images
    orthogonal: boolean
    handedness: 1 | -1
}

export function affineFrame(A: Affine, tolerance = 1e-9): AffineFrame
{
    const cols: [Vec3, Vec3, Vec3] = [[A[0], A[4], A[8]], [A[1], A[5], A[9]], [A[2], A[6], A[10]]];
    const scales = cols.map(length) as unknown as Vec3;
    const axes = cols.map(normalize) as [Vec3, Vec3, Vec3];
    const orthogonal = Math.abs(dot(axes[0], axes[1])) < tolerance
                    && Math.abs(dot(axes[0], axes[2])) < tolerance
                    && Math.abs(dot(axes[1], axes[2])) < tolerance;
    return {
        origin: [A[3], A[7], A[11]],
        axes,
        scales,
        orthogonal,
        handedness: affineDeterminant(A) < 0 ? -1 : 1,
    };
}

/** Unit quaternion [w, x, y, z] of a proper rotation given by three orthonormal axes. */
export function axesToQuaternion(axes: readonly [Vec3, Vec3, Vec3]): [number, number, number, number]
{
    // Row-major R with the axes as columns
    const m00 = axes[0][0], m01 = axes[1][0], m02 = axes[2][0];
    const m10 = axes[0][1], m11 = axes[1][1], m12 = axes[2][1];
    const m20 = axes[0][2], m21 = axes[1][2], m22 = axes[2][2];
    const trace = m00 + m11 + m22;
    let w: number, x: number, y: number, z: number;
    if (trace > 0)
    {
        const s = 0.5 / Math.sqrt(trace + 1);
        w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
    }
    else if (m00 > m11 && m00 > m22)
    {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
    }
    else if (m11 > m22)
    {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
    }
    else
    {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
        w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
    }
    const n = Math.hypot(w, x, y, z) || 1;
    return [w / n, x / n, y / n, z / n];
}

function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: Vec3): Vec3
{
    const l = length(a);
    return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

//// 3. CAPTURE TABLE ////

/** What a row does when its kernel method is called during a recording run.
 *
 *  - `leaf`     a constructor. Returns the primitive in its canonical local frame; the recorder
 *               adds a `translate` if the kernel placed it elsewhere (measured, so a change in
 *               meshup's conventions shows up as an extra step rather than a wrong recipe).
 *  - `step`     an in-place op on `self`. Called BEFORE the kernel runs, so defaults that depend
 *               on the current geometry (a pivot at the centre) are read from the pre-state.
 *               Return PASS_THROUGH to record nothing here and let the rows it calls record.
 *  - `measuredTranslate`  an in-place pure translation whose amount is easiest to read off the
 *               bbox before and after (moveToCenter, place).
 *  - `copy`     the result is a clone of `self` and shares its recipe.
 *
 *  `nested` lets rows called from inside this one record too. Leave it off unless the row records
 *  only part of what the method does (rotateQuaternion records the rotation; the re-centring
 *  moveTo inside it records itself). */
export interface OpRow
{
    on: (k: typeof meshup) => [owner: object, method: string]
    leaf?: (args: any[]) => { step: LeafStep; canonicalCenter: Vec3 }
    step?: (self: any, args: any[], k: typeof meshup) => RecipeStep | typeof PASS_THROUGH
    measuredTranslate?: true
    copy?: true
    nested?: true
}

export const PASS_THROUGH = Symbol('recipe.passThrough');

const AXIS_VECTORS: Record<string, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

const vec = (p: any): Vec3 => [p.x, p.y, p.z];
const axisOf = (axis: any, k: typeof meshup): Vec3 =>
    normalize(typeof axis === 'string' ? AXIS_VECTORS[axis] : vec(k.Point.from(axis)));

/** Recipe of a boolean operand, or a baked stand-in when it was not recorded. */
function toolRecipe(tool: any): Recipe
{
    return recipeOf(tool) ?? bakedRecipe('tool was not recorded');
}

/** The meshup capture table. Every other public Mesh method is watched (section 4): it either
 *  composes these rows (move, moveTo, rotateX, align, alignByPoints, replicate...) or it changes
 *  the geometry unrecorded and kills the recipe with its own name as the reason. */
export const MESH_OPS: Readonly<Record<string, OpRow>> = {

    //// leaves: Box, Cube and Modeler.box() all end up in Cuboid or Cube ////

    'Mesh.Cuboid': {
        on: k => [k.Mesh, 'Cuboid'],
        leaf: ([w, d, h]) => ({ step: { op: 'box', size: [w, d ?? w, h ?? w] }, canonicalCenter: [0, 0, 0] }),
    },
    'Mesh.Cube': {
        on: k => [k.Mesh, 'Cube'],
        leaf: ([size]) => ({ step: { op: 'box', size: [size, size, size] }, canonicalCenter: [0, 0, 0] }),
    },
    'Mesh.Cylinder': {
        on: k => [k.Mesh, 'Cylinder'],
        leaf: ([radius, height]) => ({ step: { op: 'cylinder', radius, height }, canonicalCenter: [0, 0, height / 2] }),
    },
    'Mesh.Sphere': {
        on: k => [k.Mesh, 'Sphere'],
        leaf: ([radius]) => ({ step: { op: 'sphere', radius }, canonicalCenter: [0, 0, 0] }),
    },

    //// in-place transforms ////

    'Mesh.translate': {
        on: k => [k.Mesh.prototype, 'translate'],
        step: (_self, [px, dy, dz], k) =>
        {
            const p = (typeof dy === 'number' && (typeof dz === 'number' || dz === undefined))
                ? k.Point.from(px, dy || 0, dz || 0)
                : k.Point.from(px);
            return { op: 'translate', v: vec(p) };
        },
    },
    'Mesh.rotate': {   // around an axis through the world origin
        on: k => [k.Mesh.prototype, 'rotate'],
        step: (_self, [angle, axis = 'z'], k) => ({ op: 'rotate', angle, axis: axisOf(axis, k), pivot: [0, 0, 0] }),
    },
    'Mesh.rotateAround': {   // pivot defaults to the centre of mass
        on: k => [k.Mesh.prototype, 'rotateAround'],
        step: (self, [angle, axis = 'z', pivot], k) => ({
            op: 'rotate', angle, axis: axisOf(axis, k), pivot: pivot ? vec(k.Point.from(pivot)) : vec(self.center()),
        }),
    },
    'Mesh.rotateQuaternion': {   // rotates about the origin, then the moveTo inside records the re-centring
        on: k => [k.Mesh.prototype, 'rotateQuaternion'],
        nested: true,
        step: (_self, [wOrObj, x, y, z]) =>
        {
            const q = typeof wOrObj === 'object'
                ? [wOrObj.w, wOrObj.x, wOrObj.y, wOrObj.z]
                : [wOrObj, x ?? 0, y ?? 0, z ?? 0];
            const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
            const [w, qx, qy, qz] = q.map(c => c / n);
            const s = Math.sqrt(Math.max(0, 1 - w * w));
            const angle = 2 * Math.acos(Math.max(-1, Math.min(1, w))) * 180 / Math.PI;
            const axis: Vec3 = s < 1e-12 ? [0, 0, 1] : [qx / s, qy / s, qz / s];
            return { op: 'rotate', angle, axis, pivot: [0, 0, 0] };
        },
    },
    'Mesh.scale': {   // origin defaults to the centre of mass
        on: k => [k.Mesh.prototype, 'scale'],
        step: (self, [factor, origin], k) =>
        {
            const f: Vec3 = typeof factor === 'number' ? [factor, factor, factor] : vec(k.Point.from(factor));
            return { op: 'scale', f, origin: origin ? vec(k.Point.from(origin)) : vec(self.center()) };
        },
    },
    'Mesh.mirror': {   // mirrors meshup's own plane resolution, Mesh.mirror()
        on: k => [k.Mesh.prototype, 'mirror'],
        step: (self, [dir, pos], k) =>
        {
            const isAxis = typeof dir === 'string';
            const raw: Vec3 = isAxis ? AXIS_VECTORS[dir] : vec(k.Point.from(dir));
            const normal = normalize(raw);
            let origin: Vec3;
            if (length(raw) - 1 > k.TOLERANCE && pos === undefined) origin = raw;   // vector encodes the position
            else if (pos) origin = (isAxis && typeof pos === 'number')
                ? [dir === 'x' ? pos : 0, dir === 'y' ? pos : 0, dir === 'z' ? pos : 0]
                : vec(k.Point.from(pos));
            else origin = vec(self.center());
            return { op: 'mirror', normal, origin };
        },
    },
    'Mesh.moveToCenter': { on: k => [k.Mesh.prototype, 'moveToCenter'], measuredTranslate: true },
    'Mesh.place': { on: k => [k.Mesh.prototype, 'place'], measuredTranslate: true },

    //// booleans: difference(), subtract(), add(), intersect() and intersection() all end up here ////

    'Mesh.union': {
        on: k => [k.Mesh.prototype, 'union'],
        step: (self, [other], k) => (other instanceof k.Mesh && other !== self)
            ? { op: 'fuse', tools: [toolRecipe(other)] }
            : PASS_THROUGH,
    },
    'Mesh._difference': {   // a collection recurses into one call per mesh, each recording itself
        on: k => [k.Mesh.prototype, '_difference'],
        step: (self, [other], k) => (other instanceof k.Mesh && other !== self)
            ? { op: 'cut', tools: [toolRecipe(other)] }
            : PASS_THROUGH,
    },
    'Mesh._intersection': {
        on: k => [k.Mesh.prototype, '_intersection'],
        step: (self, [other], k) => (other instanceof k.Mesh && other !== self)
            ? { op: 'common', tools: [toolRecipe(other)] }
            : PASS_THROUGH,
    },

    //// copies: copy(), replicate(), row(), grid(), array() and intersection() clone through _copy ////

    'Mesh._copy': { on: k => [k.Mesh.prototype, '_copy'], copy: true },
};

/** Methods not worth watching: pure queries on hot paths, and the kernel's own plumbing. */
const WATCH_SKIP: ReadonlySet<string> = new Set([
    'constructor', 'inner', 'update', 'from', 'bbox', 'center', 'volume', 'area', 'size',
    'positions', 'vertices', 'polygons', '_positionsIter', '_normalsIter', 'normals',
    'name', 'id', 'sid', 'setId', '_inheritSid', 'node', 'nodeString', 'subtype', 'toString',
    'is2D', 'is3D', 'isShapeClass', 'isSolid', 'isCurve', 'validate',
    'color', 'alpha', 'opacity', 'strokeWidth', 'wireframe', 'hide', 'show', 'resetStyle',
    'addMetaData', 'setMetaData', 'annotations', 'addAnnotations', 'tmp', 'dispose',
    'addToScene', 'removeFromScene',
]);

//// 4. RECORDER ////

interface RecipeState
{
    recipe: Recipe
    fingerprint: unknown
}

/** Per-shape state lives on the shape itself, under a non-enumerable symbol: it never shows up
 *  in metadata, serialisation or spreads, and a clone is a new object without it. */
const STATE = Symbol.for('archiyou.recipe.state');

function stateOf(shape: any): RecipeState | undefined
{
    return (shape && typeof shape === 'object') ? shape[STATE] : undefined;
}

function fingerprintOf(shape: any): unknown
{
    return shape?._mesh ?? shape?._ocShape;
}

function setRecipe(shape: any, recipe: Recipe): void
{
    Object.defineProperty(shape, STATE, {
        value: { recipe, fingerprint: fingerprintOf(shape) } as RecipeState,
        configurable: true, writable: true, enumerable: false,
    });
}

function isMesh(o: unknown, k: typeof meshup): o is meshup.Mesh { return o instanceof k.Mesh; }

let recording = false;
let installed: { kernel: typeof meshup; restore: Array<() => void> } | null = null;
/** Row frames currently executing. A row records only when no frame is open, or the innermost
 *  open frame is `nested`. */
const frames: Array<{ nested: boolean; shape: unknown }> = [];
let watchDepth = 0;

function canRecord(): boolean
{
    return frames.length === 0 || frames[frames.length - 1].nested;
}

/** Inside a nested row the parent has already changed the geometry but not yet recorded its
 *  step, so its rows must not read that as an unrecorded change. */
function parentIsRecording(shape: unknown): boolean
{
    return frames.some(f => f.nested && f.shape === shape);
}

function inFrame<T>(nested: boolean, fn: () => T, shape: unknown = null): T
{
    frames.push({ nested, shape });
    try { return fn(); }
    finally { frames.pop(); }
}

/** Recipe of a shape, or null when it was never recorded. A recipe whose shape has changed since
 *  its last recorded op comes back baked, so callers never see a stale description. */
export function recipeOf(shape: any): Recipe | null
{
    const state = stateOf(shape);
    if (!state) return null;
    if (isRecipeLive(state.recipe) && state.fingerprint !== fingerprintOf(shape))
    {
        return bakedRecipe('changed by an unrecorded operation', state.recipe);
    }
    return state.recipe;
}

export function isRecipeRecording(): boolean
{
    return recording && !!installed;
}

/** Turn recording on or off. Off costs one boolean check per watched call. */
export function setRecipeRecording(on: boolean): void
{
    recording = on;
}

/** Patch the kernel so recording can be switched on. Idempotent. Returns the names of rows whose
 *  method no longer exists on the kernel, which means meshup renamed something the table relies
 *  on; the recipe test fails on a non-empty list. */
export function installRecipeRecorder(kernel: typeof meshup = meshup): { missingRows: string[] }
{
    if (installed) return { missingRows: [] };
    const k = kernel;
    const restore: Array<() => void> = [];
    const missingRows: string[] = [];
    const rowTargets = new Map<object, Set<string>>();

    const patch = (owner: any, method: string, make: (orig: Function) => Function) =>
    {
        const hadOwn = Object.prototype.hasOwnProperty.call(owner, method);
        const previous = Object.getOwnPropertyDescriptor(owner, method);
        const orig = owner[method];
        Object.defineProperty(owner, method, {
            value: make(orig), configurable: true, writable: true, enumerable: previous?.enumerable ?? false,
        });
        restore.push(() =>
        {
            if (hadOwn && previous) Object.defineProperty(owner, method, previous);
            else delete owner[method];
        });
    };

    for (const [label, row] of Object.entries(MESH_OPS))
    {
        const [owner, method] = row.on(k);
        if (typeof (owner as any)[method] !== 'function') { missingRows.push(label); continue; }
        if (!rowTargets.has(owner)) rowTargets.set(owner, new Set());
        rowTargets.get(owner)!.add(method);
        patch(owner, method, orig => wrapRow(label, row, orig, k));
    }

    // Watch every other method, on the prototype chain (installed as own methods on Mesh, so
    // Curve and Polygon, which share Shape, are untouched) and on the class itself.
    const watched = new Set<string>();
    for (let proto = k.Mesh.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto))
    {
        for (const method of Object.getOwnPropertyNames(proto))
        {
            if (watched.has(method) || WATCH_SKIP.has(method) || rowTargets.get(k.Mesh.prototype)?.has(method)) continue;
            if (typeof Object.getOwnPropertyDescriptor(proto, method)?.value !== 'function') continue;
            watched.add(method);
            patch(k.Mesh.prototype, method, orig => wrapWatch(`${method}`, orig, k));
        }
    }
    for (const method of Object.getOwnPropertyNames(k.Mesh))
    {
        if (WATCH_SKIP.has(method) || rowTargets.get(k.Mesh)?.has(method)) continue;
        if (typeof Object.getOwnPropertyDescriptor(k.Mesh, method)?.value !== 'function') continue;
        patch(k.Mesh, method, orig => wrapWatch(`Mesh.${method}`, orig, k));
    }

    installed = { kernel: k, restore };
    return { missingRows };
}

/** Remove every patch. Recipes already recorded stay on their shapes. */
export function uninstallRecipeRecorder(): void
{
    if (!installed) return;
    installed.restore.reverse().forEach(undo => undo());
    installed = null;
    recording = false;
}

function wrapRow(label: string, row: OpRow, orig: Function, k: typeof meshup): Function
{
    return function recorded(this: any, ...args: any[])
    {
        if (!recording || !canRecord()) return orig.apply(this, args);

        if (row.leaf)
        {
            const result = inFrame(false, () => orig.apply(this, args));
            if (!isMesh(result, k)) return result;
            const { step, canonicalCenter } = row.leaf(args);
            const steps: RecipeStep[] = [step];
            const center = bboxCenter(result);
            if (center)
            {
                const offset = sub(center, canonicalCenter);
                if (length(offset) > 1e-9 * Math.max(1, length(center))) steps.push({ op: 'translate', v: offset });
            }
            setRecipe(result, freezeRecipe(steps));
            return result;
        }

        const state = stateOf(this);

        if (row.copy)
        {
            const result = inFrame(false, () => orig.apply(this, args));
            const recipe = recipeOf(this);
            if (recipe && result && typeof result === 'object') setRecipe(result, recipe);
            return result;
        }

        // An untracked shape has nothing to extend; a dead recipe stops growing
        if (!state || !isRecipeLive(state.recipe))
        {
            const result = orig.apply(this, args);
            if (state) state.fingerprint = fingerprintOf(this);
            return result;
        }
        if (state.fingerprint !== fingerprintOf(this) && !parentIsRecording(this))
        {
            setRecipe(this, bakedRecipe('changed by an unrecorded operation', state.recipe));
            return orig.apply(this, args);
        }

        let step: RecipeStep | typeof PASS_THROUGH | null = null;
        let readError: unknown = null;
        let before: Vec3 | undefined;
        try
        {
            if (row.measuredTranslate) before = bboxCenter(this);
            else if (row.step) step = row.step(this, args, k);
        }
        catch (e) { readError = e; }

        if (step === PASS_THROUGH) return orig.apply(this, args);

        const result = inFrame(!!row.nested, () => orig.apply(this, args), this);

        // Nested rows may have appended steps meanwhile: build on the state as it is now,
        // but put this row's own step before theirs (it happened first).
        const now = stateOf(this) ?? state;
        if (!isRecipeLive(now.recipe)) return result;

        if (readError)
        {
            setRecipe(this, bakedRecipe(`could not read the arguments of ${label}(): ${String(readError)}`, state.recipe));
            return result;
        }
        if (row.measuredTranslate)
        {
            const after = bboxCenter(this);
            if (!before || !after)
            {
                setRecipe(this, bakedRecipe(`${label}() on a shape without a bounding box`, state.recipe));
                return result;
            }
            step = { op: 'translate', v: sub(after, before) };
        }

        const nestedSteps = now.recipe.steps.slice(state.recipe.steps.length);
        setRecipe(this, freezeRecipe([...state.recipe.steps, step as RecipeStep, ...nestedSteps]));
        return result;
    };
}

function wrapWatch(label: string, orig: Function, k: typeof meshup): Function
{
    return function watched(this: any, ...args: any[])
    {
        if (!recording || frames.length > 0 || watchDepth > 0) return orig.apply(this, args);

        watchDepth++;
        let result: any;
        try { result = orig.apply(this, args); }
        finally { watchDepth--; }

        const self = isMesh(this, k) ? this : null;
        const selfState = stateOf(self);
        if (self && selfState && isRecipeLive(selfState.recipe) && selfState.fingerprint !== fingerprintOf(self))
        {
            setRecipe(self, bakedRecipe(`${label}() is not recorded`, selfState.recipe));
        }

        // New meshes that came out without a recipe of their own: say where they came from
        const source = self ? recipeOf(self) : null;
        for (const mesh of meshesIn(result, k))
        {
            if (mesh === self || stateOf(mesh)) continue;
            setRecipe(mesh, bakedRecipe(`made by ${label}()`, isRecipeLive(source) ? source : null));
        }
        return result;
    };
}

function meshesIn(value: any, k: typeof meshup): meshup.Mesh[]
{
    if (isMesh(value, k)) return [value];
    if (k.ShapeCollection.isShapeCollection(value)) return value.toArray().filter((s: unknown) => isMesh(s, k)) as meshup.Mesh[];
    if (Array.isArray(value)) return value.filter(s => isMesh(s, k));
    return [];
}

function bboxCenter(shape: any): Vec3 | undefined
{
    const bbox = shape?.bbox?.();
    return bbox ? vec(bbox.center()) : undefined;
}

//// 5. RESOLVE + VERIFY ////

/** Resolve a recipe into the tree exporters map. Transforms are pushed down to the leaves, which
 *  is exact for every transform we record (they are all bijective affine maps), and consecutive
 *  booleans of the same kind merge into one node with several tools. */
export function resolveRecipe(recipe: Recipe): RecipeNode
{
    let node: RecipeNode | null = null;
    for (const step of recipe.steps)
    {
        if (step.op === 'baked') return { kind: 'baked', reason: step.reason };
        if (isLeafStep(step))
        {
            if (node) return { kind: 'baked', reason: `a second primitive (${step.op}) inside one recipe` };
            node = { kind: 'leaf', step, matrix: IDENTITY };
            continue;
        }
        if (!node) return { kind: 'baked', reason: `recipe starts with ${step.op} instead of a primitive` };
        if (isTransformStep(step))
        {
            node = transformNode(node, stepMatrix(step));
            continue;
        }
        const tools = step.tools.map(resolveRecipe);
        node = (node.kind === 'boolean' && node.op === step.op)
            ? { ...node, tools: [...node.tools, ...tools] }
            : { kind: 'boolean', op: step.op, base: node, tools };
    }
    return node ?? { kind: 'baked', reason: 'empty recipe' };
}

function transformNode(node: RecipeNode, M: Affine): RecipeNode
{
    switch (node.kind)
    {
        case 'leaf': return { ...node, matrix: affineCompose(M, node.matrix) };
        case 'boolean': return { ...node, base: transformNode(node.base, M), tools: node.tools.map(t => transformNode(t, M)) };
        case 'baked': return node;
    }
}

export interface Bounds { min: Vec3; max: Vec3 }

/** World bounds of a node: exact for a leaf, an upper bound for a boolean. */
export function nodeBounds(node: RecipeNode): Bounds | null
{
    switch (node.kind)
    {
        case 'baked': return null;
        case 'leaf': return leafBounds(node);
        case 'boolean':
        {
            const base = nodeBounds(node.base);
            if (!base) return null;
            if (node.op === 'cut') return base;
            const tools = node.tools.map(nodeBounds);
            if (tools.some(t => !t)) return node.op === 'common' ? base : null;
            return (tools as Bounds[]).reduce((acc, t) => node.op === 'fuse'
                ? { min: [0, 1, 2].map(i => Math.min(acc.min[i], t.min[i])) as unknown as Vec3, max: [0, 1, 2].map(i => Math.max(acc.max[i], t.max[i])) as unknown as Vec3 }
                : { min: [0, 1, 2].map(i => Math.max(acc.min[i], t.min[i])) as unknown as Vec3, max: [0, 1, 2].map(i => Math.min(acc.max[i], t.max[i])) as unknown as Vec3 }, base);
        }
    }
}

function leafBounds(node: LeafNode): Bounds
{
    const M = node.matrix;
    const rowNorm2 = (i: number, cols: number[]) => cols.reduce((s, c) => s + M[i * 4 + c] ** 2, 0);
    const disk = (center: Vec3, r: number): Bounds =>
    {
        const h = [0, 1, 2].map(i => r * Math.sqrt(rowNorm2(i, [0, 1])));
        return { min: [center[0] - h[0], center[1] - h[1], center[2] - h[2]], max: [center[0] + h[0], center[1] + h[1], center[2] + h[2]] };
    };
    const merge = (a: Bounds, b: Bounds): Bounds => ({
        min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
        max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    });
    const step = node.step;
    switch (step.op)
    {
        case 'box':
        {
            const [w, d, h] = step.size.map(s => s / 2);
            const corners: Vec3[] = [];
            for (const x of [-w, w]) for (const y of [-d, d]) for (const z of [-h, h]) corners.push(affineApply(M, [x, y, z]));
            return corners.reduce<Bounds>((b, c) => merge(b, { min: c, max: c }), { min: corners[0], max: corners[0] });
        }
        case 'sphere':
        {
            const c = affineApply(M, [0, 0, 0]);
            const h = [0, 1, 2].map(i => step.radius * Math.sqrt(rowNorm2(i, [0, 1, 2])));
            return { min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]] };
        }
        case 'cylinder':
            return merge(disk(affineApply(M, [0, 0, 0]), step.radius), disk(affineApply(M, [0, 0, step.height]), step.radius));
        case 'cone':
            return merge(disk(affineApply(M, [0, 0, 0]), step.r1), disk(affineApply(M, [0, 0, step.height]), step.r2));
    }
}

export interface RecipeVerification
{
    ok: boolean
    /** What was compared, for explain and the report */
    checked: string
    reason?: string
}

/** Cross-check a recipe against the shape's actual geometry. A leaf must match the mesh bounds
 *  within the tessellation's chord error; a boolean must contain them. This catches recorder bugs
 *  (a wrong pivot, a flipped rotation) rather than user mistakes, so a failure means the exporter
 *  should bake and someone should look at the capture table. */
export function verifyRecipe(shape: any, recipe: Recipe | null = recipeOf(shape)): RecipeVerification
{
    if (!recipe) return { ok: false, checked: 'nothing', reason: 'shape has no recipe' };
    const node = resolveRecipe(recipe);
    if (node.kind === 'baked') return { ok: true, checked: 'nothing (baked)' };

    const expected = nodeBounds(node);
    const bbox = shape?.bbox?.();
    if (!expected || !bbox) return { ok: true, checked: 'nothing (no bounds)' };
    const actual: Bounds = { min: vec(bbox.min()), max: vec(bbox.max()) };

    const span = length(sub(expected.max, expected.min));
    const eps = 1e-6 * Math.max(1, span);
    const chord = chordTolerance(node) + eps;

    for (let i = 0; i < 3; i++)
    {
        // The mesh never pokes out of the analytic shape...
        if (actual.min[i] < expected.min[i] - eps || actual.max[i] > expected.max[i] + eps)
        {
            return { ok: false, checked: 'bounds', reason: `mesh extends past the recipe along ${'xyz'[i]}: mesh [${fmt(actual.min[i])}, ${fmt(actual.max[i])}] vs recipe [${fmt(expected.min[i])}, ${fmt(expected.max[i])}]` };
        }
        // ...and a lone primitive fills it, up to the facets cutting corners off curved surfaces
        if (node.kind === 'leaf' && (actual.min[i] > expected.min[i] + chord || actual.max[i] < expected.max[i] - chord))
        {
            return { ok: false, checked: 'bounds', reason: `mesh is smaller than the recipe along ${'xyz'[i]}: mesh [${fmt(actual.min[i])}, ${fmt(actual.max[i])}] vs recipe [${fmt(expected.min[i])}, ${fmt(expected.max[i])}]` };
        }
    }
    return { ok: true, checked: node.kind === 'leaf' ? 'bounds (exact)' : 'bounds (contained)' };
}

function chordTolerance(node: RecipeNode): number
{
    if (node.kind !== 'leaf' || node.step.op === 'box') return 0;
    const quality: any = (meshup as any).getQuality?.() ?? {};
    const segments = Math.max(3, Math.min(quality.cylinderSegmentsRadial ?? 16, quality.sphereSegmentsWidth ?? 16, quality.sphereSegmentsHeight ?? 16));
    const scale = Math.max(...affineFrame(node.matrix).scales);
    const radius = node.step.op === 'cone' ? Math.max(node.step.r1, node.step.r2) : node.step.radius;
    // Between rings a sphere's facets also sag inwards, so allow two chord depths
    return 2 * radius * scale * (1 - Math.cos(Math.PI / segments));
}

//// 6. MATCH HELPERS ////

/** Every leaf of a tree, depth first, base before tools. */
export function leafNodes(node: RecipeNode): LeafNode[]
{
    switch (node.kind)
    {
        case 'leaf': return [node];
        case 'boolean': return [...leafNodes(node.base), ...node.tools.flatMap(leafNodes)];
        case 'baked': return [];
    }
}

export interface Cuboid
{
    /** Edge lengths along the local axes, after scaling */
    size: Vec3
    /** Centre and right-handed unit axes (a mirrored box is the same box with one axis flipped) */
    center: Vec3
    axes: [Vec3, Vec3, Vec3]
}

/** A box leaf whose frame is still rectangular: any rotation, mirror and axis-aligned scale. */
export function asCuboid(node: RecipeNode): Cuboid | null
{
    if (node.kind !== 'leaf' || node.step.op !== 'box') return null;
    const frame = affineFrame(node.matrix);
    if (!frame.orthogonal || frame.scales.some(s => s < 1e-12)) return null;
    const axes: [Vec3, Vec3, Vec3] = [frame.axes[0], frame.axes[1], frame.axes[2]];
    if (frame.handedness < 0) axes[0] = [-axes[0][0], -axes[0][1], -axes[0][2]];
    const size = node.step.size;
    return {
        size: [size[0] * frame.scales[0], size[1] * frame.scales[1], size[2] * frame.scales[2]],
        center: frame.origin,
        axes,
    };
}

//// 7. CLASSIFICATION ////

export interface Classification
{
    /** Namespaced tag, 'ifc:slab' or 'btlx:sawCut' */
    tag: string
    origin: 'explicit' | 'derived'
    params: Record<string, unknown>
    /** One human sentence on why, shown by explain and in the report */
    evidence: string
    rule?: string
}

/** A rule that gives a node a meaning. `on` names the node kinds it looks at ('shape' is the root,
 *  whatever its kind). `derive` computes the format-facing parameters once, from the same
 *  evidence, so a mapping row only formats what it is handed. */
export interface ClassificationRule<Ctx = unknown>
{
    tag: string
    rule: string
    on?: 'shape' | NodeKey | ReadonlyArray<'shape' | NodeKey>
    when: (node: RecipeNode, shape: any, ctx: Ctx) => boolean
    derive?: (node: RecipeNode, shape: any, ctx: Ctx) => Record<string, unknown>
    evidence?: (node: RecipeNode, shape: any, ctx: Ctx) => string
}

export type Classifications = Map<RecipeNode, Classification[]>

/** Run rules over a resolved tree. Rules run in table order and the first match per namespace
 *  wins, so specific rules go above general ones. Explicit classifications (from `.is()` or a
 *  joinery operation) are attached to the root and switch off the rules of their namespace. */
export function classify<Ctx>(
    root: RecipeNode,
    shape: any,
    rules: ReadonlyArray<ClassificationRule<Ctx>>,
    ctx: Ctx,
    explicit: ReadonlyArray<Omit<Classification, 'origin'>> = [],
): Classifications
{
    const result: Classifications = new Map();
    const add = (node: RecipeNode, c: Classification) =>
    {
        if (!result.has(node)) result.set(node, []);
        result.get(node)!.push(c);
    };
    const explicitNamespaces = new Set(explicit.map(c => namespaceOf(c.tag)));
    explicit.forEach(c => add(root, { ...c, origin: 'explicit' }));

    const visit = (node: RecipeNode, isRoot: boolean) =>
    {
        const taken = new Set<string>();
        for (const rule of rules)
        {
            const ns = namespaceOf(rule.tag);
            if (taken.has(ns) || (isRoot && explicitNamespaces.has(ns))) continue;
            const targets = rule.on === undefined ? ['shape'] : ([] as Array<'shape' | NodeKey>).concat(rule.on);
            const applies = targets.some(t => (t === 'shape' && isRoot) || t === nodeKey(node));
            if (!applies || !rule.when(node, shape, ctx)) continue;
            add(node, {
                tag: rule.tag,
                origin: 'derived',
                rule: rule.rule,
                params: rule.derive?.(node, shape, ctx) ?? {},
                evidence: rule.evidence?.(node, shape, ctx) ?? rule.rule,
            });
            taken.add(ns);
        }
        if (node.kind === 'boolean') [node.base, ...node.tools].forEach(child => visit(child, false));
    };
    visit(root, true);
    return result;
}

function namespaceOf(tag: string): string
{
    const i = tag.indexOf(':');
    return i < 0 ? '' : tag.slice(0, i);
}

//// 8. MAPPING ////

export interface MapContext<Out>
{
    readonly subject: string
    /** Map a child node through the same table */
    map(node: RecipeNode): Out
    /** Give up on the procedural form. The whole shape falls back to the exporter's baked form. */
    bake(reason: string): never
    /** Record a decision worth reading in the report ("mirror folded into rotation") */
    note(message: string): void
    classificationsOf(node: RecipeNode): readonly Classification[]
}

export type MappingRow<Out> = (node: any, ctx: MapContext<Out>, classification?: Classification) => Out

/** One exporter's answer per node kind or tag. Lookup order for a node: a row for one of its
 *  tags, then a row for its kind, then '*', then bake. A missing 'baked' row bakes. */
export type RecipeMapping<Out> = Partial<Record<NodeKey | '*' | `${string}:${string}`, MappingRow<Out>>>

class RecipeBake extends Error
{
    constructor(readonly reason: string) { super(reason); }
}

export interface RecipeReportEntry
{
    subject: string
    status: 'mapped' | 'baked'
    reason?: string
    notes: string[]
    tags: string[]
}

/** What an export did with every shape, and why. Printed for the user and embedded in the file. */
export class RecipeReport
{
    readonly entries: RecipeReportEntry[] = [];

    add(entry: RecipeReportEntry): void { this.entries.push(entry); }

    get mapped(): number { return this.entries.filter(e => e.status === 'mapped').length; }
    get baked(): number { return this.entries.filter(e => e.status === 'baked').length; }

    summary(): string
    {
        return `${this.mapped} of ${this.entries.length} shapes exported procedurally, ${this.baked} baked`;
    }

    toString(): string
    {
        const lines = [this.summary()];
        for (const e of this.entries)
        {
            const tags = e.tags.length ? ` [${e.tags.join(', ')}]` : '';
            lines.push(`  ${e.status === 'mapped' ? '✓' : '·'} ${e.subject}${tags}${e.reason ? `: ${e.reason}` : ''}`);
            e.notes.forEach(n => lines.push(`      ${n}`));
        }
        return lines.join('\n');
    }

    toJSON(): { summary: string; entries: RecipeReportEntry[] }
    {
        return { summary: this.summary(), entries: this.entries };
    }
}

export interface MapRecipeOptions<Out>
{
    subject: string
    /** The exporter's baked form of the whole shape */
    fallback: (reason: string) => Out
    classifications?: Classifications
    report?: RecipeReport
}

/** Map a recipe (or an already resolved tree) through a mapping table. Any bake aborts to the
 *  exporter's fallback for the whole shape, and every outcome is recorded in the report. */
export function mapRecipe<Out>(input: Recipe | RecipeNode | null, mapping: RecipeMapping<Out>, options: MapRecipeOptions<Out>): Out
{
    const notes: string[] = [];
    const classifications = options.classifications ?? new Map();
    const root: RecipeNode = !input
        ? { kind: 'baked', reason: 'shape was not recorded' }
        : ('steps' in input ? resolveRecipe(input) : input);
    const tagsOf = (node: RecipeNode) => classifications.get(node) ?? [];

    const ctx: MapContext<Out> = {
        subject: options.subject,
        map: (node: RecipeNode): Out =>
        {
            for (const c of tagsOf(node))
            {
                const row = mapping[c.tag as `${string}:${string}`];
                if (row) return row(node, ctx, c);
            }
            const key = nodeKey(node);
            if (key === 'baked') return (mapping.baked ?? (() => ctx.bake((node as BakedNode).reason)))(node, ctx);
            const row = mapping[key] ?? mapping['*'];
            if (!row) return ctx.bake(`no mapping for ${key}`);
            return row(node, ctx);
        },
        bake: (reason: string): never => { throw new RecipeBake(reason); },
        note: (message: string) => { notes.push(message); },
        classificationsOf: tagsOf,
    };

    const allTags = [...classifications.values()].flat().map(c => c.tag);
    try
    {
        const out = ctx.map(root);
        options.report?.add({ subject: options.subject, status: 'mapped', notes, tags: allTags });
        return out;
    }
    catch (e)
    {
        if (!(e instanceof RecipeBake)) throw e;
        options.report?.add({ subject: options.subject, status: 'baked', reason: e.reason, notes, tags: allTags });
        return options.fallback(e.reason);
    }
}

//// 9. EXPLAIN ////

export function fmt(n: number): string
{
    if (!Number.isFinite(n)) return String(n);
    if (Math.abs(n) < 1e-9) return '0';
    return String(Number(n.toFixed(6)));
}

const fmtVec = (v: Vec3) => `[${v.map(fmt).join(', ')}]`;

function explainStep(step: RecipeStep): string
{
    switch (step.op)
    {
        case 'box': return `box(size=${fmtVec(step.size)})`;
        case 'cylinder': return `cylinder(radius=${fmt(step.radius)}, height=${fmt(step.height)})`;
        case 'sphere': return `sphere(radius=${fmt(step.radius)})`;
        case 'cone': return `cone(r1=${fmt(step.r1)}, r2=${fmt(step.r2)}, height=${fmt(step.height)})`;
        case 'translate': return `translate${fmtVec(step.v).replace('[', '(').replace(']', ')')}`;
        case 'rotate': return `rotate(${fmt(step.angle)}°, axis=${fmtVec(step.axis)}, pivot=${fmtVec(step.pivot)})`;
        case 'scale': return `scale(${fmtVec(step.f)}, origin=${fmtVec(step.origin)})`;
        case 'mirror': return `mirror(normal=${fmtVec(step.normal)}, origin=${fmtVec(step.origin)})`;
        case 'cut': case 'fuse': case 'common': return step.op;
        case 'baked': return `baked: ${step.reason}`;
    }
}

/** What the script did to a shape, step by step. Pass the shape itself to also get its name and
 *  the verification against its geometry.
 *
 *      box
 *        box(size=[100, 50, 20])
 *        rotate(30°, axis=[0, 0, 1], pivot=[0, 0, 0])
 *        cut
 *          └ cylinder(radius=5, height=40)
 *            translate(10, 0, -10)
 *        [verified: bounds (contained)]
 */
export function explainRecipe(input: Recipe | any, indent = ''): string
{
    const isRecipe = input && Array.isArray(input.steps);
    const recipe: Recipe | null = isRecipe ? input : recipeOf(input);
    const lines: string[] = [];
    if (!isRecipe)
    {
        const name = typeof input?.name === 'function' ? input.name() : undefined;
        lines.push(`${indent}${name ?? 'shape'} (${input?.constructor?.name ?? 'unknown'})`);
        indent += '  ';
    }
    if (!recipe)
    {
        lines.push(`${indent}no recipe (recipes are recorded only in runs that request a procedural export such as ${SCRIPT_OUTPUT_RECIPE_FORMATS.join(', ')})`);
        return lines.join('\n');
    }
    for (const step of recipe.steps)
    {
        lines.push(`${indent}${explainStep(step)}`);
        if (isBooleanStep(step))
        {
            step.tools.forEach(tool =>
            {
                const toolLines = explainRecipe(tool, `${indent}    `).split('\n');
                toolLines[0] = `${indent}  └ ${toolLines[0].trimStart()}`;
                lines.push(...toolLines);
            });
        }
    }
    if (!isRecipe)
    {
        const v = verifyRecipe(input, recipe);
        lines.push(`${indent}[${v.ok ? 'verified' : 'verification failed'}: ${v.checked}${v.reason ? `, ${v.reason}` : ''}]`);
    }
    return lines.join('\n');
}

/** What an exporter sees: the resolved tree, with one frame per primitive and any tags. */
export function explainNode(node: RecipeNode, classifications?: Classifications, indent = ''): string
{
    const tags = (classifications?.get(node) ?? [])
        .map(c => `  ⇒ ${c.tag} (${c.origin}${c.rule ? `, rule '${c.rule}'` : ''}: ${c.evidence})`)
        .join('');
    switch (node.kind)
    {
        case 'baked': return `${indent}baked: ${node.reason}${tags}`;
        case 'leaf':
        {
            const f = affineFrame(node.matrix);
            const frame = `origin=${fmtVec(f.origin)} x=${fmtVec(f.axes[0])} z=${fmtVec(f.axes[2])}`
                + (f.scales.every(s => Math.abs(s - 1) < 1e-9) ? '' : ` scale=${fmtVec(f.scales)}`)
                + (f.handedness < 0 ? ' mirrored' : '')
                + (f.orthogonal ? '' : ' sheared');
            return `${indent}${explainStep(node.step)} @ ${frame}${tags}`;
        }
        case 'boolean':
        {
            const lines = [`${indent}${node.op}${tags}`];
            const children: Array<[string, RecipeNode]> = [['base', node.base], ...node.tools.map(t => ['tool', t] as [string, RecipeNode])];
            children.forEach(([role, child], i) =>
            {
                const last = i === children.length - 1;
                const [first, ...rest] = explainNode(child, classifications).split('\n');
                lines.push(`${indent}  ${last ? '└' : '├'} ${role}: ${first}`, ...rest.map(l => `${indent}  ${last ? ' ' : '│'} ${l}`));
            });
            return lines.join('\n');
        }
    }
}
