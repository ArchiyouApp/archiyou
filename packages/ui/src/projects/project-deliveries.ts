/**
 * <project-deliveries> — what was sent to the client and what they did with it
 * (plans/PROJECTS.md): `#2 Offer · sent 3 Oct · opened 2× · 1 download · accepted`.
 *
 * Emits (detail = the DeliveryData):
 *   delivery-copy-link
 *   delivery-revoke
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';

import type { ConfigurationData, DeliveryData, DeliveryFile } from '@archiyou/types';

import { deliveryFileUrl } from '@archiyou/editor/src/services/projects';
import { formatDay } from './project-configurations.js';
import { fileIcon } from './project-files.js';

/** A lucide icon per kind of file in a delivery; an attachment's by its type. */
function deliveryFileIcon(f: DeliveryFile): string
{
  if (f.kind === 'model') return 'box';
  if (f.kind === 'document') return 'file-text';
  if (f.kind === 'sheet') return 'sheet';
  return fileIcon(f.mime);
}

/** "€1,200.00" in the browser's locale. */
export function formatMoney(amount: number, currency: string): string
{
  try
  {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  }
  catch
  {
    return `${currency} ${amount}`;
  }
}

@customElement('project-deliveries')
export class ProjectDeliveries extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    const shown = this.deliveries.filter(d => d.status !== 'draft');
    if (shown.length === 0)
    {
      return html`<p class="empty">${msg('Nothing sent of this design yet. Send the client a delivery: the 3D model, its documents and an offer.')}</p>`;
    }
    return html`${shown.map(d => this._renderRow(d))}`;
  }

  private _renderRow(d: DeliveryData)
  {
    const configuration = this.configurations.find(c => c.id === d.configurationId);
    return html`
      <article class=${d.status === 'revoked' ? 'row revoked' : 'row'}>
        <div class="head">
          <span class="number">#${d.number}</span>
          <span class="title">${d.title}</span>
          ${this._renderStatus(d)}
        </div>

        <div class="meta">
          ${configuration ? html`<span>v${configuration.rev}</span>` : nothing}
          ${d.offer ? html`<span class="total">${formatMoney(d.offer.total, d.offer.currency)}</span>` : nothing}
          <span>${msg(str`to ${d.recipientName || d.recipientEmail}`)}</span>
          <span>${msg(str`sent ${formatDay(d.sentAt)}`)}</span>
          <span>${d.openCount
            ? msg(str`opened ${d.openCount}×`)
            : msg('not opened yet')}</span>
          ${d.downloadCount ? html`<span>${msg(str`${d.downloadCount} downloaded`)}</span>` : nothing}
        </div>

        ${this._renderFiles(d)}

        ${d.responseNote ? html`<blockquote class="note">${d.responseNote}</blockquote>` : nothing}

        ${d.status === 'sent'
          ? html`
            <div class="actions">
              <wa-button size="small" appearance="outlined" @click=${() => this._emit('delivery-copy-link', d)}>
                <wa-icon slot="start" library="lucide" name="link"></wa-icon>${msg('Copy link')}
              </wa-button>
              <wa-button size="small" appearance="outlined" href=${d.link ?? ''} target="_blank">
                <wa-icon slot="start" library="lucide" name="external-link"></wa-icon>${msg('Preview')}
              </wa-button>
              <wa-button size="small" appearance="plain" variant="danger" @click=${() => this._emit('delivery-revoke', d)}>
                ${msg('Revoke link')}
              </wa-button>
            </div>`
          : nothing}
      </article>
    `;
  }

  /** The files as the client got them, each opening from the client's link (not counted as
   *  the client's: only `?download=1` is). Once revoked, names only. */
  private _renderFiles(d: DeliveryData)
  {
    const files = d.files.filter(f => f.kind !== 'preview');
    if (!files.length) return nothing;
    const token = d.status === 'sent' ? d.link?.split('/d/')[1] : undefined;
    return html`
      <ul class="files">
        ${files.map(f => html`
          <li>
            <wa-icon library="lucide" name=${deliveryFileIcon(f)}></wa-icon>
            ${token
              ? html`<a href=${deliveryFileUrl(token, f.name)} target="_blank" rel="noopener" title=${f.name}>${f.name}</a>`
              : html`<span title=${f.name}>${f.name}</span>`}
          </li>`)}
      </ul>`;
  }

  private _renderStatus(d: DeliveryData)
  {
    if (d.status === 'revoked') return html`<wa-badge variant="neutral" appearance="outlined">${msg('Revoked')}</wa-badge>`;
    if (d.response === 'accepted') return html`<wa-badge variant="success">${msg('Accepted')}</wa-badge>`;
    if (d.response === 'declined') return html`<wa-badge variant="danger">${msg('Declined')}</wa-badge>`;
    if (d.response === 'changes') return html`<wa-badge variant="warning">${msg('Changes requested')}</wa-badge>`;
    return d.openCount
      ? html`<wa-badge variant="brand" appearance="outlined">${msg('Opened')}</wa-badge>`
      : html`<wa-badge variant="neutral" appearance="outlined">${msg('Sent')}</wa-badge>`;
  }

  // ── 2. Properties ──
  @property({ attribute: false }) deliveries: DeliveryData[] = [];
  @property({ attribute: false }) configurations: ConfigurationData[] = [];

  // ── 4. Behaviour & Methods ──
  private _emit(name: string, detail: DeliveryData)
  {
    this.dispatchEvent(new CustomEvent<DeliveryData>(name, { detail, bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
    }

    .empty {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .row {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding: var(--space-md);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    .row.revoked {
      opacity: 0.65;
    }

    .head {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
    }

    .number {
      font-weight: 700;
      color: var(--color-primary);
      font-variant-numeric: tabular-nums;
    }

    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-md);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .total {
      color: var(--color-text);
      font-variant-numeric: tabular-nums;
    }

    .files {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-md);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--text-xs);
    }

    .files li {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      min-width: 0;
    }

    .files wa-icon {
      flex-shrink: 0;
      color: var(--color-text-muted);
    }

    .files a {
      color: var(--color-text);
      text-decoration: none;
      overflow-wrap: anywhere;
    }

    .files a:hover {
      color: var(--color-primary);
      text-decoration: underline;
    }

    .files span {
      color: var(--color-text-muted);
      overflow-wrap: anywhere;
    }

    .note {
      margin: 0;
      padding: var(--space-xs) var(--space-sm);
      border-left: 3px solid var(--color-border);
      font-size: var(--text-sm);
      white-space: pre-wrap;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm);
      margin-top: var(--space-xs);
    }

    /* Small, as in the design rows: xs text makes the whole button small */
    .actions wa-button {
      font-size: var(--text-xs);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'project-deliveries': ProjectDeliveries;
  }
}
