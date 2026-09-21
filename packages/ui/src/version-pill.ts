/**
 * <version-pill> — the small mono chip that shows a script's shared/published
 * version, the same everywhere (file-info header, browser cards).
 *
 * `changed` adds the "changed since this version" marker. The host carries any
 * `id` a tooltip wants to point at.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

@customElement('version-pill')
export class VersionPill extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <span class="text">${this.version}</span>
      ${this.changed
        ? html`<wa-icon class="changed" library="lucide" name="file-diff" label="Changed since this version"></wa-icon>`
        : nothing}
    `;
  }

  // ── 2. Properties ──
  @property({ type: String }) version = '';
  /** The working copy differs from this version. */
  @property({ type: Boolean }) changed = false;

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-x-xs, 0.625rem);
      line-height: 1;
      color: var(--color-text-gray, #666);
      background: var(--color-surface-subtle, #eee);
      border: 1px solid var(--color-border, #cfcfcf);
      border-radius: var(--radius-md, 6px);
      padding: 4px 7px;
      white-space: nowrap;
    }

    .text {
      /* Trim the line box to the digits (cap height to baseline): line-height alone
         centers the font's ascent/descent, which leaves the text riding high. */
      text-box: trim-both cap alphabetic;
    }

    .changed {
      font-size: 0.625rem;
      color: var(--color-alert, #ef4444);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'version-pill': VersionPill;
  }
}
