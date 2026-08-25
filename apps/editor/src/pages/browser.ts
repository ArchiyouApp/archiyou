/**
 * <page-browser> — top level of the creative suite.
 *
 * The standard <nav-bar> header is provided by <layout-main>; this page renders
 * the two-column body: a fixed-width navigation column (menu sections) on the
 * left and an asset browser (search + create header above the asset grid) on
 * the right.
 *
 * Asset data is still a stub — see <browser-asset-grid>.
 */

import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@archiyou/ui/browser/browser-menu-section.js';
import '@archiyou/ui/browser/browser-header.js';
import '@archiyou/ui/browser/browser-asset-grid.js';
import type { BrowserMenuItem } from '@archiyou/ui/browser/browser-menu-section.js';

@customElement('page-browser')
export class PageBrowser extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <aside class="sidebar">
        <browser-menu-section
          section=${msg('General')}
          .items=${PageBrowser._generalItems}
        ></browser-menu-section>
      </aside>

      <section class="content">
        <browser-header @create=${this._create}></browser-header>
        <browser-asset-grid></browser-asset-grid>
      </section>
    `;
  }

  // ── 2. Properties, State ──
  /** General navigation items. Routes are placeholders for now. */
  private static readonly _generalItems: BrowserMenuItem[] = [
    { name: 'Home',           icon: 'house',              route: '/browser' },
    { name: 'Scripts',        icon: 'file-code',          route: '/browser/scripts' },
    { name: 'Shared Scripts', icon: 'users',              route: '/browser/shared' },
    { name: 'Designs',        icon: 'shapes',             route: '/browser/designs' },
    { name: 'Configurators',  icon: 'sliders-horizontal', route: '/browser/configurators' },
    { name: 'Projects',       icon: 'folder',             route: '/browser/projects' },
  ];

  // ── 4. Behaviour & Methods ──
  private _create()
  {
    // TODO: open a "create asset" flow
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    .sidebar {
      flex: 0 0 200px;
      width: 200px;
      overflow-y: auto;
      padding: var(--space-lg);
      background: var(--color-bg);
      border-right: 1px solid var(--color-border);
    }

    .content {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    browser-asset-grid {
      flex: 1;
      min-height: 0;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-browser': PageBrowser;
  }
}
