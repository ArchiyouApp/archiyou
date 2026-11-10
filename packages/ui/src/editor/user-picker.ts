/**
 * user-picker — choose Archiyou users by name or email: the chosen ones as chips, a search
 * field below (GET /users/search). Used by <share-script-menu> ("Share only with") and
 * <publish-script-menu> (a fulfillment only the listed users can get).
 *
 * `users` are the chosen ones; every change is a `user-picker-change` event with the new
 * list in `detail.users`. A user known only by their handle (a stored list) shows as the
 * handle.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import type { PublicUser } from '@archiyou/types';

import { searchUsers } from '@archiyou/editor/src/services/sharing';

/** A chip for a user known only by their handle. Only `id` matters; the rest satisfies
 *  PublicUser (entitlements and operator rights are irrelevant to a chip). */
export function userStub(id: string): PublicUser
{
  return { id, email: null, name: null, avatarUrl: null, emailVerified: true, modules: [], isAdmin: false };
}

@customElement('user-picker')
export class UserPicker extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="user-picker">
        ${this.users.length
          ? html`
            <div class="chips">
              ${this.users.map(u => html`
                <span class="chip">
                  ${u.name ?? u.id}
                  <button class="chip-remove" title="Remove" @click=${() => this._remove(u)}>
                    <wa-icon library="lucide" name="x"></wa-icon>
                  </button>
                </span>`)}
            </div>`
          : nothing}
        <div class="search-wrap">
          <wa-icon library="lucide" name="search" class="search-icon"></wa-icon>
          <input
            class="search-input"
            type="text"
            placeholder=${this.placeholder}
            .value=${this._query}
            @input=${(e: InputEvent) => this._onQueryInput((e.target as HTMLInputElement).value)}
          />
          ${this._searching ? html`<wa-spinner class="search-spinner"></wa-spinner>` : nothing}
        </div>
        ${this._results.length > 0
          ? html`
            <div class="results">
              ${this._results.map(u => html`
                <button class="result-item" @click=${() => this._add(u)}>
                  <span class="result-name">${u.name ?? u.id}</span>
                  ${u.email ? html`<span class="result-email">${u.email}</span>` : nothing}
                </button>`)}
            </div>`
          : nothing}
      </div>
    `;
  }

  // ── 2. State & Properties ──
  @property({ attribute: false }) users: PublicUser[] = [];
  @property() placeholder = 'Search users by name or email…';

  @state() private _query = '';
  @state() private _results: PublicUser[] = [];
  @state() private _searching = false;

  private _searchTimer: number | null = null;

  // ── 3. Lifecycle ──
  override disconnectedCallback()
  {
    super.disconnectedCallback();
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
  }

  // ── 4. Behaviour & Methods ──

  /** Forget the search (the dialog around it was reset). */
  reset()
  {
    this._query = '';
    this._results = [];
  }

  private _onQueryInput(value: string)
  {
    this._query = value;
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
    const q = value.trim();
    if (!q) { this._results = []; this._searching = false; return; }
    this._searching = true;
    this._searchTimer = window.setTimeout(async () =>
    {
      try
      {
        const results = await searchUsers(q);
        const chosen = new Set(this.users.map(u => u.id));
        this._results = results.filter(u => !chosen.has(u.id));
      }
      catch (err)
      {
        console.error('User search failed:', err);
        this._results = [];
      }
      finally
      {
        this._searching = false;
      }
    }, 250);
  }

  private _add(u: PublicUser)
  {
    if (!this.users.some(s => s.id === u.id)) this._changed([...this.users, u]);
    this.reset();
  }

  private _remove(u: PublicUser)
  {
    this._changed(this.users.filter(s => s.id !== u.id));
  }

  private _changed(users: PublicUser[])
  {
    this.users = users;
    this.dispatchEvent(new CustomEvent('user-picker-change', { detail: { users }, bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host { display: block; }

    .user-picker { display: flex; flex-direction: column; gap: 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 6px 2px 10px;
      border-radius: 999px;
      background: var(--color-gray-dark, #666);
      color: #fff;
      font-size: var(--text-sm);
    }
    .chip-remove {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px;
      border: none; border-radius: 50%;
      background: none; color: inherit; cursor: pointer;
      opacity: 0.85; font-size: 11px;
    }
    .chip-remove:hover { opacity: 1; background: rgba(255,255,255,0.25); }

    .search-wrap {
      display: flex; align-items: center; gap: 5px;
      padding: 4px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg);
      color: var(--color-text-muted);
    }
    .search-wrap:focus-within { border-color: var(--color-primary); }
    .search-icon { flex-shrink: 0; font-size: 13px; opacity: 0.55; }
    .search-input {
      flex: 1; min-width: 0;
      border: none; outline: none; background: transparent;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
    }
    .search-spinner { font-size: 13px; }

    .results {
      display: flex; flex-direction: column;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg-elevated);
      max-height: 180px;
      overflow-y: auto;
    }
    .result-item {
      display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
      padding: 6px 10px;
      border: none; background: transparent; cursor: pointer;
      text-align: left; width: 100%;
      font-family: var(--font-sans);
    }
    .result-item:hover { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
    .result-name { font-size: var(--text-sm); color: var(--color-text); }
    .result-email { font-size: var(--text-xs); color: var(--color-text-muted); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'user-picker': UserPicker;
  }
}
