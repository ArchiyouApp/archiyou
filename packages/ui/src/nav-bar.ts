import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { Router } from '@vaadin/router';
import { SignalWatcher } from '@lit-labs/signals';

import { userState } from '@archiyou/editor/src/state/workspace';
import { authService } from '@archiyou/editor/src/services/auth-service.js';
import {
  applyDarkTheme, removeDarkTheme, isDarkTheme,
  getThemePreference, setThemePreference,
} from '@archiyou/editor/src/styles/dark-theme.js';
import type { ThemePreference } from '@archiyou/editor/src/styles/dark-theme.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

/** Shown to anonymous users to flag that persistence is local-only. */
const NOT_SIGNED_IN_MESSAGE = 'Not signed in. Saving is local only.';

/** The three theme choices, in the order the segmented control shows them. */
const THEME_CHOICES: ReadonlyArray<{ value: ThemePreference; icon: string; label: string }> = [
  { value: 'light',  icon: 'sun',     label: 'Light mode' },
  { value: 'dark',   icon: 'moon',    label: 'Dark mode' },
  { value: 'system', icon: 'monitor', label: 'Match system' },
];

/** "archiyou" → "AR", "Jane Doe" → "JD". Falls back to the email's first letters. */
function initialsOf(name: string | null, email: string | null): string {
  const source = (name || email || '').trim();
  if (!source) return '?';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length >= 2
    ? words[0]![0]! + words[1]![0]!
    : source.slice(0, 2);
  return letters.toUpperCase();
}

@customElement('nav-bar')
export class NavBar extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const user = userState.get();
    const signedIn = !user.anonymous;

    return html`
      <span class="brand" @click=${() => Router.go('/browser')}>
        <!-- Absolute: the editor is served from nested paths too
             (/editor/{author}/{name}), where a relative src would 404. -->
        <img src="/img/ay_logo_white.png" alt="Archiyou">
      </span>

      <div class="spacer"></div>

      ${signedIn ? this._renderUserMenu(user) : this._renderSignedOut()}
    `;
  }

  /** Signed-in: avatar pill in the bar, account panel beneath it. */
  private _renderUserMenu(user: ReturnType<typeof userState.get>)
  {
    const name     = user.name || user.email || msg('Account');
    const initials = initialsOf(user.name, user.email);

    return html`
      <div class="user">
        <button
          class="user-trigger"
          aria-haspopup="menu"
          aria-expanded=${this._open ? 'true' : 'false'}
          @click=${this._toggleMenu}
        >
          ${this._renderAvatar(user.avatarUrl, initials)}
          <span class="user-trigger-name">${name}</span>
          <wa-icon library="lucide" name=${this._open ? 'chevron-up' : 'chevron-down'}></wa-icon>
        </button>

        ${this._open ? this._renderPanel(user, name, initials) : nothing}
      </div>
    `;
  }

  private _renderPanel(
    user: ReturnType<typeof userState.get>,
    name: string,
    initials: string,
  )
  {
    const preference = getThemePreference();

    return html`
      <div class="panel" role="menu" @click=${(e: Event) => e.stopPropagation()}>

        <div class="identity">
          ${this._renderAvatar(user.avatarUrl, initials, 'lg')}
          <div class="identity-text">
            <span class="identity-name">${name}</span>
            ${user.email ? html`<span class="identity-email">${user.email}</span>` : nothing}
          </div>
        </div>
        ${user.isAdmin ? html`<span class="badge-admin">${msg('Admin')}</span>` : nothing}

        <div class="separator"></div>

        ${user.isAdmin
          ? html`
            <button class="item" role="menuitem" @click=${() => this._go('/admin')}>
              <wa-icon library="lucide" name="shield"></wa-icon>
              ${msg('Admin panel')}
            </button>`
          : nothing}

        <div class="theme-seg" role="group" aria-label=${msg('Theme')}>
          ${THEME_CHOICES.map(choice => html`
            <button
              class=${`theme-seg-btn${preference === choice.value ? ' active' : ''}`}
              aria-pressed=${preference === choice.value ? 'true' : 'false'}
              title=${msg(choice.label)}
              @click=${() => this._setTheme(choice.value)}
            ><wa-icon library="lucide" name=${choice.icon} label=${msg(choice.label)}></wa-icon></button>
          `)}
        </div>

        <div class="separator"></div>

        <button class="item danger" role="menuitem" @click=${this._logout}>
          <wa-icon library="lucide" name="log-out"></wa-icon>
          ${msg('Sign out')}
        </button>
      </div>
    `;
  }

  private _renderAvatar(avatarUrl: string | null, initials: string, size: '' | 'lg' = '')
  {
    const cls = `avatar${size ? ' avatar-lg' : ''}`;
    return avatarUrl
      ? html`<img class=${cls} src=${avatarUrl} alt="">`
      : html`<span class=${cls} aria-hidden="true">${initials}</span>`;
  }

  /** Anonymous: a warning icon (with tooltip), a Sign-in button, and — since
   *  the theme control lives in the signed-in panel — a plain theme toggle. */
  private _renderSignedOut()
  {
    const dark = isDarkTheme();
    return html`
      <wa-button size="small" variant="brand" class="account" @click=${this._login}>
        <wa-icon slot="start" library="lucide" name="circle-user"></wa-icon>
        ${msg('Sign in')}
        <span id="nav-not-signed-in" slot="end" class="warning" tabindex="0" aria-label=${NOT_SIGNED_IN_MESSAGE} @click=${(e: Event) => e.stopPropagation()}>
          <wa-icon library="lucide" name="triangle-alert"></wa-icon>
        </span>
      </wa-button>
      <wa-tooltip for="nav-not-signed-in" placement="bottom">${msg(NOT_SIGNED_IN_MESSAGE)}</wa-tooltip>

      <wa-button appearance="plain" class="theme-toggle" @click=${this._toggleTheme}>
        <wa-icon
          library="lucide"
          name=${dark ? 'sun' : 'moon'}
          label=${dark ? msg('Light mode') : msg('Dark mode')}
        ></wa-icon>
      </wa-button>
    `;
  }

  // ── 2. State ──
  @state() private _open = false;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    document.addEventListener('click', this._onDocumentClick);
    document.addEventListener('keydown', this._onKeydown);
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocumentClick);
    document.removeEventListener('keydown', this._onKeydown);
  }

  // ── 4. Behaviour & Methods ──

  /** Any click that is not the trigger closes the panel — the panel itself
   *  stops propagation, so only a genuine outside click lands here. */
  private _onDocumentClick = () =>
  {
    if (this._open) this._open = false;
  };

  private _onKeydown = (e: KeyboardEvent) =>
  {
    if (e.key === 'Escape' && this._open) this._open = false;
  };

  private _toggleMenu(e: Event)
  {
    e.stopPropagation();
    this._open = !this._open;
  }

  private _setTheme(preference: ThemePreference)
  {
    setThemePreference(preference);
    this.requestUpdate();
  }

  private _go(path: string)
  {
    this._open = false;
    Router.go(path);
  }

  private _toggleTheme()
  {
    // Signed-out fallback: a plain flip, stored so it survives a reload.
    setThemePreference(isDarkTheme() ? 'light' : 'dark');
    this.requestUpdate();
  }

  private _login()
  {
    Router.go('/login');
  }

  private _logout()
  {
    this._open = false;
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
      /* The account panel hangs below the bar. */
      position: relative;
      z-index: 50;
    }

    *,
    *::before,
    *::after { box-sizing: border-box; }

    .brand {
      display: flex;
      align-items: center;
      margin-left: 14px;
      cursor: pointer;
    }
    .brand img { height: 32px; }

    .spacer { flex: 1; }

    /* ── Avatar chip ── */

    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-full);
      background: var(--color-avatar-bg);
      color: var(--color-secondary);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.02em;
      object-fit: cover;
      user-select: none;
    }

    .avatar-lg {
      width: 38px;
      height: 38px;
      font-size: var(--text-sm);
    }

    /* ── Trigger pill ── */

    .user {
      position: relative;
      /* Full bar height, so the panel's top offset below is measured from the
         bar's edge rather than from the pill's centred 40px box. */
      align-self: stretch;
      display: flex;
      align-items: center;
      /* Pulls the pill — and with it the panel, which anchors to this box —
         in off the window edge, clear of an overlay scrollbar. */
      margin-right: var(--space-md);
    }

    .user-trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--space-sm);
      height: 40px;
      padding: 0 var(--space-md) 0 6px;
      border: none;
      border-radius: var(--radius-full);
      /* A step up from the bar rather than its own colour, so it stays right
         whatever --color-secondary becomes. */
      background: color-mix(in srgb, var(--color-white) 12%, var(--color-secondary));
      color: var(--color-white);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      transition: background 0.1s;
    }

    .user-trigger:hover {
      background: color-mix(in srgb, var(--color-white) 18%, var(--color-secondary));
    }

    .user-trigger:focus-visible {
      outline: 2px solid var(--color-avatar-bg);
      outline-offset: 2px;
    }

    .user-trigger-name {
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .user-trigger wa-icon {
      font-size: 0.9rem;
      opacity: 0.7;
    }

    /* ── Panel ── */

    .panel {
      position: absolute;
      top: calc(100% + var(--space-md));
      right: 0;
      z-index: 10;
      min-width: 260px;
      padding: var(--space-sm);
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-divider);
      border-radius: var(--radius-lg);
      box-shadow: 0 12px 32px rgb(0 0 0 / 0.16);
      font-family: var(--font-sans);
      cursor: default;
    }

    .identity {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-xs) var(--space-xs) 0;
    }

    .identity-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .identity-name {
      font-size: var(--text-base);
      font-weight: 600;
      color: var(--color-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .identity-email {
      font-size: var(--text-xs);
      color: var(--color-text-gray);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge-admin {
      display: inline-flex;
      align-items: center;
      margin: var(--space-xs) 0 0 var(--space-xs);
      padding: 2px 8px;
      border-radius: var(--radius-full);
      background: var(--color-primary-subtle);
      /* --color-primary flips with the theme; --color-primary-dark does not,
         and would leave dark-blue text on the dark-blue subtle fill. */
      color: var(--color-primary);
      font-size: var(--text-xs);
      font-weight: 600;
    }

    .separator {
      height: 1px;
      margin: var(--space-sm) 0;
      background: var(--color-divider);
    }

    /* ── Menu items ── */

    .item {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      width: 100%;
      padding: var(--space-xs) var(--space-sm);
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      text-align: left;
      cursor: pointer;
    }

    .item + .item { margin-top: 2px; }

    .item wa-icon {
      flex-shrink: 0;
      font-size: 1rem;
      color: var(--color-text-gray);
    }

    .item:hover:not([disabled]),
    .item:focus-visible:not([disabled]) {
      background: var(--color-surface-subtle);
      outline: none;
    }

    .item[disabled] {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .item.danger,
    .item.danger wa-icon { color: var(--color-danger); }

    .item.danger:hover {
      background: color-mix(in srgb, var(--color-danger) 10%, transparent);
    }

    /* ── Theme segmented control ── */

    .theme-seg {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2px;
      margin-top: var(--space-sm);
      padding: 2px;
      border-radius: var(--radius-md);
      background: var(--color-surface-subtle);
    }

    .theme-seg-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 26px;
      border: none;
      border-radius: calc(var(--radius-md) - 2px);
      background: transparent;
      color: var(--color-text-gray);
      cursor: pointer;
      font-size: 0.95rem;
      transition: background 0.1s, color 0.1s;
    }

    .theme-seg-btn:hover { color: var(--color-text); }

    .theme-seg-btn.active {
      background: var(--color-bg-elevated);
      color: var(--color-text);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
    }

    .theme-seg-btn:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: -2px;
    }

    /* ── Signed-out ── */

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

    .account::part(base):hover {
      color: var(--color-accent, #ffe200);
      background-color: var(--color-secondary);
    }

    /* Lines the toggle's glyph up with the right toolbar's icon column, which
       centres 32px in from the edge (its 8px padding + half its 48px width). */
    .theme-toggle {
      color: var(--color-text-muted);
      padding-right: var(--space-md);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'nav-bar': NavBar;
  }
}
