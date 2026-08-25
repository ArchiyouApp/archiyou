import type { ArchiyouModules } from '../types';
import type { HandleData, HandlePlane, HandleRangeType } from './types';

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

    /** Resolve any PointLike / Shape target to a [x, y, z] triple. */
    private _resolvePosition(target: any): [number, number, number]
    {
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
     *  Accepts a PointLike [x,y,z] array, a {x,y,z} object, or a Shape-like with center()/bbox(). */
    start(target: any): this
    {
        this._pos = this._resolvePosition(target);
        this.plane.origin = [...this._pos];
        this._startCalled = true;
        return this;
    }

    /** Every-run position push — script continuously owns the handle position.
     *  Use when the position must track geometry that changes with params.
     *  For initial placement prefer start(); for a one-shot push use position(). */
    at(target: any): this
    {
        this._pos = this._resolvePosition(target);
        this.plane.origin = [...this._pos];
        this._atCalled = true;
        return this;
    }

    /** Imperative one-shot position push this run only.
     *  Useful for conditionally repositioning the handle from script logic. */
    position(target: any): this
    {
        this._pos = this._resolvePosition(target);
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
        return this;
    }

    /** Bind this handle to a script parameter.
     *  @param paramName  Name of the script parameter (e.g. 'X', 'SIZE').
     *  @param fn  Optional map function `(handle, param) => newParamValue`.
     *             When omitted (or null), autoMap is used: the handle range is
     *             linearly remapped to the param's schema min/max (1D number params only).
     *             `handle` exposes `{x, y, z, u, v, value, range}`. */
    param(paramName: string, fn?: ((handle: any, param: any) => any) | null): this
    {
        this._param = paramName;
        this.paramFnSrc = (typeof fn === 'function') ? fn.toString() : null;
        if (!this.id) this.id = paramName;
        return this;
    }

    /** Bind this handle to multiple script parameters via a mutation function.
     *  @param fn  Function `(handle, params) => void`.
     *             `params` is a plain object pre-populated with all current param
     *             values keyed by param name. Mutate the keys you want to update:
     *             `(h, p) => { p.X = h.x; p.Y = h.y }`.
     *             The viewer detects which keys changed and applies each one.
     *  Use this for 2D handles or any case where one drag updates several params. */
    params(fn: (handle: any, params: Record<string, any>) => void): this
    {
        const src = fn.toString();

        // Detect concise arrow functions (no block body after =>).
        // Concise arrows like `(h, p) => h.x` can't reliably mutate params —
        // they return a value instead of modifying the object in-place.
        // Require a block body: `(h, p) => { p.X = h.x; p.Y = h.y }`.
        const isArrow = src.includes('=>');
        const hasBlockBody = /=>\s*\{/.test(src);
        if (isArrow && !hasBlockBody)
        {
            const detail =
                `$handle().params(): function must have a block body — use (h, p) => { p.X = h.x; ... }. ` +
                `Got: ${src}. ` +
                `Concise arrows return a value instead of mutating params.`;
            this._archiyou?.console?.error(detail);
            throw new Error(detail);
        }

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
                fn({ x: 0, y: 0, z: 0, u: 0, v: 0, value: 0, range: [0, 1] }, proxy);
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

        this.paramsFnSrc = src;
        return this;
    }

    toData(): HandleData
    {
        return {
            id:           this.id,
            type:         'handle',
            position:     [...this._pos],
            icon:         this._iconExplicit ? this._icon : Handle._autoIcon(this.rangeType, this.plane.uAxis),
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
        };
    }
}
