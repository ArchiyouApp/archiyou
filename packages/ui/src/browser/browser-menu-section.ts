/**
 * <browser-menu-section> — a reusable labelled group of navigation items
 * for the browser manager sidebar.
 *
 * Usage:
 *   <browser-menu-section
 *     section="General"
 *     .items=${[{ name, icon, route }, …]}
 *   ></browser-menu-section>
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

export interface BrowserMenuItem
{
  name: string;
  /** Lucide icon name. */
  icon: string;
  route: string;
}

@customElement('browser-menu-section')
export class BrowserMenuSection extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="label">${this.section}</div>
      <nav>
        ${this.items.map(item => html`
          <button
            class=${this._active === item.route ? 'item active' : 'item'}
            @click=${() => this._select(item)}
          >
            <wa-icon library="lucide" name=${item.icon}></wa-icon>
            <span>${item.name}</span>
          </button>
        `)}
      </nav>
    `;
  }

  // ── 2. Properties, State ──
  @property({ type: String }) section = '';
  @property({ type: Array }) items: BrowserMenuItem[] = [];

  @state() private _active: string | null = null;

  // ── 4. Behaviour & Methods ──
  private _select(item: BrowserMenuItem)
  {
    this._active = item.route;
    this.dispatchEvent(new CustomEvent('menu-select', {
      detail: item,
      bubbles: true,
      composed: true,
    }));
    Router.go(item.route);
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: block;
    }

    .label {
      font-size: var(--text-xs);
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--color-text-muted);
      padding: 0 var(--space-sm);
      margin-bottom: var(--space-sm);
    }

    nav {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .item {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      width: 100%;
      padding: var(--space-sm) var(--space-md);
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text);
      font: inherit;
      font-size: var(--text-sm);
      text-align: left;
      cursor: pointer;
      transition: background-color 0.15s, color 0.15s;
    }

    .item:hover {
      background: var(--color-gray);
    }

    .item.active {
      background: color-mix(in srgb, var(--color-primary) 12%, transparent);
      color: var(--color-primary);
    }

    wa-icon {
      font-size: var(--text-lg);
      color: var(--color-text-muted);
      flex-shrink: 0;
    }

    .item.active wa-icon {
      color: var(--color-primary);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'browser-menu-section': BrowserMenuSection;
  }
}
