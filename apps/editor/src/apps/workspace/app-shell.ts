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
import { warmupWorker } from '../../services/execution-service';

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

    // Start worker + WASM warmup as early as possible so editor/configurator
    // pages don't pay the full startup cost before their first execution.
    warmupWorker().catch(err =>
    {
      console.warn('AppShell::firstUpdated(): worker warmup failed:', err);
    });

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
