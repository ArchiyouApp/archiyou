import type { ArchiyouModules } from '../types';
import type { HandleData, HandleDrag, HandleMinimized, HandlePlane, HandleRangeType } from './types';
import { detachFunction } from '../execution/CodeParser';

const AXIS_VECTORS: Record<string, [number, number, number]> = {
    x: [1, 0, 0],
    y: [0, 1, 0],
    z: [0, 0, 1],
};

// Perpendicular vAxis to use as the hit-plane's second spanning vector for 1D
// drags along each primary axis. Chosen so the resulting hit-plane faces a
// direction that is easy to interact with from a Z-up isometric camera.
//   x → vAxis Z: hit-plane normal = Y (XZ plane)
//   y → vAxis Z: hit-plane normal = X (YZ plane)
//   z → vAxis X: hit-plane normal = Y (XZ plane)  ← must differ from uAxis=Z
const AXIS_VAXIS: Record<string, [number, number, number]> = {
    x: [0, 0, 1],
    y: [0, 0, 1],
    z: [1, 0, 0],
};

export class Handle
{
    id: string = '';
    /** Internal storage for the handle's 3D position.
     *  Exposed via start()/at()/position() setters and serialized as 'position' in toData(). */
    _pos: [number, number, number] = [0, 0, 0];
    _icon: string = 'move';
    _iconExplicit: boolean = false;
    _minimized: HandleMinimized | null = null;
    visible: boolean = true;
    rangeType: HandleRangeType = '1d';
    rangeMin: number | [number, number] = -100;
    rangeMax: number | [number, number] = 100;
    rangeRelative: boolean = false;
    plane: HandlePlane = {
        origin: [0, 0, 0],
        uAxis:  [1, 0, 0],
        vAxis:  [0, 0, 1],
    };
    _param: string | null = null;
    paramFnSrc: string | null = null;
    paramsFnSrc: string | null = null;
    /** Values from the script the mapping function uses, given as the last argument of
     *  param() or params(): variables of the function when the viewer rebuilds it */
    fnVars: Record<string, any> | null = null;

    // Per-run call-tracking flags — read by Interactor.getManagedHandlesData()
    // to decide which ops to emit. Reset implicitly because Handles are recreated each run.
    _startCalled    = false;
    _atCalled       = false;
    _positionCalled = false;
    _hideCalled     = false;
    _showCalled     = false;

    protected _archiyou!: ArchiyouModules;

    setArchiyou(modules: ArchiyouModules): this
    {
        this._archiyou = modules;
        return this;
    }

    get classes()
    {
        return this._archiyou?.modeler?.classes;
    }

    /** Resolve any PointLike / Shape target, or flat coordinates (x, y, z), to a [x, y, z] triple. */
    private _resolvePosition(target: any, y?: number, z?: number): [number, number, number]
    {
        if (typeof target === 'number')
        {
            return [target, y ?? 0, z ?? 0];
        }
        if (Array.isArray(target))
        {
            return [target[0] ?? 0, target[1] ?? 0, target[2] ?? 0];
        }
        if (target && typeof target === 'object')
        {
            let pt: any = null;
            if (typeof target.center === 'function') {
                pt = target.center();
            } else if (typeof target.bbox === 'function') {
                pt = target.bbox()?.center?.();
            }
            if (pt)
            {
                const arr = typeof pt.toArray === 'function' ? pt.toArray() : [pt.x ?? 0, pt.y ?? 0, pt.z ?? 0];
                return [arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0];
            }
            if ('x' in target || 'y' in target)
            {
                return [target.x ?? 0, target.y ?? 0, target.z ?? 0];
            }
        }
        return [0, 0, 0];
    }

    /** Define-once initial placement. The viewer owns the handle position after the first run;
     *  use at() or position() if the script needs to push a position on subsequent runs.
     *  Accepts flat coordinates `start(x, y, z)`, a PointLike [x,y,z] array, a {x,y,z} object,
     *  or a Shape-like with center()/bbox(). */
    start(target: any, y?: number, z?: number): this
    {
        this._pos = this._resolvePosition(target, y, z);
        this.plane.origin = [...this._pos];
        this._startCalled = true;
        return this;
    }

    /** Every-run position push — script continuously owns the handle position.
     *  Use when the position must track geometry that changes with params.
     *  For initial placement prefer start(); for a one-shot push use position().
     *  Takes the same targets as start(): `at(x, y, z)`, `at([x, y, z])`, a point or a shape.
     *  @example
     *  $PARAMS.define('WIDTH', 'number', { min: 10, max: 200, default: 100 });
     *  box($WIDTH, 50, 20);
     *  $handle().param('WIDTH').at($WIDTH/2, 0, 10).along('x').range(10, 200);
     */
    at(target: any, y?: number, z?: number): this
    {
        this._pos = this._resolvePosition(target, y, z);
        this.plane.origin = [...this._pos];
        this._atCalled = true;
        return this;
    }

    /** Imperative one-shot position push this run only.
     *  Useful for conditionally repositioning the handle from script logic.
     *  Takes the same targets as start(). */
    position(target: any, y?: number, z?: number): this
    {
        this._pos = this._resolvePosition(target, y, z);
        this.plane.origin = [...this._pos];
        this._positionCalled = true;
        return this;
    }

    /** Hide this handle in the viewer (takes effect this run). */
    hide(): this
    {
        this.visible = false;
        this._hideCalled = true;
        return this;
    }

    /** Show this handle in the viewer (takes effect this run). */
    show(): this
    {
        this.visible = true;
        this._showCalled = true;
        return this;
    }

    /** Set the drag axis (or axes for 2D).
     *  Accepts a single axis `'x'|'y'|'z'` (1D) or two `'xy'|'xz'|'yz'` (2D).
     *  Sets rangeType automatically based on the number of axes. */
    along(axis: 'x'|'y'|'z'|'xy'|'xz'|'yz'): this
    {
        const lower = axis.toLowerCase();
        if (lower.length === 1)
        {
            const vec = AXIS_VECTORS[lower];
            if (vec)
            {
                this.plane.uAxis = [...vec] as [number,number,number];
                this.plane.vAxis = [...AXIS_VAXIS[lower]] as [number,number,number];
                this.rangeType = '1d';
            }
        }
        else if (lower.length === 2)
        {
            const u = AXIS_VECTORS[lower[0]];
            const v = AXIS_VECTORS[lower[1]];
            if (u && v)
            {
                this.plane.uAxis = [...u] as [number,number,number];
                this.plane.vAxis = [...v] as [number,number,number];
                this.rangeType = '2d';
            }
        }
        return this;
    }

    /** Set the Lucide icon name shown in the HTML handle widget.
     *  When not called, an icon is chosen automatically from the axis/range type. */
    icon(name: string): this
    {
        this._icon = name;
        this._iconExplicit = true;
        return this;
    }

    /** Show this handle as a small plain circle instead of the icon button —
     *  less clutter when a model has many handles.
     *  Defaults to black at 30% opacity: `minimized({ color: '#FFF', opacity: 0.8 })`. */
    minimized(options: Partial<HandleMinimized> = {}): this
    {
        const opacity = Number(options.opacity ?? 0.3);
        this._minimized = {
            color:   options.color ?? '#000',
            opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.3,
        };
        return this;
    }

    /** Pick a sensible Lucide icon from the current range type and drag axis.
     *  1D along Z → `move-vertical`
     *  1D along X or Y → `move-horizontal`
     *  2D → `move`
     */
    static _autoIcon(rangeType: HandleRangeType, uAxis: [number, number, number]): string
    {
        if (rangeType === '2d') return 'move';
        // Predominantly along Z (vertical in Z-up) → vertical arrow
        if (Math.abs(uAxis[2]) > 0.7) return 'move-vertical';
        return 'move-horizontal';
    }

    /** Override the stable id (defaults to bound param name, then creation-order index). */
    name(id: string): this
    {
        this.id = id;
        return this;
    }

    /** Set the drag range.
     *
     *  **Absolute** (numbers): `range(-10, 10)` — clamp is in world-space projection
     *  along uAxis/vAxis; useful when the handle should stay between two world coordinates.
     *
     *  **Relative** (strings): `range('-10', '+10')` — clamp is ±offset from the
     *  handle's current position along uAxis/vAxis; useful for param-delta handles.
     *
     *  2D variants: `range([-10,-10], [10,10])` / `range(['-10','-5'], ['+10','+5'])`. */
    range(
        min: number | string | [number|string, number|string],
        max: number | string | [number|string, number|string],
    ): this
    {
        const is2D = Array.isArray(min) && Array.isArray(max);
        // Relative when at least one bound is a string
        const isRelative = is2D
            ? (typeof (min as any[])[0] === 'string' || typeof (max as any[])[0] === 'string')
            : (typeof min === 'string' || typeof max === 'string');

        this.rangeRelative = isRelative;

        if (is2D)
        {
            this.rangeType = '2d';
            this.rangeMin = [(min as any[])[0], (min as any[])[1]].map(v => parseFloat(String(v))) as [number, number];
            this.rangeMax = [(max as any[])[0], (max as any[])[1]].map(v => parseFloat(String(v))) as [number, number];
        }
        else
        {
            this.rangeType = '1d';
            this.rangeMin = parseFloat(String(min));
            this.rangeMax = parseFloat(String(max));
        }

        // A bound that is not a number (NaN, null, undefined, `'-' + undefined`) would pass
        // silently and make the handle vanish from the viewer on its first drag
        const bounds = [this.rangeMin, this.rangeMax].flat();
        if (!bounds.every(Number.isFinite))
        {
            // As written, so NaN and undefined show as themselves (JSON would print null)
            const show = (v: any): string => Array.isArray(v)
                ? `[${v.map(show).join(', ')}]`
                : (typeof v === 'string' ? `'${v}'` : String(v));
            const detail =
                `$handle()${this._param ? `.param('${this._param}')` : ''}.range(): every bound must be a number, ` +
                `or a string like '+100' / '-100' for a relative range. ` +
                `Got min ${show(min)}, max ${show(max)}.`;
            this._archiyou?.console?.error(detail);
            throw new Error(detail);
        }
        return this;
    }

    /** Bind this handle to a script parameter, or to one element of a list param.
     *
     *  @param ref  Either a param name (`'WIDTH'`) or an indexed reference into a list
     *              param (`'OPENINGS[2]'`) — the usual array syntax, so one handle can
     *              stand for one entry of a `$PARAMS.defineObject()` list.
     *  @param map  How the drag reaches the value:
     *
     *  **Omitted** — autoMap: where the handle is in its range sets where the value is in the
     *  param's min to max: halfway along `range(0, 1000)` gives the middle of the param's
     *  range. For a number param on a 1D handle with a range of numbers.
     *
     *  **A function** `(param, handle) => …` — `param` is a copy of the current value,
     *  `handle` tells where the drag ended:
     *
     *      handle.u,  handle.v    where the handle is along its drag axes
     *      handle.du, handle.dv   how far this drag moved it
     *      handle.tu, handle.tv   how far through the range, 0 to 1
     *      handle.position()      where it is in the model, [x, y, z]
     *
     *  These are the same whatever range() gets. `du`/`dv` are the robust choice for moving
     *  something (`param.left += handle.du`): the handle can then sit anywhere on it, while
     *  `u`/`v` only fit when the handle sits exactly where the property points.
     *
     *  Return the new value; an object or list param may instead be changed in place — a
     *  returned value only counts for it when it is an object or list too, so
     *  `(param, handle) => param.left = handle.u` works as written. Every property the
     *  function changes is snapped to its step and clamped to its min/max. The function runs
     *  in the viewer, from its source text: variables of the script are not there. Pass the
     *  ones it uses in `vars`; a name that is neither passed nor a JavaScript built-in (Math,
     *  JSON, …) is an error right away, instead of a drag that silently does nothing.
     *
     *  For an indexed ref prefer at() over start(): the viewer keeps a dragged handle
     *  where the user put it across a re-definition, but a handle standing for a list entry
     *  must follow the value the script actually got — a step:10 property snaps to 1230
     *  where the drag ended at 1234.
     *
     *  @param vars  Values from the script the function uses, like `{ dragDir }`: plain data
     *              (numbers, text, lists, plain objects), available in the function by name.
     *
     *  @example
     *  $PARAMS.define('HEIGHT', 'number', { min: 100, max: 300, default: 200 });
     *  $PARAMS.define('BIG', 'boolean', { default: false });
     *  box(100, 100, $HEIGHT);
     *  // autoMap: dragging from z 0 to 400 sets HEIGHT from 100 to 300
     *  $handle().param('HEIGHT').at(0, 0, ($HEIGHT - 100) * 2).along('z').range(0, 400);
     *  // a function, here switching a boolean halfway
     *  $handle().param('BIG', (param, handle) => handle.tu > 0.5).at(200, 0, 0).along('x').range(0, 400);
     *  // a value from the script, passed along
     *  const step = 50;
     *  $handle().param('HEIGHT', (param, handle) => param + Math.round(handle.du / step) * step, { step })
     *      .at(0, 50, $HEIGHT).along('z').range('-100', '+100');
     */
    param(
        ref: string,
        map?: ((param: any, handle: HandleDrag) => any) | null,
        vars?: Record<string, any>,
    ): this
    {
        // Validate against the param's own name; the [index] is a reference INTO it.
        const name = Handle.parseParamRef(ref).name;
        const knownParamNames = this._archiyou?.interactor?.knownParamNames ?? [];
        if (knownParamNames.length > 0 && !knownParamNames.includes(name))
        {
            const detail =
                `$handle().param(): unknown param "${name}". ` +
                `Known params: ${knownParamNames.map(k => `"${k}"`).join(', ')}. ` +
                `Param names are case-sensitive.`;
            this._archiyou?.console?.error(detail);
            throw new Error(detail);
        }

        if (map !== undefined && map !== null && typeof map !== 'function')
        {
            const detail =
                `$handle().param('${ref}'): the second argument must be a function, like ` +
                `(param, handle) => { param.left += handle.du }. Got ${JSON.stringify(map)}.`;
            this._archiyou?.console?.error(detail);
            throw new Error(detail);
        }

        const detached = (typeof map === 'function')
            ? this._detach(map, vars, `$handle().param('${ref}')`, names => `.param('${ref}', fn, { ${names.join(', ')} })`)
            : null;

        this._param      = ref;
        this.paramFnSrc  = detached?.src ?? null;
        this.fnVars      = detached?.vars ?? null;
        if (!this.id) this.id = ref;
        return this;
    }

    /** Split a param reference into its name and, for `NAME[index]`, its index.
     *  Shared with the viewer so both ends read a reference the same way. */
    static parseParamRef(ref: string): { name: string; index: number | null }
    {
        const m = /^\s*([^[\s]+)\s*\[\s*(\d+)\s*\]\s*$/.exec(ref ?? '');
        return m ? { name: m[1], index: Number(m[2]) } : { name: (ref ?? '').trim(), index: null };
    }

    /** Bind this handle to multiple script parameters via a function.
     *  @param fn  Function `(params, handle) => void`. `params` holds the current value of
     *             every param by name; change the ones this drag should update:
     *             `(params, handle) => { params.X += handle.du; params.Y += handle.dv }`.
     *             `handle` is the same as for param(). The viewer detects which params
     *             changed and applies each one; a returned value is ignored.
     *  @param vars Values from the script the function uses, as for param()
     *  Use this when one drag updates several params. */
    params(fn: (params: Record<string, any>, handle: HandleDrag) => void, vars?: Record<string, any>): this
    {
        const detached = this._detach(fn, vars, '$handle().params()', names => `.params(fn, { ${names.join(', ')} })`);

        // Validate keys against known param names immediately (at call time).
        const knownParamNames = this._archiyou?.interactor?.knownParamNames ?? [];
        if (knownParamNames.length > 0)
        {
            const touched = new Set<string>();
            const proxy = new Proxy({} as Record<string, any>, {
                set(_target, key, value, receiver)
                {
                    touched.add(String(key));
                    return Reflect.set(_target, key, value, receiver);
                },
            });
            try
            {
                fn(proxy, { u: 0, v: 0, du: 0, dv: 0, tu: 0, tv: 0, range: [0, 1], position: () => [0, 0, 0] });
            }
            catch { /* runtime errors in the fn itself — ignore for now */ }

            const unknown = [...touched].filter(k => !knownParamNames.includes(k));
            if (unknown.length > 0)
            {
                const detail =
                    `$handle().params(): unknown param(s): ${unknown.map(k => `"${k}"`).join(', ')}. ` +
                    `Known params: ${knownParamNames.map(k => `"${k}"`).join(', ')}. ` +
                    `Param names are case-sensitive.`;
                // Log the detail through the Archiyou console so it appears in script output,
                // then throw a single-line Error so the runner's error formatter shows the full message.
                this._archiyou?.console?.error(detail);
                throw new Error(detail);
            }
        }

        this.paramsFnSrc = detached.src;
        this.fnVars      = detached.vars;
        return this;
    }

    /** detachFunction(), with its message also in the script console */
    private _detach(fn: Function, vars: Record<string, any> | undefined, where: string, passAlong: (names: string[]) => string)
    {
        try
        {
            return detachFunction(fn, vars, where, passAlong);
        }
        catch (e)
        {
            this._archiyou?.console?.error((e as Error).message);
            throw e;
        }
    }

    toData(): HandleData
    {
        return {
            id:           this.id,
            type:         'handle',
            position:     [...this._pos],
            icon:         this._iconExplicit ? this._icon : Handle._autoIcon(this.rangeType, this.plane.uAxis),
            minimized:    this._minimized ? { ...this._minimized } : null,
            visible:      this.visible,
            rangeType:    this.rangeType,
            rangeMin:     Array.isArray(this.rangeMin) ? [...this.rangeMin] : this.rangeMin,
            rangeMax:     Array.isArray(this.rangeMax) ? [...this.rangeMax] : this.rangeMax,
            rangeRelative: this.rangeRelative,
            plane: {
                origin: [...this.plane.origin] as [number,number,number],
                uAxis:  [...this.plane.uAxis]  as [number,number,number],
                vAxis:  [...this.plane.vAxis]  as [number,number,number],
            },
            param:        this._param,
            paramFnSrc:   this.paramFnSrc,
            paramsFnSrc:  this.paramsFnSrc,
            fnVars:       this.fnVars ? structuredClone(this.fnVars) : null,
        };
    }
}
