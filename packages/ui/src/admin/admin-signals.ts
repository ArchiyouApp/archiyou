/**
 * <admin-signals> — what went wrong, for the operator: every signal the server stored
 * (apps/server/src/signals), one row per problem over a range of days, with how often it
 * happened, to whom, and when first and last.
 *
 * Search, the range, severity, source and type filters and the sort run server-side
 * (GET /admin/signals). The counts per severity above the table are clickable filters.
 * Opening a row shows the latest occurrence: the line, the configuration as a link that makes
 * it again, the page, the app version and the facts it came with.
 *
 * The filters start from the address (?range=today&type=api.error), so the links in the alert
 * and report emails open the table already filtered. Read-only: nothing here changes a signal.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import {
  SIGNAL_RANGES, SIGNAL_SEVERITIES, SIGNAL_SORTS, SIGNAL_SOURCES, SIGNAL_TYPES,
  type AdminSignal, type SignalRange, type SignalSeverity, type SignalSort, type SignalSource, type SignalType,
} from '@archiyou/types';

import { fetchAdminSignals } from '@archiyou/editor/src/services/admin';

import { configuratorUrl } from '../editor/publish-constants.js';

const PAGE_SIZE = 50;

/** Format an ISO date string as "DD/MM/YYYY HH:MM" (locale-aware). Mirrors <admin-feedback>. */
function fmtDate(iso: string | null | undefined): string
{
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** 'author/name:version' → its parts, or null for anything else. */
function parseScriptRef(ref: string | null): { author: string, name: string, version: string } | null
{
  const match = ref?.match(/^([^/]+)\/(.+):([^:]+)$/);
  return match ? { author: match[1], name: match[2], version: match[3] } : null;
}

const SEVERITY_VARIANT: Record<SignalSeverity, 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warn: 'warning',
  error: 'danger',
  critical: 'danger',
};

@customElement('admin-signals')
export class AdminSignals extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <header class="bar">
        <div class="filters">
          <wa-input
            class="search"
            size="small"
            placeholder=${msg('Search messages, scripts, users')}
            .value=${this._q}
            @input=${this._onSearch}
          >
            <wa-icon slot="start" library="lucide" name="search"></wa-icon>
          </wa-input>

          <!-- "change", not "wa-change", and ?selected on the option: see <admin-configurators>. -->
          <wa-select size="small" class="select with-icon" @change=${(e: Event) => this._refilter(() => { this._range = this._valueOf(e) as SignalRange; })}>
            <wa-icon slot="start" library="lucide" name="calendar"></wa-icon>
            ${SIGNAL_RANGES.map(r => html`<wa-option value=${r} ?selected=${this._range === r}>${this._rangeLabel(r)}</wa-option>`)}
          </wa-select>

          <wa-select size="small" class="select" @change=${(e: Event) => this._refilter(() => { this._severity = this._valueOf(e) as SignalSeverity | ''; })}>
            <wa-option value="" ?selected=${this._severity === ''}>${msg('Any severity')}</wa-option>
            ${SIGNAL_SEVERITIES.map(s => html`<wa-option value=${s} ?selected=${this._severity === s}>${s}</wa-option>`)}
          </wa-select>

          <wa-select size="small" class="select" @change=${(e: Event) => this._refilter(() => { this._source = this._valueOf(e) as SignalSource | ''; })}>
            <wa-option value="" ?selected=${this._source === ''}>${msg('Any source')}</wa-option>
            ${SIGNAL_SOURCES.map(s => html`<wa-option value=${s} ?selected=${this._source === s}>${s}</wa-option>`)}
          </wa-select>

          <wa-select size="small" class="select wide" @change=${(e: Event) => this._refilter(() => { this._type = this._valueOf(e) as SignalType | ''; })}>
            <wa-option value="" ?selected=${this._type === ''}>${msg('Any type')}</wa-option>
            ${this._typeOptions().map(t => html`<wa-option value=${t} ?selected=${this._type === t}>${t}</wa-option>`)}
          </wa-select>

          <wa-select size="small" class="select sort" @change=${(e: Event) => this._refilter(() => { this._sort = this._valueOf(e) as SignalSort; })}>
            <wa-icon slot="start" library="lucide" name="arrow-down-up"></wa-icon>
            ${SIGNAL_SORTS.map(s => html`<wa-option value=${s} ?selected=${this._sort === s}>${this._sortLabel(s)}</wa-option>`)}
          </wa-select>
        </div>

        <span class="count">
          ${this._loading ? nothing : msg(str`${this._total} problems`)}
        </span>
      </header>

      ${this._renderCounts()}

      ${this._error ? html`<div class="load-error" role="alert">${this._error}</div>` : nothing}

      ${this._loading
        ? html`<div class="center"><wa-spinner></wa-spinner></div>`
        : this._items.length === 0
          ? html`<div class="center empty">${msg('Nothing went wrong that matches this filter.')}</div>`
          : this._renderTable()}

      ${this._renderPager()}
    `;
  }

  /** Occurrences per severity in the range; a click filters on it, a second click lets go. */
  private _renderCounts()
  {
    return html`
      <div class="counts" role="group" aria-label=${msg('Occurrences per severity')}>
        ${SIGNAL_SEVERITIES.map(s => html`
          <button
            class="count-chip ${s}"
            aria-pressed=${this._severity === s ? 'true' : 'false'}
            @click=${() => this._refilter(() => { this._severity = this._severity === s ? '' : s; })}
          >
            <span class="count-n">${this._counts[s] ?? 0}</span>
            <span class="count-label">${s}</span>
          </button>`)}
      </div>
    `;
  }

  private _renderTable()
  {
    return html`
      <table class="table">
        <thead>
          <tr>
            <th class="col-toggle"><span class="visually-hidden">${msg('Details')}</span></th>
            <th>${msg('Severity')}</th>
            <th>${msg('Type')}</th>
            <th>${msg('Script')}</th>
            <th>${msg('Message')}</th>
            <th class="num">${msg('Count')}</th>
            <th>${msg('Users')}</th>
            <th>${msg('Last seen')}</th>
          </tr>
        </thead>
        <tbody>
          ${this._items.map(item => this._renderRow(item))}
        </tbody>
      </table>
    `;
  }

  private _renderRow(item: AdminSignal)
  {
    const open = this._open === item.fingerprint;
    return html`
      <tr class="row" ?data-open=${open} @click=${() => this._toggle(item)}>
        <td class="col-toggle">
          <button
            class="toggle"
            aria-expanded=${open ? 'true' : 'false'}
            aria-label=${open ? msg('Hide details') : msg('Show details')}
            @click=${(e: Event) => { e.stopPropagation(); this._toggle(item); }}
          >
            <wa-icon library="lucide" name=${open ? 'chevron-down' : 'chevron-right'}></wa-icon>
          </button>
        </td>
        <td><wa-badge variant=${SEVERITY_VARIANT[item.severity]} appearance=${item.severity === 'critical' ? 'accent' : 'filled-outlined'}>${item.severity}</wa-badge></td>
        <td class="type">
          ${item.type}
          ${item.isNew ? html`<wa-badge class="new" variant="brand" pill>${msg('new')}</wa-badge>` : nothing}
        </td>
        <td class="script">${item.script ?? '—'}</td>
        <td class="message" title=${item.message ?? ''}>${item.message ?? '—'}</td>
        <td class="num">${item.count}</td>
        <td class="users">${item.users.length ? this._usersText(item.users) : '—'}</td>
        <td class="when">${fmtDate(item.lastSeen)}</td>
      </tr>
      ${open ? html`<tr class="details-row"><td colspan="8">${this._renderDetails(item)}</td></tr>` : nothing}
    `;
  }

  private _renderDetails(item: AdminSignal)
  {
    const { sample } = item;
    const ref = parseScriptRef(item.script);
    const again = ref ? `${configuratorUrl(ref.author, ref.name, ref.version)}${sample.query ? `?${sample.query}` : ''}` : null;
    const facts: Array<[string, unknown]> = [
      [msg('Message'), item.message],
      [msg('Line'), sample.line],
      [msg('Configuration'), sample.query],
      [msg('Page'), sample.url],
      [msg('App version'), sample.appVersion],
      [msg('Script version id'), sample.scriptVersionId],
      ...Object.entries(sample.data ?? {}),
      [msg('Users'), item.users.join(', ')],
      [msg('First seen'), fmtDate(item.firstSeen)],
      [msg('Last seen'), fmtDate(item.lastSeen)],
      [msg('Fingerprint'), item.fingerprint],
    ];
    return html`
      <div class="details">
        <dl class="facts">
          ${facts.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => html`
            <dt>${label}</dt>
            <dd>${String(value)}</dd>`)}
        </dl>
        ${again ? html`
          <wa-button size="small" appearance="outlined" href=${again} target="_blank" rel="noopener">
            <wa-icon slot="start" library="lucide" name="external-link"></wa-icon>
            ${sample.query ? msg('Open this configuration') : msg('Open the configurator')}
          </wa-button>` : nothing}
      </div>
    `;
  }

  private _renderPager()
  {
    const pages = Math.ceil(this._total / PAGE_SIZE);
    if (pages <= 1) return nothing;
    const page = Math.floor(this._offset / PAGE_SIZE) + 1;
    return html`
      <footer class="pager">
        <wa-button size="small" appearance="plain" ?disabled=${this._offset === 0}
          @click=${() => this._goto(this._offset - PAGE_SIZE)}>
          <wa-icon slot="start" library="lucide" name="chevron-left"></wa-icon>
          ${msg('Previous')}
        </wa-button>
        <span class="page">${msg(str`Page ${page} of ${pages}`)}</span>
        <wa-button size="small" appearance="plain" ?disabled=${page >= pages}
          @click=${() => this._goto(this._offset + PAGE_SIZE)}>
          ${msg('Next')}
          <wa-icon slot="end" library="lucide" name="chevron-right"></wa-icon>
        </wa-button>
      </footer>
    `;
  }

  // ── 2. State, Properties & Signals ──
  @state() private _items: AdminSignal[] = [];
  @state() private _total = 0;
  @state() private _counts: Partial<Record<SignalSeverity, number>> = {};
  @state() private _types: SignalType[] = [];
  @state() private _offset = 0;
  @state() private _q = '';
  @state() private _range: SignalRange = '7d';
  @state() private _severity: SignalSeverity | '' = '';
  @state() private _source: SignalSource | '' = '';
  @state() private _type: SignalType | '' = '';
  @state() private _sort: SignalSort = 'last';
  @state() private _loading = true;
  @state() private _error = '';
  /** Fingerprint of the row whose details are open. */
  @state() private _open: string | null = null;

  private _searchTimer: number | null = null;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    this._readAddress();
    void this._load();
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
  }

  // ── 4. Behaviour & Methods ──
  /** Start from the filters in the address (links in the alert and report emails). */
  private _readAddress()
  {
    const params = new URLSearchParams(window.location.search);
    const pick = <T extends string>(name: string, allowed: readonly T[]): T | undefined =>
    {
      const value = params.get(name);
      return value && (allowed as readonly string[]).includes(value) ? value as T : undefined;
    };
    this._range = pick('range', SIGNAL_RANGES) ?? this._range;
    this._severity = pick('severity', SIGNAL_SEVERITIES) ?? '';
    this._source = pick('source', SIGNAL_SOURCES) ?? '';
    this._type = pick('type', SIGNAL_TYPES) ?? '';
    this._sort = pick('sort', SIGNAL_SORTS) ?? this._sort;
    this._q = params.get('q') ?? '';
  }

  private async _load()
  {
    this._loading = true;
    this._error = '';
    try
    {
      const list = await fetchAdminSignals({
        range: this._range,
        q: this._q || undefined,
        severity: this._severity || undefined,
        source: this._source || undefined,
        type: this._type || undefined,
        sort: this._sort,
        limit: PAGE_SIZE,
        offset: this._offset,
      });
      this._items = list.items;
      this._total = list.total;
      this._counts = list.counts;
      this._types = list.types;
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? msg('Could not load the signals.');
      this._items = [];
      this._total = 0;
    }
    finally
    {
      this._loading = false;
    }
  }

  /** Change a filter and load the first page again. */
  private _refilter(change: () => void)
  {
    change();
    this._offset = 0;
    this._open = null;
    void this._load();
  }

  private _valueOf(e: Event): string
  {
    return (e.target as HTMLInputElement).value;
  }

  private _onSearch(e: Event)
  {
    this._q = this._valueOf(e);
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
    this._searchTimer = window.setTimeout(() =>
    {
      this._searchTimer = null;
      this._offset = 0;
      void this._load();
    }, 300);
  }

  private _goto(offset: number)
  {
    this._offset = Math.max(0, offset);
    this._open = null;
    void this._load();
  }

  private _toggle(item: AdminSignal)
  {
    this._open = this._open === item.fingerprint ? null : item.fingerprint;
  }

  /** The types in the range, plus the one filtered on (it may not occur in this range). */
  private _typeOptions(): SignalType[]
  {
    return this._type && !this._types.includes(this._type) ? [...this._types, this._type] : this._types;
  }

  private _usersText(users: string[]): string
  {
    return users.length <= 3 ? users.join(', ') : msg(str`${users.slice(0, 2).join(', ')} and ${users.length - 2} more`);
  }

  private _rangeLabel(range: SignalRange): string
  {
    return {
      today: msg('Today'),
      '7d': msg('Last 7 days'),
      '30d': msg('Last 30 days'),
      '90d': msg('Last 90 days'),
    }[range];
  }

  private _sortLabel(sort: SignalSort): string
  {
    return {
      last: msg('Last seen first'),
      count: msg('Most frequent first'),
      first: msg('Newest problems first'),
    }[sort];
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      gap: var(--space-lg);
      box-sizing: border-box;
      padding: var(--space-lg);
      font-family: var(--font-sans);
      color: var(--color-text);
    }

    *,
    *::before,
    *::after
    {
      box-sizing: inherit;
    }

    .bar
    {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-lg);
      flex-wrap: wrap;
    }

    .filters
    {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      flex-wrap: wrap;
    }

    .search { width: 280px; }
    .select { width: 150px; }
    .select.wide { width: 190px; }
    .select.with-icon { width: 180px; }
    .select.sort { width: 230px; }

    .count
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .counts
    {
      display: flex;
      gap: var(--space-sm);
      flex-wrap: wrap;
    }

    .count-chip
    {
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
      padding: var(--space-xs) var(--space-md);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg-elevated);
      font: inherit;
      color: var(--color-text);
      cursor: pointer;
    }

    .count-chip:hover { border-color: var(--color-primary); }

    .count-chip[aria-pressed='true']
    {
      border-color: var(--color-primary);
      background: var(--color-primary-subtle);
    }

    .count-n { font-weight: 600; }
    .count-label { font-size: var(--text-sm); color: var(--color-text-muted); }
    .count-chip.warn .count-n { color: var(--color-warning); }
    .count-chip.error .count-n,
    .count-chip.critical .count-n { color: var(--color-danger); }

    .table
    {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    th
    {
      text-align: left;
      font-weight: 600;
      color: var(--color-text-muted);
      padding: var(--space-sm) var(--space-md);
      border-bottom: 1px solid var(--color-border);
      background: var(--color-surface-subtle);
      white-space: nowrap;
    }

    td
    {
      padding: var(--space-sm) var(--space-md);
      border-bottom: 1px solid var(--color-divider);
      vertical-align: top;
    }

    .row { cursor: pointer; }
    .row:hover,
    .row[data-open] { background: var(--color-surface-subtle); }

    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .col-toggle { width: 2rem; padding-right: 0; }

    .toggle
    {
      display: flex;
      padding: 0;
      border: none;
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;
    }

    .type { white-space: nowrap; }
    .new { margin-left: var(--space-xs); }

    .script,
    .users { word-break: break-word; }

    .message
    {
      max-width: 28rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .when { white-space: nowrap; color: var(--color-text-muted); }

    .details-row td { background: var(--color-surface-subtle); }

    .details
    {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-md);
      padding: var(--space-sm) 0 var(--space-sm) 2rem;
    }

    .facts
    {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: var(--space-xs) var(--space-lg);
      margin: 0;
    }

    .facts dt { color: var(--color-text-muted); }
    .facts dd { margin: 0; white-space: pre-wrap; word-break: break-word; }

    .center
    {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-lg);
      min-height: 120px;
    }

    .empty
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .load-error
    {
      padding: var(--space-sm) var(--space-lg);
      border: 1px solid var(--color-warning);
      border-radius: var(--radius-md);
      font-size: var(--text-sm);
      color: var(--color-warning);
    }

    .pager
    {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-lg);
    }

    .page
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .visually-hidden
    {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    @media (max-width: 900px)
    {
      .search, .select, .select.wide, .select.with-icon, .select.sort { width: 100%; }
      .filters { width: 100%; }
      .message { max-width: 12rem; }
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'admin-signals': AdminSignals;
  }
}
