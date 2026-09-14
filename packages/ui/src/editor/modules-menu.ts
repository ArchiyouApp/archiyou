import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { classMap } from 'lit/directives/class-map.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import type { AyModuleCatalogEntry } from '@archiyou/module-sdk';

import { moduleCatalog, ensureModuleCatalog, fetchModuleDocs } from '@archiyou/editor/src/services/module-service';

import { renderMarkdown } from '../utils/markdown.js';

/**
 * <editor-modules-menu> — what extra capabilities this account can use in scripts.
 *
 * Opened from the main file menu. Lists every module installed on the backend,
 * unlocked ones first. LOCKED modules are shown rather than hidden: a user needs
 * to be able to see that a capability exists before they can ask for it, and
 * hiding them would also make the error a script gets ("not available on your
 * account") come out of nowhere.
 *
 * TWO PANES, one modal. A module that ships a DOCS.md gets a documentation
 * pane, and clicking its card slides the list out to the left and the docs in
 * from the right. Documentation belongs next to the thing it documents — sending
 * someone to another tab to find out what a module does is how a module list
 * stops being read at all — and keeping it in the same modal means the back
 * button returns to exactly the list position they left.
 *
 * The docs are shown for LOCKED modules too, on the same reasoning that shows
 * the modules themselves: reading what a capability does is how someone decides
 * they want it.
 *
 * Controlled by its `open` property, like the other editor modals.
 *
 * Emits:
 *   modules-menu-cancel  CustomEvent<void>  — the user closed it
 */
@customElement('editor-modules-menu')
export class ModulesMenu extends SignalWatcher(LitElement)
{

  // ── 1. Render ──────────────────────────────────────────────────────────────

  override render()
  {
    const modules = moduleCatalog.get();
    const open = this._openModule;

    // The dialog stays in the tree and is driven by `?open`. Creating it
    // already-open instead would skip wa-dialog's show transition.
    return html`
      <wa-dialog
        label=${msg('modules')}
        ?open=${this.open}
        @wa-after-hide=${this._cancel}
      >
        <div class="viewport">
          <div class=${classMap({ panes: true, 'show-docs': !!open })}>
            <!-- inert rather than aria-hidden: the pane that is translated
                 off-screen still holds focusable children, and inert is the one
                 thing that takes them out of BOTH the tab order and the
                 accessibility tree. Tabbing must not walk into a pane nobody
                 can see. -->
            <section class="pane" ?inert=${!!open}>
              ${this._renderList(modules)}
            </section>
            <section class="pane" ?inert=${!open}>
              ${open ? this._renderDocs(open) : nothing}
            </section>
          </div>
        </div>
      </wa-dialog>
    `;
  }

  private _renderList(modules: AyModuleCatalogEntry[])
  {
    if (modules.length === 0) return this._renderEmpty();

    const unlocked = modules.filter(m => m.entitled).length;

    return html`
      <p class="intro">
        ${unlocked === 0
          ? msg('None of these are enabled on your account yet.')
          : msg('These add extra capabilities to your scripts.')}
      </p>
      <div class="list">
        ${[...modules]
          // Unlocked first: what you can use now is the more useful information.
          // Then by the label actually shown, so the order matches the eye.
          .sort((a, b) => Number(b.entitled) - Number(a.entitled) || a.global.localeCompare(b.global))
          .map(m => this._renderModule(m))}
      </div>
    `;
  }

  /** No modules at all. Distinguishes "still asking" from "this server has none",
   *  because both otherwise look like an empty box. */
  private _renderEmpty()
  {
    return this._loading
      ? html`<p class="empty"><wa-spinner></wa-spinner>${msg('Loading modules…')}</p>`
      : html`<p class="empty">${msg('No modules are installed on this server.')}</p>`;
  }

  private _renderModule(m: AyModuleCatalogEntry)
  {
    const hasDocs = m.docs === true;

    // A card with documentation behind it is a button in everything but tag
    // name: it is nested markup that already contains a link (docsUrl), which a
    // real <button> may not hold. Role plus tabindex plus the keydown handler is
    // what buys back what the element would have given for free.
    return html`
      <div
        class=${classMap({ module: true, locked: !m.entitled, clickable: hasDocs })}
        role=${hasDocs ? 'button' : 'group'}
        tabindex=${hasDocs ? 0 : -1}
        aria-label=${hasDocs ? msg(str`${m.global} — read the documentation`) : m.global}
        @click=${hasDocs ? () => this._openDocs(m) : nothing}
        @keydown=${hasDocs ? (e: KeyboardEvent) => this._handleCardKey(e, m) : nothing}
      >
        <!-- With the status pill gone this icon carries the state on its own, so
             its label is the only thing a screen reader has to go on. -->
        <wa-icon
          class="icon"
          library="lucide"
          name=${m.entitled ? 'circle-check' : 'lock'}
          label=${m.entitled ? msg('Enabled') : msg('Locked')}
        ></wa-icon>
        <div class="body">
          <span class="name">${m.global}</span>
          ${m.description ? html`<p class="description">${m.description}</p>` : ''}
          ${m.entitled
            // The one thing a user needs to know to actually use it: nothing
            // loads unless the script declares it.
            ? html`<p class="use">${msg('Use it with')} <code>$module('${m.id}')</code></p>`
            : ''}
          ${m.docsUrl
            ? html`<a
                class="description"
                href=${m.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                @click=${this._stop}
              >${msg('Documentation')}</a>`
            : ''}
        </div>
        ${hasDocs
          // Decorative: the card itself is the control, and its aria-label
          // already says where it goes. A second announcement would be noise.
          ? html`<span class="docs-hint" aria-hidden="true">
              <wa-icon library="lucide" name="library"></wa-icon>
              <wa-icon library="lucide" name="chevron-right"></wa-icon>
            </span>`
          : ''}
      </div>
    `;
  }

  private _renderDocs(m: AyModuleCatalogEntry)
  {
    return html`
      <div class="docs">
        <header class="docs-header">
          <wa-button size="small" appearance="plain" @click=${this._closeDocs}>
            <wa-icon slot="start" library="lucide" name="arrow-left"></wa-icon>
            ${msg('Modules')}
          </wa-button>
          <span class="docs-title">${m.global}</span>
        </header>
        <div class="docs-body">${this._renderDocsBody()}</div>
      </div>
    `;
  }

  private _renderDocsBody()
  {
    if (this._docsLoading)
    {
      return html`<p class="empty"><wa-spinner></wa-spinner>${msg('Loading documentation…')}</p>`;
    }
    if (this._docsHtml === null)
    {
      return html`<p class="empty">${msg('No documentation available for this module.')}</p>`;
    }
    // Safe by construction: see utils/markdown.ts — the source's own markup is
    // escaped, every tag here was emitted by the renderer, and the result is
    // sanitized on top of that.
    return html`<div class="markdown">${unsafeHTML(this._docsHtml)}</div>`;
  }

  // ── 2. State, Properties & Signals ─────────────────────────────────────────

  @property({ type: Boolean, reflect: true }) open = false;

  /** True while the first catalog fetch of this session is in flight. */
  @state() private _loading = false;

  /** The module whose documentation is showing, or null for the list. */
  @state() private _openModule: AyModuleCatalogEntry | null = null;

  /** Rendered DOCS.md for `_openModule`. Null once loaded and there is none.
   *  Held as HTML rather than markdown because a SignalWatcher re-renders on
   *  every catalog tick, and re-parsing a page of documentation each time is
   *  work nobody asked for. */
  @state() private _docsHtml: string | null = null;
  @state() private _docsLoading = false;

  // ── 3. Lifecycle ───────────────────────────────────────────────────────────

  override connectedCallback()
  {
    super.connectedCallback();
    document.addEventListener('keydown', this._onDocumentKeyDown, { capture: true });
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onDocumentKeyDown, { capture: true });
  }

  /** Fetch on open, not on construction: the catalog is per signed-in user, and
   *  a user who never opens this menu should not cost a request. */
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open && moduleCatalog.get().length === 0)
    {
      this._loading = true;
      void ensureModuleCatalog().finally(() => { this._loading = false; });
    }

    // A newly opened page starts at the top. The pane element is reused across
    // modules, so without this the second one you open is scrolled to wherever
    // you left the first.
    if (changed.has('_openModule') && this._openModule)
    {
      const docs = this.renderRoot.querySelectorAll<HTMLElement>('.pane')[1];
      if (docs) docs.scrollTop = 0;
    }
  }

  // ── 4. Behaviour & Methods ─────────────────────────────────────────────────

  private async _openDocs(m: AyModuleCatalogEntry)
  {
    this._openModule = m;
    this._docsHtml = null;
    this._docsLoading = true;

    const markdown = await fetchModuleDocs(m.id);

    // The user may have gone back — or into another module — while this was in
    // flight. Only the module still on screen may write to the pane.
    if (this._openModule?.id !== m.id) return;
    this._docsHtml = markdown === null ? null : renderMarkdown(markdown);
    this._docsLoading = false;
  }

  private _closeDocs()
  {
    this._openModule = null;
    this._docsHtml = null;
    this._docsLoading = false;
  }

  /** A card behaves like the button it is announced as. */
  private _handleCardKey(e: KeyboardEvent, m: AyModuleCatalogEntry)
  {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();          // Space would otherwise scroll the pane.
    void this._openDocs(m);
  }

  /** Keep a click on the docsUrl link from also opening the docs pane behind it. */
  private _stop(e: Event)
  {
    e.stopPropagation();
  }

  /**
   * Escape in the docs pane goes BACK, not out.
   *
   * Otherwise reading a page and pressing Escape throws away the whole modal,
   * which is never what "I am done with this page" means while a back button is
   * sitting right there.
   *
   * Taken on the DOCUMENT in the capture phase, because wa-dialog binds Escape
   * on the document in the bubble phase — getting there first is the only way to
   * stop it. Cancelling its `wa-hide` instead does work, but the dialog answers a
   * prevented close by shaking itself, which is the wrong thing to say about a
   * navigation that succeeded.
   */
  private readonly _onDocumentKeyDown = (e: KeyboardEvent) =>
  {
    if (e.key !== 'Escape' || !this.open || !this._openModule) return;
    e.preventDefault();
    e.stopPropagation();
    this._closeDocs();
  };

  private _cancel()
  {
    // Reset to the list, so re-opening the menu starts where it is expected to
    // rather than inside whatever was last read.
    this._closeDocs();
    this.dispatchEvent(new CustomEvent('modules-menu-cancel', { bubbles: true, composed: true }));
  }

  // ── 5. Styles ──────────────────────────────────────────────────────────────

  static override styles = css`
    :host { display: contents; }

    /* wa-dialog paints itself with --wa-color-surface-raised, which the theme
       sets to the grey #d9d9d9. Point it at the DEFAULT surface instead of
       hardcoding #fff: that is white in the light theme and the dark base in
       the dark one, so this stays readable when the theme flips. */
    wa-dialog {
      --wa-color-surface-raised: var(--wa-color-surface-default, #fff);
      /* Wide enough that a page's code blocks and tables are readable without
         wrapping. wa-dialog shrinks this to fit a smaller screen on its own, but
         half of a narrow viewport is unusable long before that, so below the
         breakpoint the modal takes nearly all of it instead. */
      --width: 50vw;
    }

    @media (max-width: 60rem) {
      wa-dialog { --width: 92vw; }
    }

    wa-dialog::part(title) {
      font-size: var(--text-base, 1rem);
      line-height: var(--text-base, 1rem);
    }

    /* Sizes come off the shared scale (xs .75 / sm .875 / base 1) rather than
       ad-hoc ems, so "one step smaller" stays one step at every zoom level. */

    /* ── The two panes ──
       A fixed-height window onto a track twice its width. Fixed rather than
       content-sized because the two panes are wildly different lengths: letting
       the modal resize would make it lurch on every slide, and would leave the
       short list rattling around inside a docs-sized box. Each pane scrolls
       on its own, so going back returns to where the list was left. */
    .viewport {
      overflow: hidden;
      height: 60vh;
      min-height: 18rem;
    }

    .panes {
      display: grid;
      /* 50% OF THE TRACK, which is itself twice the window — so each pane is
         exactly one window wide. A plain 100% here would resolve against the track and
         make every pane double-width, which reads as content spilling out of the
         right edge of the modal. */
      grid-template-columns: repeat(2, 50%);
      width: 200%;
      height: 100%;
      transform: translateX(0);
      transition: transform 320ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .panes.show-docs { transform: translateX(-50%); }

    /* Someone who has asked for less motion gets the same navigation without
       the travel. */
    @media (prefers-reduced-motion: reduce) {
      .panes { transition: none; }
    }

    .pane {
      height: 100%;
      overflow-y: auto;
      /* The track is one grid row, so a pane that is not on screen would still
         take the pointer if it overflowed. */
      overflow-x: hidden;
      padding-inline: 0.125rem;   /* room for a focus ring, not indentation */
    }

    /* ── The list ── */

    .intro {
      margin: 0 0 1rem;
      font-size: var(--text-sm, 0.875rem);
      color: var(--color-text-quiet, #666);
    }

    .list { display: flex; flex-direction: column; gap: 0.75rem; }

    .module {
      position: relative;
      display: flex; gap: 0.75rem; align-items: flex-start;
      padding: 0.75rem;
      border: 1px solid var(--color-border, #e0e0e0);
      border-radius: 0.5rem;
    }
    .module.locked { opacity: 0.65; }

    .module.clickable {
      cursor: pointer;
      /* Leave room for the docs hint so a long description never runs under it. */
      padding-right: 3.5rem;
      transition: border-color 120ms ease, background-color 120ms ease;
    }
    .module.clickable:hover,
    .module.clickable:focus-visible {
      border-color: var(--color-primary, #0b74de);
      background: var(--color-surface-sunken, rgba(0, 0, 0, 0.03));
    }
    .module.clickable:focus-visible { outline: 2px solid var(--color-primary, #0b74de); outline-offset: 1px; }

    .docs-hint {
      position: absolute;
      top: 0.6rem; right: 0.6rem;
      display: flex; align-items: center; gap: 0.15rem;
      color: var(--color-text-quiet, #666);
      font-size: var(--text-sm, 0.875rem);
    }
    .module.clickable:hover .docs-hint,
    .module.clickable:focus-visible .docs-hint { color: var(--color-primary, #0b74de); }

    .icon { flex: 0 0 auto; margin-top: 0.15rem; }
    .body { flex: 1 1 auto; min-width: 0; }

    /* The row header is the id you actually type in a script, so it is set in
       the code face — there is no separate display title to distinguish it from. */
    .name {
      display: block;
      font-family: var(--wa-font-family-code, monospace);
      font-size: var(--text-sm, 0.875rem);
      font-weight: 600;
    }
    .description { margin: 0.25rem 0 0; font-size: var(--text-xs, 0.75rem); color: var(--color-text-quiet, #666); }

    .use { margin: 0.4rem 0 0; font-size: var(--text-xs, 0.75rem); }
    .use code {
      font-family: var(--wa-font-family-code, monospace);
      background: var(--color-surface-sunken, rgba(0, 0, 0, 0.06));
      padding: 0.1rem 0.35rem;
      border-radius: 0.25rem;
    }

    .empty {
      display: flex; gap: 0.5rem; align-items: center;
      font-size: var(--text-sm, 0.875rem);
      color: var(--color-text-quiet, #666);
    }

    /* ── The docs pane ── */

    .docs { display: flex; flex-direction: column; min-height: 100%; }

    /* Sticky, because a page of docs is long and the way back should not be
       something you have to scroll up to find. */
    .docs-header {
      position: sticky; top: 0; z-index: 1;
      display: flex; align-items: center; gap: 0.5rem;
      padding-bottom: 0.5rem;
      background: var(--wa-color-surface-default, #fff);
      border-bottom: 1px solid var(--color-border, #e0e0e0);
    }
    .docs-title {
      font-family: var(--wa-font-family-code, monospace);
      font-size: var(--text-sm, 0.875rem);
      font-weight: 600;
    }

    .docs-body { flex: 1 1 auto; padding-top: 0.75rem; }

    /* ── Rendered markdown ──
       Deliberately restrained: this is a panel inside a modal, not a document
       page, so headings step down from the modal's own text size instead of
       starting above it. */
    .markdown {
      font-size: var(--text-sm, 0.875rem);
      line-height: 1.6;
      overflow-wrap: break-word;
    }
    .markdown > :first-child { margin-top: 0; }
    .markdown h1, .markdown h2, .markdown h3,
    .markdown h4, .markdown h5, .markdown h6 {
      margin: 1.5rem 0 0.5rem;
      line-height: 1.3;
      font-weight: 600;
    }
    .markdown h1 { font-size: var(--text-base, 1rem); }
    .markdown h2 { font-size: var(--text-base, 1rem); }
    .markdown h3 { font-size: var(--text-sm, 0.875rem); }
    .markdown h4, .markdown h5, .markdown h6 { font-size: var(--text-sm, 0.875rem); color: var(--color-text-quiet, #666); }
    .markdown h1, .markdown h2 { padding-bottom: 0.25rem; border-bottom: 1px solid var(--color-border, #e0e0e0); }

    .markdown p, .markdown ul, .markdown ol, .markdown blockquote { margin: 0.6rem 0; }
    .markdown ul, .markdown ol { padding-left: 1.4rem; }
    .markdown li { margin: 0.2rem 0; }

    .markdown a { color: var(--color-primary, #0b74de); }

    .markdown code {
      font-family: var(--wa-font-family-code, monospace);
      font-size: 0.9em;
      background: var(--color-surface-sunken, rgba(0, 0, 0, 0.06));
      padding: 0.1rem 0.35rem;
      border-radius: 0.25rem;
    }
    .markdown pre {
      margin: 0.75rem 0;
      padding: 0.75rem;
      background: var(--color-surface-sunken, rgba(0, 0, 0, 0.06));
      border-radius: 0.4rem;
      /* A code sample is the one thing that must not wrap; it scrolls instead,
         and the pane never grows a horizontal scrollbar of its own. */
      overflow-x: auto;
    }
    .markdown pre code { background: none; padding: 0; font-size: var(--text-xs, 0.75rem); }

    .markdown blockquote {
      padding-left: 0.75rem;
      border-left: 3px solid var(--color-border, #e0e0e0);
      color: var(--color-text-quiet, #666);
    }

    /* Wrapped rather than scrolled: a docs table is usually narrow enough,
       and a table that is not stays inside the pane instead of widening it. */
    .markdown table {
      display: block;
      width: max-content;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
      margin: 0.75rem 0;
      font-size: var(--text-xs, 0.75rem);
    }
    .markdown th, .markdown td {
      border: 1px solid var(--color-border, #e0e0e0);
      padding: 0.3rem 0.5rem;
      text-align: left;
    }
    .markdown th { background: var(--color-surface-sunken, rgba(0, 0, 0, 0.04)); font-weight: 600; }

    .markdown hr { border: none; border-top: 1px solid var(--color-border, #e0e0e0); margin: 1.25rem 0; }
    .markdown img { max-width: 100%; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'editor-modules-menu': ModulesMenu;
  }
}
