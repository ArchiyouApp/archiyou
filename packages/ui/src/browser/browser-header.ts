/**
 * <browser-header> — the asset browser content header.
 *
 * Title on the left; a (small) search field and a Create menu on the right.
 * Emits `search` (detail = query string) and `create` (detail = what to create:
 * 'script'; projects are listed but not available yet).
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';

export type BrowserCreateKind = 'script';

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
          .value=${this.search}
          @input=${this._onSearch}
        >
          <wa-icon slot="start" library="lucide" name="search"></wa-icon>
        </wa-input>

        <wa-dropdown placement="bottom-end" @wa-select=${this._onCreate}>
          <wa-button slot="trigger" class="create" size="small" variant="brand" with-caret>
            <wa-icon slot="start" library="lucide" name="plus"></wa-icon>
            ${msg('Create')}
          </wa-button>
          <wa-dropdown-item value="script">
            <wa-icon slot="icon" library="lucide" name="file-code"></wa-icon>
            ${msg('Script')}
          </wa-dropdown-item>
          <wa-dropdown-item value="project" disabled>
            <wa-icon slot="icon" library="lucide" name="folder"></wa-icon>
            ${msg('Project (coming soon)')}
          </wa-dropdown-item>
        </wa-dropdown>
      </div>
    `;
  }

  // ── 2. Properties ──
  @property({ type: String }) heading = 'Browser';
  @property({ type: String }) search = '';

  // ── 4. Behaviour & Methods ──
  private _onSearch(e: Event)
  {
    this.dispatchEvent(new CustomEvent('search', {
      detail: (e.target as HTMLInputElement).value,
      bubbles: true,
      composed: true,
    }));
  }

  private _onCreate(e: CustomEvent<{ item: { value: string } }>)
  {
    const kind = e.detail.item.value;
    if (kind !== 'script') return;
    this.dispatchEvent(new CustomEvent<BrowserCreateKind>('create', {
      detail: kind,
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

    /* The app's primary blue rather than Web Awesome's brand color, like the configurator's Download button. */
    .create::part(base) {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: var(--color-white);
    }

    .create::part(base):hover {
      background: color-mix(in srgb, var(--color-black, #000) 12%, var(--color-primary));
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
