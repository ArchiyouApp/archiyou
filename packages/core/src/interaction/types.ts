export type HandleType = 'handle';
export type HandleRangeType = '1d' | '2d';

export interface HandlePlane
{
    origin: [number, number, number];
    uAxis:  [number, number, number];
    vAxis:  [number, number, number];
}

export interface HandleData
{
    id: string;
    type: HandleType;
    position: [number, number, number];
    icon: string;
    visible: boolean;
    rangeType: HandleRangeType;
    rangeMin: number | [number, number];
    rangeMax: number | [number, number];
    /** true  → rangeMin/Max are offsets from the handle's start position along uAxis/vAxis.
     *  false → rangeMin/Max are absolute world-projections onto uAxis/vAxis. */
    rangeRelative: boolean;
    plane: HandlePlane;
    param: string | null;
    /** Serialized map function `(handle, param) => newParamValue`.
     *  When param is non-null and this is null → autoMap (linear remap of handle
     *  range to param schema min/max). Only works for 1D, non-relative, number params. */
    paramFnSrc: string | null;
    /** Serialized multi-param mutation function `(handle, params) => void`.
     *  `params` is a plain object pre-populated with all current param values
     *  (e.g. { X: 10, Y: 20 }). The function mutates it in-place; the viewer
     *  detects which keys changed and applies each changed param independently.
     *  Use for 2D handles or any case that updates more than one param at once. */
    paramsFnSrc: string | null;
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
