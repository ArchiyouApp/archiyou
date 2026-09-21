import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { type RouterLocation } from '@vaadin/router';

import { createExecutionFailureResult, runScript, warmupWorker } from '../services/execution-service';
import { scheduleWorkingThumbnail } from '../services/thumbnails';
import { getOutput } from '@archiyou/core/src/runner/worker/output';
import { authService } from '../services/auth-service';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';

import '@archiyou/ui/editor/main-menu.js';
import '@archiyou/ui/editor/codebox.js';
import '@archiyou/ui/viewer/model-viewer.js';
import '@archiyou/ui/params/param-menu.js';
import '@archiyou/ui/params/presets-menu.js';
import '@archiyou/ui/editor/toolbar.js';
import '@archiyou/ui/editor/tool-panels.js';
import '@archiyou/ui/editor/tools/scene-tool.js';
import '@archiyou/ui/editor/tools/data-tool.js';
import '@archiyou/ui/editor/tools/metrics-tool.js';
import '@archiyou/ui/editor/tools/document-viewer.js';
import '@archiyou/ui/editor/tools/instruct-tool.js';
import '@archiyou/ui/editor/tools/console-tool.js';
import '@archiyou/ui/editor/tools/profiling-tool.js';
import '@archiyou/ui/editor/tools/help-tool.js';
import '@archiyou/ui/editor/file-info.js';
import '@archiyou/ui/editor/script-manager.js';
import '@archiyou/ui/editor/script-importer.js';
import '@archiyou/ui/editor/share-script-menu.js';
import '@archiyou/ui/editor/publish-script-menu.js';
import '@archiyou/ui/editor/manage-configurators-menu.js';
import '@archiyou/ui/editor/modules-menu.js';
import type { ToolDef } from '@archiyou/ui/editor/toolbar.js';

import { editorScript, executing, executionResult, scenegraph, scriptParams, scripts, updateScriptCode, setExecutionResult, setExecuting, paramValue, createNewScript, openScript, openSharedScript, deleteScriptById, importScriptFromData, isReadOnly, isScriptNameTaken, selectedPath, scriptUnitSystem, ensureScriptUnitSystem, perStatement, kernel, autoRun, wasActiveScriptRestored } from '../state/workspace';
import { editorPathFor, resolveScriptLink } from '../services/script-links';
import { registerScheduleExecution, triggerResetCamera } from '../state/viewer';
import { registerHelpRunner, openHelpDoc, claimOnboarding, ONBOARDING_PATH } from '../state/help';
import { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';
import type { ScriptData } from '@archiyou/core/src/execution/types';

/** Model formats offered in the main menu ▸ Export to… (see _exportModel()) */
type ExportModelFormat = 'glb'|'stl'|'amf'|'dae'|'svg'|'dxf'|'fcstd'|'ifc'|'scad'|'btlx';

@customElement('page-editor')
export class PageEditor extends SignalWatcher(LitElement)
{
  //// SETTINGS ////
  CONST_AUTORUN_DELAY = 1000;    // ms to wait after code changes before auto-running
  CONST_AUTORUN_MIN_SIZE = 20;   // minimum code length to trigger auto-run

  /** Toolbar order, top to bottom. */
  readonly TOOLS: ToolDef[] = [
    { id: 'console', icon: 'terminal',   name: 'Console',   exclusive: false, component: 'editor-console-tool',  width: 30, height: 50 },
    { id: 'scene',   icon: 'network',    name: 'Scene',     exclusive: false, component: 'editor-scene-tool',    width: 30, height: 50 },
    { id: 'data',    icon: 'table',      name: 'Data',      exclusive: false, component: 'editor-data-tool',     width: 30, height: 50 },
    { id: 'metrics', icon: 'chart-bar',  name: 'Metrics',   exclusive: false, component: 'editor-metrics-tool',  width: 30, height: 50,  outputs: ['default/metrics/*/json'] },
    { id: 'docs',    icon: 'file-text',  name: 'Documents', exclusive: true,  component: 'editor-document-tool', width: 40, height: 100, outputs: ['default/docs/*/svg', 'default/docs/*/svg-pages'] },
    { id: 'instruct', icon: 'list-ordered', name: 'Instructions', exclusive: false, component: 'editor-instruct-tool', width: 30, height: 50 },
    { id: 'profiling', icon: 'timer',    name: 'Profiling', exclusive: false, component: 'editor-profiling-tool', width: 30, height: 50 },
    { id: 'help',      icon: 'circle-help', name: 'Help',   exclusive: false, component: 'editor-help-tool',     width: 32, height: 60, align: 'end' },
  ];

  //// 

  override render()
  {
    // Track the script's unit system so a flip re-runs to regenerate doc/SVG text.
    this._pendingUnitSystem = scriptUnitSystem.get();
    // Same for the geometry kernel — read here so SignalWatcher tracks it.
    this._pendingKernel = kernel.get();
    return html`
      <editor-main-menu
        data-help="main-menu"
        .active=${this._activeSection}
        @menu-action=${this._handleMenuAction}
        @menu-select=${this._handleMenuSelect}
      ></editor-main-menu>
      ${this._linkError ? html`
        <div class="link-error" role="alert">
          <wa-icon library="lucide" name="link-2-off"></wa-icon>
          <span class="link-error-text">${this._linkError}</span>
          <button class="link-error-close" title="Dismiss" @click=${() => (this._linkError = '')}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>` : ''}
      ${this._notice && !this._linkError ? html`
        <div class="link-error notice" role="status">
          <wa-icon library="lucide" name="info"></wa-icon>
          <span class="link-error-text">${this._notice}</span>
          <button class="link-error-close" title="Dismiss" @click=${() => (this._notice = '')}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>` : ''}
      <wa-split-panel
            position="50"
            snap="25% 50% 75%"
        >
        <wa-icon class="split-grip"
            slot="divider" library="lucide" name="grip-vertical"></wa-icon>
        <div class="left-panel" slot="start">
          <editor-file-info data-help="file-info" @script-forked=${this._handleScriptForked}></editor-file-info>
          <presets-menu></presets-menu>
          <param-menu data-help="params" @param-value-change=${() => this._scheduleParamExecute()}></param-menu>
          <editor-code-box
              data-help="code"
              .code=${editorScript.get()?.code ?? ''}
              ?readonly=${isReadOnly.get()}
            @change=${this._handleCodeChange}
            @execute=${this._handleExecute}
          ></editor-code-box>
        </div>
        <wa-split-panel
          slot="end"
          class="viewer-tools-split"
          position=${this._activeTools.length > 0 ? 100 - this._activeTools.reduce((max, t) => Math.max(max, t.width), 0) : 100}
        >
          ${this._activeTools.length > 0 ? html`<wa-icon slot="divider" class="split-grip" library="lucide" name="grip-vertical"></wa-icon>` : ''}
          <model-viewer slot="start" data-help="viewer"></model-viewer>
          <editor-tool-panels
            slot="end"
            .tools=${this._activeTools}
            @tool-close=${this._handleToolClose}
          ></editor-tool-panels>
        </wa-split-panel>
      </wa-split-panel>
      <editor-toolbar
        data-help="toolbar"
        .tools=${this.TOOLS}
        .activeIds=${this._activeTools.map(t => t.id)}
        @tool-toggle=${this._handleToolToggle}
      ></editor-toolbar>
      <script-manager
        ?open=${this._showScriptManager}
        @script-manager-open=${this._handleScriptManagerOpen}
        @script-manager-open-shared=${this._handleScriptManagerOpenShared}
        @script-manager-cancel=${this._handleScriptManagerCancel}
        @script-delete=${this._handleScriptDelete}
      ></script-manager>
      <share-script-menu
        ?open=${this._showShareMenu}
        @share-script-done=${this._handleShareDone}
        @share-script-cancel=${this._handleShareCancel}
      ></share-script-menu>
      <publish-script-menu
        ?open=${this._showPublishMenu}
        .editData=${this._editConfigurator}
        @publish-script-done=${this._handlePublishDone}
        @publish-script-cancel=${this._handlePublishCancel}
      ></publish-script-menu>
      <manage-configurators-menu
        ?open=${this._showManageConfigurators}
        @manage-configurators-edit=${this._handleManageConfiguratorsEdit}
        @manage-configurators-cancel=${this._handleManageConfiguratorsCancel}
      ></manage-configurators-menu>
      <editor-modules-menu
        ?open=${this._showModules}
        @modules-menu-cancel=${() => { this._showModules = false; }}
      ></editor-modules-menu>
      <script-importer
        ?open=${this._showScriptImporter}
        @script-importer-cancel=${this._handleScriptImporterCancel}
        @script-importer-import=${this._handleScriptImporterImport}
      ></script-importer>
      <wa-dialog
        class="delete-dialog"
        label="Delete script"
        ?open=${this._showDeleteConfirm}
        @wa-after-hide=${this._handleDeleteDialogAfterHide}
      >
        <p class="delete-message">
          Delete <strong>${editorScript.get()?.name ?? 'this script'}</strong>? This removes it
          from your scripts here and on the server, and cannot be undone.
        </p>
        <wa-button slot="footer" appearance="outlined" @click=${this._handleDeleteCancel}>
          Cancel
        </wa-button>
        <wa-button slot="footer" variant="danger" @click=${this._handleDeleteConfirm}>
          Delete
        </wa-button>
      </wa-dialog>
    `;
  }

  // Properties
  @property({ attribute: false }) location?: RouterLocation;

  @state() private _activeSection: 'info' | 'code' | 'history' | 'files' | 'templates' | 'help' | 'settings' | null = 'code';
  @state() private _activeTools: ToolDef[] = [];
  @state() private _showScriptManager = false;
  @state() private _showScriptImporter = false;
  @state() private _showShareMenu = false;
  @state() private _showPublishMenu = false;
  @state() private _showManageConfigurators = false;
  @state() private _showModules = false;
  @state() private _showDeleteConfirm = false;
  // Non-null → the publish menu opens in edit mode for this published version.
  @state() private _editConfigurator: ScriptData | null = null;
  // Why a /editor/{…} deep link could not be opened (empty = no problem).
  @state() private _linkError = '';
  // Informational popup, same look as the link error (empty = hidden). See _showNotice().
  @state() private _notice = '';
  private _noticeTimer?: ReturnType<typeof setTimeout>;


  // Lifecycle
  override connectedCallback()
  {
    super.connectedCallback();
    // Register execution callback so the viewer can trigger re-execution
    // when a handle (or other interaction) changes a param value.
    registerScheduleExecution(() => this._scheduleParamExecute());
    // The help panel's tutorials put code in the editor and run it through here
    registerHelpRunner(code => void this._runHelpCode(code));
    // Default: open scene tool
    const sceneTool = this.TOOLS.find(t => t.id === 'scene');
    if (sceneTool) this._activeTools = [sceneTool];

    this._consumeNewQueryParam();
    void this._consumeScriptLink();
    // A tutorial link wins over the first-visit tour. Either way the help panel gets
    // the tool area to itself, instead of half of it under the scene tool.
    const tutorial = this._consumeTutorialQueryParam();
    const tour = !tutorial && claimOnboarding();
    if (tour) void openHelpDoc(ONBOARDING_PATH);
    if (tutorial || tour) this._activeTools = this.TOOLS.filter(t => t.id === 'help');

    console.info('Editor::connectedCallback(): Warming up worker…');
    warmupWorker()
      .then(() => {
        console.info('Editor::connectedCallback(): Worker ready');
        this.checkAutoRun(true);
      })
      .catch(err => {
        console.error('Editor: worker init failed:', err);
        setExecutionResult(createExecutionFailureResult({
          kernel: 'mesh',
          script: editorScript.get()?.toData() as any,
        } as any, err));
      });
  }

  override willUpdate(changed: Map<string, unknown>)
  {
    // Also handle in-place navigation to /editor?new (Vaadin Router may
    // re-resolve the route without a full re-mount).
    if (changed.has('location'))
    {
      this._consumeNewQueryParam();
      void this._consumeScriptLink();
      this._consumeTutorialQueryParam();
    }
  }

  override updated()
  {
    this._reflectScriptUrl();

    // Persist a default (metric) unit system onto any script that has none, so
    // every script carries an explicit setting. Idempotent — runs once per script.
    ensureScriptUnitSystem();

    // Metric/Imperial flip → re-run so doc/SVG dimension text regenerates with
    // the new units (3D dims + readouts already update live). Skip the first
    // paint (no prior value) to avoid an extra run on load.
    if (this._lastUnitSystem !== null && this._pendingUnitSystem !== this._lastUnitSystem)
    {
      this._lastUnitSystem = this._pendingUnitSystem;
      this.checkAutoRun(true);
    }
    else
    {
      this._lastUnitSystem = this._pendingUnitSystem;
    }

    // Kernel flip → re-run, so the viewer immediately shows the same script built by the
    // other kernel. Same first-paint guard as above.
    if (this._lastKernel !== null && this._pendingKernel !== this._lastKernel)
    {
      this._lastKernel = this._pendingKernel;
      this.checkAutoRun(true);
    }
    else
    {
      this._lastKernel = this._pendingKernel;
    }
  }

  private _pendingUnitSystem: string | null = null;
  private _lastUnitSystem: string | null = null;
  private _pendingKernel: string | null = null;
  private _lastKernel: string | null = null;

  // ── Script deep links (/editor/{name}[:{version}], /editor/{author}/{name}[:{version}]) ──

  /** The link currently being (or already) resolved — guards against re-resolving
   *  the same URL on every `location` update, and against the URL reflection
   *  below racing an in-flight resolution. */
  private _resolvedLink: string | null = null;
  private _resolvingLink = false;

  /** What the editor is showing instead, for a failed deep link — the load
   *  never touches the active script, so this is always still accurate. */
  private _fallbackStateMessage(): string
  {
    const name = editorScript.get()?.name ?? 'untitled';
    return wasActiveScriptRestored
      ? `The editor kept the script that was already open, “${name}”.`
      : `The editor started a new script, “${name}” (nothing was saved in this browser yet).`;
  }

  /** Open the script addressed by the URL, if any. Failures leave the current
   *  script alone and show a dismissible popup. */
  private async _consumeScriptLink()
  {
    const params = (this.location?.params ?? {}) as Record<string, string>;
    const scriptAndVersion = params.scriptAndVersion;
    const author = params.author ?? null;
    if (!scriptAndVersion) { this._resolvedLink = null; return; }

    const key = author ? `${author}/${scriptAndVersion}` : scriptAndVersion;
    if (this._resolvedLink === key) return;   // already handled this URL
    this._resolvedLink = key;
    this._linkError = '';
    this._resolvingLink = true;

    try
    {
      const result = await resolveScriptLink(author, scriptAndVersion);
      if (!result.ok)
      {
        this._linkError = `${result.message} ${this._fallbackStateMessage()}`;
        console.warn(`Editor: script link "${key}" — ${result.reason}: ${result.message}`);
        return;
      }
      // Canonicalise the URL now (e.g. ":latest" → the version actually loaded)
      // rather than waiting for the next render.
      this._resolvingLink = false;
      this._reflectScriptUrl();
      triggerResetCamera();
      void this._handleExecute();
    }
    catch (err)
    {
      this._linkError = `Could not open “${key}”: ${(err as Error)?.message ?? err} ${this._fallbackStateMessage()}`;
    }
    finally
    {
      this._resolvingLink = false;
    }
  }

  /** Keep the address bar on the active script so the URL is always copy-able.
   *  Own scripts link by name only (their working copy is the latest); a name
   *  shared by several local scripts would be ambiguous, so those stay on the
   *  bare /editor path. `replaceState` — no history entry, no re-navigation. */
  private _reflectScriptUrl()
  {
    if (this._resolvingLink) return;

    const script = editorScript.get();
    const name = script?.name;

    // Ambiguous own name (e.g. several "untitled") → don't advertise a link
    // that could resolve to a different script later.
    const ambiguous = !!name && !isReadOnly.get() && isScriptNameTaken(name, script?.fileId);
    const target = ambiguous ? '/editor' : editorPathFor(script);

    if (window.location.pathname === target) return;
    if (!window.location.pathname.startsWith('/editor')) return;   // navigated away

    history.replaceState(null, '', `${target}${window.location.search}`);
    // Mirror the router's (decoded) param form so this URL isn't resolved again.
    this._resolvedLink = target === '/editor'
      ? null
      : target.slice('/editor/'.length).split('/').map(decodeURIComponent).join('/');
  }

  /** If the URL has a `new` query param, archive the active script,
   *  create a fresh one, then clean the URL so a refresh doesn't repeat. */
  private _consumeNewQueryParam()
  {
    try
    {
      const params = new URL(window.location.href).searchParams;
      if (!params.has('new')) return;
      createNewScript();
      history.replaceState(null, '', '/editor');
    }
    catch (err)
    {
      console.warn('Editor::_consumeNewQueryParam():', err);
    }
  }

  /** `/editor?tutorial=<name>` opens the help panel on that tutorial (in a new script),
   *  then cleans the URL so a refresh doesn't start it again. Returns true when the
   *  param was there. */
  private _consumeTutorialQueryParam(): boolean
  {
    try
    {
      const url = new URL(window.location.href);
      const name = url.searchParams.get('tutorial');
      if (name === null) return false;

      url.searchParams.delete('tutorial');
      history.replaceState(null, '', `${url.pathname}${url.search}`);
      this._openTool('help');
      void openHelpDoc(`tutorials/${name}`).then(found =>
      {
        if (!found) this._showNotice(`There is no tutorial called “${name}”.`);
      });
      return true;
    }
    catch (err)
    {
      console.warn('Editor::_consumeTutorialQueryParam():', err);
      return false;
    }
  }

  /** Put help code (a tutorial step) in the editor and run it right away. */
  private async _runHelpCode(code: string)
  {
    if (isReadOnly.get()) return;
    updateScriptCode(code);

    // The code box echoes the new code back as a change event, which schedules an
    // automatic run a moment later — on top of this one. Let it do so, then cancel it.
    await this.updateComplete;
    await this.shadowRoot?.querySelector('editor-code-box')?.updateComplete;
    if (this._codeChangeTimeout !== null)
    {
      clearTimeout(this._codeChangeTimeout);
      this._codeChangeTimeout = null;
    }

    // A run already in progress would make _handleExecute() drop this one
    await this._whenIdle();
    void this._handleExecute();
  }

  private _whenIdle(): Promise<void>
  {
    return executing.get()
      ? new Promise(resolve => setTimeout(() => resolve(this._whenIdle()), 50))
      : Promise.resolve();
  }

  // Internal state
  private _code = '';
  private _codeChangeTimeout: number | null = null;
  private _paramExecTimeout: number | null = null;

  // Methods 

  /** Execute immediately (50 ms debounce to coalesce rapid slider ticks) after a param value change */
  private _scheduleParamExecute()
  {
    if (this._paramExecTimeout !== null) clearTimeout(this._paramExecTimeout);
    this._paramExecTimeout = window.setTimeout(() =>
    {
      this._paramExecTimeout = null;
      this.execute();
    }, 50);
  }

  private _handleCodeChange(e: CustomEvent<string>)
  {
    console.log('Code change event:', e.detail);
    this._code = e.detail;
    updateScriptCode(this._code);
    this.checkAutoRun();
  }

  /** Check if code meets criteria and auto-run now or after the idle delay. */
  checkAutoRun(immediate: boolean = false)
  {
    const scriptCode = editorScript.get()?.code ?? '';
    if (this._codeChangeTimeout !== null)
    {
      clearTimeout(this._codeChangeTimeout);
      this._codeChangeTimeout = null;
    }

    // Automatic execute disabled → never auto-run; the user runs via the Run button.
    if (!autoRun.get())
    {
      return;
    }

    if (scriptCode.length < this.CONST_AUTORUN_MIN_SIZE)
    {
      this._codeChangeTimeout = null;
      return;
    }

    if (immediate)
    {
      this._codeChangeTimeout = null;
      this.execute();
      return;
    }

    this._codeChangeTimeout = window.setTimeout(() =>
    {
      this._codeChangeTimeout = null;
      this.execute();
    }, this.CONST_AUTORUN_DELAY);
  }

  /** Build an execution request for the current script and params. */
  private _buildRequest(outputs: string[], messages: string[] = ['info', 'geom', 'user', 'warn', 'error', 'exec']): RunnerScriptExecutionRequest
  {
    // The active script already serialises its canonical params (with schema,
    // default, order, units, _value) via toData().
    const active = editorScript.get();
    const scriptData = active?.toData() as any;
    // A script that is not synced yet has no author, but it is the signed-in user's. Without
    // it the Runner cannot tell whose '@author/name:dev' and 'name:0.6' are the own ones.
    if (scriptData && !scriptData.author) scriptData.author = authService.getUser()?.id ?? undefined;
    const params = scriptParams.get();

    const paramValues: Record<string, any> = Object.fromEntries(
      params.map(p => [p.name, paramValue(p)])
    );

    // Forward the local library (excluding the active script) so the Runner
    // can resolve $component('./name') against linked scripts. Sent as
    // ScriptData[] — structured-clone-safe over the Comlink boundary.
    const componentScripts = scripts.get()
      .filter(s => s.fileId !== active?.fileId)
      .map(s => s.toData());

    return {
      outputs,
      messages,
      script: scriptData,
      params: paramValues,
      selection: selectedPath.get() ? [selectedPath.get() as string] : [],
      componentScripts,
      // editor: display in the script's own unit system
      unitSystem: scriptUnitSystem.get(),
      // per-statement mode: partial model on error + profiling (toggled next to Run)
      perStatement: perStatement.get(),
      // geometry kernel for this run: mesh (default) or brep (toggled next to Run)
      kernel: kernel.get(),
    } as RunnerScriptExecutionRequest;
  }

  /** Execute the current script: produces model + tables.
   *  Then triggers a separate lean run for any active tool-specific outputs. */
  async execute()
  {
    const result = await runScript(
      this._buildRequest(['default/model/glb', 'default/tables/*/json'])
    );

    if (result)
    {
      setExecutionResult(result);
      await this._executeToolOutputs();
      // Have the model's picture taken for the browser page, later and in the background:
      // the service debounces, renders from this run's GLB off screen, and skips scripts
      // that are not ours. Visibility comes from the reconciled scenegraph, so the picture
      // shows what the viewer shows — including what was hidden from the scene tree.
      const active = editorScript.get();
      const glb = getOutput(result, 'default/model/glb');
      if (result.status !== 'error' && active && glb instanceof ArrayBuffer) scheduleWorkingThumbnail(active, glb, scenegraph.get());
      return result;
    }
    else
    {
      console.error(`Execute failed without result. This should not happen!`);
    }
  }

  /** Run a lean extra execute for any active tools that declare outputs (e.g. metrics, docs).
   *  The results are merged into the current editorState result, avoiding a second heavy model export. */
  private async _executeToolOutputs()
  {
    const toolOutputs = this._activeTools.flatMap(t => t.outputs ?? []);
    if (toolOutputs.length === 0) return;

    const extraResult = await runScript(
      this._buildRequest(toolOutputs, ['error'])
    );

    if (!extraResult)
    {
      return;
    }

    const current = executionResult.get();
    if (!current)
    {
      setExecutionResult(extraResult);
      return;
    }

    const mergedMessages = [...(current.messages ?? []), ...(extraResult.messages ?? [])];
    const mergedOutputs = [...(current.outputs ?? []), ...(extraResult.outputs ?? [])];
    const mergedWarnings = [...(current.warnings ?? []), ...(extraResult.warnings ?? [])];

    if (
      extraResult.status === 'error'
      || (extraResult.errors?.length ?? 0) > 0
      || mergedOutputs.length !== (current.outputs?.length ?? 0)
      || mergedMessages.length !== (current.messages?.length ?? 0)
      || mergedWarnings.length !== (current.warnings?.length ?? 0)
    )
    {
      setExecutionResult({
        ...current,
        status: extraResult.status === 'error' ? 'error' : current.status,
        created: extraResult.created ?? current.created,
        duration: (current.duration ?? 0) + (extraResult.duration ?? 0),
        request: extraResult.request ?? current.request,
        errors: extraResult.status === 'error'
          ? (extraResult.errors ?? current.errors)
          : current.errors,
        warnings: mergedWarnings,
        messages: mergedMessages,
        outputs: mergedOutputs,
      });
    }
  }


  /** Show a short informational popup at the top of the editor; it hides itself after a while. */
  private _showNotice(text: string, durationMs = 6000)
  {
    this._notice = text;
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => (this._notice = ''), durationMs);
  }

  private _handleMenuAction(e: CustomEvent<string>)
  {
    const value = e.detail;

    if (value === 'new')
    {
      // Call directly: Vaadin Router skips re-resolving when the path is
      // unchanged (same /editor route), so a Router.go('/editor?new') won't
      // reliably re-trigger willUpdate. The URL-based ?new entry point still
      // works on first mount via _consumeNewQueryParam.
      createNewScript();
      return;
    }

    if (value === 'open-script')
    {
      this._showScriptManager = true;
      return;
    }

    if (value === 'save')
    {
      // Nothing to do: scripts save themselves. Tell the user so they don't wonder.
      this._showNotice('Saving is automatic in Archiyou: either to the server, or in your browser when you are offline.');
      return;
    }

    if (value === 'delete-script')
    {
      // A foreign (read-only) script isn't in our collection — nothing to delete.
      if (!editorScript.get() || isReadOnly.get()) return;
      this._showDeleteConfirm = true;
      return;
    }

    if (value === 'import-data')
    {
      this._showScriptImporter = true;
      return;
    }

    if (value === 'share')
    {
      this._showShareMenu = true;
      return;
    }

    if (value === 'publish')
    {
      this._editConfigurator = null;   // fresh publish (not edit mode)
      this._showPublishMenu = true;
      return;
    }

    if (value === 'manage-configurators')
    {
      this._showManageConfigurators = true;
      return;
    }

    if (value === 'modules')
    {
      this._showModules = true;
      return;
    }

    if (value === 'help')
    {
      this._openTool('help');
      return;
    }

    if (value === 'export-script-data')
    {
      this._exportScriptDataAsJs();
      return;
    }

    if (value.startsWith('export-') && value !== 'export-script-data')
    {
      void this._exportModel(value.replace('export-', '') as ExportModelFormat);
      return;
    }

    this.dispatchEvent(new CustomEvent('editor-action', {
      detail: value,
      bubbles: true,
      composed: true,
    }));
  }


  private _handleScriptManagerOpen(e: CustomEvent<string>)
  {
    openScript(e.detail);
    this._showScriptManager = false;
    triggerResetCamera();
    // Run the freshly-opened script so the viewer/params reflect it immediately.
    this._handleExecute();
  }

  private _handleScriptManagerOpenShared(e: CustomEvent<ScriptData>)
  {
    openSharedScript(e.detail as unknown as Record<string, any>);
    this._showScriptManager = false;
    triggerResetCamera();
    // Run the opened (read-only) shared script so the viewer reflects it.
    this._handleExecute();
  }

  private _handleScriptManagerCancel()
  {
    this._showScriptManager = false;
  }

  private _handleShareDone()
  {
    this._showShareMenu = false;
  }

  private _handleShareCancel()
  {
    this._showShareMenu = false;
  }

  private _handlePublishDone()
  {
    this._showPublishMenu = false;
    this._editConfigurator = null;
  }

  private _handlePublishCancel()
  {
    this._showPublishMenu = false;
    this._editConfigurator = null;
  }

  private _handleManageConfiguratorsCancel()
  {
    this._showManageConfigurators = false;
  }

  /** Edit a published configurator: load its script as the active (editable)
   *  script, then open the publish menu (which re-runs its precheck + prefill). */
  private _handleManageConfiguratorsEdit(e: CustomEvent<ScriptData>)
  {
    const data = e.detail;
    // Load the exact published version so the editor reflects what's being edited
    // (author == me ⇒ editable). The publish menu itself operates on `editData`.
    openSharedScript(data as unknown as Record<string, any>);
    this._editConfigurator = data;          // → publish menu opens in edit mode
    this._showManageConfigurators = false;
    this._showPublishMenu = true;
    triggerResetCamera();
    this._handleExecute();
  }

  /** A read-only script was forked into an editable copy — re-run it. */
  private _handleScriptForked()
  {
    triggerResetCamera();
    this._handleExecute();
  }

  private _handleScriptImporterCancel()
  {
    this._showScriptImporter = false;
  }

  private _exportScriptDataAsJs()
  {
    const script = editorScript.get();
    if (!script) return;

    this._downloadFile(script.toScriptJs(), 'js', 'text/javascript');
  }

  /** Download filename for exports: <scriptname>_<version>.<ext>.
   *  Unpublished/working scripts have no version yet — those fall back to 0.0.0. */
  private _exportFilename(ext: string): string
  {
    const script = editorScript.get();
    const name = (script?.name ?? 'model').replace(/[\\/:*?"<>|\s]+/g, '-');
    const version = script?.version ?? '0.0.0';
    return `${name}_${version}.${ext}`;
  }

  private _downloadFile(data: string|Uint8Array|ArrayBuffer, ext: string, mimeType: string)
  {
    const blob = new Blob([data as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this._exportFilename(ext);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** Main menu ▸ Export to… — run a lean export-only request for the given model format
   *  and download the result as <scriptname>_<version>.<ext>.
   *  DXF gets `?annotations=true` so Modeler.toDXF() bakes in the dimension lines. */
  private async _exportModel(format: ExportModelFormat)
  {
    const EXPORT_FORMATS: Record<string, { path: string, mimeType: string, emptyMsg: string, ext?: string }> = {
      glb: { path: 'default/model/glb', mimeType: 'model/gltf-binary', emptyMsg: 'the model produced no geometry.' },
      stl: { path: 'default/model/stl', mimeType: 'model/stl', emptyMsg: 'the model produced no 3D geometry.' },
      amf: { path: 'default/model/amf', mimeType: 'application/x-amf', emptyMsg: 'the model produced no 3D geometry.' },
      dae: { path: 'default/model/dae', mimeType: 'model/vnd.collada+xml', emptyMsg: 'the model produced no geometry.' },
      svg: { path: 'default/model/svg', mimeType: 'image/svg+xml', emptyMsg: 'the model produced no 2D geometry.' },
      dxf: { path: 'default/model/dxf?annotations=true', mimeType: 'application/dxf', emptyMsg: 'the model produced no 2D geometry.' },
      // FreeCAD's file dialogs filter on the exact-case extension
      fcstd: { path: 'default/model/fcstd', mimeType: 'application/x-extension-fcstd', emptyMsg: 'the model produced no geometry.', ext: 'FCStd' },
      ifc: { path: 'default/model/ifc', mimeType: 'application/x-step', emptyMsg: 'the model produced no building elements.' },
      scad: { path: 'default/model/scad', mimeType: 'application/x-openscad', emptyMsg: 'the model produced no geometry.' },
      // BTLx is XML without a registered mime type
      btlx: { path: 'default/model/btlx', mimeType: 'application/xml', emptyMsg: 'the model produced no timber parts.' },
    };

    const { path: requestPath, mimeType, emptyMsg, ext } = EXPORT_FORMATS[format];

    const result = await runScript(
      this._buildRequest([requestPath], ['error'])
    );

    const output = result?.outputs
      ?.find(o => o.path.requestedPath === requestPath)
      ?.output as string|Uint8Array|ArrayBuffer|undefined;

    const size = (typeof output === 'string')
      ? output.length
      : ((output as Uint8Array)?.byteLength ?? 0);

    if (!output || size === 0)
    {
      console.error(`${format.toUpperCase()} export produced no output`, result);
      window.alert(`${format.toUpperCase()} export failed — ${emptyMsg}`);
      return;
    }

    this._downloadFile(output, ext ?? format, mimeType);
  }

  private _handleScriptImporterImport(e: CustomEvent<ScriptData>)
  {
    const imported = importScriptFromData(e.detail as unknown as Record<string, any>);
    if (!imported) return;
    this._showScriptImporter = false;
  }

  private _handleScriptDelete(e: CustomEvent<string>)
  {
    deleteScriptById(e.detail);
  }

  /** Main menu ▸ Delete script — confirmed. Deleting the active script makes
   *  the collection's last entry (or a fresh script) active, so the editor
   *  never ends up without one. */
  private _handleDeleteConfirm()
  {
    const script = editorScript.get();
    this._showDeleteConfirm = false;
    if (!script || isReadOnly.get()) return;
    deleteScriptById(script.fileId);
  }

  private _handleDeleteCancel()
  {
    this._showDeleteConfirm = false;
  }

  /** Only the dialog's own hide closes the confirmation — nested Web Awesome
   *  overlays re-emit `wa-after-hide` as a composed, bubbling event. */
  private _handleDeleteDialogAfterHide(e: Event)
  {
    if (e.target !== e.currentTarget) return;
    this._showDeleteConfirm = false;
  }

  private _handleMenuSelect(e: CustomEvent<'info' | 'code' | 'history' | 'files' | 'templates' | 'help' | 'settings' | null>)
  {
    this._activeSection = e.detail;
    this.dispatchEvent(new CustomEvent('editor-section', {
      detail: e.detail,
      bubbles: true,
      composed: true,
    }));
  }


  private _handleToolToggle(e: CustomEvent<string>)
  {
    const id = e.detail;
    const tool = this.TOOLS.find(t => t.id === id);
    if (!tool) return;

    const isActive = this._activeTools.some(t => t.id === id);

    if (isActive)
    {
      this._activeTools = this._activeTools.filter(t => t.id !== id);
    }
    else
    {
      this._openTool(id);
    }
  }

  /** Open a tool panel if it is not open yet. */
  private _openTool(id: string)
  {
    const tool = this.TOOLS.find(t => t.id === id);
    if (!tool || this._activeTools.some(t => t.id === id)) return;

    const base = tool.exclusive ? [] : this._activeTools.filter(t => !t.exclusive);
    this._activeTools = [...base, tool];
    // If the newly active tool declares outputs and we already have a result,
    // run a lean extra execute immediately to populate its data.
    if (tool.outputs?.length && executionResult.get())
    {
      this._executeToolOutputs();
    }
  }

  private _handleToolClose(e: CustomEvent<string>)
  {
    this._activeTools = this._activeTools.filter(t => t.id !== e.detail);
  }

  private async _handleExecute()
  {
    if (executing.get())
    {
      console.warn('Already running a script, ignoring execute command');
      return;
    }

    setExecuting(true);

    try { 
      const executionResult = await this.execute();
      console.log(executionResult);
    }
    catch (err)
    {
      console.error('Execute error:', err);
    }
    finally
    {
      setExecuting(false);
    }
  }
  

  //// CSS STYLES ////

  static override styles = css`
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    wa-split-panel {
      flex: 1;
      min-height: 0;
      --divider-width: var(--size-divider);
    }

    /* Outer horizontal split: keep both panels at least 300px wide.
       --min applies to the start (left) panel; --max prevents it from
       pushing the end panel below 300px either. */
    wa-split-panel:not(.left-split):not(.viewer-tools-split) {
      --min: 300px;
      --max: calc(100% - 300px);
    }

    editor-main-menu { flex-shrink: 0; }
    editor-toolbar    { flex-shrink: 0; }

    /* Main menu ▸ Delete script confirmation */
    .delete-dialog {
      --width: 28rem;
    }

    .delete-message {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text);
      line-height: 1.5;
    }

    /* Deep-link failure notice (/editor/{name} could not be opened) — a
       floating popup, deliberately taken out of the editor's row-flex layout
       (position: fixed) so it can never get squeezed into a sidebar-width
       column by the surrounding flex children. */
    .link-error {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      width: max-content;
      max-width: min(480px, calc(100vw - 32px));
      padding: 10px 12px;
      background: var(--color-bg, #fff);
      border: 1px solid color-mix(in srgb, var(--color-alert, #ef4444) 35%, transparent);
      border-radius: var(--radius-md, 8px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
      color: var(--color-text);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
    }
    .link-error wa-icon { color: var(--color-alert, #ef4444); flex-shrink: 0; margin-top: 2px; }
    .link-error-text { flex: 1; min-width: 0; }
    .link-error.notice { border-color: color-mix(in srgb, var(--color-primary, #103eaa) 35%, transparent); }
    .link-error.notice wa-icon { color: var(--color-primary, #103eaa); }
    .link-error-close {
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      flex-shrink: 0;
      border: none; background: transparent; cursor: pointer;
      color: var(--color-text-muted, #666);
      border-radius: var(--radius-sm, 4px);
    }
    .link-error-close:hover { background: color-mix(in srgb, var(--color-border) 40%, transparent); }

    .viewer-tools-split {
      width: 100%;
      height: 100%;
      --divider-width: var(--size-divider);
    }

    editor-tool-panels {
      width: 100%;
      height: 100%;
      min-width: 0;
      border-left: 1px solid var(--color-border);
    }

    .left-panel {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    .left-panel editor-code-box {
      flex: 1;
      min-height: 0;
    }


    wa-split-panel::part(divider) {
      background-color: var(--color-divider);
    }

    wa-icon.split-grip,
    wa-icon.split-grip-h {
      color: var(--color-gray-dark);
      opacity: 0.3;
    }

    model-viewer {
      width: 100%;
      height: 100%;
    }

  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-editor': PageEditor;
  }
}
