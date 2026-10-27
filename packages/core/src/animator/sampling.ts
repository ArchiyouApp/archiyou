/**
 *  animator/sampling.ts
 *
 *  How a keyframed value becomes the samples of a glTF channel, for every animation Archiyou
 *  bakes: layouts, instructables and the animator's own.
 *
 *  Easing is baked into LINEAR samples rather than written as CUBICSPLINE: every viewer plays
 *  LINEAR the same way, and the sample count is then the observable difference between the
 *  easings (GLTFBuilder.animations.test.ts pins it). Between two keys with the same value
 *  nothing is written but the key itself, so a part holds still at no cost.
 *
 *  Pure maths with no imports at runtime, so it can be tested on its own.
 */

import type { Easing, Quat, Vec3 } from './types'

export const EASED_KEYFRAME_SAMPLE_COUNT = 17
export const SPRING_KEYFRAME_SAMPLE_COUNT = 25

export const IDENTITY_QUATERNION: Quat = [0, 0, 0, 1]

/** What a hidden part is scaled to in a visibility channel. Not zero: a singular matrix makes
 *  three.js's normal matrix NaN. 1e-4 is invisible and stays invertible. */
export const HIDDEN_SCALE = 1e-4
const EPSILON = 1e-9

/** One key of a value of any kind. `easing` is how the value travels INTO this key. */
export interface Key<V>
{
    t: number
    value: V
    easing: Easing
}

export interface BakedSamples<V>
{
    times: Array<number>
    values: Array<V>
}

export interface BakeOptions<V>
{
    same: (a: V, b: V) => boolean
    /** The value a fraction `progress` of the way from a to b. Progress is eased, so it can
     *  overshoot 1 for 'spring'. */
    interpolate: (a: V, b: V, progress: number) => V
    /** Samples across a changing segment, both ends included. Default sampleCount(b.easing). */
    samples?: (a: Key<V>, b: Key<V>) => number
    /** Hold the last value until here, so every channel of a clip ends together. */
    duration?: number
}

/** Samples across one eased transition, both ends included. */
export function sampleCount(easing: Easing): number
{
    switch (easing)
    {
        case 'linear': return 2
        case 'spring': return SPRING_KEYFRAME_SAMPLE_COUNT
        default: return EASED_KEYFRAME_SAMPLE_COUNT
    }
}

/** Eased progress for a linear progress `u` in [0, 1]. */
export function ease(u: number, easing: Easing): number
{
    const t = Math.min(1, Math.max(0, u))

    switch (easing)
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
            if (t === 0 || t === 1) { return t }
            const c4 = (2 * Math.PI) / 3
            return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
        }
        case 'linear':
        default:
            return t
    }
}

/** Sample keyframes: held where two keys agree, eased across where they do not.
 *
 *  Keys are taken in time order. Before the first key the first value holds from 0; after the
 *  last, the last value holds until `duration`. glTF sampler inputs must increase strictly, so
 *  a sample at or before the previous one is dropped — two keys at the same time keep the
 *  first. */
export function bakeKeys<V>(keys: Array<Key<V>>, options: BakeOptions<V>): BakedSamples<V>
{
    const sorted = [...keys].sort((a, b) => a.t - b.t)
    const times: Array<number> = []
    const values: Array<V> = []
    if (!sorted.length) { return { times, values } }

    const push = (t: number, value: V) =>
    {
        if (times.length && t <= times[times.length - 1]) { return }
        times.push(t)
        values.push(value)
    }

    const first = sorted[0]
    if (first.t > 0) { push(0, first.value) }
    push(first.t, first.value)

    sorted.slice(1).forEach((b, i) =>
    {
        const a = sorted[i]
        if (options.same(a.value, b.value))
        {
            push(b.t, b.value)
            return
        }

        const count = Math.max(2, options.samples ? options.samples(a, b) : sampleCount(b.easing))
        Array.from({ length: count - 1 }, (_, s) => s + 1).forEach(s =>
        {
            const u = s / (count - 1)
            const progress = (s === count - 1) ? 1 : ease(u, b.easing)
            push(a.t + (b.t - a.t) * u, options.interpolate(a.value, b.value, progress))
        })
    })

    const last = sorted[sorted.length - 1]
    if (options.duration !== undefined && options.duration > last.t) { push(options.duration, last.value) }

    return { times, values }
}

/** A baked series read at time t, linearly between its samples, held outside them. */
export function sampleAt(series: BakedSamples<Array<number>>, t: number): Array<number>
{
    const { times, values } = series
    if (!times.length) { return [] }
    if (t <= times[0]) { return values[0] }
    if (t >= times[times.length - 1]) { return values[values.length - 1] }

    const i = times.findIndex(time => time >= t)
    const t0 = times[i - 1]
    const u = (t - t0) / (times[i] - t0)
    return values[i].map((v, k) => lerp(values[i - 1][k], v, u))
}

//// VECTORS AND QUATERNIONS ////

export function lerp(a: number, b: number, u: number): number
{
    return a + (b - a) * u
}

export function lerpVec<T extends Array<number>>(a: T, b: T, u: number): T
{
    return a.map((v, i) => lerp(v, b[i], u)) as T
}

export function add(a: Vec3, b: Vec3): Vec3
{
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function subtract(a: Vec3, b: Vec3): Vec3
{
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scaleVec(a: Array<number>, factor: number): Vec3
{
    return [a[0] * factor, a[1] * factor, a[2] * factor]
}

export function multiplyVec(a: Vec3, b: Vec3): Vec3
{
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

export function isSameVec(a: Array<number>, b: Array<number>, tolerance = EPSILON): boolean
{
    return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tolerance)
}

export function isIdentityQuat(q: Array<number>): boolean
{
    return isSameQuat(q, IDENTITY_QUATERNION)
}

/** q and −q are the same rotation, so compare the rotation, not the four numbers. */
export function isSameQuat(a: Array<number>, b: Array<number>): boolean
{
    return Math.abs(a.reduce((dot, v, i) => dot + v * b[i], 0)) > 1 - EPSILON
}

export function normalizeQuat(q: Array<number>): Quat
{
    const length = Math.hypot(q[0], q[1], q[2], q[3])
    if (length < EPSILON) { return [...IDENTITY_QUATERNION] }
    return [q[0] / length, q[1] / length, q[2] / length, q[3] / length]
}

export function multiplyQuat(a: Quat, b: Quat): Quat
{
    const [ax, ay, az, aw] = a
    const [bx, by, bz, bw] = b
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

/** A point turned by a quaternion: `q * (0,p) * q⁻¹`, written out. */
export function rotatePoint(q: Quat, p: Vec3): Vec3
{
    const [x, y, z, w] = normalizeQuat(q)
    const [px, py, pz] = p

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

/** Spherical interpolation, the short way round. Progress beyond [0, 1] (a spring's
 *  overshoot) carries on along the same arc. */
export function slerp(start: Quat, end: Quat, progress: number): Quat
{
    const [sx, sy, sz, sw] = start
    let [ex, ey, ez, ew] = end
    let dot = sx * ex + sy * ey + sz * ez + sw * ew

    if (dot < 0)
    {
        ex = -ex; ey = -ey; ez = -ez; ew = -ew
        dot = -dot
    }

    if (dot > 0.9995)
    {
        return normalizeQuat([lerp(sx, ex, progress), lerp(sy, ey, progress),
            lerp(sz, ez, progress), lerp(sw, ew, progress)])
    }

    const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)))
    const sinTheta0 = Math.sin(theta0)
    const theta = theta0 * progress
    const sinTheta = Math.sin(theta)
    const scaleStart = Math.cos(theta) - dot * sinTheta / sinTheta0
    const scaleEnd = sinTheta / sinTheta0

    return normalizeQuat([
        sx * scaleStart + ex * scaleEnd,
        sy * scaleStart + ey * scaleEnd,
        sz * scaleStart + ez * scaleEnd,
        sw * scaleStart + ew * scaleEnd,
    ])
}

/** A quaternion from Euler degrees, applied X then Y then Z (each about the world axis), the
 *  order `rotateX().rotateY().rotateZ()` turns a shape in. */
export function quatFromEulerDegrees(degrees: Vec3): Quat
{
    const axis = (index: number, angle: number): Quat =>
    {
        const half = (angle * Math.PI / 180) / 2
        const q: Quat = [0, 0, 0, Math.cos(half)]
        q[index] = Math.sin(half)
        return q
    }
    // world-axis rotations compose by pre-multiplying: Z · Y · X
    return normalizeQuat(multiplyQuat(axis(2, degrees[2]), multiplyQuat(axis(1, degrees[1]), axis(0, degrees[0]))))
}

/** Orientation of a camera at `eye` looking at `target`.
 *
 *  A glTF camera looks down its own **-Z** with +Y up, so the node's rotation is the basis
 *  that maps those onto the world. World up is +Z — the GLB carries the kernel's native Z-up —
 *  with a fallback for looking straight up or down, where "up" and the view direction are
 *  parallel and the cross product collapses. */
export function lookAtQuaternion(eye: Array<number>, target: Array<number>): Quat
{
    const sub = (a: Array<number>, b: Array<number>) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
    const cross = (a: Array<number>, b: Array<number>) =>
        [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
    const norm = (v: Array<number>) =>
    {
        const l = Math.hypot(v[0], v[1], v[2])
        return (l < EPSILON) ? [0, 0, 1] : [v[0]/l, v[1]/l, v[2]/l]
    }

    const forward = norm(sub(target, eye))
    const z = [-forward[0], -forward[1], -forward[2]]        // camera looks down -Z

    // looking straight up or down: pick another reference
    const up = (Math.abs(forward[2]) > 0.999) ? [0, 1, 0] : [0, 0, 1]

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
        return normalizeQuat([(m21 - m12) / sq, (m02 - m20) / sq, (m10 - m01) / sq, sq / 4])
    }
    if (m00 > m11 && m00 > m22)
    {
        const sq = Math.sqrt(1 + m00 - m11 - m22) * 2
        return normalizeQuat([sq / 4, (m01 + m10) / sq, (m02 + m20) / sq, (m21 - m12) / sq])
    }
    if (m11 > m22)
    {
        const sq = Math.sqrt(1 + m11 - m00 - m22) * 2
        return normalizeQuat([(m01 + m10) / sq, sq / 4, (m12 + m21) / sq, (m02 - m20) / sq])
    }
    const sq = Math.sqrt(1 + m22 - m00 - m11) * 2
    return normalizeQuat([(m02 + m20) / sq, (m12 + m21) / sq, sq / 4, (m10 - m01) / sq])
}

/** sRGB '#rrggbb' → linear [r, g, b], the space glTF's baseColorFactor is in. */
export function hexToLinear(hex: string): Vec3
{
    const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
    const channel = (shift: number) =>
    {
        const c = ((n >> shift) & 255) / 255
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    return [channel(16), channel(8), channel(0)]
}
