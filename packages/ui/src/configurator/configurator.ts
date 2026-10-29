import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { localized, msg } from '@lit/localize';

import { createExecutionFailureResult, getServerExecutionTarget, runScript, warmupWorker } from '@archiyou/editor/src/services/execution-service';
import { currentParams, listenToHost, metricValues, postToHost, HOST_COMMANDS, type HostCommand } from '@archiyou/editor/src/services/host-events';
import { setExecutionResult, setExecuting, executionResult, bakeAnimations, pipelineModelPath } from '@archiyou/editor/src/state/workspace';
import { configuratorUnitSystemPick } from '@archiyou/editor/src/state/workspace';
import { buildConfiguratorRequest, configuratorValueFor, setConfiguratorValue } from '@archiyou/editor/src/state/configurator';
import { registerViewerParamStore, sendAnimationCommand, type AnimationLoopMode } from '@archiyou/editor/src/state/viewer';
import { applyConfiguratorQuery, configurationQuery, syncConfiguratorParamsToUrl } from '@archiyou/editor/src/state/configurator-url';
import { configuratorDisplay } from '@archiyou/editor/src/state/configurator-display';
import { isPresetKind } from '@archiyou/core/src/animator/standard';
import { refreshPreviewTranslations, clearPreviewTranslations, configuratorLocale } from '@archiyou/editor/src/state/locale';
import { setChromeLocale } from '@archiyou/editor/src/i18n/locale-config';
import { sourceLocale } from '@archiyou/editor/src/i18n/locale-codes';
import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';
import { BREAKPOINT_COMPACT } from '@archiyou/editor/src/styles/design-tokens';

import '../bottom-sheet.js';

import '../viewer/model-viewer.js';
import './configurator-header.js';
import './configurator-controls.js';
import './configurator-metric-bar.js';
import './configurator-attribution.js';
import './configurator-viewer-actions.js';

@localized()
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
    // What the link asked to show (state/configurator-display); the defaults in the preview.
    const display = configuratorDisplay.get();
    return html`
      <!-- One DOM for both layouts, so the viewer is never re-created: on wide
           screens the sheet is docked as the sidebar, on compact ones it slides
           up over the full-screen viewer. -->
      <div class="stage">
        <bottom-sheet class="sidebar" detents="peek half full" ?docked=${!this._compact}>
          <!-- Without the title block (ui.header=0) a phone still needs something to grab. -->
          ${display.header
            ? html`<configurator-header slot="header"></configurator-header>`
            : this._compact ? html`<div slot="header" class="sheet-title">${msg('Parameters')}</div>` : nothing}
          <configurator-controls
            @configurator-params-changed=${this._handleParamsChanged}
          ></configurator-controls>
        </bottom-sheet>

        <div class="viewer-pane">
          <model-viewer
            presentation
            .initialStyle=${display.style}
            .styles=${display.styles}
            ?initialOrtho=${display.ortho}
            .initialGrid=${display.grid}
            menu-placement=${display.menu}
          ></model-viewer>
          <configurator-viewer-actions
            class="viewer-actions"
            ?preview=${this.preview}
            ?embedded=${this.embedded}
          ></configurator-viewer-actions>
          <configurator-attribution class="viewer-attribution"></configurator-attribution>
        </div>
      </div>

      <configurator-metric-bar ?preview=${this.preview} ?without-metrics=${!display.metrics}></configurator-metric-bar>
    `;
  }

  // ── 2. State & Properties ──

  /** True when rendered inside the editor's Configurator Preview dialog: the
   *  viewer offers "Publish as configurator" instead of the embed/view-source
   *  actions a published configurator gets. */
  @property({ type: Boolean, reflect: true }) preview = false;

  /** True when a published configurator is shown inside another site's page
   *  (`?embed=1`): the viewer leaves out its "View source" and "Embed" actions. */
  @property({ type: Boolean, reflect: true }) embedded = false;

  /** Below BREAKPOINT_COMPACT: parameters in a bottom sheet instead of a sidebar.
   *  The styles follow the same breakpoint with a container query. */
  @state() private _compact = false;

  @state() private _executing = false;
  private _runAgain = false;
  private _resizeObserver: ResizeObserver | null = null;
  private _paramExecTimeout: number | null = null;
  private _pendingUnitSystem: string | null = null;
  private _lastUnitSystem: string | null = null;
  private _pendingLocale: string | null = null;
  private _lastLocale: string | null = null;
  private _unregisterParamStore: (() => void) | null = null;

  // What the visitor changed since the last run, and whether the page around an embedded
  // configurator was told that the first model is shown (services/host-events).
  private _changedParams = new Set<string>();
  private _appliedPreset: string | null = null;
  private _readyReported = false;
  // Whether those changes came from commands of that page only, not from the visitor.
  private _changedByHost = false;
  private _changedByVisitor = false;
  private _stopListening: (() => void) | null = null;

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
        Object.entries(values).forEach(([name, value]) =>
        {
          setConfiguratorValue(name, value);
          this._changedParams.add(name);
        });
        this._handleParamsChanged();
      },
    });
    // Buttons on the page around an embedded configurator change the model (services/host-events).
    if (!this.preview) this._stopListening = listenToHost(command => this._handleHostCommand(command));
    // ui.animation=flyin: baked into the first model (and played from firstUpdated)
    const display = configuratorDisplay.get();
    if (!this.preview && display.animation) this._bake(display.animation);
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

    // ...and played as soon as the model is shown: sent now that the viewer is there, which
    // takes the commands sent after it was made
    const display = configuratorDisplay.get();
    if (!this.preview && display.animation) this._animate(display.animation, display.loop);
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
    this._stopListening?.();
    this._stopListening = null;
    // what it baked was for this configurator; the preview's belongs to the editor
    if (!this.preview) bakeAnimations.set(null);
    if (this._paramExecTimeout !== null) clearTimeout(this._paramExecTimeout);
    if (this.preview) clearPreviewTranslations();
    // The editor around the preview, and any page after this one, is not translated.
    this._lastLocale = null;
    void setChromeLocale(sourceLocale);
  }

  // ── 4. Behaviour & Methods ──

  private _handleParamsChanged(e?: Event)
  {
    // A param control says which param it changed, a preset its name.
    const detail = (e as CustomEvent<{ name?: string, preset?: string }> | undefined)?.detail;
    if (detail?.name) this._changedParams.add(detail.name);
    if (detail?.preset) this._appliedPreset = detail.preset;
    this._changedByVisitor = true;
    this._scheduleRun();
  }

  /** The page around the configurator asked for a preset or param values: applied like the
   *  link it would otherwise have to reload with. */
  private _handleHostCommand(command: HostCommand)
  {
    if (command.type === 'animate')
    {
      // one the script declares, or a standard one: nothing else can be made
      const declared = (((executionResult.get()?.state as any)?.animations ?? []) as Array<{ name: string }>).map(a => a.name);
      if (command.name && !declared.includes(command.name) && !isPresetKind(command.name)) return;
      this._animate(command.name, command.loop ?? null);
      return;
    }
    const { preset, changed } = applyConfiguratorQuery(command.query);
    if (!preset && changed.length === 0) return;
    changed.forEach(name => this._changedParams.add(name));
    if (preset) this._appliedPreset = preset;
    this._changedByHost = true;
    this._scheduleRun();
  }

  /** Play an animation of the model (through its own camera, when it has one), or with null
   *  stop it. One the model does not carry yet is baked first, by a run of its own: the
   *  configurator bakes only what its link or page asks for, so a visitor who never sees an
   *  animation waits for none. The viewer plays it once the model with it is shown. */
  private _animate(name: string | null, loop: AnimationLoopMode | null)
  {
    if (!name)
    {
      sendAnimationCommand({ action: 'stop' });
      return;
    }
    if (this._bake(name)) this._execute();
    sendAnimationCommand({ action: 'play', name, follow: true, ...(loop ? { loop } : {}) });
  }

  /** Bake this animation into the model from the next run on. False when it already is. */
  private _bake(name: string): boolean
  {
    const baked = bakeAnimations.get()?.split(',') ?? [];
    if (baked.includes(name)) return false;
    bakeAnimations.set([...baked, name].join(','));
    return true;
  }

  private _scheduleRun()
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
    // A change made while a run is under way gets a run of its own once that one is done.
    if (this._executing)
    {
      this._runAgain = true;
      return;
    }
    this._runAgain = false;
    this._executing = true;
    setExecuting(true);
    const changes = this._takeChanges();

    try
    {
      const result = await runScript(this._buildRequest());
      if (result)
      {
        setExecutionResult(result);
        this._reportToHost(result, changes);
      }
    }
    catch (err)
    {
      console.error('Configurator: execution failed:', err);
      const failure = createExecutionFailureResult(this._buildRequest(), err);
      setExecutionResult(failure);
      this._reportToHost(failure, changes);
    }
    finally
    {
      this._executing = false;
      setExecuting(false);
      if (this._runAgain) this._execute();
    }
  }

  /** What the visitor changed since the last run, with the values this run is made with. */
  private _takeChanges(): { changed: string[], preset: string | null, params: Record<string, unknown>, query: string, byHost: boolean }
  {
    const changes = {
      changed: [...this._changedParams],
      preset:  this._appliedPreset,
      params:  currentParams(),
      query:   configurationQuery(),
      byHost:  this._changedByHost && !this._changedByVisitor,
    };
    this._changedParams.clear();
    this._appliedPreset = null;
    this._changedByHost = false;
    this._changedByVisitor = false;
    return changes;
  }

  /** Tell the page around an embedded configurator what this run shows: the first model,
   *  then each change and preset, and the metrics of every run; or that the model could not
   *  be made. Not in the editor's preview, and a no-op outside a frame (services/host-events). */
  private _reportToHost(result: RunnerScriptExecutionResult, changes: ReturnType<PageConfigurator['_takeChanges']>)
  {
    if (this.preview) return;

    if (result.status !== 'success')
    {
      postToHost({ type: 'error', message: result.errors?.[0]?.message || 'The model could not be made.' });
      return;
    }

    const configuration = { params: changes.params, metrics: metricValues(result.outputs ?? []), query: changes.query };
    const via = changes.byHost ? { via: 'host' as const } : {};
    if (!this._readyReported)
    {
      this._readyReported = true;
      // Since this frame's navigation started: loading the page and the script, (in the
      // browser) the kernel, and the first run.
      postToHost({
        type:      'ready',
        execution: getServerExecutionTarget() ? 'server' : 'client',
        loadMs:    Math.round(performance.now()),
        commands:  HOST_COMMANDS,
        animations: (((result.state as any)?.animations ?? []) as Array<{ name: string }>).map(a => a.name),
        ...configuration,
      });
    }
    if (changes.preset) postToHost({ type: 'preset', preset: changes.preset, ...via, ...configuration });
    if (changes.changed.length > 0) postToHost({ type: 'change', changed: changes.changed, ...via, ...configuration });
    postToHost({ type: 'metrics', ...configuration });
  }

  private _buildRequest(): RunnerScriptExecutionRequest
  {
    // Shared with fulfillment downloads (services/fulfillment.ts) so the files a
    // visitor downloads are always built from the configuration on screen.
    // The model with the animations asked for (pipelineModelPath), as the viewer looks for it.
    return buildConfiguratorRequest([pipelineModelPath('default'), 'default/metrics/*/json']);
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

    .sheet-title
    {
      padding: var(--space-lg) var(--space-lg) var(--space-sm);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--color-text);
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
