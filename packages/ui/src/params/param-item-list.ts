import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { ParamUIMode } from './param-item.js';
import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { paramValue, paramListItemType } from '@archiyou/editor/src/state/workspace';

@customElement('param-item-list')
export class ParamItemList extends LitElement
{
    // ── 1. Render ──

    override render()
    {
        const items: any[] = this._items();

        const itemType = this.param ? paramListItemType(this.param) : 'string';

        return html`
            <div class="wrap">
                ${items.length > 0 ? html`
                    <div class="chips">
                        ${items.map((item, i) => html`
                            <span class="chip">
                                <span class="chip-label">${String(item)}</span>
                                <button
                                    class="chip-remove"
                                    title="Remove"
                                    @click=${() => this._removeAt(i)}
                                >
                                    <wa-icon library="lucide" name="x"></wa-icon>
                                </button>
                            </span>
                        `)}
                    </div>` : ''}

                <div class="add-row">
                    <input
                        class="add-input"
                        .value=${this._draft}
                        placeholder=${`Add ${itemType}…`}
                        @input=${(e: InputEvent) =>
                            (this._draft = (e.target as HTMLInputElement).value)}
                        @keydown=${this._onKeydown}
                    />
                    <button class="add-btn" title="Add item" @click=${this._add}>
                        <wa-icon library="lucide" name="plus"></wa-icon>
                    </button>
                </div>
            </div>
        `;
    }

    // ── 2. State & Properties ──

    @property({ attribute: false }) param!: ScriptParam;
    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';
    /** Externally-owned value (the configurator's runtime value); `undefined`
     *  falls back to the param's own value. */
    @property({ attribute: false }) value: any[] | undefined = undefined;

    @state() private _draft = '';

    // ── 4. Behaviour ──

    /** Current items: the caller's `value` when given (configurator), else the
     *  param's own runtime/default value. */
    private _items(): any[]
    {
        const v = this.value !== undefined ? this.value : (this.param ? paramValue(this.param) : undefined);
        return Array.isArray(v) ? v : [];
    }

    private _removeAt(index: number)
    {
        const items = this._items();
        this._dispatchItems(items.filter((_, i) => i !== index));
    }

    private _add()
    {
        const raw = this._draft.trim();
        if (!raw) return;

        this._draft = '';
        this._dispatchItems([...this._items(), this._parseItem(raw)]);
    }

    private _onKeydown(e: KeyboardEvent)
    {
        if (e.key === 'Enter')  { this._add(); return; }
        if (e.key === 'Escape') { this._draft = ''; }
    }

    private _parseItem(raw: string): any
    {
        const type = this.param ? paramListItemType(this.param) : 'string';
        if (type === 'number')  return Number(raw);
        if (type === 'boolean') return raw.toLowerCase() !== 'false' && raw !== '0';
        return raw;
    }

    private _dispatchItems(value: any[])
    {
        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, value },
            bubbles:  true,
            composed: true,
        }));
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: block; width: 100%; }

        .wrap
        {
            display:        flex;
            flex-direction: column;
            gap:            4px;
            width:          100%;
        }

        .chips
        {
            display:     flex;
            flex-wrap:   wrap;
            gap:         3px;
            align-items: center;
        }

        .chip
        {
            display:       inline-flex;
            align-items:   center;
            gap:           2px;
            padding:       1px 5px;
            border-radius: var(--radius-full, 100px);
            border:        1px solid var(--color-border);
            background:    var(--color-bg-elevated);
            font-family:   var(--font-mono, monospace);
            font-size:     var(--text-xs);
            color:         var(--color-text);
        }

        .chip-label { max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .chip-remove
        {
            display:     inline-flex;
            align-items: center;
            padding:     0;
            border:      none;
            background:  transparent;
            cursor:      pointer;
            color:       var(--color-text-muted);
            font-size:   9px;
            opacity:     0.6;
        }

        .chip-remove:hover
        {
            color:   var(--color-alert);
            opacity: 1;
        }

        .add-row
        {
            display:     flex;
            gap:         3px;
            align-items: center;
        }

        .add-input
        {
            flex:          1;
            min-width:     0;
            font-family:   var(--font-sans);
            font-size:     var(--text-xs);
            color:         var(--color-text);
            background:    var(--color-bg-elevated);
            border:        1px solid var(--color-border);
            border-radius: var(--radius-sm, 3px);
            padding:       2px 5px;
        }

        .add-input:focus
        {
            outline:      none;
            border-color: var(--color-primary);
        }

        .add-btn
        {
            flex-shrink:     0;
            display:         inline-flex;
            align-items:     center;
            justify-content: center;
            width:           20px;
            height:          20px;
            padding:         0;
            border:          1px solid var(--color-border);
            border-radius:   var(--radius-sm, 3px);
            background:      transparent;
            cursor:          pointer;
            font-size:       10px;
            color:           var(--color-text-muted);
        }

        .add-btn:hover
        {
            border-color: var(--color-primary);
            color:        var(--color-primary);
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-item-list': ParamItemList;
    }
}
