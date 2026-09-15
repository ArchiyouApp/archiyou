/**
 * <admin-feedback> — the operator's inbox of visitor feedback, sent from the
 * "Give feedback" button on a configurator (<configurator-attribution>).
 *
 * One row per message, with the configurator it was about and a link back to the
 * exact page (params included) it was sent from. Search, a starred filter and a sort
 * run server-side; the row actions are star (a keep-this marker) and delete, which
 * asks first because it cannot be undone.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

import {
  fetchAdminFeedback,
  setFeedbackStarred,
  deleteFeedback,
  type AdminFeedback,
  type AdminFeedbackSort,
} from '@archiyou/editor/src/services/admin';

const PAGE_SIZE = 25;

/** Format an ISO date string as "DD/MM/YYYY HH:MM" (locale-aware). Mirrors <admin-configurators>. */
function fmtDate(iso: string | null | undefined): string
{
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

type StarredFilter = 'all' | 'true' | 'false';

@customElement('admin-feedback')
export class AdminFeedbackList extends SignalWatcher(LitElement)
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
            placeholder=${msg('Search message, configurator or sender')}
            .value=${this._q}
            @input=${this._onSearch}
          >
            <wa-icon slot="start" library="lucide" name="search"></wa-icon>
          </wa-input>

          <!-- "change", not "wa-change", and ?selected on the option: see <admin-configurators>. -->
          <wa-select size="small" class="select" @change=${this._onStarredFilter}>
            <wa-option value="all" ?selected=${this._starred === 'all'}>${msg('All')}</wa-option>
            <wa-option value="true" ?selected=${this._starred === 'true'}>${msg('Starred')}</wa-option>
            <wa-option value="false" ?selected=${this._starred === 'false'}>${msg('Not starred')}</wa-option>
          </wa-select>

          <wa-select size="small" class="select" @change=${this._onSort}>
            <wa-icon slot="start" library="lucide" name="arrow-down-up"></wa-icon>
            <wa-option value="newest" ?selected=${this._sort === 'newest'}>${msg('Newest first')}</wa-option>
            <wa-option value="oldest" ?selected=${this._sort === 'oldest'}>${msg('Oldest first')}</wa-option>
            <wa-option value="starred" ?selected=${this._sort === 'starred'}>${msg('Starred first')}</wa-option>
            <wa-option value="script" ?selected=${this._sort === 'script'}>${msg('By configurator')}</wa-option>
          </wa-select>
        </div>

        <span class="count">
          ${this._loading ? nothing : msg(str`${this._total} messages`)}
        </span>
      </header>

      ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}

      ${this._loading
        ? html`<div class="center"><wa-spinner></wa-spinner></div>`
        : this._items.length === 0
          ? html`<div class="center empty">${msg('No feedback matches this filter.')}</div>`
          : html`<div class="rows">${this._items.map(f => this._renderRow(f))}</div>`}

      ${this._renderPager()}
      ${this._renderDeleteDialog()}
    `;
  }

  private _renderRow(item: AdminFeedback)
  {
    const busy = this._busy === item.id;
    const script = item.scriptName
      ? `${item.scriptAuthor ?? '—'}/${item.scriptName}${item.scriptVersion ? ` v${item.scriptVersion}` : ''}`
      : msg('Unsaved preview');
    return html`
      <div class="row" ?data-starred=${item.starred}>
        <div class="body">
          <p class="message">${item.message}</p>
          <span class="meta">
            ${item.url
              ? html`<a href=${item.url} target="_blank" rel="noopener">${script}</a>`
              : script}
            · ${item.username ?? msg('anonymous')}
            · ${fmtDate(item.created)}
          </span>
        </div>

        <div class="actions">
          <wa-button
            id="star-${item.id}"
            class="icon-action star"
            size="small"
            appearance="plain"
            ?disabled=${busy}
            aria-pressed=${item.starred ? 'true' : 'false'}
            aria-label=${item.starred ? msg('Unstar') : msg('Star')}
            @click=${() => this._toggleStar(item)}
          >
            <wa-icon library="lucide" name="star"></wa-icon>
          </wa-button>
          <wa-tooltip for="star-${item.id}">${item.starred ? msg('Unstar') : msg('Star')}</wa-tooltip>

          <wa-button
            id="delete-${item.id}"
            class="icon-action delete"
            size="small"
            appearance="plain"
            ?disabled=${busy}
            aria-label=${msg('Delete')}
            @click=${() => (this._deleting = item)}
          >
            <wa-icon library="lucide" name="trash-2"></wa-icon>
          </wa-button>
          <wa-tooltip for="delete-${item.id}">${msg('Delete')}</wa-tooltip>
        </div>
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

  /** Stays in the tree, driven by ?open, so wa-dialog plays its show transition. */
  private _renderDeleteDialog()
  {
    const item = this._deleting;
    return html`
      <wa-dialog
        label=${msg('Delete feedback?')}
        ?open=${item !== null}
        @wa-after-hide=${() => (this._deleting = null)}
      >
        ${item ? html`<blockquote class="quote">${item.message}</blockquote>` : nothing}
        <p class="hint">${msg('This cannot be undone.')}</p>
        <wa-button slot="footer" appearance="plain" @click=${() => (this._deleting = null)}>
          ${msg('Cancel')}
        </wa-button>
        <wa-button slot="footer" variant="danger" @click=${this._confirmDelete}>
          <wa-icon slot="start" library="lucide" name="trash-2"></wa-icon>
          ${msg('Delete')}
        </wa-button>
      </wa-dialog>
    `;
  }

  // ── 2. State, Properties & Signals ──
  @state() private _items: AdminFeedback[] = [];
  @state() private _total = 0;
  @state() private _offset = 0;
  @state() private _q = '';
  @state() private _starred: StarredFilter = 'all';
  @state() private _sort: AdminFeedbackSort = 'newest';
  @state() private _loading = true;
  @state() private _error = '';
  /** Row id with a star or delete in flight, so its actions can be disabled. */
  @state() private _busy: string | null = null;
  /** The row the delete dialog is asking about. */
  @state() private _deleting: AdminFeedback | null = null;

  private _searchTimer: number | null = null;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    void this._load();
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
  }

  // ── 4. Behaviour & Methods ──
  private async _load()
  {
    this._loading = true;
    this._error = '';
    try
    {
      const page = await fetchAdminFeedback({
        q: this._q || undefined,
        starred: this._starred === 'all' ? undefined : this._starred === 'true',
        sort: this._sort,
        limit: PAGE_SIZE,
        offset: this._offset,
      });
      this._items = page.items;
      this._total = page.total;
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? msg('Could not load feedback.');
      this._items = [];
      this._total = 0;
    }
    finally
    {
      this._loading = false;
    }
  }

  private _onSearch(e: Event)
  {
    this._q = (e.target as HTMLInputElement).value;
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
    this._searchTimer = window.setTimeout(() =>
    {
      this._searchTimer = null;
      this._offset = 0;
      void this._load();
    }, 300);
  }

  private _onStarredFilter(e: Event)
  {
    this._starred = (e.target as HTMLInputElement).value as StarredFilter;
    this._offset = 0;
    void this._load();
  }

  private _onSort(e: Event)
  {
    this._sort = (e.target as HTMLInputElement).value as AdminFeedbackSort;
    this._offset = 0;
    void this._load();
  }

  private _goto(offset: number)
  {
    this._offset = Math.max(0, offset);
    void this._load();
  }

  private async _toggleStar(item: AdminFeedback)
  {
    this._busy = item.id;
    this._error = '';
    try
    {
      const updated = await setFeedbackStarred(item.id, !item.starred);
      // Patch in place: a reload under the starred filter would make the row vanish mid-click.
      this._items = this._items.map(f => (f.id === item.id ? updated : f));
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? msg('Could not star that feedback.');
    }
    finally
    {
      this._busy = null;
    }
  }

  private async _confirmDelete()
  {
    const item = this._deleting;
    if (!item) return;
    this._deleting = null;
    this._busy = item.id;
    this._error = '';
    try
    {
      await deleteFeedback(item.id);
      // Reload rather than splice, so the page refills and the pager stays right.
      if (this._items.length === 1 && this._offset > 0) this._offset = Math.max(0, this._offset - PAGE_SIZE);
      await this._load();
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? msg('Could not delete that feedback.');
    }
    finally
    {
      this._busy = null;
    }
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
    }

    .search { width: 300px; }
    .select { width: 170px; }

    .count
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .rows
    {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--color-border);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .row
    {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: var(--space-lg);
      padding: var(--space-md) var(--space-lg);
      background: var(--color-bg);
    }

    .body
    {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      min-width: 0;
    }

    .message
    {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .meta
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .meta a
    {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .meta a:hover { color: var(--color-primary); }

    .actions
    {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .icon-action { font-size: 16px; color: var(--color-text-muted); }
    .icon-action.star:hover { color: var(--color-warning); }
    .icon-action.delete:hover { color: var(--color-alert, #f10827); }

    /* A filled star marks a starred row. */
    .icon-action.star[aria-pressed='true']
    {
      color: var(--color-warning);
    }

    .icon-action.star[aria-pressed='true'] wa-icon::part(svg)
    {
      fill: currentColor;
    }

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

    .error
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

    .quote
    {
      margin: 0 0 var(--space-md);
      padding-left: var(--space-md);
      border-left: 3px solid var(--color-border);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 12em;
      overflow: auto;
    }

    .hint
    {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    @media (max-width: 700px)
    {
      .search, .select { width: 100%; }
      .filters { width: 100%; flex-wrap: wrap; }
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'admin-feedback': AdminFeedbackList;
  }
}
