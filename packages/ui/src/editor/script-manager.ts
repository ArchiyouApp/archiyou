import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';

import { scripts, editorScript } from '@archiyou/editor/src/state/workspace';
import { fetchPublicShared, fetchSharedWithMe } from '@archiyou/editor/src/services/sharing';
import { fetchMyConfigurators } from '@archiyou/editor/src/services/publishing';
import { OVERLAY_MENU_WIDTH, OVERLAY_MENU_HEIGHT } from '@archiyou/editor/src/settings';

import './script-manager-item.js';

type ManagerTab = 'mine' | 'public' | 'shared-with-me';

/** Numeric-segment compare ("0.10" > "0.9"); unparsed segments sort as 0.
 *  Enough for the "which of these is the later release" question here — a full
 *  semver dependency would be overkill for a list pill. */
function compareVersions(a: string, b: string): number
{
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++)
  {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

@customElement('script-manager')
export class ScriptManager extends SignalWatcher(LitElement)
{
  @property({ type: Boolean, reflect: true }) open = false;

  @state() private _selectedFileId: string | null = null;
  @state() private _sortBy: 'name' | 'date-updated' | 'date-created' = 'date-updated';
  @state() private _filter = '';
  @state() private _tab: ManagerTab = 'mine';

  // Lazily-loaded shared libraries (fetched on first tab visit).
  @state() private _publicShared: Script[] | null = null;
  @state() private _sharedWithMe: Script[] | null = null;
  @state() private _loadingShared = false;
  /** fileId → ScriptData for the shared lists, to resolve a selection to its
   *  full payload (shared scripts aren't in the local collection). */
  private _sharedById = new Map<string, ScriptData>();

  /** fileId → highest known released version, merged from every bulk list we
   *  already fetch. Local working copies reset `version` to null on save (see
   *  ScriptStore), so without this My Scripts would show no version at all for
   *  files that have in fact been published or shared. */
  @state() private _latestVersions = new Map<string, string>();

  private static readonly TABS: { id: ManagerTab; label: string }[] = [
    { id: 'mine',           label: 'My Scripts' },
    { id: 'public',         label: 'Public Shared' },
    { id: 'shared-with-me', label: 'Shared with me' },
  ];

  // ── Render ──

  override render()
  {
    if (!this.open) return nothing;

    return html`
      <div class="backdrop" @click=${this._cancel}></div>
      <div class="dialog" role="dialog" aria-modal="true"
           @click=${(e: Event) => e.stopPropagation()}>

        <div class="dialog-header">
          <wa-icon library="lucide" name="folder-open"></wa-icon>
          <span class="header-title">Open Script</span>
          <div class="search-wrap">
            <wa-icon library="lucide" name="search" class="search-icon"></wa-icon>
            <input
              class="search-input"
              type="text"
              placeholder="Filter…"
              .value=${this._filter}
              @input=${(e: InputEvent) => { this._onFilterInput((e.target as HTMLInputElement).value); }}
            />
          </div>
          ${this._tab === 'mine' ? this._renderSort() : nothing}
          <button class="close-btn" @click=${this._cancel}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <div class="tabs">
          ${ScriptManager.TABS.map(t => html`
            <button
              class=${`tab ${this._tab === t.id ? 'active' : ''}`}
              @click=${() => this._selectTab(t.id)}
            >${t.label}</button>`)}
        </div>

        <div class="dialog-body">
          ${this._renderList()}
        </div>

        <div class="dialog-footer">
          <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
          <button class="btn-primary"
              ?disabled=${this._selectedFileId === null}
              @click=${this._open}>
            Open
          </button>
        </div>
      </div>
    `;
  }

  private _renderSort()
  {
    return html`
      <wa-dropdown
        class="sort-dropdown"
        placement="bottom-end"
        hoist
        @wa-select=${(e: CustomEvent) => { this._sortBy = (e.detail.item as { value: string }).value as 'name' | 'date-updated' | 'date-created'; }}
      >
        <button slot="trigger" class="sort-btn" title="Sort scripts">
          <wa-icon library="lucide" name="arrow-up-down"></wa-icon>
          <span>${this._sortBy === 'name' ? 'Name' : this._sortBy === 'date-created' ? 'Date created' : 'Date updated'}</span>
          <wa-icon library="lucide" name="chevron-down"></wa-icon>
        </button>
        <wa-dropdown-item value="date-updated" ?checked=${this._sortBy === 'date-updated'}>Date updated</wa-dropdown-item>
        <wa-dropdown-item value="date-created" ?checked=${this._sortBy === 'date-created'}>Date created</wa-dropdown-item>
        <wa-dropdown-item value="name" ?checked=${this._sortBy === 'name'}>Name</wa-dropdown-item>
      </wa-dropdown>`;
  }

  private _renderList()
  {
    if (this._tab === 'mine') return this._renderMine();

    if (this._loadingShared) return html`<div class="empty">Loading…</div>`;

    const source = this._tab === 'public' ? this._publicShared : this._sharedWithMe;
    if (source === null) return html`<div class="empty">Loading…</div>`;

    const filtered = this._applyFilter(source);
    if (filtered.length === 0)
    {
      return html`<div class="empty">${this._tab === 'public'
        ? 'No public shared scripts yet.'
        : 'No scripts shared with you yet.'}</div>`;
    }

    return filtered.map(s => html`
      <script-manager-item
        .script=${s}
        readonly
        author=${s.author ?? ''}
        version=${this._versionFor(s)}
        ?selected=${this._selectedFileId === s.fileId}
        @script-item-select=${this._onSelect}
      ></script-manager-item>`);
  }

  private _renderMine()
  {
    // Exclude the currently-active script — opening it would be a no-op.
    const activeFileId = editorScript.get()?.fileId ?? null;
    const unsorted = scripts.get().filter(s => s.fileId !== activeFileId);
    const filtered = this._applyFilter(unsorted);
    const list = this._sortBy === 'name'
      ? [...filtered].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      : this._sortBy === 'date-created'
        ? [...filtered].sort((a, b) => (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0))
        : [...filtered].sort((a, b) => (b.updated?.getTime() ?? 0) - (a.updated?.getTime() ?? 0));

    if (list.length === 0) return html`<div class="empty">No other scripts yet.</div>`;

    return list.map(s => html`
      <script-manager-item
        .script=${s}
        version=${this._versionFor(s)}
        ?selected=${this._selectedFileId === s.fileId}
        @script-item-select=${this._onSelect}
        @script-delete=${this._onDelete}
      ></script-manager-item>`);
  }

  /** The version to show for a row: the highest of the script's own version and
   *  anything a bulk list told us about that file. Taking the max matters for a
   *  local copy that was published again elsewhere — its stored version is then
   *  behind the library's. '' renders no pill. */
  private _versionFor(s: Script): string
  {
    const own    = s.version ?? '';
    const known  = this._latestVersions.get(s.fileId) ?? '';
    if (!own)   return known;
    if (!known) return own;
    return compareVersions(known, own) > 0 ? known : own;
  }

  /** Merge released versions into the map, keeping the highest per file. Assigns
   *  a new Map so the @state identity check fires and the rows re-render. */
  private _mergeVersions(entries: Array<{ fileId?: string; version?: string | null }>): void
  {
    const next = new Map(this._latestVersions);
    for (const { fileId, version } of entries)
    {
      if (!fileId || !version) continue;
      const current = next.get(fileId);
      if (!current || compareVersions(version, current) > 0) next.set(fileId, version);
    }
    this._latestVersions = next;
  }

  private _applyFilter(list: Script[]): Script[]
  {
    const filterLc = this._filter.toLowerCase();
    return filterLc
      ? list.filter(s => (s.name ?? '').toLowerCase().includes(filterLc)
          || (s.author ?? '').toLowerCase().includes(filterLc))
      : list;
  }

  // ── Lifecycle ──

  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open)
    {
      // No default selection — the active script is filtered out of the list,
      // and we shouldn't preselect something the user didn't ask for.
      this._selectedFileId = null;
      this._filter = '';
      this._tab = 'mine';
      // Drop cached shared lists so re-opening reflects fresh server state.
      this._publicShared = null;
      this._sharedWithMe = null;
      this._latestVersions = new Map();
      void this._loadLatestVersions();
    }
  }

  /** One best-effort bulk call so My Scripts can show a version for files that
   *  have been published — their local working copy carries none. Silent on
   *  failure (signed out, offline): the pills simply stay absent. */
  private async _loadLatestVersions()
  {
    try
    {
      this._mergeVersions(await fetchMyConfigurators());
    }
    catch (err)
    {
      console.debug('script-manager: no published versions available for version pills', err);
    }
  }

  // ── Behaviour ──

  private _selectTab(tab: ManagerTab)
  {
    if (tab === this._tab) return;
    this._tab = tab;
    this._selectedFileId = null;
    if (tab === 'public' && this._publicShared === null) void this._loadShared('public');
    if (tab === 'shared-with-me' && this._sharedWithMe === null) void this._loadShared('shared-with-me');
  }

  /** Fetch a shared library, hydrate Script instances, and index by fileId. */
  private async _loadShared(tab: 'public' | 'shared-with-me')
  {
    this._loadingShared = true;
    try {
      const data = tab === 'public' ? await fetchPublicShared() : await fetchSharedWithMe();
      const list: Script[] = [];
      for (const d of data)
      {
        if (d.fileId) this._sharedById.set(d.fileId, d);
        const s = Script.fromData(d);
        if (s) list.push(s);
      }
      // A library row is a release, so it also teaches My Scripts the latest
      // version of any file the user happens to own.
      this._mergeVersions(data);
      if (tab === 'public') this._publicShared = list;
      else                  this._sharedWithMe = list;
    } catch (err) {
      console.warn('script-manager: failed to load shared scripts', err);
      if (tab === 'public') this._publicShared = [];
      else                  this._sharedWithMe = [];
    } finally {
      this._loadingShared = false;
    }
  }

  private _onFilterInput(value: string)
  {
    this._filter = value;
    // A filter change may hide the selected row — clear it if so.
    if (this._selectedFileId)
    {
      const filterLc = value.toLowerCase();
      const pool = this._tab === 'mine'
        ? scripts.get()
        : (this._tab === 'public' ? this._publicShared : this._sharedWithMe) ?? [];
      const visible = pool.filter(s =>
        !filterLc || (s.name ?? '').toLowerCase().includes(filterLc)
          || (s.author ?? '').toLowerCase().includes(filterLc));
      if (!visible.some(s => s.fileId === this._selectedFileId))
      {
        this._selectedFileId = null;
      }
    }
  }

  private _onSelect(e: CustomEvent<string>)
  {
    this._selectedFileId = e.detail;
  }

  private _onDelete(e: CustomEvent<string>)
  {
    // Parent handles the actual deletion (calls deleteScriptById).
    if (this._selectedFileId === e.detail) this._selectedFileId = null;
    // Re-dispatch as-is so the editor catches it.
    // (The event already bubbles/composes through the parent.)
  }

  private _open()
  {
    if (this._selectedFileId === null) return;

    // Shared tabs open a foreign (read-only) script from its full payload.
    if (this._tab !== 'mine')
    {
      const data = this._sharedById.get(this._selectedFileId);
      if (!data) return;
      this.dispatchEvent(new CustomEvent<ScriptData>('script-manager-open-shared', {
        detail: data,
        bubbles: true,
        composed: true,
      }));
      return;
    }

    this.dispatchEvent(new CustomEvent<string>('script-manager-open', {
      detail: this._selectedFileId,
      bubbles: true,
      composed: true,
    }));
  }

  private _cancel()
  {
    this.dispatchEvent(new CustomEvent('script-manager-cancel', {
      bubbles: true,
      composed: true,
    }));
  }

  // ── Styles ──

  static override styles = css`
    :host { display: contents; }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 200;
    }

    .dialog {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 201;
      width: ${unsafeCSS(OVERLAY_MENU_WIDTH)};
      max-width: calc(100vw - 32px);
      max-height: ${unsafeCSS(OVERLAY_MENU_HEIGHT)};
      background: var(--color-bg-elevated, #fff);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg, 12px);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      font-family: var(--font-sans);
      overflow: hidden;
    }

    /* ── Header ── */

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border);
      font-weight: 500;
      font-size: var(--text-sm);
      color: var(--color-text);
      flex-shrink: 0;
    }

    .close-btn {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-gray-dark, #666);
      border-radius: var(--radius-sm, 4px);
    }

    .close-btn:hover {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
    }

    /* Sort dropdown sits between the title and close button */

    .sort-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: transparent;
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      white-space: nowrap;
    }

    .sort-btn:hover {
      background: color-mix(in srgb, var(--color-border) 30%, transparent);
      color: var(--color-text);
    }

    .sort-dropdown {
      /* no margin needed — header-title pushes it right */
    }

    .header-title {
      white-space: nowrap;
    }

    .search-wrap {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg);
      color: var(--color-text-muted);
      font-size: var(--text-xs);
    }

    .search-wrap:focus-within {
      border-color: var(--color-primary);
      color: var(--color-text);
    }

    .search-icon {
      flex-shrink: 0;
      font-size: 13px;
      opacity: 0.55;
    }

    .search-input {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      background: transparent;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--color-text);
    }

    .search-input::placeholder {
      color: var(--color-text-muted);
      opacity: 0.7;
    }

    /* ── Tabs ── */

    .tabs {
      display: flex;
      gap: 2px;
      padding: 0 12px;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .tab {
      padding: 8px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text-muted);
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    }

    .tab:hover { color: var(--color-text); }

    .tab.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
      font-weight: 500;
    }

    /* ── Body ── */

    .dialog-body {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      flex: 1;
    }

    .empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--color-text-muted, var(--color-gray-dark, #666));
      font-size: var(--text-sm);
    }

    /* ── Footer ── */

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .btn-primary,
    .btn-secondary {
      padding: 7px 16px;
      border-radius: var(--radius-sm, 4px);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      border: none;
    }

    .btn-primary {
      background: var(--color-primary);
      color: var(--color-white, #fff);
    }

    .btn-primary:hover:not(:disabled) { opacity: 0.88; }
    .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

    .btn-secondary {
      background: transparent;
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-secondary:hover {
      background: color-mix(in srgb, var(--color-border) 30%, transparent);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'script-manager': ScriptManager;
  }
}
