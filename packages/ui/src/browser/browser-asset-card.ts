/**
 * <browser-asset-card> — presentational card for a single browser asset.
 *
 * Stub: shows a preview image, type, name and author. More info to follow.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

@customElement('browser-asset-card')
export class BrowserAssetCard extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="preview">
        ${this.preview
          ? html`<img src=${this.preview} alt=${this.name}>`
          : html`<wa-icon library="lucide" name="image"></wa-icon>`}
      </div>
      <div class="body">
        <span class="type">${this.type}</span>
        <span class="name">${this.name}</span>
        ${this.author
          ? html`<span class="author">${this.author}</span>`
          : nothing}
        <!-- TODO: more info (updated date, stats, …) -->
      </div>
    `;
  }

  // ── 2. Properties ──
  @property({ type: String }) name = '';
  @property({ type: String }) type = '';
  @property({ type: String }) author = '';
  /** Preview image URL; falls back to a placeholder block when empty. */
  @property({ type: String }) preview = '';

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 220px;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    :host(:hover) {
      border-color: var(--color-primary);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
    }

    .preview {
      display: flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 16 / 10;
      background: var(--color-gray);
      color: var(--color-text-muted);
    }

    /* contain, not cover: previews are generated iso line drawings, already framed
       square with padding. Cropping one to fill 16:10 cuts off the geometry that makes
       it recognisable — the whole point of having a thumbnail. */
    .preview img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      padding: 8px;
      box-sizing: border-box;
    }

    .preview wa-icon {
      font-size: var(--text-3xl);
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--space-md);
    }

    .type {
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
    }

    .name {
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--color-text);
    }

    .author {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'browser-asset-card': BrowserAssetCard;
  }
}
