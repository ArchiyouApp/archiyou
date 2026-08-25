import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { ParamUIMode } from './param-item.js';
import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { paramValue, paramOptions } from '@archiyou/editor/src/state/workspace';
import { paramOptionKey } from '@archiyou/core/src/i18n/keys';
import type { TranslatorFn } from '@archiyou/core/src/i18n/resolve';

@customElement('param-item-options')
export class ParamItemOptions extends LitElement
{
    // ── 1. Render ──

    override render()
    {
        const options = this.param ? paramOptions(this.param) : [];

        return html`
            <select
                class="select"
                .value=${this._value}
                @change=${this._onChange}
                @mousedown=${(e: MouseEvent) => e.stopPropagation()}
                @dragstart=${(e: DragEvent) => e.stopPropagation()}
            >
                ${options.length === 0
                    ? html`<option value="" disabled>No options defined</option>`
                    : options.map(o => html`
                        <!-- The VALUE stays raw: it is what the script compares against
                             (if ($STYLE === 'modern')). Only the visible text is
                             translated, so this can never change behaviour. -->
                        <option value=${o} ?selected=${String(o) === this._value}>${
                            this.t(paramOptionKey(this.param?.name ?? '', o), String(o))
                        }</option>
                    `)
                }
            </select>
        `;
    }

    // ── 2. State & Properties ──

    @property({ attribute: false }) param!: ScriptParam;
    /** Content translator, supplied by the configurator. Identity by default so the
     *  editor's authoring rows are unaffected — see the note in param-item.ts. */
    @property({ attribute: false }) t: TranslatorFn = (_key, fallback) => fallback;
    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';
    /** Externally-owned value (the configurator's runtime value); `undefined`
     *  falls back to the param's own value. */
    @property({ attribute: false }) value: string | number | undefined = undefined;

    @state() private _value = '';

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

    private _onChange(e: Event)
    {
        const raw = (e.target as HTMLSelectElement).value;
        this._value = raw;

        // If all enum entries are numbers, dispatch as number
        const options = this.param ? paramOptions(this.param) : [];
        const isNumericEnum = options.length > 0 && options.every(o => typeof o === 'number');
        const dispatched: string | number = isNumericEnum ? Number(raw) : raw;

        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, value: dispatched },
            bubbles:  true,
            composed: true,
        }));
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: block; }

        .select
        {
            width:         100%;
            font-family:   var(--font-sans);
            font-size:     var(--text-xs);
            color:         var(--color-text);
            background:    var(--color-bg-elevated);
            border:        1px solid var(--color-border);
            border-radius: var(--radius-sm, 3px);
            padding:       3px 6px;
            cursor:        pointer;
        }

        .select:focus
        {
            outline:      none;
            border-color: var(--color-primary);
        }

        /* Presentation mode (configurator): roomier select for end users. */
        :host([mode="presentation"]) .select
        {
            font-size: var(--text-sm);
            padding:   5px 8px;
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-item-options': ParamItemOptions;
    }
}
