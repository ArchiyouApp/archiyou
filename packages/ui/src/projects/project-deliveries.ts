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

import type { ConfigurationData, DeliveryData } from '@archiyou/types';

import { formatDay } from './project-configurations.js';

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
      return html`<p class="empty">${msg('Nothing sent yet. Send the client a delivery of a configuration: the 3D model, its documents and an offer.')}</p>`;
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
          <span class="files">${d.files.filter(f => f.kind !== 'preview').map(f => f.name).join(', ')}</span>
        </div>

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
      flex-basis: 100%;
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
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'project-deliveries': ProjectDeliveries;
  }
}
