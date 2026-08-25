/**
 * configurator-viewer-actions — the buttons floating over the top-right corner
 * of the configurator viewer. Two modes, selected with the `preview` attribute:
 *
 *   • preview (in the editor's Configurator Preview) — a single "Publish as
 *     configurator" action; embedding/viewing source makes no sense for a
 *     working copy that is not out in the world yet.
 *   • published (the standalone /configurators/… page) — "View source", only
 *     when the published script is *also* shared, i.e. its code is public, and
 *     "Embed", which opens a ready-to-paste <iframe> snippet.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { editorScript } from '@archiyou/editor/src/state/workspace';
import { publicConfiguratorUrl } from '../editor/publish-constants.js';

/** Height of the embed frame. The width is fluid (100% of the host element), so
 *  the snippet drops into any column without the user picking numbers. */
const EMBED_HEIGHT = 600;

@customElement('configurator-viewer-actions')
export class ConfiguratorViewerActions extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    return this.preview ? this._renderPreview() : this._renderPublished();
  }

  private _renderPreview()
  {
    this.removeAttribute('hidden');

    return html`
      <div class="actions">
        <button class="action-btn primary" title="Publish this script as a configurator"
            @click=${this._publish}>
          <wa-icon library="lucide" name="rocket"></wa-icon>
          <span>Publish as configurator</span>
        </button>
      </div>
    `;
  }

  private _renderPublished()
  {
    const sourceUrl = this._sourceUrl();
    const embedUrl  = this._embedUrl();

    // Nothing to offer → stay out of the way entirely rather than show dead buttons.
    this.toggleAttribute('hidden', !sourceUrl && !embedUrl);
    if (!sourceUrl && !embedUrl) return nothing;

    return html`
      <div class="actions">
        ${sourceUrl ? html`
          <a class="action-btn" href=${sourceUrl} target="_blank" rel="noopener"
              title="Open this script's source in the editor">
            <wa-icon library="lucide" name="code"></wa-icon>
            <span>View source</span>
          </a>` : nothing}

        ${embedUrl ? html`
          <button class="action-btn ${this._embedOpen ? 'active' : ''}"
              title="Embed this configurator on your site"
              @click=${() => { this._embedOpen = !this._embedOpen; }}>
            <wa-icon library="lucide" name="code-xml"></wa-icon>
            <span>Embed</span>
          </button>` : nothing}
      </div>

      ${this._embedOpen && embedUrl ? this._renderEmbedPanel(embedUrl) : nothing}
    `;
  }

  private _renderEmbedPanel(embedUrl: string)
  {
    const snippet = this._snippet(embedUrl);

    return html`
      <div class="panel">
        <div class="panel-header">
          <span>Embed this configurator</span>
          <button class="close-btn" aria-label="Close"
              @click=${() => { this._embedOpen = false; }}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <p class="panel-hint">
          Paste this HTML into your page — it works like a YouTube or Vimeo embed.
          The frame fills the width it is given; adjust <code>height</code> to taste.
        </p>

        <textarea class="snippet" readonly rows="6"
          @focus=${(e: FocusEvent) => (e.target as HTMLTextAreaElement).select()}
        >${snippet}</textarea>

        <div class="panel-actions">
          <a class="open-link" href=${embedUrl} target="_blank" rel="noopener">Open directly</a>
          <button class="copy-btn" @click=${() => this._copy(snippet)}>
            <wa-icon library="lucide" name=${this._copied ? 'check' : 'copy'}></wa-icon>
            ${this._copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    `;
  }

  // ── 2. State & Properties ──

  /** True inside the editor's Configurator Preview; false on the public page. */
  @property({ type: Boolean, reflect: true }) preview = false;

  @state() private _embedOpen = false;
  @state() private _copied = false;

  private _copiedTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 3. Lifecycle ──
  override disconnectedCallback()
  {
    super.disconnectedCallback();
    if (this._copiedTimer !== null) clearTimeout(this._copiedTimer);
  }

  // ── 4. Behaviour & Methods ──

  /** Ask the host to start the publish flow. The editor's main menu closes the
   *  preview dialog and opens <publish-script-menu>. */
  private _publish()
  {
    this.dispatchEvent(new CustomEvent('configurator-publish', {
      bubbles:  true,
      composed: true,
    }));
  }

  /** The editor deep link for the shared source — same scheme as the Links panel
   *  in file-info: /editor/{author}/{name}:{version}. Null unless the script is
   *  shared (published alone does not make the code public). */
  private _sourceUrl(): string | null
  {
    const script = editorScript.get();
    if (!script?.shared || !script.author || !script.name || !script.version) return null;
    const base = (typeof window !== 'undefined' && window.location?.origin) || '';
    return `${base}/editor/${encodeURIComponent(script.author)}/${encodeURIComponent(script.name)}:${encodeURIComponent(script.version)}`;
  }

  /** The public configurator URL, preferring the one the server stamped. */
  private _embedUrl(): string | null
  {
    const script = editorScript.get();
    if (!script?.published || !script.author || !script.name || !script.version) return null;
    return publicConfiguratorUrl(script.published.url, script.author, script.name, script.version);
  }

  private _snippet(embedUrl: string): string
  {
    return `<iframe\n`
      + `  src="${embedUrl}"\n`
      + `  style="width:100%;height:${EMBED_HEIGHT}px;border:0"\n`
      + `  allowfullscreen\n`
      + `  title="Archiyou configurator"\n`
      + `></iframe>`;
  }

  private async _copy(snippet: string)
  {
    try
    {
      await navigator.clipboard.writeText(snippet);
      this._copied = true;
      if (this._copiedTimer !== null) clearTimeout(this._copiedTimer);
      this._copiedTimer = setTimeout(() => { this._copied = false; }, 1600);
    }
    catch (err)
    {
      console.warn('Configurator: copying the embed snippet failed:', err);
    }
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--space-sm);
      font-family: var(--font-sans);
    }

    :host([hidden]) { display: none; }

    .actions
    {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .action-btn
    {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      padding: 5px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full, 9999px);
      background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
      backdrop-filter: blur(4px);
      color: var(--color-text);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
    }

    .action-btn:hover,
    .action-btn.active
    {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .action-btn.primary
    {
      padding: 6px 14px;
      border-color: var(--color-primary);
      background: var(--color-primary);
      color: var(--color-white, #fff);
      font-size: var(--text-sm);
      font-weight: 600;
    }

    .action-btn.primary:hover
    {
      background: color-mix(in srgb, var(--color-black, #000) 12%, var(--color-primary));
      color: var(--color-white, #fff);
    }

    /* ── Embed panel ── */

    .panel
    {
      width: 420px;
      max-width: 80vw;
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
      padding: var(--space-lg);
      border-radius: var(--radius-md, 8px);
      border: 1px solid var(--color-border);
      background: var(--color-bg-elevated, #fff);
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
    }

    .panel-header
    {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: var(--text-base);
      font-weight: 600;
      color: var(--color-text);
    }

    .close-btn
    {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: var(--radius-sm, 4px);
      background: transparent;
      color: var(--color-text-muted, #888);
      font-size: 13px;
      cursor: pointer;
    }

    .close-btn:hover
    {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
      color: var(--color-text);
    }

    .panel-hint
    {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted, #888);
      line-height: 1.5;
    }

    .panel-hint code
    {
      font-family: var(--font-mono, monospace);
      color: var(--color-text);
    }

    .snippet
    {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-xs);
      line-height: 1.5;
      color: var(--color-text);
      background: var(--color-bg, #fff);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      padding: var(--space-sm);
      outline: none;
      /* Wrap rather than scroll sideways — the src URL can be long. */
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .panel-actions
    {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-sm);
    }

    .open-link
    {
      font-size: var(--text-xs);
      color: var(--color-text-muted, #888);
      text-decoration: none;
    }

    .open-link:hover { color: var(--color-primary); text-decoration: underline; }

    .copy-btn
    {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      padding: 6px 14px;
      border: none;
      border-radius: var(--radius-sm, 4px);
      background: var(--color-primary);
      color: var(--color-white, #fff);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 600;
      cursor: pointer;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-viewer-actions': ConfiguratorViewerActions;
  }
}
