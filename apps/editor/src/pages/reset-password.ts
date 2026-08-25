import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import { msg } from '@lit/localize';
// WebAwesome autoloader can't see tags inside a shadow root — register explicitly.
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { authService } from '../services/auth-service.js';
import { pullUserScripts } from '../services/scripts-sync.js';

const MIN_PASSWORD = 8;

@customElement('page-reset-password')
export class PageResetPassword extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="card">
        <div class="logo"><img src="/img/archiyou_logo_header.png" alt="Archiyou" /></div>

        ${!this._token ? this._renderNoToken() : this._renderForm()}
      </div>
    `;
  }

  private _renderForm()
  {
    return html`
      <h1>${msg('Set a new password')}</h1>
      <p>${msg('Choose a new password for your account.')}</p>

      <form @submit=${this._handleSubmit}>
        <wa-input class="field" type="password" placeholder=${msg('New password')}
               .value=${this._password} @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)}>
          <wa-icon slot="start" library="lucide" name="lock"></wa-icon>
        </wa-input>

        <wa-input class="field" type="password" placeholder=${msg('Confirm new password')}
               .value=${this._confirm} @input=${(e: Event) => (this._confirm = (e.target as HTMLInputElement).value)}>
          <wa-icon slot="start" library="lucide" name="lock"></wa-icon>
        </wa-input>

        ${this._error ? html`<div class="error">${this._error}</div>` : null}

        <wa-button variant="brand" size="large" type="submit" ?loading=${this._loading} class="submit"
          @click=${this._handleSubmit}>
          <wa-icon slot="start" library="lucide" name="check"></wa-icon>
          ${msg('Update password')}
        </wa-button>
      </form>
    `;
  }

  private _renderNoToken()
  {
    return html`
      <wa-icon class="big-icon" library="lucide" name="triangle-alert"></wa-icon>
      <h1>${msg('Invalid reset link')}</h1>
      <p>${msg('This password-reset link is invalid or has expired.')}</p>
      <button class="switch" @click=${() => Router.go('/forgot-password')}>${msg('Request a new link')}</button>
    `;
  }

  // ── 2. State ──
  @state() private _token: string | null = null;
  @state() private _password = '';
  @state() private _confirm = '';
  @state() private _loading = false;
  @state() private _error: string | null = null;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    this._token = new URLSearchParams(window.location.search).get('token');
  }

  // ── 4. Behaviour ──
  private async _handleSubmit(e: Event)
  {
    e.preventDefault();
    if (this._loading || !this._token) return;

    if (this._password.length < MIN_PASSWORD)
    {
      this._error = msg('Password must be at least 8 characters');
      return;
    }
    if (this._password !== this._confirm)
    {
      this._error = msg('Passwords do not match');
      return;
    }

    this._loading = true;
    this._error = null;
    try
    {
      await authService.resetPassword(this._token, this._password);
      await pullUserScripts();
      Router.go('/');
    }
    catch (err)
    {
      this._error = err instanceof Error ? err.message : msg('Could not reset password');
      this._loading = false;
    }
  }

  // ── 5. Styles ── (shared look with login.ts)
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
    .big-icon { font-size: 2.5rem; color: var(--color-warning, #f59e0b); }
    h1 {
      font-family: var(--font-display, var(--font-sans, sans-serif));
      font-size: var(--text-2xl, 1.5rem);
      color: var(--color-text);
      margin: 0 0 var(--space-xs, 4px);
    }
    p {
      color: var(--color-text-muted);
      font-size: var(--text-sm, 0.875rem);
      margin: 0 0 var(--space-xl, 24px);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: var(--space-lg, 16px);
      margin-bottom: var(--space-lg, 16px);
    }
    .field { width: 100%; text-align: left; }
    .error {
      color: var(--color-danger, #dc2626);
      font-size: var(--text-sm, 0.85rem);
      text-align: center;
      margin: calc(-1 * var(--space-xs, 4px)) 0 0;
    }
    .submit { width: 100%; }
    .switch {
      margin-top: var(--space-sm, 8px);
      background: none;
      border: none;
      color: var(--color-text-muted);
      cursor: pointer;
      font: inherit;
      font-size: 0.85rem;
      text-decoration: underline;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-reset-password': PageResetPassword;
  }
}
