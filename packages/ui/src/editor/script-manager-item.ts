import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { Script } from '@archiyou/core/src/Script';
import { assetUrl } from '@archiyou/editor/src/services/api';

@customElement('script-manager-item')
export class ScriptManagerItem extends LitElement
{
  @property({ attribute: false }) script!: Script;
  @property({ type: Boolean, reflect: true }) selected = false;
  /** Hide owner-only actions (delete) — used for foreign shared scripts. */
  @property({ type: Boolean }) readonly = false;

  /** Optional author, shown as "by <author>" for shared/public scripts. */
  @property({ type: String }) author = '';

  /** Latest known version, shown as a pill after the name (and after the author
   *  when there is one). Empty when the script has never been published/shared —
   *  a working copy genuinely has no version, so nothing is rendered. */
  @property({ type: String }) version = '';

  @state() private _confirmingDelete = false;
  /** Set when the thumbnail URL fails to load, so the preview is dropped rather than
   *  rendered as a broken image. A thumbnail file can legitimately be missing (older
   *  scripts predate the feature; a redeploy can lose a non-persistent volume). */
  @state() private _thumbFailed = false;

  // ── Render ──

  override render()
  {
    const name      = this.script.name || 'untitled';
    const loc       = (this.script.code ?? '').split('\n').length;
    const fmt = (d: Date | undefined) => d
      ? `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '';
    const created = fmt(this.script.created);
    const updated = fmt(this.script.updated);

    // Root-relative on the wire; assetUrl() points it at the API origin.
    const thumbnail = assetUrl(this.script.thumbnail);

    return html`
      <!-- The model's own drawing stands in for the generic file icon when there
           is one; both occupy the same slot so every row stays aligned. -->
      ${thumbnail && !this._thumbFailed
        ? html`<img class="thumb" src=${thumbnail} alt="" loading="lazy"
                    @error=${() => { this._thumbFailed = true; }}>`
        : html`
            <span class="icon">
              <wa-icon library="lucide" name="file-text"></wa-icon>
            </span>`}

      <span class="info">
        <span class="name-row">
          <span class="name">${name}</span>
          ${this.author ? html`<span class="author">by ${this.author}</span>` : nothing}
          ${this.version ? html`<span class="version">${this.version}</span>` : nothing}
        </span>
        <span class="meta">${loc} lines · created ${created} · updated ${updated}</span>
      </span>

      <span class="actions" @click=${(e: Event) => e.stopPropagation()}>
        ${this.readonly
          ? ''
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
              <button class="action-btn danger" title="Delete"
                  @click=${this._handleDelete}>
                <wa-icon library="lucide" name="trash-2"></wa-icon>
              </button>`
        }
      </span>
    `;
  }

  // ── Lifecycle ──

  override connectedCallback()
  {
    super.connectedCallback();
    this.addEventListener('click', this._onRowClick);
  }

  override willUpdate(changed: Map<string, unknown>)
  {
    // Rows are reused across list renders (switching tab / filtering swaps the
    // script on the same element), so a latched failure from the previous script
    // would wrongly suppress the new one's thumbnail.
    if (changed.has('script')) this._thumbFailed = false;
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    this.removeEventListener('click', this._onRowClick);
  }

  // ── Actions ──

  private _onRowClick = () =>
  {
    this.dispatchEvent(new CustomEvent<string>('script-item-select', {
      detail: this.script.fileId,
      bubbles: true,
      composed: true,
    }));
  };

  private _handleDelete()
  {
    this._confirmingDelete = true;
  }

  private _confirmDelete()
  {
    this._confirmingDelete = false;
    this.dispatchEvent(new CustomEvent<string>('script-delete', {
      detail: this.script.fileId,
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
      gap: 10px;
      padding: 10px 16px;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      border-bottom: 1px solid var(--color-border);
      background: var(--color-bg-elevated);
      cursor: pointer;
      user-select: none;
    }

    :host(:hover) {
      background: color-mix(in srgb, var(--color-border) 25%, transparent);
    }

    :host([selected]) {
      background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    }

    :host([selected]):hover {
      background: color-mix(in srgb, var(--color-primary) 20%, transparent);
    }

    /* The icon and the thumbnail share one leading slot of the same width, so a
       row with a preview lines up with a row without one. */
    .icon {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      color: var(--color-gray-dark, #666);
      font-size: var(--text-lg);
    }

    :host([selected]) .icon {
      color: var(--color-primary);
    }

    /* Leading preview of the model, in the file icon's place.
       contain (not cover): the drawing is already framed square with padding, and
       cropping a line drawing removes the very geometry that identifies it. */
    .thumb {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      object-fit: contain;
      display: block;
    }

    .info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    /* name · by author · version pill, on one line. Only the name truncates.
       Centered, not baseline-aligned: the pill's padding and border make its text
       baseline sit well below the name's, which reads as a misalignment. */
    .name-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .name {
      color: var(--color-text);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .meta {
      font-size: var(--text-xs);
      color: var(--color-text-muted, var(--color-gray-dark, #666));
    }

    .author {
      flex-shrink: 0;
      font-size: var(--text-xs);
      font-weight: 400;
      color: var(--color-text-muted, #666);
      white-space: nowrap;
    }

    /* Same pill as the configurator header's version badge. */
    .version {
      flex-shrink: 0;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-x-xs, 0.625rem);
      line-height: 1;
      color: var(--color-gray-dark, #666);
      /* gray-light stays distinguishable from the elevated row in dark mode. */
      background: var(--color-gray-light, #eee);
      border: 1px solid var(--color-border, #cfcfcf);
      border-radius: var(--radius-full, 9999px);
      padding: 3px 7px;
      white-space: nowrap;
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

    .action-btn {
      width: 26px;
      height: 26px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-gray-dark, #666);
      border-radius: var(--radius-sm, 4px);
      font-size: 12px;
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
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'script-manager-item': ScriptManagerItem;
  }
}
