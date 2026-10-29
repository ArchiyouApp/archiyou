/**
 * BinPacker — a typed, idiomatic wrapper around the WebAssembly build of
 * JeroenGar/gdrr-2bp, a goal-driven ruin & recreate heuristic for the 2D
 * guillotine bin-packing / nesting problem.
 *
 * Usage:
 *
 * ```ts
 * const bp = await new BinPacker().init();   // loads the wasm module
 * const solution = bp.solve(instance, options);
 * ```
 *
 * The public API is plain camelCase TypeScript. The PascalCase JSON shape that
 * the underlying Rust solver expects/returns is an implementation detail handled
 * by the mapping helpers at the bottom of this file.
 */

//// PUBLIC TYPES ////

/** Guillotine cut direction: horizontal or vertical. */
export type Orientation = 'H' | 'V';

/** What a node in a cutting pattern represents. */
export type NodeKind = 'structure' | 'item' | 'leftover';

/** How sheets are valued when comparing solutions. */
export type SheetValuationMode = 'area' | 'cost';

/** A stock sheet (bin) that parts can be cut from. */
export interface Sheet
{
    length: number;
    height: number;
    /** Available quantity; `null`/omitted means unlimited. */
    stock?: number | null;
    cost: number;
    /** Optional caller id, echoed back on the matching sheet in the solution. */
    reference?: number | null;
    /** Direction of the first cut on this sheet. `'H'` cuts straight across the length, so the
     *  sheet falls into strips stacked along its height; `'V'` cuts across the height, so it falls
     *  into strips side by side along its length. Omit/null to let the solver choose. */
    firstCut?: Orientation | null;
}

/** A part (item) that must be cut from the sheets. */
export interface Part
{
    length: number;
    height: number;
    /** How many of this part are required. */
    demand: number;
    value: number;
    /** Optional caller id, echoed back on the matching part in the solution. */
    reference?: number | null;
    /** `false` keeps this part in the orientation given, its length along the sheet's length (for
     *  a part with grain). Omit/null to follow `BinPackerOptions.rotationAllowed`. */
    canRotate?: boolean | null;
}

/** A bin-packing problem instance: the parts to place and the sheets available. */
export interface Instance
{
    name: string;
    sheets: Sheet[];
    parts: Part[];
}

/** Iterations used when neither `maxRRIterations` nor `maxRunTime` is given. Without a budget the
 *  solver runs until it reaches a material bound, which can take very long. 2000 takes about
 *  100 ms for a few hundred parts, and on the cabinet jobs it was measured on it is enough for the
 *  sheet count to stop depending on the seed (200 left it to chance). */
export const DEFAULT_ITERATIONS = 2000;

/** Algorithm parameters.
 *
 *  A run is reproducible: the same instance, options and `seed` give the same solution on every
 *  machine, natively and in WASM. That holds while the budget is `maxRRIterations`; a
 *  `maxRunTime` ends the run by the clock, so the result then depends on the machine's speed. */
export interface BinPackerOptions
{
    /** Wall-clock budget in whole seconds, on top of `maxRRIterations`. Makes the result depend on
     *  how fast the machine is: prefer `maxRRIterations`. Omit/null for no time limit. */
    maxRunTime?: number | null;
    /** Hard cap on ruin & recreate iterations. Omit/null for no limit, except when `maxRunTime` is
     *  not set either: then `DEFAULT_ITERATIONS` applies. */
    maxRRIterations?: number | null;
    /** Seed of the solver's random choices: a non-negative integer, default `0`. The same seed
     *  gives the same layout, another seed explores another one. */
    seed?: number;
    /** Allow 90° rotation of parts. Default `true`. A part's own `canRotate` takes precedence. */
    rotationAllowed?: boolean;
    /** Average number of nodes removed per ruin step. Default `5`. */
    avgNodesRemoved?: number;
    /** Probability of "blinking" (skipping) the best option, for diversification. Default `0.01`. */
    blinkRate?: number;
    /** Exponent applied when valuating leftover material. Default `2`. */
    leftoverValuationPower?: number;
    /** Length of the late-acceptance history queue. Default `500`. */
    historyLength?: number;
    /** How sheets are valued when comparing solutions. Default `'area'`. */
    sheetValuationMode?: SheetValuationMode;
    /** Max number of guillotine cutting stages per sheet (2: strips first, then pieces out of each
     *  strip, as on a panel saw). Omit/null for unlimited. */
    maxStages?: number | null;
}

/** A node in a guillotine cutting-pattern tree. */
export interface CuttingNode
{
    length: number;
    height: number;
    orientation?: Orientation;
    kind: NodeKind;
    /** Index into `Instance.parts` when `kind === 'item'`. */
    item?: number;
    children: CuttingNode[];
}

/** A cutting pattern applied to a single sheet. */
export interface CuttingPattern
{
    /** Index into `Instance.sheets` (the sheet type used). */
    sheet: number;
    /** Fraction of the sheet area used (0–1). */
    usage: number;
    root: CuttingNode;
}

/** Summary statistics for a solution. */
export interface SolutionStats
{
    /** Overall material usage as a percentage (0–100). */
    usagePct: number;
    /** Percentage of total part area that was placed (0–100). */
    partAreaIncludedPct: number;
    /** Number of sheets used. */
    objectsUsed: number;
    /** Total cost of the sheets used. */
    materialCost: number;
    /** Solver run time in milliseconds. */
    runTimeMs: number;
}

/** The result of a solve: the echoed instance plus the cutting patterns found. */
export interface Solution
{
    name: string;
    sheets: Sheet[];
    parts: Part[];
    patterns: CuttingPattern[];
    stats: SolutionStats;
}

//// BIN PACKER ////

type WasmSolve = (inputJson: string, configJson: string) => string;

/** Default algorithm options, merged with whatever the caller passes to `solve`. */
const DEFAULT_OPTIONS: Required<Omit<BinPackerOptions, 'maxRunTime' | 'maxRRIterations' | 'maxStages' | 'seed'>> = {
    rotationAllowed: true,
    avgNodesRemoved: 5,
    blinkRate: 0.01,
    leftoverValuationPower: 2,
    historyLength: 500,
    sheetValuationMode: 'area',
};

/** One WebAssembly instance per process, shared by every BinPacker. The wasm-bindgen glue keeps the
 *  instance, and cached views of its memory, in module state: a second instance leaves the first
 *  one reading its strings from the wrong memory ("encoded data was not valid for encoding
 *  utf-8"). It also makes concurrent `init()` calls load the module once. */
let sharedSolve: Promise<WasmSolve> | null = null;

async function loadWasm(): Promise<WasmSolve>
{
    const { GDRR2BP_WASM_BASE64 } = await import('./gdrr2bp-wasm-binary');
    const bg = await import('../pkg/gdrr2bp_wasm_bg.js');

    const bytes = typeof Buffer !== 'undefined'
        ? Buffer.from(GDRR2BP_WASM_BASE64, 'base64')
        : Uint8Array.from(atob(GDRR2BP_WASM_BASE64), c => c.charCodeAt(0));

    // Double cast: a module namespace is not structurally a WebAssembly.Imports entry —
    // bundler resolution synthesises a `default` member on it, and that is not an
    // ImportValue. wasm-bindgen's contract is "hand the glue module back to the module it
    // came from", which the type system has no way to express.
    const imports = { './gdrr2bp_wasm_bg.js': bg };
    const { instance } = await WebAssembly.instantiate(bytes, imports as unknown as WebAssembly.Imports);
    bg.__wbg_set_wasm(instance.exports);

    return bg.solve as WasmSolve;
}

export class BinPacker
{
    #solve: WasmSolve | null = null;

    /** Load and instantiate the WebAssembly module. Must be awaited before
     *  calling `solve`. Returns `this` so you can write
     *  `const bp = await new BinPacker().init()`. Safe to call more than once, also on
     *  several BinPackers at the same time: they share one instance of the module.
     *
     *  Loads the WASM from an inlined base64 string so it works in every
     *  bundler and test environment without needing ESM WASM support. */
    async init(): Promise<this>
    {
        if (this.#solve !== null) return this;

        // a failed load is not remembered, so a later init() tries again
        sharedSolve ??= loadWasm().catch(error =>
        {
            sharedSolve = null;
            throw error;
        });
        this.#solve = await sharedSolve;
        return this;
    }

    /** Whether the wasm module has been loaded. */
    get ready(): boolean
    {
        return this.#solve !== null;
    }

    /**
     * Solve a bin-packing / nesting instance.
     *
     * @param instance the parts and sheets to pack
     * @param options  algorithm parameters (defaults are applied for anything omitted)
     * @returns the best solution found within the given budget
     * @throws if `init()` has not been awaited, the instance is invalid, or no
     *         solution could be produced
     */
    solve(instance: Instance, options: BinPackerOptions = {}): Solution
    {
        if (this.#solve === null)
        {
            throw new Error('BinPacker.solve(): wasm not loaded — call `await bp.init()` first.');
        }

        const resultJson = this.#solve(
            JSON.stringify(toWireInstance(instance)),
            JSON.stringify(toWireConfig(options)),
        );
        return fromWireSolution(JSON.parse(resultJson) as WireSolution);
    }

    /** Escape hatch: solve directly with the raw wire-format JSON strings the
     *  Rust solver uses (PascalCase instance / camelCase config), returning the
     *  raw solution JSON string. Bypasses all mapping. */
    solveRaw(instanceJson: string, configJson: string): string
    {
        if (this.#solve === null)
        {
            throw new Error('BinPacker.solveRaw(): wasm not loaded — call `await bp.init()` first.');
        }
        return this.#solve(instanceJson, configJson);
    }
}

//// WIRE MAPPING ////
// The Rust solver speaks the OR-Datasets JSON dialect: PascalCase keys for the
// instance/solution, with sheets under "Objects" and parts under "Items". The
// config, however, is already camelCase. These helpers translate to/from the
// clean public types above and are the single place that knows the wire shape.

interface WireSheet { Length: number; Height: number; Stock: number | null; Cost: number; Reference?: number | null; FirstCut?: Orientation | null }
interface WirePart { Length: number; Height: number; Demand: number; Value: number; Reference?: number | null; CanRotate?: boolean | null }
interface WireInstance { Name: string; Objects: WireSheet[]; Items: WirePart[] }

interface WireConfig
{
    avgNodesRemoved: number;
    blinkRate: number;
    maxRunTime: number | null;
    maxRRIterations: number | null;
    leftoverValuationPower: number;
    historyLength: number;
    rotationAllowed: boolean;
    nThreads: number;
    sheetValuationMode: SheetValuationMode;
    maxStages: number | null;
    seed: number | null;
}

interface WireNode
{
    Length: number;
    Height: number;
    Orientation?: Orientation;
    Type: 'Structure' | 'Item' | 'Leftover';
    Item?: number;
    Children: WireNode[];
}
interface WireCP { Object: number; Usage: number; Root: WireNode }
interface WireStats { UsagePct: number; PartAreaIncludedPct: number; NObjectsUsed: number; MaterialCost: number; RunTimeMs: number; ConfigPath: string }
interface WireSolution { Name: string; Objects: WireSheet[]; Items: WirePart[]; CuttingPatterns: WireCP[]; Statistics: WireStats }

function toWireInstance(instance: Instance): WireInstance
{
    return {
        Name: instance.name,
        Objects: instance.sheets.map((s): WireSheet => ({
            Length: s.length,
            Height: s.height,
            Stock: s.stock ?? null,
            Cost: s.cost,
            Reference: s.reference ?? null,
            FirstCut: s.firstCut ?? null,
        })),
        Items: instance.parts.map((p): WirePart => ({
            Length: p.length,
            Height: p.height,
            Demand: p.demand,
            Value: p.value,
            Reference: p.reference ?? null,
            CanRotate: p.canRotate ?? null,
        })),
    };
}

function toWireConfig(options: BinPackerOptions): WireConfig
{
    const o = { ...DEFAULT_OPTIONS, ...options };
    if (options.seed != null && !(Number.isSafeInteger(options.seed) && options.seed >= 0))
    {
        throw new Error(`BinPacker.solve(): seed must be a non-negative integer, got ${options.seed}`);
    }
    return {
        avgNodesRemoved: o.avgNodesRemoved,
        blinkRate: o.blinkRate,
        maxRunTime: options.maxRunTime ?? null,
        // the solver would run until a material bound with no budget at all, see DEFAULT_ITERATIONS
        maxRRIterations: options.maxRRIterations ?? (options.maxRunTime == null ? DEFAULT_ITERATIONS : null),
        leftoverValuationPower: o.leftoverValuationPower,
        historyLength: o.historyLength,
        rotationAllowed: o.rotationAllowed,
        nThreads: 1, // ignored by the wasm build; always single-threaded
        sheetValuationMode: o.sheetValuationMode,
        maxStages: options.maxStages ?? null,
        seed: options.seed ?? null,
    };
}

const NODE_KIND: Record<WireNode['Type'], NodeKind> = {
    Structure: 'structure',
    Item: 'item',
    Leftover: 'leftover',
};

function fromWireSheet(s: WireSheet): Sheet
{
    return { length: s.Length, height: s.Height, stock: s.Stock, cost: s.Cost, reference: s.Reference ?? null, firstCut: s.FirstCut ?? null };
}

function fromWirePart(p: WirePart): Part
{
    return { length: p.Length, height: p.Height, demand: p.Demand, value: p.Value, reference: p.Reference ?? null, canRotate: p.CanRotate ?? null };
}

function fromWireNode(n: WireNode): CuttingNode
{
    const node: CuttingNode = {
        length: n.Length,
        height: n.Height,
        kind: NODE_KIND[n.Type],
        children: n.Children.map(fromWireNode),
    };
    if (n.Orientation !== undefined) node.orientation = n.Orientation;
    if (n.Item !== undefined) node.item = n.Item;
    return node;
}

function fromWireSolution(s: WireSolution): Solution
{
    return {
        name: s.Name,
        sheets: s.Objects.map(fromWireSheet),
        parts: s.Items.map(fromWirePart),
        patterns: s.CuttingPatterns.map((cp): CuttingPattern => ({
            sheet: cp.Object,
            usage: cp.Usage,
            root: fromWireNode(cp.Root),
        })),
        stats: {
            usagePct: s.Statistics.UsagePct,
            partAreaIncludedPct: s.Statistics.PartAreaIncludedPct,
            objectsUsed: s.Statistics.NObjectsUsed,
            materialCost: s.Statistics.MaterialCost,
            runTimeMs: s.Statistics.RunTimeMs,
        },
    };
}
