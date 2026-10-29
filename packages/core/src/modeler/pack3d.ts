/**
 *  pack3d.ts
 *
 *  The script side of make.pack3d(): it measures the shapes, builds the instance that the 3D load
 *  planner (@archiyou/pack3d-wasm) reads, and says how a shape is turned to stand in the place the plan
 *  gives it. The planner itself is loaded on demand (see loadPack3dModule() in Make.ts); nothing here
 *  imports it at run time, only its types.
 *
 *  The planner works in whole millimetres and whole grams. Lengths are rounded the safe way: a shape
 *  up, a bin down, so that a shape never comes out smaller than it is nor a bin larger. The same goes
 *  for weights: what a shape weighs up, what a bin or a shape may carry down.
 */

import type { Axle, Balance, Bin, Instance, Item, Options, Orientations } from '@archiyou/pack3d-wasm';
import type { Pack3DOptions } from './Make';

/** How lengths and weights of the script map to the planner's. */
export interface Pack3DContext
{
    /** Millimetres in one model unit. */
    mmPerUnit: number;
    /** Whether weights are in pounds (imperial units) rather than kilograms. */
    imperial: boolean;
}

const GRAMS_PER_POUND = 453.59237;

/** A length is rounded up, with a tolerance of 1e-6 so that float noise does not cost a millimetre (600.0000001 stays 600). */
const up = (value: number): number => Math.ceil(value - 1e-6);
const down = (value: number): number => Math.floor(value + 1e-6);

export const toGrams = (mass: number, context: Pack3DContext): number => mass * (context.imperial ? GRAMS_PER_POUND : 1000);
export const fromGrams = (grams: number, context: Pack3DContext): number => grams / (context.imperial ? GRAMS_PER_POUND : 1000);

type PerShape<T> = T | ((shape: any, index: number) => T);

/** An option that is one answer for all shapes, or asked per shape. */
const asked = <T>(option: PerShape<T> | undefined, shape: any, index: number): T | undefined =>
    typeof option === 'function' ? (option as (shape: any, index: number) => T)(shape, index) : option;

/** One shape of the script, measured. */
export interface Measured
{
    /** Index in the collection the script gave. */
    index: number;
    shape: any;
    item: Item;
    /** What makes two shapes interchangeable for the planner. */
    key: string;
}

const whole = (value: unknown, what: string): number =>
{
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    {
        throw new Error(`Make::pack3d(): ${what} has to be a number of 0 or more, got ${String(value)}`);
    }
    return value;
};

/** Measure the shapes: their size as modelled (the bounding box, z up), their weight, what they may carry, their stop and how they may be turned. */
export function measure(shapes: any[], options: Pack3DOptions, context: Pack3DContext): Measured[]
{
    return shapes.map((shape, index) =>
    {
        const label = `shape ${index + 1}${typeof shape.name === 'function' && shape.name() ? ` (${shape.name()})` : ''}`;
        const box = shape.bbox?.();
        if (!box) throw new Error(`Make::pack3d(): ${label} has no extent to load`);
        const dims = [box.width(), box.depth(), box.height()].map(side => up(side * context.mmPerUnit)) as [number, number, number];
        if (dims.some(side => !(side >= 1))) throw new Error(`Make::pack3d(): ${label} is flat or empty: ${dims.join(' x ')} mm`);

        const rotation = asked(options.rotation as PerShape<Orientations | boolean | undefined>, shape, index);
        const orientations: Orientations = rotation === undefined || rotation === true ? 'upright' : rotation === false ? 'fixed' : rotation;

        const weight = whole(asked(options.weight, shape, index) ?? shape.weight?.() ?? 0, `the weight of ${label}`);
        const limit = asked(options.maxLoad as PerShape<number | null | undefined>, shape, index);
        const maxLoad = limit === undefined || limit === null ? null : down(toGrams(whole(limit, `the load ${label} may carry`), context));
        const stop = whole(asked(options.stop, shape, index) ?? 0, `the stop of ${label}`);
        if (!Number.isInteger(stop)) throw new Error(`Make::pack3d(): the stop of ${label} has to be a whole number, got ${stop}`);

        const item: Item = { dims, weight: up(toGrams(weight, context)), maxLoad, stop, orientations };
        return { index, shape, item, key: JSON.stringify([dims, item.weight, maxLoad, stop, orientations]) };
    });
}

/** Shapes that are interchangeable for the planner: one item type with a count, in the order they first appear. */
export interface Group
{
    item: Item;
    /** The shapes of the group, in the order the plan hands out its copies. */
    members: Measured[];
}

export function group(measured: Measured[]): Group[]
{
    const groups = new Map<string, Group>();
    measured.forEach(shape =>
    {
        const found = groups.get(shape.key);
        if (found) found.members.push(shape);
        else groups.set(shape.key, { item: { ...shape.item }, members: [shape] });
    });
    return [...groups.values()].map(({ item, members }) => ({ item: { ...item, count: members.length }, members }));
}

/** The kinds of bin the script gave, in the planner's units. */
export function wireBins(options: Pack3DOptions, context: Pack3DContext): Bin[]
{
    const bins = options?.bins;
    if (!Array.isArray(bins) || bins.length === 0)
    {
        throw new Error('Make::pack3d(): please give the bins to load into, like make.pack3d(parts, { bins: [{ length: 1200, width: 800, height: 1800 }] })');
    }
    return bins.map((bin, i) =>
    {
        const label = `bin ${i + 1}${bin.name ? ` (${bin.name})` : ''}`;
        const sides = [bin.length, bin.width, bin.height];
        if (sides.some(side => typeof side !== 'number' || !(side > 0)))
        {
            throw new Error(`Make::pack3d(): ${label} needs a length, a width and a height above 0, got ${sides.join(' x ')}`);
        }
        const axles = bin.balance?.axles?.map(axle => ({ at: Math.round(axle.at * context.mmPerUnit), maxLoad: down(toGrams(whole(axle.maxLoad, `the load of a support of ${label}`), context)) }));
        const balance: Balance | null = bin.balance ? { cog: bin.balance.cog, axles: axles as [Axle, Axle] | undefined } : null;
        return {
            dims: sides.map(side => down(side * context.mmPerUnit)) as [number, number, number],
            cost: bin.cost,
            stock: bin.stock ?? null,
            maxWeight: bin.maxWeight === undefined || bin.maxWeight === null ? null : down(toGrams(whole(bin.maxWeight, `the weight limit of ${label}`), context)),
            door: bin.door ?? null,
            balance,
        };
    });
}

/** The whole instance for the planner. */
export function toInstance(groups: Group[], options: Pack3DOptions, context: Pack3DContext): Instance
{
    return { name: 'pack3d', items: groups.map(({ item }) => item), bins: wireBins(options, context) };
}

/** The options of the planner. */
export function toOptions(options: Pack3DOptions, context: Pack3DContext): Options
{
    return {
        seed: options.seed,
        support: options.support,
        gap: options.gap === undefined ? undefined : up(options.gap * context.mmPerUnit),
        iterations: options.maxIterations,
        maxEvaluations: options.maxEvaluations,
    };
}

/** The 90° turns, each about a fixed world axis and in this order, that put a shape in orientation `o` of the planner: its
 *  axes `[0,1,2]`, `[1,0,2]`, `[0,2,1]`, `[2,0,1]`, `[1,2,0]`, `[2,1,0]` along x, y and z. */
const TURNS: ReadonlyArray<ReadonlyArray<'x' | 'y' | 'z'>> = [[], ['z'], ['x'], ['x', 'z'], ['z', 'x'], ['y']];

/** Turn a shape into orientation `orientation`. */
export function turn(shape: any, orientation: number): void
{
    const turns = TURNS[orientation];
    if (!turns) throw new Error(`Make::pack3d(): the plan has an orientation that does not exist: ${orientation}`);
    turns.forEach(axis => (axis === 'x' ? shape.rotateX(90) : axis === 'y' ? shape.rotateY(90) : shape.rotateZ(90)));
}

/** Turn a shape into its orientation and move it so that its lowest corner is at `corner` (in millimetres from the front lower corner of
 *  the bin), the bin itself standing `offsetX` model units along x. */
export function put(shape: any, orientation: number, corner: [number, number, number], offsetX: number, context: Pack3DContext): void
{
    turn(shape, orientation);
    const box = shape.bbox();
    shape.translate(
        corner[0] / context.mmPerUnit + offsetX - box.minX(),
        corner[1] / context.mmPerUnit - box.minY(),
        corner[2] / context.mmPerUnit - box.minZ()
    );
}
