import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import './param-object-form.js';
import type { ParamPropertyChange } from './param-object-form.js';

import type { ParamUIMode } from './param-item.js';
import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { paramValue, paramItemSchema, objectEntryLabel, objectDefaults,
         activeParamEntry, setActiveParamEntry } from '@archiyou/editor/src/state/workspace';
import type { TranslatorFn } from '@archiyou/core/src/i18n/resolve';

/** A `list` param whose items are objects: a picker over the entries, with the
 *  selected one expanded into an editable form underneath.
 *
 *  The shape comes from the param's own schema.items — declared in script code
 *  with $PARAMS.defineObject(). Every mutation emits ONE param-value-change
 *  carrying the whole new array, so the existing value plumbing is untouched.
 *
 *  Which entry is open lives in the shared `activeParamEntry` signal rather than in local
 *  state, so clicking a $handle().param('OPENINGS[i]') handle in the 3D view and clicking a
 *  row here are the same act.
 *
 *  In the editor (compact) the Add button sits on the param row's name line, rendered by
 *  param-menu and calling add(); only the configurator (presentation) shows it under the list.
 */
@customElement('param-item-object-list')
export class ParamItemObjectList extends SignalWatcher(LitElement)
{
    // ── 1. Render ──

    override render()
    {
        const entries    = this._entries();
        const itemSchema = this.param ? paramItemSchema(this.param) : {};
        const typeName   = itemSchema?.title ?? 'entry';

        return html`
            <div class="wrap"
                @mousedown=${(e: MouseEvent) => e.stopPropagation()}
                @dragstart=${(e: DragEvent) => e.stopPropagation()}
            >
                ${entries.length === 0
                    ? html`<div class="empty">No ${typeName.toLowerCase()}s yet</div>`
                    : html`<div class="entries">
                        ${repeat(entries, (_e, i) => i, (entry, i) => this._renderEntry(entry, i, itemSchema))}
                    </div>`
                }

                ${this.mode === 'presentation'
                    ? html`<button class="add-btn" title=${`Add ${typeName}`} @click=${this.add}>
                            <wa-icon library="lucide" name="plus"></wa-icon>
                            <span>Add ${typeName.toLowerCase()}</span>
                        </button>`
                    : nothing
                }
            </div>
        `;
    }

    private _renderEntry(entry: Record<string, any>, index: number, itemSchema: Record<string, any>)
    {
        const isOpen = this._selectedIndex() === index;
        const isConfirming = this._confirmingDelete === index;

        return html`
            <div class="entry ${isOpen ? 'open' : ''}">
                <div class="entry-head" @click=${() => this._toggle(index)}>
                    <wa-icon class="entry-caret" library="lucide"
                        name=${isOpen ? 'chevron-down' : 'chevron-right'}></wa-icon>
                    <span class="entry-label">${objectEntryLabel(itemSchema, entry, index)}</span>
                    <span class="entry-spacer"></span>
                    ${isConfirming
                        ? html`
                            <span class="confirm-label">Delete?</span>
                            <button class="entry-btn confirm danger" title="Confirm delete"
                                @click=${(e: Event) => { e.stopPropagation(); this._removeAt(index); }}>
                                <wa-icon library="lucide" name="check"></wa-icon>
                            </button>
                            <button class="entry-btn confirm" title="Cancel"
                                @click=${(e: Event) => { e.stopPropagation(); this._confirmingDelete = null; }}>
                                <wa-icon library="lucide" name="x"></wa-icon>
                            </button>`
                        : html`
                            <button class="entry-btn" title="Duplicate"
                                @click=${(e: Event) => { e.stopPropagation(); this._duplicate(index); }}>
                                <wa-icon library="lucide" name="copy"></wa-icon>
                            </button>
                            <button class="entry-btn danger" title="Remove"
                                @click=${(e: Event) => { e.stopPropagation(); this._confirmingDelete = index; }}>
                                <wa-icon library="lucide" name="trash-2"></wa-icon>
                            </button>`
                    }
                </div>

                ${isOpen
                    ? html`<param-object-form
                            .schema=${itemSchema}
                            .value=${entry}
                            .mode=${this.mode}
                            .t=${this.t}
                            @object-change=${(e: CustomEvent<ParamPropertyChange>) =>
                                this._setEntryProperty(index, e.detail.key, e.detail.value)}
                        ></param-object-form>`
                    : nothing
                }
            </div>
        `;
    }

    // ── 2. State & Properties ──

    @property({ attribute: false }) param!: ScriptParam;
    /** UI density — see ParamUIMode. */
    @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';
    /** Externally-owned value (the configurator's runtime value); `undefined`
     *  falls back to the param's own value. */
    @property({ attribute: false }) value: Array<Record<string, any>> | undefined = undefined;
    /** Content translator, supplied by the configurator. Identity by default. */
    @property({ attribute: false }) t: TranslatorFn = (_key, fallback) => fallback;

    /** Entry whose Remove button was clicked and waits for its confirm, or null */
    @state() private _confirmingDelete: number | null = null;

    /** The array we last emitted, held only until the next render — see _entries(). */
    private _pending: Array<Record<string, any>> | null = null;

    /** Index we last scrolled to, so an externally-driven change (a handle click in the
     *  viewer) scrolls its row into view exactly once — not on every unrelated render. */
    private _lastScrolledIndex: number | null = null;

    // ── 3. Lifecycle ──

    override updated()
    {
        // A render means the owner has had its say; stop shadowing it.
        this._pending = null;

        const index = this._selectedIndex();
        if (index !== this._lastScrolledIndex)
        {
            this._lastScrolledIndex = index;
            if (index !== null)
            {
                this.renderRoot.querySelector('.entry.open')?.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    // ── 4. Behaviour ──

    private _entries(): Array<Record<string, any>>
    {
        // _pending shadows the incoming value for the one beat between emitting a
        // change and it arriving back as a property, so consecutive edits build on
        // each other instead of on a stale copy.
        if (this._pending) return this._pending;

        const v = this.value !== undefined ? this.value : (this.param ? paramValue(this.param) : undefined);
        return Array.isArray(v) ? v : [];
    }

    /** Index of the expanded entry, or null. Read from the shared signal, scoped to THIS
     *  param — another object list's open row must not open a row here. */
    private _selectedIndex(): number | null
    {
        const ref = activeParamEntry.get();
        return (ref && ref.param === this.param?.name) ? ref.index : null;
    }

    private _select(index: number | null)
    {
        setActiveParamEntry(index === null ? null : { param: this.param.name, index });
    }

    private _toggle(index: number)
    {
        this._select(this._selectedIndex() === index ? null : index);
    }

    /** Add an entry with the type's defaults and open it. Public: in the editor the Add
     *  button is on the param row's name line, outside this component. */
    add = () =>
    {
        const entries = this._entries();
        this._dispatch([...entries, objectDefaults(paramItemSchema(this.param))]);
        this._select(entries.length); // open the one just added
    };

    private _duplicate(index: number)
    {
        const entries = this._entries();
        const copy = { ...entries[index] };
        this._dispatch([...entries.slice(0, index + 1), copy, ...entries.slice(index + 1)]);
        this._select(index + 1);
    }

    private _removeAt(index: number)
    {
        this._confirmingDelete = null;
        const entries = this._entries();
        this._dispatch(entries.filter((_e, i) => i !== index));

        // Keep the expansion pointing at the same entry, not at a shifted neighbour.
        const selected = this._selectedIndex();
        if (selected === index)                        this._select(null);
        else if (selected !== null && selected > index) this._select(selected - 1);
    }

    private _setEntryProperty(index: number, key: string, value: any)
    {
        this._dispatch(this._entries().map((e, i) => (i === index ? { ...e, [key]: value } : e)));
    }

    /** Always a FRESH array of entries — never an in-place edit. A saved preset
     *  holds the very same array reference (saveAsPreset stores param.toData()),
     *  so mutating it here would silently rewrite that preset too. */
    private _dispatch(value: Array<Record<string, any>>)
    {
        this._pending = value;
        this.dispatchEvent(new CustomEvent('param-value-change', {
            detail:   { name: this.param.name, value },
            bubbles:  true,
            composed: true,
        }));
        // Show the change now, whether or not the owner hands a new `value` back
        this.requestUpdate();
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: block; width: 100%; }

        *,
        *::before,
        *::after { box-sizing: border-box; }

        .wrap
        {
            display:        flex;
            flex-direction: column;
            gap:            var(--space-xs, 4px);
            width:          100%;
        }

        /* In the editor the entries sit indented under the param's name line */
        :host([mode="compact"]) .wrap { padding-left: calc(2 * var(--space-lg, 16px)); }

        /* No max-height here: an expanded entry's form would be cut off with no way to
           reach the rest of it. The param menu is the one scroll container (.param-list),
           so this list simply grows and the menu takes care of it. */
        .entries
        {
            display:        flex;
            flex-direction: column;
            gap:            2px;
        }

        .entry
        {
            /* Without this, opening one entry's form makes flex steal height from its
               collapsed siblings and their labels start to squash. */
            flex-shrink:   0;
            border:        1px solid var(--color-border);
            border-radius: var(--radius-sm, 4px);
            background:    var(--color-bg-elevated);
            overflow:      hidden;
        }

        .entry.open { border-color: var(--color-primary, var(--color-gray-dark)); }

        .entry-head
        {
            display:     flex;
            flex-shrink: 0;
            align-items: center;
            gap:         var(--space-xs, 4px);
            padding:     3px 5px;
            cursor:      pointer;
            user-select: none;
        }

        .entry-head:hover
        {
            background: color-mix(in srgb, var(--color-border) 25%, transparent);
        }

        .entry-caret
        {
            flex-shrink: 0;
            font-size:   10px;
            color:       var(--color-text-muted);
        }

        .entry-label
        {
            overflow:      hidden;
            text-overflow: ellipsis;
            white-space:   nowrap;
            font-family:   var(--font-sans);
            font-size:     var(--text-xs);
            color:         var(--color-text);
        }

        .entry-spacer { flex: 1; }

        .entry-btn
        {
            flex-shrink:     0;
            display:         inline-flex;
            align-items:     center;
            justify-content: center;
            width:           20px;
            height:          20px;
            padding:         0;
            border:          none;
            background:      transparent;
            cursor:          pointer;
            border-radius:   var(--radius-sm, 3px);
            color:           var(--color-text-muted);
            font-size:       10px;
            opacity:         0;
            transition:      opacity 0.1s;
        }

        .entry-head:hover .entry-btn,
        .entry-btn.confirm { opacity: 0.7; }
        .entry-btn:hover { opacity: 1; background: color-mix(in srgb, var(--color-border) 40%, transparent); }
        .entry-btn.danger:hover { color: var(--color-alert); }

        .confirm-label
        {
            font-family: var(--font-sans);
            font-size:   var(--text-xs);
            color:       var(--color-alert);
        }

        /* The form brings its own padding; the extra inset here existed to hold it off its
           old border, which is gone. */
        param-object-form { padding: 0; }

        .empty
        {
            font-family: var(--font-sans);
            font-size:   var(--text-xs);
            color:       var(--color-text-gray, var(--color-text-muted));
            padding:     2px 0;
        }

        .add-btn
        {
            display:         inline-flex;
            align-items:     center;
            justify-content: center;
            gap:             4px;
            align-self:      flex-start;
            padding:         3px 8px;
            border:          1px solid var(--color-border);
            border-radius:   var(--radius-sm, 4px);
            background:      transparent;
            cursor:          pointer;
            font-family:     var(--font-sans);
            font-size:       var(--text-xs);
            color:           var(--color-text-muted);
        }

        .add-btn:hover
        {
            border-color: var(--color-primary, var(--color-gray-dark));
            color:        var(--color-text);
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-item-object-list': ParamItemObjectList;
    }
}
