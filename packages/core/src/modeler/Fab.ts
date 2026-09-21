/**
 * Fab.ts
 *
 * Fabrication from the model: which parts touch, how they are fastened, how each part is cut and
 * drilled, which stock it comes from, how long it all takes and what it costs. Design and phases:
 * plans/FAB.md.
 *
 *      measure  ->  contacts  ->  joints (norm book rules)  ->  fastenings (patterns)  ->  diagram
 *               ->  part operations (end faces, confirmed and completed by the recipe)
 *
 * Nothing in a script is tagged. Parts, contacts and joints are read from the geometry. The norm book
 * (fab.json, changed per run with fab.configure()) decides what each joint gets. Every number says
 * where it came from, and a contact without a rule is reported, never skipped.
 *
 * Sections
 *   1. Types
 *   2. Book          fab.json, validation, the norm book from a sheet, run configuration, the rule matcher
 *   3. Measure       planar faces, the part's own axes, kind and direction
 *   4. Contacts      coincident opposite faces and their overlap
 *   5. Joints        fills, the first matching joint row, the layout with the source of each value
 *   6. Parts         saw cuts, drillings, notches, sheets and fills; FAB_RULES for recipe tools
 *   7. Patterns      endRow, row, corners, sheet, toe. THE place to add a layout.
 *   8. Fastenings    entry points, direction, length, checks
 *   9. Diagram       a circle on the drill plane and a line along each fastener
 *  10. Script API    contact(), connections(), fasten(), operations(), configure(), config() (normBook() is in 2)
 *  11. Estimate      minutes per operation, stock allocation, costs; FabEstimate; compare() with actuals
 *  12. Explain
 *
 * Loaded on demand (Modeler.loadFabModule): the Runner loads it before a script that uses `fab`, and
 * records recipes for that run. Mesh kernel only. Everything is measured on the planar faces of each
 * solid, so angled cuts and sloped parts need no special cases. The recipe, when there is one, confirms
 * each face (a face no primitive explains is reported) and adds what faces cannot show: drillings and
 * notches, with the exact tool that made them.
 *
 * Prior art: brep/MakeOperations.ts (removed; its header is kept in plans/JOINERY.md) planned the same
 * chain: give shapes a meaning, read the operations done to them, gather time, price and waste, and
 * write machine files such as BTLx. It asked scripts to tag shapes (`.is('beam')`) and to call cut
 * operations by hand. This module reads both from the model instead.
 */

import { Type, type TSchema } from 'typebox';
import { Check, Errors } from 'typebox/value';

import type { Modeler } from './Modeler';
import { meshFaces, newell, dot, sub, add, scale, cross, len, unit, type Vec3 } from './exportGeometry';
import { MM_PER_UNIT } from '../units/UnitConverter';
import {
    recipeOf, resolveRecipe, classify, toolOpsOf, leafPlanes, affineFrame, affineApply, nodeBounds,
    type RecipeNode, type LeafNode, type BooleanOp, type ClassificationRule, type Classifications,
} from './Recipe';
import BOOK_JSON from './fab.json';

/** First line of explain(). Also the marker buildscripts/check-pack.ts uses to prove this module stays lazy. */
export const FAB_HEADER = 'Archiyou fab: fabrication from the model';

//// 1. TYPES ////

export type FabKind = 'stick' | 'sheet' | 'block' | 'fill';
export type FabDirection = 'vertical' | 'horizontal' | 'sloped';
export type FaceRole = 'end' | 'side' | 'face' | 'edge';
export type FabMethod = 'through' | 'toe' | 'none';
export type FabRelation = 'parallel' | 'perpendicular' | 'skew';
/** Where a value came from: fab.json, a norm book from a sheet (fab.normBook()), fab.configure(),
 *  fab.operations() options, fab.fasten() options, computed, or a pattern default */
export type FabSource = 'book' | 'sheet' | 'run' | 'call' | 'pair' | 'auto' | 'default';
export type FabDetail = 'diagram' | 'none' | 'full';

type P2 = [number, number];

/** A fastener. Sizes in mm. */
export interface Fastener
{
    type: string
    diameter: number
    length: number
}

export interface FastenerSpec
{
    type: string
    diameter: number
    length: number | 'auto'
}

/** How a joint is fastened with one method. Lengths in mm. Which keys matter depends on the pattern. */
export interface JointSpec
{
    pattern: string
    fastener: FastenerSpec
    from?: 'auto' | 'thinner' | 'sheet' | 'a' | 'b'
    count?: number
    inset?: number | 'auto'
    pitch?: number
    edgePitch?: number
    edgeZone?: number
    end?: number
    rows?: 'auto' | 1 | 2
    rowsAutoFrom?: number
    stagger?: boolean
    edge?: number
    start?: number | 'auto'
    angle?: number
    penetration?: number
}

export type WhenValue = string | number | boolean | Array<string | number>;

export interface JointRow
{
    joint: string
    when: Record<string, WhenValue>
    method: FabMethod
    through?: JointSpec
    toe?: JointSpec
    /** What to do when every entry of a through fastening is covered by a part that is itself fastened through
     *  the same part from the other side: 'toe' fastens the later of the two toe-wise, 'keep' leaves both */
    covered?: 'toe' | 'keep'
    note?: string
    source?: string
    confidence?: string
    /** Where the row is: 'joints#2' is the third row of fab.json, 'run1#0' the first row the first fab.configure() added */
    rule: string
    /** Where each value came from, keyed 'method' or '<method>.<key>' */
    sources: Record<string, FabSource>
}

export interface FabMeasureSettings
{
    contactTolerance: number
    angleTolerance: number
    relationTolerance: number
    minContactArea: number
    stickMinLengthRatio: number
    stickMaxSectionAspect: number
    sheetMinAspect: number
    verticalDeg: number
    horizontalDeg: number
    fillMinWidth: number
    fillMaterialGroups: string[]
    fillNames: string[]
}

export interface FabCheckSettings
{
    minPenetrationD: number
    minEdgeD: number
    minSpacingD: number
    minCover: number
}

export interface CatalogueFastener extends Fastener
{
    /** Price per piece */
    price?: number
    source?: string
    confidence?: string
    /** The catalogue row it came from: 'fasteners#3' */
    rule: string
}

/** The hourly labour rate the times are priced at */
export interface FabRates
{
    currency: string
    labour: number
    source?: string
    confidence?: string
}

/** Minutes for one kind of operation. `unit` says what `minutes` is per; `setup` is added once per joint. */
export interface TimeRow
{
    op: string
    when: Record<string, WhenValue>
    unit: string
    minutes: number
    setup?: number
    note?: string
    source?: string
    confidence?: string
    rule: string
}

/** What parts are cut from, and what that costs. Sizes in mm. */
export interface StockRow
{
    when: Record<string, WhenValue>
    lengths?: number[]
    pricePerM?: number
    kerf?: number
    minOffcut?: number
    size?: [number, number]
    pricePerM2?: number
    pricePerM3?: number
    wastePct?: number
    note?: string
    source?: string
    confidence?: string
    rule: string
}

/** The norm book in effect: fab.json (or the tables given to fab.normBook()) with this run's fab.configure() changes */
export interface FabBook
{
    version: string
    about: Record<string, string>
    measure: FabMeasureSettings
    checks: FabCheckSettings
    fasteners: CatalogueFastener[]
    joints: JointRow[]
    rates: FabRates
    times: TimeRow[]
    stock: StockRow[]
    /** Number of fab.configure() changes on top of fab.json */
    changes: number
}

/** A change to one joint. Layout keys given directly (count, pitch, ...) change the layout of the method in use. */
export type JointPatch = Partial<Pick<JointRow, 'when' | 'method' | 'covered' | 'note' | 'source' | 'confidence'>>
    & Partial<JointSpec>
    & { through?: Partial<JointSpec>, toe?: Partial<JointSpec> };

export interface CatalogueRow
{
    type: string
    diameter: number
    length?: number
    lengths?: number[]
    price?: number
    prices?: number[]
    source?: string
    note?: string
    confidence?: string
}

export interface FabBookPatch
{
    measure?: Partial<FabMeasureSettings>
    checks?: Partial<FabCheckSettings>
    fasteners?: CatalogueRow[]
    /** By joint name: change those rows. As a list: new rows, read before the existing ones. */
    joints?: Record<string, JointPatch> | Array<Omit<JointRow, 'rule' | 'sources'>>
    rates?: Partial<FabRates>
    /** New time rows, read before the existing ones */
    times?: Array<Omit<TimeRow, 'rule'>>
    /** New stock rows, read before the existing ones */
    stock?: Array<Omit<StockRow, 'rule'>>
}

/** A norm book table as a spreadsheet gives it: one object per row, keyed by the column header */
export type SheetRows = Array<Record<string, unknown>>;

/** The norm book kept as tables, for example in a Google Sheet read with cloudcalc (`wb.table('joints')`).
 *  Headers with dots nest (`when.contact`, `through.fastener.diameter`), lists are written in one cell
 *  (`lengths`: `2400, 3000, 3600`), and empty cells are left out. A table given replaces that part of
 *  fab.json; `rates`, `measure` and `checks` are one row, or `key` and `value` columns. */
export interface NormBookTables
{
    joints?: SheetRows
    fasteners?: SheetRows
    times?: SheetRows
    stock?: SheetRows
    rates?: SheetRows | Record<string, unknown>
    measure?: SheetRows | Record<string, unknown>
    checks?: SheetRows | Record<string, unknown>
}

export interface NormBookOptions
{
    /** Names the rows: with 'norms' the first row under the header of the joints table is 'norms.joints#0' */
    name: string
    /** Written on every table, metric and file the book is used for */
    version: string
}

/** A plane of a part: its coplanar faces as convex polygons, with the outward normal */
export interface FabPlane
{
    normal: Vec3
    offset: number
    area: number
    pieces: Vec3[][]
}

/** A solid as fabrication sees it */
export interface FabMember
{
    id: number
    name: string
    shape: any
    kind: FabKind
    direction: FabDirection
    /** Sizes in model units, thickness <= width <= length, along the matching unit axes */
    thickness: number
    width: number
    length: number
    axes: { thin: Vec3, wide: Vec3, long: Vec3 }
    center: Vec3
    /** Thickness x width in mm, the way the norm book writes it: '38x120' */
    section: string
    /** Volume over the volume of its box: 1 for a plain beam, less for a cut or notched one */
    fill: number
    material: { name: string, group: string } | null
    /** Lower case words of the name without position words: 'openingKingStudLeft' gives opening, king, stud */
    words: string[]
    planes: FabPlane[]
    bbox: { min: Vec3, max: Vec3 }
    evidence: string
    /** What the workshop does to this part: saw cuts, drillings, notches, or sheathing and insulating */
    ops: PartOperation[]
    /** Whether the part's recipe was recorded: 'live' confirms and completes the ops, 'baked' and 'none'
     *  leave them measured from the faces only */
    recipe: 'live' | 'baked' | 'none'
    recipeNote: string | null
    /** Things about this part that need a look */
    warnings: string[]
}

/** A saw cut at one end of a part. Angles in degrees, 90 is square. */
export interface SawCut
{
    op: 'sawCut'
    /** 'start' is the lower end along the part's long axis */
    end: 'start' | 'end'
    /** The cut as seen on the wide face (width × length), 90 is square */
    angle: number
    /** The cut as seen on the narrow face (thickness × length), 90 is square */
    inclination: number
    /** A double cut: the second plane */
    second?: { angle: number, inclination: number }
    kind: 'square' | 'angled' | 'compound' | 'double'
    /** The cut plane(s): outward normal and a point, in model coordinates (for exporters) */
    planes: Array<{ normal: Vec3, point: Vec3 }>
    /** For a double cut: whether the end is pointed (both planes cut material away), not a V cut into the part */
    convex: boolean
    origin: 'derived' | 'measured'
    evidence: string
}

/** A hole drilled into a part. Sizes in mm. */
export interface Drilling
{
    op: 'drilling'
    diameter: number
    depth: number
    through: boolean
    /** The face it is drilled from: 'wide' (width × length), 'narrow' (thickness × length) or 'end' */
    face: 'wide' | 'narrow' | 'end'
    /** From the start of the part along its length, and across the face from its middle */
    along: number
    across: number
    /** Degrees between the drill and the face's normal, 0 is square */
    tilt: number
    /** Where the drill enters and the unit direction it goes in, in model coordinates (for exporters) */
    entry: Vec3
    axis: Vec3
    /** Set on the holes of fasteners (ops.holes()): the joint and parts it is for. The fastening times it,
     *  and BTLx writes it only when asked to ({ holes: true }). */
    fastener?: string
    origin: 'derived'
    evidence: string
}

/** Material removed that is not a saw cut or drilling (a lap, notch, rebate), or something not recognised */
export interface Processing
{
    op: 'notch' | 'unknown'
    origin: 'derived' | 'measured'
    evidence: string
}

/** A sheet to fix to the frame. Sizes in mm, area in m². */
export interface Sheathe
{
    op: 'sheathe'
    width: number
    length: number
    thickness: number
    area: number
    /** Not a plain rectangle: cut to shape or with openings */
    shaped: boolean
    origin: 'measured'
    evidence: string
}

/** Insulation to put in. Thickness in mm, area in m², volume in m³. */
export interface Insulate
{
    op: 'insulate'
    thickness: number
    area: number
    volume: number
    origin: 'measured'
    evidence: string
}

export type PartOperation = SawCut | Drilling | Processing | Sheathe | Insulate;

export interface Contact
{
    a: FabMember
    b: FabMember
    /** The part that ends or lies on the other. With a sheet: the sheet. Otherwise the thinner one. */
    entering: FabMember
    receiving: FabMember
    /** Roles of the touching faces, entering first: 'end-side', 'side-side', 'face-side', 'end-end', ... */
    kind: string
    /** How the long axes of the two parts relate */
    relation: FabRelation
    /** On the contact plane: the centre of the overlap, the unit normal from the receiving into the
     *  entering part, and two in-plane unit axes */
    origin: Vec3
    normal: Vec3
    u: Vec3
    v: Vec3
    /** Overlap as convex polygons in (u, v) around the origin, model units */
    pieces: P2[][]
    rect: [P2, P2]
    area: number
    /** Faces the parts touch on; the largest is the contact */
    faces: number
    roles: [FaceRole, FaceRole]
    evidence: string
}

export interface FastenerPlacement
{
    /** Where the fastener enters: on the face it is driven through */
    point: Vec3
    /** Unit direction it is driven in */
    dir: Vec3
    /** Length in model units */
    length: number
}

/** How one contact is fastened, or why it is not */
export interface Fastening
{
    op: 'fasten'
    joint: string | null
    rule: string | null
    contact: Contact
    method: FabMethod
    pattern: string | null
    /** The part the fasteners are driven through; for toe fastening the entering part */
    from: FabMember | null
    fastener: Fastener | null
    fasteners: FastenerPlacement[]
    count: number
    /** The layout used, lengths in mm */
    spec: Record<string, unknown>
    sources: Record<string, FabSource>
    status: 'ok' | 'warning' | 'unmatched' | 'none'
    warnings: string[]
    notes: string[]
    evidence: string
    /** Parts that cover an entry point: fasten before placing them */
    coveredBy: FabMember[]
    /** The diagram curves (detail 'diagram') or the fastener parts (detail 'full'), when drawn */
    shapes: any[]
}

export interface ContactOptions
{
    /** Distance in mm below which faces touch. Default: measure.contactTolerance. */
    tolerance?: number
    /** Include hidden solids (connections() only) */
    hidden?: boolean
}

export interface FastenOptions extends Partial<JointSpec>
{
    /** Use this joint's rules instead of the one the contact matches */
    joint?: string
    method?: FabMethod
    detail?: FabDetail
    tolerance?: number
}

export interface OperationsOptions
{
    /** Changes to joints for this call, by joint name */
    joints?: Record<string, JointPatch>
    detail?: FabDetail
    tolerance?: number
    hidden?: boolean
}

/** Per-run state. Lives on the Modeler, which drops it in reset(). */
export interface FabRunState
{
    /** The book fab.normBook() made this run, instead of fab.json */
    base: FabBook | null
    changes: FabBookPatch[]
    book: FabBook | null
    pairs: Map<string, FastenOptions>
    drawn: Map<string, { hash: string, shapes: any[] }>
    layer: any | null
    /** The fastener parts made with detail 'full', left out of measuring */
    hardware: WeakSet<object>
    hardwareLayer: any | null
}

/** What scripts get as `fab` */
export interface FabFacade
{
    contact(a: any, b: any, options?: ContactOptions): Contact | null
    connections(shapes: any, options?: ContactOptions): Contact[]
    fasten(a: any, b: any, options?: FastenOptions): Fastening
    operations(shapes: any, options?: OperationsOptions): FabOperations
    estimate(ops: FabOperations, options?: EstimateOptions): FabEstimate
    configure(patch: FabBookPatch): FabFacade
    normBook(tables: NormBookTables, options: NormBookOptions): FabFacade
    config(): FabBook
}

/** Book settings in model units, as the measuring and layout code use them */
export interface Settings extends FabMeasureSettings, FabCheckSettings
{
    /** Millimetres per model unit */
    mm: number
    tolerance: number
    minArea: number
    cosAngle: number
    sinAngle: number
    cosRelation: number
    sinRelation: number
    toModel(mm: number): number
    text(modelLength: number): string
}

//// 2. BOOK ////

const METHODS = ['through', 'toe'] as const;
const ROW_KEYS = ['joint', 'when', 'method', 'through', 'toe', 'covered', 'note', 'source', 'confidence'];
const WHEN_KEYS = ['contact', 'kinds', 'relation', 'entering', 'receiving', 'direction', 'section', 'thickness', 'material', 'name'];
const SPEC_KEYS = ['pattern', 'fastener', 'from', 'count', 'inset', 'pitch', 'edgePitch', 'edgeZone', 'end', 'rows',
    'rowsAutoFrom', 'stagger', 'edge', 'start', 'angle', 'penetration'];
const FASTENER_KEYS = ['type', 'diameter', 'length'];
const CATALOGUE_KEYS = ['type', 'diameter', 'length', 'lengths', 'price', 'prices', 'source', 'note', 'confidence'];
const RATE_KEYS = ['currency', 'labour', 'source', 'confidence'];
const TIME_KEYS = ['op', 'when', 'unit', 'minutes', 'setup', 'note', 'source', 'confidence'];
const STOCK_KEYS = ['when', 'lengths', 'pricePerM', 'kerf', 'minOffcut', 'size', 'pricePerM2', 'pricePerM3', 'wastePct', 'note', 'source', 'confidence'];
/** What each timed operation is counted in */
const TIME_UNITS: Record<string, string> = {
    handle: 'part', sawCut: 'cut', drilling: 'hole', notch: 'part', unknown: 'part', fasten: 'fastener', sheathe: 'm2', insulate: 'm2',
};
const TIME_WHEN_KEYS = ['kind', 'partKind', 'section', 'material', 'thickness', 'length', 'end', 'through', 'face', 'diameter',
    'depth', 'tilt', 'method', 'joint', 'pattern', 'type', 'shaped'];
const STOCK_WHEN_KEYS = ['partKind', 'section', 'material', 'thickness'];
const MEASURE_KEYS = ['contactTolerance', 'angleTolerance', 'relationTolerance', 'minContactArea', 'stickMinLengthRatio',
    'stickMaxSectionAspect', 'sheetMinAspect', 'verticalDeg', 'horizontalDeg', 'fillMinWidth', 'fillMaterialGroups', 'fillNames'];
const CHECK_KEYS = ['minPenetrationD', 'minEdgeD', 'minSpacingD', 'minCover'];

const Positive = Type.Number({ exclusiveMinimum: 0 });
const NonNegative = Type.Number({ minimum: 0 });
const Words = Type.Array(Type.String());

const FastenerSpecSchema = Type.Object({
    type:     Type.String({ minLength: 1 }),
    diameter: Positive,
    length:   Type.Union([Positive, Type.Literal('auto')]),
});

const JointSpecSchema = Type.Object({
    pattern:      Type.String({ minLength: 1 }),
    fastener:     FastenerSpecSchema,
    from:         Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('thinner'), Type.Literal('sheet'), Type.Literal('a'), Type.Literal('b')])),
    count:        Type.Optional(Type.Integer({ minimum: 1 })),
    inset:        Type.Optional(Type.Union([NonNegative, Type.Literal('auto')])),
    pitch:        Type.Optional(Positive),
    edgePitch:    Type.Optional(Positive),
    edgeZone:     Type.Optional(NonNegative),
    end:          Type.Optional(NonNegative),
    rows:         Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal(1), Type.Literal(2)])),
    rowsAutoFrom: Type.Optional(NonNegative),
    stagger:      Type.Optional(Type.Boolean()),
    edge:         Type.Optional(NonNegative),
    start:        Type.Optional(Type.Union([NonNegative, Type.Literal('auto')])),
    angle:        Type.Optional(Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 90 })),
    penetration:  Type.Optional(Positive),
});

const WhenValueSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.Union([Type.String(), Type.Number()]))]);

const JointRowSchema = Type.Object({
    joint:      Type.String({ minLength: 1 }),
    when:       Type.Record(Type.String(), WhenValueSchema),
    method:     Type.Union([Type.Literal('through'), Type.Literal('toe'), Type.Literal('none')]),
    through:    Type.Optional(JointSpecSchema),
    toe:        Type.Optional(JointSpecSchema),
    covered:    Type.Optional(Type.Union([Type.Literal('toe'), Type.Literal('keep')])),
    note:       Type.Optional(Type.String()),
    source:     Type.Optional(Type.String()),
    confidence: Type.Optional(Type.String()),
});

const Texts = {
    note:       Type.Optional(Type.String()),
    source:     Type.Optional(Type.String()),
    confidence: Type.Optional(Type.String()),
};

const CatalogueRowSchema = Type.Object({
    type:     Type.String({ minLength: 1 }),
    diameter: Positive,
    length:   Type.Optional(Positive),
    lengths:  Type.Optional(Type.Array(Positive, { minItems: 1 })),
    price:    Type.Optional(NonNegative),
    prices:   Type.Optional(Type.Array(NonNegative)),
    ...Texts,
});

const RatesSchema = Type.Object({
    currency:   Type.String({ minLength: 1 }),
    labour:     NonNegative,
    source:     Type.Optional(Type.String()),
    confidence: Type.Optional(Type.String()),
});

const TimeRowSchema = Type.Object({
    op:      Type.String({ minLength: 1 }),
    when:    Type.Optional(Type.Record(Type.String(), WhenValueSchema)),
    unit:    Type.String({ minLength: 1 }),
    minutes: NonNegative,
    setup:   Type.Optional(NonNegative),
    ...Texts,
});

const StockRowSchema = Type.Object({
    when:       Type.Optional(Type.Record(Type.String(), WhenValueSchema)),
    lengths:    Type.Optional(Type.Array(Positive, { minItems: 1 })),
    pricePerM:  Type.Optional(NonNegative),
    kerf:       Type.Optional(NonNegative),
    minOffcut:  Type.Optional(NonNegative),
    size:       Type.Optional(Type.Tuple([Positive, Positive])),
    pricePerM2: Type.Optional(NonNegative),
    pricePerM3: Type.Optional(NonNegative),
    wastePct:   Type.Optional(NonNegative),
    ...Texts,
});

const MeasureSchema = Type.Object({
    contactTolerance:      NonNegative,
    angleTolerance:        Positive,
    relationTolerance:     Positive,
    minContactArea:        NonNegative,
    stickMinLengthRatio:   Positive,
    stickMaxSectionAspect: Positive,
    sheetMinAspect:        Positive,
    verticalDeg:           NonNegative,
    horizontalDeg:         NonNegative,
    fillMinWidth:          NonNegative,
    fillMaterialGroups:    Words,
    fillNames:             Words,
});

const ChecksSchema = Type.Object({
    minPenetrationD: NonNegative,
    minEdgeD:        NonNegative,
    minSpacingD:     NonNegative,
    minCover:        NonNegative,
});

function clone<T>(value: T): T
{
    return JSON.parse(JSON.stringify(value));
}

/** Keys starting with // are comments, in fab.json and in changes */
function withoutComments<T>(value: T): T
{
    if (Array.isArray(value)) return value.map(withoutComments) as T;
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !key.startsWith('//'))
        .map(([key, v]) => [key, withoutComments(v)])) as T;
}

function assertObject(value: unknown, where: string, example: string): void
{
    if (!value || typeof value !== 'object' || Array.isArray(value))
    {
        throw new Error(`fab: ${where} must be an object, like ${example}`);
    }
}

function assertKeys(value: object, known: readonly string[], where: string): void
{
    const unknown = Object.keys(value ?? {}).filter(key => !key.startsWith('//') && !known.includes(key));
    if (unknown.length)
    {
        throw new Error(`fab: unknown ${unknown.length > 1 ? 'keys' : 'key'} ${unknown.map(k => `'${k}'`).join(', ')} in ${where}. `
            + `Known: ${known.join(', ')}`);
    }
}

function assertSchema(schema: TSchema, value: unknown, where: string): void
{
    if (Check(schema, value)) return;
    const first: any = [...Errors(schema, value)][0];
    const at = first?.instancePath ? ` at ${first.instancePath}` : '';
    throw new Error(`fab: ${where}${at}: ${first?.message ?? 'is not valid'}`);
}

function assertFastener(fastener: unknown, where: string): void
{
    if (typeof fastener === 'string')
    {
        throw new Error(`fab: ${where} fastener is the text '${fastener}'. Give it as an object: `
            + `{ type: 'screw', diameter: 5, length: 90 } (length may be 'auto')`);
    }
    if (fastener !== undefined)
    {
        assertObject(fastener, `${where} fastener`, `{ type: 'screw', diameter: 5, length: 90 }`);
        assertKeys(fastener as object, FASTENER_KEYS, `${where} fastener`);
    }
}

/** A joint row as written (without rule and sources) must make sense on its own */
function checkRow(row: any, where: string): void
{
    assertObject(row, where, `{ joint: 'stud-plate', when: { contact: 'end-side' }, method: 'none' }`);
    assertKeys(row, ROW_KEYS, where);
    if (row.when !== undefined)
    {
        assertObject(row.when, `${where} when`, `{ contact: 'end-side', kinds: 'stick+stick' }`);
        assertKeys(row.when, WHEN_KEYS, `${where} when`);
    }
    METHODS.filter(method => row[method] !== undefined).forEach(method =>
    {
        const spec = row[method];
        const at = `${where} ${method}`;
        assertObject(spec, at, `{ pattern: 'endRow', fastener: { type: 'screw', diameter: 5, length: 'auto' } }`);
        assertKeys(spec, SPEC_KEYS, at);
        assertFastener(spec.fastener, at);
        const pattern = PATTERNS[spec.pattern];
        if (!pattern)
        {
            throw new Error(`fab: ${at}: unknown pattern '${spec.pattern}'. Patterns: ${Object.keys(PATTERNS).join(', ')}`);
        }
        if (pattern.method !== method)
        {
            throw new Error(`fab: ${at}: '${spec.pattern}' is a ${pattern.method} pattern, it cannot lay out ${method} fastening`);
        }
        if (method === 'toe' && spec.fastener?.length === 'auto')
        {
            throw new Error(`fab: ${at}: a toe fastener needs a length in mm, not 'auto'`);
        }
    });
    assertSchema(JointRowSchema, row, where);
    if (row.method !== 'none' && !row[row.method])
    {
        throw new Error(`fab: ${where}: method is '${row.method}' but there is no ${row.method} layout. `
            + `Add ${row.method}: { pattern, fastener, ... }`);
    }
}

function toRow(raw: any, rule: string, source: FabSource): JointRow
{
    const row = clone(withoutComments(raw)) as JointRow;
    row.when = row.when ?? {};
    row.rule = rule;
    row.sources = { method: source };
    METHODS.filter(method => row[method]).forEach(method =>
        Object.keys(row[method]).forEach(key => row.sources[`${method}.${key}`] = source));
    return row;
}

/** The part of a row that is written by people, for validation */
function writtenRow(row: JointRow): Omit<JointRow, 'rule' | 'sources'>
{
    const { rule, sources, ...written } = row;
    return written;
}

/** `indices` keep the row numbers of a table with blank rows left out */
function timeRows(rows: unknown, where: string, prefix: string, indices?: number[]): TimeRow[]
{
    if (!Array.isArray(rows)) throw new Error(`fab: ${where} must be a list, like [{ op: 'sawCut', unit: 'cut', minutes: 0.5 }]`);
    return rows.map((raw, k) =>
    {
        const i = indices?.[k] ?? k;
        const row = withoutComments(raw);
        const at = `${where}#${i}`;
        assertObject(row, at, `{ op: 'sawCut', when: { kind: 'angled' }, unit: 'cut', minutes: 1 }`);
        assertKeys(row, TIME_KEYS, at);
        assertSchema(TimeRowSchema, row, at);
        if (!TIME_UNITS[row.op]) throw new Error(`fab: ${at}: no operation '${row.op}'. Operations: ${Object.keys(TIME_UNITS).join(', ')}`);
        if (row.unit !== TIME_UNITS[row.op])
        {
            throw new Error(`fab: ${at}: a ${row.op} is timed per ${TIME_UNITS[row.op]}, not per ${row.unit}`);
        }
        assertKeys(row.when ?? {}, TIME_WHEN_KEYS, `${at} when`);
        return { ...clone(row), when: row.when ?? {}, rule: `${prefix}#${i}` };
    });
}

function stockRows(rows: unknown, where: string, prefix: string, indices?: number[]): StockRow[]
{
    if (!Array.isArray(rows)) throw new Error(`fab: ${where} must be a list, like [{ when: { section: '38x120' }, lengths: [3000], pricePerM: 2 }]`);
    return rows.map((raw, k) =>
    {
        const i = indices?.[k] ?? k;
        const row = withoutComments(raw);
        const at = `${where}#${i}`;
        assertObject(row, at, `{ when: { section: '38x120' }, lengths: [3000, 4800], pricePerM: 2 }`);
        assertKeys(row, STOCK_KEYS, at);
        assertSchema(StockRowSchema, row, at);
        assertKeys(row.when ?? {}, STOCK_WHEN_KEYS, `${at} when`);
        const kinds = [row.lengths !== undefined, row.size !== undefined, row.pricePerM3 !== undefined].filter(Boolean).length;
        if (kinds !== 1)
        {
            throw new Error(`fab: ${at}: give lengths (sticks), size (sheets) or pricePerM3 (fills), exactly one of them`);
        }
        if (row.lengths && row.pricePerM === undefined) throw new Error(`fab: ${at}: lengths need a pricePerM`);
        if (row.size && row.pricePerM2 === undefined) throw new Error(`fab: ${at}: a sheet size needs a pricePerM2`);
        return { ...clone(row), when: row.when ?? {}, rule: `${prefix}#${i}` };
    });
}

function ratesOf(value: unknown, where: string): FabRates
{
    assertObject(value, where, `{ currency: 'EUR', labour: 48 }`);
    const rates = withoutComments(value as any);
    assertKeys(rates, RATE_KEYS, where);
    assertSchema(RatesSchema, rates, where);
    return clone(rates);
}

function expandCatalogue(rows: unknown, where: string, prefix = 'fasteners', indices?: number[]): CatalogueFastener[]
{
    if (!Array.isArray(rows))
    {
        throw new Error(`fab: ${where} must be a list, like [{ type: 'screw', diameter: 5, lengths: [70, 90] }]`);
    }
    return rows.flatMap((raw, k) =>
    {
        const i = indices?.[k] ?? k;
        const row = withoutComments(raw);
        const at = `${where}#${i}`;
        assertObject(row, at, `{ type: 'screw', diameter: 5, lengths: [70, 90] }`);
        assertKeys(row, CATALOGUE_KEYS, at);
        assertSchema(CatalogueRowSchema, row, at);
        const lengths: number[] = row.lengths ?? (row.length !== undefined ? [row.length] : []);
        if (!lengths.length) throw new Error(`fab: ${at} needs a length or lengths`);
        if (row.prices && row.prices.length !== lengths.length)
        {
            throw new Error(`fab: ${at}: ${row.prices.length} prices for ${lengths.length} lengths; give one price per length`);
        }
        return lengths.map((length, k) => ({
            type: row.type, diameter: row.diameter, length,
            ...(row.prices ? { price: row.prices[k] } : row.price !== undefined ? { price: row.price } : {}),
            ...(row.source ? { source: row.source } : {}),
            ...(row.confidence ? { confidence: row.confidence } : {}),
            rule: `${prefix}#${i}`,
        }));
    });
}

const sameFastener = (x: Fastener, y: Fastener) =>
    x.type === y.type && Math.abs(x.diameter - y.diameter) < 1e-9 && Math.abs(x.length - y.length) < 1e-9;

let baseBook: FabBook | null = null;

/** fab.json, validated once */
export function loadBaseBook(): FabBook
{
    if (baseBook) return baseBook;
    const json = withoutComments(BOOK_JSON as any);
    const where = 'fab.json';
    assertKeys(json, ['$schema', 'version', 'about', 'measure', 'checks', 'fasteners', 'rates', 'times', 'stock', 'joints'], where);
    if (typeof json.version !== 'string') throw new Error(`fab: ${where} needs a version`);
    assertKeys(json.measure, MEASURE_KEYS, `${where} measure`);
    assertSchema(MeasureSchema, json.measure, `${where} measure`);
    assertKeys(json.checks, CHECK_KEYS, `${where} checks`);
    assertSchema(ChecksSchema, json.checks, `${where} checks`);
    if (!Array.isArray(json.joints)) throw new Error(`fab: ${where} joints must be a list`);
    baseBook = {
        version: json.version,
        about: { ...(json.about ?? {}) },
        measure: clone(json.measure),
        checks: clone(json.checks),
        fasteners: expandCatalogue(json.fasteners, `${where} fasteners`),
        joints: json.joints.map((raw: any, i: number) =>
        {
            checkRow(raw, `${where} joints#${i}`);
            return toRow(raw, `joints#${i}`, 'book');
        }),
        rates: ratesOf(json.rates, `${where} rates`),
        times: timeRows(json.times, `${where} times`, 'times'),
        stock: stockRows(json.stock, `${where} stock`, 'stock'),
        changes: 0,
    };
    return baseBook;
}

//// the norm book from a sheet ////

const NORM_BOOK_SECTIONS = ['joints', 'fasteners', 'times', 'stock', 'rates', 'measure', 'checks'];
/** Cells that hold a list, written comma separated */
const LIST_KEYS = new Set(['lengths', 'prices', 'size', 'fillMaterialGroups', 'fillNames']);
/** Cells that stay text even when they look like a number */
const TEXT_KEYS = new Set(['joint', 'note', 'source', 'confidence', 'type', 'op', 'unit', 'currency', 'method', 'pattern', 'from', 'covered', 'key']);
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** A cell as a spreadsheet gives it, as the book wants it */
function cellValue(key: string, value: unknown, inWhen: boolean): unknown
{
    if (typeof value !== 'string') return value;
    const text = value.trim();
    if (/^[[{]/.test(text))
    {
        try { return JSON.parse(text); } catch { /* not JSON: read it as text */ }
    }
    if (LIST_KEYS.has(key))
    {
        return text.split(/\s*[,;]\s*/).filter(Boolean).map(part => NUMBER.test(part) ? Number(part) : part);
    }
    if (TEXT_KEYS.has(key)) return text;
    if (NUMBER.test(text)) return Number(text);
    if (inWhen && /^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    return text;
}

/** One table row as a book row: dotted headers nest, empty cells are left out. A blank row gives null. */
function nestRow(row: unknown, where: string): Record<string, any> | null
{
    assertObject(row, where, `{ joint: 'stud-plate', 'when.contact': 'end-side' }`);
    const cells = Object.entries(row as Record<string, unknown>)
        .filter(([key, value]) => !key.startsWith('//') && value !== null && value !== undefined && value !== '');
    if (!cells.length) return null;
    return cells.reduce<Record<string, any>>((acc, [key, value]) =>
    {
        const path = key.split('.').map(part => part.trim());
        if (path.some(part => !part)) throw new Error(`fab: ${where}: column '${key}' is not a name or a dotted path`);
        const parent = path.slice(0, -1).reduce((node, part) =>
        {
            node[part] ??= {};
            if (typeof node[part] !== 'object' || Array.isArray(node[part]))
            {
                throw new Error(`fab: ${where}: column '${key}' goes inside '${part}', which has a value of its own`);
            }
            return node[part];
        }, acc);
        const leaf = path[path.length - 1];
        if (parent[leaf] !== undefined) throw new Error(`fab: ${where}: column '${key}' is given twice`);
        parent[leaf] = cellValue(leaf, value, path[0] === 'when');
        return acc;
    }, {});
}

/** The rows of a table with blank rows left out, and the row number of each */
function sheetRows(rows: unknown, where: string, section: string): { rows: Record<string, any>[], indices: number[] }
{
    if (!Array.isArray(rows)) throw new Error(`fab: ${where} must be the rows of a table, like wb.table('${section}')`);
    const nested = rows.map((row, i) => nestRow(row, `${where}#${i}`));
    return {
        rows: nested.filter((row): row is Record<string, any> => row !== null),
        indices: nested.flatMap((row, i) => row ? [i] : []),
    };
}

/** A settings table: one row, or key and value columns */
function sheetObject(value: unknown, where: string): Record<string, any>
{
    if (!Array.isArray(value)) return nestRow(value, where) ?? {};
    const { rows } = sheetRows(value, where, 'settings');
    if (rows.length && rows.every(row => 'key' in row && Object.keys(row).every(k => ['key', 'value', 'note'].includes(k))))
    {
        return rows.reduce((acc, row) =>
        {
            const pair = nestRow({ [String(row.key)]: typeof row.value === 'number' ? row.value : String(row.value ?? '') }, where) ?? {};
            Object.keys(pair).forEach(key => { if (key in acc) throw new Error(`fab: ${where}: '${key}' is given twice`); });
            return { ...acc, ...pair };
        }, {});
    }
    if (rows.length === 1) return rows[0];
    throw new Error(`fab: ${where}: give one row, or two columns named key and value`);
}

/** Replace parts of fab.json with tables from a sheet, for this run. fab.configure() changes go on top. */
export function normBook(modeler: Modeler, tables: NormBookTables, options: NormBookOptions): void
{
    const example = `fab.normBook({ joints: wb.table('joints'), times: wb.table('times') }, { name: 'norms', version: '2026-10' })`;
    assertObject(tables, 'fab.normBook(tables)', example);
    const given = withoutComments(tables);
    assertKeys(given, NORM_BOOK_SECTIONS, 'fab.normBook(tables)');
    const sections = NORM_BOOK_SECTIONS.filter(section => given[section] !== undefined);
    if (!sections.length) throw new Error(`fab.normBook(): give at least one table, like ${example}`);
    assertObject(options, 'fab.normBook() options', `{ name: 'norms', version: '2026-10' }`);
    assertKeys(options, ['name', 'version'], 'fab.normBook() options');
    const { name, version } = options;
    if (typeof name !== 'string' || !/^[A-Za-z][\w-]*$/.test(name))
    {
        throw new Error(`fab.normBook(): options.name names the rows in every report, a word like 'norms', got ${JSON.stringify(name)}`);
    }
    if (typeof version !== 'string' || !version.trim())
    {
        throw new Error(`fab.normBook(): options.version is written on every output the book is used for, like '2026-10', got ${JSON.stringify(version)}`);
    }
    const state = stateOf(modeler);
    if (state.changes.length)
    {
        throw new Error('fab.normBook(): call it before fab.configure(), so the changes are made to the book from the sheet');
    }
    const base = state.base ?? loadBaseBook();
    const next = clone(base);
    const rowsOf = (section: string) => sheetRows(given[section], `${name} ${section}`, section);
    if (given.joints !== undefined)
    {
        const { rows, indices } = rowsOf('joints');
        next.joints = rows.map((raw, k) =>
        {
            checkRow(raw, `${name} joints#${indices[k]}`);
            return toRow(raw, `${name}.joints#${indices[k]}`, 'sheet');
        });
    }
    if (given.fasteners !== undefined)
    {
        const { rows, indices } = rowsOf('fasteners');
        next.fasteners = expandCatalogue(rows, `${name} fasteners`, `${name}.fasteners`, indices);
    }
    if (given.times !== undefined)
    {
        const { rows, indices } = rowsOf('times');
        next.times = timeRows(rows, `${name} times`, `${name}.times`, indices);
    }
    if (given.stock !== undefined)
    {
        const { rows, indices } = rowsOf('stock');
        next.stock = stockRows(rows, `${name} stock`, `${name}.stock`, indices);
    }
    // rates are replaced whole: a sheet rate must not inherit fab.json's 'placeholder'
    if (given.rates !== undefined) next.rates = ratesOf(sheetObject(given.rates, `${name} rates`), `${name} rates`);
    const settings = (section: 'measure' | 'checks', keys: string[], schema: TSchema) =>
    {
        const values = sheetObject(given[section], `${name} ${section}`);
        assertKeys(values, keys, `${name} ${section}`);
        const merged = { ...next[section], ...values };
        assertSchema(schema, merged, `${name} ${section}`);
        return merged;
    };
    if (given.measure !== undefined) next.measure = settings('measure', MEASURE_KEYS, MeasureSchema) as FabMeasureSettings;
    if (given.checks !== undefined) next.checks = settings('checks', CHECK_KEYS, ChecksSchema) as FabCheckSettings;
    next.version = state.base ? `${base.version} + ${version.trim()}` : version.trim();
    next.about = {
        ...next.about,
        book: `${state.base ? `${base.about.book}; ` : ''}${name} ${version.trim()}: ${sections.join(', ')} from the sheet`
            + `${state.base ? '' : `, the rest from fab.json ${base.version}`}`,
    };
    next.changes = 0;
    state.base = next;
    state.book = null;
}

/** A change on top of a book, validated before anything is applied. `rule` names the rows it adds. */
export function applyBookPatch(book: FabBook, patch: FabBookPatch, source: FabSource, rule: string): FabBook
{
    assertObject(patch, 'fab.configure(change)', `{ joints: { 'stud-plate': { count: 3 } } }`);
    const change = withoutComments(patch);
    assertKeys(change, ['measure', 'checks', 'fasteners', 'joints', 'rates', 'times', 'stock'], 'fab.configure(change)');
    const next = clone(book);
    if (change.measure !== undefined)
    {
        assertObject(change.measure, 'measure', `{ contactTolerance: 1 }`);
        assertKeys(change.measure, MEASURE_KEYS, 'measure');
        next.measure = { ...next.measure, ...change.measure };
        assertSchema(MeasureSchema, next.measure, 'measure');
    }
    if (change.checks !== undefined)
    {
        assertObject(change.checks, 'checks', `{ minPenetrationD: 8 }`);
        assertKeys(change.checks, CHECK_KEYS, 'checks');
        next.checks = { ...next.checks, ...change.checks };
        assertSchema(ChecksSchema, next.checks, 'checks');
    }
    if (change.fasteners !== undefined)
    {
        const added = expandCatalogue(change.fasteners, 'fasteners', `${rule}.fasteners`);
        next.fasteners = [...added, ...next.fasteners.filter(f => !added.some(a => sameFastener(a, f)))];
    }
    if (change.joints !== undefined)
    {
        next.joints = patchJoints(next.joints, change.joints, source, rule);
    }
    if (change.rates !== undefined)
    {
        assertObject(change.rates, 'rates', `{ labour: 52 }`);
        next.rates = ratesOf({ ...next.rates, ...withoutComments(change.rates) }, 'rates');
    }
    if (change.times !== undefined)
    {
        next.times = [...timeRows(change.times, 'times', `${rule}.times`), ...next.times];
    }
    if (change.stock !== undefined)
    {
        next.stock = [...stockRows(change.stock, 'stock', `${rule}.stock`), ...next.stock];
    }
    next.changes += 1;
    return next;
}

function patchJoints(rows: JointRow[], patch: FabBookPatch['joints'], source: FabSource, rule: string): JointRow[]
{
    if (Array.isArray(patch))
    {
        const added = patch.map((raw, i) =>
        {
            checkRow(withoutComments(raw), `new joint row #${i}`);
            return toRow(raw, `${rule}#${i}`, source);
        });
        return [...added, ...rows];
    }
    assertObject(patch, 'joints', `{ 'stud-plate': { count: 3 } }`);
    const names = [...new Set(rows.map(row => row.joint))];
    const unknown = Object.keys(patch).filter(name => !name.startsWith('//') && !names.includes(name));
    if (unknown.length)
    {
        throw new Error(`fab: no joint ${unknown.map(n => `'${n}'`).join(', ')} to change. Joints: ${names.join(', ')}`);
    }
    return rows.map(row => patch[row.joint] ? patchRow(row, patch[row.joint], source, `joint '${row.joint}'`) : row);
}

/** Change one row. Layout keys given directly change the layout of the method in use (after a method change). */
export function patchRow(row: JointRow, patch: JointPatch, source: FabSource, where: string): JointRow
{
    assertObject(patch, where, `{ count: 3 } or { method: 'toe' }`);
    const change = withoutComments(patch) as any;
    assertKeys(change, [...ROW_KEYS.filter(key => key !== 'joint'), ...SPEC_KEYS], where);
    const { method, when, through, toe, covered, note, source: cite, confidence, ...layout } = change;
    const next = clone(row);
    if (method !== undefined)
    {
        next.method = method;
        next.sources.method = source;
    }
    if (when !== undefined)
    {
        assertObject(when, `${where} when`, `{ contact: 'end-side' }`);
        next.when = { ...next.when, ...when };
    }
    if (covered !== undefined) next.covered = covered;
    if (note !== undefined) next.note = note;
    if (cite !== undefined) next.source = cite;
    if (confidence !== undefined) next.confidence = confidence;
    const layouts: Record<string, any> = { through, toe };
    if (Object.keys(layout).length)
    {
        if (next.method === 'none')
        {
            throw new Error(`fab: ${where}: ${Object.keys(layout).map(k => `'${k}'`).join(', ')} change how the joint is `
                + `fastened, but it is not fastened (method 'none'). Set a method as well.`);
        }
        layouts[next.method] = { ...(layouts[next.method] ?? {}), ...layout };
    }
    METHODS.filter(m => layouts[m] !== undefined).forEach(m =>
    {
        const spec = layouts[m];
        assertObject(spec, `${where} ${m}`, `{ count: 3 }`);
        assertFastener(spec.fastener, `${where} ${m}`);
        const fastener = spec.fastener ? { ...(next[m]?.fastener ?? {}), ...spec.fastener } : next[m]?.fastener;
        next[m] = { ...(next[m] ?? {}), ...spec, ...(fastener ? { fastener } : {}) } as JointSpec;
        Object.keys(spec).forEach(key => next.sources[`${m}.${key}`] = source);
    });
    checkRow(writtenRow(next), where);
    return next;
}

function matchOne(alt: string, value: unknown): boolean
{
    if (alt === '*') return value !== undefined && value !== null && value !== '';
    const compare = alt.match(/^(!=|>=|<=|>|<)\s*(.+)$/);
    if (compare)
    {
        const [, op, rhs] = compare;
        if (op === '!=') return !matchOne(rhs.trim(), value);
        const limit = Number(rhs);
        if (typeof value !== 'number' || !Number.isFinite(limit)) return false;
        return op === '>' ? value > limit : op === '>=' ? value >= limit : op === '<' ? value < limit : value <= limit;
    }
    const range = alt.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
    if (range && typeof value === 'number' && Number(range[1]) < Number(range[2]))
    {
        return value >= Number(range[1]) && value <= Number(range[2]);
    }
    if (typeof value === 'number')
    {
        const n = Number(alt);
        return alt !== '' && Number.isFinite(n) && Math.abs(n - value) < 1e-6;
    }
    if (typeof value !== 'string') return false;
    if (alt.includes('*'))
    {
        const pattern = alt.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return new RegExp(`^${pattern}$`).test(value);
    }
    return alt === value;
}

/** Does a norm book condition hold for a value? Conditions: 'a|b', '!=a', '>30', '<=12', '20-40', '*' wildcards,
 *  a number, a boolean, or a list of alternatives. */
export function matches(cond: WhenValue, value: unknown): boolean
{
    if (Array.isArray(cond)) return cond.some(c => matches(c, value));
    if (typeof cond === 'boolean') return value === cond;
    if (typeof cond === 'number') return typeof value === 'number' && Math.abs(value - cond) < 1e-6;
    if (typeof cond !== 'string') return false;
    return cond.split('|').map(alt => alt.trim()).some(alt => matchOne(alt, value));
}

/** An unordered pair condition: 'sheet+stick', 'fill+*', 'stick|block+stick|block' ('+' splits the pair,
 *  then each side is a condition of its own). A list gives alternative pairs. */
function matchesPair(cond: WhenValue, x: string, y: string): boolean
{
    if (Array.isArray(cond)) return cond.some(alt => matchesPair(alt, x, y));
    const [p, q = '*'] = String(cond).split('+').map(side => side.trim());
    return (matches(p, x) && matches(q, y)) || (matches(p, y) && matches(q, x));
}

function whenHolds(when: Record<string, WhenValue>, c: Contact, s: Settings): boolean
{
    const e = c.entering, r = c.receiving;
    return Object.entries(when).every(([key, cond]) =>
    {
        switch (key)
        {
            case 'contact': return matches(cond, c.kind);
            case 'kinds': return matchesPair(cond, e.kind, r.kind);
            case 'relation': return matches(cond, c.relation);
            case 'entering': return matches(cond, e.direction);
            case 'receiving': return matches(cond, r.direction);
            case 'direction': return matches(cond, e.direction) && matches(cond, r.direction);
            case 'section': return matches(cond, e.section);
            case 'thickness': return matches(cond, round1(e.thickness * s.mm));
            case 'material': return [e, r].some(m => !!m.material && (matches(cond, m.material.name) || matches(cond, m.material.group)));
            case 'name': return [e, r].some(m => m.words.some(w => matches(cond, w)) || matches(cond, m.name.toLowerCase()));
            default: return false;
        }
    });
}

function settingsOf(book: FabBook, units: string, toleranceMm?: number): Settings
{
    const mm = MM_PER_UNIT[units] ?? 1;
    const toModel = (value: number) => value / mm;
    const tolerance = toModel(toleranceMm ?? book.measure.contactTolerance);
    return {
        ...book.measure,
        ...book.checks,
        mm,
        tolerance,
        minArea: book.measure.minContactArea / (mm * mm),
        cosAngle: Math.cos(book.measure.angleTolerance * DEG),
        sinAngle: Math.sin(book.measure.angleTolerance * DEG),
        cosRelation: Math.cos(book.measure.relationTolerance * DEG),
        sinRelation: Math.sin(book.measure.relationTolerance * DEG),
        toModel,
        text: (value: number) => `${round1(value * mm)} mm`,
    };
}

//// 3. MEASURE ////

const DEG = Math.PI / 180;
const POSITION_WORDS = new Set(['left', 'right', 'top', 'bottom', 'front', 'back', 'start', 'end', 'upper', 'lower',
    'inner', 'outer', 'center', 'centre', 'middle']);

/** Words in names that say which way a part runs. A hint only: geometry decides, a mismatch is reported. */
const NAME_DIRECTIONS: Record<string, FabDirection[]> = {
    stud: ['vertical'], king: ['vertical'], jack: ['vertical'], cripple: ['vertical'], post: ['vertical'], stijl: ['vertical'],
    plate: ['horizontal', 'sloped'], regel: ['horizontal', 'sloped'], header: ['horizontal'], sill: ['horizontal'],
    nogging: ['horizontal'], rafter: ['sloped'], vertical: ['vertical'], horizontal: ['horizontal'],
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const sum = (values: number[]) => values.reduce((acc, x) => acc + x, 0);
const minOf = (values: number[]) => values.reduce((acc, x) => Math.min(acc, x), Infinity);
const maxOf = (values: number[]) => values.reduce((acc, x) => Math.max(acc, x), -Infinity);

function safe<T>(fn: () => T, fallback: T): T
{
    try { return fn() ?? fallback; }
    catch { return fallback; }
}

function wordsOf(name: string): string[]
{
    return name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(word => word && !POSITION_WORDS.has(word))
        .map(word => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) ? word.slice(0, -1) : word);
}

/** A unit vector with its largest component positive, so results do not depend on face winding or input order */
function canonical(v: Vec3): Vec3
{
    const i = [0, 1, 2].reduce((best, k) => Math.abs(v[k]) > Math.abs(v[best]) ? k : best, 0);
    return v[i] < 0 ? scale(v, -1) : v;
}

/** An in-plane unit axis for a plane through the normal */
function planeBasis(normal: Vec3): [Vec3, Vec3]
{
    const helper: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = unit(cross(normal, helper));
    return [e1, cross(normal, e1)];
}

/** How far a part reaches along a direction */
function extentAlong(m: FabMember, dir: Vec3): number
{
    return Math.abs(dot(dir, m.axes.thin)) * m.thickness
        + Math.abs(dot(dir, m.axes.wide)) * m.width
        + Math.abs(dot(dir, m.axes.long)) * m.length;
}

function directionOf(v: Vec3, s: Settings): FabDirection
{
    const fromZ = Math.acos(Math.min(1, Math.abs(v[2]))) / DEG;
    return fromZ <= s.verticalDeg ? 'vertical' : fromZ >= 90 - s.horizontalDeg ? 'horizontal' : 'sloped';
}

function isConvex(ring: readonly Vec3[], normal: Vec3): boolean
{
    return ring.every((a, i) =>
    {
        const b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
        return dot(cross(sub(b, a), sub(c, b)), normal) >= -1e-9;
    });
}

function inTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3, normal: Vec3): boolean
{
    const side = (x: Vec3, y: Vec3) => dot(cross(sub(y, x), sub(p, x)), normal);
    return side(a, b) >= 0 && side(b, c) >= 0 && side(c, a) >= 0;
}

/** Split a planar ring into convex pieces: the ring itself when convex, triangles otherwise */
function convexPieces(ring: readonly Vec3[], normal: Vec3): Vec3[][]
{
    if (isConvex(ring, normal)) return [[...ring]];
    const left = [...ring];
    const triangles: Vec3[][] = [];
    let guard = left.length * left.length;
    while (left.length > 3 && guard-- > 0)
    {
        const ear = left.findIndex((b, i) =>
        {
            const a = left[(i + left.length - 1) % left.length], c = left[(i + 1) % left.length];
            if (dot(cross(sub(b, a), sub(c, b)), normal) <= 1e-12) return false;
            return !left.some(p => p !== a && p !== b && p !== c && inTriangle(p, a, b, c, normal));
        });
        if (ear < 0) break;
        triangles.push([left[(ear + left.length - 1) % left.length], left[ear], left[(ear + 1) % left.length]]);
        left.splice(ear, 1);
    }
    // a ring the ear clipper cannot finish (self-touching) is fanned: its area is right, its shape roughly
    const rest = left.length === 3 ? [left] : left.slice(1, -1).map((p, i) => [left[0], p, left[i + 2]]);
    return [...triangles, ...rest];
}

function planesOf(shape: any, s: Settings): { planes: FabPlane[], points: Vec3[] }
{
    const rings = meshFaces(shape, 1, false).map(face => face.outer).filter(ring => ring.length >= 3);
    const faces = rings.map(ring => ({ ring, n: newell(ring) })).filter(face => len(face.n) > 1e-12);
    // CSG meshes are wound outward. A mesh wound inward (negative signed volume) gets its normals turned.
    const outward = sum(faces.map(face => dot(face.n, face.ring[0]))) >= 0 ? 1 : -1;
    const planes = faces.reduce((acc, face) =>
    {
        const normal = scale(unit(face.n), outward);
        const offset = dot(normal, face.ring[0]);
        const area = len(face.n) / 2;
        const pieces = convexPieces(face.ring, normal);
        const same = acc.find(p => dot(p.normal, normal) >= s.cosAngle && Math.abs(p.offset - offset) <= s.tolerance);
        if (same)
        {
            same.area += area;
            same.pieces.push(...pieces);
        }
        else
        {
            acc.push({ normal, offset, area, pieces });
        }
        return acc;
    }, [] as FabPlane[]);
    return { planes, points: rings.flat() };
}

/** The part's own axes: the normal of its largest faces, the normal of the largest faces square to those,
 *  and their cross product. Exact for sawn timber and sheets whatever the section, unlike a PCA box. */
function axesOf(planes: FabPlane[], shape: any, s: Settings): [Vec3, Vec3, Vec3] | null
{
    const families = planes
        .reduce((acc, plane) =>
        {
            const hit = acc.find(f => Math.abs(dot(f.dir, plane.normal)) >= s.cosAngle);
            if (hit) hit.area += plane.area;
            else acc.push({ dir: plane.normal, area: plane.area });
            return acc;
        }, [] as Array<{ dir: Vec3, area: number }>)
        .sort((x, y) => y.area - x.area);
    const n1 = families[0]?.dir;
    const n2 = n1 ? families.find(f => Math.abs(dot(f.dir, n1)) <= s.sinAngle)?.dir : undefined;
    if (n1 && n2)
    {
        const square = unit(sub(n2, scale(n1, dot(n1, n2))));
        return [canonical(n1), canonical(square), canonical(unit(cross(n1, square)))];
    }
    // No two families of faces square to each other (round or free-form): the kernel's oriented box
    const box = safe(() => shape.obbox(), null);
    if (!box) return null;
    const axes = box.axes().map((a: any) => canonical(unit([a.x, a.y, a.z])));
    return axes.length === 3 ? axes as [Vec3, Vec3, Vec3] : null;
}

function measureMember(shape: any, id: number, s: Settings): FabMember | null
{
    const { planes, points } = planesOf(shape, s);
    if (!planes.length) return null;
    const axes = axesOf(planes, shape, s);
    if (!axes) return null;
    const dims = axes.map(axis =>
    {
        const along = points.map(p => dot(p, axis));
        const lo = minOf(along), hi = maxOf(along);
        return { axis, size: hi - lo, mid: (lo + hi) / 2 };
    });
    const [thin, wide, long] = [...dims].sort((x, y) => x.size - y.size);
    if (thin.size <= s.tolerance) return null; // flat
    const center = dims.reduce((acc, d) => add(acc, scale(d.axis, d.mid)), [0, 0, 0] as Vec3);
    const volume = safe(() => Number(shape.volume()), 0);
    const fill = volume / (thin.size * wide.size * long.size);
    const stick = long.size / wide.size >= s.stickMinLengthRatio && wide.size / thin.size <= s.stickMaxSectionAspect;
    const kind: FabKind = stick ? 'stick' : (wide.size / thin.size >= s.sheetMinAspect) ? 'sheet' : 'block';
    const along = directionOf(long.axis, s);
    // a sheet runs the way its plane does: a wall sheet is vertical, a floor sheet horizontal
    const across = directionOf(thin.axis, s);
    const direction: FabDirection = kind !== 'sheet' ? along
        : across === 'vertical' ? 'horizontal' : across === 'horizontal' ? 'vertical' : 'sloped';
    const material = safe(() =>
    {
        const m = shape.material?.();
        return m ? { name: String(m.name), group: String(m.group) } : null;
    }, null);
    const name = String(safe(() => shape.name(), '') || '') || `solid#${safe(() => shape.sid(), 0) || id}`;
    const section = `${round1(thin.size * s.mm)}x${round1(wide.size * s.mm)}`;
    return {
        id, name, shape, kind, direction,
        thickness: thin.size,
        width: wide.size,
        length: long.size,
        axes: { thin: thin.axis, wide: wide.axis, long: long.axis },
        center,
        section,
        fill,
        material,
        words: wordsOf(name),
        planes,
        bbox: {
            min: [0, 1, 2].map(k => minOf(points.map(p => p[k]))) as unknown as Vec3,
            max: [0, 1, 2].map(k => maxOf(points.map(p => p[k]))) as unknown as Vec3,
        },
        evidence: `${kind}, ${direction}, ${section} × ${round1(long.size * s.mm)} mm, fill ${Math.round(fill * 100)}%`,
        ops: [],
        recipe: 'none',
        recipeNote: null,
        warnings: [],
    };
}

/** Solids in a shape, collection or list: meshes with a volume, visible unless asked otherwise, each once */
function solidsOf(input: any, hidden: boolean, skip?: WeakSet<object>): any[]
{
    const flatten = (x: any): any[] => x === null || x === undefined ? []
        : Array.isArray(x) ? x.flatMap(flatten)
        : (typeof x.isShapeCollection === 'function' && x.isShapeCollection()) ? x.toArray().flatMap(flatten)
        : [x];
    const seen = new Set<any>();
    return flatten(input).filter(shape =>
    {
        if (shape?.type !== 'Mesh' || seen.has(shape) || skip?.has(shape)) return false;
        seen.add(shape);
        return hidden || shape.style?.visible !== false;
    });
}

/** Name a direction mismatch between a part's name and its geometry */
function nameMismatch(m: FabMember): string | null
{
    const hinted = m.words
        .map(word => Object.keys(NAME_DIRECTIONS).find(key => word === key || word.endsWith(key)))
        .filter(Boolean)
        .pop();
    if (!hinted || m.kind === 'sheet' || m.kind === 'fill' || NAME_DIRECTIONS[hinted].includes(m.direction)) return null;
    return `${m.name} is named like a ${hinted} but runs ${m.direction}; the geometry decides`;
}

//// 4. CONTACTS ////

const ROLE_RANK: Record<FaceRole, number> = { end: 0, face: 1, side: 2, edge: 3 };

function roleOf(m: FabMember, normal: Vec3): FaceRole
{
    const along = (axis: Vec3) => Math.abs(dot(normal, axis));
    if (m.kind === 'sheet')
    {
        return along(m.axes.thin) >= Math.max(along(m.axes.wide), along(m.axes.long)) ? 'face' : 'edge';
    }
    return along(m.axes.long) >= Math.max(along(m.axes.wide), along(m.axes.thin)) ? 'end' : 'side';
}

type Polygon2 = P2[];

function area2(poly: Polygon2): number
{
    return sum(poly.map((p, i) =>
    {
        const q = poly[(i + 1) % poly.length];
        return p[0] * q[1] - q[0] * p[1];
    })) / 2;
}

const ccw = (poly: Polygon2): Polygon2 => area2(poly) < 0 ? [...poly].reverse() : poly;

/** Rounding leaves a corner twice, a hair apart. The edge between the copies points anywhere, and an inside
 *  test against it can fail for points well inside, so near repeats are dropped. */
const isShortEdge = (p: P2, q: P2) =>
    Math.hypot(q[0] - p[0], q[1] - p[1]) <= 1e-9 * Math.max(1, Math.abs(p[0]), Math.abs(p[1]));

const dropRepeats = (poly: Polygon2): Polygon2 => poly.filter((p, i) => !isShortEdge(p, poly[(i + 1) % poly.length]));

/** Sutherland-Hodgman: a convex polygon clipped by another, both counter-clockwise */
function clipConvex(subject: Polygon2, clip: Polygon2): Polygon2
{
    return dropRepeats(clip.reduce((output, a, i) =>
    {
        const b = clip[(i + 1) % clip.length];
        if (!output.length || isShortEdge(a, b)) return output;
        // on the edge counts as inside, within rounding at the size of the coordinates
        const edge = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const eps = 1e-9 * Math.max(1, Math.abs(a[0]), Math.abs(a[1]));
        const inside = (p: P2) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / edge >= -eps;
        const crossing = (p: P2, q: P2): P2 =>
        {
            const dx = q[0] - p[0], dy = q[1] - p[1];
            const denom = (b[0] - a[0]) * dy - (b[1] - a[1]) * dx;
            const t = ((b[1] - a[1]) * (p[0] - a[0]) - (b[0] - a[0]) * (p[1] - a[1])) / denom;
            return [p[0] + t * dx, p[1] + t * dy];
        };
        return output.flatMap((p, k) =>
        {
            const q = output[(k + 1) % output.length];
            if (inside(q)) return inside(p) ? [q] : [crossing(p, q), q];
            return inside(p) ? [crossing(p, q)] : [];
        });
    }, subject));
}

function insideConvex(p: P2, poly: Polygon2, margin: number): boolean
{
    return poly.every((a, i) =>
    {
        const b = poly[(i + 1) % poly.length];
        if (isShortEdge(a, b)) return true;
        const edge = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / edge >= margin;
    });
}

/** Where two coincident, opposite planes overlap: 3D polygons on the first plane */
function overlapOf(pa: FabPlane, pb: FabPlane): Vec3[][]
{
    const [e1, e2] = planeBasis(pa.normal);
    const flat = (poly: Vec3[]): Polygon2 => ccw(poly.map(p => [dot(p, e1), dot(p, e2)] as P2));
    const back = (p: P2): Vec3 => add(add(scale(e1, p[0]), scale(e2, p[1])), scale(pa.normal, pa.offset));
    const bs = pb.pieces.map(flat);
    return pa.pieces
        .map(flat)
        .flatMap(a => bs.map(b => clipConvex(a, b)))
        .filter(poly => poly.length >= 3 && area2(poly) > 1e-12)
        .map(poly => poly.map(back));
}

function polygonArea(poly: Vec3[]): number
{
    return len(newell(poly)) / 2;
}

function polygonCentroid(poly: Vec3[]): Vec3
{
    const parts = poly.slice(1, -1).map((p, i) =>
    {
        const q = poly[i + 2];
        const w = len(cross(sub(p, poly[0]), sub(q, poly[0]))) / 2;
        return { w, c: scale(add(add(poly[0], p), q), 1 / 3) };
    });
    const total = sum(parts.map(part => part.w));
    if (total <= 0) return poly[0];
    return parts.reduce((acc, part) => add(acc, scale(part.c, part.w / total)), [0, 0, 0] as Vec3);
}

/** The first candidate that is not square to the normal, projected into the plane */
function inPlaneAxis(normal: Vec3, candidates: Vec3[]): Vec3
{
    const found = candidates
        .map(c => sub(c, scale(normal, dot(c, normal))))
        .find(p => len(p) > 0.1);
    return canonical(found ? unit(found) : planeBasis(normal)[0]);
}

function relationOf(x: Vec3, y: Vec3, s: Settings): FabRelation
{
    const c = Math.abs(dot(x, y));
    return c >= s.cosRelation ? 'parallel' : c <= s.sinRelation ? 'perpendicular' : 'skew';
}

function planesTouch(pa: FabPlane, pb: FabPlane, s: Settings): boolean
{
    return dot(pa.normal, pb.normal) <= -s.cosAngle && Math.abs(dot(pa.normal, pb.pieces[0][0]) - pa.offset) <= s.tolerance;
}

function contactBetween(a: FabMember, b: FabMember, s: Settings): Contact | null
{
    const found = a.planes
        .flatMap(pa => b.planes
            .filter(pb => planesTouch(pa, pb, s))
            .map(pb =>
            {
                const polygons = overlapOf(pa, pb);
                return { pa, pb, polygons, area: sum(polygons.map(polygonArea)) };
            }))
        .filter(hit => hit.area >= s.minArea);
    if (!found.length) return null;
    const best = found.reduce((x, y) => y.area > x.area ? y : x);
    return makeContact(a, b, best.pa, best.pb, best.polygons, found.length, s);
}

function makeContact(a: FabMember, b: FabMember, pa: FabPlane, pb: FabPlane, polygons: Vec3[][], planeCount: number, s: Settings): Contact
{
    const roleA = roleOf(a, pa.normal), roleB = roleOf(b, pb.normal);
    const aFirst = ROLE_RANK[roleA] !== ROLE_RANK[roleB]
        ? ROLE_RANK[roleA] < ROLE_RANK[roleB]
        : extentAlong(a, pa.normal) <= extentAlong(b, pa.normal) + s.tolerance;
    const [entering, receiving] = aFirst ? [a, b] : [b, a];
    const [roleE, roleR] = aFirst ? [roleA, roleB] : [roleB, roleA];
    const normal = aFirst ? pb.normal : pa.normal; // outward from the receiving part, so into the entering one
    const u = inPlaneAxis(normal,
        roleE === 'end' ? [entering.axes.wide, entering.axes.long]
        : roleE === 'face' ? [receiving.axes.long, entering.axes.long]
        : [entering.axes.long, receiving.axes.long]);
    const v = cross(normal, u);
    const areas = polygons.map(polygonArea);
    const area = sum(areas);
    const origin = polygons
        .map(polygonCentroid)
        .reduce((acc, c, i) => add(acc, scale(c, areas[i] / area)), [0, 0, 0] as Vec3);
    const pieces = polygons.map(poly => ccw(poly.map(p => [dot(sub(p, origin), u), dot(sub(p, origin), v)] as P2)));
    const us = pieces.flat().map(p => p[0]), vs = pieces.flat().map(p => p[1]);
    const rect: [P2, P2] = [[minOf(us), minOf(vs)], [maxOf(us), maxOf(vs)]];
    const contact: Contact = {
        a, b, entering, receiving,
        kind: `${roleE}-${roleR}`,
        relation: relationOf(entering.axes.long, receiving.axes.long, s),
        origin, normal, u, v, pieces, rect, area,
        faces: planeCount,
        roles: [roleE, roleR],
        evidence: '',
    };
    contact.evidence = contactEvidence(contact, s);
    return contact;
}

/** One line on what touches what. Written again after fills are known. */
function contactEvidence(c: Contact, s: Settings): string
{
    const part = (m: FabMember) => `${m.name} (${m.kind}, ${m.direction} ${m.section})`;
    const size = `${round1((c.rect[1][0] - c.rect[0][0]) * s.mm)}×${round1((c.rect[1][1] - c.rect[0][1]) * s.mm)} mm`;
    return `${part(c.entering)} ${c.roles[0]} on ${part(c.receiving)} ${c.roles[1]}, ${size}`
        + (c.faces > 1 ? `; touches on ${c.faces} faces, the largest is used` : '');
}

function nearOverlap(a: FabMember, b: FabMember, margin: number): boolean
{
    return [0, 1, 2].every(k => a.bbox.min[k] <= b.bbox.max[k] + margin && b.bbox.min[k] <= a.bbox.max[k] + margin);
}

/** How deep the two parts' boxes overlap (separating axis test), 0 when they are apart or only touch */
function boxOverlap(a: FabMember, b: FabMember): number
{
    const boxA = [[a.axes.thin, a.thickness], [a.axes.wide, a.width], [a.axes.long, a.length]] as Array<[Vec3, number]>;
    const boxB = [[b.axes.thin, b.thickness], [b.axes.wide, b.width], [b.axes.long, b.length]] as Array<[Vec3, number]>;
    const radius = (box: Array<[Vec3, number]>, axis: Vec3) => sum(box.map(([dir, size]) => Math.abs(dot(dir, axis)) * size / 2));
    const between = sub(b.center, a.center);
    const tests = [
        ...boxA.map(([dir]) => dir),
        ...boxB.map(([dir]) => dir),
        ...boxA.flatMap(([x]) => boxB.map(([y]) => cross(x, y))),
    ].filter(axis => len(axis) > 1e-6).map(unit);
    return Math.max(0, minOf(tests.map(axis => radius(boxA, axis) + radius(boxB, axis) - Math.abs(dot(between, axis)))));
}

function reallyOverlap(a: FabMember, b: FabMember): boolean
{
    return safe(() => Math.max(a.shape.overlapPerc(b.shape), b.shape.overlapPerc(a.shape)) > 1e-4, false);
}

/** The smallest gap between opposite faces that would touch if moved together, in model units */
function gapBetween(a: FabMember, b: FabMember, s: Settings): number | null
{
    // overlapOf() flattens both planes onto the first, so it also measures faces that are apart
    const gaps = a.planes.flatMap(pa => b.planes
        .filter(pb => dot(pa.normal, pb.normal) <= -s.cosAngle)
        .filter(pb => sum(overlapOf(pa, pb).map(polygonArea)) >= s.minArea)
        .map(pb => dot(pa.normal, pb.pieces[0][0]) - pa.offset)
        .filter(gap => gap > 0));
    return gaps.length ? minOf(gaps) : null;
}

function findContacts(members: FabMember[], s: Settings): { contacts: Contact[], warnings: string[] }
{
    const sorted = [...members].sort((x, y) => x.bbox.min[0] - y.bbox.min[0]);
    const pairs = sorted.flatMap((a, i) =>
    {
        const later = sorted.slice(i + 1);
        const stop = later.findIndex(b => b.bbox.min[0] > a.bbox.max[0] + s.tolerance);
        return (stop < 0 ? later : later.slice(0, stop))
            .filter(b => nearOverlap(a, b, s.tolerance))
            .map(b => (a.id < b.id ? [a, b] : [b, a]) as [FabMember, FabMember]);
    });
    const results = pairs.map(([a, b]) => ({ a, b, contact: contactBetween(a, b, s), depth: 0 }));
    results.filter(r => !r.contact).forEach(r => r.depth = boxOverlap(r.a, r.b));
    const warnings = results
        .filter(r => r.depth > s.tolerance && reallyOverlap(r.a, r.b))
        .map(r => `${r.a.name} and ${r.b.name} overlap by about ${s.text(r.depth)}: they are not treated as touching`);
    return { contacts: results.map(r => r.contact).filter(Boolean), warnings };
}

//// 5. JOINTS ////

/** The part a part sits between, on two opposite side faces, and the direction across to it */
function sandwichOf(m: FabMember, contacts: Contact[], s: Settings, fills: Set<FabMember>): { other: FabMember, out: Vec3 } | null
{
    const sides = contacts
        .filter(c => (c.a === m || c.b === m) && c.kind === 'side-side')
        .map(c => ({ other: c.a === m ? c.b : c.a, out: c.receiving === m ? c.normal : scale(c.normal, -1) }))
        .filter(side => side.other.kind !== 'sheet' && !fills.has(side.other));
    return sides.find(x => sides.some(y => y.other !== x.other && dot(x.out, y.out) <= -s.cosAngle)) ?? null;
}

/** Why a part is a fill (insulation and the like, never fastened), or null */
function fillReason(m: FabMember, contacts: Contact[], s: Settings, fills: Set<FabMember>): string | null
{
    if (m.material && s.fillMaterialGroups.includes(m.material.group)) return `its material group is ${m.material.group}`;
    const named = s.fillNames.map(n => n.toLowerCase()).find(n => m.words.some(w => w.includes(n)));
    if (named) return `its name says ${named}`;
    if (m.kind === 'sheet') return null;
    const pair = sandwichOf(m, contacts, s, fills);
    if (!pair) return null;
    const across = extentAlong(m, pair.out);
    return across >= s.toModel(s.fillMinWidth)
        ? `it sits between ${pair.other.name} and another part, ${s.text(across)} across`
        : null;
}

function markFills(members: FabMember[], contacts: Contact[], s: Settings): void
{
    const fills = new Set<FabMember>();
    // by material and name first, so the sandwich rule below does not count a fill as a neighbour
    [false, true].forEach(sandwich => members
        .filter(m => !fills.has(m))
        .forEach(m =>
        {
            const reason = fillReason(m, sandwich ? contacts : [], s, fills);
            if (!reason) return;
            fills.add(m);
            m.kind = 'fill';
            m.evidence += `; fill because ${reason}`;
        }));
    // a fill's thickness is its depth square to the parts it sits between (a narrow bay is still a full wall deep)
    fills.forEach(m =>
    {
        const pair = sandwichOf(m, contacts, s, fills);
        if (!pair) return;
        const depth = unit(cross(m.axes.long, pair.out));
        if (len(depth) < 0.5) return;
        const thickness = extentAlong(m, depth);
        const width = extentAlong(m, pair.out);
        m.axes = { thin: canonical(depth), wide: canonical(unit(pair.out)), long: m.axes.long };
        m.thickness = thickness;
        m.width = width;
        m.section = [thickness, width].sort((x, y) => x - y).map(x => round1(x * s.mm)).join('x');
    });
    contacts.forEach(c => c.evidence = contactEvidence(c, s));
}

interface ResolvedJoint
{
    row: JointRow
    spec: Record<string, any> | null
    sources: Record<string, FabSource>
}

const PAIR_ONLY_KEYS = ['joint', 'detail', 'tolerance'];

function resolveJoint(c: Contact, rows: JointRow[], pair: FastenOptions | undefined, s: Settings): ResolvedJoint | null
{
    const named = pair?.joint;
    const found = named ? rows.find(row => row.joint === named) : rows.find(row => whenHolds(row.when, c, s));
    if (named && !found)
    {
        throw new Error(`fab.fasten(): no joint '${named}'. Joints: ${[...new Set(rows.map(row => row.joint))].join(', ')}`);
    }
    if (!found) return null;
    const layout = Object.fromEntries(Object.entries(pair ?? {}).filter(([key]) => !PAIR_ONLY_KEYS.includes(key)));
    const row = Object.keys(layout).length ? patchRow(found, layout, 'pair', `fab.fasten() options (joint '${found.joint}')`) : found;
    const sources: Record<string, FabSource> = { method: row.sources.method ?? 'book' };
    if (row.method === 'none') return { row, spec: null, sources };
    const written = row[row.method] as JointSpec;
    const spec: Record<string, any> = { ...PATTERNS[written.pattern].defaults, ...written };
    Object.keys(spec).forEach(key => sources[key] = key in written ? (row.sources[`${row.method}.${key}`] ?? 'book') : 'default');
    if (spec.fastener.length === 'auto' && spec.penetration === undefined)
    {
        spec.penetration = s.minPenetrationD * spec.fastener.diameter;
        sources.penetration = 'default';
    }
    return { row, spec, sources };
}

//// 6. PARTS ////

/** A flat face of a recipe primitive, in world space */
interface RecipePlane
{
    normal: Vec3
    offset: number
    leaf: LeafNode
}

interface RecipeRead
{
    state: 'live' | 'baked' | 'none'
    note: string | null
    root: RecipeNode | null
    roles: Map<LeafNode, BooleanOp | 'base'>
    planes: RecipePlane[]
    classes: Classifications
    /** A tool of the recipe is baked, so not every face can be explained */
    partial: boolean
}

/** What the FAB_RULES see */
interface FabCtx
{
    member: FabMember
    roles: Map<LeafNode, BooleanOp | 'base'>
    planes: RecipePlane[]
    s: Settings
}

type FaceName = 'wide' | 'narrow' | 'end';

const LEAF_KEYS = ['box', 'extrude', 'cylinder', 'sphere', 'cone'] as const;
const roundTo = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

function onPlane(plane: FabPlane, r: RecipePlane, s: Settings): boolean
{
    const c = dot(plane.normal, r.normal);
    return Math.abs(c) >= s.cosAngle && Math.abs(plane.offset - Math.sign(c) * r.offset) <= s.tolerance;
}

/** The part's faces that lie on a face of this primitive. A primitive that does not reach into the part
 *  made none of them, even where a face of it happens to be in line with one of the part's. */
function facesMadeBy(leaf: LeafNode, ctx: FabCtx): FabPlane[]
{
    if (!overlapsPart(leaf, ctx.member, ctx.s)) return [];
    const own = ctx.planes.filter(r => r.leaf === leaf);
    return ctx.member.planes.filter(p => own.some(r => onPlane(p, r, ctx.s)));
}

/** Whether the part lies inside every face of a primitive: a common with it keeps the whole part.
 *  For a concave prism this is stricter than containment, so it never calls a real cut idle. */
function holdsPart(leaf: LeafNode, ctx: FabCtx): boolean
{
    const own = ctx.planes.filter(r => r.leaf === leaf);
    const points = ctx.member.planes.flatMap(p => p.pieces.flat());
    return own.length > 0 && points.every(q => own.every(r => dot(r.normal, q) <= r.offset + ctx.s.tolerance));
}

const article = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

/** Whether an end face reaches the tip of the part: a saw cut does, the shoulder of a notch does not */
function reachesTip(m: FabMember, p: FabPlane, s: Settings): boolean
{
    const outward = dot(p.normal, m.axes.long) >= 0 ? m.axes.long : scale(m.axes.long, -1);
    const far = maxOf(p.pieces.flat().map(q => dot(q, outward)));
    return far >= dot(m.center, outward) + m.length / 2 - s.tolerance;
}

/** An end face at the tip of the part: made by cutting it to length */
function isEndCutFace(m: FabMember, p: FabPlane, s: Settings): boolean
{
    return roleOf(m, p.normal) === 'end' && reachesTip(m, p, s);
}

/** A face inside the part's box: the bottom, cheek or shoulder of a notch, lap or rebate */
function isInsideFace(m: FabMember, p: FabPlane, s: Settings): boolean
{
    if (roleOf(m, p.normal) === 'end') return !reachesTip(m, p, s);
    return Math.abs(p.offset - dot(p.normal, m.center) - extentAlong(m, p.normal) / 2) > s.tolerance;
}

/** Whether a face is one of the flat facets a curved tool (the side of a cylinder, cone or sphere) leaves.
 *  Facet corners lie on the true surface; points between them may sit inside it by the chord's sag. */
function onCurvedTool(p: FabPlane, leaf: LeafNode, s: Settings): boolean
{
    const step = leaf.step;
    if (step.op !== 'cylinder' && step.op !== 'cone' && step.op !== 'sphere') return false;
    const frame = affineFrame(leaf.matrix);
    const k = frame.scales[0];
    if (!frame.orthogonal || Math.abs(frame.scales[1] - k) > 1e-9 * k || (step.op === 'sphere' && Math.abs(frame.scales[2] - k) > 1e-9 * k)) return false;
    const origin = affineApply(leaf.matrix, [0, 0, 0]);
    const axis = frame.axes[2];
    const within = (distance: number, radius: number) =>
        distance <= radius + s.tolerance && distance >= radius * Math.cos(Math.PI / 8) - s.tolerance;
    return p.pieces.flat().every(q =>
    {
        const v = sub(q, origin);
        if (step.op === 'sphere') return within(len(v), step.radius * k);
        const height = step.height * frame.scales[2];
        const t = Math.min(1, Math.max(0, dot(v, axis) / height));
        const radius = step.op === 'cylinder' ? step.radius * k : (step.r1 + (step.r2 - step.r1) * t) * k;
        return within(len(cross(v, axis)), radius);
    });
}

function overlapsPart(leaf: LeafNode, m: FabMember, s: Settings): boolean
{
    const b = nodeBounds(leaf);
    return !!b && [0, 1, 2].every(k => b.min[k] < m.bbox.max[k] - s.tolerance && b.max[k] > m.bbox.min[k] + s.tolerance);
}

/** A cylinder that goes into the part as a drill would: round, with its axis entering through a face */
function drillOf(leaf: LeafNode, ctx: FabCtx): Omit<Drilling, 'op' | 'origin' | 'evidence'> | null
{
    const step = leaf.step;
    if (step.op !== 'cylinder') return null;
    const frame = affineFrame(leaf.matrix);
    if (!frame.orthogonal || Math.abs(frame.scales[0] - frame.scales[1]) > 1e-9 * Math.max(...frame.scales)) return null;
    const a = affineApply(leaf.matrix, [0, 0, 0]);
    const dir = sub(affineApply(leaf.matrix, [0, 0, step.height]), a);
    return drillAlong(ctx.member, a, dir, step.radius * frame.scales[0], ctx.s);
}

/** A drill from `a` along `dir` (its whole length) through a part's box: where it enters, how deep, from which face */
function drillAlong(m: FabMember, a: Vec3, dir: Vec3, radius: number, s: Settings): Omit<Drilling, 'op' | 'origin' | 'evidence'> | null
{
    const slabs: Array<[Vec3, number, FaceName]> = [[m.axes.thin, m.thickness, 'wide'], [m.axes.wide, m.width, 'narrow'], [m.axes.long, m.length, 'end']];
    // clip the axis to the part's box, one pair of faces at a time
    const clip = slabs.reduce<{ t0: number, t1: number, in: FaceName | null, out: FaceName | null } | null>((acc, [axis, size, face]) =>
    {
        if (!acc) return null;
        const o = dot(sub(a, m.center), axis), d = dot(dir, axis), half = size / 2;
        if (Math.abs(d) < 1e-12) return Math.abs(o) <= half ? acc : null;
        const tA = (-half - o) / d, tB = (half - o) / d;
        const next = { ...acc };
        if (Math.min(tA, tB) > next.t0) { next.t0 = Math.min(tA, tB); next.in = face; }
        if (Math.max(tA, tB) < next.t1) { next.t1 = Math.max(tA, tB); next.out = face; }
        return next.t0 < next.t1 - 1e-9 ? next : null;
    }, { t0: 0, t1: 1, in: null, out: null });
    if (!clip || (!clip.in && !clip.out)) return null; // outside the part, or a cavity inside it
    // the drill comes in where the cylinder crosses the surface; with both ends outside it goes through
    const fromStart = clip.in !== null;
    const face = fromStart ? clip.in : clip.out;
    const entry = add(a, scale(dir, fromStart ? clip.t0 : clip.t1));
    const axis = unit(fromStart ? dir : scale(dir, -1));
    const across = face === 'narrow' ? m.axes.thin : m.axes.wide;
    const normal = face === 'wide' ? m.axes.thin : face === 'narrow' ? m.axes.wide : m.axes.long;
    const offset = sub(entry, m.center);
    return {
        diameter: round1(2 * radius * s.mm),
        depth: round1((clip.t1 - clip.t0) * len(dir) * s.mm),
        through: clip.in !== null && clip.out !== null,
        face,
        // + 0 turns a rounded -0 into 0
        along: round1((dot(offset, m.axes.long) + m.length / 2) * s.mm) + 0,
        across: round1(dot(offset, across) * s.mm) + 0,
        tilt: roundTo(Math.acos(Math.min(1, Math.abs(dot(unit(dir), normal)))) / DEG, 2) + 0,
        entry,
        axis,
    };
}

const roleOfLeaf = (node: RecipeNode, ctx: FabCtx) => node.kind === 'leaf' ? ctx.roles.get(node) : undefined;

/** What each primitive of a part's recipe did to it. First match per primitive, top to bottom. */
export const FAB_RULES: Array<ClassificationRule<FabCtx>> = [
    {
        tag: 'fab:blank',
        rule: 'the primitive the part is made from',
        on: [...LEAF_KEYS],
        when: (node, _shape, ctx) => roleOfLeaf(node, ctx) === 'base',
        evidence: node => `the ${(node as LeafNode).step.op} the part is made from`,
    },
    {
        tag: 'fab:drilling',
        rule: 'a cylinder cut into the part through one of its faces',
        on: 'cylinder',
        when: (node, _shape, ctx) => roleOfLeaf(node, ctx) === 'cut' && drillOf(node as LeafNode, ctx) !== null,
        derive: (node, _shape, ctx) => ({ ...drillOf(node as LeafNode, ctx) }),
        evidence: (node, _shape, ctx) =>
        {
            const d = drillOf(node as LeafNode, ctx);
            return `a cylinder cut ${d.through ? 'through' : `${d.depth} mm into`} the part from its ${d.face} face`;
        },
    },
    {
        tag: 'fab:cut',
        rule: 'a box or prism whose face is an end of the part',
        on: ['box', 'extrude'],
        when: (node, _shape, ctx) => ['cut', 'common'].includes(roleOfLeaf(node, ctx) as string)
            && facesMadeBy(node as LeafNode, ctx).some(p => isEndCutFace(ctx.member, p, ctx.s)),
        evidence: (node, _shape, ctx) => `the ${roleOfLeaf(node, ctx)} with ${article((node as LeafNode).step.op)} shapes an end of the part`,
    },
    {
        tag: 'fab:notch',
        rule: 'a box or prism cut from the part that leaves a face inside its box',
        on: ['box', 'extrude'],
        when: (node, _shape, ctx) => roleOfLeaf(node, ctx) === 'cut'
            && facesMadeBy(node as LeafNode, ctx).some(p => isInsideFace(ctx.member, p, ctx.s)),
        evidence: (node, _shape, ctx) => `a ${(node as LeafNode).step.op} cut from the part leaves ${facesMadeBy(node as LeafNode, ctx)
            .filter(p => isInsideFace(ctx.member, p, ctx.s)).length} face(s) inside it: a notch, lap or rebate`,
    },
    {
        tag: 'fab:idle',
        rule: 'a tool that does not touch the part, or keeps all of it',
        on: [...LEAF_KEYS],
        when: (node, _shape, ctx) => node.kind === 'leaf' && (!overlapsPart(node, ctx.member, ctx.s)
            || (roleOfLeaf(node, ctx) === 'common' && holdsPart(node as LeafNode, ctx))),
        evidence: (node, _shape, ctx) => `the ${roleOfLeaf(node, ctx)} with ${article((node as LeafNode).step.op)} leaves the part as it was`,
    },
    {
        tag: 'fab:unknown',
        rule: 'anything else a tool did',
        on: [...LEAF_KEYS, 'baked'],
        when: () => true,
        evidence: (node, _shape, ctx) => node.kind === 'baked'
            ? `a tool known only as geometry (${node.reason})`
            : `a ${roleOfLeaf(node, ctx)} with ${article((node as LeafNode).step.op)} changed the part in a way that is not recognised`,
    },
];

function readRecipe(m: FabMember, s: Settings): RecipeRead
{
    const empty: RecipeRead = { state: 'none', note: null, root: null, roles: new Map(), planes: [], classes: new Map(), partial: false };
    const recipe = safe(() => recipeOf(m.shape), null);
    if (!recipe) return empty;
    const root = resolveRecipe(recipe);
    if (root.kind === 'baked') return { ...empty, state: 'baked', note: root.reason };
    const roles = toolOpsOf(root);
    const planes = [...roles.keys()].flatMap(leaf => leafPlanes(leaf).map(p => ({ normal: p.normal, offset: dot(p.normal, p.point), leaf })));
    const classes = classify(root, m.shape, FAB_RULES, { member: m, roles, planes, s });
    const partial = [...classes.entries()].some(([node]) => node.kind === 'baked');
    return { state: 'live', note: null, root, roles, planes, classes, partial };
}

function cutAngles(m: FabMember, normal: Vec3, outward: Vec3): { angle: number, inclination: number }
{
    const along = dot(normal, outward);
    return {
        angle: roundTo(90 - Math.atan2(dot(normal, m.axes.wide), along) / DEG, 2),
        inclination: roundTo(90 - Math.atan2(dot(normal, m.axes.thin), along) / DEG, 2),
    };
}

function describeLeaf(leaf: LeafNode, recipe: RecipeRead): string
{
    const role = recipe.roles.get(leaf);
    return role === 'base' ? `the end of the ${leaf.step.op} as drawn` : `the ${role} with a ${leaf.step.op}`;
}

function sawCutsOf(m: FabMember, recipe: RecipeRead, curved: Set<FabPlane>, s: Settings): Array<SawCut | Processing>
{
    return (['start', 'end'] as const).map(end =>
    {
        const outward = end === 'end' ? m.axes.long : scale(m.axes.long, -1);
        const faces = m.planes.filter(p => !curved.has(p) && isEndCutFace(m, p, s) && dot(p.normal, outward) > 0);
        if (faces.length === 0 || faces.length > 2)
        {
            return { op: 'unknown', origin: 'measured', evidence: `the ${end} is shaped by ${faces.length} faces: not a saw cut` } as Processing;
        }
        const [first, second] = faces.map(p => cutAngles(m, p.normal, outward));
        const madeBy = faces.map(p => recipe.planes.find(r => onPlane(p, r, s)));
        const derived = recipe.state === 'live' && madeBy.every(Boolean);
        const square = (a: { angle: number, inclination: number }) =>
            Math.abs(a.angle - 90) <= s.angleTolerance && Math.abs(a.inclination - 90) <= s.angleTolerance;
        const kind: SawCut['kind'] = second ? 'double'
            : square(first) ? 'square'
            : (Math.abs(first.angle - 90) > s.angleTolerance && Math.abs(first.inclination - 90) > s.angleTolerance) ? 'compound'
            : 'angled';
        const shape = kind === 'square' ? 'square'
            : kind === 'double' ? `double, ${first.angle}°/${first.inclination}° and ${second.angle}°/${second.inclination}°`
            : `angle ${first.angle}°, inclination ${first.inclination}°`;
        const source = derived
            ? [...new Set(madeBy.map(r => describeLeaf(r.leaf, recipe)))].join(' and ')
            : 'measured from the end face';
        const points = m.planes.flatMap(p => p.pieces.flat());
        const convex = faces.every(face => points.every(q => dot(face.normal, q) <= face.offset + s.tolerance));
        return {
            op: 'sawCut', end, ...first, ...(second ? { second } : {}), kind,
            planes: faces.map(face => ({ normal: face.normal, point: face.pieces[0][0] })),
            convex,
            origin: derived ? 'derived' : 'measured',
            evidence: `${end} cut ${shape}${second && !convex ? ', a V cut into the part' : ''}: ${source}`,
        } as SawCut;
    });
}

function sheatheOf(m: FabMember, s: Settings): Sheathe
{
    const faces = m.planes.filter(p => roleOf(m, p.normal) === 'face');
    const box = m.width * m.length;
    const area = faces.length ? maxOf(faces.map(p => p.area)) : box;
    const edges = m.planes.filter(p => roleOf(m, p.normal) === 'edge').length;
    const shaped = edges > 4 || area < 0.99 * box;
    return {
        op: 'sheathe',
        width: round1(m.width * s.mm),
        length: round1(m.length * s.mm),
        thickness: round1(m.thickness * s.mm),
        area: roundTo(area * s.mm * s.mm / 1e6, 3),
        shaped,
        origin: 'measured',
        evidence: `sheet ${round1(m.thickness * s.mm)} thick, ${round1(m.width * s.mm)} × ${round1(m.length * s.mm)} mm`
            + (shaped ? `, cut to shape (${edges} edges, ${Math.round(area / box * 100)}% of its rectangle)` : ''),
    };
}

function insulateOf(m: FabMember, s: Settings): Insulate
{
    const volume = safe(() => Number(m.shape.volume()), 0) || m.thickness * m.width * m.length;
    return {
        op: 'insulate',
        thickness: round1(m.thickness * s.mm),
        area: roundTo(volume / m.thickness * s.mm * s.mm / 1e6, 3),
        volume: roundTo(volume * s.mm ** 3 / 1e9, 4),
        origin: 'measured',
        evidence: `fill ${round1(m.thickness * s.mm)} thick, ${roundTo(volume * s.mm ** 3 / 1e9, 4)} m³`,
    };
}

/** What the workshop does to one part, from its faces and, when recorded, its recipe */
function readPart(m: FabMember, s: Settings): void
{
    if (m.kind === 'fill')
    {
        m.ops = [insulateOf(m, s)];
        return;
    }
    if (m.kind === 'sheet')
    {
        m.ops = [sheatheOf(m, s)];
        return;
    }
    const recipe = readRecipe(m, s);
    m.recipe = recipe.state;
    m.recipeNote = recipe.note ?? (recipe.partial ? 'part of the recipe is known only as geometry' : null);
    const tagged = (tag: string) => [...recipe.classes.entries()]
        .flatMap(([node, classes]) => classes.filter(c => c.tag === tag).map(c => ({ node, c })));
    const drillings: Drilling[] = tagged('fab:drilling').map(({ c }) => ({
        op: 'drilling', ...(c.params as Omit<Drilling, 'op' | 'origin' | 'evidence'>), origin: 'derived',
        evidence: `drilled ⌀${c.params.diameter} ${c.params.through ? 'through' : `${c.params.depth} deep`} from the ${c.params.face} face `
            + `at ${c.params.along} along${c.params.tilt ? `, ${c.params.tilt}° off square` : ''}: ${c.evidence}`,
    }));
    const notches: Processing[] = tagged('fab:notch').map(({ c }) => ({ op: 'notch', origin: 'derived', evidence: c.evidence }));
    const unknown: Processing[] = tagged('fab:unknown').map(({ c }) => ({ op: 'unknown', origin: 'derived', evidence: c.evidence }));
    // facets of holes and other curved cuts: explained by their tool, not ends or notches
    const curvedLeaves = [...recipe.roles.keys()].filter(leaf => recipe.roles.get(leaf) !== 'base');
    const curved = new Set(m.planes.filter(p => curvedLeaves.some(leaf => onCurvedTool(p, leaf, s))));
    // faces inside the part's box that no recognised notch explains
    const notchLeaves = tagged('fab:notch').map(({ node }) => node as LeafNode);
    const inside = m.planes.filter(p => !curved.has(p) && isInsideFace(m, p, s));
    const unexplained = inside.filter(p => !notchLeaves.some(leaf =>
        recipe.planes.some(r => r.leaf === leaf && onPlane(p, r, s))));
    const loose: Processing[] = unexplained.length && !notches.length && !unknown.length
        ? [{ op: 'unknown', origin: 'measured', evidence: `${unexplained.length} face(s) inside the part's box: a notch, lap, rebate or hole that is not recognised` }]
        : [];
    m.ops = [...sawCutsOf(m, recipe, curved, s), ...drillings, ...notches, ...unknown, ...loose];
    if (recipe.state === 'live' && !recipe.partial)
    {
        const stray = m.planes.filter(p => !curved.has(p) && !recipe.planes.some(r => onPlane(p, r, s)));
        if (stray.length)
        {
            m.warnings.push(`${stray.length} face(s) lie on no primitive of the recipe: the recipe and the geometry disagree`);
        }
    }
    const summary = m.recipe === 'live' ? 'recipe recorded' : m.recipe === 'baked' ? `recipe baked (${m.recipeNote})` : 'no recipe';
    m.evidence += `; ${summary}`;
}

//// 7. PATTERNS ////

export interface PatternPoint
{
    u: number
    v: number
    /** toe fastening: which side face of the entering part, along +v or -v */
    side?: 1 | -1
}

export interface PatternContext
{
    contact: Contact
    /** The layout, lengths in mm */
    spec: Record<string, any>
    /** Fastener diameter and length in model units */
    d: number
    length: number
    from: FabMember
    s: Settings
    warn(message: string): void
    note(message: string): void
}

/** A fastener layout: where on the contact (u, v) fasteners go. Lengths in the layout are mm. */
export interface PatternDef
{
    method: 'through' | 'toe'
    /** Values used when the joint row leaves them out */
    defaults: Record<string, unknown>
    place(ctx: PatternContext): PatternPoint[]
    summary(spec: Record<string, any>): string
}

/** n values from a to b; one value sits in the middle */
function spread(a: number, b: number, n: number): number[]
{
    if (n <= 0) return [];
    if (n === 1) return [(a + b) / 2];
    return Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
}

/** How far to stay from the ends of a row, shrunk (with a warning) when the row is short */
function fitEnd(wanted: number, length: number, ctx: PatternContext, what: string): number
{
    const end = Math.min(wanted, length / 4);
    if (end < wanted - 1e-9) ctx.note(`${what}: ${ctx.s.text(wanted)} from the ends does not fit in ${ctx.s.text(length)}; used ${ctx.s.text(end)}`);
    return end;
}

/** The count along a row: at most `pitch` apart, at least two */
function rowCount(length: number, end: number, pitch: number): number
{
    return Math.max(2, Math.ceil((length - 2 * end) / pitch - 1e-9) + 1);
}

export const PATTERNS: Record<string, PatternDef> = {

    /** Across the end of a member: `count` fasteners along its width, `inset` from its sides */
    endRow: {
        method: 'through',
        defaults: { count: 2, inset: 'auto' },
        place: ctx =>
        {
            const [[u0, v0], [u1, v1]] = ctx.contact.rect;
            const width = u1 - u0;
            const wanted = ctx.spec.inset === 'auto' ? Math.max(ctx.s.minEdgeD * ctx.d, width / 4) : ctx.s.toModel(ctx.spec.inset);
            const inset = Math.min(wanted, width / 2);
            if (inset < wanted - 1e-9) ctx.note(`endRow: an inset of ${ctx.s.text(wanted)} does not fit in ${ctx.s.text(width)}; used ${ctx.s.text(inset)}`);
            return spread(u0 + inset, u1 - inset, ctx.spec.count).map(u => ({ u, v: (v0 + v1) / 2 }));
        },
        summary: spec => `endRow ×${spec.count}, inset ${spec.inset}`,
    },

    /** Along the contact: at most `pitch` apart, `end` from both ends, one row or two staggered rows.
     *  A contact shorter than twice `end` gets one per row, in the middle. */
    row: {
        method: 'through',
        defaults: { pitch: 400, end: 50, rows: 'auto', rowsAutoFrom: 80, stagger: true },
        place: ctx =>
        {
            const [[u0, v0], [u1, v1]] = ctx.contact.rect;
            const length = u1 - u0, width = v1 - v0;
            const end = ctx.s.toModel(ctx.spec.end);
            // too short for two: one in the middle stays clear of what the ends of the parts hold
            const short = length < 2 * end - 1e-9;
            if (short)
            {
                ctx.note(`row: ${ctx.s.text(end)} from the ends does not fit twice in ${ctx.s.text(length)}; one per row in the middle`);
            }
            const us = short ? [(u0 + u1) / 2] : spread(u0 + end, u1 - end, rowCount(length, end, ctx.s.toModel(ctx.spec.pitch)));
            const rows = ctx.spec.rows === 'auto' ? (width >= ctx.s.toModel(ctx.spec.rowsAutoFrom) ? 2 : 1) : ctx.spec.rows;
            const middle = (v0 + v1) / 2;
            if (rows === 1) return us.map(u => ({ u, v: middle }));
            const half = short ? 0 : (us[1] - us[0]) / 2;
            const second = ctx.spec.stagger && !short ? us.slice(0, -1).map(u => u + half) : us;
            return [
                ...us.map(u => ({ u, v: middle - width / 4 })),
                ...second.map(u => ({ u, v: middle + width / 4 })),
            ];
        },
        summary: spec => `row every ${spec.pitch} at most, ${spec.end} from the ends, rows ${spec.rows}`,
    },

    /** Near the corners of the contact, `edge` in: 1 in the middle, 2 on a diagonal, 4 in all corners */
    corners: {
        method: 'through',
        defaults: { count: 2, edge: 25 },
        place: ctx =>
        {
            const [[u0, v0], [u1, v1]] = ctx.contact.rect;
            const e = ctx.s.toModel(ctx.spec.edge);
            const middle = { u: (u0 + u1) / 2, v: (v0 + v1) / 2 };
            if (ctx.spec.count === 1) return [middle];
            if (u1 - u0 < 2 * e || v1 - v0 < 2 * e)
            {
                ctx.warn(`corners: the contact is smaller than twice the edge distance of ${ctx.spec.edge} mm; one fastener in the middle`);
                return [middle];
            }
            const corners = [
                { u: u0 + e, v: v0 + e }, { u: u1 - e, v: v1 - e },
                { u: u1 - e, v: v0 + e }, { u: u0 + e, v: v1 - e },
            ];
            return corners.slice(0, Math.min(4, ctx.spec.count));
        },
        summary: spec => `corners ×${spec.count}, ${spec.edge} from the edges`,
    },

    /** Along a framing member under a sheet: `edgePitch` where the sheet edge is within `edgeZone`, `pitch` elsewhere */
    sheet: {
        method: 'through',
        defaults: { pitch: 300, edgePitch: 150, edgeZone: 50, end: 15 },
        place: ctx =>
        {
            const { contact, s } = ctx;
            const [[u0, v0], [u1, v1]] = contact.rect;
            const sheet = ctx.from;
            const middle = add(contact.origin, add(scale(contact.u, (u0 + u1) / 2), scale(contact.v, (v0 + v1) / 2)));
            const toEdge = extentAlong(sheet, contact.v) / 2 - Math.abs(dot(sub(middle, sheet.center), contact.v));
            const atEdge = toEdge <= s.toModel(ctx.spec.edgeZone) + 1e-9;
            const pitch = s.toModel(atEdge ? ctx.spec.edgePitch : ctx.spec.pitch);
            ctx.note(atEdge ? `at the sheet edge (${s.text(Math.max(0, toEdge))} in): every ${ctx.spec.edgePitch} mm` : `in the sheet field: every ${ctx.spec.pitch} mm`);
            const length = u1 - u0;
            const end = fitEnd(s.toModel(ctx.spec.end), length, ctx, 'sheet');
            return spread(u0 + end, u1 - end, rowCount(length, end, pitch)).map(u => ({ u, v: (v0 + v1) / 2 }));
        },
        summary: spec => `sheet every ${spec.pitch} (${spec.edgePitch} at edges)`,
    },

    /** Inclined through the two wide faces of the entering part, `start` from the contact, `angle` from its axis.
     *  `count` places along the width, `inset` from its sides, taken by the two faces in turn: fasteners from
     *  opposite faces are staggered, so they pass each other. */
    toe: {
        method: 'toe',
        defaults: { count: 2, angle: 30, start: 'auto', inset: 'auto' },
        place: ctx =>
        {
            const [[u0, v0], [u1, v1]] = ctx.contact.rect;
            const width = u1 - u0;
            const inset = ctx.spec.inset === 'auto'
                ? Math.max(ctx.s.minEdgeD * ctx.d, width / 4)
                : Math.min(ctx.s.toModel(ctx.spec.inset), width / 2);
            const middle = (v0 + v1) / 2;
            return spread(u0 + inset, u1 - inset, ctx.spec.count)
                .map((u, i) => ({ u, v: middle, side: (i % 2 === 0 ? 1 : -1) as 1 | -1 }));
        },
        summary: spec => `toe ×${spec.count} at ${spec.angle}°, inset ${spec.inset}`,
    },
};

//// 8. FASTENINGS ////

function emptyFastening(c: Contact): Fastening
{
    return {
        op: 'fasten', joint: null, rule: null, contact: c, method: 'none', pattern: null, from: null, fastener: null,
        fasteners: [], count: 0, spec: {}, sources: {}, status: 'none', warnings: [], notes: [], evidence: '', coveredBy: [], shapes: [],
    };
}

/** The thinner part along the contact normal. When both are as thick, the one whose far face is free, so the
 *  fasteners can be driven after everything else is in place. */
function thinnerOf(c: Contact, all: Contact[]): FabMember
{
    const te = extentAlong(c.entering, c.normal), tr = extentAlong(c.receiving, c.normal);
    if (Math.abs(te - tr) > 1e-6 * Math.max(te, tr)) return te < tr ? c.entering : c.receiving;
    const outward = (o: Contact, m: FabMember) => o.receiving === m ? o.normal : scale(o.normal, -1);
    const onFarFace = (m: FabMember, far: Vec3) =>
        all.filter(o => o !== c && (o.a === m || o.b === m) && dot(outward(o, m), far) >= 0.99).length;
    return onFarFace(c.receiving, scale(c.normal, -1)) < onFarFace(c.entering, c.normal) ? c.receiving : c.entering;
}

/** The part fasteners are driven through */
function fromOf(c: Contact, all: Contact[], method: FabMethod, from: string, notes: string[], warnings: string[]): FabMember
{
    if (method === 'toe') return c.entering;
    if (c.kind.startsWith('end'))
    {
        if (from && from !== 'auto') notes.push(`'from: ${from}' does not apply: a part that ends on another is fastened through the other`);
        return c.receiving;
    }
    if (from === 'sheet')
    {
        const sheet = [c.entering, c.receiving].find(m => m.kind === 'sheet');
        if (sheet) return sheet;
        warnings.push(`'from: sheet' but neither part is a sheet; fastened through the thinner part`);
        return thinnerOf(c, all);
    }
    if (from === 'a') return c.a;
    if (from === 'b') return c.b;
    return thinnerOf(c, all);
}

/** The fastener length in model units. 'auto' takes the shortest catalogue length that reaches the wanted
 *  penetration without coming out of the far side. */
function lengthOf(spec: Record<string, any>, t: number, depth: number, target: FabMember, book: FabBook, s: Settings,
    notes: string[], warnings: string[]): { length: number, how: string, auto: boolean }
{
    const f = spec.fastener as FastenerSpec;
    if (f.length !== 'auto') return { length: s.toModel(f.length), how: `${f.length}`, auto: false };
    const tMm = t * s.mm;
    const want = tMm + spec.penetration;
    const limit = tMm + depth * s.mm - s.minCover;
    const lengths = book.fasteners
        .filter(x => x.type === f.type && Math.abs(x.diameter - f.diameter) < 1e-9)
        .map(x => x.length)
        .sort((x, y) => x - y);
    const how = (picked: number) => `auto → ${picked} (${round1(tMm)} through + ${round1(want - tMm)} into ${target.name})`;
    if (!lengths.length)
    {
        const picked = Math.ceil(Math.min(want, limit) / 10) * 10;
        warnings.push(`no catalogue length for ${f.type} ⌀${f.diameter}: used ${picked} mm`);
        return { length: s.toModel(picked), how: how(picked), auto: true };
    }
    const fitting = lengths.filter(l => l <= limit + 1e-9);
    const long = fitting.find(l => l >= want - 1e-9);
    const picked = long ?? (fitting.length ? fitting[fitting.length - 1] : (lengths.find(l => l >= want - 1e-9) ?? lengths[lengths.length - 1]));
    if (long === undefined && fitting.length)
    {
        notes.push(`${picked} mm is the longest ${f.type} ⌀${f.diameter} that stays inside ${target.name}`);
    }
    return { length: s.toModel(picked), how: how(picked), auto: true };
}

function toePlacements(c: Contact, points: PatternPoint[], spec: Record<string, any>, length: number, s: Settings): FastenerPlacement[]
{
    const e = c.entering;
    const theta = spec.angle * DEG;
    const start = spec.start === 'auto' ? length / 3 : s.toModel(spec.start);
    const half = extentAlong(e, c.v) / 2;
    const centre = dot(sub(e.center, c.origin), c.v);
    return points.map(p =>
    {
        const side = p.side ?? 1;
        const point = add(add(c.origin, scale(c.u, p.u)), add(scale(c.v, centre + side * half), scale(c.normal, start)));
        const dir = unit(add(scale(c.normal, -Math.cos(theta)), scale(c.v, -side * Math.sin(theta))));
        return { point, dir, length };
    });
}

function insidePieces(pieces: P2[][], p: P2, margin: number): boolean
{
    return pieces.some(poly => insideConvex(p, poly, margin));
}

/** A contact of the `from` part (other than this one) that covers an entry point: that part must come later */
function coveringPart(point: Vec3, c: Contact, from: FabMember, all: Contact[], s: Settings): FabMember | null
{
    const other = all.find(o => o !== c && (o.a === from || o.b === from) && o.a.kind !== 'fill' && o.b.kind !== 'fill'
        && Math.abs(dot(sub(point, o.origin), o.normal)) <= s.tolerance
        && insidePieces(o.pieces, [dot(sub(point, o.origin), o.u), dot(sub(point, o.origin), o.v)], -s.tolerance));
    return other ? (other.a === from ? other.b : other.a) : null;
}

/** Where through fasteners point. Into end grain they follow the part that ends: a stud under a sloped plate is
 *  screwed along the stud, not square to the plate, so the screws stay inside it. An end face is never more than
 *  45° off its part's axis (roleOf), so the way through the other part stays short. Otherwise square to the
 *  contact, away from `from`. */
function driveDirection(c: Contact, from: FabMember): Vec3
{
    if (!c.kind.startsWith('end') || from !== c.receiving) return from === c.receiving ? c.normal : scale(c.normal, -1);
    const long = c.entering.axes.long;
    return dot(long, c.normal) >= 0 ? long : scale(long, -1);
}

function insideBox(m: FabMember, p: Vec3, tolerance: number): boolean
{
    const offset = sub(p, m.center);
    return ([[m.axes.thin, m.thickness], [m.axes.wide, m.width], [m.axes.long, m.length]] as Array<[Vec3, number]>)
        .every(([axis, size]) => Math.abs(dot(offset, axis)) <= size / 2 + tolerance);
}

/** Shortest distance between segments pq and rs */
function segmentDistance(p: Vec3, q: Vec3, r: Vec3, t: Vec3): number
{
    const d1 = sub(q, p), d2 = sub(t, r), w = sub(p, r);
    const a = dot(d1, d1), e = dot(d2, d2), b = dot(d1, d2), c = dot(d1, w), f = dot(d2, w);
    const denom = a * e - b * b;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    let sc = denom > 1e-12 ? clamp((b * f - c * e) / denom) : 0;
    let tc = e > 1e-12 ? (b * sc + f) / e : 0;
    if (tc < 0 || tc > 1)
    {
        tc = clamp(tc);
        sc = a > 1e-12 ? clamp((b * tc - c) / a) : 0;
    }
    return len(sub(add(p, scale(d1, sc)), add(r, scale(d2, tc))));
}

/** Two parts that end on opposite faces of one part at the same place block each other's through fasteners.
 *  Where the joint row says covered: 'toe' and nobody chose the method, the later one is fastened toe-wise. */
function switchCovered(fastenings: Fastening[], book: FabBook, toToe: (f: Fastening, note: string) => Fastening): void
{
    fastenings.forEach((f, i) =>
    {
        const row = book.joints.find(r => r.rule === f.rule);
        if (!row || row.covered !== 'toe' || !row.toe || f.method !== 'through' || !['book', 'sheet'].includes(f.sources.method)) return;
        if (!f.contact.kind.startsWith('end') || !f.coveredBy.length) return;
        const blocker = fastenings.slice(0, i).find(g => g.method === 'through' && g.from === f.from
            && f.coveredBy.includes(g.contact.entering) && g.coveredBy.includes(f.contact.entering));
        if (!blocker) return;
        fastenings[i] = toToe(f, `fastened toe-wise: ${blocker.contact.entering.name} covers the entry and is fastened through `
            + `${f.from.name} from the other side (covered: toe in ${row.rule})`);
    });
}

/** Fasteners of different joints that run into each other. Both fastenings get a warning. */
function markCrossings(fastenings: Fastening[], s: Settings): string[]
{
    const rods = fastenings
        .filter(f => f.fastener)
        .flatMap(f => f.fasteners.map(p =>
        {
            const tip = add(p.point, scale(p.dir, p.length));
            return { f, a: p.point, b: tip, r: s.toModel(f.fastener.diameter) / 2, lo: Math.min(p.point[0], tip[0]), hi: Math.max(p.point[0], tip[0]) };
        }))
        .sort((x, y) => x.lo - y.lo);
    const index = new Map(fastenings.map((f, i) => [f, i]));
    const crossings = new Map<string, { f: Fastening, g: Fastening, gap: number }>();
    rods.forEach((x, i) =>
    {
        const later = rods.slice(i + 1);
        const stop = later.findIndex(y => y.lo > x.hi + x.r + y.r);
        (stop < 0 ? later : later.slice(0, stop))
            // fasteners of one joint are parallel and spaced (checked there), except toe fasteners
            .filter(y => y.f !== x.f || x.f.method === 'toe')
            .forEach(y =>
            {
                const gap = segmentDistance(x.a, x.b, y.a, y.b) - x.r - y.r;
                if (gap >= 0) return;
                const [f, g] = [x.f, y.f].sort((m, n) => index.get(m) - index.get(n));
                const key = `${index.get(f)}:${index.get(g)}`;
                if (!crossings.has(key)) crossings.set(key, { f, g, gap });
            });
    });
    const pair = (f: Fastening) => `${f.contact.entering.name} / ${f.contact.receiving.name}`;
    return [...crossings.values()].map(({ f, g }) =>
    {
        f.status = g.status = 'warning';
        if (f === g)
        {
            f.warnings.push('its fasteners cross each other: change the count or inset');
            return `fasteners of ${pair(f)} cross each other`;
        }
        const advice = 'change the inset or pitch of one joint, or fasten one of them toe-wise';
        f.warnings.push(`its fasteners cross those of ${pair(g)}: ${advice}`);
        g.warnings.push(`its fasteners cross those of ${pair(f)}: ${advice}`);
        return `fasteners of ${pair(f)} and ${pair(g)} cross`;
    });
}

function buildFastening(c: Contact, resolved: ResolvedJoint | null, all: Contact[], book: FabBook, s: Settings): Fastening
{
    const base = emptyFastening(c);
    if (!resolved)
    {
        return {
            ...base,
            status: 'unmatched',
            warnings: [`no joint rule for a ${c.kind} contact between a ${c.entering.kind} and a ${c.receiving.kind}`],
            evidence: `${c.evidence} → no joint rule`,
        };
    }
    const { row, spec, sources } = resolved;
    const notes = row.note ? [row.note] : [];
    if (!spec)
    {
        return {
            ...base, joint: row.joint, rule: row.rule, sources, notes,
            evidence: `${c.evidence} → ${row.joint} (${row.rule}), not fastened`,
        };
    }
    const warnings: string[] = [];
    const method = row.method;
    const from = fromOf(c, all, method, spec.from, notes, warnings);
    const target = from === c.entering ? c.receiving : c.entering;
    const dir = method === 'toe' ? c.normal : driveDirection(c, from);
    // through a flat part at a slant, the way through is longer than its thickness
    const t = extentAlong(from, c.normal) / Math.abs(dot(dir, c.normal));
    const depth = extentAlong(target, dir);
    const d = s.toModel(spec.fastener.diameter);
    const { length, how, auto } = method === 'toe'
        ? { length: s.toModel(spec.fastener.length), how: `${spec.fastener.length}`, auto: false }
        : lengthOf(spec, t, depth, target, book, s, notes, warnings);
    if (auto) sources.length = 'auto';
    const fastener: Fastener = { type: spec.fastener.type, diameter: spec.fastener.diameter, length: round1(length * s.mm) };
    const pattern = PATTERNS[spec.pattern];
    const ctx: PatternContext = {
        contact: c, spec, d, length, from, s,
        warn: message => warnings.push(message),
        note: message => notes.push(message),
    };
    const points = pattern.place(ctx);
    const placed = method === 'toe' ? points : points.filter(p => insidePieces(c.pieces, [p.u, p.v], -s.tolerance));
    if (placed.length < points.length)
    {
        warnings.push(`${points.length - placed.length} of ${points.length} fasteners fall outside the contact and are left out`);
    }
    let fasteners: FastenerPlacement[];
    let coveredBy: FabMember[] = [];
    if (method === 'toe')
    {
        if (!c.kind.startsWith('end'))
        {
            warnings.push(`toe fastening needs a part that ends on the other; this contact is ${c.kind}`);
            fasteners = [];
        }
        else
        {
            fasteners = toePlacements(c, placed, spec, length, s);
            const start = spec.start === 'auto' ? length / 3 : s.toModel(spec.start);
            const reach = length * Math.cos(spec.angle * DEG) - start;
            if (reach > extentAlong(c.receiving, c.normal) + 1e-9)
            {
                warnings.push(`the toe fasteners come out of ${c.receiving.name}: they reach ${s.text(reach)} into a ${s.text(extentAlong(c.receiving, c.normal))} part`);
            }
            if (reach < s.minPenetrationD * d - 1e-9)
            {
                warnings.push(`the toe fasteners reach ${s.text(reach)} into ${c.receiving.name}, less than ${s.minPenetrationD}d = ${s.text(s.minPenetrationD * d)}`);
            }
        }
    }
    else
    {
        fasteners = placed.map(p => ({
            point: sub(add(c.origin, add(scale(c.u, p.u), scale(c.v, p.v))), scale(dir, t)),
            dir,
            length,
        }));
        const penetration = length - t;
        if (penetration < s.minPenetrationD * d - 1e-9)
        {
            warnings.push(`penetration ${s.text(penetration)} is less than ${s.minPenetrationD}d = ${s.text(s.minPenetrationD * d)}`);
        }
        if (length > t + depth + 1e-9)
        {
            warnings.push(`the fastener comes out of ${target.name}: ${s.text(length)} > ${s.text(t)} + ${s.text(depth)}`);
        }
        const [[u0, v0], [u1, v1]] = c.rect;
        const nearest = minOf(placed.map(p => Math.min(p.u - u0, u1 - p.u, p.v - v0, v1 - p.v)));
        if (placed.length && nearest < s.minEdgeD * d - 1e-9)
        {
            warnings.push(`a fastener is ${s.text(Math.max(0, nearest))} from the edge of the contact, less than ${s.minEdgeD}d = ${s.text(s.minEdgeD * d)}`);
        }
        const outside = fasteners.filter(f => !insideBox(target, add(f.point, scale(f.dir, f.length)), s.tolerance));
        if (outside.length)
        {
            warnings.push(`${outside.length} of ${fasteners.length} fastener tips end outside ${target.name}`);
        }
        coveredBy = [...new Set(fasteners.map(f => coveringPart(f.point, c, from, all, s)).filter(Boolean))];
        coveredBy.forEach(part => notes.push(`entry covered by ${part.name}: fasten before placing it`));
    }
    const spacing = minOf(fasteners.flatMap((f, i) => fasteners.slice(i + 1).map(g => len(sub(f.point, g.point)))));
    if (fasteners.length > 1 && spacing < s.minSpacingD * d - 1e-9)
    {
        warnings.push(`fasteners are ${s.text(spacing)} apart, less than ${s.minSpacingD}d = ${s.text(s.minSpacingD * d)}`);
    }
    return {
        ...base,
        joint: row.joint,
        rule: row.rule,
        method,
        pattern: spec.pattern,
        from,
        fastener,
        fasteners,
        count: fasteners.length,
        spec,
        sources,
        status: warnings.length ? 'warning' : 'ok',
        warnings,
        notes,
        evidence: `${c.evidence} → ${row.joint} (${row.rule}); ${method} ${from.name}, ${pattern.summary(spec)}; `
            + `${fasteners.length}× ${fastener.type} ⌀${fastener.diameter} length ${how}`,
        coveredBy,
    };
}

//// 9. DIAGRAM ////

const DIAGRAM_COLOR = '#8a8a8a';
const HARDWARE_COLOR = '#6f7780';

/** Draw a fastening once per layout: curves with detail 'diagram', fastener parts with 'full' */
function draw(modeler: Modeler, state: FabRunState, key: string, f: Fastening, detail: FabDetail, s: Settings): void
{
    if (detail === 'none') return;
    // rounded, and -0 made 0, so rounding noise does not redraw
    const hash = `${detail}|${f.fastener?.type}|${f.fastener?.diameter}|` + f.fasteners
        .map(p => [...p.point, ...p.dir, p.length].map(x => (Math.round(x * 1e4) / 1e4 + 0).toFixed(4)).join(','))
        .join(';');
    const old = state.drawn.get(key);
    if (old && old.hash === hash)
    {
        f.shapes = old.shapes;
        return;
    }
    if (old)
    {
        old.shapes.forEach(shape =>
        {
            state.layer?.remove?.(shape);
            state.hardwareLayer?.remove?.(shape);
            shape.removeFromScene?.();
        });
        state.drawn.delete(key);
    }
    if (!f.fasteners.length || !f.fastener) return;
    const shapes = detail === 'full' ? hardwareOf(modeler, state, f, s) : diagramOf(modeler, state, f, s);
    state.drawn.set(key, { hash, shapes });
    f.shapes = shapes;
}

function diagramOf(modeler: Modeler, state: FabRunState, f: Fastening, s: Settings): any[]
{
    const kernel: any = modeler.kernel();
    state.layer ??= modeler.group('fasteners');
    const radius = s.toModel(f.fastener.diameter) / 2;
    const shapes = f.fasteners.flatMap(p => [
        kernel.Curve.Circle(radius, [...p.point], [...p.dir]).name('fastener').color(DIAGRAM_COLOR),
        kernel.Curve.Line([...p.point], [...add(p.point, scale(p.dir, p.length))]).name('fastener').color(DIAGRAM_COLOR),
    ]);
    state.layer.add(shapes);
    return shapes;
}

/** A cylinder of the kernel from `start` along the unit `dir`: the recipe records it like any other */
function cylinderAlong(kernel: any, start: Vec3, dir: Vec3, radius: number, length: number): any
{
    const cylinder = kernel.Mesh.Cylinder(radius, length);
    const axis = cross([0, 0, 1], dir);
    const sin = len(axis), cos = dir[2];
    if (sin > 1e-12) cylinder.rotate(Math.atan2(sin, cos) / DEG, [...scale(axis, 1 / sin)]);
    else if (cos < 0) cylinder.rotate(180, 'x');
    return cylinder.translate([...start]);
}

/** Detail 'full': each fastener as a part, a shank and a head, in the 'hardware' group. The parts they go
 *  through are not cut: the holes are data (ops.holes(), BTLx { holes: true }). Cutting them into the mesh
 *  was tried: the mesh kernel traps on tilted recesses and takes seconds per wall, and cut parts change the
 *  next layout. */
function hardwareOf(modeler: Modeler, state: FabRunState, f: Fastening, s: Settings): any[]
{
    const kernel: any = modeler.kernel();
    state.hardwareLayer ??= modeler.group('hardware');
    const radius = s.toModel(f.fastener.diameter) / 2;
    const shapes = f.fasteners.flatMap(p =>
    {
        // a through fastener's head is sunk flush, a toe fastener's sits on its sloped entry
        const depth = Math.min(radius * 1.2, p.length / 4);
        const head = f.method === 'through' ? p.point : sub(p.point, scale(p.dir, depth));
        return [
            cylinderAlong(kernel, p.point, p.dir, radius, p.length).name(f.fastener.type),
            cylinderAlong(kernel, head, p.dir, radius * 2, depth).name(`${f.fastener.type} head`),
        ].map(shape => shape.color(HARDWARE_COLOR));
    });
    shapes.forEach(shape => state.hardware.add(shape));
    state.hardwareLayer.add(shapes);
    return shapes;
}

//// 10. SCRIPT API ////

const ids = new WeakMap<object, number>();
let lastId = 0;

function idOf(shape: object): number
{
    if (!ids.has(shape)) ids.set(shape, ++lastId);
    return ids.get(shape);
}

function pairKey(a: object, b: object): string
{
    return [idOf(a), idOf(b)].sort((x, y) => x - y).join(':');
}

function stateOf(modeler: Modeler): FabRunState
{
    const holder = modeler as unknown as { _fabState: FabRunState | null };
    holder._fabState ??= {
        base: null, changes: [], book: null, pairs: new Map(), drawn: new Map(), layer: null,
        hardware: new WeakSet(), hardwareLayer: null,
    };
    return holder._fabState;
}

function requireMesh(modeler: Modeler, method: string): void
{
    if (modeler.mode() !== 'mesh')
    {
        throw new Error(`fab.${method}(): needs the mesh kernel, and this script runs in ${modeler.mode()} mode.`);
    }
}

function optionsOf<T extends object>(options: T | undefined, known: string[], where: string): T
{
    if (options === undefined || options === null) return {} as T;
    assertObject(options, where, '{ tolerance: 1 }');
    assertKeys(options, known, where);
    return options;
}

function oneSolid(input: any, label: string, method: string): any
{
    const solids = solidsOf(input, true);
    if (solids.length !== 1)
    {
        throw new Error(`fab.${method}(a, b): ${label} must be one solid, got ${solids.length}`);
    }
    return solids[0];
}

function measureOne(shape: any, s: Settings, method: string): FabMember
{
    const member = measureMember(shape, idOf(shape), s);
    if (!member)
    {
        throw new Error(`fab.${method}(): ${safe(() => shape.name(), '') || 'a shape'} has no volume to measure`);
    }
    return member;
}

/** The norm book in effect for this run */
export function effectiveBook(modeler: Modeler): FabBook
{
    const state = stateOf(modeler);
    state.book ??= state.changes.reduce((book, change, i) => applyBookPatch(book, change, 'run', `run${i + 1}`), state.base ?? loadBaseBook());
    return state.book;
}

export function configure(modeler: Modeler, change: FabBookPatch): void
{
    const state = stateOf(modeler);
    const next = applyBookPatch(effectiveBook(modeler), change, 'run', `run${state.changes.length + 1}`);
    state.changes.push(clone(change));
    state.book = next;
}

export function config(modeler: Modeler): FabBook
{
    return clone(effectiveBook(modeler));
}

export function contact(modeler: Modeler, a: any, b: any, options?: ContactOptions): Contact | null
{
    requireMesh(modeler, 'contact');
    const opts = optionsOf(options, ['tolerance'], 'fab.contact() options');
    const s = settingsOf(effectiveBook(modeler), modeler.units(), opts.tolerance);
    return contactBetween(
        measureOne(oneSolid(a, 'a', 'contact'), s, 'contact'),
        measureOne(oneSolid(b, 'b', 'contact'), s, 'contact'), s);
}

export function connections(modeler: Modeler, shapes: any, options?: ContactOptions): Contact[]
{
    requireMesh(modeler, 'connections');
    const opts = optionsOf(options, ['tolerance', 'hidden'], 'fab.connections() options');
    const s = settingsOf(effectiveBook(modeler), modeler.units(), opts.tolerance);
    const state = stateOf(modeler);
    const members = solidsOf(shapes, opts.hidden ?? false, state.hardware).map(shape => measureMember(shape, idOf(shape), s)).filter(Boolean);
    const { contacts } = findContacts(members, s);
    markFills(members, contacts, s);
    return contacts;
}

const FASTEN_KEYS = [...PAIR_ONLY_KEYS, 'method', ...SPEC_KEYS];

export function fasten(modeler: Modeler, a: any, b: any, options?: FastenOptions): Fastening
{
    requireMesh(modeler, 'fasten');
    const opts = optionsOf(options, FASTEN_KEYS, 'fab.fasten() options');
    assertFastener(opts.fastener, 'fab.fasten() options');
    const book = effectiveBook(modeler);
    const s = settingsOf(book, modeler.units(), opts.tolerance);
    const shapeA = oneSolid(a, 'a', 'fasten'), shapeB = oneSolid(b, 'b', 'fasten');
    const [ma, mb] = [shapeA, shapeB].map(shape => measureOne(shape, s, 'fasten'));
    const c = contactBetween(ma, mb, s);
    if (!c)
    {
        const gap = gapBetween(ma, mb, s) ?? gapBetween(mb, ma, s);
        throw new Error(`fab.fasten(): ${ma.name} and ${mb.name} do not touch`
            + (gap !== null ? ` (gap ${round1(gap * s.mm).toFixed(1)} mm)` : '')
            + '. Move them together, or raise the tolerance.');
    }
    markFills([ma, mb], [c], s);
    const f = buildFastening(c, resolveJoint(c, book.joints, opts, s), [c], book, s);
    markCrossings([f], s);
    const state = stateOf(modeler);
    const key = pairKey(shapeA, shapeB);
    state.pairs.set(key, clone(opts));
    draw(modeler, state, key, f, opts.detail ?? 'diagram', s);
    return f;
}

export function operations(modeler: Modeler, shapes: any, options?: OperationsOptions): FabOperations
{
    requireMesh(modeler, 'operations');
    const opts = optionsOf(options, ['joints', 'detail', 'tolerance', 'hidden'], 'fab.operations() options');
    const base = effectiveBook(modeler);
    const book: FabBook = opts.joints ? { ...base, joints: patchJoints(base.joints, opts.joints, 'call', 'call') } : base;
    const s = settingsOf(book, modeler.units(), opts.tolerance);
    const state = stateOf(modeler);
    const solids = solidsOf(shapes, opts.hidden ?? false, state.hardware);
    const members = solids.map(shape => measureMember(shape, idOf(shape), s)).filter(Boolean);
    const { contacts, warnings } = findContacts(members, s);
    markFills(members, contacts, s);
    members.forEach(m => readPart(m, s));
    const pairOf = (c: Contact) => state.pairs.get(pairKey(c.a.shape, c.b.shape));
    const fastenings = contacts.map(c => buildFastening(c, resolveJoint(c, book.joints, pairOf(c), s), contacts, book, s));
    switchCovered(fastenings, book, (f, note) =>
    {
        const resolved = resolveJoint(f.contact, book.joints, { ...(pairOf(f.contact) ?? {}), method: 'toe' }, s);
        resolved.sources.method = 'auto';
        const toe = buildFastening(f.contact, resolved, contacts, book, s);
        toe.notes.unshift(note);
        return toe;
    });
    fastenings.forEach(f => draw(modeler, state, pairKey(f.contact.a.shape, f.contact.b.shape), f,
        pairOf(f.contact)?.detail ?? opts.detail ?? 'diagram', s));
    markCrossings(fastenings, s);
    const notes = [
        ...(solids.length > members.length ? [`${solids.length - members.length} solids have no volume and are left out`] : []),
        ...warnings,
        ...members.map(nameMismatch).filter(Boolean),
    ];
    const ops = new FabOperations(modeler, book, s, members, contacts, fastenings, notes);
    const attention = fastenings.filter(f => f.status === 'warning' || f.status === 'unmatched').length;
    if (attention || warnings.length)
    {
        console.warn(`fab.operations(): ${attention} of ${fastenings.length} contacts need attention`
            + (warnings.length ? `, ${warnings.length} parts overlap` : '') + '. See ops.warnings().');
    }
    return ops;
}

/** What fab.operations() found: parts, contacts, fastenings, and everything that needs a look */
export class FabOperations
{
    constructor(
        private readonly _modeler: Modeler,
        /** The norm book used */
        readonly book: FabBook,
        private readonly _s: Settings,
        private readonly _members: FabMember[],
        private readonly _contacts: Contact[],
        private readonly _fastenings: Fastening[],
        private readonly _notes: string[],
    ) {}

    /** The measuring settings used, in model units */
    get settings(): Settings
    {
        return this._s;
    }

    members(): FabMember[]
    {
        return [...this._members];
    }

    contacts(): Contact[]
    {
        return [...this._contacts];
    }

    fastenings(): Fastening[]
    {
        return [...this._fastenings];
    }

    /** How many of each fastener, sizes in mm */
    fasteners(): Array<Fastener & { count: number }>
    {
        const totals = this._fastenings
            .filter(f => f.fastener && f.count)
            .reduce((acc, f) =>
            {
                const key = `${f.fastener.type}|${f.fastener.diameter}|${f.fastener.length}`;
                acc.set(key, { ...f.fastener, count: (acc.get(key)?.count ?? 0) + f.count });
                return acc;
            }, new Map<string, Fastener & { count: number }>());
        return [...totals.values()].sort((x, y) =>
            x.type.localeCompare(y.type) || x.diameter - y.diameter || x.length - y.length);
    }

    /** The holes of the fasteners, one per fastener per part it goes into, for pre-drilling (BTLx { holes: true }).
     *  They belong to the fastenings: the estimate times them there, and they are not in the parts' ops. */
    holes(): Array<Drilling & { part: string, member: FabMember }>
    {
        return this._fastenings.filter(f => f.count > 0 && f.fastener).flatMap(f =>
        {
            const radius = this._s.toModel(f.fastener.diameter) / 2;
            const label = `${f.joint} ${f.contact.entering.name}/${f.contact.receiving.name}`;
            // from a little outside the entry face, so the hole reads as drilled from there
            const lead = this._s.tolerance;
            return f.fasteners.flatMap(p => [f.contact.a, f.contact.b].flatMap(m =>
            {
                const d = drillAlong(m, sub(p.point, scale(p.dir, lead)), scale(p.dir, p.length + lead), radius, this._s);
                if (!d) return [];
                return [{
                    op: 'drilling' as const, ...d, fastener: label, origin: 'derived' as const, part: m.name, member: m,
                    evidence: `a ⌀${d.diameter} hole for a ${f.fastener.type} of ${label}, ${d.through ? 'through' : `${d.depth} deep`}`,
                }];
            }));
        });
    }

    /** Everything the workshop does, one entry per operation: part operations first, then fastenings */
    list(): Array<Record<string, unknown> & { part: string, op: string }>
    {
        return [
            ...this._members.flatMap(m => m.ops.map(op => ({ part: m.name, ...op }))),
            ...this._fastenings.filter(f => f.count > 0).map(f => ({
                part: f.contact.entering.name, on: f.contact.receiving.name, op: 'fasten', joint: f.joint, rule: f.rule,
                method: f.method, pattern: f.pattern, fastener: f.fastener, count: f.count, origin: 'rule', evidence: f.evidence,
            })),
        ];
    }

    /** The cut list: parts that are the same (kind, section, length, material, cuts, drillings) counted together */
    parts(): Array<{ parts: string[], kind: FabKind, section: string, length: number, material: string, start: string,
        end: string, drillings: number, notches: number, count: number, origin: string }>
    {
        const cutText = (m: FabMember, end: 'start' | 'end') =>
        {
            const cut = m.ops.find(op => op.op === 'sawCut' && op.end === end) as SawCut | undefined;
            if (!cut) return m.ops.some(op => op.op === 'unknown' && op.evidence.startsWith(`the ${end}`)) ? '?' : '';
            return cut.kind === 'square' ? '90' : cut.kind === 'double' ? 'double' : `${cut.angle}/${cut.inclination}`;
        };
        const rows = this._members
            .filter(m => m.kind === 'stick' || m.kind === 'block')
            .map(m => ({
                name: m.name, kind: m.kind, section: m.section, length: round1(m.length * this._s.mm),
                material: m.material?.name ?? '', start: cutText(m, 'start'), end: cutText(m, 'end'),
                drillings: m.ops.filter(op => op.op === 'drilling').length,
                notches: m.ops.filter(op => op.op === 'notch' || op.op === 'unknown').length,
                origin: m.recipe === 'live' ? 'derived' : 'measured',
            }));
        const grouped = rows.reduce((acc, row) =>
        {
            // a part cut the same at both ends reads the same both ways round
            const ends = [row.start, row.end].sort().join('|');
            const key = [row.kind, row.section, row.length, row.material, ends, row.drillings, row.notches].join('|');
            const hit = acc.get(key);
            if (hit)
            {
                hit.parts.push(row.name);
                hit.count += 1;
                if (row.origin === 'measured') hit.origin = 'measured';
            }
            else
            {
                const { name, ...rest } = row;
                acc.set(key, { parts: [name], ...rest, count: 1 });
            }
            return acc;
        }, new Map<string, any>());
        return [...grouped.values()].sort((x, y) => x.section.localeCompare(y.section) || y.length - x.length);
    }

    /** Everything that needs a look: overlaps, contacts without a rule, failed checks, name mismatches,
     *  parts whose recipe and geometry disagree, parts or ends that are not recognised */
    warnings(): string[]
    {
        return [
            ...this._notes,
            ...this._members.flatMap(m => m.warnings.map(w => `${m.name}: ${w}`)),
            ...this._members.flatMap(m => m.ops
                .filter(op => op.op === 'unknown')
                .map(op => `${m.name}: not recognised: ${op.evidence}`)),
            ...this._fastenings.flatMap(f => f.warnings.map(w => `${f.contact.entering.name} / ${f.contact.receiving.name}: ${w}`)),
        ];
    }

    /** A calc table: one row per contact; with { by: 'fastener' } the fastener totals; with { by: 'part' } the cut
     *  list; with { by: 'operation' } one row per part operation */
    table(name: string = 'fastenings', options?: { by?: 'fastening' | 'fastener' | 'part' | 'operation' }): any
    {
        const opts = optionsOf(options, ['by'], 'ops.table() options');
        const calc: any = this._modeler.modules?.calc;
        if (!calc)
        {
            throw new Error('ops.table(): needs the calc module. Scripts have it; call modeler.setArchiyou() with calc otherwise.');
        }
        const footerLabel = `norm book ${this.book.version}`;
        // calc tables name columns by position, so every row is written in column order
        const write = (rows: Array<Record<string, unknown>>, columns: string[]) =>
            calc.table(name, rows.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? '']))), columns);
        const by = opts.by ?? 'fastening';
        if (!['fastening', 'fastener', 'part', 'operation'].includes(by))
        {
            throw new Error(`ops.table(): by '${by}' is not known. Use fastening, fastener, part or operation`);
        }
        if (by === 'part')
        {
            const rows = this.parts().map(({ parts, ...row }) => ({
                part: parts.length > 1 ? `${parts[0]} +${parts.length - 1}` : parts[0], ...row,
            }));
            const columns = ['part', 'kind', 'section', 'length', 'count', 'start', 'end', 'drillings', 'notches', 'material', 'origin'];
            return write(rows, columns).footer({ part: 'total', count: 'sum' });
        }
        if (by === 'operation')
        {
            const rows = this._members.flatMap(m => m.ops.map(op => ({ part: m.name, op: op.op, origin: op.origin, detail: op.evidence })));
            return write(rows, ['part', 'op', 'origin', 'detail']).footer({ part: `${rows.length} operations` });
        }
        if (by === 'fastener')
        {
            const rows = this.fasteners().map(f => ({ type: f.type, diameter: f.diameter, length: f.length, count: f.count }));
            return write(rows, ['type', 'diameter', 'length', 'count']).footer({ type: footerLabel, count: 'sum' });
        }
        const rows = this._fastenings.map(f => ({
            joint: f.joint ?? '?',
            part: f.contact.entering.name,
            on: f.contact.receiving.name,
            method: f.method,
            pattern: f.pattern ?? '',
            type: f.fastener?.type ?? '',
            diameter: f.fastener?.diameter ?? '',
            length: f.fastener?.length ?? '',
            count: f.count,
            rule: f.rule ?? '',
            status: f.status,
        }));
        const columns = ['joint', 'part', 'on', 'method', 'pattern', 'type', 'diameter', 'length', 'count', 'rule', 'status'];
        return write(rows, columns).footer({ joint: footerLabel, count: 'sum' });
    }

    explain(): string
    {
        return explainOperations(this);
    }

    toJSON(): Record<string, unknown>
    {
        return {
            book: this.book.version,
            members: this._members.map(m => ({ name: m.name, kind: m.kind, direction: m.direction, section: m.section,
                length: round1(m.length * this._s.mm), recipe: m.recipe, ops: m.ops, warnings: m.warnings, evidence: m.evidence })),
            parts: this.parts(),
            fastenings: this._fastenings.map(f => ({ joint: f.joint, rule: f.rule, part: f.contact.entering.name,
                on: f.contact.receiving.name, kind: f.contact.kind, method: f.method, pattern: f.pattern, fastener: f.fastener,
                count: f.count, status: f.status, warnings: f.warnings, notes: f.notes, sources: f.sources, evidence: f.evidence })),
            fasteners: this.fasteners(),
            warnings: this.warnings(),
        };
    }
}

//// 11. ESTIMATE ////

/** Time for one kind of operation: every operation that took the same time row, counted together */
export interface TimeLine
{
    op: string
    /** The time row used: 'times#3', or null when none matched */
    rule: string | null
    what: string
    qty: number
    unit: string
    /** How many parts or joints this covers */
    items: number
    minutes: number | null
    labour: number | null
    source: string | null
    confidence: string | null
    status: 'ok' | 'unmatched'
}

/** Material to buy: bars of one length, sheets of one size, a fill, or one fastener */
export interface StockLine
{
    item: 'bar' | 'sheet' | 'fill' | 'fastener'
    what: string
    /** The stock or catalogue row used, or null when none matched */
    rule: string | null
    count: number
    unit: string
    /** Bars: mm used and wasted in all bars; sheets: m² */
    used: number | null
    waste: number | null
    /** Bars: pieces per bar in mm, and offcuts long enough to use again */
    cuts?: number[][]
    offcuts?: number[]
    cost: number | null
    source: string | null
    confidence: string | null
    status: 'ok' | 'unmatched'
    evidence: string
}

export interface EstimateOptions
{
    /** The area the work covers, in m², for the hours per m² check */
    area?: number
    checks?: { hoursPerM2?: [number, number] }
}

/** What a job really took, held against its estimate with est.compare(). Money in the book's currency. */
export interface Actuals
{
    hours?: number
    labour?: number
    material?: number
    total?: number
    /** Minutes per operation as booked in the workshop, like { sawCut: 70, fasten: 190 } */
    minutes?: Record<string, number>
    /** A difference up to this share counts as on target (default 0.1) */
    tolerance?: number
    /** What the actuals are from, like 'wall W1, week 41' */
    note?: string
}

export interface ComparisonRow
{
    /** 'hours', 'labour', 'material', 'total', or an operation's minutes: 'sawCut minutes' */
    what: string
    estimate: number | null
    actual: number
    /** actual − estimate */
    diff: number | null
    /** actual ÷ estimate */
    ratio: number | null
    verdict: 'on target' | 'estimate low' | 'estimate high' | 'not estimated'
    /** The norm book rows the estimate used */
    rules: string[]
}

/** A time row scaled so the estimate would have matched the booked minutes. `row` goes straight into
 *  fab.configure({ times: [row] }) for the next run, or into the norm book. */
export interface Calibration
{
    rule: string
    op: string
    factor: number
    minutes: [number, number]
    setup?: [number, number]
    row: Omit<TimeRow, 'rule'>
}

interface Timed
{
    op: string
    values: Record<string, unknown>
    qty: number
    setup: boolean
    what: string
}

const round2 = (x: number) => roundTo(x, 2);

function partValues(m: FabMember, s: Settings): Record<string, unknown>
{
    return {
        partKind: m.kind, section: m.section, material: m.material?.name ?? '',
        thickness: round1(m.thickness * s.mm), length: round1(m.length * s.mm),
    };
}

/** Everything that takes time, one entry per operation instance */
function timedOperations(ops: FabOperations, s: Settings): Timed[]
{
    const parts = ops.members().flatMap(m =>
    {
        const part = partValues(m, s);
        const handle: Timed[] = m.kind === 'stick' || m.kind === 'block'
            ? [{ op: 'handle', values: part, qty: 1, setup: false, what: `${m.kind} ${m.section}` }]
            : [];
        return [...handle, ...m.ops.map(op =>
        {
            const own = Object.fromEntries(Object.entries(op).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)));
            const values = { ...part, ...own };
            switch (op.op)
            {
                case 'sawCut': return { op: op.op, values, qty: 1, setup: false, what: op.kind };
                case 'drilling': return { op: op.op, values, qty: 1, setup: false, what: `⌀${op.diameter} ${op.through ? 'through' : 'blind'}` };
                case 'sheathe': return { op: op.op, values, qty: op.area, setup: false, what: `${op.thickness} ${op.shaped ? 'shaped' : 'plain'}` };
                case 'insulate': return { op: op.op, values: { ...values, thickness: op.thickness }, qty: op.area, setup: false, what: `${op.thickness} thick` };
                default: return { op: op.op, values, qty: 1, setup: false, what: op.op === 'notch' ? 'notch' : 'not recognised' };
            }
        })];
    });
    const fastenings = ops.fastenings().filter(f => f.count > 0 && f.fastener).map(f => ({
        op: 'fasten',
        values: {
            ...partValues(f.contact.entering, s),
            method: f.method, joint: f.joint, pattern: f.pattern,
            type: f.fastener.type, diameter: f.fastener.diameter, length: f.fastener.length,
        },
        qty: f.count,
        setup: true,
        what: `${f.method} ${f.fastener.type} ⌀${f.fastener.diameter}×${f.fastener.length}`,
    }));
    return [...parts, ...fastenings];
}

function timeLines(timed: Timed[], book: FabBook): TimeLine[]
{
    const lines = timed.reduce((acc, t) =>
    {
        const row = book.times.find(r => r.op === t.op
            && Object.entries(r.when).every(([key, cond]) => matches(cond, t.values[key])));
        const key = `${t.op}|${row?.rule ?? '-'}|${t.what}`;
        const minutes = row ? row.minutes * t.qty + (t.setup ? row.setup ?? 0 : 0) : null;
        const line = acc.get(key) ?? {
            op: t.op, rule: row?.rule ?? null, what: t.what, qty: 0, unit: TIME_UNITS[t.op], items: 0,
            minutes: row ? 0 : null, labour: null, source: row?.source ?? null, confidence: row?.confidence ?? null,
            status: row ? 'ok' : 'unmatched',
        } as TimeLine;
        line.qty = roundTo(line.qty + t.qty, 3);
        line.items += 1;
        if (minutes !== null) line.minutes = round2(line.minutes + minutes);
        acc.set(key, line);
        return acc;
    }, new Map<string, TimeLine>());
    return [...lines.values()].map(line => ({
        ...line,
        labour: line.minutes === null ? null : round2(line.minutes / 60 * book.rates.labour),
    }));
}

const stockFor = (book: FabBook, values: Record<string, unknown>, has: (r: StockRow) => boolean) =>
    book.stock.find(r => has(r) && Object.entries(r.when).every(([key, cond]) => matches(cond, values[key])));

/** First fit decreasing: fill the longest bars, then shorten each bar to the shortest length that holds its pieces */
function allocateBars(pieces: number[], row: StockRow): { bars: Array<{ stock: number, pieces: number[], used: number }>, tooLong: number[] }
{
    const kerf = row.kerf ?? 0;
    const lengths = [...row.lengths].sort((a, b) => a - b);
    const longest = lengths[lengths.length - 1];
    const sorted = [...pieces].sort((a, b) => b - a);
    const tooLong = sorted.filter(piece => piece > longest + 1e-6);
    const bars = sorted
        .filter(piece => piece <= longest + 1e-6)
        .reduce((acc, piece) =>
        {
            const bar = acc.find(b => b.used + kerf + piece <= b.stock + 1e-6);
            if (bar)
            {
                bar.pieces.push(piece);
                bar.used += kerf + piece;
            }
            else
            {
                acc.push({ stock: longest, pieces: [piece], used: piece });
            }
            return acc;
        }, [] as Array<{ stock: number, pieces: number[], used: number }>);
    bars.forEach(bar => bar.stock = lengths.find(l => l >= bar.used - 1e-6) ?? longest);
    return { bars, tooLong };
}

function barLines(ops: FabOperations, book: FabBook, s: Settings): StockLine[]
{
    const groups = ops.members()
        .filter(m => m.kind === 'stick' || m.kind === 'block')
        .reduce((acc, m) =>
        {
            const values = partValues(m, s);
            const key = `${m.section}|${values.material}`;
            const group = acc.get(key) ?? { values, pieces: [] as number[] };
            group.pieces.push(values.length as number);
            acc.set(key, group);
            return acc;
        }, new Map<string, { values: Record<string, unknown>, pieces: number[] }>());
    return [...groups.values()].flatMap(({ values, pieces }) =>
    {
        const label = `${values.section}${values.material ? ` ${values.material}` : ''}`;
        const row = stockFor(book, values, r => !!r.lengths);
        if (!row)
        {
            return [{
                item: 'bar', what: label, rule: null, count: pieces.length, unit: 'piece', used: null, waste: null,
                cost: null, source: null, confidence: null, status: 'unmatched',
                evidence: `no stock row for ${label}: ${pieces.length} ${pieces.length === 1 ? 'piece' : 'pieces'}, ${round1(sum(pieces))} mm, not priced`,
            } as StockLine];
        }
        const { bars, tooLong } = allocateBars(pieces, row);
        const byLength = bars.reduce((acc, bar) =>
        {
            acc.set(bar.stock, [...(acc.get(bar.stock) ?? []), bar]);
            return acc;
        }, new Map<number, typeof bars>());
        const lines = [...byLength.entries()].sort((a, b) => b[0] - a[0]).map(([length, group]) =>
        {
            const used = round1(sum(group.map(b => b.used)));
            const rest = group.map(b => round1(b.stock - b.used));
            const offcuts = rest.filter(r => r >= (row.minOffcut ?? Infinity));
            return {
                item: 'bar', what: `${label} × ${length}`, rule: row.rule, count: group.length, unit: 'bar',
                used, waste: round1(sum(rest)), cuts: group.map(b => b.pieces), offcuts,
                cost: round2(group.length * length / 1000 * row.pricePerM),
                source: row.source ?? null, confidence: row.confidence ?? null, status: 'ok',
                evidence: `${group.length} × ${length} mm (${row.rule}), kerf ${row.kerf ?? 0}: `
                    + group.map(b => `[${b.pieces.join(', ')}]`).join(' ')
                    + (offcuts.length ? `; reusable offcuts ${offcuts.join(', ')}` : ''),
            } as StockLine;
        });
        const missing: StockLine[] = tooLong.length ? [{
            item: 'bar', what: `${label} longer than ${Math.max(...row.lengths)}`, rule: null, count: tooLong.length, unit: 'piece',
            used: null, waste: null, cost: null, source: null, confidence: null, status: 'unmatched',
            evidence: `${tooLong.join(', ')} mm: longer than any stock length in ${row.rule}; add a length or join the part`,
        }] : [];
        return [...lines, ...missing];
    });
}

function sheetLines(ops: FabOperations, book: FabBook, s: Settings): StockLine[]
{
    const groups = ops.members()
        .filter(m => m.kind === 'sheet')
        .reduce((acc, m) =>
        {
            const values = partValues(m, s);
            const key = `${values.thickness}|${values.material}`;
            acc.set(key, [...(acc.get(key) ?? []), m]);
            return acc;
        }, new Map<string, FabMember[]>());
    return [...groups.values()].map(members =>
    {
        const values = partValues(members[0], s);
        const label = `sheet ${values.thickness}${values.material ? ` ${values.material}` : ''}`;
        const sheets = members.map(m => m.ops.find(op => op.op === 'sheathe') as Sheathe);
        const area = roundTo(sum(sheets.map(op => op.area)), 3);
        const row = stockFor(book, values, r => !!r.size);
        if (!row)
        {
            return {
                item: 'sheet', what: label, rule: null, count: members.length, unit: 'piece', used: area, waste: null, cost: null,
                source: null, confidence: null, status: 'unmatched', evidence: `no stock row for ${label}: ${area} m², not priced`,
            } as StockLine;
        }
        const [w, l] = row.size;
        const sheetArea = w * l / 1e6;
        const whole = sheets.filter(op => !op.shaped
            && ((Math.abs(op.width - w) <= 1 && Math.abs(op.length - l) <= 1) || (Math.abs(op.width - l) <= 1 && Math.abs(op.length - w) <= 1)));
        const cutArea = sum(sheets.filter(op => !whole.includes(op)).map(op => op.area));
        const forCuts = cutArea > 0 ? Math.ceil(cutArea * (1 + (row.wastePct ?? 0) / 100) / sheetArea - 1e-9) : 0;
        const count = whole.length + forCuts;
        return {
            item: 'sheet', what: `${label} ${w}×${l}`, rule: row.rule, count, unit: 'sheet',
            used: area, waste: roundTo(count * sheetArea - area, 3),
            cost: round2(count * sheetArea * row.pricePerM2),
            source: row.source ?? null, confidence: row.confidence ?? null, status: 'ok',
            evidence: `${whole.length} whole sheets, ${roundTo(cutArea, 3)} m² cut from ${forCuts} sheets `
                + `(area plus ${row.wastePct ?? 0}%, ${row.rule})`,
        } as StockLine;
    });
}

function fillLines(ops: FabOperations, book: FabBook, s: Settings): StockLine[]
{
    const groups = ops.members()
        .filter(m => m.kind === 'fill')
        .reduce((acc, m) =>
        {
            const key = m.material?.name ?? '';
            acc.set(key, [...(acc.get(key) ?? []), m]);
            return acc;
        }, new Map<string, FabMember[]>());
    return [...groups.entries()].map(([material, members]) =>
    {
        const values = partValues(members[0], s);
        const volume = roundTo(sum(members.map(m => (m.ops.find(op => op.op === 'insulate') as Insulate).volume)), 4);
        const label = `fill${material ? ` ${material}` : ''}`;
        const row = stockFor(book, values, r => r.pricePerM3 !== undefined);
        const bought = row ? roundTo(volume * (1 + (row.wastePct ?? 0) / 100), 4) : volume;
        return {
            item: 'fill', what: label, rule: row?.rule ?? null, count: bought, unit: 'm3', used: volume,
            waste: row ? roundTo(bought - volume, 4) : null,
            cost: row ? round2(bought * row.pricePerM3) : null,
            source: row?.source ?? null, confidence: row?.confidence ?? null, status: row ? 'ok' : 'unmatched',
            evidence: row ? `${volume} m³ in ${members.length} pieces, plus ${row.wastePct ?? 0}% (${row.rule})`
                : `no stock row for ${label}: ${volume} m³, not priced`,
        } as StockLine;
    });
}

function fastenerLines(ops: FabOperations, book: FabBook): StockLine[]
{
    return ops.fasteners().map(f =>
    {
        const entry = book.fasteners.find(c => sameFastener(c, f));
        const priced = entry?.price !== undefined;
        return {
            item: 'fastener', what: `${f.type} ⌀${f.diameter}×${f.length}`, rule: entry?.rule ?? null, count: f.count, unit: 'piece',
            used: null, waste: null, cost: priced ? round2(f.count * entry.price) : null,
            source: entry?.source ?? null, confidence: entry?.confidence ?? null, status: priced ? 'ok' : 'unmatched',
            evidence: priced ? `${f.count} × ${entry.price} (${entry.rule})` : `${f.type} ⌀${f.diameter}×${f.length} has no price in the catalogue`,
        } as StockLine;
    });
}

/** How long the work takes, what to buy, and what it costs: every number with the row it came from */
export class FabEstimate
{
    readonly lines: TimeLine[];
    readonly stock: StockLine[];
    readonly currency: string;
    readonly rate: number;
    readonly minutes: number;
    readonly hours: number;
    readonly labour: number;
    readonly material: number;
    readonly total: number;
    /** False when an operation has no time or a part has no stock or price: the totals are too low */
    readonly complete: boolean;
    private readonly _warnings: string[];

    constructor(private readonly _modeler: Modeler, readonly book: FabBook, readonly operations: FabOperations, s: Settings, options: EstimateOptions)
    {
        this.lines = timeLines(timedOperations(operations, s), book);
        this.stock = [...barLines(operations, book, s), ...sheetLines(operations, book, s), ...fillLines(operations, book, s), ...fastenerLines(operations, book)];
        this.currency = book.rates.currency;
        this.rate = book.rates.labour;
        this.minutes = round2(sum(this.lines.map(l => l.minutes ?? 0)));
        this.hours = round2(this.minutes / 60);
        this.labour = round2(this.minutes / 60 * this.rate);
        this.material = round2(sum(this.stock.map(l => l.cost ?? 0)));
        this.total = round2(this.labour + this.material);
        const unmatched = [...this.lines, ...this.stock].filter(l => l.status === 'unmatched');
        this.complete = unmatched.length === 0;
        const placeholders = [...this.lines, ...this.stock].filter(l => l.confidence === 'placeholder').length
            + (book.rates.confidence === 'placeholder' ? 1 : 0);
        const perM2 = options.area ? this.hours / options.area : null;
        const [low, high] = options.checks?.hoursPerM2 ?? [0, Infinity];
        this._warnings = [
            ...this.lines.filter(l => l.status === 'unmatched').map(l => `no time for ${l.items} × ${l.op} (${l.what}): add a row to times`),
            ...this.stock.filter(l => l.status === 'unmatched').map(l => l.evidence),
            ...(perM2 !== null && (perM2 < low || perM2 > high)
                ? [`${round2(perM2)} h/m² is outside the expected ${low}–${high} h/m²`] : []),
            ...(placeholders ? [`${placeholders} time, price or rate values are placeholders: calibrate the norm book before quoting`] : []),
        ];
    }

    warnings(): string[]
    {
        return [...this._warnings];
    }

    /** A calc table: the time lines, or with { by: 'stock' } the material lines */
    table(name: string = 'estimate', options?: { by?: 'time' | 'stock' }): any
    {
        const opts = optionsOf(options, ['by'], 'est.table() options');
        const calc: any = this._modeler.modules?.calc;
        if (!calc) throw new Error('est.table(): needs the calc module. Scripts have it; call modeler.setArchiyou() with calc otherwise.');
        const write = (rows: Array<Record<string, unknown>>, columns: string[]) =>
            calc.table(name, rows.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? '']))), columns);
        const label = `norm book ${this.book.version}${this.complete ? '' : ', incomplete'}`;
        const by = opts.by ?? 'time';
        if (by === 'stock')
        {
            return write(this.stock.map(l => ({ ...l, rule: l.rule ?? '?' })),
                ['item', 'what', 'count', 'unit', 'used', 'waste', 'cost', 'rule', 'confidence', 'status'])
                .footer({ item: label, cost: 'sum' });
        }
        if (by !== 'time') throw new Error(`est.table(): by '${by}' is not known. Use time or stock`);
        return write(this.lines.map(l => ({ ...l, rule: l.rule ?? '?' })),
            ['op', 'what', 'items', 'qty', 'unit', 'minutes', 'labour', 'rule', 'confidence', 'status'])
            .footer({ op: label, minutes: 'sum', labour: 'sum' });
    }

    /** Dashboard metrics: production_time (h), cost_labor and cost_material */
    metrics(): this
    {
        const calc: any = this._modeler.modules?.calc;
        if (!calc) throw new Error('est.metrics(): needs the calc module. Scripts have it; call modeler.setArchiyou() with calc otherwise.');
        const note = ` (norm book ${this.book.version}${this.complete ? '' : ', incomplete'})`;
        calc.metric('production_time', this.hours, { label: `Production time${note}`, unit: 'h', icon: 'clock-outline' });
        calc.metric('cost_labor', this.labour, { label: `Labour${note}`, unit: this.currency, icon: 'account-hard-hat' });
        calc.metric('cost_material', this.material, { label: `Material${note}`, unit: this.currency, icon: 'package-variant' });
        return this;
    }

    explain(): string
    {
        const money = (x: number | null) => x === null ? '?' : `${x.toFixed(2)} ${this.currency}`;
        const lines = [
            `${FAB_HEADER}: estimate (norm book ${this.book.version}${this.complete ? '' : ', INCOMPLETE'})`,
            `${this.hours} h (${this.minutes} min at ${this.rate} ${this.currency}/h) = ${money(this.labour)} labour, `
                + `${money(this.material)} material, ${money(this.total)} total`,
            '',
            'time',
            ...this.lines.map(l => `    ${l.status === 'ok' ? '·' : '!'} ${l.op} ${l.what}: ${l.qty} ${l.unit} (${l.items} ${l.items === 1 ? 'item' : 'items'}) → `
                + `${l.minutes ?? '?'} min, ${money(l.labour)} (${l.rule ?? 'no time row'}${l.confidence ? `, ${l.confidence}` : ''})`),
            '',
            'material',
            ...this.stock.map(l => `    ${l.status === 'ok' ? '·' : '!'} ${l.what}: ${l.count} ${l.unit} → ${money(l.cost)}; ${l.evidence}`),
        ];
        const warnings = this.warnings();
        if (warnings.length)
        {
            lines.push('', `needs a look (${warnings.length})`, ...warnings.map(w => `    ${w}`));
        }
        return lines.join('\n');
    }

    /** Hold what the job really took against this estimate: which numbers were off, and the time rows
     *  that would have matched. `est.compare({ hours: 16, minutes: { sawCut: 70 }, note: 'wall W1' })` */
    compare(actuals: Actuals): FabComparison
    {
        return new FabComparison(this._modeler, this, actuals);
    }

    toJSON(): Record<string, unknown>
    {
        return {
            book: this.book.version, currency: this.currency, rate: this.rate, minutes: this.minutes, hours: this.hours,
            labour: this.labour, material: this.material, total: this.total, complete: this.complete,
            lines: this.lines, stock: this.stock, warnings: this.warnings(),
        };
    }
}

const ACTUAL_KEYS = ['hours', 'labour', 'material', 'total', 'minutes', 'tolerance', 'note'];

/** An estimate against the actuals: the loop that calibrates the norm book */
export class FabComparison
{
    readonly rows: ComparisonRow[];
    readonly calibrations: Calibration[];
    readonly note: string | null;
    readonly tolerance: number;
    private readonly _warnings: string[];

    constructor(private readonly _modeler: Modeler, readonly estimate: FabEstimate, actuals: Actuals)
    {
        const a = optionsOf(actuals, ACTUAL_KEYS, 'est.compare() actuals');
        const amount = (value: unknown, key: string) =>
        {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            {
                throw new Error(`est.compare(): ${key} must be a number of 0 or more, got ${JSON.stringify(value)}`);
            }
            return value;
        };
        ['hours', 'labour', 'material', 'total'].forEach(key => a[key] !== undefined && amount(a[key], key));
        if (a.minutes !== undefined)
        {
            assertObject(a.minutes, 'est.compare() minutes', '{ sawCut: 70, fasten: 190 }');
            Object.entries(a.minutes).forEach(([op, value]) =>
            {
                if (!(op in TIME_UNITS)) throw new Error(`est.compare(): no operation '${op}' in minutes. Known: ${Object.keys(TIME_UNITS).join(', ')}`);
                amount(value, `minutes.${op}`);
            });
        }
        if (!['hours', 'labour', 'material', 'total'].some(key => a[key] !== undefined) && !Object.keys(a.minutes ?? {}).length)
        {
            throw new Error('est.compare(): give at least one actual, like { hours: 16 } or { minutes: { sawCut: 70 } }');
        }
        this.tolerance = a.tolerance === undefined ? 0.1 : amount(a.tolerance, 'tolerance');
        this.note = a.note === undefined ? null : String(a.note);

        const est = estimate;
        const rulesOf = (lines: Array<{ rule: string | null }>) => [...new Set(lines.map(l => l.rule ?? '?'))];
        // shown rounded, compared unrounded: 6.5 min is 0.11 h on paper but 0.1083 h here
        const row = (what: string, value: number | null, actual: number, rules: string[], exact: number | null = value): ComparisonRow =>
        {
            const ratio = exact ? roundTo(actual / exact, 3) : null;
            const verdict = ratio === null ? 'not estimated'
                : Math.abs(ratio - 1) <= this.tolerance ? 'on target'
                : ratio > 1 ? 'estimate low' : 'estimate high';
            return { what, estimate: value, actual, diff: exact === null ? null : round2(actual - exact), ratio, verdict, rules };
        };
        const byOp = (op: string) => est.lines.filter(l => l.op === op);
        const estimated = (lines: TimeLine[]) => lines.some(l => l.minutes !== null) ? round2(sum(lines.map(l => l.minutes ?? 0))) : null;
        this.rows = [
            ...(a.hours !== undefined ? [row('hours', est.hours, a.hours, rulesOf(est.lines), est.minutes / 60)] : []),
            ...(a.labour !== undefined ? [row('labour', est.labour, a.labour, rulesOf(est.lines), est.minutes / 60 * est.rate)] : []),
            ...(a.material !== undefined ? [row('material', est.material, a.material, rulesOf(est.stock))] : []),
            ...(a.total !== undefined ? [row('total', est.total, a.total, rulesOf([...est.lines, ...est.stock]))] : []),
            ...Object.entries(a.minutes ?? {}).map(([op, value]) => row(`${op} minutes`, estimated(byOp(op)), value, rulesOf(byOp(op)))),
        ];

        this.calibrations = Object.keys(a.minutes ?? {}).flatMap(op =>
        {
            const r = this.rows.find(x => x.what === `${op} minutes`);
            if (!r || r.ratio === null || r.verdict === 'on target') return [];
            return rulesOf(byOp(op).filter(l => l.minutes !== null)).flatMap(rule =>
            {
                const time = est.book.times.find(t => t.rule === rule);
                if (!time) return [];
                const scaled = (x: number) => roundTo(x * r.ratio, 3);
                const { rule: _, ...rest } = time;
                return [{
                    rule, op, factor: r.ratio,
                    minutes: [time.minutes, scaled(time.minutes)],
                    ...(time.setup !== undefined ? { setup: [time.setup, scaled(time.setup)] as [number, number] } : {}),
                    row: {
                        ...rest,
                        minutes: scaled(time.minutes),
                        ...(time.setup !== undefined ? { setup: scaled(time.setup) } : {}),
                        note: `${op} took ${r.ratio}× the estimate${this.note ? ` (${this.note})` : ''}; ${rule} scaled`,
                        source: 'actuals',
                        confidence: 'measured',
                    },
                } as Calibration];
            });
        });

        const off = (what: string) => this.rows.find(x => x.what === what && (x.verdict === 'estimate low' || x.verdict === 'estimate high'));
        const pct = (r: ComparisonRow) => `${Math.round(Math.abs(r.ratio - 1) * 100)}% ${r.ratio > 1 ? 'low' : 'high'}`;
        const hours = off('hours');
        const material = off('material');
        const booked = this.rows.filter(x => x.what.endsWith(' minutes'));
        this._warnings = [
            ...(est.complete ? [] : ['the estimate is incomplete: part of any difference is the lines it could not price (see est.warnings())']),
            ...this.rows.filter(x => x.verdict === 'not estimated').map(x => `${x.what}: the estimate has nothing for this`),
            ...(hours && !booked.length ? [`hours are ${pct(hours)}: book minutes per operation (minutes: { sawCut: … }) to see which time rows to change`] : []),
            ...(material ? [`material is ${pct(material)}: check the prices of ${material.rules.join(', ')}`] : []),
            ...(a.hours && a.labour && Math.abs(a.labour / a.hours - est.rate) > this.tolerance * est.rate
                ? [`labour was ${round2(a.labour / a.hours)} ${est.currency}/h, the book says ${est.rate}: check rates.labour`] : []),
            ...(a.total !== undefined && a.labour !== undefined && a.material !== undefined && Math.abs(a.labour + a.material - a.total) > 0.01
                ? [`the actual total ${a.total} is not labour + material (${round2(a.labour + a.material)})`] : []),
            ...(booked.length && a.hours !== undefined && sum(booked.map(x => x.actual)) > a.hours * 60 + 0.01
                ? ['the booked minutes add up to more than the actual hours'] : []),
        ];
    }

    warnings(): string[]
    {
        return [...this._warnings];
    }

    /** A calc table of the rows, with the book version and the note in the footer */
    table(name: string = 'estimate vs actual'): any
    {
        const calc: any = this._modeler.modules?.calc;
        if (!calc) throw new Error('cmp.table(): needs the calc module. Scripts have it; call modeler.setArchiyou() with calc otherwise.');
        const columns = ['what', 'estimate', 'actual', 'diff', 'ratio', 'verdict', 'rules'];
        const rows = this.rows.map(r => ({ ...r, rules: r.rules.join(', ') }))
            .map(r => Object.fromEntries(columns.map(column => [column, r[column] ?? ''])));
        return calc.table(name, rows, columns)
            .footer({ what: `norm book ${this.estimate.book.version}${this.note ? `, ${this.note}` : ''}` });
    }

    explain(): string
    {
        const lines = [
            `${FAB_HEADER}: estimate against actuals (norm book ${this.estimate.book.version}${this.note ? `, ${this.note}` : ''})`,
            ...this.rows.map(r => `    ${r.verdict === 'on target' ? '·' : '!'} ${r.what}: estimated ${r.estimate ?? '?'}, actual ${r.actual}`
                + `${r.ratio === null ? '' : ` (${r.ratio}×)`} → ${r.verdict}`),
        ];
        if (this.calibrations.length)
        {
            lines.push('', 'time rows that would have matched (fab.configure({ times: [cal.row] }))',
                ...this.calibrations.map(c => `    ${c.rule} ${c.op}: ${c.minutes[0]} → ${c.minutes[1]} min`
                    + `${c.setup ? `, setup ${c.setup[0]} → ${c.setup[1]}` : ''}`));
        }
        const warnings = this.warnings();
        if (warnings.length) lines.push('', `needs a look (${warnings.length})`, ...warnings.map(w => `    ${w}`));
        return lines.join('\n');
    }

    toJSON(): Record<string, unknown>
    {
        return { book: this.estimate.book.version, note: this.note, tolerance: this.tolerance,
            rows: this.rows, calibrations: this.calibrations, warnings: this.warnings() };
    }
}

export function estimate(modeler: Modeler, ops: FabOperations, options?: EstimateOptions): FabEstimate
{
    requireMesh(modeler, 'estimate');
    if (!(ops instanceof FabOperations))
    {
        throw new Error('fab.estimate(ops): give it the result of fab.operations(), like est = fab.estimate(fab.operations(wall))');
    }
    const opts = optionsOf(options, ['area', 'checks'], 'fab.estimate() options');
    if (opts.checks !== undefined) assertKeys(opts.checks, ['hoursPerM2'], 'fab.estimate() checks');
    // joints as the operations saw them; times, stock and prices as the book is now
    const book: FabBook = { ...effectiveBook(modeler), joints: ops.book.joints };
    const est = new FabEstimate(modeler, book, ops, ops.settings, opts);
    if (!est.complete) console.warn(`fab.estimate(): incomplete, see est.warnings()`);
    return est;
}

//// 12. EXPLAIN ////

function explainOperations(ops: FabOperations): string
{
    const members = ops.members();
    const fastenings = ops.fastenings();
    const fastened = fastenings.filter(f => f.count > 0);
    const total = sum(fastened.map(f => f.count));
    const changes = ops.book.changes ? `, ${ops.book.changes} change(s) this run` : '';
    const lines = [
        `${FAB_HEADER} (norm book ${ops.book.version}${changes})`,
        `${members.length} parts, ${fastenings.length} contacts, ${fastened.length} fastened with ${total} fasteners`,
        '',
    ];
    members.forEach(m =>
    {
        lines.push(`${m.name}: ${m.evidence}`);
        m.ops.forEach(op => lines.push(`    ${op.op === 'unknown' ? '!' : '·'} ${op.op} (${op.origin}): ${op.evidence}`));
        m.warnings.forEach(warning => lines.push(`        warning: ${warning}`));
        const own = fastenings.filter(f => f.contact.entering === m);
        own.filter(f => f.status !== 'none').forEach(f =>
        {
            lines.push(`    ${f.status === 'ok' ? '·' : '!'} ${f.evidence}`);
            f.notes.forEach(note => lines.push(`        note: ${note}`));
            f.warnings.forEach(warning => lines.push(`        warning: ${warning}`));
        });
        const loose = own.filter(f => f.status === 'none').reduce((acc, f) =>
        {
            const key = `${f.joint} (${f.rule})${f.notes.length ? `: ${f.notes.join('; ')}` : ''}`;
            acc.set(key, [...(acc.get(key) ?? []), f.contact.receiving.name]);
            return acc;
        }, new Map<string, string[]>());
        loose.forEach((names, key) => lines.push(`    · not fastened to ${names.join(', ')}: ${key}`));
    });
    const totals = ops.fasteners();
    if (totals.length)
    {
        lines.push('', 'fasteners');
        totals.forEach(f => lines.push(`    ${f.count}× ${f.type} ⌀${f.diameter} × ${f.length}`));
    }
    const warnings = ops.warnings();
    if (warnings.length)
    {
        lines.push('', `needs a look (${warnings.length})`);
        warnings.forEach(w => lines.push(`    ${w}`));
    }
    return lines.join('\n');
}
