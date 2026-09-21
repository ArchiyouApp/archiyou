import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { ScriptParam, scriptParams } from '@archiyou/editor/src/state/workspace';
import { paramMin, paramMax, paramStep, paramMinLength, paramMaxLength, paramOptions, paramListItemType } from '@archiyou/editor/src/state/workspace';
import type { ScriptParamData, ScriptParamType } from '@archiyou/editor/src/state/workspace';
import { OVERLAY_MENU_WIDTH, OVERLAY_MENU_HEIGHT, PARAM_DESCRIPTION_MAX_LENGTH } from '@archiyou/editor/src/settings';

type ParamType = 'number' | 'boolean' | 'text' | 'options' | 'list';

const PARAM_TYPES: ParamType[] = ['number', 'boolean', 'text', 'options', 'list'];

const TYPE_ICONS: Record<ParamType, string> = {
    number:  'hash',
    boolean: 'toggle-right',
    text:    'type',
    options: 'circle-dot',
    list:    'list',
};



@customElement('param-define-menu')
export class ParamDefineMenu extends SignalWatcher(LitElement)
{
    // ── 1. Render ──

    override render()
    {
        if (!this.open) return html``;

        // Groups the host knows about (incl. empty tabs the user just created)
        // come in via `groups`; union them with the ones actually in use so the
        // list is complete no matter which route created the group.
        const groups = [...new Set([
            'main',
            ...this.groups,
            ...scriptParams.get().map(p => p.group ?? 'main'),
            ...(this._group ? [this._group] : []),
        ])];

        return html`
            <div class="backdrop" @click=${this._cancel}></div>
            <div class="dialog" role="dialog" aria-modal="true"
                 @click=${(e: Event) => e.stopPropagation()}>

                <div class="dialog-header">
                    <wa-icon library="lucide" name="sliders-horizontal"></wa-icon>
                    <span>${this.editParam ? 'Edit Parameter' : 'Add Parameter'}</span>
                    <button class="close-btn" @click=${this._cancel}>
                        <wa-icon library="lucide" name="x"></wa-icon>
                    </button>
                </div>

                <div class="dialog-body">

                    <!-- Type selector -->
                    <div class="field">
                        <span class="field-label">Type</span>
                        <div class="type-selector">
                            ${PARAM_TYPES.map(t => html`
                                <button
                                    class="type-btn ${this._type === t ? 'active' : ''}"
                                    title=${t}
                                    @click=${() => this._setType(t)}
                                >
                                    <wa-icon library="lucide" name=${TYPE_ICONS[t]}></wa-icon>
                                    <span>${t}</span>
                                </button>
                            `)}
                        </div>
                    </div>

                    <!-- Name -->
                    <label class="field">
                        <span class="field-label">Name</span>
                        <input
                            class="text-input ${this._nameError ? 'input-error' : ''}"
                            type="text"
                            .value=${this._name}
                            placeholder="e.g. Height"
                            @input=${(e: InputEvent) =>
                            {
                                const input = e.target as HTMLInputElement;
                                const upper = input.value.toUpperCase();
                                if (input.value !== upper)
                                {
                                    const sel = input.selectionStart;
                                    input.value = upper;
                                    input.setSelectionRange(sel, sel);
                                }
                                this._name      = upper;
                                this._nameError = '';
                            }}
                        />
                        ${this._nameError
                            ? html`<span class="name-error">${this._nameError}</span>`
                            : this._name.trim()
                                ? html`<span class="var-preview">$${this._name.trim().toUpperCase()}</span>`
                                : nothing
                        }
                    </label>

                    <!-- Type-specific fields -->
                    ${this._renderTypeFields()}

                    <!-- Description -->
                    <label class="field">
                        <span class="field-label">Description <span class="hint">(optional)</span></span>
                        <input
                            class="text-input"
                            type="text"
                            .value=${this._description}
                            placeholder="Short description of this parameter"
                            maxlength=${PARAM_DESCRIPTION_MAX_LENGTH}
                            @input=${(e: InputEvent) =>
                                (this._description = (e.target as HTMLInputElement).value)}
                        />
                    </label>

                    <!-- Group -->
                    <label class="field">
                        <span class="field-label">Group</span>
                        ${this._newGroupMode
                            ? html`
                                <div class="group-new-row">
                                    <input
                                        class="text-input"
                                        type="text"
                                        .value=${this._newGroupName}
                                        placeholder="New group name"
                                        @input=${(e: InputEvent) =>
                                            (this._newGroupName = (e.target as HTMLInputElement).value)}
                                    />
                                    <button class="link-btn"
                                        @click=${() => { this._newGroupMode = false; this._newGroupName = ''; }}>
                                        Cancel
                                    </button>
                                </div>`
                            : html`
                                <select class="select-input" .value=${this._group} @change=${this._onGroupChange}>
                                    ${groups.map(g => html`
                                        <option value=${g} ?selected=${this._group === g}>${g}</option>
                                    `)}
                                    <option value="__new__">+ New group…</option>
                                </select>`
                        }
                    </label>

                </div>

                <div class="dialog-footer">
                    <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
                    <button class="btn-primary" @click=${this._confirm}
                        ?disabled=${!this._name.trim() || (this._type === 'options' && this._options.length === 0)}>
                        ${this.editParam ? 'Save' : 'Add'}
                    </button>
                </div>
            </div>
        `;
    }

    private _renderTypeFields()
    {
        switch (this._type)
        {
            case 'number':
                return html`
                    <div class="field-row">
                        <label class="field field-inline">
                            <span class="field-label">Default</span>
                            <input class="text-input short" type="number"
                                .value=${this._defaultNum}
                                @input=${(e: InputEvent) =>
                                    (this._defaultNum = (e.target as HTMLInputElement).value)}
                            />
                        </label>
                        <label class="field field-inline">
                            <span class="field-label">Min</span>
                            <input class="text-input short" type="number"
                                .value=${this._min}
                                @input=${(e: InputEvent) =>
                                    (this._min = (e.target as HTMLInputElement).value)}
                            />
                        </label>
                        <label class="field field-inline">
                            <span class="field-label">Max</span>
                            <input class="text-input short" type="number"
                                .value=${this._max}
                                @input=${(e: InputEvent) =>
                                    (this._max = (e.target as HTMLInputElement).value)}
                            />
                        </label>
                        <label class="field field-inline">
                            <span class="field-label">Step</span>
                            <input class="text-input short" type="number"
                                .value=${this._step}
                                @input=${(e: InputEvent) =>
                                    (this._step = (e.target as HTMLInputElement).value)}
                            />
                        </label>
                    </div>
                `;

            case 'boolean':
                return html`
                    <div class="field">
                        <span class="field-label">Default</span>
                        <label class="toggle-row">
                            <input type="checkbox"
                                .checked=${this._defaultBool}
                                @change=${(e: Event) =>
                                    (this._defaultBool = (e.target as HTMLInputElement).checked)}
                            />
                            <span class="toggle-label">${this._defaultBool ? 'true' : 'false'}</span>
                        </label>
                    </div>
                `;

            case 'text':
                return html`
                    <label class="field">
                        <span class="field-label">Default</span>
                        <input class="text-input" type="text"
                            .value=${this._defaultText}
                            placeholder="Default text value"
                            @input=${(e: InputEvent) =>
                                (this._defaultText = (e.target as HTMLInputElement).value)}
                        />
                    </label>
                    <div class="field-row">
                        <label class="field field-inline">
                            <span class="field-label">Min length</span>
                            <input class="text-input short" type="number" min="0"
                                .value=${this._minLength}
                                @input=${(e: InputEvent) =>
                                    (this._minLength = (e.target as HTMLInputElement).value)}
                            />
                        </label>
                        <label class="field field-inline">
                            <span class="field-label">Max length</span>
                            <input class="text-input short" type="number" min="0"
                                .value=${this._maxLength}
                                @input=${(e: InputEvent) =>
                                    (this._maxLength = (e.target as HTMLInputElement).value)}
                            />
                        </label>
                    </div>
                `;

            case 'options':
                return html`
                    <div class="field">
                        <span class="field-label">Options</span>
                        ${this._options.length > 0 ? html`
                            <div class="chips-row">
                                ${this._options.map(opt => html`
                                    <span class="chip">
                                        ${opt}
                                        <button class="chip-remove" title="Remove"
                                            @click=${() => this._removeOption(opt)}>
                                            <wa-icon library="lucide" name="x"></wa-icon>
                                        </button>
                                    </span>
                                `)}
                            </div>` : nothing}
                        <div class="option-add-row">
                            <input class="text-input" type="text"
                                .value=${this._optionDraft}
                                placeholder="Add option value…"
                                @input=${(e: InputEvent) =>
                                    (this._optionDraft = (e.target as HTMLInputElement).value)}
                                @keydown=${this._onOptionKeydown}
                            />
                            <button class="btn-add-option" title="Add" @click=${this._addOption}
                                ?disabled=${!this._optionDraft.trim()}>
                                <wa-icon library="lucide" name="plus"></wa-icon>
                            </button>
                        </div>
                    </div>
                    ${this._options.length > 0 ? html`
                        <label class="field">
                            <span class="field-label">Default</span>
                            <select class="select-input"
                                @change=${(e: Event) =>
                                    (this._defaultOption = (e.target as HTMLSelectElement).value)}>
                                ${this._options.map(opt => html`
                                    <option value=${opt} ?selected=${this._defaultOption === opt}>${opt}</option>
                                `)}
                            </select>
                        </label>
                    ` : nothing}
                `;

            case 'list':
                return html`
                    <div class="field">
                        <span class="field-label">Item type</span>
                        <div class="type-selector type-selector--sm">
                            ${(['string', 'number', 'boolean'] as const).map(t => html`
                                <button
                                    class="type-btn ${this._listItemType === t ? 'active' : ''}"
                                    @click=${() => { this._listItemType = t; this._defaultItems = ''; }}
                                >${t}</button>
                            `)}
                        </div>
                    </div>
                    <label class="field">
                        <span class="field-label">
                            Default items
                            <span class="hint"> — comma-separated</span>
                        </span>
                        <input class="text-input" type="text"
                            .value=${this._defaultItems}
                            placeholder=${this._listItemType === 'number'
                                ? '0, 10, 20'
                                : this._listItemType === 'boolean'
                                    ? 'true, false'
                                    : 'a, b, c'}
                            @input=${(e: InputEvent) =>
                                (this._defaultItems = (e.target as HTMLInputElement).value)}
                        />
                    </label>
                `;

            default:
                return nothing;
        }
    }

    // ── 2. State & Properties ──

    @property({ attribute: false }) editParam: ScriptParam | null = null;
    @property({ type: Boolean, reflect: true }) open = false;
    /** All groups known to the host (incl. groups without params yet). */
    @property({ attribute: false }) groups: string[] = [];
    /** Group preselected when adding a new param (the host's active tab). */
    @property({ attribute: false }) defaultGroup = 'main';

    @state() private _type:           ParamType = 'number';
    @state() private _name            = '';
    @state() private _nameError       = '';
    @state() private _description     = '';
    @state() private _group           = 'main';
    @state() private _newGroupMode    = false;
    @state() private _newGroupName    = '';
    // number
    @state() private _defaultNum      = '';
    @state() private _min             = '';
    @state() private _max             = '';
    @state() private _step            = '';
    // boolean
    @state() private _defaultBool     = false;
    // text
    @state() private _defaultText     = '';
    @state() private _minLength       = '';
    @state() private _maxLength       = '';
    // options
    @state() private _options:        string[] = [];
    @state() private _optionDraft     = '';
    @state() private _defaultOption   = '';
    // list
    @state() private _listItemType:   'string' | 'number' | 'boolean' = 'string';
    @state() private _defaultItems    = '';

    // ── 3. Lifecycle ──

    override updated(changed: Map<string, unknown>)
    {
        if (changed.has('open') && this.open)
        {
            this._resetForm();
        }
    }

    // ── 4. Behaviour ──

    private _setType(t: ParamType)
    {
        this._type = t;
        this._applySchemaDefaults(t);
    }

    private _applySchemaDefaults(t: ParamType)
    {
        const p = ScriptParam.fromType(t as ScriptParamType);
        const s = p.schema as any;

        switch (t)
        {
            case 'number':
                this._defaultNum  = String(p.default      ?? s.default      ?? 0);
                this._min         = String(s.minimum       ?? 0);
                this._max         = String(s.maximum       ?? 100);
                this._step        = String(s.multipleOf    ?? 1);
                break;
            case 'boolean':
                this._defaultBool = p.default ?? false;
                break;
            case 'text':
                this._defaultText = p.default   ?? '';
                this._minLength   = String(s.minLength ?? 0);
                this._maxLength   = String(s.maxLength !== undefined ? s.maxLength : 256);
                break;
            case 'options':
                this._options       = [...(s.enum ?? [])];
                this._defaultOption = p.default ?? '';
                this._optionDraft   = '';
                break;
            case 'list':
                this._listItemType = ((s.items?.type) ?? 'string') as 'string' | 'number' | 'boolean';
                this._defaultItems = '';
                break;
        }
    }

    private _resetForm()
    {
        const p = this.editParam;

        this._type         = (p?.type as ParamType) ?? 'number';
        this._name         = p?.name ?? '';
        this._nameError    = '';
        this._description  = (p as any)?.description ?? '';
        this._group        = p?.group ?? this.defaultGroup ?? 'main';
        this._newGroupMode = false;
        this._newGroupName = '';

        if (p)
        {
            switch (this._type)
            {
                case 'number':
                    this._defaultNum = p.default?.toString()       ?? '';
                    this._min        = paramMin(p).toString();
                    this._max        = paramMax(p).toString();
                    this._step       = paramStep(p).toString();
                    break;
                case 'boolean':
                    this._defaultBool = p.default ?? false;
                    break;
                case 'text':
                    this._defaultText = p.default ?? '';
                    this._minLength   = paramMinLength(p).toString();
                    this._maxLength   = paramMaxLength(p)?.toString() ?? '';
                    break;
                case 'options':
                    this._options       = paramOptions(p).map(String);
                    this._defaultOption = p.default ?? '';
                    this._optionDraft   = '';
                    break;
                case 'list':
                    this._listItemType = paramListItemType(p);
                    this._defaultItems = Array.isArray(p.default)
                        ? p.default.join(', ')
                        : '';
                    break;
            }
        }
        else
        {
            this._applySchemaDefaults(this._type);
        }
    }

    private _addOption()
    {
        const v = this._optionDraft.trim();
        if (!v || this._options.includes(v)) return;
        this._options       = [...this._options, v];
        this._optionDraft   = '';
        if (!this._defaultOption) this._defaultOption = v;
    }

    private _removeOption(opt: string)
    {
        this._options = this._options.filter(o => o !== opt);
        if (this._defaultOption === opt)
        {
            this._defaultOption = this._options[0] ?? '';
        }
    }

    private _onOptionKeydown(e: KeyboardEvent)
    {
        if (e.key === 'Enter') { e.preventDefault(); this._addOption(); }
    }

    private _onGroupChange(e: Event)
    {
        const v = (e.target as HTMLSelectElement).value;
        if (v === '__new__')
        {
            this._newGroupMode = true;
            this._newGroupName = '';
        }
        else
        {
            this._group = v;
        }
    }

    private _confirm()
    {
        const name = this._name.trim();
        if (!name) return;

        const duplicate = scriptParams.get().some(
            p => p.name.toLowerCase() === name.toLowerCase() && p.name !== this.editParam?.name
        );
        if (duplicate)
        {
            this._nameError = `"${name}" is already used`;
            return;
        }

        const resolvedGroup = this._newGroupMode
            ? (this._newGroupName.trim() || 'main')
            : this._group;

        // Build a canonical ScriptParam from form state
        const base = this.editParam
            ? ScriptParam.fromData({ ...this.editParam.toData(), type: this._type } as any)
            : ScriptParam.fromType(this._type as ScriptParamType);

        base.name        = name.toUpperCase();
        base.description = this._description.trim() || undefined;
        base.group       = resolvedGroup;

        this._applyFormToSchema(base);

        this.dispatchEvent(new CustomEvent<ScriptParamData>('param-define', {
            detail:   base.toData(),
            bubbles:  true,
            composed: true,
        }));
    }

    private _applyFormToSchema(p: ScriptParam): void
    {
        const s = p.schema as any;

        switch (this._type)
        {
            case 'number':
                p.default      = this._defaultNum !== '' ? Number(this._defaultNum) : p.default;
                s.default      = p.default;
                s.minimum      = this._min   !== '' ? Number(this._min)   : s.minimum;
                s.maximum      = this._max   !== '' ? Number(this._max)   : s.maximum;
                s.multipleOf   = this._step  !== '' ? Number(this._step)  : s.multipleOf;
                break;

            case 'boolean':
                p.default = this._defaultBool;
                s.default = this._defaultBool;
                break;

            case 'text':
                p.default  = this._defaultText !== '' ? this._defaultText : p.default;
                s.default  = p.default;
                s.minLength = this._minLength !== '' ? Number(this._minLength) : s.minLength;
                s.maxLength = this._maxLength !== '' ? Number(this._maxLength) : s.maxLength;
                break;

            case 'options':
            {
                const allNumeric = this._options.length > 0
                    && this._options.every(o => o.trim() !== '' && Number.isFinite(Number(o)));

                s.enum    = allNumeric ? this._options.map(Number) : this._options;
                s.type    = allNumeric ? 'number' : 'string';
                p.default = allNumeric
                    ? Number(this._defaultOption || this._options[0])
                    : (this._defaultOption || this._options[0]);
                s.default = p.default;
                break;
            }

            case 'list':
            {
                s.items = { type: this._listItemType };
                const raw    = this._defaultItems.split(',').map(v => v.trim()).filter(Boolean);
                const parsed = this._listItemType === 'number'
                    ? raw.map(Number)
                    : this._listItemType === 'boolean'
                        ? raw.map(v => v.toLowerCase() === 'true')
                        : raw;
                p.default = parsed.length > 0 ? parsed : p.default;
                s.default = p.default;
                break;
            }
        }
    }

    private _cancel()
    {
        this.dispatchEvent(new CustomEvent('param-define-cancel', {
            bubbles:  true,
            composed: true,
        }));
    }

    // ── 5. Styles ──

    static override styles = css`
        :host { display: contents; }

        .backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.4);
            z-index: 200;
        }

        .dialog {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 201;
            width: ${unsafeCSS(OVERLAY_MENU_WIDTH)};
            max-width: calc(100vw - 32px);
            /* Fixed floor so the dialog does not jump in height when switching
               type (boolean/text forms are much shorter than number); it may
               grow past it for tall forms. Only viewports too short for the
               form still scroll. */
            min-height: ${unsafeCSS(OVERLAY_MENU_HEIGHT)};
            max-height: calc(100vh - 32px);
            background: var(--color-bg-elevated, #fff);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-lg, 12px);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
            display: flex;
            flex-direction: column;
            font-family: var(--font-sans);
            overflow: hidden;
        }

        /* ── Header ── */

        .dialog-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            border-bottom: 1px solid var(--color-border);
            font-weight: 500;
            font-size: var(--text-sm);
            color: var(--color-text);
            flex-shrink: 0;
        }

        .close-btn {
            margin-left: auto;
            width: 24px;
            height: 24px;
            border: none;
            background: transparent;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--color-gray-dark, #666);
            border-radius: var(--radius-sm, 4px);
        }

        .close-btn:hover {
            background: color-mix(in srgb, var(--color-border) 40%, transparent);
        }

        /* ── Body ── */

        .dialog-body {
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            overflow-y: auto;
            flex: 1;
        }

        /* ── Fields ── */

        .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .field-inline {
            flex-direction: row;
            align-items: center;
        }

        /* Right-align so a short label (MIN, MAX, STEP) ends up against its input
           instead of stranded at the left edge of the 72px column. */
        .field-inline .field-label { min-width: 72px; text-align: right; }

        .field-label {
            font-size: var(--text-xs);
            font-weight: 500;
            color: var(--color-gray-dark, #666);
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        .field-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .hint {
            font-weight: 400;
            text-transform: none;
            letter-spacing: 0;
            opacity: 0.7;
        }

        .text-input,
        .select-input {
            font-family: var(--font-sans);
            font-size: var(--text-sm);
            color: var(--color-text);
            background: var(--color-bg, #fff);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm, 4px);
            padding: 6px 8px;
            outline: none;
            width: 100%;
            box-sizing: border-box;
        }

        .text-input:focus,
        .select-input:focus { border-color: var(--color-primary); }

        .text-input.input-error { border-color: var(--color-alert, #ef4444); }

        .text-input.short { width: 80px; }

        .name-error {
            font-size: var(--text-xs);
            color: var(--color-alert, #ef4444);
        }

        .var-preview {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: var(--text-xs);
            font-family: var(--font-mono, monospace);
            color: var(--color-gray-dark, #666);
            opacity: 0.7;
        }

        /* ── Type selector ── */

        .type-selector {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .type-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-full, 999px);
            background: transparent;
            font-family: var(--font-sans);
            font-size: var(--text-xs);
            font-weight: 500;
            color: var(--color-gray-dark, #555);
            cursor: pointer;
            transition: background 0.1s, border-color 0.1s, color 0.1s;
        }

        .type-btn:hover {
            border-color: var(--color-primary);
            color: var(--color-primary);
        }

        .type-btn.active {
            background: color-mix(in srgb, var(--color-primary) 12%, transparent);
            border-color: var(--color-primary);
            color: var(--color-primary);
        }

        .type-selector--sm .type-btn {
            padding: 3px 8px;
            font-size: var(--text-xs);
        }

        .type-selector--sm .type-btn wa-icon { display: none; }

        /* ── Boolean ── */

        .toggle-row {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
        }

        .toggle-label {
            font-size: var(--text-sm);
            font-family: var(--font-mono, monospace);
            color: var(--color-text);
        }

        /* ── Options chips ── */

        .chips-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 4px;
        }

        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px 2px 8px;
            background: color-mix(in srgb, var(--color-primary) 10%, transparent);
            border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
            border-radius: var(--radius-full, 999px);
            font-size: var(--text-xs);
            color: var(--color-primary);
            font-weight: 500;
        }

        .chip-remove {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: var(--color-primary);
            padding: 0;
            border-radius: 50%;
            font-size: 9px;
        }

        .chip-remove:hover {
            background: color-mix(in srgb, var(--color-primary) 20%, transparent);
        }

        .option-add-row {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .btn-add-option {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm, 4px);
            background: transparent;
            cursor: pointer;
            color: var(--color-primary);
        }

        .btn-add-option:hover:not(:disabled) {
            background: color-mix(in srgb, var(--color-primary) 10%, transparent);
            border-color: var(--color-primary);
        }

        .btn-add-option:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── Group ── */

        .group-new-row {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .link-btn {
            border: none;
            background: transparent;
            color: var(--color-primary);
            font-size: var(--text-xs);
            cursor: pointer;
            padding: 0;
            text-decoration: underline;
            white-space: nowrap;
        }

        /* ── Footer ── */

        .dialog-footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 12px 16px;
            border-top: 1px solid var(--color-border);
            flex-shrink: 0;
        }

        .btn-primary,
        .btn-secondary {
            padding: 7px 16px;
            border-radius: var(--radius-sm, 4px);
            font-family: var(--font-sans);
            font-size: var(--text-sm);
            font-weight: 500;
            cursor: pointer;
            border: none;
        }

        .btn-primary {
            background: var(--color-primary);
            color: var(--color-white, #fff);
        }

        .btn-primary:hover:not(:disabled) { opacity: 0.88; }
        .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

        .btn-secondary {
            background: transparent;
            color: var(--color-text);
            border: 1px solid var(--color-border);
        }

        .btn-secondary:hover {
            background: color-mix(in srgb, var(--color-border) 30%, transparent);
        }
    `;
}

declare global
{
    interface HTMLElementTagNameMap
    {
        'param-define-menu': ParamDefineMenu;
    }
}
