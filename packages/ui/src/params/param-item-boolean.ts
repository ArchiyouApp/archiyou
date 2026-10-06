import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/switch/switch.js';
import type WaSwitch from '@awesome.me/webawesome/dist/components/switch/switch.js';

import type { ParamUIMode } from './param-item.js';
import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { paramValue } from '@archiyou/editor/src/state/workspace';

@customElement('param-item-boolean')
export class ParamItemBoolean extends LitElement
{
    // ── 1. Render ──

    override render()
    {
        // The editor shows the value as the script reads it; a configurator visitor has the
        // label row above and the switch itself, so no "true"/"false" to translate.
        const presentation = this.mode === 'presentation';
        return html`
            <wa-switch
                size=${presentation ? 'medium' : 'small'}
                .checked=${this._checked}
                @change=${this._onChange}
            >${presentation ? nothing : (this._checked ? 'true' : 'false')}</wa-switch>
        `;
    }

    // ── 2. State & Properties ──

    @property({ attribute: false }) param!: ScriptParam;
    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';
    /** Externally-owned value (the configurator's runtime value); `undefined`
     *  falls back to the param's own value. */
    @property({ attribute: false }) value: boolean | undefined = undefined;

    @state() private _checked = false;

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
        this._checked = Boolean(
            this.value !== undefined ? this.value : (this.param ? paramValue(this.param) : false)
        );
    }

    // ── 4. Behaviour ──

    private _onChange(e: Event)
    {
        this._checked = (e.target as WaSwitch).checked;
        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, value: this._checked },
            bubbles:  true,
            composed: true,
        }));
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: block; }

        wa-switch::part(label)
        {
            font-family: var(--font-sans);
            font-size:   var(--text-sm);
            color:       var(--color-text-muted);
            user-select: none;
        }

        /* Fingers: a row tall enough to hit, and a switch to match. The switch lays
           itself out as a column (its hint goes underneath), so this centres it
           vertically in the taller row. */
        @media (pointer: coarse)
        {
            wa-switch
            {
                min-height:      var(--hit-min);
                justify-content: center;
                --width:         2.75em;
                --height:        1.5em;
                --thumb-size:    1.25em;
            }
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-item-boolean': ParamItemBoolean;
    }
}
