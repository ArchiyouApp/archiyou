import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/slider/slider.js';

import type { ParamUIMode } from './param-item.js';
import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { paramValue } from '@archiyou/editor/src/state/workspace';
import { scriptUnitSystem, configuratorUnitSystem } from '@archiyou/editor/src/state/workspace';

import { ScriptParam as ScriptParamModel } from '@archiyou/core/src/execution/ScriptParam';
import type { NumberRangesConfig } from '@archiyou/core/src/execution/ScriptParam';
import type { ModelUnits } from '@archiyou/core/src/modeler/types';
import type { UnitSystem } from '@archiyou/core/src/units/UnitConverter';
import {
    MM_PER_UNIT, convert, systemOfUnit, pickBestUnit, toMM, paramDisplayDecimals, stepDecimals,
} from '@archiyou/core/src/units/UnitConverter';

type Thumb = 'min' | 'max';

/** A 'number-ranges' param: one slider with two handles.
 *      range → the value is [from, to], the two handles themselves
 *      split → the value is [a, b, c], the parts start→handle 1→handle 2→end
 *  Below the slider a number field per value; typing one moves the handle next to it. */
@customElement('param-item-number-ranges')
export class ParamItemNumberRanges extends SignalWatcher(LitElement)
{
    // ── 1. Render ──

    override render()
    {
        const c = this._config();
        const [h1, h2] = this._handles;
        const src = this._sourceUnit();
        const display = src ? this._displayUnit(src) : null;

        return html`
            <div class="wrap ${c.mode}"
                @mousedown=${(e: MouseEvent) => e.stopPropagation()}
                @dragstart=${(e: DragEvent) => e.stopPropagation()}
            >
                <wa-slider
                    class="slider"
                    range
                    size="small"
                    with-tooltip
                    min=${c.minimum}
                    max=${c.maximum}
                    step=${c.multipleOf}
                    .minValue=${h1}
                    .maxValue=${h2}
                    .valueFormatter=${(v: number) => this._format(v, src, display)}
                    @input=${this._onSlider}
                ></wa-slider>
                <div class="fields">
                    ${this._values().map((v, i) => this._renderField(v, i, c, src, display))}
                </div>
            </div>
        `;
    }

    private _renderField(v: number, index: number, c: NumberRangesConfig, src: ModelUnits | null, display: ModelUnits | null)
    {
        const label = c.labels[index] ?? '';

        return html`
            <label class="field part-${index}">
                ${label ? html`<span class="field-label" title=${label}>${label}</span>` : ''}
                <span class="num-unit">
                    <input
                        type="number"
                        class="num"
                        step=${this._displayStep(src, display)}
                        .value=${this._format(v, src, display)}
                        @focus=${(e: FocusEvent) => (e.target as HTMLInputElement).select()}
                        @change=${(e: Event) => this._onField(e, index)}
                    />
                    ${display ? html`<span class="unit">${display}</span>` : ''}
                </span>
            </label>
        `;
    }

    // ── 2. State & Properties ──

    // hasChanged: always true, as in param-item-number: the editor writes a new value
    // into the SAME param object, so the reference alone never changes
    @property({ attribute: false, hasChanged: () => true }) param!: ScriptParam;

    /** 'editor' shows values in the script's unit system, 'configurator' in the end-user's */
    @property({ type: String }) context: 'editor' | 'configurator' = 'editor';

    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';

    /** Externally-owned value (the configurator's runtime value); `undefined` falls
     *  back to the param's own value. */
    @property({ attribute: false }) value: Array<number> | undefined = undefined;

    /** The two handle positions on the track, in the param's own unit */
    @state() private _handles: [number, number] = [0, 100];

    // ── 3. Lifecycle ──

    override connectedCallback()
    {
        super.connectedCallback();
        this._sync();
    }

    override updated(changed: Map<string, unknown>)
    {
        // Only when the outside value really differs: a re-render mid-drag must not
        // move the handle back to the last committed value
        if (changed.has('param') || changed.has('value'))
        {
            const external = this._externalHandles();
            if (external && (external[0] !== this._handles[0] || external[1] !== this._handles[1]))
            {
                this._handles = external;
            }
        }

        // The split colours the track per part: where the handles are, in % of the track
        const c = this._config();
        const span = (c.maximum - c.minimum) || 1;
        this.style.setProperty('--h1', `${(this._handles[0] - c.minimum) / span * 100}%`);
        this.style.setProperty('--h2', `${(this._handles[1] - c.minimum) / span * 100}%`);
    }

    // ── 4. Behaviour ──

    private _config(): NumberRangesConfig
    {
        return ScriptParamModel.rangesConfig((this.param?.schema ?? {}) as Record<string, any>);
    }

    private _sync()
    {
        this._handles = this._externalHandles() ?? this._handles;
    }

    /** The outside value as handle positions, fitted to the schema */
    private _externalHandles(): [number, number] | undefined
    {
        if (!this.param) return undefined;
        const external = this.value ?? paramValue(this.param);
        const fitted = ScriptParamModel.fitRanges(this.param.schema as Record<string, any>, external)
            ?? (this.param.schema as any)?.default;
        return Array.isArray(fitted) ? this._toHandles(fitted) : undefined;
    }

    private _toHandles(value: Array<number>): [number, number]
    {
        const c = this._config();
        return (c.mode === 'split')
            ? [c.minimum + value[0], c.minimum + value[0] + value[1]]
            : [value[0], value[1]];
    }

    /** The numbers the script gets: the handles (range) or the parts between them (split) */
    private _values(): Array<number>
    {
        const c = this._config();
        const [h1, h2] = this._handles;
        return (c.mode === 'split')
            ? [h1 - c.minimum, h2 - h1, c.maximum - h2]
            : [h1, h2];
    }

    /** Move one handle, snapped to the grid and kept minSpan from the other one
     *  (and in a split from the ends too), then commit */
    private _moveHandle(thumb: Thumb, position: number)
    {
        const c = this._config();
        const edge = (c.mode === 'split') ? c.minSpan : 0;
        const lo = c.minimum + edge;
        const hi = c.maximum - edge;
        const snapped = c.minimum + Math.round((position - c.minimum) / c.multipleOf) * c.multipleOf;
        const [h1, h2] = this._handles;

        this._handles = (thumb === 'min')
            ? [this._clamp(snapped, lo, Math.min(hi, h2 - c.minSpan)), h2]
            : [h1, this._clamp(snapped, Math.max(lo, h1 + c.minSpan), hi)];

        this._commit();
    }

    private _commit()
    {
        // fitRanges() leaves a valid value as it is, apart from float noise of the subtractions
        const value = ScriptParamModel.fitRanges(this.param.schema as Record<string, any>, this._values());
        if (!value) return;

        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, value },
            bubbles:  true,
            composed: true,
        }));
    }

    private _onSlider(e: Event)
    {
        const slider = e.target as HTMLElement & { minValue: number, maxValue: number };
        const [h1, h2] = this._handles;
        const minMoved = slider.minValue !== h1;
        const maxMoved = slider.maxValue !== h2;
        if (!minMoved && !maxMoved) return;

        // wa-slider has no minimum gap, and a thumb dragged past the other one takes that
        // one along: both then sit where the pointer is. Below the old min it was the max
        // thumb pushing down, above the old max the min thumb pushing up.
        const thumb: Thumb = (minMoved && maxMoved)
            ? (slider.minValue < h1) ? 'max' : 'min'
            : (minMoved) ? 'min' : 'max';
        const position = (thumb === 'min') ? slider.minValue : slider.maxValue;

        this._moveHandle(thumb, position);

        // Pull the thumb back when the gap stopped it
        slider.minValue = this._handles[0];
        slider.maxValue = this._handles[1];
    }

    /** A typed number moves the handle next to it: a range field its own handle, a split
     *  part the handle between it and the part that gives or takes the difference */
    private _onField(e: Event, index: number)
    {
        const input = e.target as HTMLInputElement;
        const typed = Number(input.value);
        const c = this._config();

        if (input.value.trim() !== '' && Number.isFinite(typed))
        {
            const src = this._sourceUnit();
            const v = src ? convert(typed, this._displayUnit(src), src) : typed;

            if (c.mode === 'range') this._moveHandle((index === 0) ? 'min' : 'max', v);
            else if (index === 0) this._moveHandle('min', c.minimum + v);
            else if (index === 1) this._moveHandle('max', this._handles[0] + v);
            else this._moveHandle('max', c.maximum - v);
        }

        // Show what it became: clamped, snapped, or the old value for garbage
        const display = this._sourceUnit() ? this._displayUnit(this._sourceUnit() as ModelUnits) : null;
        input.value = this._format(this._values()[index], this._sourceUnit(), display);
    }

    private _clamp(v: number, lo: number, hi: number): number
    {
        return Math.min(hi, Math.max(lo, v));
    }

    //// UNITS (as in param-item-number) ////

    private _displaySystem(): UnitSystem
    {
        return (this.context === 'configurator') ? configuratorUnitSystem.get() : scriptUnitSystem.get();
    }

    /** The unit the value is stored in; null when unitless (a percentage, a count) */
    private _sourceUnit(): ModelUnits | null
    {
        const u = this.param?.units as string | undefined;
        return (u && u in MM_PER_UNIT) ? u as ModelUnits : null;
    }

    private _displayUnit(src: ModelUnits): ModelUnits
    {
        const system = this._displaySystem();
        return (systemOfUnit(src) === system) ? src : pickBestUnit(toMM(this._config().maximum, src), system);
    }

    /** A value in the param's unit, as shown: in the display unit, with the decimals the step needs */
    private _format(v: number, src: ModelUnits | null, display: ModelUnits | null): string
    {
        const shown = (src && display) ? convert(v, src, display) : v;
        const converted = !!src && !!display && src !== display;
        const decimals = (converted ? null : stepDecimals(this._config().multipleOf)) ?? paramDisplayDecimals(display);
        return (Number.isFinite(shown) ? shown : 0).toFixed(decimals);
    }

    private _displayStep(src: ModelUnits | null, display: ModelUnits | null): number
    {
        const step = this._config().multipleOf;
        return (src && display) ? convert(step, src, display) : step;
    }

    // ── 5. Styles ──

    static override styles = css`
        :host
        {
            display: block;
            width:   100%;
            --h1:    33%;
            --h2:    66%;
        }

        /* Inset from the param's name above it; the width follows (no 100%),
           so the margin does not push the fields past the right edge */
        .wrap
        {
            display:        flex;
            flex-direction: column;
            gap:            var(--space-xs);
            margin-left:    var(--space2xl);
        }

        .slider
        {
            width:          100%;
            --track-size:   6px;
            --thumb-width:  14px;
            --thumb-height: 14px;
        }

        /* Split: every part its own colour; the range indicator between the
           handles would only mark the middle part */
        .split .slider::part(track)
        {
            background: linear-gradient(to right,
                var(--color-primary-light) 0 var(--h1),
                var(--color-primary-dark) var(--h1) var(--h2),
                var(--color-primary-light) var(--h2) 100%);
        }

        .split .slider::part(indicator) { background: transparent; }

        /* Split: first part left, middle part dead centre, last part right, each
           label aligned with its field. Range: from left, to right. */
        .fields
        {
            display:               grid;
            grid-template-columns: 1fr auto 1fr;
            align-items:           end;
            gap:                   var(--space-xs);
        }

        .range .fields { grid-template-columns: 1fr 1fr; }

        .field
        {
            display:        flex;
            flex-direction: column;
            gap:            2px;
            min-width:      0;
        }

        .field:first-child { align-items: flex-start; justify-self: start; }
        .field:last-child  { align-items: flex-end;   justify-self: end; }
        .split .part-1     { align-items: center;     justify-self: center; }

        .field-label
        {
            max-width:     100%;
            font-family:   var(--font-sans);
            font-size:     var(--text-xs);
            color:         var(--color-text-gray, #666);
            overflow:      hidden;
            text-overflow: ellipsis;
            white-space:   nowrap;
        }

        .num-unit
        {
            display:     inline-flex;
            align-items: center;
            gap:         4px;
        }

        .num
        {
            width:         64px;
            box-sizing:    border-box;
            font-family:   var(--font-sans);
            font-size:     var(--input-font-size);
            font-weight:   600;
            color:         var(--color-text);
            background:    var(--color-bg-elevated);
            border:        1px solid var(--color-divider);
            border-radius: var(--radius-md, 6px);
            padding:       1px 4px;
            text-align:    right;
        }

        .num:focus
        {
            outline:      none;
            border-color: var(--color-primary);
        }

        /* hide native spin buttons */
        .num::-webkit-outer-spin-button,
        .num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .num[type=number]               { -moz-appearance: textfield; }

        .unit
        {
            flex-shrink: 0;
            font-family: var(--font-sans);
            font-size:   var(--text-xs);
            color:       var(--color-text-gray, #666);
        }

        :host([mode='presentation']) .num { height: 26px; }

        @media (pointer: coarse)
        {
            .slider
            {
                --thumb-width:  var(--hit-min);
                --thumb-height: var(--hit-min);
            }

            .num { height: 36px; }
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-item-number-ranges': ParamItemNumberRanges;
    }
}
