/**
 * <manage-configurators-menu> — review + clean up the signed-in user's published
 * configurators.
 *
 * Published versions are **bundled by file** (one row per configurator, not per
 * version). Each row shows the latest version by default; a version dropdown lets
 * you switch to older versions. The displayed public/private state, created/updated
 * dates, configurator URL and the Edit/Un-publish actions all re-point to whichever
 * version is selected. Each row can be:
 *   - Edited → dispatches `manage-configurators-edit` for the selected version (the
 *     editor loads that script and opens <publish-script-menu>).
 *   - Deleted → clears just the selected version's `published` attribute server-side
 *     (un-publishes it; the version row + editable script are kept). Uses an
 *     inline "Delete? ✓ ✗" confirm, mirroring <script-manager-item>.
 *
 * Emits:
 *   manage-configurators-edit   CustomEvent<ScriptData>
 *   manage-configurators-cancel CustomEvent<void>
 *
 * Mirrors <script-manager> in structure/styling.
 */

import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import type { ScriptData } from '@archiyou/core/src/execution/types';

import { userState } from '@archiyou/editor/src/state/workspace';
import { fetchMyConfigurators, unpublishConfigurator } from '@archiyou/editor/src/services/publishing';
import { assetUrl } from '@archiyou/editor/src/services/api';
import { OVERLAY_MENU_WIDTH, OVERLAY_MENU_HEIGHT } from '@archiyou/editor/src/settings';
import { onCurrentOrigin } from './publish-constants';

/** Format an ISO date string as "DD/MM/YYYY HH:MM" (locale-aware). */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Compare two semver-ish strings, newest first (descending). Missing/garbage
 *  segments count as 0 so "0.3" sorts above "0.2" and "1.0" above "0.9". */
function cmpVersionDesc(a: string | null | undefined, b: string | null | undefined): number {
  const pa = (a ?? '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = (b ?? '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** A configurator = all published versions that share one file (or name), newest
 *  version first. */
interface ConfiguratorGroup {
  key: string;
  name: string;
  versions: ScriptData[];
}

@customElement('manage-configurators-menu')
export class ManageConfiguratorsMenu extends SignalWatcher(LitElement)
{
  @property({ type: Boolean, reflect: true }) open = false;

  @state() private _status: 'loading' | 'ready' | 'error' = 'loading';
  @state() private _error = '';
  @state() private _items: ScriptData[] = [];
  @state() private _confirmingId: string | null = null;
  @state() private _deletingId: string | null = null;
  /** Per-group (file) selected version id. Absent ⇒ show the latest version. */
  @state() private _selectedByGroup: Record<string, string> = {};

  // ── Render ──

  override render()
  {
    if (!this.open) return nothing;

    if (userState.get().anonymous) return this._renderShell(this._renderSignInRequired());

    return this._renderShell(html`
      <div class="dialog-body">${this._renderBody()}</div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click=${this._cancel}>Close</button>
      </div>
    `);
  }

  /** The modal chrome (backdrop + dialog + header) shared by both states. */
  private _renderShell(inner: unknown)
  {
    return html`
      <div class="backdrop" @click=${this._cancel}></div>
      <div class="dialog" role="dialog" aria-modal="true"
           @click=${(e: Event) => e.stopPropagation()}>
        <div class="dialog-header">
          <wa-icon library="lucide" name="layout-grid"></wa-icon>
          <span class="header-title">Manage configurators</span>
          <button class="close-btn" @click=${this._cancel}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>
        ${inner}
      </div>
    `;
  }

  private _renderBody()
  {
    if (this._status === 'loading')
    {
      return html`<div class="state"><wa-spinner></wa-spinner></div>`;
    }
    if (this._status === 'error')
    {
      return html`<div class="state error">${this._error || 'Could not load your configurators.'}</div>`;
    }
    const groups = this._groups();
    if (groups.length === 0)
    {
      return html`<div class="state">No published configurators yet.</div>`;
    }
    return groups.map(group => this._renderGroup(group));
  }

  /** Bundle the flat version list into per-file configurators, newest version first. */
  private _groups(): ConfiguratorGroup[]
  {
    const map = new Map<string, ScriptData[]>();
    for (const item of this._items)
    {
      const key = item.fileId || item.name || item.id || '';
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }

    const groups: ConfiguratorGroup[] = [];
    for (const [key, versions] of map)
    {
      versions.sort((a, b) => cmpVersionDesc(a.version, b.version));
      const latest = versions[0];
      groups.push({ key, name: latest.published?.title || latest.name || 'Untitled', versions });
    }
    groups.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  /** The version currently shown for a group — the user's pick, else the latest. */
  private _selectedVersion(group: ConfiguratorGroup): ScriptData
  {
    const picked = this._selectedByGroup[group.key];
    return group.versions.find(v => (v.id ?? '') === picked) ?? group.versions[0];
  }

  private _renderGroup(group: ConfiguratorGroup)
  {
    const item = this._selectedVersion(group);
    const id = item.id ?? '';
    const title = group.name;
    const isLatest = (group.versions[0]?.id ?? '') === id;
    const isPublic = item.published?.public ?? false;
    // Stored server-side from FRONTEND_URL at publish time — show it on this origin.
    const url = onCurrentOrigin(item.published?.url);
    const confirming = this._confirmingId === id;
    const deleting = this._deletingId === id;

    return html`
      <div class="item">
        <div class="item-thumb">
          ${item.thumbnail
            ? html`<img src=${assetUrl(item.thumbnail)} alt="" loading="lazy"
                        @error=${(e: Event) => { (e.target as HTMLElement).style.display = 'none'; }}>`
            : html`<wa-icon library="lucide" name="image"></wa-icon>`}
        </div>
        <div class="item-main">
          <div class="item-title-row">
            <span class="item-title" title=${title}>${title}</span>
            ${group.versions.length > 1
              ? html`
                  <select
                    class="version-select"
                    title="Select a version"
                    @click=${(e: Event) => e.stopPropagation()}
                    @change=${(e: Event) => this._selectVersion(group.key, (e.target as HTMLSelectElement).value)}
                  >
                    ${group.versions.map((v, i) => html`
                      <option value=${v.id ?? ''} ?selected=${(v.id ?? '') === id}>
                        v${v.version ?? '—'}${i === 0 ? ' · latest' : ''}
                      </option>`)}
                  </select>`
              : html`<span class="badge">v${item.version ?? '—'}</span>`}
            <span class="badge ${isPublic ? 'badge-public' : 'badge-private'}">
              ${isPublic ? 'public' : 'private'}
            </span>
            ${group.versions.length > 1 && !isLatest
              ? html`<span class="badge badge-old">older</span>`
              : nothing}
          </div>
          <div class="item-meta">created ${fmtDate(item.created)} · updated ${fmtDate(item.updated)}</div>
          ${url
            ? html`<a class="item-url" href=${url} target="_blank" rel="noopener" @click=${(e: Event) => e.stopPropagation()}>${url}</a>`
            : nothing}
        </div>

        <div class="item-actions" @click=${(e: Event) => e.stopPropagation()}>
          ${confirming
            ? html`
                <span class="confirm">
                  <span class="confirm-label">Un-publish?</span>
                  <button class="act yes" title="Confirm" ?disabled=${deleting}
                      @click=${() => this._doDelete(id)}>
                    <wa-icon library="lucide" name="check"></wa-icon>
                  </button>
                  <button class="act no" title="Cancel" ?disabled=${deleting}
                      @click=${() => { this._confirmingId = null; }}>
                    <wa-icon library="lucide" name="x"></wa-icon>
                  </button>
                </span>`
            : html`
                <button class="act" title="Edit this version" @click=${() => this._edit(item)}>
                  <wa-icon library="lucide" name="pencil"></wa-icon>
                </button>
                <button class="act danger" title="Un-publish this version"
                    @click=${() => { this._confirmingId = id; }}>
                  <wa-icon library="lucide" name="trash-2"></wa-icon>
                </button>`}
        </div>
      </div>`;
  }

  private _selectVersion(key: string, versionId: string)
  {
    this._selectedByGroup = { ...this._selectedByGroup, [key]: versionId };
    this._confirmingId = null; // cancel any pending un-publish when switching versions
  }

  private _renderSignInRequired()
  {
    return html`
      <div class="dialog-body">
        <div class="state signin">
          <wa-icon library="lucide" name="lock"></wa-icon>
          <p>You need to be logged in to manage your configurators.</p>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click=${this._cancel}>Close</button>
      </div>
    `;
  }

  // ── Lifecycle ──

  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open && !userState.get().anonymous)
    {
      this._confirmingId = null;
      this._deletingId = null;
      this._selectedByGroup = {}; // each open starts on the latest version
      void this._load();
    }
  }

  // ── Behaviour ──

  private async _load()
  {
    this._status = 'loading';
    this._error = '';
    try
    {
      this._items = await fetchMyConfigurators();
      this._status = 'ready';
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? 'Could not load your configurators.';
      this._status = 'error';
    }
  }

  private async _doDelete(id: string)
  {
    if (!id) return;
    this._deletingId = id;
    try
    {
      await unpublishConfigurator(id);
      this._items = this._items.filter(i => i.id !== id);
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? 'Un-publish failed.';
      this._status = 'error';
    }
    finally
    {
      this._deletingId = null;
      this._confirmingId = null;
    }
  }

  private _edit(item: ScriptData)
  {
    this.dispatchEvent(new CustomEvent<ScriptData>('manage-configurators-edit', {
      detail: item, bubbles: true, composed: true,
    }));
  }

  private _cancel()
  {
    this.dispatchEvent(new CustomEvent('manage-configurators-cancel', { bubbles: true, composed: true }));
  }

  // ── Styles ──

  static override styles = css`
    :host { display: contents; }

    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 200;
    }

    .dialog {
      position: fixed;
      top: 50%; left: 50%;
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
    .header-title { flex: 1; }

    .close-btn {
      width: 24px; height: 24px;
      border: none; background: transparent; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--color-gray-dark, #666);
      border-radius: var(--radius-sm, 4px);
    }
    .close-btn:hover { background: color-mix(in srgb, var(--color-border) 40%, transparent); }

    .dialog-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow-y: auto;
      padding: 12px;
      flex: 1;
    }

    .state {
      padding: 28px 16px;
      text-align: center;
      color: var(--color-text-muted, #666);
      font-size: var(--text-sm);
    }
    .state.error { color: var(--color-alert, #ef4444); font-weight: 500; }
    .state.signin {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
    }
    .state.signin wa-icon { font-size: 28px; color: var(--color-warning, #d97706); }
    .state.signin p { margin: 0; max-width: 340px; line-height: 1.45; }

    /* ── Rows ── */
    .item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg);
    }
    /* contain: the drawing is already square-framed with padding — see the note in
       script-manager-item. Republishing this version regenerates it (the filename is
       content-addressed, so a new drawing always gets a new URL). */
    .item-thumb {
      flex: none; width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted);
    }
    .item-thumb img { width: 100%; height: 100%; object-fit: contain; }

    .item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }

    .item-title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .item-title {
      font-size: var(--text-sm); font-weight: 600; color: var(--color-text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
    }

    .badge {
      flex-shrink: 0;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-xs);
      padding: 1px 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--color-border) 45%, transparent);
      color: var(--color-text-muted);
    }
    .badge-public { background: color-mix(in srgb, var(--color-primary) 18%, transparent); color: var(--color-primary); }
    .badge-private { background: color-mix(in srgb, var(--color-border) 45%, transparent); color: var(--color-text-muted); }
    .badge-old { background: color-mix(in srgb, var(--color-warning, #d97706) 18%, transparent); color: var(--color-warning, #d97706); }

    /* Version picker — styled to sit next to the title like a badge. */
    .version-select {
      flex-shrink: 0;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-xs);
      line-height: 1.4;
      padding: 1px 20px 1px 8px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
      background:
        color-mix(in srgb, var(--color-primary) 12%, transparent)
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23004be3' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")
        no-repeat right 6px center;
      color: var(--color-primary);
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
    }
    .version-select:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    /* Native option list renders in the OS palette; keep text readable. */
    .version-select option { color: var(--color-text); background: var(--color-bg-elevated); }

    .item-meta { font-size: var(--text-xs); color: var(--color-text-muted); }
    .item-url {
      font-family: var(--font-mono, monospace);
      font-size: var(--text-xs);
      color: var(--color-primary);
      text-decoration: none;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
    }
    .item-url:hover { text-decoration: underline; }

    .item-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }

    .act {
      width: 26px; height: 26px;
      border: none; background: transparent; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted, #666);
      border-radius: var(--radius-sm, 4px);
      font-size: 14px;
    }
    .act:hover { background: color-mix(in srgb, var(--color-border) 40%, transparent); color: var(--color-text); }
    .act.danger:hover { color: var(--color-alert, #ef4444); }
    .act:disabled { opacity: 0.4; cursor: not-allowed; }

    .confirm { display: inline-flex; align-items: center; gap: 4px; }
    .confirm-label { font-size: var(--text-xs); color: var(--color-text-muted); }
    .act.yes:hover { color: var(--color-alert, #ef4444); }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .btn-secondary {
      padding: 7px 16px;
      border-radius: var(--radius-sm, 4px);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      background: transparent;
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }
    .btn-secondary:hover { background: color-mix(in srgb, var(--color-border) 30%, transparent); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'manage-configurators-menu': ManageConfiguratorsMenu;
  }
}
