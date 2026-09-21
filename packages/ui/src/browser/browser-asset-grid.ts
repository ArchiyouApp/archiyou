/**
 * <browser-asset-grid> — the asset browser ("asset-grid-viewer").
 *
 * A tab bar of sections with a sort dropdown on the right, above a flex-wrapped grid
 * of asset cards. Presentational: the page decides which assets are shown, in which
 * order, and what the tabs and sort do (it keeps both in the URL / state).
 *
 * Emits:
 *   section-select  detail = section id    a tab was chosen
 *   sort-change     detail = BrowserSort   a sort was chosen
 *   asset-open      detail = BrowserAsset  a card was activated
 *   create          detail = 'script'      the "New script" tile was used
 *   open-current    (no detail)            the tile's "Current script" button was used
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import './browser-asset-card.js';
import './browser-asset-new.js';

export type BrowserAssetKind = 'script' | 'shared' | 'configurator';

/** One thing in the browser, whatever it is. `id` is unique per kind. */
export interface BrowserAsset
{
  id: string;
  kind: BrowserAssetKind;
  name: string;
  /** Author handle; left out for the user's own scripts. */
  author?: string;
  version?: string | null;
  /** Epoch ms of creation, for display. */
  created?: number;
  /** Epoch ms of the last change, for sorting and display. */
  updated?: number;
  /** Absolute thumbnail URL. */
  thumbnail?: string;
}

export interface BrowserSection
{
  id: string;
  /** Tab label. */
  label: string;
  disabled?: boolean;
}

export type BrowserSort = 'modified' | 'name' | 'type';

@customElement('browser-asset-grid')
export class BrowserAssetGrid extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="bar">
        <wa-tab-group active=${this.section} @wa-tab-show=${this._onTabShow}>
          ${this.sections.map(s => html`
            <wa-tab slot="nav" panel=${s.id} ?disabled=${s.disabled}
              title=${s.disabled ? msg('Coming soon') : s.label}>${s.label}</wa-tab>`)}
        </wa-tab-group>

        <wa-dropdown placement="bottom-end" @wa-select=${this._onSort}>
          <wa-button slot="trigger" appearance="outlined" size="small" with-caret>
            <wa-icon slot="start" library="lucide" name="arrow-up-down"></wa-icon>
            ${this._sortLabels()[this.sort]}
          </wa-button>
          ${(Object.entries(this._sortLabels()) as Array<[BrowserSort, string]>).map(([value, label]) => html`
            <wa-dropdown-item type="checkbox" value=${value} ?checked=${this.sort === value}>${label}</wa-dropdown-item>`)}
        </wa-dropdown>
      </div>

      ${this._renderBody()}
    `;
  }

  private _renderBody()
  {
    if (this.loading && this.assets.length === 0)
    {
      return html`<div class="state"><wa-spinner></wa-spinner></div>`;
    }

    return html`
      <div class="grid">
        ${this.showNew ? html`<browser-asset-new current=${this.current}></browser-asset-new>` : nothing}
        ${this.assets.map(a => html`
          <browser-asset-card
            .asset=${a}
            @click=${() => this._open(a)}
          ></browser-asset-card>
        `)}
        ${this.assets.length === 0 && !this.showNew
          ? html`<div class="state empty">${this.emptyText}</div>`
          : nothing}
      </div>
      ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
    `;
  }

  // ── 2. Properties ──
  @property({ type: Array }) sections: BrowserSection[] = [];
  /** Id of the active section. */
  @property({ type: String }) section = '';
  @property({ type: Array }) assets: BrowserAsset[] = [];
  @property({ type: String }) sort: BrowserSort = 'modified';
  /** Show the leading "New script" tile. */
  @property({ type: Boolean }) showNew = false;
  /** Name of the script open in the editor, for the tile's "Current script" button. */
  @property({ type: String }) current = '';
  @property({ type: Boolean }) loading = false;
  @property({ type: String }) error = '';
  @property({ type: String }) emptyText = '';

  // ── 4. Behaviour & Methods ──
  /** Built per call so the labels follow the locale. */
  private _sortLabels(): Record<BrowserSort, string>
  {
    return { modified: msg('Last modified'), name: msg('Name'), type: msg('Type') };
  }

  private _onTabShow(e: CustomEvent<{ name: string }>)
  {
    if (e.detail.name === this.section) return;
    this._emit('section-select', e.detail.name);
  }

  private _onSort(e: CustomEvent<{ item: { value: string } }>)
  {
    this._emit('sort-change', e.detail.item.value as BrowserSort);
  }

  private _open(asset: BrowserAsset)
  {
    this._emit('asset-open', asset);
  }

  private _emit<T>(name: string, detail: T)
  {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      padding: var(--space-sm) var(--space-lg) 0;
    }

    .bar wa-tab-group {
      flex: 1;
      min-width: 0;
      /* navigation only: no track, the active tab's own underline is the only line */
      --track-color: transparent;
      --indicator-color: transparent;
    }

    .bar wa-tab-group::part(body) { display: none; }

    .bar wa-tab::part(base) {
      font-size: var(--text-sm);
    }

    /* Inset shadow rather than the group's indicator border, which the browser rounds
       down to one device pixel below 100% zoom. */
    .bar wa-tab[active]::part(base) {
      box-shadow: inset 0 -2px 0 var(--color-primary);
    }

    .bar wa-dropdown {
      flex-shrink: 0;
      padding-bottom: var(--space-sm);
    }

    .grid {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      gap: var(--space-lg);
      padding: var(--space-lg);
    }

    .state {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      min-height: 160px;
      padding: var(--space-lg);
    }

    .empty {
      width: 100%;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .error {
      margin: 0 var(--space-lg) var(--space-lg);
      padding: var(--space-sm) var(--space-lg);
      border: 1px solid var(--color-warning);
      border-radius: var(--radius-md);
      font-size: var(--text-sm);
      color: var(--color-warning);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'browser-asset-grid': BrowserAssetGrid;
  }
}
