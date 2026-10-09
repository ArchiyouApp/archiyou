import { LitElement, html, css, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { executing, executionResult } from '@archiyou/editor/src/state/workspace';

/**
 * <editor-key-badge> — which of the user's keys the last run read with, as a chip in the
 * code editor's title bar after the run status. Shown only when a run read content with a
 * key (result.used: what the run read, not what the editor fetched in advance). Clicking it
 * opens the Keys menu (event `open-keys`).
 */
@customElement('editor-key-badge')
export class KeyBadge extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const result = executionResult.get();
    if (!result || result.status !== 'success' || executing.get()) return nothing;

    const keyed = (result.used ?? []).filter((u) => u.via === 'key' && u.keyName);
    if (!keyed.length) return nothing;
    const keys = [...new Set(keyed.map((u) => u.keyName!))].join(', ');
    const sheets = keyed.map((u) => u.title ?? u.id).join(', ');

    return html`
      <button
        class="key-badge"
        title=${msg(str`This run read ${sheets} with your key ${keys}. Keys stay in this browser.`)}
        @click=${this._openKeys}
      >
        <wa-icon library="lucide" name="key-round"></wa-icon>${keys}
      </button>
    `;
  }

  // ── 4. Behaviour ──
  private _openKeys()
  {
    this.dispatchEvent(new CustomEvent('open-keys', { bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      min-width: 0;
    }

    /* A chip, like the run status beside it. */
    .key-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs, 0.25rem);
      padding: 2px 8px;
      border: none;
      border-radius: var(--radius-full);
      background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      color: var(--color-primary);
      font-family: var(--font-sans);
      font-size: var(--text-xs, 0.75rem);
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .key-badge:hover { background: color-mix(in srgb, var(--color-primary) 18%, transparent); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-key-badge': KeyBadge;
  }
}
