/**
 * configurator-attribution — the small "made with Archiyou" bar that floats over
 * the bottom-right corner of the configurator viewer, plus a feedback affordance.
 *
 * Sending posts the message to the server (services/feedback.ts → POST /feedback),
 * where operators read it on /admin/feedback. The form stays open with the message
 * intact when that fails, so nothing typed is lost.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

import { sendConfiguratorFeedback } from '@archiyou/editor/src/services/feedback';

/** Where the Archiyou logo links to. */
const ARCHIYOU_URL = 'https://archiyou.com';

@customElement('configurator-attribution')
export class ConfiguratorAttribution extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      ${this._open ? this._renderForm() : nothing}

      <div class="bar">
        <a class="brand" href=${ARCHIYOU_URL} target="_blank" rel="noopener"
            title="Made with Archiyou">
          <img src="/img/archiyou_logo_header.png" alt="Archiyou">
        </a>
        <button id="feedback-btn" class="icon-btn ${this._open ? 'active' : ''}"
            aria-label="Give feedback"
            @click=${this._toggle}>
          <wa-icon library="lucide" name="message-square"></wa-icon>
        </button>
        <!-- Suppressed while the form is up: it would sit on top of it. -->
        ${this._open
          ? nothing
          : html`<wa-tooltip for="feedback-btn" placement="top">Give feedback</wa-tooltip>`}
      </div>
    `;
  }

  private _renderForm()
  {
    if (this._sent)
    {
      return html`
        <div class="panel sent">
          <wa-icon library="lucide" name="circle-check"></wa-icon>
          <span>Thanks for the feedback!</span>
        </div>
      `;
    }

    return html`
      <div class="panel">
        <div class="panel-header">
          <span>Feedback</span>
          <button class="icon-btn small" aria-label="Close" @click=${this._close}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>
        <textarea
          class="message"
          rows="3"
          placeholder="What could be better here?"
          .value=${this._message}
          @input=${(e: InputEvent) => (this._message = (e.target as HTMLTextAreaElement).value)}
          @keydown=${this._onKeydown}
        ></textarea>
        ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}
        <div class="panel-actions">
          <button class="btn-send" ?disabled=${!this._message.trim() || this._sending} @click=${this._send}>
            ${this._sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    `;
  }

  // ── 2. State ──
  @state() private _open = false;
  @state() private _sent = false;
  @state() private _message = '';
  @state() private _sending = false;
  @state() private _error = '';

  private _sentTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 3. Lifecycle ──
  override disconnectedCallback()
  {
    super.disconnectedCallback();
    if (this._sentTimer !== null) clearTimeout(this._sentTimer);
  }

  // ── 4. Behaviour & Methods ──
  private _toggle()
  {
    this._open = !this._open;
    if (this._open)
    {
      this._sent = false;
      this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLTextAreaElement>('.message')?.focus());
    }
  }

  private _close()
  {
    this._open = false;
    this._sent = false;
    this._error = '';
  }

  private _onKeydown(e: KeyboardEvent)
  {
    if (e.key === 'Escape') { this._close(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this._send();
  }

  private async _send()
  {
    const message = this._message.trim();
    if (!message || this._sending) return;

    this._sending = true;
    this._error = '';
    try
    {
      await sendConfiguratorFeedback(message);
    }
    catch (err)
    {
      const status = (err as { status?: number })?.status;
      this._error = status === 429
        ? 'Too much feedback at once. Please try again in a few minutes.'
        : 'Could not send your feedback. Please try again.';
      return;
    }
    finally
    {
      this._sending = false;
    }

    this._message = '';
    this._sent = true;
    if (this._sentTimer !== null) clearTimeout(this._sentTimer);
    this._sentTimer = setTimeout(() => { this._open = false; this._sent = false; }, 2000);
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--space-sm);
      font-family: var(--font-sans);
    }

    /* Deliberately white in both themes — it reads as a sticker on the model,
       and the dark-text Archiyou logo needs a light ground. */
    .bar
    {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding: 4px 6px 4px 12px;
      border-radius: var(--radius-full, 9999px);
      background: var(--color-white, #fff);
    }

    .brand
    {
      display: flex;
      align-items: center;
      line-height: 0;
      opacity: 0.9;
    }

    .brand:hover { opacity: 1; }

    .brand img
    {
      height: 14px;
      width: auto;
      display: block;
    }

    .icon-btn
    {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: var(--radius-full, 9999px);
      background: transparent;
      color: var(--color-gray-dark, #666);
      font-size: 16px;
      cursor: pointer;
    }

    .icon-btn:hover,
    .icon-btn.active
    {
      background: color-mix(in srgb, var(--color-primary) 12%, transparent);
      color: var(--color-primary);
    }

    /* The bar is white in both themes, so its foreground can't follow the theme
       tokens — in dark mode --color-gray-dark/--color-primary are light values
       that would wash out against white. */
    .bar .icon-btn { color: #666; }

    .bar .icon-btn:hover,
    .bar .icon-btn.active
    {
      background: rgb(16 62 170 / 0.10);
      color: #103eaa;
    }

    /* ── Feedback panel ── */

    .panel
    {
      width: 280px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      /* One consistent inset on all four sides. */
      padding: var(--space-md);
      border-radius: var(--radius-md, 8px);
      border: 1px solid var(--color-border);
      background: var(--color-bg-elevated, #fff);
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
    }

    .panel.sent
    {
      flex-direction: row;
      align-items: center;
      gap: var(--space-xs);
      width: auto;
      font-size: var(--text-sm);
      color: var(--color-success, #16a34a);
      white-space: nowrap;
    }

    .panel-header
    {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--color-text);
    }

    .panel .icon-btn.small
    {
      width: 20px;
      height: 20px;
      color: var(--color-text-muted, #888);
      font-size: 12px;
    }

    .panel .icon-btn.small:hover
    {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
      color: var(--color-text);
    }

    .message
    {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      line-height: 1.5;
      color: var(--color-text);
      background: var(--color-bg, #fff);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      padding: 6px 8px;
      outline: none;
    }

    .message:focus { border-color: var(--color-primary); }

    .error
    {
      font-size: var(--text-xs);
      color: var(--color-alert, #f10827);
    }

    .panel-actions
    {
      display: flex;
      justify-content: flex-end;
    }

    .btn-send
    {
      padding: 5px 14px;
      border: none;
      border-radius: var(--radius-sm, 4px);
      background: var(--color-alert, #f10827);
      color: var(--color-white, #fff);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 600;
      cursor: pointer;
    }

    .btn-send:hover:not(:disabled)
    {
      background: color-mix(in srgb, var(--color-black, #000) 12%, var(--color-alert, #f10827));
    }

    .btn-send:disabled { opacity: 0.45; cursor: not-allowed; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-attribution': ConfiguratorAttribution;
  }
}
