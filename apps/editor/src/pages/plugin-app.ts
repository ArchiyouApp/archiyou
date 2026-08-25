/**
 * <plugin-app> — previews the currently-loaded plugin as an app.
 *
 * Renders the plugin's custom param menu + tools + host viewer, driven by the
 * live PluginManager from `pluginMode` (the same one the editor is editing).
 * This is the in-editor twin of the published embed host, shown by the left-bar
 * "App" button when in plugin mode.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@archiyou/ui/viewer/model-viewer.js';
import '../plugins/plugin-part-frame';

import { pluginMode } from '../state/plugin-mode';
import type { GeneratedOutput } from '../plugins/PluginManager';

@customElement('plugin-app')
export class PluginApp extends SignalWatcher(LitElement)
{
  @state() private _activeTool: string | null = null;

  static override styles = css`
    :host { display: flex; height: 100%; min-height: 0; }
    .menu { width: 320px; flex: 0 0 320px; display: flex; flex-direction: column;
            border-right: 1px solid var(--color-border, #e5e7eb); }
    .tools { display: flex; gap: 8px; flex-wrap: wrap; padding: 8px;
             border-top: 1px solid var(--color-border, #e5e7eb); }
    .tools button { font: inherit; font-size: 13px; padding: 4px 10px; cursor: pointer;
             border: 1px solid var(--color-border, #d1d5db); border-radius: 6px; background: #fff; }
    .tools button[aria-pressed="true"] { background: #eef2ff; border-color: #6366f1; }
    plugin-part-frame { display: block; flex: 1 1 auto; min-height: 0; }
    .viewer { flex: 1 1 auto; min-width: 0; position: relative; }
    model-viewer { width: 100%; height: 100%; display: block; }
    .tool-panel { width: 320px; flex: 0 0 320px;
             border-left: 1px solid var(--color-border, #e5e7eb); }
    .empty { padding: 24px; font-family: system-ui, sans-serif; color: #6b7280; }
  `;

  private _onSubmit = (e: Event): void =>
  {
    void pluginMode.get()?.manager.run((e as CustomEvent).detail as Record<string, any>);
  };

  private _onGenerate = (selectors: string[]): Promise<GeneratedOutput[]> =>
    pluginMode.get()?.manager.generate(selectors) ?? Promise.resolve([]);

  private _toggleTool = (id: string): void =>
  {
    this._activeTool = this._activeTool === id ? null : id;
  };

  /** archiyou.ui.open/close/toggle('Export') from the main UI → toggle the tool panel. */
  private _onUiCommand = (e: Event): void =>
  {
    const { action, tool } = (e as CustomEvent).detail as { action: 'open' | 'close' | 'toggle'; tool: string };
    const key = String(tool).toLowerCase();
    const t = (pluginMode.get()?.manager.manifest?.tools ?? [])
      .find(x => x.id.toLowerCase() === key || x.name.toLowerCase() === key);
    if (!t) return;
    const isActive = this._activeTool === t.id;
    if (action === 'toggle') this._activeTool = isActive ? null : t.id;
    else if (action === 'open') this._activeTool = t.id;
    else if (isActive) this._activeTool = null;
  };

  override render()
  {
    const pm = pluginMode.get();
    if (!pm) return html`<div class="empty">No plugin loaded.</div>`;

    const m = pm.manager;
    const tools = m.manifest?.tools ?? [];
    const activeToolUi = tools.find(t => t.id === this._activeTool)?.ui;
    const toolHtml = activeToolUi ? m.partHtml(activeToolUi) : null;
    const paramMenuHtml = m.mainUiHtml();

    return html`
      <div class="menu">
        ${paramMenuHtml ? html`
          <plugin-part-frame
            .src=${paramMenuHtml}
            .schema=${m.schema}
            .result=${m.summary}
            .onGenerate=${this._onGenerate}
            @plugin-submit=${this._onSubmit}
            @plugin-ui-command=${this._onUiCommand}
          ></plugin-part-frame>` : html`<div class="empty">This plugin has no main UI.</div>`}
        ${tools.length ? html`
          <div class="tools">
            ${tools.map(t => html`
              <button aria-pressed=${this._activeTool === t.id} @click=${() => this._toggleTool(t.id)}>${t.name}</button>
            `)}
          </div>` : ''}
      </div>

      <div class="viewer"><model-viewer></model-viewer></div>

      ${toolHtml ? html`
        <div class="tool-panel">
          <plugin-part-frame
            .src=${toolHtml}
            .result=${m.summary}
            .onGenerate=${this._onGenerate}
          ></plugin-part-frame>
        </div>` : ''}
    `;
  }
}

declare global
{
  interface HTMLElementTagNameMap { 'plugin-app': PluginApp; }
}
