import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

export interface ToolDef
{
  id: string;
  icon: string;
  name: string;
  exclusive: boolean;
  component: string;
  /** Requested panel width as a percentage of the full editor area */
  width: number;
  /** Requested panel height as a percentage of the tool-panels area when stacking */
  height: number;
  /** Runner output paths this tool needs; only requested while the tool is active */
  outputs?: string[];
}

@customElement('editor-toolbar')
export class EditorToolbar extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="tool-buttons">
        ${this.tools.map(tool => this._renderButton(tool))}
      </div>
    `;
  }

  private _renderButton(tool: ToolDef)
  {
    return html`
      <wa-button
        id="tool-btn-${tool.id}"
        data-help="tool-${tool.id}"
        appearance="plain"
        class=${this.activeIds.includes(tool.id) ? 'active' : ''}
        @click=${() => this._toggle(tool.id)}
      >
        <wa-icon library="lucide" name=${tool.icon} label=${tool.name}></wa-icon>
      </wa-button>
      <wa-tooltip for="tool-btn-${tool.id}" placement=${this.horizontal ? 'top' : 'left'}>${msg(tool.name)}</wa-tooltip>
    `;
  }

  // ── 2. Properties ──
  @property({ type: Array }) tools: ToolDef[] = [];
  @property({ type: Array }) activeIds: string[] = [];
  /** A bar along the bottom (compact editor) instead of a rail on the right. */
  @property({ type: Boolean, reflect: true }) horizontal = false;

  // ── 4. Behaviour & Methods ──
  private _toggle(id: string)
  {
    this.dispatchEvent(new CustomEvent('tool-toggle', {
      detail: id,
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
      border-left: 1px solid var(--color-border);
      align-items: center;
    }

    .tool-buttons {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1, 4px);
      width: 100%;
    }

    :host([horizontal]) {
      flex-direction: row;
      width: auto;
      height: calc(48px + env(safe-area-inset-bottom));
      padding: 0 var(--space-sm) env(safe-area-inset-bottom);
      border-left: none;
      border-top: 1px solid var(--color-border);
      overflow-x: auto;
      scrollbar-width: none;
    }

    :host([horizontal]) .tool-buttons {
      flex-direction: row;
      justify-content: space-around;
      min-width: max-content;
    }

    wa-button.active::part(base) {
      background-color: var(--color-primary-subtle, color-mix(in srgb, var(--color-primary) 15%, transparent));
      color: var(--color-primary);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-toolbar': EditorToolbar;
  }
}
