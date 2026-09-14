/**
 * <admin-configurators> — the operator's review queue for server-side execution.
 *
 * Lists every published version across all authors and lets an operator flip
 * `published.validated`. That flag is not a badge: it clears that one version to run
 * SERVER-SIDE, unsandboxed, in the execution worker's Node process, for callers who
 * may be anonymous (apps/server/src/routes/execute.ts, SECURITY.md).
 *
 * So the switch is deliberately not the whole UI. Each row opens a drawer showing the
 * exact source being vouched for, and validating from inside that drawer is the
 * intended path — the inline switch is the undo.
 *
 * Validation binds to one immutable (fileId, version) snapshot: republishing a script
 * creates a new row that starts unvalidated, so a validated row's code can never change
 * underneath the decision.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/switch/switch.js';
import '@awesome.me/webawesome/dist/components/drawer/drawer.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';

import type { ScriptData } from '@archiyou/core/src/execution/types';

import {
  fetchAdminConfigurators,
  fetchAdminConfigurator,
  setConfiguratorValidated,
} from '@archiyou/editor/src/services/admin';

const PAGE_SIZE = 25;

/** Format an ISO date string as "DD/MM/YYYY HH:MM" (locale-aware). Mirrors
 *  <manage-configurators-menu>. */
function fmtDate(iso: string | null | undefined): string
{
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

type ValidatedFilter = 'all' | 'true' | 'false';

@customElement('admin-configurators')
export class AdminConfigurators extends SignalWatcher(LitElement)
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
            placeholder=${msg('Search script or author')}
            .value=${this._q}
            @input=${this._onSearch}
          >
            <wa-icon slot="start" library="lucide" name="search"></wa-icon>
          </wa-input>

          <!-- "change", not "wa-change": WebAwesome 3 never fires the latter. And the
               selection comes from ?selected on the option, not value on the select. -->
          <wa-select size="small" class="status" @change=${this._onFilter}>
            <wa-option value="all" ?selected=${this._validated === 'all'}>${msg('All')}</wa-option>
            <wa-option value="true" ?selected=${this._validated === 'true'}>${msg('Validated')}</wa-option>
            <wa-option value="false" ?selected=${this._validated === 'false'}>${msg('Not validated')}</wa-option>
          </wa-select>
        </div>

        <span class="count">
          ${this._loading ? nothing : msg(str`${this._total} configurators`)}
        </span>
      </header>

      ${this._error ? html`<div class="error" role="alert">${this._error}</div>` : nothing}

      ${this._loading
        ? html`<div class="center"><wa-spinner></wa-spinner></div>`
        : this._rows.length === 0
          ? html`<div class="center empty">${msg('No published configurators match this filter.')}</div>`
          : html`<div class="rows">${this._rows.map(s => this._renderRow(s))}</div>`}

      ${this._renderPager()}
      ${this._renderReviewDrawer()}
    `;
  }

  private _renderRow(script: ScriptData)
  {
    const id = script.id as string;
    const validated = script.published?.validated === true;
    return html`
      <div class="row" ?data-validated=${validated}>
        <div class="identity">
          <span class="name">${script.name ?? msg('(untitled)')}</span>
          <span class="meta">${script.author} · v${script.version ?? '—'} · ${fmtDate(script.updated)}</span>
        </div>

        <wa-badge variant=${validated ? 'success' : 'neutral'} class="status-badge">
          ${validated ? msg('Server-side') : msg('Browser')}
        </wa-badge>

        <wa-button size="small" appearance="plain" @click=${() => this._review(id)}>
          <wa-icon slot="start" library="lucide" name="file-code"></wa-icon>
          ${msg('Review code')}
        </wa-button>

        <wa-switch
          size="small"
          ?checked=${validated}
          ?disabled=${this._saving === id}
          @change=${(e: Event) => this._toggle(script, e)}
        >${msg('Validated')}</wa-switch>
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

  /** The code being vouched for. Validating from in here is the intended path —
   *  the row switch exists mostly to undo. */
  private _renderReviewDrawer()
  {
    const script = this._reviewing;
    return html`
      <wa-drawer
        class="review"
        placement="end"
        label=${script ? `${script.author}/${script.name} v${script.version ?? '—'}` : msg('Review')}
        ?open=${this._reviewOpen}
        @wa-after-hide=${this._closeReview}
      >
        ${!script
          ? html`<div class="center"><wa-spinner></wa-spinner></div>`
          : html`
            <p class="warn">
              <wa-icon library="lucide" name="triangle-alert"></wa-icon>
              ${msg('Validating lets this exact code run on the server, unsandboxed, for anonymous visitors. Read it first.')}
            </p>
            <pre class="code"><code>${script.code}</code></pre>
            <wa-switch
              slot="footer"
              ?checked=${script.published?.validated === true}
              ?disabled=${this._saving === script.id}
              @change=${(e: Event) => this._toggle(script, e)}
            >${msg('Validated — may run server-side')}</wa-switch>
          `}
      </wa-drawer>
    `;
  }

  // ── 2. State, Properties & Signals ──
  @state() private _rows: ScriptData[] = [];
  @state() private _total = 0;
  @state() private _offset = 0;
  @state() private _q = '';
  @state() private _validated: ValidatedFilter = 'all';
  @state() private _loading = true;
  @state() private _error = '';
  /** Row id whose switch is mid-flight, so it can be disabled. */
  @state() private _saving: string | null = null;
  @state() private _reviewOpen = false;
  @state() private _reviewing: ScriptData | null = null;

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
      const page = await fetchAdminConfigurators({
        q: this._q || undefined,
        validated: this._validated === 'all' ? undefined : this._validated === 'true',
        limit: PAGE_SIZE,
        offset: this._offset,
      });
      this._rows = page.scripts;
      this._total = page.total;
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? msg('Could not load configurators.');
      this._rows = [];
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

  private _onFilter(e: Event)
  {
    this._validated = (e.target as HTMLInputElement).value as ValidatedFilter;
    this._offset = 0;
    void this._load();
  }

  private _goto(offset: number)
  {
    this._offset = Math.max(0, offset);
    void this._load();
  }

  private async _review(versionId: string)
  {
    // Open first, fill second: the drawer shows a spinner while the code loads, so a
    // slow fetch cannot look like a dead button.
    this._reviewing = null;
    this._reviewOpen = true;
    try
    {
      this._reviewing = await fetchAdminConfigurator(versionId);
    }
    catch (err)
    {
      this._reviewOpen = false;
      this._error = (err as Error)?.message ?? msg('Could not load that configurator.');
    }
  }

  private _closeReview()
  {
    this._reviewOpen = false;
    this._reviewing = null;
  }

  private async _toggle(script: ScriptData, e: Event)
  {
    const id = script.id as string;
    const target = e.target as HTMLInputElement;
    const next = target.checked;

    this._saving = id;
    this._error = '';
    try
    {
      const updated = await setConfiguratorValidated(id, next);
      // Patch in place rather than reloading: a reload under an active filter would
      // make the row you just toggled vanish mid-click.
      this._rows = this._rows.map(r => (r.id === id ? updated : r));
      if (this._reviewing?.id === id) this._reviewing = updated;
    }
    catch (err)
    {
      // Put the switch back where the server still has it.
      target.checked = !next;
      this._error = (err as Error)?.message ?? msg('Could not change the validated flag.');
    }
    finally
    {
      this._saving = null;
    }
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      box-sizing: border-box;
      padding: var(--space-4);
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
      gap: var(--space-4);
      flex-wrap: wrap;
    }

    .filters
    {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
    }

    .search { width: 260px; }
    .status { width: 160px; }

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
      grid-template-columns: 1fr auto auto auto;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-sm) var(--space-4);
      background: var(--color-bg);
    }

    .identity
    {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .name
    {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .center
    {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-4);
      min-height: 120px;
    }

    .empty
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .error
    {
      padding: var(--space-sm) var(--space-4);
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
      gap: var(--space-4);
    }

    .page
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .warn
    {
      display: flex;
      align-items: flex-start;
      gap: var(--space-sm);
      margin: 0 0 var(--space-4);
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .warn wa-icon { color: var(--color-warning); flex-shrink: 0; }

    .code
    {
      margin: 0;
      padding: var(--space-4);
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
    }

    wa-drawer.review::part(dialog) { width: min(720px, 100vw); }

    @media (max-width: 700px)
    {
      .row
      {
        grid-template-columns: 1fr;
        gap: var(--space-sm);
      }

      .search, .status { width: 100%; }
      .filters { width: 100%; flex-wrap: wrap; }
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'admin-configurators': AdminConfigurators;
  }
}
