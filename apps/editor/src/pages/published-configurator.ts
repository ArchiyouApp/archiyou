/**
 * page-published-configurator — standalone configurator for a published script.
 *
 * Served at /configurators/:user/:scriptAndVersion (a top-level route, no editor
 * nav-bar, so it is embeddable). Fetches the published script from the backend,
 * loads it as the active (read-only) script via openSharedScript(), then renders
 * the shared <page-configurator>. The configurator warms up the worker and runs
 * the script on mount, so it is only rendered once the script is loaded.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { type RouterLocation } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@archiyou/ui/configurator/configurator.js';

import { openSharedScript } from '../state/workspace';
import { applyConfiguratorParamsFromQuery } from '../state/configurator-url';
import { applyLocaleFromQuery } from '../state/locale';
import { fetchPublishedScriptVersion } from '../services/publishing.js';

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
