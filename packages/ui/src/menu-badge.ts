import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/badge/badge.js";

export type MenuBadgeColor = "brand" | "neutral" | "success" | "warning" | "danger";

@customElement("menu-badge")
export class MenuBadge extends LitElement
{

  // ── 1. Render ──

  override render()
  {
    return html`
      <span class="wrapper ${this.attention ? 'pulse' : ''}">
        <wa-badge variant=${this.color} appearance="filled">${this.value}</wa-badge>
      </span>
    `;
  }

  // ── 2. Properties ──

  @property({ type: String }) color: MenuBadgeColor = "brand";
  @property({ type: Number }) value = 0;
  @property({ type: Boolean }) attention = false;

  // ── 5. Styles ──

  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
    }

    .wrapper {
      display: inline-flex;
    }

    @keyframes menu-badge-pulse {
      0%   { transform: scale(1); }
      15%  { transform: scale(1.25); }
      50%  { transform: scale(1.1); }
      100% { transform: scale(1); }
    }

    .wrapper.pulse {
      animation: menu-badge-pulse 1.2s ease forwards;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    "menu-badge": MenuBadge;
  }
}
