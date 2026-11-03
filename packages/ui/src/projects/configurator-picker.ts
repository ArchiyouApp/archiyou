/**
 * <configurator-picker> — a project's "From configurator" (plans/PROJECTS.md).
 *
 * The published configurators as the workspace shows them, in three tabs: the professional's
 * own, those whose script another author shared with them, and the public ones. Choosing one
 * opens it with `?project=<id>`, where "Save as project" reads "Add to P-005": the design goes
 * into this project and the professional comes back to it (services/save-project).
 *
 * Emits:
 *   configurator-picker-close   the dialog closed (after choosing or not): the host resets its flag
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';
import { Router } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '../browser/browser-asset-grid.js';

import type { ScriptData } from '@archiyou/core/src/execution/types';

import type { BrowserAsset, BrowserSection, BrowserSort } from '../browser/browser-asset-grid.js';
import { publicConfiguratorUrl } from '../editor/publish-constants.js';
import { assetUrl } from '@archiyou/editor/src/services/api';
import { fetchPublishedConfigurators } from '@archiyou/editor/src/services/publishing';
import { fetchSharedWithMe } from '@archiyou/editor/src/services/sharing';
import { userState } from '@archiyou/editor/src/state/workspace';

type Tab = 'mine' | 'shared' | 'public';

@customElement('configurator-picker')
export class ConfiguratorPicker extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    // Kept in the tree and driven by `?open`, so wa-dialog plays its show transition
    return html`
      <wa-dialog label=${msg('From configurator')} ?open=${this.open} @wa-after-hide=${this._onAfterHide}>
        ${this.open ? this._renderBody() : nothing}
      </wa-dialog>
    `;
  }

  private _renderBody()
  {
    const empty: Record<Tab, string> = {
      mine: msg('You have not published a configurator yet.'),
      shared: msg('Nobody shared a configurator with you yet.'),
      public: msg('No public configurators yet.'),
    };
    return html`
      <browser-asset-grid
        .sections=${this._sections()}
        section=${this._tab}
        .assets=${this._assets()}
        sort=${this._sort}
        ?loading=${this._loading}
        .error=${this._error}
        emptyText=${empty[this._tab]}
        @section-select=${(e: CustomEvent<Tab>) => { this._tab = e.detail; }}
        @sort-change=${(e: CustomEvent<BrowserSort>) => { this._sort = e.detail; }}
        @asset-open=${this._choose}
      ></browser-asset-grid>
    `;
  }

  // ── 2. Properties, State ──
  @property({ type: Boolean, reflect: true }) open = false;
  /** The project the chosen design goes into. */
  @property({ type: String }) project = '';

  @state() private _tab: Tab = 'mine';
  @state() private _sort: BrowserSort = 'modified';
  @state() private _byTab: Record<Tab, ScriptData[]> = { mine: [], shared: [], public: [] };
  @state() private _loading = false;
  @state() private _error = '';

  // ── 3. Lifecycle ──
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open) void this._load();
  }

  // ── 4. Behaviour & Methods ──
  /** Built per call so the labels follow the locale. */
  private _sections(): BrowserSection[]
  {
    return [
      { id: 'mine', label: msg('My configurators') },
      { id: 'shared', label: msg('Shared with me') },
      { id: 'public', label: msg('Public') },
    ];
  }

  /**
   * Every visit: something may have been published since. `/scripts/published` lists every
   * published configurator, unlisted ones too, so "Shared with me" is narrowed to the scripts
   * other authors shared with this user; the rest of someone else's unlisted ones stay out,
   * as in the workspace.
   */
  private async _load()
  {
    this._loading = true;
    this._error = '';
    try
    {
      const [published, sharedWithMe] = await Promise.all([fetchPublishedConfigurators(), fetchSharedWithMe().catch(() => [])]);
      const me = userState.get().id;
      const sharedFiles = new Set(sharedWithMe.map(d => d.fileId));
      // One card per configurator: a later version replaces an earlier one, as in the workspace
      const latest = [...new Map(published.filter(d => d.fileId).map(d => [d.fileId as string, d])).values()];
      const others = latest.filter(d => !me || d.author !== me);
      this._byTab = {
        mine: latest.filter(d => !!me && d.author === me),
        shared: others.filter(d => d.published?.public !== true && sharedFiles.has(d.fileId)),
        public: others.filter(d => d.published?.public === true),
      };
      if (this._byTab[this._tab].length === 0) this._tab = (['mine', 'shared', 'public'] as Tab[]).find(t => this._byTab[t].length) ?? 'mine';
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? msg('Could not load the configurators.');
    }
    finally
    {
      this._loading = false;
    }
  }

  /** The tab's configurators as cards, sorted. */
  private _assets(): BrowserAsset[]
  {
    const me = userState.get().id;
    const assets = this._byTab[this._tab].map((d): BrowserAsset => ({
      id: d.fileId as string,
      kind: 'configurator',
      name: d.published?.title || d.name || msg('untitled'),
      author: d.author && d.author !== me ? d.author : undefined,
      version: d.version,
      created: Date.parse(d.created ?? '') || undefined,
      updated: Date.parse(d.updated ?? '') || undefined,
      thumbnail: assetUrl(d.thumbnail),
    }));
    return this._sort === 'modified'
      ? assets.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
      : assets.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Open the configurator for this project. */
  private _choose(e: CustomEvent<BrowserAsset>)
  {
    const data = this._byTab[this._tab].find(d => d.fileId === e.detail.id);
    if (!data) return;
    const url = new URL(publicConfiguratorUrl(data.published?.url, data.author ?? '', data.name ?? '', data.version ?? ''), window.location.origin);
    url.searchParams.set('project', this.project);
    this.open = false;
    Router.go(`${url.pathname}${url.search}`);
  }

  private _onAfterHide(e: Event)
  {
    if (e.target !== e.currentTarget) return;
    this.dispatchEvent(new CustomEvent('configurator-picker-close', { bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    wa-dialog {
      --width: min(64rem, 100vw);
    }

    browser-asset-grid {
      min-height: 20rem;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-picker': ConfiguratorPicker;
  }
}
