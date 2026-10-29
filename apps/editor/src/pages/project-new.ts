/**
 * page-project-new — "Save as project" from a published configurator, at /projects/new.
 *
 * The configurator's button links here with the design in the query (services/save-project).
 * The page keeps the design, then:
 *   - anonymous: on to /login, which returns here once the visitor has signed in or made an
 *     account
 *   - signed in, address not confirmed yet (projects email clients, so the server asks for a
 *     confirmed address): asks to open the confirmation link, and continues by itself when
 *     the visitor comes back to this tab, or from the confirmation page in another tab
 *   - signed in and confirmed: makes the project and opens it, where the professional goes
 *     on as with any project (client, deliveries)
 *
 * Standalone like the other account pages (no nav bar): it is a step on the way to the
 * project, not a place to stay.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import { msg, str } from '@lit/localize';
// WebAwesome autoloader can't see tags inside a shadow root — register explicitly.
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { authService, currentUser } from '../services/auth-service.js';
import { ApiError } from '../services/api.js';
import {
  SAVE_PROJECT_PATH, SAVE_PROJECT_STORAGE_KEY, pendingProject, pendingProjectFromQuery, savePendingProject, storePendingProject,
} from '../services/save-project.js';

type Status = 'saving' | 'unverified' | 'failed' | 'nothing';

@customElement('page-project-new')
export class PageProjectNew extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="card">
        <div class="logo"><img src="/img/archiyou_logo_header.png" alt="Archiyou" /></div>
        ${this._renderBody()}
      </div>
    `;
  }

  private _renderBody()
  {
    switch (this._status)
    {
      case 'saving':
        return html`
          <wa-icon class="big-icon spin" library="lucide" name="loader-circle"></wa-icon>
          <h1>${msg('Saving your project…')}</h1>
        `;

      case 'unverified':
      {
        const email = currentUser.get()?.email ?? '';
        return html`
          <wa-icon class="big-icon" library="lucide" name="mail-check"></wa-icon>
          <h1>${msg('Confirm your email address')}</h1>
          <p>${email
            ? msg(str`Your design is kept. Open the link we sent to ${email}, then your project is saved.`)
            : msg('Your design is kept. Open the link in the confirmation email, then your project is saved.')}</p>
          <wa-button variant="brand" size="large" class="submit" @click=${() => void this._save()}>
            ${msg('I have confirmed it')}
          </wa-button>
          <wa-button variant="neutral" appearance="plain" class="submit" ?loading=${this._resending} @click=${this._handleResend}>
            ${msg('Send a new link')}
          </wa-button>
          ${this._resent ? html`<p class="hint">${msg('Sent — check your inbox.')}</p>` : null}
        `;
      }

      case 'failed':
        return html`
          <wa-icon class="big-icon warn" library="lucide" name="triangle-alert"></wa-icon>
          <h1>${msg('Could not save your project')}</h1>
          <p>${this._error ?? msg('Something went wrong.')}</p>
          <wa-button variant="brand" class="submit" @click=${() => void this._save()}>
            ${msg('Try again')}
          </wa-button>
        `;

      case 'nothing':
        return html`
          <wa-icon class="big-icon warn" library="lucide" name="triangle-alert"></wa-icon>
          <h1>${msg('No design to save')}</h1>
          <p>${msg('Open a configurator and choose "Save as project" there.')}</p>
          <wa-button variant="neutral" class="submit" @click=${() => Router.go('/')}>
            ${msg('Back to Archiyou')}
          </wa-button>
        `;
    }
  }

  // ── 2. State ──
  @state() private _status: Status = 'saving';
  @state() private _error: string | null = null;
  @state() private _resending = false;
  @state() private _resent = false;

  private _busy = false;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    // Back from the mail client, or the confirmation page saved it in another tab
    window.addEventListener('focus', this._onReturn);
    window.addEventListener('storage', this._onStorage);

    const fromLink = pendingProjectFromQuery(window.location.search);
    if (fromLink)
    {
      storePendingProject(fromLink);
      // A reload or the back button must not bring the design back as a new one
      window.history.replaceState(window.history.state, '', SAVE_PROJECT_PATH);
    }
    void this._save();
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    window.removeEventListener('focus', this._onReturn);
    window.removeEventListener('storage', this._onStorage);
  }

  // ── 4. Behaviour ──
  private _onReturn = () =>
  {
    if (this._status === 'unverified') void this._save();
  };

  /** Only the design's own key: confirming the address in another tab also writes a new
   *  session token, which says nothing about the project. */
  private _onStorage = (e: StorageEvent) =>
  {
    if (e.key === SAVE_PROJECT_STORAGE_KEY) this._onReturn();
  };

  private async _save()
  {
    if (this._busy) return;
    const pending = pendingProject();
    if (!pending)
    {
      this._status = 'nothing';
      return;
    }
    if (pending.savedAs)
    {
      Router.go(`/projects/${encodeURIComponent(pending.savedAs)}`);
      return;
    }
    if (!authService.isAuthenticated())
    {
      Router.go(`/login?next=${encodeURIComponent(SAVE_PROJECT_PATH)}&for=project`);
      return;
    }

    this._busy = true;
    const shown = this._status;
    // A check after coming back to the tab keeps the page as it is until it knows more
    if (shown !== 'unverified') this._status = 'saving';
    try
    {
      const id = await savePendingProject();
      if (id) Router.go(`/projects/${encodeURIComponent(id)}`);
      else this._status = 'nothing';
    }
    catch (err)
    {
      const body = (err instanceof ApiError ? err.body : null) as { error?: string; code?: string } | null;
      if (body?.code === 'email_not_verified') this._status = 'unverified';
      else if (err instanceof ApiError && err.status === 401)
        Router.go(`/login?next=${encodeURIComponent(SAVE_PROJECT_PATH)}&for=project`);
      else
      {
        this._error = body?.error ?? (err instanceof Error ? err.message : null);
        this._status = 'failed';
      }
    }
    finally
    {
      this._busy = false;
    }
  }

  private async _handleResend()
  {
    if (this._resending) return;
    this._resending = true;
    try
    {
      // Already confirmed (in another browser): then the project can be made now
      if (await authService.resendVerification()) void this._save();
      else this._resent = true;
    }
    catch (err)
    {
      this._error = err instanceof Error ? err.message : msg('Could not send a new link');
      this._status = 'failed';
    }
    finally
    {
      this._resending = false;
    }
  }

  // ── 5. Styles ── (shared look with verify-email.ts / login.ts)
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: var(--space-lg, 16px);
      box-sizing: border-box;
      background: var(--color-gray, #f3f3f3);
    }
    .card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-xs, 4px);
      background: var(--color-bg-elevated, #fff);
      border: 1px solid var(--color-border, #cfcfcf);
      border-radius: var(--radius-lg, 12px);
      padding: var(--space-2xl, 32px);
      text-align: center;
      max-width: 380px;
      width: 100%;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
    }
    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      border-radius: var(--radius-lg, 12px);
      padding: 10px 18px;
      margin-bottom: var(--space-lg, 16px);
    }
    .logo img { height: 40px; display: block; }
    .big-icon { font-size: 2.5rem; color: var(--color-primary); }
    .big-icon.warn { color: var(--color-warning, #f59e0b); }
    .spin { animation: spin 1s linear infinite; color: var(--color-text-muted); }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
    h1 {
      font-family: var(--font-display, var(--font-sans, sans-serif));
      font-size: var(--text-2xl, 1.5rem);
      color: var(--color-text);
      margin: var(--space-sm, 8px) 0 var(--space-xs, 4px);
    }
    p {
      color: var(--color-text-muted);
      font-size: var(--text-sm, 0.875rem);
      margin: 0 0 var(--space-lg, 16px);
    }
    p.hint { margin: var(--space-sm, 8px) 0 0; }
    .submit { width: 100%; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-project-new': PageProjectNew;
  }
}
