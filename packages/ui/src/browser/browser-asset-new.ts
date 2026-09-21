/**
 * <browser-asset-new> — the leading "create new asset" tile in the asset grid.
 *
 * Card-shaped with a gray background; holds the new-asset actions (currently
 * "New script"). Emits `create` (detail = 'script') and leaves creating to the page,
 * the same as the header's Create menu.
 *
 * When the editor holds a script (`current` = its name), a "Current script" button
 * sits on top so the user can return to it; it emits `open-current`.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
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
      ${this.current
        ? html`
          <wa-button class="action current" appearance="plain" title=${this.current} @click=${this._openCurrent}>
            <wa-icon slot="start" library="lucide" name="arrow-left"></wa-icon>
            ${msg('Current script')}
          </wa-button>`
        : nothing}
      <wa-button class="action" appearance="plain" @click=${this._newScript}>
        <wa-icon slot="start" library="lucide" name="file-plus-2"></wa-icon>
        ${msg('New script')}
      </wa-button>
    `;
  }

  // ── 2. Properties ──
  /** Name of the script open in the editor; empty hides the "Current script" button. */
  @property({ type: String }) current = '';

  // ── 4. Behaviour & Methods ──
  private _openCurrent()
  {
    this.dispatchEvent(new CustomEvent('open-current', { bubbles: true, composed: true }));
  }

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
      gap: var(--space-xs);
      width: 220px;
      min-height: 200px;
      background: var(--color-gray);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    .action {
      width: 160px;
    }

    .action::part(base) {
      width: 100%;
      justify-content: flex-start;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg);
    }

    .action::part(base):hover {
      color: var(--color-primary);
      border-color: var(--color-primary);
    }

    .current::part(base) {
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
