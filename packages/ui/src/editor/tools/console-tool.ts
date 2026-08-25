import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';

import { executionResult } from '@archiyou/editor/src/state/workspace';
import type { ConsoleMessageType } from '@archiyou/core/src/console/types';

const MESSAGE_TYPES: ConsoleMessageType[] = ['error', 'exec', 'geom', 'user', 'warn', 'info'];

const ICON_MAP: Record<ConsoleMessageType, string> =
{
  info:  'info',
  geom:  'shapes',
  user:  'user',
  warn:  'triangle-alert',
  error: 'circle-x',
  exec:  'terminal',
};

const TYPE_LABEL: Record<ConsoleMessageType, string> =
{
  info:  'Info',
  geom:  'Geometry',
  user:  'User',
  warn:  'Warning',
  error: 'Error',
  exec:  'Execution',
};

@customElement('editor-console-tool')
export class EditorConsoleTool extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const messages = executionResult.get()?.messages ?? [];
    const searchQuery = this._searchQuery.trim().toLowerCase();

    const counts = Object.fromEntries(
      MESSAGE_TYPES.map(t => [t, messages.filter(m => m.type === t).length])
    ) as Record<ConsoleMessageType, number>;

    const filtered = messages.filter(m =>
      this._activeFilters.has(m.type)
      && (!searchQuery || m.message.toLowerCase().includes(searchQuery))
    );

    return html`
      <div class="topbar">
        <div class="toolbar">
          ${MESSAGE_TYPES.map(type => html`
            <button
              class="filter-btn type-${type} ${this._activeFilters.has(type) ? 'active' : ''}"
              @click=${() => this._toggleFilter(type)}
              title="${TYPE_LABEL[type]}: ${counts[type]}"
            >
              <wa-icon library="lucide" name=${ICON_MAP[type]}></wa-icon>
              <span class="count">${counts[type]}</span>
            </button>
          `)}
        </div>

        <div class="searchbar">
          <wa-input
            class="search-input"
            size="small"
            type="search"
            placeholder="Filter"
            .value=${this._searchQuery}
            @input=${this._onSearchInput}
          >
            <wa-icon slot="start" library="lucide" name="search"></wa-icon>

            ${this._searchQuery
              ? html`
                  <wa-button
                    slot="end"
                    class="clear-search-btn"
                    appearance="plain"
                    size="small"
                    @click=${this._clearSearch}
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <wa-icon library="lucide" name="x"></wa-icon>
                  </wa-button>
                `
              : null}
          </wa-input>
        </div>
      </div>

      <div class="messages">
        ${filtered.length === 0
          ? html`<div class="empty">${this._searchQuery ? 'No matching messages' : 'No messages'}</div>`
          : filtered.map(m => html`
              <div class="message type-${m.type}">
                <wa-icon class="msg-icon" library="lucide" name=${ICON_MAP[m.type]}></wa-icon>
                <span class="msg-text">${m.message}</span>
                <span class="msg-time">${m.time}</span>
              </div>
            `)
        }
      </div>
    `;
  }

  // ── 2. State ──
  @state() private _activeFilters: Set<ConsoleMessageType> = new Set(['error', 'user']);
  @state() private _searchQuery = '';

  // ── 4. Behaviour & Methods ──
  private _toggleFilter(type: ConsoleMessageType)
  {
    const next = new Set(this._activeFilters);
    if (next.has(type)) { next.delete(type); }
    else { next.add(type); }
    this._activeFilters = next;
  }

  private _onSearchInput(event: Event)
  {
    this._searchQuery = (event.target as HTMLInputElement).value ?? '';
  }

  private _clearSearch()
  {
    this._searchQuery = '';
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      background: var(--color-bg-elevated);
      overflow: hidden;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--color-border);
    }

    .toolbar {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: wrap;
      gap: 4px;
      min-width: 0;
    }

    .searchbar {
      flex: 0 1 160px;
      width: min(100%, 160px);
      min-width: 120px;
    }

    .search-input {
      width: 100%;
      font-size: var(--text-xs);
    }

    .search-input::part(base),
    .search-input::part(input),
    .search-input::part(prefix),
    .search-input::part(suffix) {
      font-size: var(--text-xs);
    }

    .clear-search-btn {
      --wa-button-padding-inline: 0.25rem;
      min-height: auto;
      font-size: var(--text-xs);
    }

    .filter-btn {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px 5px;
      border: 1px solid transparent;
      border-radius: var(--radius-full);
      background: transparent;
      cursor: pointer;
      font-size: var(--text-sm);
      transition: opacity 0.12s, background 0.12s;
      opacity: 0.35;
    }

    .filter-btn.active {
      opacity: 1;
      background: color-mix(in srgb, currentColor 10%, transparent);
      border-color: color-mix(in srgb, currentColor 25%, transparent);
    }

    .filter-btn:hover {
      opacity: 1;
    }

    .filter-btn .count {
      font-weight: 600;
    }

    .filter-btn.type-info  { color: #3b82f6; }
    .filter-btn.type-geom  { color: #14b8a6; }
    .filter-btn.type-user  { color: #a855f7; }
    .filter-btn.type-warn  { color: #f59e0b; }
    .filter-btn.type-error { color: #ef4444; }
    .filter-btn.type-exec  { color: #6b7280; }

    .messages {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding-bottom: 0.3rem;
    }

    .empty {
      padding: 0.5rem 1rem;
      color: var(--color-text);
      font-size: var(--text-md);
    }

    .message {
      display: flex;
      align-items: baseline;
      gap: var(--space-sm, 8px);
      padding: 0.18rem 1rem;
      font-size: 0.72rem;
      font-family: var(--font-mono, monospace);
      border-left: 2px solid transparent;
    }

    .message:hover {
      background: color-mix(in srgb, var(--color-border) 25%, transparent);
    }

    .message.type-warn  { border-left-color: #f59e0b; background: color-mix(in srgb, #f59e0b 6%, transparent); }
    .message.type-error { border-left-color: #ef4444; background: color-mix(in srgb, #ef4444 6%, transparent); }

    .message.type-info  .msg-icon { color: #3b82f6; }
    .message.type-geom  .msg-icon { color: #14b8a6; }
    .message.type-user  .msg-icon { color: #a855f7; }
    .message.type-warn  .msg-icon { color: #f59e0b; }
    .message.type-error .msg-icon { color: #ef4444; }
    .message.type-exec  .msg-icon { color: #6b7280; }

    .msg-icon {
      flex-shrink: 0;
      font-size: 0.75rem;
    }

    .msg-text {
      flex: 1;
      color: var(--color-text);
      white-space: pre-wrap;
      word-break: break-all;
    }

    .msg-time {
      flex-shrink: 0;
      color: var(--color-gray-dark);
      font-size: var(--text-xs);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-console-tool': EditorConsoleTool;
  }
}
