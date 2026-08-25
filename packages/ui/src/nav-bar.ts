import { LitElement, html, css, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { Router } from '@vaadin/router';
import { SignalWatcher } from '@lit-labs/signals';

import { userState } from '@archiyou/editor/src/state/workspace';
import { authService } from '@archiyou/editor/src/services/auth-service.js';
import { applyDarkTheme, removeDarkTheme, isDarkTheme } from '@archiyou/editor/src/styles/dark-theme.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';

/** Shown to anonymous users to flag that persistence is local-only. */
const NOT_SIGNED_IN_MESSAGE = 'Not signed in. Saving is local only.';

@customElement('nav-bar')
export class NavBar extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const user = userState.get();
    const signedIn = !user.anonymous;
    const dark = isDarkTheme();

    return html`
      <span class="brand" @click=${() => Router.go('/editor')}>
        <!-- Absolute: the editor is served from nested paths too
             (/editor/{author}/{name}), where a relative src would 404. -->
        <img src="/img/ay_logo_white.png" alt="Archiyou">
      </span>

      <div class="spacer"></div>

      ${signedIn ? this._renderAccountMenu(user) : this._renderSignedOut()}

      <wa-button appearance="plain" class="theme-toggle" @click=${this._toggleTheme}>
        <wa-icon
          library="lucide"
          name=${dark ? 'sun' : 'moon'}
          label=${dark ? msg('Light mode') : msg('Dark mode')}
        ></wa-icon>
      </wa-button>
    `;
  }

  /** Signed-in: account dropdown with the user's name + a sign-out action. */
  private _renderAccountMenu(user: ReturnType<typeof userState.get>)
  {
    const label = user.name || user.email || msg('Account');
    return html`
      <wa-dropdown placement="bottom-end" @wa-select=${this._onMenuSelect}>
        <wa-button slot="trigger" appearance="plain" class="account signed-in" with-caret>
          <wa-icon slot="start" library="lucide" name="circle-user"></wa-icon>
          <span class="account-label">${label}</span>
        </wa-button>

        ${user.email
          ? html`<wa-dropdown-item disabled class="account-email">${user.email}</wa-dropdown-item>`
          : nothing}
        <wa-dropdown-item value="logout">
          <wa-icon slot="icon" library="lucide" name="log-out"></wa-icon>
          ${msg('Sign out')}
        </wa-dropdown-item>
      </wa-dropdown>
    `;
  }

  /** Anonymous: a warning icon (with tooltip) + a Sign-in account button. */
  private _renderSignedOut()
  {
    return html`
      <wa-button size="small" variant="brand" class="account" @click=${this._login}>
        <wa-icon slot="start" library="lucide" name="circle-user"></wa-icon>
        ${msg('Sign in')}
        <span id="nav-not-signed-in" slot="end" class="warning" tabindex="0" aria-label=${NOT_SIGNED_IN_MESSAGE} @click=${(e: Event) => e.stopPropagation()}>
          <wa-icon library="lucide" name="triangle-alert"></wa-icon>
        </span>
      </wa-button>
      <wa-tooltip for="nav-not-signed-in" placement="bottom">${msg(NOT_SIGNED_IN_MESSAGE)}</wa-tooltip>
    `;
  }

  // ── 4. Behaviour & Methods ──
  private _onMenuSelect(e: CustomEvent)
  {
    const value = (e.detail?.item as { value?: string } | undefined)?.value;
    if (value === 'logout') this._logout();
  }

  private _toggleTheme()
  {
    if (isDarkTheme()) removeDarkTheme();
    else applyDarkTheme();
    this.requestUpdate();
  }

  private _login()
  {
    Router.go('/login');
  }

  private _logout()
  {
    authService.logout();
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      height: 56px;
      padding: 0 var(--space-4);
      background: var(--color-secondary);
      border-bottom: 1px solid var(--color-border);
      gap: var(--space-3, 0.75rem);
    }

    .brand {
      display: flex;
      align-items: center;
      margin-left: 14px;
      cursor: pointer;
    }
    .brand img { height: 32px; }

    .spacer { flex: 1; }

    /* Not-signed-in warning */
    .warning {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--color-warning, #d97706);
      font-size: 1.15rem;
      cursor: help;
      outline: none;
    }
    .warning:focus-visible {
      outline: 2px solid var(--color-warning, #d97706);
      outline-offset: 2px;
      border-radius: 4px;
    }

    .account { --wa-color-text-link: var(--color-text); }

    /* Signed-in account label — white text, accent-colored icon.
       appearance="plain" buttons read --wa-color-on-quiet (not --wa-color-text-link)
       for their slotted text/icon color; the icon is overridden separately below. */
    .account.signed-in { --wa-color-on-quiet: var(--color-white, #ffffff); }
    .account.signed-in wa-icon[slot='start'] { color: var(--color-accent, #ffe200); }

    .account::part(base):hover {
      color: var(--color-accent, #ffe200);
      background-color: var(--color-secondary);
    }
    .account-label {
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .account-email::part(base) {
      font-size: 0.8rem;
      color: var(--color-text-muted);
      opacity: 0.85;
    }

    .theme-toggle { color: var(--color-text-muted); margin-right: var(--space-xs, 4px); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'nav-bar': NavBar;
  }
}
