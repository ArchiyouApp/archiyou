import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import './param-help.js';

import type { ScriptParam } from '@archiyou/editor/src/state/workspace';
import { toVariableName, isProgrammatic } from '@archiyou/editor/src/state/workspace';
import { paramLabelKey, paramDescriptionKey } from '@archiyou/core/src/i18n/keys';
import type { TranslatorFn } from '@archiyou/core/src/i18n/resolve';

/** UI density of a parameter row.
 *  - `compact`      — the editor's authoring row: one dense line, grip + inline
 *                     edit/delete actions.
 *  - `presentation` — the configurator's end-user row: taller, no authoring
 *                     affordances, friendly label with a "?" description hint. */
export type ParamUIMode = 'compact' | 'presentation';

@customElement('param-item')
export class ParamItem extends LitElement
{
  @property({ attribute: false }) param!: ScriptParam;
  @property({ type: Boolean, reflect: true }) readonly = false;
  /** Set by the param menu from a dynamic enableIf() behaviour. Reflected so CSS
   *  (:host([disabled])) can dim the row and block interaction with the control. */
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Reflected so the presentation layout can be selected purely in CSS. */
  @property({ type: String, reflect: true }) mode: ParamUIMode = 'compact';
  /** Set when the slotted control draws its own label row (the number control in
   *  presentation mode puts label and value box on one line above its slider). */
  @property({ type: Boolean }) hideLabel = false;
  /** Tall row: name + actions on their own header line, control full-width below.
   *  For controls that cannot live on one dense line — an object list with an
   *  expanded entry form. A boolean rather than a third `mode`, because `mode` is
   *  a density/audience axis that all five leaf controls branch on. */
  @property({ type: Boolean, reflect: true }) block = false;
  /** Content translator, supplied by the configurator. Defaults to the identity, so the
   *  EDITOR's authoring rows are a compile-time no-op — this component is shared between
   *  both, and importing configurator locale state here would couple them. */
  @property({ attribute: false }) t: TranslatorFn = (_key, fallback) => fallback;

  @state() private _editingLabel = false;
  @state() private _labelDraft = '';
  @state() private _confirmingDelete = false;

  private _dragLocked = false;

  // ── Render ──

  override render()
  {
    return this.mode === 'presentation'
      ? this._renderPresentation()
      : this._renderCompact();
  }

  /** End-user row: "? LABEL" above a full-width control. When `hideLabel` is set
   *  the control supplies its own label row and we only host the control. */
  private _renderPresentation()
  {
    // Presentation mode only: the end-user's view is the one that gets translated.
    // _renderCompact() (the authoring row) is deliberately untouched — the author must
    // always see, and edit, their own source strings.
    const name = this.param?.name ?? '';
    const label = this.t(paramLabelKey(name), this.param?.label || name || '');
    const description = this.t(paramDescriptionKey(name), this.param?.description ?? '');

    return html`
      ${this.hideLabel ? nothing : html`
        <div class="pres-label-row">
          <span class="pres-label" title=${description}>${label}</span>
          <param-help .text=${description}></param-help>
        </div>`}
      <div class="pres-slot"><slot></slot></div>
    `;
  }

  private _renderCompact()
  {
    const programmatic = isProgrammatic(this.param);

    return html`
      <div class="compact-head">
      <span class="grip" title="Drag to reorder" @pointerdown=${this._onGripPointerDown}>
        <wa-icon library="lucide" name="grip-horizontal"></wa-icon>
      </span>

      ${this._editingLabel
        ? html`
            <input
              class="label-input"
              .value=${this._labelDraft}
              @blur=${this._commitLabel}
              @keydown=${this._onLabelKeydown}
            />`
        : html`
            <span class="label"
              @dblclick=${programmatic ? undefined : this._startEditLabel}
              title=${programmatic
                ? `defined in script — use $${toVariableName(this.param.name).toUpperCase()}`
                : `use in your script with $${toVariableName(this.param.name).toUpperCase()}`}>
              ${this.param.name}
            </span>`
      }

      <span class="actions">
        ${programmatic
          ? html`
              <span class="script-lock"
                  title="Defined in script — value is editable, definition is locked">
                <wa-icon library="lucide" name="lock"></wa-icon>
              </span>`
          : this._confirmingDelete
            ? html`
                <span class="confirm-delete">
                  <span class="confirm-label">Delete?</span>
                  <button class="action-btn confirm-yes" title="Confirm delete"
                      @click=${this._confirmDelete}>
                    <wa-icon library="lucide" name="check"></wa-icon>
                  </button>
                  <button class="action-btn confirm-no" title="Cancel"
                      @click=${this._cancelDelete}>
                    <wa-icon library="lucide" name="x"></wa-icon>
                  </button>
                </span>`
            : html`
                <button class="action-btn" title="Edit" @click=${this._handleEdit}>
                  <wa-icon library="lucide" name="pen"></wa-icon>
                </button>
                <button class="action-btn danger" title="Delete"
                    @click=${this._handleDelete}>
                  <wa-icon library="lucide" name="trash-2"></wa-icon>
                </button>`
        }
      </span>
      </div>

      <span class="param-slot"
        @pointerdown=${this._onSlotPointerDown}
        @pointerup=${this._onSlotPointerUp}
        @pointercancel=${this._onSlotPointerUp}
      >
        <slot></slot>
      </span>
    `;
  }

  // ── Lifecycle ──

  override connectedCallback()
  {
    super.connectedCallback();
    if (!this.readonly && this.mode !== 'presentation')
    {
      this.setAttribute('draggable', 'true');
      this.addEventListener('dragstart', this._onDragStart);
      this.addEventListener('dragend', this._onDragEnd);
    }
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    this.removeEventListener('dragstart', this._onDragStart);
    this.removeEventListener('dragend', this._onDragEnd);
  }

  // ── Drag ──

  private _onDragStart = (e: DragEvent) =>
  {
    if (this._dragLocked) { e.preventDefault(); return; }
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', this.param.name);
    this.setAttribute('dragging', '');
    this._confirmingDelete = false;
  };

  private _onDragEnd = () => this.removeAttribute('dragging');

  private _onSlotPointerDown = () => { this._dragLocked = true; };
  private _onSlotPointerUp   = () => { this._dragLocked = false; };

  /** A pointerup that lands outside the slot (a text selection dragged out of an
   *  input) never clears the lock, so releasing it here keeps the grip usable. */
  private _onGripPointerDown = () => { this._dragLocked = false; };

  // ── Label editing ──

  private _startEditLabel()
  {
    this._labelDraft = this.param.name;
    this._editingLabel = true;
    this.updateComplete.then(() =>
    {
      this.renderRoot.querySelector<HTMLInputElement>('.label-input')?.focus();
    });
  }

  private _commitLabel()
  {
    this._editingLabel = false;
    const trimmed = this._labelDraft.trim().toUpperCase();
    if (trimmed && trimmed !== this.param.name)
    {
      this.dispatchEvent(new CustomEvent<{ oldName: string; name: string }>('param-rename', {
        detail: { oldName: this.param.name, name: trimmed },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private _onLabelKeydown(e: KeyboardEvent)
  {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') this._editingLabel = false;
    this._labelDraft = (e.target as HTMLInputElement).value.toUpperCase();
  }

  // ── Actions ──

  private _handleEdit()
  {
    this.dispatchEvent(new CustomEvent<ScriptParam>('param-edit', {
      detail: this.param,
      bubbles: true,
      composed: true,
    }));
  }

  private _handleDelete()
  {
    this._confirmingDelete = true;
  }

  private _confirmDelete()
  {
    this.dispatchEvent(new CustomEvent<string>('param-delete', {
      detail: this.param.name,
      bubbles: true,
      composed: true,
    }));
  }

  private _cancelDelete()
  {
    this._confirmingDelete = false;
  }

  // ── Styles ──

  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 6px;
      padding-left: var(--space-lg);
      padding-right: var(--space-lg);
      height: var(--space2xl);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      border-bottom: 1px solid var(--color-border);
      background: var(--color-bg-elevated);
      cursor: default;
      user-select: none;
      position: relative;
    }

    :host(:hover) {
      background: color-mix(in srgb, var(--color-border) 20%, transparent);
    }

    :host([dragging]) { opacity: 0.4; }

    /* Non-block: the head dissolves so grip/label/actions are flex items of the
       host, exactly as before. The order property puts the control back between
       label and actions, which is where it sits in the dense authoring row. */
    .compact-head { display: contents; }
    .actions { order: 1; }

    :host([block]) {
      display: block;
      height: auto;
      padding-top: var(--space-sm);
      padding-bottom: var(--space-sm);
    }

    :host([block]) .compact-head {
      display: flex;
      align-items: center;
      gap: 6px;
      height: var(--space2xl);
    }

    :host([block]) .label { flex: 1; }
    :host([block]) .param-slot { display: block; width: 100%; }

    :host([readonly]) .grip { display: none; }
    :host([readonly]) .actions { display: none; }
    :host([readonly]) .label { pointer-events: none; }

    /* Disabled by a dynamic enableIf() behaviour: dim the row and block the control. */
    :host([disabled]) .label { opacity: 0.5; }
    :host([disabled]) .param-slot { opacity: 0.45; pointer-events: none; }

    .grip {
      flex-shrink: 0;
      color: var(--color-gray-dark, #666);
      opacity: 0.35;
      cursor: grab;
      display: flex;
      align-items: center;
      font-size: 11px;
    }

    .grip:hover { opacity: 0.8; }

    .label {
      flex: 0 1 auto;
      color: var(--color-gray-dark, #555);
      font-size: var(--text-sm);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .label-input {
      flex: 1;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
      background: var(--color-bg, #fff);
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-sm, 4px);
      padding: 1px 4px;
      min-width: 0;
      outline: none;
    }

    .param-slot {
      flex: 1;
      min-width: 60px;
      display: flex;
      align-items: center;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.1s;
    }

    :host(:hover) .actions { opacity: 1; }
    :host .actions:has(.confirm-delete) { opacity: 1; }
    /* The script-lock badge is always visible (no edit/delete to reveal). */
    :host .actions:has(.script-lock) { opacity: 0.6; }
    :host(:hover) .actions:has(.script-lock) { opacity: 1; }

    .script-lock {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      color: var(--color-gray-dark, #666);
      font-size: 11px;
    }

    .action-btn {
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-gray-dark, #666);
      border-radius: var(--radius-sm, 4px);
      font-size: 11px;
    }

    .action-btn:hover {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
    }

    .action-btn.danger:hover { color: var(--color-alert); }

    /* ── Inline delete confirmation ── */

    .confirm-delete {
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .confirm-label {
      font-size: var(--text-xs);
      color: var(--color-alert, #ef4444);
      font-weight: 500;
      white-space: nowrap;
    }

    .confirm-yes {
      color: var(--color-alert, #ef4444);
    }

    .confirm-yes:hover {
      background: color-mix(in srgb, var(--color-alert, #ef4444) 15%, transparent);
    }

    .confirm-no:hover {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
    }

    /* ── Presentation mode (configurator) ──
       Taller row, no authoring affordances, label above a full-width control. */

    :host([mode="presentation"]) {
      display: block;
      height: auto;
      padding: var(--space-sm) var(--space-lg);
    }

    :host([mode="presentation"]:hover) { background: var(--color-bg-elevated); }

    .pres-label-row {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      min-height: 18px;
      margin-bottom: 2px;
    }

    .pres-label {
      color: var(--color-text);
      font-size: var(--text-sm);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .pres-slot {
      display: block;
      width: 100%;
    }

    :host([mode="presentation"][disabled]) .pres-label-row { opacity: 0.5; }
    :host([mode="presentation"][disabled]) .pres-slot { opacity: 0.45; pointer-events: none; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'param-item': ParamItem;
  }
}
