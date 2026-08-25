/**
 * <page-plugin> — in-editor plugin preview + dev loop.
 *
 * Loads the bundled `shape-picker` example over HTTP on start; "Open plugin
 * folder" loads a plugin off disk (File System Access API) with optional
 * auto-reload. Mounts the plugin's custom param menu (left) and any toolbar
 * tools (togglable right panel), and renders results in the host-owned
 * <model-viewer>. Reachable at /plugin. Does not touch the user's editor script.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import '@archiyou/ui/viewer/model-viewer.js';
import '../plugins/plugin-part-frame';

import type { ScriptParamData } from '@archiyou/core/src/execution/types';
import type { LoadedPlugin, PluginToolManifest } from '../plugins/types';
import { PluginManager, type GeneratedOutput, type PluginResultSummary } from '../plugins/PluginManager';
import {
  loadShapePicker, loadPluginFromDirectory, loadPluginFromFiles,
  directoryPickerSupported, pickPluginFolderFiles, pluginMaxMtime,
} from '../plugins/plugin-loader';
import { takePendingPluginDir } from '../plugins/plugin-session';

@customElement('page-plugin')
export class PagePlugin extends LitElement
{
  private manager: PluginManager | null = null;
  private _dirHandle: FileSystemDirectoryHandle | null = null;
  private _watchTimer?: number;
  private _lastMtime = 0;

  @state() private _schema: ScriptParamData[] | null = null;
  @state() private _partHtml: string | null = null;
  @state() private _tools: PluginToolManifest[] = [];
  @state() private _activeTool: string | null = null;
  @state() private _result: PluginResultSummary | null = null;
  @state() private _error: string | null = null;
  @state() private _pluginName = '';
  @state() private _status = 'Loading…';
  @state() private _autoReload = true;
  /** True when the folder was loaded read-only (no live handle: no reload/save-back). */
  @state() private _readOnly = false;

  private _fsSupported = directoryPickerSupported();

  static override styles = css`
    :host { display: flex; height: 100%; min-height: 0; }
    .menu { width: 320px; flex: 0 0 320px; display: flex; flex-direction: column;
            border-right: 1px solid var(--sl-color-neutral-200, #e5e7eb); }
    .tools-panel { width: 320px; flex: 0 0 320px;
            border-left: 1px solid var(--sl-color-neutral-200, #e5e7eb); }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
            padding: 8px; border-bottom: 1px solid var(--sl-color-neutral-200, #e5e7eb);
            font-family: system-ui, sans-serif; font-size: 13px; }
    .toolbar button { font: inherit; padding: 4px 10px; cursor: pointer;
            border: 1px solid var(--sl-color-neutral-300, #d1d5db); border-radius: 6px; background: #fff; }
    .toolbar button[aria-pressed="true"] { background: #eef2ff; border-color: #6366f1; }
    .toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
    .toolbar label { display: inline-flex; align-items: center; gap: 4px; color: #6b7280; }
    .toolbar .ro { color: #b45309; background: #fef3c7; border-radius: 4px;
            padding: 1px 6px; font-size: 11px; cursor: help; }
    .toolbar .name { margin-left: auto; color: #6b7280; }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .viewer { flex: 1 1 auto; min-width: 0; position: relative; }
    model-viewer { width: 100%; height: 100%; display: block; }
    .status { padding: 16px; font-family: system-ui, sans-serif; color: #6b7280; }
    .error { color: #b91c1c; }
    plugin-part-frame { display: block; height: 100%; }
  `;

  override async connectedCallback(): Promise<void>
  {
    super.connectedCallback();
    // A folder picked via Plugins ▸ Add plugin takes precedence over the example.
    const pending = takePendingPluginDir();
    if (pending)
    {
      this._dirHandle = pending;
      await this._load(() => loadPluginFromDirectory(pending));
      await this._startWatch();
    }
    else
    {
      await this._load(() => loadShapePicker());
    }
  }

  override disconnectedCallback(): void
  {
    this._stopWatch();
    super.disconnectedCallback();
  }

  private _openFolder = async (): Promise<void> =>
  {
    try
    {
      if (this._fsSupported)
      {
        const dir = await (window as any).showDirectoryPicker();
        this._dirHandle = dir;
        this._readOnly = false;
        await this._load(() => loadPluginFromDirectory(dir));
        await this._startWatch();
      }
      else
      {
        // Firefox/Safari: one-shot read-only snapshot, no live handle.
        const files = await pickPluginFolderFiles();
        if (!files) return;
        this._stopWatch();
        this._dirHandle = null;
        this._readOnly = true;
        await this._load(() => loadPluginFromFiles(files));
      }
    }
    catch (e)
    {
      if ((e as Error)?.name !== 'AbortError') this._error = (e as Error)?.message ?? String(e);
    }
  };

  private _reload = async (): Promise<void> =>
  {
    if (this._dirHandle) await this._load(() => loadPluginFromDirectory(this._dirHandle!));
  };

  private _toggleAutoReload = (e: Event): void =>
  {
    this._autoReload = (e.target as HTMLInputElement).checked;
    if (this._autoReload) void this._startWatch();
    else this._stopWatch();
  };

  private _toggleTool = (id: string): void =>
  {
    this._activeTool = this._activeTool === id ? null : id;
  };

  /** archiyou.ui.open/close/toggle('Export') from the main UI. */
  private _onUiCommand = (e: Event): void =>
  {
    const { action, tool } = (e as CustomEvent).detail as { action: 'open' | 'close' | 'toggle'; tool: string };
    const key = String(tool).toLowerCase();
    const t = this._tools.find(x => x.id.toLowerCase() === key || x.name.toLowerCase() === key);
    if (!t) return;
    const isActive = this._activeTool === t.id;
    if (action === 'toggle') this._activeTool = isActive ? null : t.id;
    else if (action === 'open') this._activeTool = t.id;
    else if (isActive) this._activeTool = null;
  };

  /** Load a plugin from any source, (re)run it, and mount its parts. */
  private async _load(loader: () => Promise<LoadedPlugin>): Promise<void>
  {
    this._error = null;
    this._status = 'Loading plugin…';
    try
    {
      const plugin = await loader();
      // Fresh manager per load so param definitions from a previous plugin don't leak.
      this.manager = new PluginManager();
      const schema = await this.manager.activate(plugin);
      this._pluginName = plugin.manifest.name;
      this._partHtml = this.manager.mainUiHtml();
      this._tools = plugin.manifest.tools ?? [];
      this._result = this.manager.summary;
      this._schema = schema;
      if (!this._partHtml) this._status = 'Plugin has no param menu.';
    }
    catch (e)
    {
      this._error = (e as Error)?.message ?? String(e);
    }
  }

  private _onSubmit = async (e: Event): Promise<void> =>
  {
    const values = (e as CustomEvent).detail as Record<string, any>;
    await this.manager?.run(values);
    this._result = this.manager?.summary ?? null;
  };

  private _onGenerate = (selectors: string[]): Promise<GeneratedOutput[]> =>
    this.manager?.generate(selectors) ?? Promise.resolve([]);

  // ── auto-reload (poll the picked directory; the browser has no file-watch) ──

  private async _startWatch(): Promise<void>
  {
    this._stopWatch();
    if (!this._dirHandle || !this._autoReload || !this.manager?.manifest) return;
    this._lastMtime = await pluginMaxMtime(this._dirHandle, this.manager.manifest);
    this._watchTimer = window.setInterval(() => void this._pollReload(), 1000);
  }

  private _stopWatch(): void
  {
    if (this._watchTimer) { clearInterval(this._watchTimer); this._watchTimer = undefined; }
  }

  private async _pollReload(): Promise<void>
  {
    if (!this._dirHandle || !this._autoReload || !this.manager?.manifest) return;
    try
    {
      const mtime = await pluginMaxMtime(this._dirHandle, this.manager.manifest);
      if (mtime > this._lastMtime)
      {
        this._lastMtime = mtime;
        await this._load(() => loadPluginFromDirectory(this._dirHandle!));
      }
    }
    catch { /* transient error mid-edit; retry next tick */ }
  }

  override render()
  {
    const activeToolUi = this._tools.find(t => t.id === this._activeTool)?.ui;
    const toolHtml = activeToolUi ? this.manager?.partHtml(activeToolUi) : null;

    return html`
      <div class="menu">
        <div class="toolbar">
          <button
            @click=${this._openFolder}
            title=${this._fsSupported
              ? 'Load a plugin from a local folder'
              : 'Load a plugin folder (read-only: this browser has no live folder access)'}
          >Open folder</button>
          <button @click=${this._reload} ?disabled=${!this._dirHandle}>Reload</button>
          ${this._dirHandle ? html`
            <label><input type="checkbox" .checked=${this._autoReload} @change=${this._toggleAutoReload}>auto</label>
          ` : ''}
          ${this._readOnly ? html`
            <span class="ro" title="This browser has no live folder access. Re-open the folder to pick up edits; use a Chromium browser for hot-reload.">read-only</span>
          ` : ''}
          <span class="name">${this._pluginName}</span>
        </div>
        <div class="body">
          ${this._error
            ? html`<div class="status error">Plugin failed: ${this._error}</div>`
            : this._partHtml && this._schema
              ? html`<plugin-part-frame
                  .src=${this._partHtml}
                  .schema=${this._schema}
                  .result=${this._result}
                  .onGenerate=${this._onGenerate}
                  @plugin-submit=${this._onSubmit}
                  @plugin-ui-command=${this._onUiCommand}
                ></plugin-part-frame>`
              : html`<div class="status">${this._status}</div>`}
        </div>
        ${this._tools.length ? html`
          <div class="toolbar">
            ${this._tools.map(t => html`
              <button aria-pressed=${this._activeTool === t.id} @click=${() => this._toggleTool(t.id)}>${t.name}</button>
            `)}
          </div>
        ` : ''}
      </div>

      <div class="viewer"><model-viewer></model-viewer></div>

      ${toolHtml ? html`
        <div class="tools-panel">
          <plugin-part-frame
            .src=${toolHtml}
            .result=${this._result}
            .onGenerate=${this._onGenerate}
          ></plugin-part-frame>
        </div>
      ` : ''}
    `;
  }
}

declare global
{
  interface HTMLElementTagNameMap { 'page-plugin': PagePlugin; }
}
