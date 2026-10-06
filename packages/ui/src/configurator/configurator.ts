import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import { createExecutionFailureResult, runScript, warmupWorker } from '@archiyou/editor/src/services/execution-service';
import { setExecutionResult, setExecuting } from '@archiyou/editor/src/state/workspace';
import { configuratorUnitSystemPick } from '@archiyou/editor/src/state/workspace';
import { buildConfiguratorRequest, configuratorValueFor, setConfiguratorValue } from '@archiyou/editor/src/state/configurator';
import { registerViewerParamStore } from '@archiyou/editor/src/state/viewer';
import { syncConfiguratorParamsToUrl } from '@archiyou/editor/src/state/configurator-url';
import { refreshPreviewTranslations, clearPreviewTranslations, configuratorLocale } from '@archiyou/editor/src/state/locale';
import { setChromeLocale } from '@archiyou/editor/src/i18n/locale-config';
import { sourceLocale } from '@archiyou/editor/src/i18n/locale-codes';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';
import { BREAKPOINT_COMPACT } from '@archiyou/editor/src/styles/design-tokens';

import '../bottom-sheet.js';

import '../viewer/model-viewer.js';
import './configurator-header.js';
import './configurator-controls.js';
import './configurator-metric-bar.js';
import './configurator-attribution.js';
import './configurator-viewer-actions.js';

@customElement('page-configurator')
export class PageConfigurator extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    // Track the end-user's pick so a switch triggers a re-run (dims/docs are formatted at
    // execution time). The pick, not the display system: that also moves when a run
    // reports the model's units().
    this._pendingUnitSystem = configuratorUnitSystemPick.get() ?? '';
    // The buttons and labels follow the language picker, like the content does.
    this._pendingLocale = configuratorLocale.get();
    return html`
      <!-- One DOM for both layouts, so the viewer is never re-created: on wide
           screens the sheet is docked as the sidebar, on compact ones it slides
           up over the full-screen viewer. -->
      <div class="stage">
        <bottom-sheet class="sidebar" detents="peek half full" ?docked=${!this._compact}>
          <configurator-header slot="header"></configurator-header>
          <configurator-controls
            @configurator-params-changed=${this._handleParamsChanged}
          ></configurator-controls>
        </bottom-sheet>

        <div class="viewer-pane">
          <model-viewer presentation></model-viewer>
          <configurator-viewer-actions
            class="viewer-actions"
            ?preview=${this.preview}
          ></configurator-viewer-actions>
          <configurator-attribution class="viewer-attribution"></configurator-attribution>
        </div>
      </div>

      <configurator-metric-bar ?preview=${this.preview}></configurator-metric-bar>
    `;
  }

  // ── 2. State & Properties ──

  /** True when rendered inside the editor's Configurator Preview dialog: the
   *  viewer offers "Publish as configurator" instead of the embed/view-source
   *  actions a published configurator gets. */
  @property({ type: Boolean, reflect: true }) preview = false;

  /** Below BREAKPOINT_COMPACT: parameters in a bottom sheet instead of a sidebar.
   *  The styles follow the same breakpoint with a container query. */
  @state() private _compact = false;

  @state() private _executing = false;
  private _resizeObserver: ResizeObserver | null = null;
  private _paramExecTimeout: number | null = null;
  private _pendingUnitSystem: string | null = null;
  private _lastUnitSystem: string | null = null;
  private _pendingLocale: string | null = null;
  private _lastLocale: string | null = null;
  private _unregisterParamStore: (() => void) | null = null;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    // The host's own width, not the window's: the configurator also runs inside
    // the editor's preview dialog and in third-party iframes.
    this._resizeObserver = new ResizeObserver(([entry]) =>
    {
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      this._compact = entry.contentRect.width < parseFloat(BREAKPOINT_COMPACT) * rootFontSize;
    });
    this._resizeObserver.observe(this);
    // Handle drags and dimension edits in the viewer are param edits like the menu's:
    // they go into this configurator's values and its run, not the editor's script.
    this._unregisterParamStore = registerViewerParamStore({
      value: p => configuratorValueFor(p),
      set:   values =>
      {
        Object.entries(values).forEach(([name, value]) => setConfiguratorValue(name, value));
        this._handleParamsChanged();
      },
    });
    warmupWorker()
      .then(() => this._execute())
      .catch(err =>
      {
        console.error('Configurator: worker init failed:', err);
        setExecutionResult(createExecutionFailureResult(this._buildRequest(), err));
      });
  }

  override firstUpdated()
  {
    // In the editor the script is the working copy, which carries no translations: show
    // the published version's, fetched now so the latest set is the one previewed.
    if (this.preview) void refreshPreviewTranslations();
  }

  override updated()
  {
    if (this._pendingLocale !== this._lastLocale)
    {
      this._lastLocale = this._pendingLocale;
      if (this._pendingLocale) void setChromeLocale(this._pendingLocale);
    }

    // Local unit-system flip → re-run so dimension/doc text reformats.
    if (this._lastUnitSystem !== null && this._pendingUnitSystem !== this._lastUnitSystem)
    {
      this._lastUnitSystem = this._pendingUnitSystem;
      this._execute();
    }
    else
    {
      this._lastUnitSystem = this._pendingUnitSystem;
    }
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._unregisterParamStore?.();
    this._unregisterParamStore = null;
    if (this._paramExecTimeout !== null) clearTimeout(this._paramExecTimeout);
    if (this.preview) clearPreviewTranslations();
    // The editor around the preview, and any page after this one, is not translated.
    this._lastLocale = null;
    void setChromeLocale(sourceLocale);
  }

  // ── 4. Behaviour & Methods ──

  private _handleParamsChanged()
  {
    // Keep the address bar on the model being shown, so the link a visitor copies is
    // this configuration. Not in the preview: there the address bar is the editor's.
    if (!this.preview) syncConfiguratorParamsToUrl();

    if (this._paramExecTimeout !== null) clearTimeout(this._paramExecTimeout);
    this._paramExecTimeout = window.setTimeout(() =>
    {
      this._paramExecTimeout = null;
      this._execute();
    }, 300);
  }

  private async _execute()
  {
    if (this._executing) return;
    this._executing = true;
    setExecuting(true);

    try
    {
      const result = await runScript(this._buildRequest());
      if (result) setExecutionResult(result);
    }
    catch (err)
    {
      console.error('Configurator: execution failed:', err);
      setExecutionResult(createExecutionFailureResult(this._buildRequest(), err));
    }
    finally
    {
      this._executing = false;
      setExecuting(false);
    }
  }

  private _buildRequest(): RunnerScriptExecutionRequest
  {
    // Shared with fulfillment downloads (services/fulfillment.ts) so the files a
    // visitor downloads are always built from the configuration on screen.
    return buildConfiguratorRequest(['default/model/glb', 'default/metrics/*/json']);
  }


  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: var(--color-bg);
      container: configurator / inline-size;
    }

    .stage
    {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: clamp(300px, 33%, 420px) 1fr;
      /* Header row of the sheet when it rests at "peek" on compact screens. */
      --sheet-peek: 64px;
    }

    .sidebar
    {
      background: var(--color-bg-elevated);
      border-right: 1px solid var(--color-border);
    }

    /* Positioning context for the viewer overlays (attribution + actions). */
    .viewer-pane
    {
      position: relative;
      min-width: 0;
      overflow: hidden;
    }

    model-viewer
    {
      display: block;
      width: 100%;
      height: 100%;
    }

    .viewer-attribution
    {
      position: absolute;
      right: var(--space-md);
      bottom: var(--space-sm);
      z-index: 12;
    }

    .viewer-actions
    {
      position: absolute;
      right: var(--space-md);
      top: var(--space-md);
      z-index: 12;
    }

    configurator-metric-bar
    {
      flex-shrink: 0;
    }

    /* ── Compact: full-screen viewer, parameters in the bottom sheet ── */
    @container configurator (width < ${unsafeCSS(BREAKPOINT_COMPACT)})
    {
      .stage
      {
        display: block;
        position: relative;
      }

      .sidebar { border-right: none; }

      /* Ends above the resting sheet, so the model is framed in what stays visible. */
      .viewer-pane
      {
        position: absolute;
        inset: 0 0 var(--sheet-peek) 0;
      }

      /* Top-left, clear of the viewer menu along the bottom edge. */
      .viewer-attribution
      {
        right: auto;
        left: var(--space-sm);
        top: var(--space-sm);
        bottom: auto;
        /* The feedback panel opens below the bar instead of above it. */
        flex-direction: column-reverse;
        align-items: flex-start;
      }

      .viewer-actions
      {
        right: var(--space-sm);
        top: var(--space-sm);
      }
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-configurator': PageConfigurator;
  }
}
