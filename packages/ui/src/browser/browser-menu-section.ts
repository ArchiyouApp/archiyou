/**
 * <browser-menu-section> — a reusable labelled group of navigation items
 * for the browser manager sidebar.
 *
 * Usage:
 *   <browser-menu-section
 *     section="General"
 *     active="/browser/scripts"
 *     .items=${[{ name, icon, route, disabled? }, …]}
 *   ></browser-menu-section>
 *
 * The active item is whatever the page says it is (`active`, a route), not what was
 * last clicked here, so it follows browser back/forward and deep links too.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { Router } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

export interface BrowserMenuItem
{
  name: string;
  /** Lucide icon name. */
  icon: string;
  route: string;
  /** Shown greyed out and not clickable — for sections that do not exist yet. */
  disabled?: boolean;
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
            class=${this.active === item.route ? 'item active' : 'item'}
            ?disabled=${item.disabled}
            title=${item.disabled ? msg('Coming soon') : item.name}
            aria-current=${this.active === item.route ? 'page' : 'false'}
            @click=${() => this._select(item)}
          >
            <wa-icon library="lucide" name=${item.icon}></wa-icon>
            <span>${item.name}</span>
          </button>
        `)}
      </nav>
    `;
  }

  // ── 2. Properties ──
  @property({ type: String }) section = '';
  @property({ type: Array }) items: BrowserMenuItem[] = [];
  /** Route of the item to mark as current. */
  @property({ type: String }) active = '';

  // ── 4. Behaviour & Methods ──
  private _select(item: BrowserMenuItem)
  {
    if (item.disabled) return;
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

    .item:hover:not(:disabled) {
      background: var(--color-gray);
    }

    .item:disabled {
      opacity: 0.4;
      cursor: not-allowed;
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
