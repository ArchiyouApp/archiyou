/**
 * Interactor — manages script-authored interaction Handles and keeps them in
 * sync with the viewer across re-executions.
 *
 * THE PROBLEM IT SOLVES
 *   A script re-runs on every param change. The naive approach rebuilds all
 *   handles each run and ships them to the viewer, which makes a dragged handle
 *   jump back to its script-computed spot after the drag triggers a re-run.
 *
 * THE MODEL: DEFINE-ONCE + TOUCH-TRACKING
 *   The Interactor instance is PERSISTENT (lives on the Runner across runs). It
 *   holds a HandleRegistry: the last definition it told the viewer about, per
 *   handle id. The live position/value of a handle lives in the VIEWER, not here.
 *
 *   Each run the script "touches" some handle ids by declaring them
 *   ($handle().name('X') / .param('X')). At end-of-run getManagedHandlesData()
 *   diffs the touched handles against the registry and emits only what changed,
 *   as a list of ops { id, _operation }:
 *
 *     • touched + not in registry      -> 'add'    (full definition; stored)
 *     • touched + known + mutated      -> 'update' (only position and/or visible)
 *     • known + NOT touched this run   -> 'delete' (script stopped defining it)
 *     • touched + known + not mutated  -> nothing  (viewer keeps the dragged value)
 *
 *   "Mutated" means the script called a mutator this run:
 *     at()       — every-run position push (script owns the position)
 *     position() — imperative one-shot position push
 *     hide()/show() — visibility
 *   Define-once methods (start(), range(), param(), along(), icon(), name())
 *   only take effect on the first 'add'; they are ignored on later runs.
 *
 *   beginRun(scriptKey) clears the per-run handle list and records the script
 *   identity. If the script changed, all previously-known ids count as
 *   "not touched" -> they 'delete', and the new script's handles 'add' fresh,
 *   so handles never leak between scripts. (Param re-execs keep the same key,
 *   so handles persist.)
 *
 * NET EFFECT
 *   A quiet param re-exec emits []  ->  the viewer leaves the dragged handle
 *   exactly where the user put it. That is the whole point.
 */

import type { ArchiyouModules } from '../types';
import { Handle } from './Handle';
import { HandleRegistry } from './HandleRegistry';
import type { HandleData, HandleParamMap, ManagedHandleOp, ManagedHandlesData } from './types';

// Shallow equality for number tuples (position, uAxis, vAxis, …)
const _eqArr = (a: readonly number[], b: readonly number[]): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);

// Equality for scalar-or-tuple range bounds
const _eq = (a: number | readonly number[], b: number | readonly number[]): boolean =>
    Array.isArray(a) && Array.isArray(b) ? _eqArr(a as number[], b as number[]) : a === b;

// Param maps are small flat records of primitives — JSON is an honest comparison here.
const _eqMap = (a: HandleParamMap | null, b: HandleParamMap | null): boolean =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** World-position axes. Under a RELATIVE range the viewer adds the axis value to the
 *  property as a delta, and a world position is not a delta — so only 'u'/'v' are valid. */
const _WORLD_AXES = ['x', 'y', 'z'];

export class Interactor
{
    /** Per-run list of Handles declared by the script. Cleared each run. */
    handles: Handle[] = [];

    private _registry = new HandleRegistry();
    private _scriptChanged = false;
    /** Param names known for this run (from the script definition). Used to validate
     *  paramsFnSrc functions and entry bindings against actual param names. */
    private _knownParamNames: string[] = [];
    /** The run's live ParamManager, so params declared with $PARAMS.define() count too. */
    private _paramManager: { getParams?: () => Array<{ name: string }> } | null = null;

    /** Param names a handle may legally reference right now.
     *
     *  The frozen list from beginRun() comes from `request.script.params`, i.e. what the app
     *  has already persisted. On the FIRST run of a script that declares its params in code,
     *  that is empty — which would leave the programmatic scripts, the ones most likely to
     *  get a name wrong, with no check at all. So merge in what the ParamManager has been
     *  told this run; $PARAMS.define() has always already run by the time a handle names it. */
    get knownParamNames(): string[]
    {
        const defined = this._paramManager?.getParams?.().map(p => p.name) ?? [];
        return [...new Set([...this._knownParamNames, ...defined])];
    }

    // ── Selection ────────────────────────────────────────────────────────────────
    // The Interactor also owns click-selection state (it is already the persistent,
    // per-run interaction-state owner). Identity is the scene path (SmartSceneNode.path()),
    // not the shape UUID, because UUIDs are regenerated every run.
    /** Scene paths the viewer reports as selected, set at beginRun for this run. */
    private _selected = new Set<string>();
    /** Scene paths of shapes that called onClick() this run — emitted to the viewer
     *  as `interactiveShapes` so it knows which meshes are clickable-for-re-run.
     *  Cleared each run. */
    private _interactive: string[] = [];

    /** Is the shape at this scene path currently selected? */
    isSelected(path: string | null | undefined): boolean
    {
        return path != null && this._selected.has(path);
    }

    /** Record a scene path as interactive (a shape declared onClick this run). */
    markInteractive(path: string | null | undefined): void
    {
        if (path != null && !this._interactive.includes(path)) this._interactive.push(path);
    }

    /** Scene paths declared interactive this run (for ArchiyouStateData.interactiveShapes). */
    interactivePaths(): string[]
    {
        return [...this._interactive];
    }

    protected _archiyou!: ArchiyouModules;

    constructor() {}

    setArchiyou(modules: ArchiyouModules): this
    {
        this._archiyou = modules;
        return this;
    }

    get classes()
    {
        return this._archiyou?.modeler?.classes;
    }

    /** Called at the start of each run (from Runner._executionStartRunInScope).
     *  Clears the per-run handle list, records the script identity, and stores
     *  the known param names for paramsFnSrc validation. */
    beginRun(
        scriptKey: string,
        knownParamNames: string[] = [],
        selectedPaths: string[] = [],
        paramManager: { getParams?: () => Array<{ name: string }> } | null = null,
    ): void
    {
        this.handles = [];
        this._scriptChanged = this._registry.setScript(scriptKey);
        this._knownParamNames = knownParamNames;
        this._paramManager = paramManager;
        this._selected = new Set(selectedPaths);
        this._interactive = [];
    }

    /** Create a new Handle, register it, and return it for chaining. */
    addHandle(): Handle
    {
        const h = new Handle();
        if (this._archiyou) h.setArchiyou(this._archiyou);
        this.handles.push(h);
        return h;
    }

    /** @deprecated Use beginRun(scriptKey). Kept for backwards compatibility. */
    reset(): void
    {
        this.handles = [];
    }

    /** Build the op stream to send to the viewer this run.
     *  Only call for the main scope (Runner gates on scope._main). */
    getManagedHandlesData(): ManagedHandlesData
    {
        const ops: ManagedHandleOp[] = [];
        const touched = new Set<string>();

        for (const [i, h] of this.handles.entries())
        {
            const data: HandleData = h.toData();
            if (!data.id) data.id = String(i);
            touched.add(data.id);

            this._checkParamMapAxes(data);

            if (this._scriptChanged || !this._registry.has(data.id))
            {
                // First definition (or script changed → re-add everything)
                ops.push({ id: data.id, _operation: 'add', data });
                this._registry.put(data.id, data);
            }
            else
            {
                const stored = this._registry.get(data.id)!;

                // ── Definition change detection ────────────────────────────────
                // Compare each define-once field against the stored definition.
                // Any change re-emits an 'add' op so the viewer picks up the new
                // definition (new map function, range, axes, etc.).
                const defChanged = this._definitionChanged(stored, data, h);
                if (defChanged)
                {
                    ops.push({ id: data.id, _operation: 'add', data });
                    this._registry.put(data.id, data);
                    // Deliberately NOT `continue`. The viewer preserves the live (possibly
                    // dragged) position across a re-add — a definition change must never
                    // yank a dragged handle back — so the position inside this add op is
                    // ignored on the far end. If the script also commanded a position this
                    // run via at()/position(), it takes the mutator op below to actually
                    // move the handle. Scripts that derive range() from the same values as
                    // at() (one per list entry, bounds from the entry itself) change the
                    // definition on EVERY edit, so without this they would never move again.
                }

                // ── Mutator change detection ───────────────────────────────────
                // Emit update for explicit mutators, definition change or not.
                let dirty = false;
                const op: ManagedHandleOp = { id: data.id, _operation: 'update' };
                if (h._atCalled || h._positionCalled)
                {
                    op.position = data.position;
                    dirty = true;
                }
                if (h._hideCalled || h._showCalled)
                {
                    op.visible = data.visible;
                    dirty = true;
                }
                if (dirty) ops.push(op);
                // else: emit nothing; viewer keeps the dragged value
            }
        }

        // Touch-based deletes: known ids that the script did not touch this run
        for (const id of this._registry.knownIds())
        {
            if (!touched.has(id))
            {
                ops.push({ id, _operation: 'delete' });
                this._registry.delete(id);
            }
        }

        // After script-change all old ids are now gone (deleted above); clear the flag
        if (this._scriptChanged) this._scriptChanged = false;

        return ops;
    }

    /** Compare define-once fields between the stored registry definition and the
     *  current run's data. Returns true if anything changed that the viewer needs
     *  to know about. Each attribute group is checked independently so this method
     *  reads as a clear inventory of what can drift. */
    private _definitionChanged(stored: HandleData, current: HandleData, h: Handle): boolean
    {
        // Param binding: which param and which map function
        if (stored.param !== current.param)                     return true;
        if (stored.paramFnSrc !== current.paramFnSrc)           return true;
        if (stored.paramsFnSrc !== current.paramsFnSrc)         return true;

        // Drag range: type, bounds, and absolute-vs-relative mode
        if (stored.rangeType !== current.rangeType)             return true;
        if (stored.rangeRelative !== current.rangeRelative)     return true;
        if (!_eq(stored.rangeMin, current.rangeMin))            return true;
        if (!_eq(stored.rangeMax, current.rangeMax))            return true;

        // Drag plane: origin axes (uAxis / vAxis direction changes)
        if (!_eqArr(stored.plane.uAxis, current.plane.uAxis))   return true;
        if (!_eqArr(stored.plane.vAxis, current.plane.vAxis))   return true;

        // Icon
        if (stored.icon !== current.icon)                       return true;

        // Declarative drag-axis → property map
        if (!_eqMap(stored.paramMap, current.paramMap))         return true;

        // Start position: only a definition change when start() was explicitly
        // called this run (at()/position() are mutators, not definition changes).
        if (h._startCalled && !_eqArr(stored.position, current.position)) return true;

        return false;
    }

    /** Drop world axes from a relative param map, with an explanation.
     *
     *  range() may be called after param(), so this cannot be validated at the param()
     *  call site — it is checked here, once, while the run's handles are being serialized.
     *  Dropping the offending axis is better than shipping it: the viewer would add a world
     *  coordinate to the property as if it were a drag delta, sending the value off to
     *  somewhere absurd on the first nudge. */
    private _checkParamMapAxes(data: HandleData): void
    {
        const map = data.paramMap;
        if (!map || !data.rangeRelative) return;

        // Capture the pairs BEFORE dropping them — the message names what was discarded.
        const bad = Object.entries(map).filter(([axis]) => _WORLD_AXES.includes(axis));
        if (bad.length === 0) return;

        bad.forEach(([axis]) => delete map[axis as keyof HandleParamMap]);
        this._archiyou?.console?.error(
            `$handle().param(): handle "${data.id}" has a relative range, so ` +
            `${bad.map(([axis, prop]) => `"${axis}: '${prop}'"`).join(', ')} ` +
            `cannot be applied — 'x'/'y'/'z' are world positions, not drag deltas. ` +
            `Use 'u'/'v' with a relative range, or give range() numbers instead of strings ` +
            `to write world coordinates directly.`,
        );
    }

    /** @deprecated — use getManagedHandlesData() instead. */
    getHandlesData(): HandleData[]
    {
        return this.handles.map((h, i) =>
        {
            const data = h.toData();
            if (!data.id) data.id = String(i);
            return data;
        });
    }
}
