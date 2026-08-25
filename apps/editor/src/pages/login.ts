import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import { msg } from '@lit/localize';
// The WebAwesome autoloader only discovers tags in the light DOM, so components
// used inside this element's shadow root must be registered explicitly (same
// pattern as packages/ui/src/nav-bar.ts).
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { authService } from '../services/auth-service.js';
import { pullUserScripts } from '../services/scripts-sync.js';

type Mode = 'login' | 'register';

@customElement('page-login')
export class PageLogin extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    const isRegister = this._mode === 'register';
    return html`
      <div class="card">
        <div class="logo">
          <img src="/img/archiyou_logo_header.png" alt="Archiyou" />
        </div>

        <h1>${isRegister ? msg('Create your account') : msg('Welcome back')}</h1>
        <p>${isRegister ? msg('Sign up to get started') : msg('Sign in to continue')}</p>

        <form @submit=${this._handleSubmit}>
          ${isRegister
            ? html`<wa-input class="field" type="text" placeholder=${msg('Name (optional)')}
                     .value=${this._name} @input=${(e: Event) => (this._name = (e.target as HTMLInputElement).value)}>
                     <wa-icon slot="start" library="lucide" name="user"></wa-icon>
                   </wa-input>`
            : null}

          <wa-input class="field" type=${isRegister ? 'email' : 'text'}
                 placeholder=${isRegister ? msg('Email') : msg('Email or username')}
                 .value=${this._email} @input=${(e: Event) => (this._email = (e.target as HTMLInputElement).value)}>
            <wa-icon slot="start" library="lucide" name=${isRegister ? 'mail' : 'at-sign'}></wa-icon>
          </wa-input>

          <wa-input class="field" type="password"
                 placeholder=${msg('Password')}
                 .value=${this._password} @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)}>
            <wa-icon slot="start" library="lucide" name="lock"></wa-icon>
          </wa-input>

          ${!isRegister
            ? html`<button type="button" class="forgot" @click=${() => Router.go('/forgot-password')}>
                     ${msg('Forgot password?')}
                   </button>`
            : null}

          ${this._error ? html`<div class="error">${this._error}</div>` : null}

          <wa-button variant="brand" size="large" type="submit" ?loading=${this._loading} class="submit"
            @click=${this._handleSubmit}>
            <wa-icon slot="start" library="lucide" name="log-in"></wa-icon>
            ${isRegister ? msg('Create account') : msg('Sign in')}
          </wa-button>
        </form>

        <button class="switch" @click=${this._toggleMode}>
          ${isRegister
            ? msg('Already have an account? Sign in')
            : msg("Don't have an account? Create one")}
        </button>
      </div>
    `;
  }

  // ── 2. State ──
  @state() private _loading = false;
  @state() private _mode: Mode = 'login';
  @state() private _email = '';
  @state() private _password = '';
  @state() private _name = '';
  @state() private _error: string | null = null;

  // ── 4. Behaviour & Methods ──
  private _toggleMode()
  {
    this._mode = this._mode === 'login' ? 'register' : 'login';
    this._error = null;
  }

  private async _handleSubmit(e: Event)
  {
    // Handles both the form's `submit` (Enter key) and the button's `click`.
    // wa-button doesn't reliably submit the light-DOM form, so we drive it from
    // the click too; guard against a double-fire when both events arrive.
    e.preventDefault();
    if (this._loading) return;
    this._loading = true;
    this._error = null;
    try
    {
      if (this._mode === 'register')
        await authService.register(this._email, this._password, this._name || undefined);
      else
        await authService.login(this._email, this._password);

      await pullUserScripts();
      Router.go('/');
    }
    catch (err)
    {
      this._error = err instanceof Error ? err.message : msg('Sign in failed');
      this._loading = false;
    }
  }

  /* Google sign-in is hidden for now — the "Continue with Google" button and the "or"
     divider were removed from render(). The service call below stays wired up
     (authService.loginWithGoogle()); to bring it back, restore this handler and:

       <div class="divider"><span>${'or'}</span></div>

       <wa-button variant="neutral" appearance="outlined" class="google" @click=${'this._handleGoogle'}>
         ${'Continue with Google'}
       </wa-button>

     The .google and .divider styles are still in place.

  private _handleGoogle()
  {
    authService.loginWithGoogle();
  }
  */

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: var(--space-lg, 16px);
      box-sizing: border-box;
      /* Grey page behind the card (light: #f3f3f3, dark: slate). */
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

    /* The header logo is dark-on-transparent, so keep it on a white plate — it
       stays legible on the card in both light and dark themes. */
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

    .field {
      width: 100%;
      text-align: left;
    }

    /* Centered under the input fields. */
    .error {
      color: var(--color-danger, #dc2626);
      font-size: var(--text-sm, 0.85rem);
      text-align: center;
      margin: calc(-1 * var(--space-xs, 4px)) 0 0;
    }

    /* "Forgot password?" — right-aligned text link just under the password field. */
    .forgot {
      align-self: flex-end;
      margin: calc(-1 * var(--space-sm, 8px)) 0 0;
      padding: 0;
      background: none;
      border: none;
      color: var(--color-text-muted);
      cursor: pointer;
      font: inherit;
      font-size: 0.8rem;
      text-decoration: underline;
    }

    .submit { width: 100%; }
    .google { width: 100%; }

    .divider {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: var(--color-text-muted);
      font-size: 0.8rem;
      margin: var(--space-lg, 16px) 0;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--color-border);
    }

    .switch {
      margin-top: var(--space-lg, 16px);
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
    'page-login': PageLogin;
  }
}
