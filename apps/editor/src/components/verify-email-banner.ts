/**
 * <verify-email-banner> — nudges a signed-in user with an unconfirmed address.
 *
 * Shown in layout-main above the page content. Only rendered when someone is
 * signed in and `emailVerified` is false, so it is invisible for anonymous
 * visitors and for the grandfathered accounts that predate verification.
 *
 * Why it matters: publishing and sharing are gated on a confirmed address
 * (requireVerified in apps/server/src/routes/scripts.ts), and without this the
 * only feedback would be a 403 at the moment the user tries to publish.
 *
 * Dismissal is per-session (sessionStorage) rather than permanent: the nudge
 * should come back next visit if the address is still unconfirmed.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { authService, currentUser } from '../services/auth-service.js';

const DISMISS_KEY = 'archiyou:verify-banner:dismissed';

@customElement('verify-email-banner')
export class VerifyEmailBanner extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const user = currentUser.get();
    if (!user || user.emailVerified || this._dismissed) return null;

    return html`
      <div class="bar" role="status">
        <wa-icon library="lucide" name="mail-warning"></wa-icon>
        <span class="text">
          ${this._resent
            ? msg('Confirmation email sent — check your inbox.')
            : msg('Please confirm your email address to publish or share your work.')}
        </span>
        ${this._error ? html`<span class="error">${this._error}</span>` : null}
        ${!this._resent
          ? html`
              <wa-button size="small" variant="brand" ?loading=${this._sending} @click=${this._handleResend}>
                ${msg('Resend email')}
              </wa-button>`
          : null}
        <button class="close" aria-label=${msg('Dismiss')} @click=${this._handleDismiss}>
          <wa-icon library="lucide" name="x"></wa-icon>
        </button>
      </div>
    `;
  }

  // ── 2. State ──
  @state() private _sending = false;
  @state() private _resent = false;
  @state() private _error: string | null = null;
  @state() private _dismissed = readDismissed();

  // ── 4. Behaviour ──
  private async _handleResend()
  {
    if (this._sending) return;
    this._sending = true;
    this._error = null;
    try
    {
      const alreadyVerified = await authService.resendVerification();
      if (alreadyVerified)
      {
        // Our copy of the user was stale — refresh so the banner disappears.
        await authService.refresh();
      }
      else
      {
        this._resent = true;
      }
    }
    catch (err)
    {
      this._error = err instanceof Error ? err.message : msg('Could not send the email');
    }
    finally
    {
      this._sending = false;
    }
  }

  private _handleDismiss()
  {
    this._dismissed = true;
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable */ }
  }

  // ── 5. Styles ──
  static override styles = css`
    .bar {
      display: flex;
      align-items: center;
      gap: var(--space-sm, 8px);
      padding: var(--space-sm, 8px) var(--space-lg, 16px);
      background: var(--color-warning-subtle, #fff7ed);
      border-bottom: 1px solid var(--color-border, #e5e7eb);
      color: var(--color-text, #1f2937);
      font-size: var(--text-sm, 0.875rem);
    }
    .text { flex: 1; min-width: 0; }
    .error { color: var(--color-danger, #dc2626); }
    .close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-text-muted);
      display: inline-flex;
      padding: 2px;
    }
  `;
}

function readDismissed(): boolean
{
  try { return sessionStorage.getItem(DISMISS_KEY) === '1'; }
  catch { return false; }
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'verify-email-banner': VerifyEmailBanner;
  }
}
