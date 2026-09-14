/**
 * page-published-configurator — standalone configurator for a published script.
 *
 * Served at /configurators/:user/:scriptAndVersion (a top-level route, no editor
 * nav-bar, so it is embeddable). Fetches the published script from the backend,
 * loads it as the active (read-only) script via openSharedScript(), then renders
 * the shared <page-configurator>. The configurator warms up the worker and runs
 * the script on mount, so it is only rendered once the script is loaded.
 *
 * This is also where the execution backend is chosen. A version an admin has marked
 * `published.validated` runs SERVER-SIDE, which means this page never loads the CAD
 * kernel — ~26MB it would otherwise download just to show a GLB and a metrics bar.
 * The decision has to be made here, before <page-configurator> mounts and calls
 * warmupWorker(). `?exec=client` forces the browser kernel for debugging (comparing
 * the two backends is how you check a server result renders identically).
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { type RouterLocation } from '@vaadin/router';

import type { ScriptData } from '@archiyou/core/src/execution/types';

import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@archiyou/ui/configurator/configurator.js';

import { openSharedScript } from '../state/workspace';
import { applyConfiguratorParamsFromQuery } from '../state/configurator-url';
import { applyLocaleFromQuery } from '../state/locale';
import { fetchPublishedScriptVersion } from '../services/publishing.js';
import { setServerExecutionTarget, type ServerExecutionTarget } from '../services/execution-service.js';

@customElement('page-published-configurator')
export class PagePublishedConfigurator extends SignalWatcher(LitElement)
{
  @property({ attribute: false }) location?: RouterLocation;

  @state() private _status: 'loading' | 'ready' | 'error' = 'loading';
  @state() private _error = '';

  override connectedCallback()
  {
    super.connectedCallback();
    // ?lang=de wins over the browser's preference: a link shared in one language should
    // open in that language for whoever follows it.
    applyLocaleFromQuery(window.location.search);
    void this._load();
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    // The target is module-scoped, so it MUST NOT outlive this page: navigating on to
    // the editor would otherwise leave it POSTing this configurator's script instead of
    // running the one being edited. <layout-main> clears it too, so neither teardown
    // order can leave a stale one behind.
    setServerExecutionTarget(null);
  }

  private async _load()
  {
    const params = (this.location?.params ?? {}) as Record<string, string>;
    const user = params.user;
    const scriptAndVersion = params.scriptAndVersion;

    if (!user || !scriptAndVersion)
    {
      this._status = 'error';
      this._error = 'Invalid configurator URL.';
      return;
    }

    try
    {
      const data = await fetchPublishedScriptVersion(user, scriptAndVersion);
      if (!data)
      {
        this._status = 'error';
        this._error = `Configurator “${user}/${scriptAndVersion}” was not found.`;
        return;
      }
      // Load read-only as the active script; the configurator picks it up.
      openSharedScript(data as unknown as Record<string, any>);
      // Before <page-configurator> mounts: it calls warmupWorker() on connect, which
      // is a no-op once a server target is set. Getting here late would download the
      // kernel anyway and waste the whole point.
      setServerExecutionTarget(this._serverTarget(user, scriptAndVersion, data));
      // ?WIDTH=1200&SHELVES=4 — a shared link opens on that exact model. Applied
      // after the script is loaded (its params are what type the raw strings) and
      // before <page-configurator> mounts, so the first run is already the right one.
      applyConfiguratorParamsFromQuery(window.location.search);
      this._status = 'ready';
    }
    catch (err)
    {
      this._status = 'error';
      this._error = (err as Error)?.message ?? 'Failed to load the configurator.';
    }
  }

  /** Server-side when an admin validated this version, unless ?exec=client says
   *  otherwise. Null ⇒ run in the browser, as before.
   *
   *  `validated` is server-owned (the API stamps it on read and refuses client
   *  writes), so trusting it here is safe — and it is only a hint regardless: the
   *  execute endpoint re-checks it and 401s if it is not actually set. */
  private _serverTarget(user: string, scriptAndVersion: string, data: ScriptData): ServerExecutionTarget | null
  {
    const exec = new URLSearchParams(window.location.search).get('exec');
    if (exec === 'client') return null;
    if (data.published?.validated !== true) return null;
    return { user, scriptAndVersion };
  }

  override render()
  {
    if (this._status === 'loading')
    {
      return html`<div class="center"><wa-spinner></wa-spinner></div>`;
    }
    if (this._status === 'error')
    {
      return html`
        <div class="center error">
          <wa-icon library="lucide" name="triangle-alert"></wa-icon>
          <p>${this._error}</p>
        </div>`;
    }
    return html`<page-configurator></page-configurator>`;
  }

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100vh;
      background: var(--color-bg, #fff);
    }

    page-configurator {
      /* Must stay flex column — the component lays out its split-panel (fills)
         and the fixed-height metric bar as flex children. A plain display of
         block here overrides the component's own :host rule and collapses the
         layout, making the metric bar drift with the split divider. */
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    }

    .center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      height: 100vh;
      font-family: var(--font-sans);
      color: var(--color-text-muted, #666);
    }
    .center.error wa-icon { font-size: 32px; color: var(--color-warning, #d97706); }
    .center.error p { margin: 0; font-size: var(--text-sm, 0.875rem); max-width: 380px; text-align: center; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-published-configurator': PagePublishedConfigurator;
  }
}
