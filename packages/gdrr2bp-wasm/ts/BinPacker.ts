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
}

/** A bin-packing problem instance: the parts to place and the sheets available. */
export interface Instance
{
    name: string;
    sheets: Sheet[];
    parts: Part[];
}

/** Algorithm parameters. At least one of `maxRunTime` / `maxRRIterations` should
 *  be set, otherwise the solver runs until its minimum material limit is reached
 *  (effectively unbounded for large instances). */
export interface BinPackerOptions
{
    /** Wall-clock budget in seconds. Omit/null for no time limit. */
    maxRunTime?: number | null;
    /** Hard cap on ruin & recreate iterations. Omit/null for no limit. */
    maxRRIterations?: number | null;
    /** Allow 90° rotation of parts. Default `true`. */
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
    /** Max number of guillotine cutting stages. Omit/null for unlimited. */
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
const DEFAULT_OPTIONS: Required<Omit<BinPackerOptions, 'maxRunTime' | 'maxRRIterations' | 'maxStages'>> = {
    rotationAllowed: true,
    avgNodesRemoved: 5,
    blinkRate: 0.01,
    leftoverValuationPower: 2,
    historyLength: 500,
    sheetValuationMode: 'area',
};

export class BinPacker
{
    #solve: WasmSolve | null = null;

    /** Load and instantiate the WebAssembly module. Must be awaited before
     *  calling `solve`. Returns `this` so you can write
     *  `const bp = await new BinPacker().init()`. Safe to call more than once.
     *
     *  Loads the WASM from an inlined base64 string so it works in every
     *  bundler and test environment without needing ESM WASM support. */
    async init(): Promise<this>
    {
        if (this.#solve !== null) return this;

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

        this.#solve = bg.solve as WasmSolve;
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

interface WireSheet { Length: number; Height: number; Stock: number | null; Cost: number; Reference?: number | null }
interface WirePart { Length: number; Height: number; Demand: number; Value: number; Reference?: number | null }
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
        })),
        Items: instance.parts.map((p): WirePart => ({
            Length: p.length,
            Height: p.height,
            Demand: p.demand,
            Value: p.value,
            Reference: p.reference ?? null,
        })),
    };
}

function toWireConfig(options: BinPackerOptions): WireConfig
{
    const o = { ...DEFAULT_OPTIONS, ...options };
    return {
        avgNodesRemoved: o.avgNodesRemoved,
        blinkRate: o.blinkRate,
        maxRunTime: options.maxRunTime ?? null,
        maxRRIterations: options.maxRRIterations ?? null,
        leftoverValuationPower: o.leftoverValuationPower,
        historyLength: o.historyLength,
        rotationAllowed: o.rotationAllowed,
        nThreads: 1, // ignored by the wasm build; always single-threaded
        sheetValuationMode: o.sheetValuationMode,
        maxStages: options.maxStages ?? null,
    };
}

const NODE_KIND: Record<WireNode['Type'], NodeKind> = {
    Structure: 'structure',
    Item: 'item',
    Leftover: 'leftover',
};

function fromWireSheet(s: WireSheet): Sheet
{
    return { length: s.Length, height: s.Height, stock: s.Stock, cost: s.Cost, reference: s.Reference ?? null };
}

function fromWirePart(p: WirePart): Part
{
    return { length: p.Length, height: p.Height, demand: p.Demand, value: p.Value, reference: p.Reference ?? null };
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
