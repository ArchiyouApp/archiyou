/**
 * <browser-asset-grid> — the asset browser ("asset-grid-viewer").
 *
 * A tab bar to filter by asset type with a sort dropdown on the right, above a
 * flex-wrapped grid of asset cards.
 *
 * Stub: cards are driven by hard-coded mock data; filtering and sorting are
 * not yet wired up.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import './browser-asset-card.js';
import './browser-asset-new.js';

interface MockAsset
{
  id: string;
  type: string;
  name: string;
  author: string;
  preview: string;
}

@customElement('browser-asset-grid')
export class BrowserAssetGrid extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="bar">
        <wa-tab-group
          @wa-tab-show=${(e: CustomEvent<{ name: string }>) =>
            { this._activeTab = e.detail.name; }}
        >
          <wa-tab panel="all" ?active=${this._activeTab === 'all'}>
            ${msg('View all')}
          </wa-tab>
          <wa-tab panel="scripts">${msg('Scripts')}</wa-tab>
          <wa-tab panel="shared">${msg('Shared Scripts')}</wa-tab>
          <wa-tab panel="designs">${msg('Designs')}</wa-tab>
          <wa-tab panel="configurators">${msg('Configurators')}</wa-tab>
          <wa-tab panel="projects">${msg('Projects')}</wa-tab>
        </wa-tab-group>

        <wa-dropdown
          @wa-select=${(e: CustomEvent<{ item: { value: string } }>) =>
            { this._sort = e.detail.item.value; }}
        >
          <wa-button slot="trigger" appearance="outlined" size="small" with-caret>
            <wa-icon slot="start" library="lucide" name="arrow-up-down"></wa-icon>
            ${msg('Sort')}
          </wa-button>
          <wa-dropdown-item value="name">${msg('Name')}</wa-dropdown-item>
          <wa-dropdown-item value="modified">${msg('Last modified')}</wa-dropdown-item>
          <wa-dropdown-item value="type">${msg('Type')}</wa-dropdown-item>
        </wa-dropdown>
      </div>

      <div class="grid">
        <browser-asset-new></browser-asset-new>
        ${this._visibleAssets.map(a => html`
          <browser-asset-card
            name=${a.name}
            type=${a.type}
            author=${a.author}
            preview=${a.preview}
          ></browser-asset-card>
        `)}
      </div>
    `;
  }

  // ── 2. State ──
  @state() private _activeTab = 'all';
  @state() private _sort = 'modified';

  /**
   * Filtered + sorted view of the assets.
   * Stub: filtering/sorting over mock data; swap in a real data source later.
   */
  private get _visibleAssets(): MockAsset[]
  {
    const byTab: Record<string, string> = {
      scripts: 'Script',
      shared: 'Script',
      designs: 'Design',
      configurators: 'Configurator',
      projects: 'Project',
    };
    const wanted = byTab[this._activeTab];
    const list = wanted
      ? BrowserAssetGrid._mockAssets.filter(a => a.type === wanted)
      : [...BrowserAssetGrid._mockAssets];

    if (this._sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (this._sort === 'type') list.sort((a, b) => a.type.localeCompare(b.type));
    // 'modified' — TODO: no timestamps on mock data yet, keep insertion order.

    return list;
  }

  // ── 3. Mock data (stub) ──
  private static readonly _mockAssets: MockAsset[] = [
    { id: '1', type: 'Script',       name: 'Parametric Chair',   author: 'Mark',  preview: '' },
    { id: '2', type: 'Design',       name: 'Pavilion Roof',      author: 'Wessel', preview: '' },
    { id: '3', type: 'Configurator', name: 'Shelf Builder',      author: 'Mark',  preview: '' },
    { id: '4', type: 'Script',       name: 'Voronoi Facade',     author: 'Anna',  preview: '' },
    { id: '5', type: 'Project',      name: 'Tiny House',         author: 'Mark',  preview: '' },
    { id: '6', type: 'Design',       name: 'Lamp Shade',         author: 'Wessel', preview: '' },
  ];

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
      padding: var(--space-sm) var(--space-lg);
      border-bottom: 1px solid var(--color-border);
    }

    .bar wa-tab-group {
      flex: 1;
      min-width: 0;
    }

    /* smaller tab labels */
    .bar wa-tab::part(base) {
      font-size: var(--text-sm);
    }

    .bar wa-dropdown {
      flex-shrink: 0;
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
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'browser-asset-grid': BrowserAssetGrid;
  }
}
