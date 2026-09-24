export type HandleType = 'handle';
export type HandleRangeType = '1d' | '2d';

export interface HandlePlane
{
    origin: [number, number, number];
    uAxis:  [number, number, number];
    vAxis:  [number, number, number];
}

/** What a mapping function gets as its second argument when a drag ends:
 *  `.param('OPENINGS[0]', (param, handle) => { param.left += handle.du })`.
 *  The values are the same whatever range() gets: numbers or relative strings only change
 *  how the bounds are written. */
export interface HandleDrag
{
    /** Where the handle is along its first drag axis (uAxis), measured from the origin:
     *  with along('xz'), u is the x */
    u: number;
    /** Where the handle is along its second drag axis (vAxis): with along('xz'), v is the z */
    v: number;
    /** How far this drag moved it along the first axis */
    du: number;
    /** How far this drag moved it along the second axis; 0 on a 1D handle */
    dv: number;
    /** How far through the range it is along the first axis, 0 at the minimum to 1 at the maximum */
    tu: number;
    /** The same along the second axis; 0 on a 1D handle */
    tv: number;
    /** The bounds given to range(), as written (relative bounds as offsets) */
    range: [number | [number, number], number | [number, number]];
    /** Where the handle is in the model: [x, y, z] */
    position(): [number, number, number];
}

/** Compact display of a handle: a small plain circle instead of the icon button.
 *  Set via Handle.minimized(); null on HandleData means the full icon handle. */
export interface HandleMinimized
{
    /** CSS color of the dot. */
    color: string;
    /** 0..1 */
    opacity: number;
}

export interface HandleData
{
    id: string;
    type: HandleType;
    position: [number, number, number];
    icon: string;
    /** Non-null → render as a small dot instead of the icon button. */
    minimized: HandleMinimized | null;
    visible: boolean;
    rangeType: HandleRangeType;
    rangeMin: number | [number, number];
    rangeMax: number | [number, number];
    /** true  → rangeMin/Max are offsets from the handle's start position along uAxis/vAxis.
     *  false → rangeMin/Max are absolute world-projections onto uAxis/vAxis. */
    rangeRelative: boolean;
    plane: HandlePlane;
    /** Param reference this handle writes to. Either a plain name (`'WIDTH'`) or one
     *  element of a list param (`'OPENINGS[2]'`) — see Handle.param(). */
    param: string | null;
    /** Serialized map function `(param, handle: HandleDrag) => newValue | void`: it returns a
     *  new value, or for an object or list param changes the copy it gets (see Handle.param()).
     *  When param is non-null and this is null → autoMap (linear remap of handle
     *  range to param schema min/max). Only works for 1D, non-relative, number params. */
    paramFnSrc: string | null;
    /** Serialized multi-param mutation function `(params, handle: HandleDrag) => void`.
     *  `params` is a plain object pre-populated with all current param values
     *  (e.g. { X: 10, Y: 20 }). The function mutates it in-place; the viewer
     *  detects which keys changed and applies each changed param independently.
     *  Use for 2D handles or any case that updates more than one param at once. */
    paramsFnSrc: string | null;
    /** Values from the script that paramFnSrc / paramsFnSrc use (the last argument of param()
     *  or params()): the viewer rebuilds the function with these as variables. Plain data. */
    fnVars: Record<string, any> | null;
}

// ── Managed-handle op protocol ────────────────────────────────────────────────

export type ManagedHandleOperation = 'add' | 'update' | 'delete';

/**
 * A single op emitted by Interactor.getManagedHandlesData() each run.
 *
 *  _operation='add'    – first definition (data carries full HandleData snapshot).
 *  _operation='update' – mutation this run (position and/or visible may be set).
 *  _operation='delete' – handle not touched this run; viewer should remove it.
 */
export interface ManagedHandleOp
{
    id: string;
    _operation: ManagedHandleOperation;
    data?: HandleData;                   // 'add' only
    position?: [number, number, number]; // 'update' only — at() / position() ran this run
    visible?: boolean;                   // 'update' only — hide() / show() ran this run
}

/** The full payload shipped to the viewer each run. Empty array = quiet re-exec,
 *  viewer leaves all handles (and their dragged positions) untouched. */
export type ManagedHandlesData = ManagedHandleOp[];
