import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './param-object-form.js';
import type { ParamPropertyChange } from './param-object-form.js';

import type { ParamUIMode } from './param-item.js';
import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { paramValue } from '@archiyou/editor/src/state/workspace';
import type { TranslatorFn } from '@archiyou/core/src/i18n/resolve';

/** A single `object` param.
 *
 *  Thin on purpose: param-object-form edits a bare schema+value pair, so something
 *  has to translate its `object-change` back into a `param-value-change` carrying
 *  the param's real name. Doing that inline would duplicate it across both the
 *  editor and the configurator switch.
 */
@customElement('param-item-object')
export class ParamItemObject extends LitElement
{
    // ── 1. Render ──

    override render()
    {
        const schema = (this.param?.schema ?? {}) as Record<string, any>;

        if (Object.keys(schema.properties ?? {}).length === 0)
        {
            // PARAM_TYPE_SCHEMAS.object has no properties; they only arrive via
            // $PARAMS.define('X','object', { of:'Type' }) or an explicit properties map.
            return html`<div class="empty">No properties defined — declare them in the script</div>`;
        }

        return html`
            <param-object-form
                .schema=${schema}
                .value=${this._value()}
                .mode=${this.mode}
                .t=${this.t}
                @object-change=${this._onObjectChange}
            ></param-object-form>
        `;
    }

    // ── 2. State & Properties ──

    @property({ attribute: false }) param!: ScriptParam;
    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';
    /** Externally-owned value (the configurator's runtime value); `undefined`
     *  falls back to the param's own value. */
    @property({ attribute: false }) value: Record<string, any> | undefined = undefined;
    /** Content translator, supplied by the configurator. Identity by default. */
    @property({ attribute: false }) t: TranslatorFn = (_key, fallback) => fallback;

    /** The value we last emitted, held only until the next render — see _value(). */
    private _pending: Record<string, any> | null = null;

    // ── 3. Lifecycle ──

    override updated()
    {
        this._pending = null;
    }

    // ── 4. Behaviour ──

    private _value(): Record<string, any>
    {
        // See param-item-object-list._entries() for why _pending exists.
        if (this._pending) return this._pending;

        const v = this.value !== undefined ? this.value : (this.param ? paramValue(this.param) : undefined);
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }

    private _onObjectChange(e: CustomEvent<ParamPropertyChange>)
    {
        e.stopPropagation();

        const next = { ...this._value(), [e.detail.key]: e.detail.value };
        this._pending = next;

        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, value: next },
            bubbles:  true,
            composed: true,
        }));
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: block; width: 100%; }

        .empty
        {
            font-family: var(--font-sans);
            font-size:   var(--text-xs);
            color:       var(--color-text-gray, var(--color-text-muted));
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-item-object': ParamItemObject;
    }
}
