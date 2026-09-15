/**
 * <browser-asset-card> — presentational card for a single browser asset.
 *
 * Shows a preview image (or a placeholder icon for the kind), the kind, the name, the
 * version and who made it and when. Activating the card (click, Enter or Space) is a
 * plain `click` on the host, so the grid can listen for it.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { BrowserAsset, BrowserAssetKind } from './browser-asset-grid.js';

const KIND_ICONS: Record<BrowserAssetKind, string> = {
  script: 'file-code',
  shared: 'users',
  configurator: 'tv-minimal-play', // as the configurator preview button in the editor
};

function fmtDate(ms: number | undefined): string
{
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

@customElement('browser-asset-card')
export class BrowserAssetCard extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    const a = this.asset;
    if (!a) return nothing;
    const meta = [a.author, fmtDate(a.updated)].filter(Boolean).join(' · ');
    const thumbnail = a.thumbnail && a.thumbnail !== this._failedThumbnail ? a.thumbnail : null;

    return html`
      <div class="preview">
        ${thumbnail
          ? html`<img src=${thumbnail} alt="" loading="lazy"
                      @error=${() => { this._failedThumbnail = thumbnail; }}>`
          : html`<wa-icon library="lucide" name=${KIND_ICONS[a.kind]}></wa-icon>`}
      </div>
      <div class="body">
        <span class="type">${this._kindLabel(a.kind)}</span>
        <div class="title">
          <span class="name" title=${a.name}>${a.name}</span>
          ${a.version ? html`<span class="version">v${a.version}</span>` : nothing}
        </div>
        ${meta ? html`<span class="meta">${meta}</span>` : nothing}
      </div>
    `;
  }

  // ── 2. Properties ──
  @property({ attribute: false }) asset: BrowserAsset | null = null;

  /** A thumbnail that did not load, so the card shows the kind's icon instead. */
  @state() private _failedThumbnail: string | null = null;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    this.setAttribute('role', 'button');
    this.tabIndex = 0;
    this.addEventListener('keydown', this._onKeydown);
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this._onKeydown);
  }

  // ── 4. Behaviour & Methods ──
  private _kindLabel(kind: BrowserAssetKind): string
  {
    return { script: msg('Script'), shared: msg('Shared script'), configurator: msg('Configurator') }[kind];
  }

  private _onKeydown = (e: KeyboardEvent) =>
  {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    this.click();
  };

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

    :host(:focus-visible) {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }

    .preview {
      display: flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 16 / 10;
      /* Keeps the 16:10 box when a (square) thumbnail would make it taller:
         aspect-ratio only holds as a minimum for content that fits. */
      overflow: hidden;
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
      padding: var(--space-sm);
      box-sizing: border-box;
    }

    .preview wa-icon {
      font-size: var(--text-3xl, 1.875rem);
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding: var(--space-md);
      min-width: 0;
    }

    .type {
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
    }

    .title {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
    }

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--color-text);
    }

    .version {
      display: inline-block;
      flex-shrink: 0;
      padding: 4px var(--space-sm);
      line-height: 1;
      /* Trim the line box to the digits (cap height to baseline): line-height alone
         centers the font's ascent/descent, which leaves the text riding high. */
      text-box: trim-both cap alphabetic;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .meta {
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
