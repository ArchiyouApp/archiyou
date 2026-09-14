/**
 * page-admin — the operator screen, at /admin inside the main layout.
 *
 * The route action already redirects a non-operator (apps/workspace/router.ts), so
 * reaching this component normally means `userState.isAdmin`. It is re-checked here
 * anyway for the case the router cannot cover: signing out, or having admin revoked,
 * while the page is open. Neither check is a control — every request the child
 * component makes is gated server-side by requireAdmin.
 *
 * Today the screen has exactly one job, so it renders <admin-configurators> directly
 * rather than a tab shell around a single tab.
 */

import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@archiyou/ui/admin/admin-configurators.js';

import { userState } from '../state/workspace';

@customElement('page-admin')
export class PageAdmin extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    if (!userState.get().isAdmin)
    {
      return html`
        <div class="center">
          <wa-icon library="lucide" name="shield-off"></wa-icon>
          <p>${msg('This page is for operator accounts.')}</p>
        </div>`;
    }

    return html`
      <header class="head">
        <h1>${msg('Configurators')}</h1>
        <p class="lede">
          ${msg('Validating a configurator lets that exact version run on the server instead of in the visitor’s browser. Read its code before you do.')}
        </p>
      </header>

      <admin-configurators></admin-configurators>
    `;
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      box-sizing: border-box;
      font-family: var(--font-sans);
      color: var(--color-text);
    }

    *,
    *::before,
    *::after
    {
      box-sizing: inherit;
    }

    .head
    {
      padding: var(--space-4) var(--space-4) 0;
    }

    h1
    {
      margin: 0;
      font-family: var(--font-display, var(--font-sans));
      font-size: var(--text-xl);
    }

    .lede
    {
      margin: var(--space-sm) 0 0;
      max-width: 60ch;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .center
    {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      flex: 1;
      color: var(--color-text-muted);
    }

    .center wa-icon { font-size: 32px; }
    .center p { margin: 0; font-size: var(--text-sm); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-admin': PageAdmin;
  }
}
