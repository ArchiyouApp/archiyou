/**
 * Packer3D: a typed wrapper around the pack3d WebAssembly module, stable 3D load planning.
 *
 * Boxes go into bins (pallets, crates, trailers) so that every box stands, and so that the weight
 * limits, the limits on what may rest on a box, the unloading order and the balance of the load
 * are met. The same instance, options and seed give the same plan, byte for byte, on every
 * machine. Lengths are whole millimetres, weights whole grams; x is the length of a bin, y its
 * width and z its height (up).
 *
 * ```ts
 * const packer = await new Packer3D().init();
 * const plan = packer.solve({
 *   items: [{ dims: [400, 300, 250], count: 12 }],
 *   bins: [{ dims: [1200, 800, 1800], maxWeight: 600_000 }],
 * });
 * ```
 */

export const DEFAULT_ITERATIONS = 100;

export type Vec3 = [number, number, number];

export type Axis = 'x' | 'y' | 'z';

/** The side of a bin that the load leaves by. Without a door the load leaves from the top only. */
export type Door = '+x' | '-x' | '+y' | '-y';

/** The ways an item may be put in a bin: as modelled (`fixed`), also turned 90° about the vertical
 *  (`upright`), in any of the six orientations (`free`), or the axes of the item that may point up and
 *  whether it may be turned about the vertical (`yaw`, default true). */
export type Orientations = 'fixed' | 'upright' | 'free' | { up: Axis | Axis[]; yaw?: boolean };

export interface Item
{
    /** Extents as modelled: x, y, z with z up. */
    dims: Vec3;
    /** How many identical items there are (default 1). */
    count?: number;
    /** Which orientations are allowed: `'fixed'`, `'upright'`, `'free'`, the axes that may point up, or the bit mask over
     *  the six orientations itself ({@link orientationMask} turns the first kinds into the last). Default: free. */
    orientations?: number | Orientations;
    /** Weight in grams (default 0). */
    weight?: number;
    /** The weight in grams that may rest on the item, directly or through others; absent for no limit, 0 for nothing. */
    maxLoad?: number | null;
    /** At which stop the item is unloaded: lower stops are unloaded first, 0 for no order (default). */
    stop?: number;
}

export interface Axle
{
    /** Where the support is, in millimetres from the front wall of the bin (x = 0). It may be outside the bin. */
    at: number;
    /** The most it may carry, in grams. */
    maxLoad: number;
}

export interface Balance
{
    /** How far the centre of gravity may be from the middle of the floor, as a fraction (0 to 0.5) of the length (x) and the width (y). */
    cog?: { x?: number; y?: number };
    /** Exactly two supports along the length, such as the kingpin and the rear axles of a trailer. */
    axles?: [Axle, Axle];
}

export interface Bin
{
    /** Inner extents: length x, width y, height z. */
    dims: Vec3;
    /** Cost of one bin (default 1). */
    cost?: number;
    /** How many bins of this kind there are; absent for as many as needed. */
    stock?: number | null;
    /** The most the load may weigh, in grams. */
    maxWeight?: number | null;
    /** The side the load leaves by. */
    door?: Door | null;
    /** The balance the load should have. Best effort: a plan that cannot meet it says so (`balanceOk`). */
    balance?: Balance | null;
}

export interface Instance
{
    name?: string;
    items: Item[];
    bins: Bin[];
}

export interface Options
{
    /** Which of the solver's equally good choices to take (default 0). */
    seed?: number;
    /** The share (0 to 1) of an item's base that has to rest on the floor or on other items; its centre also has to be over that contact (default 0.8). */
    support?: number;
    /** Clearance kept between items along x and y, in millimetres (default 0). */
    gap?: number;
    /** Steps of the search that improves the plan (default {@link DEFAULT_ITERATIONS}); 0 gives the constructive plan. */
    iterations?: number;
    /** A limit on the work in placements tried, not on the time (default 40 million): the plan is the same on every machine. */
    maxEvaluations?: number;
}

export interface Placement
{
    /** Index of the item type. */
    item: number;
    /** Which of its `count` items. */
    copy: number;
    /** The orientation (0 to 5): item axes `[0,1,2]`, `[1,0,2]`, `[0,2,1]`, `[2,0,1]`, `[1,2,0]`, `[2,1,0]` along x, y, z. */
    orientation: number;
    /** The corner of the item with the smallest x, y and z. */
    x: number;
    y: number;
    z: number;
}

export interface BinLoad
{
    /** Index of the bin type. */
    bin: number;
    /** In the order they were put in. */
    placements: Placement[];
    /** Volume of the items, in cubic millimetres. */
    volume: number;
    /** Weight of the items, in grams. */
    weight: number;
    /** The centre of gravity in millimetres (x, y), when the load has weight. */
    cog: [number, number] | null;
    /** What the two supports carry in grams (front, rear), when the bin has them. */
    axleLoads: number[];
    /** Whether the balance the bin asks for is met (true when it asks for none). */
    balanceOk: boolean;
}

export interface ItemRef
{
    item: number;
    copy: number;
}

export interface Stats
{
    evaluations: number;
    iterations: number;
    bins: number;
    cost: number;
}

export interface Solution
{
    bins: BinLoad[];
    /** Items that went nowhere: too big or too heavy for every bin, or the stock ran out. */
    unplaced: ItemRef[];
    stats: Stats;
}

/** The mask for the ways an item may be put in a bin, as `Item.orientations` takes it. */
export function orientationMask(orientations: Orientations): number
{
    if (orientations === 'fixed') return 0b000001;
    if (orientations === 'upright') return 0b000011;
    if (orientations === 'free') return 0b111111;
    // the orientations with the item's z axis up are 0 and 1, its y axis up 2 and 3, its x axis up 4 and 5; the second of a pair is the turn about the vertical
    const first: Record<Axis, number> = { z: 0, y: 2, x: 4 };
    const axes = Array.isArray(orientations.up) ? orientations.up : [orientations.up];
    const yaw = orientations.yaw ?? true;
    const mask = axes.reduce((bits, axis) =>
    {
        if (!(axis in first)) throw new Error(`pack3d: unknown axis "${axis}", use x, y or z`);
        return bits | (1 << first[axis]) | (yaw ? 1 << (first[axis] + 1) : 0);
    }, 0);
    if (mask === 0) throw new Error('pack3d: orientations needs at least one axis that may point up');
    return mask;
}

interface WasmModule
{
    solve(instanceJson: string, configJson: string): string;
    validate(instanceJson: string, configJson: string, solutionJson: string): string;
}

/** One WebAssembly instance per process, shared by every Packer3D. The wasm-bindgen glue keeps the
 *  instance, and cached views of its memory, in module state: a second instance leaves the first
 *  one reading its strings from the wrong memory. It also makes concurrent `init()` calls load the
 *  module once. */
let sharedModule: Promise<WasmModule> | null = null;

async function loadWasm(): Promise<WasmModule>
{
    const { PACK3D_WASM_BASE64 } = await import('./pack3d-wasm-binary');
    const bg = await import('../pkg/pack3d_wasm_bg.js');

    const bytes = typeof Buffer !== 'undefined'
        ? Buffer.from(PACK3D_WASM_BASE64, 'base64')
        : Uint8Array.from(atob(PACK3D_WASM_BASE64), c => c.charCodeAt(0));

    // Double cast: a module namespace is not structurally a WebAssembly.Imports entry (bundler
    // resolution synthesises a `default` member on it). wasm-bindgen's contract is "hand the glue
    // module back to the module it came from", which the type system cannot express.
    const imports = { './pack3d_wasm_bg.js': bg };
    const { instance } = await WebAssembly.instantiate(bytes, imports as unknown as WebAssembly.Imports);
    bg.__wbg_set_wasm(instance.exports);

    return { solve: bg.solve, validate: bg.validate };
}

const whole = (value: unknown, what: string, min = 0): void =>
{
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    {
        throw new Error(`pack3d: ${what} has to be a whole number of at least ${min}, got ${String(value)}`);
    }
};

/** The instance as the module reads it: the orientations as bit masks. */
function toWire(instance: Instance): unknown
{
    return {
        ...instance,
        items: instance.items.map(item => (item.orientations === undefined || typeof item.orientations === 'number'
            ? item
            : { ...item, orientations: orientationMask(item.orientations) })),
    };
}

/** Checks that give a plain message for what the module would reject with a serde error. */
function check(instance: Instance, options: Options): void
{
    if (!Array.isArray(instance?.items) || !Array.isArray(instance?.bins))
    {
        throw new Error('pack3d: an instance needs items and bins, both as lists');
    }
    instance.items.forEach((item, i) =>
    {
        (item.dims ?? []).forEach((d, a) => whole(d, `item ${i}: side ${'xyz'[a]}`, 1));
        if (!Array.isArray(item.dims) || item.dims.length !== 3) throw new Error(`pack3d: item ${i}: dims has to be [x, y, z]`);
        if (item.count !== undefined) whole(item.count, `item ${i}: count`);
        if (item.weight !== undefined) whole(item.weight, `item ${i}: weight in grams`);
        if (item.maxLoad !== undefined && item.maxLoad !== null) whole(item.maxLoad, `item ${i}: maxLoad in grams`);
        if (item.stop !== undefined) whole(item.stop, `item ${i}: stop`);
        if (typeof item.orientations === 'number') whole(item.orientations, `item ${i}: orientations`, 1);
    });
    instance.bins.forEach((bin, i) =>
    {
        if (!Array.isArray(bin.dims) || bin.dims.length !== 3) throw new Error(`pack3d: bin ${i}: dims has to be [x, y, z]`);
        bin.dims.forEach((d, a) => whole(d, `bin ${i}: side ${'xyz'[a]}`, 1));
        if (bin.stock !== undefined && bin.stock !== null) whole(bin.stock, `bin ${i}: stock`);
        if (bin.maxWeight !== undefined && bin.maxWeight !== null) whole(bin.maxWeight, `bin ${i}: maxWeight in grams`);
    });
    if (options.seed !== undefined) whole(options.seed, 'seed');
    if (options.gap !== undefined) whole(options.gap, 'gap');
    if (options.iterations !== undefined) whole(options.iterations, 'iterations');
    if (options.maxEvaluations !== undefined) whole(options.maxEvaluations, 'maxEvaluations');
}

const config = (options: Options): string => JSON.stringify({
    seed: options.seed,
    support: options.support,
    gap: options.gap,
    iterations: options.iterations ?? DEFAULT_ITERATIONS,
    maxEvaluations: options.maxEvaluations,
});

export class Packer3D
{
    #module: WasmModule | null = null;

    /** Load and instantiate the WebAssembly module. Must be awaited before calling `solve`. Returns
     *  `this`, so `const packer = await new Packer3D().init()` works. Safe to call more than once, also
     *  on several Packer3Ds at the same time: they share one instance of the module.
     *
     *  Loads the module from an inlined base64 string, so it works in every bundler and test
     *  environment without needing ESM WASM support. */
    async init(): Promise<this>
    {
        if (this.#module !== null) return this;

        // a failed load is not remembered, so a later init() tries again
        sharedModule ??= loadWasm().catch(error =>
        {
            sharedModule = null;
            throw error;
        });
        this.#module = await sharedModule;
        return this;
    }

    /** Whether the module has been loaded. */
    get ready(): boolean
    {
        return this.#module !== null;
    }

    #loaded(): WasmModule
    {
        if (this.#module === null)
        {
            throw new Error('Packer3D.solve(): the WebAssembly module is not loaded, await packer.init() first');
        }
        return this.#module;
    }

    /** Load the items into bins. Items that fit nowhere are listed in `unplaced`, not dropped.
     *
     *  @throws for input that makes no sense (a side of 0, a fraction outside 0 to 0.5, no bins) */
    solve(instance: Instance, options: Options = {}): Solution
    {
        const module = this.#loaded();
        check(instance, options);
        try
        {
            return JSON.parse(module.solve(JSON.stringify(toWire(instance)), config(options))) as Solution;
        }
        catch (error)
        {
            throw new Error(`pack3d: ${String(error)}`);
        }
    }

    /** The rules that a solution breaks for this instance and these options, in words; empty when it breaks none.
     *  `solve` runs this on every plan itself: it is for plans that were made or changed elsewhere. */
    validate(instance: Instance, options: Options, solution: Solution): string[]
    {
        const module = this.#loaded();
        try
        {
            return JSON.parse(module.validate(JSON.stringify(toWire(instance)), config({ ...options, iterations: 0 }), JSON.stringify(solution))) as string[];
        }
        catch (error)
        {
            throw new Error(`pack3d: ${String(error)}`);
        }
    }

    /** Escape hatch: the module's own JSON in and out, without the checks of this wrapper. */
    solveRaw(instanceJson: string, configJson: string): string
    {
        return this.#loaded().solve(instanceJson, configJson);
    }
}
