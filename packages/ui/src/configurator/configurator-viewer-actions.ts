/**
 * configurator-viewer-actions — the buttons floating over the top-right corner
 * of the configurator viewer. Two modes, selected with the `preview` attribute:
 *
 *   • preview (in the editor's Configurator Preview) — a single "Publish as
 *     configurator" action; embedding/viewing source makes no sense for a
 *     working copy that is not out in the world yet.
 *   • published (the standalone /configurators/… page) — "View source", only
 *     when the published script is *also* shared, i.e. its code is public, and
 *     "Embed", which opens a ready-to-paste <iframe> snippet. Neither when the
 *     page is embedded in another site (`embedded`, from `?embed=1`): that site
 *     offers its own links.
 *     And "Save as project" (unless the link says `ui.project=0`), also inside
 *     another site: a link to the editor's /projects/new with the design on
 *     screen, which signs the visitor in or up if needed and opens the new
 *     project (services/save-project.ts). From another site's page it opens in a
 *     new tab, where the visitor's Archiyou session lives.
 */

import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { localized, msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import './configurator-action-button.js';

import { editorScript } from '@archiyou/editor/src/state/workspace';
import { configurationQuery } from '@archiyou/editor/src/state/configurator-url';
import { configuratorDisplay } from '@archiyou/editor/src/state/configurator-display';
import { configuratorLocale } from '@archiyou/editor/src/state/locale';
import { saveProjectUrl } from '@archiyou/editor/src/services/save-project';
import { publicConfiguratorUrl } from '../editor/publish-constants.js';
import { BREAKPOINT_COMPACT } from '@archiyou/editor/src/styles/design-tokens';

/** Height of the embed frame. The width is fluid (100% of the host element), so
 *  the snippet drops into any column without the user picking numbers. */
const EMBED_HEIGHT = 600;

@localized()
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
        <configurator-action-button primary expanded icon="rocket" label=${msg('Publish as configurator')}
            hint=${msg('Publish this script as a configurator')} @click=${this._publish}></configurator-action-button>
      </div>
    `;
  }

  private _renderPublished()
  {
    const sourceUrl  = this.embedded ? null : this._sourceUrl();
    const embedUrl   = this.embedded ? null : this._embedUrl();
    const projectUrl = this._projectUrl();

    // Nothing to offer → stay out of the way entirely rather than show dead buttons.
    this.toggleAttribute('hidden', !sourceUrl && !embedUrl && !projectUrl);
    if (!sourceUrl && !embedUrl && !projectUrl) return nothing;

    return html`
      <div class="actions">
        ${projectUrl ? html`
          <configurator-action-button icon="folder-plus" label=${msg('Save as project')}
              hint=${msg('Keep this design in a new project of yours')}
              href=${projectUrl} target=${this.embedded ? '_blank' : '_self'}></configurator-action-button>` : nothing}

        ${sourceUrl ? html`
          <configurator-action-button icon="code" label=${msg('View source')}
              hint=${msg("Open this script's source in the editor")}
              href=${sourceUrl} target="_blank"></configurator-action-button>` : nothing}

        ${embedUrl ? html`
          <configurator-action-button icon="code-xml" label=${msg('Embed')}
              hint=${msg('Embed this configurator on your site')} toggle ?active=${this._embedOpen}
              @click=${() => { this._embedOpen = !this._embedOpen; }}></configurator-action-button>` : nothing}
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
          <span>${msg('Embed this configurator')}</span>
          <button class="close-btn" aria-label=${msg('Close')}
              @click=${() => { this._embedOpen = false; }}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <p class="panel-hint">
          ${msg(html`Paste this HTML into your page — it works like a YouTube or Vimeo embed. The frame fills the width it is given; adjust <code>height</code> to taste.`)}
        </p>

        <textarea class="snippet" readonly rows="6"
          @focus=${(e: FocusEvent) => (e.target as HTMLTextAreaElement).select()}
        >${snippet}</textarea>

        <div class="panel-actions">
          <a class="open-link" href=${embedUrl} target="_blank" rel="noopener">${msg('Open directly')}</a>
          <button class="copy-btn" @click=${() => this._copy(snippet)}>
            <wa-icon library="lucide" name=${this._copied ? 'check' : 'copy'}></wa-icon>
            ${this._copied ? msg('Copied') : msg('Copy')}
          </button>
        </div>
      </div>
    `;
  }

  // ── 2. State & Properties ──

  /** True inside the editor's Configurator Preview; false on the public page. */
  @property({ type: Boolean, reflect: true }) preview = false;

  /** Shown inside another site's page (`?embed=1`): no "View source" or "Embed". */
  @property({ type: Boolean, reflect: true }) embedded = false;

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

  /** "Save as project": the editor's /projects/new with the published configurator and the
   *  configuration on screen (read here, so the link follows every change). */
  private _projectUrl(): string | null
  {
    const script = editorScript.get();
    if (!configuratorDisplay.get().project || !script?.published || !script.author || !script.name || !script.version) return null;
    const base = (typeof window !== 'undefined' && window.location?.origin) || '';
    const query = new URLSearchParams(configurationQuery());
    query.set('lang', configuratorLocale.get());
    return saveProjectUrl(base, script.author, script.name, script.version, query.toString());
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


    /* ── Embed panel ── */

    .panel
    {
      width: min(420px, 100cqw - 16px);
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
      color: var(--color-on-primary, #fff);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 600;
      cursor: pointer;
    }

    /* Compact configurator: round icon buttons (labels stay as aria-label). */
    @container configurator (width < ${unsafeCSS(BREAKPOINT_COMPACT)})
    {
      .close-btn
      {
        width: var(--hit-min);
        height: var(--hit-min);
      }
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
