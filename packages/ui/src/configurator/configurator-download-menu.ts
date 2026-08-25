/**
 * configurator-download-menu — the list behind the configurator's Download button.
 *
 * One row per fulfillment the author published (see ScriptPublishedFulfillmentSchema):
 * its name, the file formats it delivers and, when it is not a free download, its
 * price. Clicking a row runs the script for that fulfillment's output paths with the
 * end-user's current parameter values and saves the result — a single file directly,
 * several as a .zip (see services/fulfillment.ts).
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

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import { editorScript } from '@archiyou/editor/src/state/workspace';
import { translate } from '@archiyou/editor/src/state/locale';
import {
  downloadFulfillment, fulfillmentCategories, fulfillmentFormats, isFreeDownload,
} from '@archiyou/editor/src/services/fulfillment';

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

/** Accent colour per category, the way a file manager tints documents and sheets.
 *  The model and mixed bundles stay neutral: they are the main event, and colouring
 *  every row would make the accent mean nothing. */
const CATEGORY_TINTS: Record<string, string> = {
  docs:    'docs',
  tables:  'tables',
  metrics: 'metrics',
};

@customElement('configurator-download-menu')
export class ConfiguratorDownloadMenu extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const { list, defaults } = this.fulfillments();

    return html`
      <div class="header">Download options</div>

      ${list.length === 0
        ? html`<p class="empty">
            ${this.preview
              ? 'No downloads yet — add fulfillments when you publish this configurator.'
              : 'This configurator offers no downloads.'}
          </p>`
        : html`<div class="list">
            ${list.map((f, i) => this._renderRow(f, i))}
          </div>`}

      ${defaults
        ? html`<p class="note">
            Default exports — publish this script to choose what visitors can download.
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
    const name     = t(fulfillmentNameKey(index), fulfillment.name || 'Download');
    const about    = t(fulfillmentDescriptionKey(index), fulfillment.description ?? '');
    const formats    = fulfillmentFormats(fulfillment);
    const categories = fulfillmentCategories(fulfillment);
    const free       = isFreeDownload(fulfillment);
    const busy     = this._busy === index;
    const done     = this._done === index;

    // Paid/email deliveries are shown (the author is advertising them) but cannot be
    // handed over here: there is no payment or address flow behind them yet.
    const blocked  = !free;

    return html`
      <button
        class="row ${blocked ? 'blocked' : ''}"
        title=${this._rowTitle(about, formats, blocked)}
        aria-disabled=${blocked ? 'true' : 'false'}
        ?disabled=${this._busy !== null}
        @click=${() => this._download(fulfillment, index)}
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
        </span>

        ${busy
          ? html`<wa-spinner class="row-state"></wa-spinner>`
          : done
            ? html`<wa-icon class="row-state done" library="lucide" name="check"></wa-icon>`
            : this._renderTag(fulfillment)}
      </button>
    `;
  }

  /** Right-hand tag: the price for a paid fulfillment, "email" for one delivered by
   *  mail. Free downloads carry nothing — the row itself is the offer. */
  private _renderTag(fulfillment: ScriptPublishedFulfillmentData)
  {
    const price = fulfillment.price ?? 0;
    if (price > 0) return html`<span class="row-tag">${this._formatPrice(price)}</span>`;
    if (fulfillment.delivery === 'email') return html`<span class="row-tag">email</span>`;
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
  }

  /** What this configurator offers, and whether those are the author's own choices.
   *  A published script always answers for itself; in the preview a never-published
   *  script falls back to the same defaults the publish menu prefills, so the preview
   *  shows what publishing would give. */
  fulfillments(): { list: ScriptPublishedFulfillmentData[], defaults: boolean }
  {
    const published = editorScript.get()?.published?.fulfillments;
    if (published?.length) return { list: published, defaults: false };
    if (!this.preview) return { list: [], defaults: false };
    return { list: DEFAULT_FULFILLMENTS, defaults: true };
  }

  private async _download(fulfillment: ScriptPublishedFulfillmentData, index: number)
  {
    if (this._busy !== null || !isFreeDownload(fulfillment)) return;

    this._busy = index;
    this._done = null;
    this._error = '';

    try
    {
      await downloadFulfillment(fulfillment);
      this._done = index;
      if (this._doneTimer !== null) clearTimeout(this._doneTimer);
      this._doneTimer = setTimeout(() => { this._done = null; }, 2500);
    }
    catch (err)
    {
      console.error('Configurator: download failed:', err);
      this._error = (err as Error)?.message ?? 'The download failed.';
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

  private _rowTitle(about: string, formats: string[], blocked: boolean): string
  {
    return [
      about,
      formats.length ? formats.map(f => `.${f}`).join(', ') : '',
      blocked ? 'Not available yet' : '',
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
      width: 26rem;
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
      max-height: 50vh;
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

    /* A run in progress greys every row. A paid/email row is greyed permanently but
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
