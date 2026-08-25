import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import { msg } from '@lit/localize';
// WebAwesome autoloader can't see tags inside a shadow root — register explicitly
// (same pattern as login.ts / packages/ui components).
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { authService } from '../services/auth-service.js';

@customElement('page-forgot-password')
export class PageForgotPassword extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="card">
        <div class="logo"><img src="/img/archiyou_logo_header.png" alt="Archiyou" /></div>

        ${this._sent ? this._renderSent() : this._renderForm()}
      </div>
    `;
  }

  private _renderForm()
  {
    return html`
      <h1>${msg('Forgot your password?')}</h1>
      <p>${msg('Enter your email and we’ll send you a link to reset it.')}</p>

      <form @submit=${this._handleSubmit}>
        <wa-input class="field" type="email" placeholder=${msg('Email')}
               .value=${this._email} @input=${(e: Event) => (this._email = (e.target as HTMLInputElement).value)}>
          <wa-icon slot="start" library="lucide" name="mail"></wa-icon>
        </wa-input>

        ${this._error ? html`<div class="error">${this._error}</div>` : null}

        <wa-button variant="brand" size="large" type="submit" ?loading=${this._loading} class="submit"
          @click=${this._handleSubmit}>
          <wa-icon slot="start" library="lucide" name="send"></wa-icon>
          ${msg('Send reset link')}
        </wa-button>
      </form>

      <button class="switch" @click=${() => Router.go('/login')}>${msg('Back to sign in')}</button>
    `;
  }

  private _renderSent()
  {
    return html`
      <wa-icon class="big-icon" library="lucide" name="mail-check"></wa-icon>
      <h1>${msg('Check your email')}</h1>
      <p>${msg('If an account exists for that email, we’ve sent a link to reset your password. The link expires in 1 hour.')}</p>
      <button class="switch" @click=${() => Router.go('/login')}>${msg('Back to sign in')}</button>
    `;
  }

  // ── 2. State ──
  @state() private _email = '';
  @state() private _loading = false;
  @state() private _sent = false;
  @state() private _error: string | null = null;

  // ── 4. Behaviour ──
  private async _handleSubmit(e: Event)
  {
    e.preventDefault();
    if (this._loading) return;
    this._loading = true;
    this._error = null;
    try
    {
      await authService.forgotPassword(this._email);
      // Always show the same neutral confirmation (no account enumeration).
      this._sent = true;
    }
    catch (err)
    {
      this._error = err instanceof Error ? err.message : msg('Something went wrong');
    }
    finally
    {
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
    .big-icon { font-size: 2.5rem; color: var(--color-brand, #103eaa); }
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
    'page-forgot-password': PageForgotPassword;
  }
}
