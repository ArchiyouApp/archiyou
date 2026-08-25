import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

import '../scene-explorer.js';

@customElement('editor-scene-tool')
export class EditorSceneTool extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`<scene-explorer standalone></scene-explorer>`;
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

    scene-explorer {
      flex: 1;
      min-height: 0;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-scene-tool': EditorSceneTool;
  }
}
