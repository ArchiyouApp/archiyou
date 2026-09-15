/**
 * <browser-asset-new> — the leading "create new asset" tile in the asset grid.
 *
 * Card-shaped with a gray background; holds the new-asset actions (currently
 * "New script"). Emits `create` (detail = 'script') and leaves creating to the page,
 * the same as the header's Create menu.
 */

import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { BrowserCreateKind } from './browser-header.js';

@customElement('browser-asset-new')
export class BrowserAssetNew extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <wa-button class="action" appearance="plain" @click=${this._newScript}>
        <wa-icon slot="start" library="lucide" name="file-plus-2"></wa-icon>
        ${msg('New script')}
      </wa-button>
    `;
  }

  // ── 4. Behaviour & Methods ──
  private _newScript()
  {
    this.dispatchEvent(new CustomEvent<BrowserCreateKind>('create', {
      detail: 'script',
      bubbles: true,
      composed: true,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      width: 220px;
      min-height: 200px;
      background: var(--color-gray);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    .action::part(base) {
      font-size: var(--text-base);
      font-weight: 600;
      color: var(--color-text);
    }

    .action::part(base):hover {
      color: var(--color-primary);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'browser-asset-new': BrowserAssetNew;
  }
}
