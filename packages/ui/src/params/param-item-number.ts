import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import './param-help.js';

import type { ParamUIMode } from './param-item.js';
import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { paramMin, paramMax, paramStep, paramValue } from '@archiyou/editor/src/state/workspace';
import { scriptUnitSystem, configuratorUnitSystem } from '@archiyou/editor/src/state/workspace';

import type { ModelUnits } from '@archiyou/core/src/modeler/types';
import type { UnitSystem } from '@archiyou/core/src/units/UnitConverter';
import {
    MM_PER_UNIT, UNIT_SYSTEMS, convert, systemOfUnit, pickBestUnit,
    toMM, fromMM, snapMMToSystem, formatImperial, paramDisplayDecimals, stepDecimals,
} from '@archiyou/core/src/units/UnitConverter';

/** Sentinel stored in param.units to mark a param as explicitly unitless. */
const NONE_UNIT = 'none';

@customElement('param-item-number')
export class ParamItemNumber extends SignalWatcher(LitElement)
{
    // ── 1. Render ──

    override render()
    {
        const src     = this._sourceUnit();          // null → unitless (no conversion)
        const display = src ? this._displayUnit(src) : null;

        // For length params, present bounds/value in the display unit (geometry
        // stays in the source unit). Unitless params render raw.
        const min  = (src && display) ? convert(paramMin(this.param),  src, display) : paramMin(this.param);
        const max  = (src && display) ? convert(paramMax(this.param),  src, display) : paramMax(this.param);
        const step = (src && display) ? convert(paramStep(this.param), src, display) : paramStep(this.param);
        const displayValue = (src && display) ? convert(this._value, src, display) : this._value;

        // Step-driven fixed-decimal display when idle/after a slider drag (step 1 →
        // integer, 0.1 → 1 decimal, …); while the field is focused show a
        // light-rounded value so typing isn't reformatted.
        const numStr  = this._focused
            ? String(Math.round(displayValue * 1e4) / 1e4)
            : this._displayFixed(displayValue, display);
        const fracHint = (src && display && this._displaySystem() === 'imperial')
            ? formatImperial(toMM(this._value, src), { unit: display })
            : null;

        const slider = html`
            <input
                type="range"
                class="slider"
                min=${min}
                max=${max}
                step=${step}
                .value=${live(String(displayValue))}
                @input=${this._onSlider}
            />
        `;

        const numUnit = html`
            <div class="num-unit">
                <input
                    type="number"
                    class="num"
                    min=${ifDefined(this.bare ? undefined : min)}
                    max=${ifDefined(this.bare ? undefined : max)}
                    step=${ifDefined(this.bare ? undefined : step)}
                    .value=${numStr}
                    @focus=${() => { this._focused = true; }}
                    @blur=${() => { this._focused = false; }}
                    @input=${this._onNumberInput}
                    @change=${this._onNumber}
                />
                ${this._renderUnitSelect(src, display)}
            </div>
        `;

        const dec = html`
            <button class="step-btn" title="Decrement" @click=${this._decrement}>
                <wa-icon library="lucide" name="chevron-left"></wa-icon>
            </button>`;
        const inc = html`
            <button class="step-btn" title="Increment" @click=${this._increment}>
                <wa-icon library="lucide" name="chevron-right"></wa-icon>
            </button>`;
        const frac = fracHint
            ? html`<span class="frac-hint" title="Fractional inches">${fracHint}</span>`
            : '';

        // Presentation: label + value box share the top line, the slider gets the
        // full menu width underneath, flanked by the step arrows.
        if (this.mode === 'presentation')
        {
            return html`
                <div class="wrap pres"
                    @mousedown=${(e: MouseEvent) => e.stopPropagation()}
                    @dragstart=${(e: DragEvent) => e.stopPropagation()}
                >
                    <div class="pres-top">
                        <span class="pres-label">${this.param?.label || this.param?.name}</span>
                        <param-help .text=${this.param?.description ?? ''}></param-help>
                        <span class="pres-spacer"></span>
                        ${frac}
                        ${numUnit}
                    </div>
                    <div class="pres-bottom">
                        ${dec}
                        ${slider}
                        ${inc}
                    </div>
                </div>
            `;
        }

        return html`
            <div class="wrap"
                @mousedown=${(e: MouseEvent) => e.stopPropagation()}
                @dragstart=${(e: DragEvent) => e.stopPropagation()}
            >
                ${this.bare ? '' : slider}
                ${dec}
                ${numUnit}
                ${frac}
                ${inc}
            </div>
        `;
    }

    /** The unit shown after the number.
     *
     *  Editor (authoring): a dropdown that sets the param's unit, including the
     *  '—' none sentinel.
     *  Configurator (end-user): a plain read-only label — end-users pick a unit
     *  *system* once in the header, and a per-param unit picker only adds noise. */
    private _renderUnitSelect(src: ModelUnits | null, display: ModelUnits | null)
    {
        const system = this._displaySystem();

        if (this.context !== 'editor')
        {
            // Unitless param → no label at all (the box then spans the full width).
            if (!src || !display) return '';
            return html`<span class="unit-label">${display}</span>`;
        }

        return html`
            <select class="unit" @change=${this._onUnit} title="Parameter unit">
                <option value=${NONE_UNIT} ?selected=${!src}>—</option>
                ${UNIT_SYSTEMS[system].map(u => html`
                    <option value=${u} ?selected=${u === display}>${u}</option>
                `)}
            </select>
        `;
    }

    // ── 2. State & Properties ──

    // hasChanged: always true so Lit re-renders this component whenever the
    // parent (param-menu SignalWatcher) passes the same ScriptParam object
    // after an external value change (e.g. handle drag), which mutates
    // _value in-place without changing the object reference.
    @property({ attribute: false, hasChanged: () => true }) param!: ScriptParam;

    /** 'editor' = authoring (display in the script's system, dropdown sets the
     *  param unit). 'configurator' = end-user (display in the local configurator
     *  system, dropdown overrides the display unit only). */
    @property({ type: String }) context: 'editor' | 'configurator' = 'editor';

    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';

    /** No slider, and no clamping to bounds. For a value whose schema has no
     *  meaningful range — notably an object property declared as a bare
     *  'number', which is deliberately left unbounded (PARAM_TYPE_SCHEMAS.number
     *  would impose maximum:100). Without this the paramMax() fallback of 100
     *  would silently clamp what the user types. */
    @property({ type: Boolean, reflect: true }) bare = false;

    /** Externally-owned value. The configurator keeps end-user values in its own
     *  signal (never on the shared ScriptParam), so it hands the current value in
     *  here; without it a preset could change the value with no visible effect.
     *  `undefined` → fall back to the param's own value. */
    @property({ attribute: false }) value: number | undefined = undefined;

    @state() private _value = 0;
    @state() private _focused = false;

    // Tracks the display system so a Metric/Imperial switch can snap the value.
    private _lastDisplaySystem: UnitSystem | null = null;

    // ── 3. Lifecycle ──

    override connectedCallback()
    {
        super.connectedCallback();
        this._syncValue();
    }

    override updated(changed: Map<string, unknown>)
    {
        // 1. Sync the displayed value from the param state, but only when the
        // external value actually differs — prevents resetting a slider that
        // the user is actively dragging (mid-drag _value ≠ committed param value).
        if (changed.has('param') || changed.has('value'))
        {
            const external = this._externalValue();
            if (external !== undefined && Number(external) !== this._value)
            {
                this._syncValue();
            }
        }

        // 2. On a Metric/Imperial switch, snap the stored value to a nice number
        // in the new system (25mm ⇄ 1") so the user always sees clean values.
        const sys = this._displaySystem();
        if (this._lastDisplaySystem !== null && sys !== this._lastDisplaySystem)
        {
            this._snapToSystem(sys);
        }
        this._lastDisplaySystem = sys;
    }

    // ── 4. Behaviour ──

    /** The system used for *display*: the script's system in the editor, the
     *  end-user's local system in the configurator. */
    private _displaySystem(): UnitSystem
    {
        return this.context === 'configurator' ? configuratorUnitSystem.get() : scriptUnitSystem.get();
    }

    /** The unit the stored value/bounds are expressed in (the conversion anchor).
     *  null when the param is unitless: unset, the '—' sentinel, or not a known unit. */
    private _sourceUnit(): ModelUnits | null
    {
        const u = this.param?.units as string | undefined;
        if (u && u in MM_PER_UNIT) return u as ModelUnits;
        return null;
    }

    /** The unit to display in: the source unit when already in the display
     *  system, else an auto-picked best unit for that system. */
    private _displayUnit(src: ModelUnits): ModelUnits
    {
        const system = this._displaySystem();
        if (systemOfUnit(src) === system) return src;
        return pickBestUnit(toMM(paramMax(this.param), src), system);
    }

    /** The value owned outside this component: the caller's `value` when given
     *  (configurator), otherwise the param's own runtime/default value. */
    private _externalValue(): any
    {
        if (this.value !== undefined && this.value !== null) return this.value;
        return this.param ? paramValue(this.param) : undefined;
    }

    private _syncValue()
    {
        const v = this._externalValue();
        this._value = (v !== undefined && v !== null) ? Number(v) : (this.param ? paramMin(this.param) : 0);
    }

    /** Snap the stored value to a nice number in `system` (nearest 1/16" for
     *  imperial, nearest mm for metric), clamped to bounds, and commit if it
     *  changed. Length params only. */
    private _snapToSystem(system: UnitSystem)
    {
        const src = this._sourceUnit();
        if (!src) return; // unitless — nothing to snap

        const snappedMm = snapMMToSystem(toMM(this._value, src), system);
        const snapped = Math.max(paramMin(this.param),
            Math.min(paramMax(this.param), fromMM(snappedMm, src)));

        if (snapped !== this._value)
        {
            this._value = snapped;
            this._dispatchValue(snapped);
        }
    }

    /** Convert a display-unit input back into the source unit (identity when the
     *  param is unitless), then clamp + snap to the param's authored bounds/step. */
    private _commitFromDisplay(displayVal: number)
    {
        const src = this._sourceUnit();
        const srcVal = src ? convert(displayVal, this._displayUnit(src), src) : displayVal;

        // Unbounded param: the min/max/step fallbacks are meaningless here, and
        // clamping to them would destroy the value the user typed.
        if (this.bare)
        {
            this._value = srcVal;
            this._dispatchValue(srcVal);
            return;
        }

        const min  = paramMin(this.param);
        const max  = paramMax(this.param);
        const step = paramStep(this.param);
        const clamped = Math.max(min, Math.min(max, srcVal));
        const snapped = Math.round((clamped - min) / step) * step + min;
        this._value = snapped;
        this._dispatchValue(snapped);
    }

    private _onSlider(e: InputEvent)
    {
        this._commitFromDisplay(Number((e.target as HTMLInputElement).value));
    }

    private _onNumber(e: Event)
    {
        const input = e.target as HTMLInputElement;
        this._commitFromDisplay(Number(input.value));
        // reflect the snapped value back into the display unit (per-unit decimals)
        const src = this._sourceUnit();
        const disp = src ? this._displayUnit(src) : null;
        input.value = this._displayFixed(src && disp ? convert(this._value, src, disp) : this._value, disp);
    }

    private _onNumberInput(e: InputEvent)
    {
        const input = e.target as HTMLInputElement;
        if (input.value === '') return;
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed)) return;

        // live edit: clamp in source space but don't snap (snap on change)
        const src = this._sourceUnit();
        const srcVal = src ? convert(parsed, this._displayUnit(src), src) : parsed;
        const clamped = this.bare
            ? srcVal
            : Math.max(paramMin(this.param), Math.min(paramMax(this.param), srcVal));
        this._value = clamped;
        this._dispatchValue(clamped);
    }

    /** Editor only (the configurator renders a read-only unit label): author the
     *  param's unit — a real ModelUnits, or the '—' sentinel for explicitly
     *  unitless. The value stays the same number in the new unit. */
    private _onUnit(e: Event)
    {
        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, units: (e.target as HTMLSelectElement).value },
            bubbles:  true,
            composed: true,
        }));
    }

    private _decrement()
    {
        const step = paramStep(this.param);
        const min  = paramMin(this.param);
        this._value = this.bare ? this._value - step : Math.max(min, this._value - step);
        this._dispatchValue(this._value);
    }

    private _increment()
    {
        const step = paramStep(this.param);
        const max  = paramMax(this.param);
        this._value = this.bare ? this._value + step : Math.min(max, this._value + step);
        this._dispatchValue(this._value);
    }

    private _dispatchValue(value: number)
    {
        // Always dispatch in the source (canonical) unit — geometry never changes.
        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, value },
            bubbles:  true,
            composed: true,
        }));
    }

    /** Format the number input with as many decimals as the param's step needs
     *  (step 1 → "120", 0.1 → "120.5", 0.25 → "120.25"), so the value shown can
     *  actually be reached with the arrows/slider.
     *
     *  When the value is displayed in another unit than it is stored in the step
     *  no longer lands on a clean grid (1mm ≈ 0.03937"), so the per-unit default
     *  (mm → integer, others → 2 decimals) takes over. */
    private _displayFixed(v: number, unit: ModelUnits | null): string
    {
        return (Number.isFinite(v) ? v : 0).toFixed(this._decimals(unit));
    }

    /** Decimals for the number field — see _displayFixed. */
    private _decimals(unit: ModelUnits | null): number
    {
        const src = this._sourceUnit();
        const converted = !!src && !!unit && src !== unit;
        const fromStep = converted ? null : stepDecimals(paramStep(this.param));
        return fromStep ?? paramDisplayDecimals(unit);
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: block; width: 100%; }

        .wrap
        {
            display:     flex;
            align-items: center;
            gap:         4px;
            width:       100%;
        }

        .slider
        {
            flex:      1 1 0;
            min-width: 0;
            cursor:    pointer;
            /* Tints the native range track/thumb so it follows the theme
               (avoids a glaring white track in dark mode). */
            accent-color: var(--color-primary);
        }

        /* ── step arrows ── */
        .step-btn
        {
            flex-shrink:     0;
            display:         inline-flex;
            align-items:     center;
            justify-content: center;
            width:           18px;
            height:          22px;
            padding:         0;
            border:          none;
            background:      transparent;
            cursor:          pointer;
            color:           var(--color-text-muted);
            font-size:       10px;
        }

        .step-btn:hover { color: var(--color-primary); }

        /* ── combined number + unit box ── */
        .num-unit
        {
            display:       flex;
            align-items:   stretch;
            border:        1px solid var(--color-border);
            border-radius: var(--radius-sm, 3px);
            overflow:      hidden;
            flex-shrink:   0;
            width:         110px;
        }

        .num-unit:focus-within { border-color: var(--color-primary); }

        .num
        {
            flex:        1 1 0;
            min-width:   0;
            width:       50px;
            font-family: var(--font-sans);
            font-size:   var(--text-sm);
            color:       var(--color-text);
            background:  var(--color-bg-elevated);
            border:      none;
            border-right: 1px solid var(--color-border);
            padding:     1px 4px;
            text-align:  right;
        }

        .num:focus { outline: none; }

        /* hide native spin buttons */
        .num::-webkit-outer-spin-button,
        .num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .num[type=number]               { -moz-appearance: textfield; }

        .unit
        {
            flex-shrink: 0;
            width:       58px;
            font-family: var(--font-sans);
            font-size:   var(--text-xs);
            color:       var(--color-gray-dark, #666);
            background:  var(--color-bg-elevated);
            border:      none;
            padding:     1px 6px;
            cursor:      pointer;
        }

        .unit:focus { outline: none; }

        /* Read-only unit label (configurator) — same footprint as .unit so the
           number box keeps its width whichever variant is rendered. */
        .unit-label
        {
            flex-shrink:  0;
            display:      inline-flex;
            align-items:  center;
            width:        38px;
            font-family:  var(--font-sans);
            font-size:    var(--text-xs);
            color:        var(--color-gray-dark, #666);
            background:   var(--color-bg-elevated);
            padding:      1px 6px;
            user-select:  none;
        }

        .frac-hint
        {
            /* Fixed width so the fractional-inch text (e.g. 15/16" vs 1 15/16")
               doesn't change the row layout — otherwise the increment button
               visibly "jumps" while dragging the slider. Monospace + ch keeps it
               tight yet scale-safe; overflow guards very large values. */
            flex-shrink:   0;
            box-sizing:    border-box;
            width:         9ch;
            text-align:    center;
            overflow:      hidden;
            font-family:   var(--font-mono, monospace);
            font-size:     var(--text-xs);
            color:         var(--color-text-muted, #888);
            white-space:   nowrap;
        }

        /* ── Presentation mode (configurator) ──
           Row 1: "? LABEL … [value][unit]".  Row 2: ‹ full-width slider ›. */

        .wrap.pres
        {
            display:        flex;
            flex-direction: column;
            align-items:    stretch;
            gap:            var(--space-xs);
        }

        .pres-top
        {
            display:     flex;
            align-items: center;
            gap:         var(--space-xs);
            min-height:  24px;
        }

        .pres-label
        {
            font-family:   var(--font-sans);
            font-size:     var(--text-sm);
            font-weight:   500;
            color:         var(--color-text);
            overflow:      hidden;
            text-overflow: ellipsis;
            white-space:   nowrap;
            min-width:     0;
        }

        .pres-spacer { flex: 1; min-width: var(--space-sm); }

        .pres-bottom
        {
            display:     flex;
            align-items: center;
            gap:         var(--space-xs);
            width:       100%;
        }

        .wrap.pres .slider { flex: 1 1 auto; height: 18px; }

        .wrap.pres .step-btn { width: 20px; height: 24px; font-size: 12px; }

        /* Narrower than the editor's box: no unit dropdown to make room for. */
        .wrap.pres .num-unit { width: 100px; height: 26px; }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-item-number': ParamItemNumber;
    }
}
