import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './param-item-number.js';
import './param-item-boolean.js';
import './param-item-text.js';
import './param-item-options.js';

import type { ParamUIMode } from './param-item.js';
import { ScriptParam } from '@archiyou/editor/src/state/workspace';
import type { ScriptParamData, ScriptParamType } from '@archiyou/editor/src/state/workspace';
import type { TranslatorFn } from '@archiyou/core/src/i18n/resolve';

/** Sentinel param-item-number reads as "explicitly unitless". */
const NONE_UNIT = 'none';

/** Which existing param control renders a given object property. */
type PropControl = 'number' | 'boolean' | 'text' | 'options' | null;

/** Detail of the `object-change` event: one property of the edited object. */
export interface ParamPropertyChange
{
    key:   string;
    value: any;
}

/** The control for one property, decided from the property's OWN schema.
 *  Deliberately read before ScriptParam.fromData() merges PARAM_TYPE_SCHEMAS
 *  underneath it — after that merge a bare { type:'number' } looks bounded. */
function controlFor(propSchema: Record<string, any>): PropControl
{
    if (Array.isArray(propSchema?.enum)) return 'options';

    switch (propSchema?.type)
    {
        case 'boolean':          return 'boolean';
        case 'number':
        case 'integer':          return 'number';
        case 'string':           return 'text';
        default:                 return null; // nested array/object — not editable in v1
    }
}

const PARAM_TYPE_FOR: Record<Exclude<PropControl, null>, ScriptParamType> = {
    number:  'number'  as ScriptParamType,
    boolean: 'boolean' as ScriptParamType,
    text:    'text'    as ScriptParamType,
    options: 'options' as ScriptParamType,
};

/** Editable form for ONE object value — one entry of an object list, or a whole
 *  `object` param. Delegates every field to the existing param controls.
 *
 *  It takes a schema + a value rather than a ScriptParam: the thing being edited
 *  is a property of a param, not a param, and conflating the two is what makes
 *  nested editing leak into the real param store (see the event note below).
 */
@customElement('param-object-form')
export class ParamObjectForm extends LitElement
{
    // ── 1. Render ──

    override render()
    {
        const properties = (this.schema?.properties ?? {}) as Record<string, Record<string, any>>;
        const entries = Object.entries(properties);

        if (entries.length === 0)
        {
            return html`<div class="empty">No properties defined</div>`;
        }

        // The leaf controls all dispatch `param-value-change` with bubbles+composed.
        // Escaping this form would be actively destructive: param-menu would route it
        // to updateParam(<property name>) — clobbering a same-named real param — and
        // the editor page would schedule a script re-run on every keystroke. Each
        // control is wired individually below; this wrapper is the backstop for any
        // control added later and not wired.
        return html`
            <div class="form"
                @param-value-change=${(e: Event) => e.stopPropagation()}
                @mousedown=${(e: MouseEvent) => e.stopPropagation()}
                @dragstart=${(e: DragEvent) => e.stopPropagation()}
            >
                ${entries.map(([key, propSchema], i) => html`
                    <div class="row">
                        <span class="row-label" title=${propSchema?.label ?? key}>
                            ${propSchema?.label ?? key}
                        </span>
                        <div class="row-control">
                            ${this._renderControl(key, propSchema, i)}
                        </div>
                    </div>
                `)}
            </div>
        `;
    }

    private _renderControl(key: string, propSchema: Record<string, any>, index: number)
    {
        const control = controlFor(propSchema);
        const value   = this.value?.[key];

        if (control === null)
        {
            return html`<span class="unsupported"
                title="Nested lists and objects are not editable here yet">${JSON.stringify(value)}</span>`;
        }

        const param  = this._paramFor(key, propSchema, index, control);
        const onChange = (e: CustomEvent) =>
        {
            e.stopPropagation();
            this._setProperty(key, e.detail?.value);
        };

        switch (control)
        {
            case 'options':
                return html`<param-item-options .param=${param} .value=${value} .t=${this.t}
                    @param-value-change=${onChange}></param-item-options>`;
            case 'boolean':
                return html`<param-item-boolean .param=${param} .value=${value}
                    @param-value-change=${onChange}></param-item-boolean>`;
            case 'number':
                // context="configurator" → a read-only unit LABEL. The editor's unit
                // dropdown dispatches a units-only event that means nothing for a
                // property, and would just be noise in a nested form.
                return html`<param-item-number .param=${param} .value=${value}
                    context="configurator" ?bare=${!this._isBounded(propSchema)}
                    @param-value-change=${onChange}></param-item-number>`;
            case 'text':
                return html`<param-item-text .param=${param} .value=${value}
                    @param-value-change=${onChange}></param-item-text>`;
            default:
                return nothing;
        }
    }

    // ── 2. State & Properties ──

    /** JSON Schema of the object being edited (type: 'object', with properties). */
    @property({ attribute: false }) schema: Record<string, any> = {};
    /** The value being edited. Never mutated — every change emits a fresh object. */
    @property({ attribute: false }) value: Record<string, any> = {};
    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';
    /** Content translator, supplied by the configurator. Identity by default. */
    @property({ attribute: false }) t: TranslatorFn = (_key, fallback) => fallback;

    /** Ephemeral ScriptParams, one per property, memoized per schema.
     *  Rebuilding them each render would make `changed.has('param')` true in every
     *  control, which re-syncs the displayed value on every keystroke. */
    private _params = new Map<string, ScriptParam>();
    private _paramsFor: Record<string, any> | null = null;

    // ── 4. Behaviour ──

    /** A property with real authored bounds gets a slider; an unbounded one does
     *  not (its min/max would be the 0..100 accessor fallback). */
    private _isBounded(propSchema: Record<string, any>): boolean
    {
        return propSchema?.minimum !== undefined && propSchema?.maximum !== undefined;
    }

    /** An ephemeral ScriptParam standing in for one property.
     *
     *  The name is SYNTHETIC and never read back. The property key cannot be used:
     *  ScriptParamSchema requires >= 3 characters (so `x` or `id` would throw inside
     *  render()), fromData() uppercases (so `width` would collide with a real $WIDTH),
     *  and the label would fall back to that shouting name. Changes are routed by
     *  closure over `key` instead — see _renderControl().
     */
    private _paramFor(key: string, propSchema: Record<string, any>, index: number, control: Exclude<PropControl, null>): ScriptParam
    {
        if (this._paramsFor !== this.schema)
        {
            this._params.clear();
            this._paramsFor = this.schema;
        }

        const existing = this._params.get(key);
        if (existing) return existing;

        const param = ScriptParam.fromData({
            name:   `PROP_${index}`,
            type:   PARAM_TYPE_FOR[control],
            label:  propSchema?.label ?? key,
            // A property is UNITLESS unless its schema says otherwise. param-item-number
            // otherwise falls back to the script's model unit, so a plain count would
            // render as "3 mm" — and unlike a top-level param, a nested property has no
            // unit dropdown for the author to correct it with.
            units:  propSchema?.units ?? NONE_UNIT,
            schema: propSchema,
        } as ScriptParamData);

        this._params.set(key, param);
        return param;
    }

    /** Emits the CHANGED PROPERTY, not a merged object.
     *
     *  `this.value` is one render behind: a change round-trips through the store and
     *  only comes back as a new property on the next render. Merging here would build
     *  the second of two quick edits on a pre-first-edit copy and silently drop the
     *  first (type a name, immediately tick a checkbox → the name reverts). Emitting a
     *  delta lets the owner merge into whatever IT holds, which is always fresher.
     */
    private _setProperty(key: string, value: any)
    {
        if (value === undefined) return; // e.g. a units-only event carries no value

        this.dispatchEvent(new CustomEvent<ParamPropertyChange>('object-change', {
            detail:   { key, value },
            bubbles:  true,
            composed: true,
        }));
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: block; width: 100%; }

        *,
        *::before,
        *::after { box-sizing: border-box; }

        /* Deliberately unframed. Inside an object list this form already sits within the
           entry's own border, and a second rule 4px inside it just competes. No background
           either: --color-bg-elevated (the entry's surface) is only defined in the dark
           theme, so painting --color-bg here would be white-on-white in light mode — worse
           than the border it replaced. Transparent inherits whichever surface it lands on. */
        .form
        {
            display:        flex;
            flex-direction: column;
            gap:            var(--space-xs, 4px);
            padding:        var(--space-sm, 6px) var(--space-md, 8px);
        }

        .row
        {
            display:     flex;
            align-items: center;
            gap:         var(--space-sm, 6px);
            min-height:  22px;
        }

        .row-label
        {
            flex:          0 0 80px;
            overflow:      hidden;
            text-overflow: ellipsis;
            white-space:   nowrap;
            font-family:   var(--font-sans);
            font-size:     var(--text-xs);
            color:         var(--color-text-muted);
        }

        .row-control
        {
            flex:        1;
            min-width:   0;
            display:     flex;
            align-items: center;
        }

        .empty,
        .unsupported
        {
            font-family: var(--font-sans);
            font-size:   var(--text-xs);
            color:       var(--color-text-gray, var(--color-text-muted));
        }

        .unsupported
        {
            font-family:   var(--font-mono, monospace);
            overflow:      hidden;
            text-overflow: ellipsis;
            white-space:   nowrap;
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-object-form': ParamObjectForm;
    }
}
