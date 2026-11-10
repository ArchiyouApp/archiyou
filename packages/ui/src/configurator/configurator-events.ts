/**
 * <configurator-events> — what happened around this configurator, for its author: orders,
 * changes sent back to a delivery, and the fulfillments handed over (emailed, unlocked,
 * downloaded, failed). Opened from the "Events" button in <configurator-viewer-actions>,
 * which only the signed-in author sees; the server answers nobody else
 * (GET /scripts/configurators/:versionId/events, services/configurator-events).
 *
 * A row of counts over the last 30 days, chips to filter, this version or all of them, and
 * the events newest first, a page at a time.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import type { ConfiguratorEvent, ConfiguratorEventCounts, ConfiguratorEventFilter } from '@archiyou/types';

import { listConfiguratorEvents } from '@archiyou/editor/src/services/configurator-events';

const ICONS: Record<ConfiguratorEvent['type'], string> = {
  'order.received':         'shopping-cart',
  'adjust.requested':       'pencil-ruler',
  'fulfillment.emailed':    'mail',
  'fulfillment.unlocked':   'lock-open',
  'fulfillment.downloaded': 'download',
  'fulfillment.failed':     'triangle-alert',
};

const PAGE = 30;

@localized()
@customElement('configurator-events')
export class ConfiguratorEvents extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="panel">
        <div class="panel-header">
          <span>${msg('Events')}</span>
          <button class="close-btn" aria-label=${msg('Close')} @click=${this._close}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        ${this._counts ? this._renderCounts(this._counts) : nothing}

        <div class="filters">
          <div class="chips" role="group" aria-label=${msg('Show')}>
            ${this._filters().map(([value, label]) => html`
              <button class="chip ${this._filter === value ? 'active' : ''}" aria-pressed=${this._filter === value}
                @click=${() => this._setFilter(value)}>${label}</button>`)}
          </div>
          <label class="scope">
            <input type="checkbox" .checked=${this._scope === 'file'}
              @change=${(e: Event) => this._setScope((e.target as HTMLInputElement).checked ? 'file' : 'version')}>
            ${msg('All versions')}
          </label>
        </div>

        <div class="list">
          ${this._events.map(e => this._renderEvent(e))}
          ${this._loading ? html`<div class="state"><wa-spinner></wa-spinner></div>` : nothing}
          ${!this._loading && !this._error && this._events.length === 0
            ? html`<p class="state">${msg('Nothing yet.')}</p>`
            : nothing}
          ${this._error ? html`<p class="state error">${this._error}</p>` : nothing}
        </div>

        ${this._next && !this._loading
          ? html`<button class="more" @click=${() => this._load(false)}>${msg('Load more')}</button>`
          : nothing}
      </div>
    `;
  }

  private _renderCounts(counts: ConfiguratorEventCounts)
  {
    const cells: Array<[number, string]> = [
      [counts.orders, msg('orders')],
      [counts.emailed, msg('emailed')],
      [counts.unlocked, msg('unlocked')],
      [counts.downloads, msg('downloads')],
      [counts.failed, msg('failed')],
    ];
    return html`
      <div class="counts" title=${msg('The last 30 days')}>
        ${cells.map(([n, label]) => html`<div class="count"><span class="count-n">${n}</span><span class="count-label">${label}</span></div>`)}
      </div>
    `;
  }

  private _renderEvent(event: ConfiguratorEvent)
  {
    return html`
      <div class="event ${event.type === 'fulfillment.failed' ? 'failed' : ''}">
        <wa-icon class="event-icon" library="lucide" name=${ICONS[event.type] ?? 'circle'}></wa-icon>
        <div class="event-text">
          <span>${this._sentence(event)}</span>
          <span class="event-meta">
            ${event.version ? html`<span class="version">${event.version}</span>` : nothing}
            <time datetime=${event.created} title=${new Date(event.created).toLocaleString()}>${this._ago(event.created)}</time>
          </span>
        </div>
      </div>
    `;
  }

  // ── 2. State & Properties ──

  /** The configurator version on screen. */
  @property({ type: String }) versionId = '';

  @state() private _events: ConfiguratorEvent[] = [];
  @state() private _counts: ConfiguratorEventCounts | null = null;
  @state() private _next: string | null = null;
  @state() private _filter: ConfiguratorEventFilter = 'all';
  @state() private _scope: 'version' | 'file' = 'version';
  @state() private _loading = false;
  @state() private _error = '';

  /** Answers that arrive after the filter changed are dropped. */
  private _query = 0;

  // ── 3. Lifecycle ──
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('versionId') && this.versionId) void this._load(true);
  }

  // ── 4. Behaviour & Methods ──

  private _filters(): Array<[ConfiguratorEventFilter, string]>
  {
    return [
      ['all', msg('All')],
      ['orders', msg('Orders')],
      ['fulfillments', msg('Fulfillments')],
      ['failed', msg('Failed')],
    ];
  }

  private _setFilter(filter: ConfiguratorEventFilter)
  {
    if (filter === this._filter) return;
    this._filter = filter;
    void this._load(true);
  }

  private _setScope(scope: 'version' | 'file')
  {
    this._scope = scope;
    void this._load(true);
  }

  /** The first page again (`fresh`), or the next one. */
  private async _load(fresh: boolean)
  {
    if (!this.versionId) return;
    const query = ++this._query;
    this._loading = true;
    this._error = '';
    if (fresh)
    {
      this._events = [];
      this._next = null;
    }
    try
    {
      const list = await listConfiguratorEvents(this.versionId, {
        scope: this._scope,
        filter: this._filter,
        before: fresh ? null : this._next,
        limit: PAGE,
      });
      if (query !== this._query) return;
      this._events = fresh ? list.events : [...this._events, ...list.events];
      this._counts = list.counts;
      this._next = list.next;
    }
    catch (err)
    {
      if (query !== this._query) return;
      console.warn('Configurator: loading the events failed:', err);
      this._error = msg('The events could not be loaded.');
    }
    finally
    {
      if (query === this._query) this._loading = false;
    }
  }

  /** One line about what happened. */
  private _sentence(event: ConfiguratorEvent)
  {
    const what = html`<strong>${event.fulfillment ?? msg('a fulfillment')}</strong>`;
    const who = event.who ?? '';
    const project = event.project
      ? html` · <a href=${`/projects/${encodeURIComponent(event.project.id)}`} target="_blank" rel="noopener">${event.project.label}</a>`
      : nothing;
    switch (event.type)
    {
      case 'order.received':
        return html`${msg('Order')} ${what}${who ? html` ${msg(str`from ${who}`)}` : nothing}${project}`;
      case 'adjust.requested':
        return html`${msg('Changes sent back')}${who ? html` ${msg(str`by ${who}`)}` : nothing}${project}`;
      case 'fulfillment.emailed':
        return html`${msg('Emailed')} ${what} ${msg(str`to ${who}`)}`;
      case 'fulfillment.unlocked':
        return html`${msg('Unlocked')} ${what}${who ? html` ${msg(str`for ${who}`)}` : html` ${msg('with the access code')}`}`;
      case 'fulfillment.downloaded':
        return html`${msg('Downloaded')} ${what}`;
      case 'fulfillment.failed':
        return html`${msg('Failed:')} ${what}${who ? html` ${msg(str`to ${who}`)}` : nothing}${event.reason ? html` (${this._reason(event.reason)})` : nothing}`;
    }
  }

  /** Why an emailed fulfillment did not go out (fulfillment.failed). */
  private _reason(reason: string): string
  {
    return ({
      'not a client': msg('not one of your clients'),
      'no server run': msg('this version may not run on the server yet'),
      'too large': msg('too large to email'),
      'failed': msg('making the files failed'),
    } as Record<string, string>)[reason] ?? reason;
  }

  /** "3 min ago", "yesterday", or the date. */
  private _ago(iso: string): string
  {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    const steps: Array<[number, Intl.RelativeTimeFormatUnit]> = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day']];
    const found = steps.reduce<{ value: number, unit: Intl.RelativeTimeFormatUnit | null }>((acc, [size, unit]) =>
    {
      if (acc.unit) return acc;
      return Math.abs(acc.value) < size ? { value: acc.value, unit } : { value: acc.value / size, unit: null };
    }, { value: seconds, unit: null });
    return found.unit
      ? rtf.format(Math.round(found.value), found.unit)
      : new Date(iso).toLocaleDateString();
  }

  private _close()
  {
    this.dispatchEvent(new CustomEvent('configurator-events-close', { bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: block;
      font-family: var(--font-sans);
    }

    .panel
    {
      width: min(520px, 100cqw - 16px);
      max-height: min(70dvh, 640px);
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
      padding: var(--space-lg);
      box-sizing: border-box;
      border-radius: var(--radius-md, 8px);
      border: 1px solid var(--color-border);
      background: var(--color-bg-elevated, #fff);
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
      color: var(--color-text);
    }

    .panel-header
    {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: var(--text-base);
      font-weight: 600;
    }

    .close-btn
    {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: var(--radius-sm, 4px);
      background: transparent;
      color: var(--color-text-muted, #888);
      font-size: 13px;
      cursor: pointer;
    }

    .close-btn:hover
    {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
      color: var(--color-text);
    }

    .counts
    {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: var(--space-xs);
    }

    .count
    {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--space-sm) var(--space-xs);
      border-radius: var(--radius-sm, 4px);
      background: color-mix(in srgb, var(--color-border) 25%, transparent);
    }

    .count-n
    {
      font-size: var(--text-lg);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .count-label
    {
      font-size: var(--text-xs);
      color: var(--color-text-muted, #888);
    }

    .filters
    {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-sm);
    }

    .chips
    {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }

    .chip
    {
      padding: 3px 10px;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      background: transparent;
      color: var(--color-text);
      font-family: inherit;
      font-size: var(--text-xs);
      cursor: pointer;
    }

    .chip.active
    {
      border-color: var(--color-primary);
      background: color-mix(in srgb, var(--color-primary) 12%, transparent);
      color: var(--color-primary);
    }

    .scope
    {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--color-text-muted, #888);
      cursor: pointer;
    }

    .list
    {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--color-divider, #e0e0e0);
    }

    .event
    {
      display: flex;
      align-items: flex-start;
      gap: var(--space-sm);
      padding: var(--space-sm) 0;
      border-bottom: 1px solid var(--color-divider, #e0e0e0);
      font-size: var(--text-sm);
    }

    .event-icon
    {
      flex-shrink: 0;
      margin-top: 2px;
      color: var(--color-text-muted, #888);
    }

    .event.failed .event-icon { color: var(--color-danger, #dc2626); }

    .event-text
    {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow-wrap: anywhere;
    }

    .event-text a { color: var(--color-primary); }

    .event-meta
    {
      display: flex;
      gap: var(--space-sm);
      font-size: var(--text-xs);
      color: var(--color-text-muted, #888);
    }

    .version
    {
      padding: 0 6px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
    }

    .state
    {
      margin: 0;
      padding: var(--space-md) 0;
      text-align: center;
      font-size: var(--text-xs);
      color: var(--color-text-muted, #888);
    }

    .state.error { color: var(--color-danger, #dc2626); }

    .more
    {
      align-self: center;
      padding: 4px 14px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: transparent;
      color: var(--color-text);
      font-family: inherit;
      font-size: var(--text-xs);
      cursor: pointer;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-events': ConfiguratorEvents;
  }
}
