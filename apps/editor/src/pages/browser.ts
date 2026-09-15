/**
 * <page-browser> — top level of the creative suite, at /browser/:section.
 *
 * The standard <nav-bar> header is provided by <layout-main>; this page renders
 * the two-column body: a fixed-width navigation column (menu sections) on the
 * left and an asset browser (search + create header above the asset grid) on
 * the right.
 *
 * Sections — the sidebar and the tabs are two views of the same list, and the
 * URL is the source of truth for which one is active:
 *   /browser                Home: everything below together
 *   /browser/scripts        My Scripts: the local script collection (synced when signed in)
 *   /browser/shared         Shared Scripts: community shares + those shared with me
 *   /browser/configurators  Configurators: public published configurators + my own
 *   /browser/projects       not there yet, shown disabled
 *
 * Opening an asset goes where it lives: a script into the editor (through its editor
 * link, so the URL is shareable), a configurator to its public page.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';
import { Router, type RouterLocation } from '@vaadin/router';

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';

import '@archiyou/ui/browser/browser-menu-section.js';
import '@archiyou/ui/browser/browser-header.js';
import '@archiyou/ui/browser/browser-asset-grid.js';
import type { BrowserMenuItem } from '@archiyou/ui/browser/browser-menu-section.js';
import type { BrowserAsset, BrowserAssetKind, BrowserSection, BrowserSort } from '@archiyou/ui/browser/browser-asset-grid.js';
import { publicConfiguratorUrl } from '@archiyou/ui/editor/publish-constants.js';

import { assetUrl } from '../services/api.js';
import { authService } from '../services/auth-service.js';
import { fetchPublicShared, fetchSharedWithMe } from '../services/sharing.js';
import { fetchPublishedConfigurators } from '../services/publishing.js';
import { editorPathFor } from '../services/script-links.js';
import { scripts, openScript, userState, browserSearch, browserSort, setBrowserSearch, setBrowserSort } from '../state/workspace';

type SectionId = 'all' | 'scripts' | 'shared' | 'configurators' | 'projects';

interface SectionDef
{
  id: SectionId;
  /** Sidebar label and page heading. */
  name: string;
  /** Tab label. */
  tab: string;
  icon: string;
  route: string;
  /** The kinds of asset the section lists. */
  kinds: BrowserAssetKind[];
  empty: string;
  disabled?: boolean;
}

const KIND_ORDER: BrowserAssetKind[] = ['script', 'shared', 'configurator'];

@customElement('page-browser')
export class PageBrowser extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const sections = this._sections();
    const section = this._activeSection(sections);
    const query = browserSearch.get();

    return html`
      <aside class="sidebar">
        <browser-menu-section
          section=${msg('General')}
          active=${section.route}
          .items=${sections.map((s): BrowserMenuItem => ({ name: s.name, icon: s.icon, route: s.route, disabled: s.disabled }))}
        ></browser-menu-section>

        <!-- Operators only. Cosmetic: /admin redirects anyone else, and every admin
             request is gated server-side by requireAdmin. -->
        ${userState.get().isAdmin
          ? html`
            <browser-menu-section
              class="admin"
              section=${msg('Operator')}
              .items=${[{ name: msg('Admin'), icon: 'shield-check', route: '/admin' } satisfies BrowserMenuItem]}
            ></browser-menu-section>`
          : nothing}
      </aside>

      <section class="content">
        <browser-header
          heading=${section.name}
          .search=${query}
          @search=${(e: CustomEvent<string>) => setBrowserSearch(e.detail)}
          @create=${this._createScript}
        ></browser-header>
        <browser-asset-grid
          .sections=${sections.map((s): BrowserSection => ({ id: s.id, label: s.tab, disabled: s.disabled }))}
          section=${section.id}
          .assets=${this._assetsFor(section, query)}
          sort=${browserSort.get()}
          ?showNew=${section.kinds.includes('script') && !query}
          ?loading=${this._loading && section.kinds.some(k => k !== 'script')}
          .error=${this._error}
          emptyText=${query ? msg('Nothing matches your search.') : section.empty}
          @section-select=${this._selectSection}
          @sort-change=${(e: CustomEvent<BrowserSort>) => setBrowserSort(e.detail)}
          @asset-open=${this._open}
          @create=${this._createScript}
        ></browser-asset-grid>
      </section>
    `;
  }

  // ── 2. Properties, State ──
  /** Set by the router. */
  @property({ attribute: false }) location?: RouterLocation;

  /** Latest shared version per file, by fileId: community shares and those shared with me. */
  @state() private _shared = new Map<string, ScriptData>();
  /** Latest published version per file, by fileId: public ones and my own. */
  @state() private _configurators = new Map<string, ScriptData>();
  @state() private _loading = false;
  @state() private _error = '';

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    // Every visit: someone may have shared or published something since.
    void this._loadLibraries();
  }

  // ── 4. Behaviour & Methods ──
  /** Every section, in menu order. Built per render so the labels follow the locale. */
  private _sections(): SectionDef[]
  {
    return [
      { id: 'all', name: msg('Home'), tab: msg('View all'), icon: 'house', route: '/browser',
        kinds: ['script', 'shared', 'configurator'], empty: msg('Nothing here yet.') },
      { id: 'scripts', name: msg('My Scripts'), tab: msg('My Scripts'), icon: 'file-code', route: '/browser/scripts',
        kinds: ['script'], empty: msg('You have no scripts yet.') },
      { id: 'shared', name: msg('Shared Scripts'), tab: msg('Shared Scripts'), icon: 'users', route: '/browser/shared',
        kinds: ['shared'], empty: msg('No shared scripts yet.') },
      { id: 'configurators', name: msg('Configurators'), tab: msg('Configurators'), icon: 'tv-minimal-play', route: '/browser/configurators',
        kinds: ['configurator'], empty: msg('No configurators yet.') },
      { id: 'projects', name: msg('Projects'), tab: msg('Projects'), icon: 'folder', route: '/browser/projects',
        kinds: [], empty: '', disabled: true },
    ];
  }

  /** The section in the URL; Home for /browser, an unknown section or one not available yet. */
  private _activeSection(sections: SectionDef[]): SectionDef
  {
    const id = (this.location?.params as Record<string, string> | undefined)?.section;
    return sections.find(s => s.id === id && !s.disabled) ?? sections[0];
  }

  private async _loadLibraries()
  {
    this._loading = true;
    this._error = '';
    try
    {
      const [publicShared, sharedWithMe, published] = await Promise.all([
        fetchPublicShared(), fetchSharedWithMe(), fetchPublishedConfigurators(),
      ]);
      this._shared = new Map([...publicShared, ...sharedWithMe]
        .filter(d => d.fileId)
        .map(d => [d.fileId as string, d]));

      const me = authService.getUser()?.id ?? null;
      this._configurators = new Map(published
        .filter(d => d.fileId && (d.published?.public === true || (!!me && d.author === me)))
        .map(d => [d.fileId as string, d]));
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? msg('Could not load shared scripts and configurators.');
    }
    finally
    {
      this._loading = false;
    }
  }

  /** The section's assets, searched and sorted. */
  private _assetsFor(section: SectionDef, query: string): BrowserAsset[]
  {
    // From the signal, so signing in or out re-renders: whose name a card shows depends on it.
    const me = userState.get().id;
    const mine = scripts.get();
    const myFileIds = new Set(mine.map(s => s.fileId));

    const assets: BrowserAsset[] = [];
    if (section.kinds.includes('script'))
    {
      assets.push(...mine.map((s): BrowserAsset => ({
        id: s.fileId,
        kind: 'script',
        name: s.name || msg('untitled'),
        version: s.version,
        updated: s.updated.getTime(),
        thumbnail: assetUrl(s.thumbnail),
      })));
    }
    if (section.kinds.includes('shared'))
    {
      // Home lists my scripts already; a share of one of them would be the same file twice.
      const shared = [...this._shared.values()].filter(d => section.id !== 'all' || !myFileIds.has(d.fileId as string));
      assets.push(...shared.map(d => this._libraryAsset(d, 'shared', me)));
    }
    if (section.kinds.includes('configurator'))
    {
      assets.push(...[...this._configurators.values()].map(d => this._libraryAsset(d, 'configurator', me)));
    }

    const q = query.trim().toLowerCase();
    const found = q
      ? assets.filter(a => a.name.toLowerCase().includes(q) || (a.author ?? '').toLowerCase().includes(q))
      : assets;

    const byName = (a: BrowserAsset, b: BrowserAsset) => a.name.localeCompare(b.name);
    const sort = browserSort.get();
    return [...found].sort(
      sort === 'name' ? byName
        : sort === 'type' ? (a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || byName(a, b)
        : (a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  }

  private _libraryAsset(data: ScriptData, kind: BrowserAssetKind, me: string | null): BrowserAsset
  {
    return {
      id: data.fileId as string,
      kind,
      name: data.name || msg('untitled'),
      author: data.author && data.author !== me ? data.author : undefined,
      version: data.version,
      updated: Date.parse(data.updated ?? '') || undefined,
      thumbnail: assetUrl(data.thumbnail),
    };
  }

  private _selectSection(e: CustomEvent<string>)
  {
    const section = this._sections().find(s => s.id === e.detail);
    if (section && !section.disabled) Router.go(section.route);
  }

  private _open(e: CustomEvent<BrowserAsset>)
  {
    const asset = e.detail;
    if (asset.kind === 'script')
    {
      // Make it the active script first: a script without a name has no link of its own,
      // and /editor opens whatever is active.
      Router.go(editorPathFor(openScript(asset.id)));
      return;
    }

    const data = (asset.kind === 'shared' ? this._shared : this._configurators).get(asset.id);
    if (!data) return;

    if (asset.kind === 'shared')
    {
      Router.go(editorPathFor(Script.fromData(data as unknown as Record<string, unknown>)));
      return;
    }

    const url = publicConfiguratorUrl(data.published?.url, data.author ?? '', data.name ?? '', data.version ?? '');
    const { pathname, search } = new URL(url, window.location.origin);
    Router.go(`${pathname}${search}`);
  }

  private _createScript()
  {
    Router.go('/editor?new');
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      flex: 0 0 200px;
      width: 200px;
      overflow-y: auto;
      padding: var(--space-lg);
      background: var(--color-bg);
      border-right: 1px solid var(--color-border);
    }

    /* Pinned to the bottom of the sidebar. */
    .sidebar .admin {
      margin-top: auto;
      padding-top: var(--space-lg);
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
