/**
 * <app-shell> — top-level custom element.
 *
 * Responsibilities:
 *  - Provides the router outlet (<main id="outlet">)
 *  - Initialises @vaadin/router in firstUpdated()
 *  - Applies system dark-theme preference on startup
 *  - Initialises @lit/localize
 */

import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { initRouter } from './router.js';
import { applySystemTheme } from '../../styles/dark-theme.js';
import { setLocale, detectLocale } from '../../i18n/locale-config.js';

@customElement('app-shell')
export class AppShell extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`<main id="outlet"></main>`;
  }

  // ── 3. Lifecycle ──
  override firstUpdated()
  {
    applySystemTheme();

    // Initialise locale (best-effort — locale modules may not exist until lit-localize build)
    setLocale(detectLocale()).catch(() => {/* source locale, no module needed */});

    // NO kernel warmup here. This runs before the router has resolved anything, so
    // warming up would download ~26MB of CAD kernel on EVERY page — including a
    // published configurator that is going to execute server-side and never needs
    // one. <layout-main> warms up instead: it is the parent route of the pages that
    // do need a kernel (/editor, /browser) and is not in the configurator's
    // route tree. See services/execution-service.ts.

    const outlet = this.renderRoot.querySelector<HTMLElement>('#outlet')!;
    initRouter(outlet);
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
    }

    main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'app-shell': AppShell;
  }
}
