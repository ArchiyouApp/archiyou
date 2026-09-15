import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';
import { Router } from '@vaadin/router';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import './main-menu-file-menu.js';
import '../configurator/configurator.js';

import { pluginMode } from '@archiyou/editor/src/state/plugin-mode';
import { userState } from '@archiyou/editor/src/state/workspace';
import '@archiyou/editor/src/pages/plugin-app.js';

type MenuItem = 'info' | 'code' | 'history' | 'files' | 'templates' | 'help' | 'settings';

@customElement('editor-main-menu')
export class MainMenu extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const inPluginMode = pluginMode.get() !== null;
    return html`
      <!-- top: hamburger dropdown -->
      <editor-main-menu-file-menu></editor-main-menu-file-menu>

      <!-- sections -->
      <div class="sections">
        <wa-button
          id="btn-code"
          appearance="plain"
          class=${this._active === 'code' ? 'active' : ''}
          @click=${() => this._select('code')}
        ><wa-icon library="lucide" name="code" label="Code editor"></wa-icon></wa-button>
        <wa-tooltip for="btn-code" placement="right">${msg('Code editor')}</wa-tooltip>

        <wa-button
          id="btn-configurator"
          appearance="plain"
          @click=${this._openConfigurator}
        ><wa-icon library="lucide" name=${inPluginMode ? 'app-window' : 'tv-minimal-play'} label=${inPluginMode ? 'App' : 'Preview Configurator'}></wa-icon></wa-button>
        <wa-tooltip for="btn-configurator" placement="right">${inPluginMode ? msg('App') : msg('Preview Configurator')}</wa-tooltip>

      </div>

      <!-- configurator / app preview dialog -->
      <wa-dialog
        class="configurator-dialog"
        label=${inPluginMode ? msg('App') : msg('Configurator Preview')}
        style="--width: 80vw"
        ?open=${this._configuratorOpen}
        @wa-after-hide=${this._onDialogAfterHide}
      >
        ${this._configuratorOpen
          ? (inPluginMode
              ? html`<plugin-app></plugin-app>`
              : html`
                  <page-configurator
                    preview
                    @configurator-publish=${this._publishFromPreview}
                  ></page-configurator>`)
          : ''}
      </wa-dialog>

      <!-- bottom: admin (operators only), templates, help, settings -->
      <div class="bottom">
        ${userState.get().isAdmin
          ? html`
            <wa-button
              id="btn-admin"
              appearance="plain"
              @click=${() => Router.go('/admin')}
            ><wa-icon library="lucide" name="shield-check" label="Admin"></wa-icon></wa-button>
            <wa-tooltip for="btn-admin" placement="right">${msg('Admin')}</wa-tooltip>`
          : nothing}

        <wa-button
          id="btn-templates"
          appearance="plain"
          class=${'dimmed ' + (this._active === 'templates' ? 'active' : '')}
          @click=${() => this._select('templates')}
        ><wa-icon library="lucide" name="rocket" label="Templates"></wa-icon></wa-button>
        <wa-tooltip for="btn-templates" placement="right">${msg('Templates')}</wa-tooltip>

        <wa-button
          id="btn-help"
          appearance="plain"
          class=${'dimmed ' + (this._active === 'help' ? 'active' : '')}
          @click=${() => this._select('help')}
        ><wa-icon library="lucide" name="circle-help" label="Help"></wa-icon></wa-button>
        <wa-tooltip for="btn-help" placement="right">${msg('Help')}</wa-tooltip>

        <wa-button
          id="btn-settings"
          appearance="plain"
          class=${'dimmed ' + (this._active === 'settings' ? 'active' : '')}
          @click=${() => this._select('settings')}
        ><wa-icon library="lucide" name="settings" label="Settings"></wa-icon></wa-button>
        <wa-tooltip for="btn-settings" placement="right">${msg('Settings')}</wa-tooltip>
      </div>

      <!-- configurator dialog -->
    `;
  }

  // ── 2. State, Properties ──
  @property({ type: String }) active: MenuItem | null = 'code';

  @state() private _active: MenuItem | null = 'code';
  @state() private _configuratorOpen = false;

  // ── 3. Lifecycle ──
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('active'))
    {
      this._active = this.active;
    }
  }

  // ── 4. Behaviour & Methods ──
  private _openConfigurator()
  {
    this._configuratorOpen = true;
  }

  /** Only the dialog's *own* hide closes the preview. Web Awesome's overlays
   *  (tooltips, dropdowns, popovers) emit `wa-after-hide` as a composed,
   *  bubbling event, so a tooltip dismissed anywhere inside the configurator
   *  used to reach this listener and tear the whole dialog down. */
  private _onDialogAfterHide(e: Event)
  {
    if (e.target !== e.currentTarget) return;
    this._configuratorOpen = false;
  }

  /** Close the preview and route into the "Publish as configurator" flow. The
   *  event bubbles (composed) up to the editor's @menu-action handler, which
   *  opens <publish-script-menu>. */
  private _publishFromPreview()
  {
    this._configuratorOpen = false;
    this.dispatchEvent(new CustomEvent('menu-action', {
      detail: 'publish',
      bubbles: true,
      composed: true,
    }));
  }

  private _select(item: MenuItem)
  {
    this._active = this._active === item ? null : item;
    this.dispatchEvent(new CustomEvent('menu-select', {
      detail: this._active,
      bubbles: true,
      composed: true,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 48px;
      padding-right: 8px;
      padding-left: 8px;
      padding-top: var(--space-sm);
      padding-bottom: var(--space-sm);
      flex-shrink: 0;
      background: var(--color-bg-elevated);
      border-right: 1px solid var(--color-border);
      align-items: center;
      gap: var(--space-1, 4px);
      position: relative;
      z-index: 20;
    }

    .sections {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1, 4px);
      flex: 1;
      margin-top: var(--space-sm, 8px);
    }

    .bottom {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1, 4px);
      margin-top: auto;
    }

    /* Not built yet: present, but kept in the background. */
    wa-button.dimmed {
      opacity: 0.2;
    }

    wa-button.active::part(base) {
      background-color: var(--color-primary-subtle, color-mix(in srgb, var(--color-primary) 15%, transparent));
      color: var(--color-primary);
    }

    .configurator-dialog::part(dialog)
    {
      height: 80vh;
    }

    .configurator-dialog::part(header)
    {
      padding-block-start: 0; /* hack ugly margin top */
    }

    .configurator-dialog::part(title) 
    {
      font-size: var(--text-sm);
      line-height: var(--text-sm);
    }

    .configurator-dialog::part(body)
    {
      padding: 0;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    page-configurator,
    plugin-app
    {
      flex: 1;
      min-height: 0;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-main-menu': MainMenu;
  }
}
