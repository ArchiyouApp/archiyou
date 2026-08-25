import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { html as staticHtml, unsafeStatic } from 'lit/static-html.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { pluginMode } from '@archiyou/editor/src/state/plugin-mode';
import { executionResult } from '@archiyou/editor/src/state/workspace';
import '@archiyou/editor/src/plugins/plugin-part-frame';

import type { ToolDef } from './toolbar.js';

@customElement('editor-tool-panel')
export class EditorToolPanel extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    if (!this.tool) return html``;

    return html`
      <div class="panel-header">
        <wa-icon library="lucide" name=${this.tool.icon} class=${this.tool.plugin ? 'plugin' : ''}></wa-icon>
        <span class="panel-title">${this.tool.name}</span>
        <span class="spacer"></span>
        <wa-button
          appearance="plain"
          class="close-btn"
          @click=${this._handleClose}
        >
          <wa-icon library="lucide" name="x" label="Close"></wa-icon>
        </wa-button>
      </div>
      <div class="panel-content">
        ${this.tool.plugin ? this._renderPluginPart() : this._renderComponent()}
      </div>
    `;
  }

  private _renderComponent()
  {
    const tag = unsafeStatic(this.tool!.component);
    return staticHtml`<${tag}></${tag}>`;
  }

  private _renderPluginPart()
  {
    const pm = pluginMode.get();
    executionResult.get(); // track: re-render (fresh result summary) on each run
    const manager = pm?.manager;
    const src = this.tool?.ui ? manager?.partHtml(this.tool.ui) : null;
    if (!manager || !src) return html`<div class="tool-empty">Tool unavailable.</div>`;
    return html`<plugin-part-frame
      .src=${src}
      .result=${manager.summary}
      .onGenerate=${(selectors: string[]) => manager.generate(selectors)}
    ></plugin-part-frame>`;
  }

  // ── 2. Properties ──
  @property({ type: Object }) tool: ToolDef | null = null;

  // ── 4. Behaviour & Methods ──
  private _handleClose()
  {
    this.dispatchEvent(new CustomEvent('tool-close', {
      detail: this.tool?.id,
      bubbles: true,
      composed: true,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      height: var(--space3xl);
      padding: 0 var(--space-md);
      flex-shrink: 0;
      background: var(--color-gray);
      border-bottom: 1px solid var(--color-border);
    }

    .panel-title {
      font-weight: 500;
      color: var(--color-text);
      font-size: var(--text-sm);
    }

    .spacer { flex: 1; }

    .panel-content {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    .panel-content plugin-part-frame { display: block; width: 100%; height: 100%; }
    .panel-header wa-icon.plugin { color: var(--color-plugin, #7c3aed); }
    .tool-empty { padding: 16px; color: var(--color-text-muted, #6b7280); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-tool-panel': EditorToolPanel;
  }
}
