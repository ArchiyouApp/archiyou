import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { editorScript } from '@archiyou/editor/src/state/workspace';
import { translate } from '@archiyou/editor/src/state/locale';
import { assetUrl } from '@archiyou/editor/src/services/api';

import {
  TITLE_KEY, DESCRIPTION_KEY, DETAILS_KEY,
} from '@archiyou/core/src/i18n/keys';

import './configurator-locale-select.js';

@customElement('configurator-header')
export class ConfiguratorHeader extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const script  = editorScript.get();
    const t       = translate.get();
    // Source strings stay the fallback for every key, so a missing translation degrades
    // to the author's own words rather than to a blank.
    const name    = t(TITLE_KEY, script?.published?.title ?? script?.name ?? 'Untitled');
    const author  = script?.author ?? null;
    const version = script?.version ?? null;

    return html`
      <div class="header">
        <!-- The configurator's own generated preview when it has one; otherwise the
             stub disc (a flat primary-color initial) that stood here alone before. -->
        ${script?.thumbnail
          ? html`<img class="thumb" src=${assetUrl(script.thumbnail)} alt="" loading="lazy"
                      @error=${(e: Event) => { (e.target as HTMLElement).style.display = 'none'; }}>`
          : html`<div class="avatar" aria-hidden="true">${this._initial(author ?? name)}</div>`}

        <div class="titles">
          <span class="name" title=${name}>${name}</span>
          ${author
            ? html`<span class="author">by <span class="author-name">${author}</span></span>`
            : nothing}
        </div>

        ${version ? html`<span class="version">${version}</span>` : nothing}
        <configurator-locale-select></configurator-locale-select>
      </div>

      ${this._renderAbout(script)}
    `;
  }

  /** Description under the title block, expanded by default. The longer
   *  `details` text stays behind a Show more / Show less toggle. */
  private _renderAbout(script: ReturnType<typeof editorScript.get>)
  {
    const t = translate.get();
    const description = t(DESCRIPTION_KEY, (script?.published?.description ?? script?.description ?? '')).trim();
    const details     = t(DETAILS_KEY, script?.details ?? '').trim();

    if (!description && !details) return nothing;

    return html`
      <div class="about">
        ${description ? html`<p class="description">${description}</p>` : nothing}

        ${this._expanded && details
          ? html`<p class="details">${details}</p>`
          : nothing}

        ${details ? html`
          <button class="more-btn" @click=${() => { this._expanded = !this._expanded; }}>
            <wa-icon library="lucide" name=${this._expanded ? 'chevron-up' : 'chevron-down'}></wa-icon>
            ${this._expanded ? 'Show less' : 'Show more'}
          </button>` : nothing}
      </div>
    `;
  }

  // ── 2. State ──

  /** Details visible? Collapsed by default so the description stays the summary. */
  @state() private _expanded = false;

  // ── 4. Behaviour & Methods ──
  private _initial(from: string): string
  {
    return (from.trim()[0] ?? '?').toUpperCase();
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: block;
      padding: var(--space-md) var(--space-lg);
      border-bottom: 1px solid var(--color-border);
      background: var(--color-bg-elevated);
    }

    .header
    {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      min-width: 0;
    }

    /* Sized to span the title + author block. */
    .avatar
    {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-full, 9999px);
      background: var(--color-primary);
      color: var(--color-white, #fff);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-display, var(--font-sans));
      font-size: var(--text-lg);
      font-weight: 600;
      line-height: 1;
      user-select: none;
    }

    /* Square rather than a disc: this is the model's drawing, not a person's avatar,
       and a circular crop would clip the corners of the framed geometry. */
    .thumb
    {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      object-fit: contain;
      border-radius: var(--radius-sm, 4px);
    }

    .titles
    {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
      flex: 1;
      min-width: 0;
    }

    .name
    {
      font-family: var(--font-sans);
      font-size: var(--text-base);
      font-weight: 600;
      color: var(--color-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .author
    {
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--color-text-muted, #888);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .author-name { color: var(--color-text); }

    .version
    {
      display: inline-block;
      flex-shrink: 0;
      align-self: center;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-xs);
      line-height: 1;
      color: var(--color-gray-dark, #666);
      /* gray-light stays distinguishable from the elevated panel in dark mode. */
      background: var(--color-gray-light, #eee);
      border: 1px solid var(--color-border, #cfcfcf);
      border-radius: var(--radius-full, 9999px);
      padding: 6px 8px;
      white-space: nowrap;
      /* Trim the line box to the digits (cap height to baseline): line-height alone
         centers the font's ascent/descent, which leaves the text riding high. */
      text-box: trim-both cap alphabetic;
    }

    /* ── About: description (always shown) + details behind Show more ── */

    .about
    {
      margin-top: var(--space-sm);
    }

    .description,
    .details
    {
      margin: 0;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      line-height: 1.5;
      color: var(--color-text-muted, #888);
      white-space: pre-wrap;
    }

    .details
    {
      margin-top: var(--space-sm);
      padding-top: var(--space-sm);
      border-top: 1px solid var(--color-border);
    }

    .more-btn
    {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      margin-top: var(--space-xs);
      padding: 2px 0;
      border: none;
      background: transparent;
      color: var(--color-gray-dark, #666);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 500;
      cursor: pointer;
    }

    .more-btn:hover { color: var(--color-text); text-decoration: underline; }

    .more-btn wa-icon { font-size: var(--text-x-xs, 0.625rem); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-header': ConfiguratorHeader;
  }
}
