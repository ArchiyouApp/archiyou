/**
 * <browser-header> — the asset browser content header.
 *
 * Title on the left; a (small) search field and Create button on the right.
 * Emits `search` (detail = query string) and `create` events.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

@customElement('browser-header')
export class BrowserHeader extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <h1 class="title">${this.heading}</h1>

      <div class="actions">
        <wa-input
          class="search"
          size="small"
          type="search"
          placeholder=${msg('Search…')}
          @input=${this._onSearch}
        >
          <wa-icon slot="start" library="lucide" name="search"></wa-icon>
        </wa-input>

        <wa-button size="small" variant="brand" @click=${this._onCreate}>
          <wa-icon slot="start" library="lucide" name="plus"></wa-icon>
          ${msg('Create')}
        </wa-button>
      </div>
    `;
  }

  // ── 2. Properties ──
  @property({ type: String }) heading = 'Browser';

  // ── 4. Behaviour & Methods ──
  private _onSearch(e: Event)
  {
    this.dispatchEvent(new CustomEvent('search', {
      detail: (e.target as HTMLInputElement).value,
      bubbles: true,
      composed: true,
    }));
  }

  private _onCreate()
  {
    this.dispatchEvent(new CustomEvent('create', {
      bubbles: true,
      composed: true,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-lg);
      padding: var(--space-lg);
      border-bottom: 1px solid var(--color-border);
    }

    .title {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-xl);
      font-weight: 700;
      color: var(--color-text);
    }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-md);
    }

    .search {
      width: 240px;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'browser-header': BrowserHeader;
  }
}
