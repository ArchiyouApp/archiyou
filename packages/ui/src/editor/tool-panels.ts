import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/split-panel/split-panel.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import './tool-panel.js';
import type { ToolDef } from './toolbar.js';

@customElement('editor-tool-panels')
export class EditorToolPanels extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    const { tools } = this;

    if (tools.length === 0) return nothing;

    if (tools.length === 1)
    {
      return html`
        <editor-tool-panel .tool=${tools[0]}></editor-tool-panel>
      `;
    }

    if (tools.length === 2)
    {
      const position = tools[0].height;
      return html`
        <wa-split-panel orientation="vertical" position=${position} class="vertical-split">
          <wa-icon slot="divider" class="split-grip-h" library="lucide" name="grip-horizontal"></wa-icon>
          <editor-tool-panel slot="start" .tool=${tools[0]}></editor-tool-panel>
          <editor-tool-panel slot="end"   .tool=${tools[1]}></editor-tool-panel>
        </wa-split-panel>
      `;
    }

    // 3+ tools: flex column fallback
    return html`
      <div class="multi-stack">
        ${tools.map(t => html`<editor-tool-panel .tool=${t}></editor-tool-panel>`)}
      </div>
    `;
  }

  // ── 2. Properties ──
  @property({ type: Array }) tools: ToolDef[] = [];

  // ── 3. Lifecycle ──
  override updated()
  {
    // Show/hide :host based on whether there are active tools
    this.style.display = this.tools.length === 0 ? 'none' : '';
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
    }

    editor-tool-panel {
      width: 100%;
      height: 100%;
      min-height: 0;
    }

    .vertical-split {
      width: 100%;
      height: 100%;
      --divider-width: 10px;
    }

    .vertical-split editor-tool-panel {
      height: 100%;
    }

    .multi-stack {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: auto;
    }

    .multi-stack editor-tool-panel {
      flex: 1;
      min-height: 120px;
      border-bottom: 1px solid var(--color-border);
    }

    .split-grip-h {
      color: var(--color-gray-dark);
      opacity: 0.3;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-tool-panels': EditorToolPanels;
  }
}
