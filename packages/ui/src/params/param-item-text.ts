import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import type { ParamUIMode } from './param-item.js';
import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { paramValue, paramMinLength, paramMaxLength } from '@archiyou/editor/src/state/workspace';

@customElement('param-item-text')
export class ParamItemText extends LitElement
{
    // ── 1. Render ──

    override render()
    {
        return html`
            <div class="wrap">
                <input
                    type="text"
                    class="input ${this._error ? 'invalid' : ''}"
                    .value=${this._value}
                    maxlength=${ifDefined(paramMaxLength(this.param))}
                    placeholder="Enter text…"
                    @input=${this._onInput}
                    @blur=${this._onBlur}
                />
                ${this._error ? html`<span class="error">${this._error}</span>` : ''}
            </div>
        `;
    }

    // ── 2. State & Properties ──

    @property({ attribute: false }) param!: ScriptParam;
    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';
    /** Externally-owned value (the configurator's runtime value); `undefined`
     *  falls back to the param's own value. */
    @property({ attribute: false }) value: string | undefined = undefined;

    @state() private _value = '';
    @state() private _error = '';

    // ── 3. Lifecycle ──

    override connectedCallback()
    {
        super.connectedCallback();
        this._sync();
    }

    override updated(changed: Map<string, unknown>)
    {
        if (changed.has('param') || changed.has('value')) this._sync();
    }

    private _sync()
    {
        const v = this.value !== undefined ? this.value : (this.param ? paramValue(this.param) : '');
        this._value = String(v ?? '');
    }

    // ── 4. Behaviour ──

    private _onInput(e: InputEvent)
    {
        const val    = (e.target as HTMLInputElement).value;
        const minLen = paramMinLength(this.param);
        const maxLen = paramMaxLength(this.param);

        this._value = val;

        if (val.length < minLen)
        {
            this._error = `Min ${minLen} chars`;
            return;
        }

        if (maxLen !== undefined && val.length > maxLen)
        {
            this._error = `Max ${maxLen} chars`;
            return;
        }

        this._error = '';
        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, value: val },
            bubbles:  true,
            composed: true,
        }));
    }

    private _onBlur(e: FocusEvent)
    {
        const val    = (e.target as HTMLInputElement).value;
        const minLen = paramMinLength(this.param);

        if (val.length < minLen)
        {
            this._value = String(this.param.default ?? '');
            this._error = '';
        }
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: block; width: 100%; }

        .wrap
        {
            display:        flex;
            flex-direction: column;
            gap:            2px;
            width:          100%;
        }

        .input
        {
            width:         100%;
            box-sizing:    border-box;
            font-family:   var(--font-sans);
            font-size:     var(--text-sm);
            color:         var(--color-text);
            background:    var(--color-bg-elevated);
            border:        1px solid var(--color-border);
            border-radius: var(--radius-sm, 3px);
            padding:       2px 6px;
        }

        .input:focus
        {
            outline:      none;
            border-color: var(--color-primary);
        }

        .input.invalid { border-color: var(--color-alert); }

        /* Presentation mode (configurator): roomier input for end users. */
        :host([mode="presentation"]) .input { padding: 5px 8px; }

        .error
        {
            font-size:   var(--text-xs);
            color:       var(--color-alert);
            line-height: 1.2;
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-item-text': ParamItemText;
    }
}
