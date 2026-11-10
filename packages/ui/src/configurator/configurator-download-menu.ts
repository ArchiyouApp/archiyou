/**
 * configurator-download-menu — the list behind the configurator's Download button.
 *
 * One row per fulfillment the author published (see ScriptPublishedFulfillmentSchema):
 * its name, the file formats it delivers and, when it is not a free download, its
 * price. Clicking a row runs the script for that fulfillment's output paths with the
 * end-user's current parameter values and saves the result — a single file directly,
 * several as a .zip (see services/fulfillment.ts).
 *
 * Who can get a row is its `access` (core's FULFILLMENT_ACCESS):
 *   • anyone                 — clicked, downloaded (and reported, for the author's events)
 *   • email, clients         — an address field opens under the row; the server makes the
 *     files and emails them (services/fulfillment-access)
 *   • signed-in, users       — downloaded after the server said yes; signed out, the row
 *     is a way to sign in
 *   • code                   — a code field opens under the row, then the same
 * In the editor's preview the author gets every row directly, except the emailed ones.
 *
 * The same component serves both places a configurator appears:
 *   • published (/configurators/…)          — the script's own `published.fulfillments`
 *   • the editor's Configurator Preview     — those too, or, for a script that has
 *     never been published, the defaults the publish menu would prefill, so an author
 *     can try the downloads out before deciding what to offer.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { localized, msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import { editorScript, userState } from '@archiyou/editor/src/state/workspace';
import { translate } from '@archiyou/editor/src/state/locale';
import { currentConfiguration, postToHost } from '@archiyou/editor/src/services/host-events';
import {
  accessOf, downloadFulfillment, fulfillmentCategories, fulfillmentFormats, isDownload, isEmailed,
} from '@archiyou/editor/src/services/fulfillment';
import { reportDownload, requestFulfillment } from '@archiyou/editor/src/services/fulfillment-access';

import { fulfillmentNameKey, fulfillmentDescriptionKey } from '@archiyou/core/src/i18n/keys';
import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';

import { DEFAULT_FULFILLMENTS } from '../editor/publish-constants.js';

/**
 * Lucide icon per output category — what the visitor is getting, not which file type
 * it happens to arrive in: the model itself, documents to read, data to work with,
 * numbers about the design. A fulfillment spanning more than one becomes a package,
 * which is also literally what it downloads as (a zip).
 */
const CATEGORY_ICONS: Record<string, string> = {
  model:   'box',
  docs:    'file-text',
  tables:  'table',
  metrics: 'gauge',
};

const MIXED_ICON = 'package';

/** How a row hands its fulfillment over to this visitor (see _how). */
type RowHow = 'download' | 'email' | 'code' | 'sign-in' | 'blocked';

/** Accent colour per category, the way a file manager tints documents and sheets.
 *  The model and mixed bundles stay neutral: they are the main event, and colouring
 *  every row would make the accent mean nothing. */
const CATEGORY_TINTS: Record<string, string> = {
  docs:    'docs',
  tables:  'tables',
  metrics: 'metrics',
};

@localized()
@customElement('configurator-download-menu')
export class ConfiguratorDownloadMenu extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const { list, defaults } = this.fulfillments();

    return html`
      <div class="header">${msg('Download options')}</div>

      ${!list.some(isDownload)
        ? html`<p class="empty">
            ${this.preview
              ? msg('No downloads yet — add fulfillments when you publish this configurator.')
              : msg('This configurator offers no downloads.')}
          </p>`
        : html`<div class="list">
            ${list.map((f, i) => (isDownload(f) ? this._renderRow(f, i) : nothing))}
          </div>`}

      ${defaults
        ? html`<p class="note">
            ${msg('Default exports — publish this script to choose what visitors can download.')}
          </p>`
        : nothing}

      ${this._error
        ? html`<p class="error"><wa-icon library="lucide" name="triangle-alert"></wa-icon>${this._error}</p>`
        : nothing}
    `;
  }

  private _renderRow(fulfillment: ScriptPublishedFulfillmentData, index: number)
  {
    const t        = translate.get();
    const name     = t(fulfillmentNameKey(index), fulfillment.name || msg('Download'));
    const about    = t(fulfillmentDescriptionKey(index), fulfillment.description ?? '');
    const formats    = fulfillmentFormats(fulfillment);
    const categories = fulfillmentCategories(fulfillment);
    const busy     = this._busy === index;
    const done     = this._done === index;
    const how      = this._how(fulfillment);
    const sentTo   = this._sent?.index === index ? this._sent.email : null;

    // Paid deliveries are shown (the author is advertising them) but cannot be handed
    // over here: there is no payment flow behind them yet.
    const blocked  = how === 'blocked';
    const note = sentTo
      ? msg(str`On its way to ${sentTo}`)
      : { blocked: msg('Not available yet'), 'sign-in': msg('Sign in to download'), email: msg('Sent to you by email'), code: msg('Needs an access code'), download: '' }[how];

    return html`
      <button
        class="row ${blocked ? 'blocked' : ''}"
        title=${this._rowTitle(about, formats, note)}
        aria-disabled=${blocked ? 'true' : 'false'}
        aria-expanded=${how === 'email' || how === 'code' ? String(this._open === index) : nothing}
        ?disabled=${this._busy !== null}
        @click=${() => this._activate(fulfillment, index)}
      >
        <wa-icon
          class="row-icon tint-${this._tintFor(categories)}"
          library="lucide"
          name=${this._iconFor(categories)}
        ></wa-icon>

        <span class="row-label">
          <span class="row-name">${name}</span>
          ${formats.length
            ? html`<span class="row-formats">(${this._formatList(formats)})</span>`
            : nothing}
          <!-- On the row, not only in its tooltip: touch screens have no hover. -->
          ${about || note
            ? html`<span class="row-about">${[about, note].filter(Boolean).join(' · ')}</span>`
            : nothing}
        </span>

        ${busy
          ? html`<wa-spinner class="row-state"></wa-spinner>`
          : done
            ? html`<wa-icon class="row-state done" library="lucide" name="check"></wa-icon>`
            : this._renderTag(fulfillment, how)}
      </button>
      ${this._open === index ? this._renderAsk(fulfillment, index, how) : nothing}
    `;
  }

  /** The field under an emailed or a code row: an address or the code, and its button. */
  private _renderAsk(fulfillment: ScriptPublishedFulfillmentData, index: number, how: RowHow)
  {
    const email = how === 'email';
    const author = editorScript.get()?.author ?? '';
    const value = email ? this._email : this._code;
    return html`
      <form class="ask" @submit=${(e: Event) => { e.preventDefault(); void this._submit(fulfillment, index); }}>
        <div class="ask-line">
          <input
            class="ask-input"
            type=${email ? 'email' : 'text'}
            autocomplete=${email ? 'email' : 'off'}
            required
            maxlength=${email ? 254 : 200}
            placeholder=${email ? msg('Your email address') : msg('Access code')}
            .value=${value}
            @input=${(e: Event) =>
            {
              const v = (e.target as HTMLInputElement).value;
              if (email) this._email = v; else this._code = v;
              this._error = '';
            }}
          >
          <button class="ask-send" type="submit" ?disabled=${this._busy !== null || !value.trim()}>
            ${email ? msg('Send') : msg('Unlock')}
          </button>
        </div>
        <!-- Honeypot: people never see it, bots fill it in -->
        <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"
          .value=${this._website} @input=${(e: Event) => { this._website = (e.target as HTMLInputElement).value; }}>
        ${email
          ? html`<p class="ask-hint">${author
            ? msg(str`The files are emailed to you. ${author} sees that you asked, with your address.`)
            : msg('The files are emailed to you. The author sees that you asked, with your address.')}</p>`
          : nothing}
      </form>
    `;
  }

  /** Right-hand tag: the price for a paid fulfillment, "email" for one delivered by
   *  mail. Free downloads carry nothing — the row itself is the offer. */
  private _renderTag(fulfillment: ScriptPublishedFulfillmentData, how: RowHow)
  {
    const price = fulfillment.price ?? 0;
    if (price > 0) return html`<span class="row-tag">${this._formatPrice(price)}</span>`;
    if (how === 'email') return html`<span class="row-tag">${msg('email', { desc: 'Tag on a download that is delivered by email' })}</span>`;
    if (how === 'sign-in' || how === 'code') return html`<wa-icon class="row-state" library="lucide" name="lock"></wa-icon>`;
    return nothing;
  }

  // ── 2. State & Properties ──

  /** True inside the editor's Configurator Preview. Only changes the wording of the
   *  empty state and whether the publish defaults stand in for a script that has
   *  never been published. */
  @property({ type: Boolean, reflect: true }) preview = false;

  /** Index of the fulfillment currently being generated, or null. Runs are
   *  serialized: they share one worker, and a second run would queue behind the
   *  first anyway. */
  @state() private _busy: number | null = null;
  @state() private _done: number | null = null;
  @state() private _error = '';
  /** The emailed or code row whose field is open, or null. */
  @state() private _open: number | null = null;
  @state() private _email = '';
  @state() private _code = '';
  @state() private _website = '';
  /** The last emailed row and where it went. */
  @state() private _sent: { index: number, email: string } | null = null;

  private _doneTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 3. Lifecycle ──
  override disconnectedCallback()
  {
    super.disconnectedCallback();
    if (this._doneTimer !== null) clearTimeout(this._doneTimer);
  }

  // ── 4. Behaviour & Methods ──

  /** Forget the last run's outcome. Called when the menu is closed, so reopening it
   *  does not still show an error about a configuration the user has since changed. */
  reset()
  {
    this._error = '';
    this._done = null;
    this._open = null;
  }

  /** What this configurator offers, and whether those are the author's own choices. The
   *  whole list, products included, so a row's index is its translation key's; the
   *  render skips products (they have their own "Order product" button).
   *  A published script always answers for itself; in the preview a never-published
   *  script falls back to the same defaults the publish menu prefills, so the preview
   *  shows what publishing would give. */
  fulfillments(): { list: ScriptPublishedFulfillmentData[], defaults: boolean }
  {
    const published = editorScript.get()?.published?.fulfillments;
    if (published?.some(isDownload)) return { list: published, defaults: false };
    if (!this.preview) return { list: [], defaults: false };
    return { list: DEFAULT_FULFILLMENTS, defaults: true };
  }

  /** How a row hands its fulfillment over to this visitor, here and now. */
  private _how(fulfillment: ScriptPublishedFulfillmentData): RowHow
  {
    if (fulfillment.delivery === 'pay' || (fulfillment.price ?? 0) > 0) return 'blocked';
    const access = accessOf(fulfillment);
    if (isEmailed(fulfillment)) return this.preview ? 'blocked' : 'email';
    // The author tries their own configurator out in the preview: no questions
    if (this.preview || access === 'anyone') return 'download';
    if (access === 'code') return 'code';
    return userState.get().anonymous ? 'sign-in' : 'download';
  }

  private _activate(fulfillment: ScriptPublishedFulfillmentData, index: number)
  {
    if (this._busy !== null) return;
    const how = this._how(fulfillment);
    this._error = '';
    if (how === 'blocked') return;
    if (how === 'email' || how === 'code')
    {
      this._open = this._open === index ? null : index;
      return;
    }
    if (how === 'sign-in') return this._signIn();
    void this._download(fulfillment, index);
  }

  /** Signed out: sign in and come back here. Inside another site's page the session does
   *  not reach this frame, so that happens on the configurator's own page, in a new tab. */
  private _signIn()
  {
    const url = new URL(window.location.href);
    url.searchParams.delete('embed');
    const login = `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
    if (window.self !== window.top) window.open(login, '_blank', 'noopener');
    else window.location.assign(login);
  }

  /** The emailed or code row's field was sent. */
  private async _submit(fulfillment: ScriptPublishedFulfillmentData, index: number)
  {
    const versionId = editorScript.get()?.id;
    if (this._busy !== null || !versionId) return;
    const how = this._how(fulfillment);
    if (how === 'code') return this._download(fulfillment, index, { code: this._code.trim() });

    this._busy = index;
    try
    {
      const email = this._email.trim();
      await requestFulfillment(versionId, fulfillment.name, { email, website: this._website });
      this._sent = { index, email };
      this._open = null;
    }
    catch (err)
    {
      this._error = (err as Error).message;
    }
    finally
    {
      this._busy = null;
    }
  }

  /** Make the files here and save them; a gated row asks the server first. */
  private async _download(fulfillment: ScriptPublishedFulfillmentData, index: number, ask: { code?: string } = {})
  {
    if (this._busy !== null) return;
    const versionId = editorScript.get()?.id;
    const gated = !this.preview && accessOf(fulfillment) !== 'anyone';

    this._busy = index;
    this._done = null;
    this._error = '';

    try
    {
      if (gated)
      {
        if (!versionId) throw new Error(msg('This configurator is not published.'));
        await requestFulfillment(versionId, fulfillment.name, ask);
        this._open = null;
      }
      await downloadFulfillment(fulfillment);
      if (!this.preview)
      {
        // Counted for the author (gated ones were counted when unlocked)
        if (!gated && versionId) reportDownload(versionId, fulfillment.name);
        // The page around an embedded configurator counts downloads (services/host-events).
        postToHost({ type: 'download', fulfillment: fulfillment.name, formats: fulfillmentFormats(fulfillment), ...currentConfiguration() });
      }
      this._done = index;
      if (this._doneTimer !== null) clearTimeout(this._doneTimer);
      this._doneTimer = setTimeout(() => { this._done = null; }, 2500);
    }
    catch (err)
    {
      console.error('Configurator: download failed:', err);
      this._error = (err as Error)?.message || msg('The download failed.');
    }
    finally
    {
      this._busy = null;
    }
  }

  /** "(.pdf, .svg)" — a long list ("everything the model can export") is cut to keep
   *  the row one line; the full list stays in the row's tooltip. */
  private _formatList(formats: string[]): string
  {
    const MAX = 4;
    const shown = formats.slice(0, MAX).map(f => `.${f}`).join(', ');
    return formats.length > MAX ? `${shown} +${formats.length - MAX}` : shown;
  }

  private _rowTitle(about: string, formats: string[], note: string): string
  {
    return [
      about,
      formats.length ? formats.map(f => `.${f}`).join(', ') : '',
      note,
    ].filter(Boolean).join('\n');
  }

  private _iconFor(categories: string[]): string
  {
    if (categories.length === 0) return 'file';
    if (categories.length > 1) return MIXED_ICON;
    return CATEGORY_ICONS[categories[0]] ?? 'file';
  }

  private _tintFor(categories: string[]): string
  {
    return (categories.length === 1 && CATEGORY_TINTS[categories[0]]) || 'neutral';
  }

  /** Prices are stored as a plain number; euros is what the publish menu prices in. */
  private _formatPrice(price: number): string
  {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    }).format(price);
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: block;
      /* Matches the popover's --max-width in configurator-metric-bar. */
      width: min(26rem, 100vw - 16px);
      max-width: 100%;
      font-family: var(--font-sans);
      background: var(--color-bg-elevated, #fff);
      color: var(--color-text);
    }

    .header
    {
      padding: var(--space-md) var(--space-lg);
      border-bottom: 1px solid var(--color-border);
      font-size: var(--text-sm);
      font-weight: 600;
    }

    .list
    {
      display: flex;
      flex-direction: column;
      max-height: 50dvh;
      overflow-y: auto;
    }

    .row
    {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      width: 100%;
      padding: var(--space-md) var(--space-lg);
      border: none;
      border-bottom: 1px solid var(--color-divider, #e0e0e0);
      background: transparent;
      color: inherit;
      font-family: inherit;
      font-size: var(--text-sm);
      text-align: left;
      cursor: pointer;
    }

    .row:last-child { border-bottom: none; }

    .row:hover:not(:disabled)
    {
      background: color-mix(in srgb, var(--color-border) 25%, transparent);
    }

    /* A run in progress greys every row. A paid row is greyed permanently but
       stays hoverable (aria-disabled, not disabled) so its tooltip still explains
       itself — it is telling the visitor what is on offer, not offering it. */
    .row:disabled { cursor: default; opacity: 0.5; }
    .row.blocked { color: var(--color-text-muted, #888); cursor: default; }
    .row.blocked:hover { background: transparent; }

    .row-icon
    {
      flex-shrink: 0;
      font-size: var(--text-lg);
      color: var(--color-text-muted, #888);
    }

    .row-icon.tint-docs    { color: var(--color-danger, #dc2626); }
    .row-icon.tint-tables  { color: var(--color-success, #16a34a); }
    .row-icon.tint-metrics { color: var(--color-warning, #f59e0b); }

    .row-label
    {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
    }

    .row-name { font-weight: 600; }

    .row-formats
    {
      color: var(--color-text-muted, #888);
      font-weight: 400;
      font-size: var(--text-xs);
    }

    .row-about
    {
      flex-basis: 100%;
      color: var(--color-text-gray, #6c7285);
      font-weight: 400;
      font-size: var(--text-xs);
    }

    .row-state
    {
      flex-shrink: 0;
      font-size: var(--text-sm);
    }

    .row-state.done { color: var(--color-success, #16a34a); }

    .row-tag
    {
      flex-shrink: 0;
      padding: 2px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-gray-light, #eee);
      color: var(--color-gray-dark, #666);
      font-size: var(--text-xs);
      line-height: 1.4;
      white-space: nowrap;
    }

    .ask
    {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding: 0 var(--space-lg) var(--space-md) calc(var(--space-lg) + var(--text-lg) + var(--space-md));
      border-bottom: 1px solid var(--color-divider, #e0e0e0);
    }

    .ask-line
    {
      display: flex;
      gap: var(--space-xs);
    }

    .ask-input
    {
      flex: 1;
      min-width: 0;
      padding: 6px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg, #fff);
      color: var(--color-text);
      font-family: inherit;
      font-size: var(--text-sm);
    }

    .ask-input:focus { outline: none; border-color: var(--color-primary); }

    .ask-send
    {
      flex-shrink: 0;
      padding: 6px 14px;
      border: none;
      border-radius: var(--radius-sm, 4px);
      background: var(--color-primary);
      color: var(--color-on-primary, #fff);
      font-family: inherit;
      font-size: var(--text-xs);
      font-weight: 600;
      cursor: pointer;
    }

    .ask-send:disabled { opacity: 0.5; cursor: default; }

    .ask-hint
    {
      margin: 0;
      font-size: var(--text-xs);
      line-height: 1.4;
      color: var(--color-text-muted, #888);
    }

    .hp { position: absolute; left: -10000px; width: 1px; height: 1px; opacity: 0; }

    .empty,
    .note,
    .error
    {
      margin: 0;
      padding: var(--space-md) var(--space-lg);
      font-size: var(--text-xs);
      line-height: 1.5;
      color: var(--color-text-muted, #888);
    }

    .note { border-top: 1px solid var(--color-divider, #e0e0e0); }

    .error
    {
      display: flex;
      align-items: flex-start;
      gap: var(--space-xs);
      border-top: 1px solid var(--color-divider, #e0e0e0);
      color: var(--color-danger, #dc2626);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-download-menu': ConfiguratorDownloadMenu;
  }
}
