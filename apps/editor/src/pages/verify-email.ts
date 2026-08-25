/**
 * page-verify-email — landing page for the link in the confirmation email.
 *
 * The server mints `${FRONTEND_URL}/verify-email?token=…` (see
 * apps/server/src/routes/auth.ts). This page posts that token straight back and
 * shows the outcome; the server answers 200 for an already-confirmed address, so
 * a link opened twice reads as success rather than an error.
 *
 * Layout and styling mirror pages/reset-password.ts, the other token-landing page.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import { msg } from '@lit/localize';
// WebAwesome autoloader can't see tags inside a shadow root — register explicitly.
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { authService } from '../services/auth-service.js';

type Status = 'checking' | 'ok' | 'failed' | 'no-token';

@customElement('page-verify-email')
export class PageVerifyEmail extends LitElement
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
      case 'checking':
        return html`
          <wa-icon class="big-icon spin" library="lucide" name="loader-circle"></wa-icon>
          <h1>${msg('Confirming your email…')}</h1>
        `;

      case 'ok':
        return html`
          <wa-icon class="big-icon ok" library="lucide" name="circle-check"></wa-icon>
          <h1>${msg('Email confirmed')}</h1>
          <p>${msg('Thanks! Your account is fully set up — you can now publish and share your work.')}</p>
          <wa-button variant="brand" size="large" class="submit" @click=${() => Router.go('/')}>
            ${msg('Continue to Archiyou')}
          </wa-button>
        `;

      case 'no-token':
        return html`
          <wa-icon class="big-icon warn" library="lucide" name="triangle-alert"></wa-icon>
          <h1>${msg('Invalid confirmation link')}</h1>
          <p>${msg('This link is missing its token. Please open the link from your confirmation email.')}</p>
          <wa-button variant="neutral" class="submit" @click=${() => Router.go('/')}>
            ${msg('Back to Archiyou')}
          </wa-button>
        `;

      case 'failed':
        return html`
          <wa-icon class="big-icon warn" library="lucide" name="triangle-alert"></wa-icon>
          <h1>${msg('Could not confirm your email')}</h1>
          <p>${this._error ?? msg('This confirmation link is invalid or has expired.')}</p>
          ${authService.isAuthenticated()
            ? html`
                <wa-button variant="brand" class="submit" ?loading=${this._resending} @click=${this._handleResend}>
                  ${msg('Send a new link')}
                </wa-button>
                ${this._resent ? html`<p class="hint">${msg('Sent — check your inbox.')}</p>` : null}
              `
            : html`
                <p class="hint">${msg('Sign in first, then request a new confirmation email.')}</p>
                <wa-button variant="brand" class="submit" @click=${() => Router.go('/login')}>
                  ${msg('Sign in')}
                </wa-button>
              `}
        `;
    }
  }

  // ── 2. State ──
  @state() private _status: Status = 'checking';
  @state() private _error: string | null = null;
  @state() private _resending = false;
  @state() private _resent = false;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    void this._verify();
  }

  // ── 4. Behaviour ──
  private async _verify()
  {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token)
    {
      this._status = 'no-token';
      return;
    }
    try
    {
      await authService.verifyEmail(token);
      this._status = 'ok';
    }
    catch (err)
    {
      this._error = err instanceof Error ? err.message : null;
      this._status = 'failed';
    }
  }

  private async _handleResend()
  {
    if (this._resending) return;
    this._resending = true;
    try
    {
      await authService.resendVerification();
      this._resent = true;
    }
    catch (err)
    {
      this._error = err instanceof Error ? err.message : msg('Could not send a new link');
    }
    finally
    {
      this._resending = false;
    }
  }

  // ── 5. Styles ── (shared look with reset-password.ts / login.ts)
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
    .big-icon { font-size: 2.5rem; }
    .big-icon.ok { color: var(--color-success, #16a34a); }
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
      margin: 0 0 var(--space-xl, 24px);
    }
    p.hint { margin: var(--space-sm, 8px) 0 0; }
    .submit { width: 100%; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-verify-email': PageVerifyEmail;
  }
}
