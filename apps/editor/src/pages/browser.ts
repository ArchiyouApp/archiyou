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
 *   /browser/projects       Projects: the signed-in professional's projects, filtered by
 *                           status in `?status=` (request | active | won | lost | archived)
 *
 * Home leaves projects out: they are a different kind of thing (work for clients) and
 * live in their own section.
 *
 * Opening an asset goes where it lives: a script into the editor (through its editor
 * link, so the URL is shareable), a configurator to its public page, a project to its page.
 */

import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';
import { Router, type RouterLocation } from '@vaadin/router';

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import { projectLabel, type ProjectCounts, type ProjectStatus, type ProjectSummary } from '@archiyou/types';

import '@awesome.me/webawesome/dist/components/button/button.js';

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
import { enqueueBackfill, THUMBNAIL_STORED_EVENT, type BackfillTarget, type ThumbnailStoredDetail } from '../services/thumbnails.js';
import { editorPathFor } from '../services/script-links.js';
import { listProjects, createProject } from '../services/projects.js';
import { BREAKPOINT_COMPACT } from '../styles/design-tokens.js';
import { scripts, openScript, userState, browserSearch, browserSort, setBrowserSearch, setBrowserSort, editorScript } from '../state/workspace';

type SectionId = 'all' | 'scripts' | 'shared' | 'configurators' | 'projects';

/** The projects section's status filter: a status, every live project, or the archived ones. */
type ProjectFilter = 'all' | ProjectStatus | 'archived';
const PROJECT_FILTERS: ProjectFilter[] = ['all', 'request', 'active', 'won', 'lost', 'archived'];

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

const KIND_ORDER: BrowserAssetKind[] = ['script', 'shared', 'configurator', 'project'];

/** Scripts shorter than this are stubs (the editor's auto-run draws the same line): not
 *  worth a run to find out they draw nothing. */
const MIN_BACKFILL_CODE_LENGTH = 20;

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
          @create=${this._create}
        ></browser-header>
        <browser-asset-grid
          .sections=${sections.map((s): BrowserSection => ({ id: s.id, label: s.tab, disabled: s.disabled }))}
          section=${section.id}
          .assets=${this._assetsFor(section, query)}
          sort=${browserSort.get()}
          ?showNew=${section.kinds.includes('script') && !query}
          current=${editorScript.get() ? (editorScript.get()?.name || msg('untitled')) : ''}
          ?loading=${section.id === 'projects' ? this._projectsLoading : this._loading && section.kinds.some(k => k !== 'script')}
          .error=${section.id === 'projects' ? this._projectsError : this._error}
          emptyText=${query ? msg('Nothing matches your search.') : section.empty}
          @section-select=${this._selectSection}
          @sort-change=${(e: CustomEvent<BrowserSort>) => setBrowserSort(e.detail)}
          @asset-open=${this._open}
          @create=${this._createScript}
          @open-current=${this._openCurrent}
        >${section.id === 'projects' ? this._renderProjectFilters() : nothing}</browser-asset-grid>
      </section>
    `;
  }

  /** Status chips above the project cards; the counts are of live projects. */
  private _renderProjectFilters()
  {
    if (userState.get().anonymous) return nothing;
    const active = this._projectFilter();
    const labels: Record<ProjectFilter, string> = {
      all: msg('All'), request: msg('Requests'), active: msg('Active'), won: msg('Won'), lost: msg('Lost'), archived: msg('Archived'),
    };
    const count = (f: ProjectFilter) => (f === 'all' || f === 'archived' ? 0 : this._projectCounts?.[f] ?? 0);

    return html`
      <div class="filters" slot="filters" role="toolbar" aria-label=${msg('Project status')}>
        ${PROJECT_FILTERS.map(f => html`
          <wa-button size="small" pill
            appearance=${f === active ? 'filled' : 'outlined'}
            variant=${f === active ? 'brand' : 'neutral'}
            @click=${() => this._setProjectFilter(f)}
          >${labels[f]}${count(f) ? html`<span class="count">${count(f)}</span>` : nothing}</wa-button>`)}
      </div>
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
  /** The signed-in professional's projects for the current filter. */
  @state() private _projects: ProjectSummary[] = [];
  @state() private _projectCounts: ProjectCounts | null = null;
  @state() private _projectsLoading = false;
  @state() private _projectsError = '';

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    window.addEventListener(THUMBNAIL_STORED_EVENT, this._onThumbnailStored);
    // Every visit: someone may have shared or published something since.
    void this._loadLibraries();
  }

  override disconnectedCallback()
  {
    window.removeEventListener(THUMBNAIL_STORED_EVENT, this._onThumbnailStored);
    super.disconnectedCallback();
  }

  override willUpdate(changed: Map<string, unknown>)
  {
    // Entering the projects section, or another filter in it
    if (changed.has('location') && this._activeSection(this._sections()).id === 'projects')
    {
      void this._loadProjects();
    }
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
        kinds: ['project'], empty: userState.get().anonymous
          ? msg('Sign in to keep projects for your clients.')
          : msg('No projects here. Add a configuration to a project from the editor or a configurator, or create one.') },
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
    this._backfillThumbnails();
  }

  /** The status filter in the URL. */
  private _projectFilter(): ProjectFilter
  {
    const status = new URLSearchParams(this.location?.search ?? window.location.search).get('status');
    return PROJECT_FILTERS.includes(status as ProjectFilter) ? status as ProjectFilter : 'all';
  }

  private _setProjectFilter(filter: ProjectFilter)
  {
    Router.go(filter === 'all' ? '/browser/projects' : `/browser/projects?status=${filter}`);
  }

  private async _loadProjects()
  {
    if (userState.get().anonymous)
    {
      this._projects = [];
      return;
    }
    const filter = this._projectFilter();
    this._projectsLoading = true;
    this._projectsError = '';
    try
    {
      const list = await listProjects(filter === 'archived'
        ? { archived: true }
        : { status: filter === 'all' ? undefined : filter });
      this._projects = list.data;
      this._projectCounts = list.counts;
    }
    catch (err)
    {
      const body = (err as { body?: { error?: string; code?: string } }).body;
      this._projects = [];
      this._projectsError = body?.code === 'email_not_verified'
        ? msg('Confirm your email address to use projects: they can email your clients.')
        : body?.error ?? (err as Error)?.message ?? msg('Could not load your projects.');
    }
    finally
    {
      this._projectsLoading = false;
    }
  }

  /**
   * Have pictures taken, in the background, for the signed-in user's own scripts that have
   * none: working copies (what Home shows) and their own shared/published versions. Only
   * ours — a thumbnail is stamped through the owner's account. Nothing here waits.
   */
  private _backfillThumbnails()
  {
    const me = authService.getUser()?.id;
    if (!me) return;

    const targets: BackfillTarget[] = [];
    for (const s of scripts.get())
    {
      if (s.thumbnail || !s.fileId || (s.author && s.author !== me)) continue;
      if ((s.code ?? '').length < MIN_BACKFILL_CODE_LENGTH) continue;
      targets.push({ fileId: s.fileId, script: s.toData() });
    }
    for (const data of [...this._shared.values(), ...this._configurators.values()])
    {
      if (data.thumbnail || data.author !== me || !data.fileId || !data.id) continue;
      if ((data.code ?? '').length < MIN_BACKFILL_CODE_LENGTH) continue;
      targets.push({ fileId: data.fileId, versionId: data.id, script: data });
    }
    enqueueBackfill(targets);
  }

  /** A picture landed (backfill, or the editor's own run): show it without a re-fetch.
   *  Working copies live on the `scripts` signal, which the service updates itself; the
   *  library rows are plain state maps here, so a new Map is what makes Lit re-render. */
  private _onThumbnailStored = (e: Event) =>
  {
    const { fileId, versionId, url } = (e as CustomEvent<ThumbnailStoredDetail>).detail;
    if (!versionId) return;
    for (const map of [this._shared, this._configurators] as const)
    {
      const row = map.get(fileId);
      if (row?.id !== versionId) continue;
      const next = new Map(map);
      next.set(fileId, { ...row, thumbnail: url });
      if (map === this._shared) this._shared = next; else this._configurators = next;
    }
  };

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
        created: s.created.getTime(),
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
    if (section.kinds.includes('project'))
    {
      assets.push(...this._projects.map(p => this._projectAsset(p)));
    }

    const q = query.trim().toLowerCase();
    const found = q
      ? assets.filter(a => [a.name, a.author, a.subtitle, a.label].some(t => (t ?? '').toLowerCase().includes(q)))
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
      created: Date.parse(data.created ?? '') || undefined,
      updated: Date.parse(data.updated ?? '') || undefined,
      thumbnail: assetUrl(data.thumbnail),
    };
  }

  private _projectAsset(p: ProjectSummary): BrowserAsset
  {
    const badges: Record<ProjectStatus, BrowserAsset['badge']> = {
      request: { text: msg('Request'), variant: 'warning' },
      active: { text: msg('Active'), variant: 'brand' },
      won: { text: msg('Won'), variant: 'success' },
      lost: { text: msg('Lost'), variant: 'neutral' },
    };
    return {
      id: p.id,
      kind: 'project',
      name: p.title,
      label: projectLabel(p.number),
      subtitle: p.clientName ?? undefined,
      badge: badges[p.status],
      unread: p.unread,
      created: Date.parse(p.created) || undefined,
      updated: Date.parse(p.updated) || undefined,
      thumbnail: assetUrl(p.thumbnail),
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
    if (asset.kind === 'project')
    {
      Router.go(`/projects/${asset.id}`);
      return;
    }
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

  /** The header's Create menu: a script, or a project (opened straight away to fill in). */
  private async _create(e: CustomEvent<'script' | 'project'>)
  {
    if (e.detail !== 'project')
    {
      this._createScript();
      return;
    }
    if (userState.get().anonymous)
    {
      Router.go('/login');
      return;
    }
    try
    {
      const project = await createProject({ title: msg('New project') });
      Router.go(`/projects/${project.id}`);
    }
    catch (err)
    {
      const body = (err as { body?: { error?: string; code?: string } }).body;
      this._projectsError = body?.code === 'email_not_verified'
        ? msg('Confirm your email address to use projects: they can email your clients.')
        : body?.error ?? msg('Could not create the project.');
      Router.go('/browser/projects');
    }
  }

  /** Back to the script the editor holds (the browser leaves it active). */
  private _openCurrent()
  {
    Router.go(editorPathFor(editorScript.get()));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
      container: browser / inline-size;
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

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm);
      padding: var(--space-md) var(--space-lg) 0;
    }

    .filters .count {
      margin-left: var(--space-xs);
      font-variant-numeric: tabular-nums;
      opacity: 0.8;
    }

    /* Compact: the tabs already list every section, and the operator link is
       also in the account menu, so the sidebar can go. */
    @container browser (width < ${unsafeCSS(BREAKPOINT_COMPACT)}) {
      .sidebar { display: none; }
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
