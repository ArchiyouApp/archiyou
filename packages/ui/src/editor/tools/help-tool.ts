import { LitElement, html, css, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import {
  helpEntry, helpStep, helpTutorials, helpTutorialTag, helpCurrentStep, helpLocale, helpLocales,
  ONBOARDING_PATH, openHelpDoc, goToHelpStep, closeHelpDoc, loadHelpTutorials, setHelpLocale, runHelpCode, helpImageUrl,
  type HelpEntry,
} from '@archiyou/editor/src/state/help';
import { codeAt, helpTags, HELP_TAGS, type HelpBlock, type HelpTag } from '../help/help-content.js';
import { renderMarkdown } from '../../utils/markdown.js';

/**
 * The help panel: the editor tour and step-by-step tutorials, both played from
 * markdown in help/<locale>/ (see state/help.ts). A step's `<!-- highlight: … -->`
 * spotlights a part of the editor while the step is shown.
 */
@customElement('editor-help-tool')
export class EditorHelpTool extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const entry = helpEntry.get();
    const onTour = entry?.path === ONBOARDING_PATH;

    return html`
      <div class="tabs" role="tablist">
        <button role="tab" class="tab ${onTour ? 'active' : ''}" aria-selected=${onTour} @click=${this._startTour}>
          <wa-icon library="lucide" name="compass"></wa-icon>${msg('Tour')}
        </button>
        <button role="tab" class="tab ${onTour ? '' : 'active'}" aria-selected=${!onTour} @click=${closeHelpDoc}>
          <wa-icon library="lucide" name="graduation-cap"></wa-icon>${msg('Tutorials')}
        </button>
        <span class="spacer"></span>
        ${helpLocales.length > 1 ? html`
          <select class="locale" aria-label=${msg('Language')} @change=${this._handleLocale}>
            ${helpLocales.map(l => html`<option value=${l} ?selected=${l === helpLocale.get()}>${l.toUpperCase()}</option>`)}
          </select>` : nothing}
      </div>
      ${entry ? this._renderPlayer(entry) : this._renderTutorialList()}
    `;
  }

  private _renderTutorialList()
  {
    const tutorials = helpTutorials.get();
    if (!tutorials) return html`<div class="body empty">${msg('Loading…')}</div>`;

    const tag = helpTutorialTag.get();
    const shown = tag === 'all' ? tutorials : tutorials.filter(t => helpTags(t.doc).includes(tag));

    return html`
      <div class="tags" role="tablist" aria-label=${msg('Tutorial topics')}>
        ${['all', ...HELP_TAGS].map(id => html`
          <button
            role="tab"
            class="tag ${id === tag ? 'active' : ''}"
            aria-selected=${id === tag}
            @click=${() => helpTutorialTag.set(id)}
          >${this._tagLabel(id)}</button>`)}
      </div>
      <div class="body list">
        ${shown.length ? shown.map(t => this._renderCard(t)) : html`<p class="empty">${msg('No tutorials on this topic yet.')}</p>`}
      </div>
    `;
  }

  private _renderCard(t: HelpEntry)
  {
    const thumbnail = t.doc.meta.thumbnail ? helpImageUrl(t, t.doc.meta.thumbnail) : null;

    return html`
      <button class="card" @click=${() => openHelpDoc(t.path)}>
        ${thumbnail ? html`<img class="thumbnail" src=${thumbnail} alt="" loading="lazy">` : nothing}
        <span class="card-body">
          <span class="card-title">${t.doc.meta.title ?? t.path}</span>
          ${t.doc.meta.description ? html`<span class="card-text">${t.doc.meta.description}</span>` : nothing}
          <span class="card-meta">
            ${helpTags(t.doc).map(tag => html`<span class="card-tag">${this._tagLabel(tag)}</span>`)}
          </span>
        </span>
      </button>`;
  }

  /** Display name of a tutorial tab; unknown tags show as written. */
  private _tagLabel(tag: string): string
  {
    const labels: Record<HelpTag | 'all', string> = {
      all:           msg('All'),
      beginner:      msg('Beginner'),
      advanced:      msg('Advanced'),
      practical:     msg('Practical'),
      modeling:      msg('Modeling'),
      documentation: msg('Documentation'),
      io:            msg('IO'),
      publishing:    msg('Publishing'),
    };
    return labels[tag as HelpTag] ?? tag;
  }

  private _renderPlayer(entry: HelpEntry)
  {
    const steps = entry.doc.steps;
    const index = helpStep.get();
    const step = helpCurrentStep.get();
    const last = index === steps.length - 1;
    const onTour = entry.path === ONBOARDING_PATH;

    return html`
      <div class="body player">
        <div class="kicker">
          <span>${onTour ? msg('Tour') : msg('Tutorial')} · ${entry.doc.meta.title ?? ''}</span>
          <span class="count">${index + 1} / ${steps.length}</span>
        </div>
        ${index === 0 ? this._renderBlocks(entry.doc.intro, entry, -1) : nothing}
        ${step ? html`
          <h3 class="step-title">${step.title}</h3>
          ${this._renderBlocks(step.blocks, entry, index)}` : nothing}
      </div>
      <div class="dots">
        ${steps.map((s, i) => html`
          <button
            class="dot ${i === index ? 'current' : i < index ? 'done' : ''}"
            title=${s.title}
            aria-label=${msg(str`Step ${i + 1}: ${s.title}`)}
            @click=${() => goToHelpStep(i)}
          ></button>`)}
      </div>
      <div class="footer">
        <wa-button size="small" appearance="outlined" ?disabled=${index === 0} @click=${() => goToHelpStep(index - 1)}>
          ${msg('Back')}
        </wa-button>
        <span class="spacer"></span>
        ${last
          ? html`<wa-button size="small" variant="brand" @click=${closeHelpDoc}>${onTour ? msg('Show tutorials') : msg('Finish')}</wa-button>`
          : html`<wa-button size="small" variant="brand" @click=${() => goToHelpStep(index + 1)}>${msg('Next')}</wa-button>`}
      </div>
    `;
  }

  private _renderBlocks(blocks: HelpBlock[], entry: HelpEntry, stepIndex: number)
  {
    return blocks.map((block, i) => block.kind === 'markdown'
      // Safe by construction: see utils/markdown.ts (raw HTML in the source is escaped;
      // relative images resolve only to files bundled next to the help markdown)
      ? html`<div class="markdown">${unsafeHTML(renderMarkdown(block.text, { resolveImage: src => helpImageUrl(entry, src) }))}</div>`
      : html`
        <div class="code">
          ${block.action ? html`
            <div class="code-bar">
              <button
                class="run"
                title=${msg('Put the tutorial code up to here in the editor and run it')}
                @click=${() => runHelpCode(codeAt(entry.doc, stepIndex, i) ?? block.code)}
              ><wa-icon library="lucide" name="play"></wa-icon>${msg('Run')}</button>
            </div>` : nothing}
          <pre><code>${block.code}</code></pre>
        </div>`);
  }

  // ── 2. State & Signals ──
  // helpEntry, helpStep, helpTutorials, helpCurrentStep, helpLocale (state/help.ts)

  private _spotlight = new Spotlight();

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    if (!helpTutorials.get()) void loadHelpTutorials();
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    this._spotlight.show([]);
  }

  override updated()
  {
    this._spotlight.show(helpCurrentStep.get()?.highlight ?? []);
    // A new step starts at its top, not where the previous one was scrolled to
    if (this._shownStep !== helpCurrentStep.get())
    {
      this._shownStep = helpCurrentStep.get();
      this.shadowRoot?.querySelector('.player')?.scrollTo({ top: 0 });
    }
  }

  // ── 4. Behaviour & Methods ──
  private _shownStep: unknown = null;

  private _startTour()
  {
    if (helpEntry.get()?.path !== ONBOARDING_PATH) void openHelpDoc(ONBOARDING_PATH);
  }

  private async _handleLocale(e: Event)
  {
    await setHelpLocale((e.target as HTMLSelectElement).value);
    void loadHelpTutorials();
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
    }

    *, *::before, *::after { box-sizing: inherit; }

    .tabs {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding: var(--space-xs) var(--space-sm);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      padding: var(--space-xs) var(--space-sm);
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text-muted);
      font: inherit;
      cursor: pointer;
    }
    .tab:hover { color: var(--color-text); }
    .tab.active {
      background: var(--color-primary-subtle);
      color: var(--color-primary);
    }
    .spacer { flex: 1; }
    .locale {
      font: inherit;
      font-size: var(--text-xs);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text);
    }

    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: var(--space-md);
    }
    .empty { color: var(--color-text-muted); }

    /* ── Tutorial list ── */
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      padding: var(--space-sm) var(--space-md) 0;
      flex-shrink: 0;
    }
    .tag {
      padding: 0 6px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--color-text-muted);
      font: inherit;
      font-size: var(--text-x-xs, 0.625rem);
      line-height: 1.6;
      cursor: pointer;
    }
    .tag:hover { color: var(--color-text); }
    .tag.active {
      border-color: var(--color-primary);
      background: var(--color-primary-subtle);
      color: var(--color-primary);
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
    }
    .card {
      display: flex;
      align-items: flex-start;
      gap: var(--space-sm);
      padding: var(--space-xs);
      overflow: hidden;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg);
      color: var(--color-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .card:hover { border-color: var(--color-primary); }
    /* Beside the text; the whole model shows, whatever the image's own proportions */
    .thumbnail {
      display: block;
      flex: 0 0 15%;
      max-width: 60px;
      aspect-ratio: 1;
      object-fit: contain;
      background: var(--color-bg-code, rgba(0, 0, 0, 0.04));
      border-radius: var(--radius-sm);
    }
    .card-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      line-height: 1.35;
    }
    .card-title { font-size: var(--text-sm); font-weight: 600; }
    .card-text { font-size: var(--text-xs); color: var(--color-text-muted); }
    .card-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px;
      color: var(--color-text-muted);
    }
    .card-tag {
      padding: 0 3px;
      font-size: var(--text-x-xs, 0.625rem);
      line-height: 1.5;
      border-radius: var(--radius-sm);
      background: var(--color-primary-subtle);
      color: var(--color-primary);
    }

    /* ── Player ── */
    .kicker {
      display: flex;
      justify-content: space-between;
      gap: var(--space-sm);
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
    }
    .count { flex-shrink: 0; }
    .step-title {
      margin: var(--space-sm) 0;
      font-size: var(--text-base);
      font-weight: 600;
    }

    .markdown {
      line-height: 1.6;
      overflow-wrap: break-word;
    }
    .markdown > :first-child { margin-top: 0; }
    .markdown p, .markdown ul, .markdown ol { margin: 0.6rem 0; }
    .markdown ul, .markdown ol { padding-left: 1.4rem; }
    .markdown a { color: var(--color-primary); }
    /* Images (screenshots, animations) sit in a 16:9 box the width of the panel.
       A portrait image is centred with space left and right instead of growing tall
       and pushing the text out of view. */
    .markdown img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: contain;
      background: var(--color-bg-code, rgba(0, 0, 0, 0.04));
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
    }
    .markdown code,
    .code pre {
      font-family: var(--font-mono, monospace);
      background: var(--color-bg-code, rgba(0, 0, 0, 0.06));
      border-radius: var(--radius-sm);
    }
    .markdown code { font-size: 0.9em; padding: 0.1rem 0.35rem; }

    .code {
      margin: 0.75rem 0;
    }
    .code pre {
      margin: 0;
      padding: var(--space-sm) var(--space-md);
      font-size: var(--text-xs);
      line-height: 1.5;
      /* Code must not wrap; it scrolls instead */
      overflow-x: auto;
    }
    .code-bar {
      display: flex;
      justify-content: flex-end;
    }
    .run {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 1px var(--space-sm);
      border: none;
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      background: var(--color-bg-code, rgba(0, 0, 0, 0.06));
      color: var(--color-primary);
      font: inherit;
      font-size: var(--text-xs);
      cursor: pointer;
    }
    .run:hover { background: var(--color-primary-subtle); }
    .code-bar + pre { border-top-right-radius: 0; }

    .footer {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      flex-shrink: 0;
    }
    .dots {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
      padding: var(--space-sm) var(--space-md) 0;
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .dot {
      width: 8px;
      height: 8px;
      padding: 0;
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-full);
      background: transparent;
      cursor: pointer;
    }
    .dot.done { background: color-mix(in srgb, var(--color-primary) 40%, transparent); }
    .dot.current { background: var(--color-primary); }
  `;
}

/**
 * Rings parts of the editor while a help step talks about them.
 *
 * The parts live in other components' shadow roots, so the ring is a fixed element
 * on document.body placed over each target's box, and it follows the target when
 * the layout changes. No dimming overlay: the help text sits beside the target and
 * must stay readable. Targets carry `data-help="<id>"` (HELP_TARGETS).
 */
class Spotlight
{
  private _targets: Element[] = [];
  private _rings: HTMLElement[] = [];
  private _ids = '';
  private _retry?: ReturnType<typeof setTimeout>;
  private _observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this._place());
  private _onLayout = () => this._place();

  /** Ring the targets with these ids; an empty list removes the rings. */
  show(ids: string[], attempt = 0): void
  {
    const key = ids.join(' ');
    if (key === this._ids && attempt === 0) return;
    this._ids = key;
    clearTimeout(this._retry);
    this._clear();
    if (!ids.length) return;

    const targets = ids
      .map(id => deepQuery(`[data-help="${id}"]`))
      .filter((el): el is Element => !!el && isVisible(el));

    // A target can still be rendering (a panel that just opened); look again shortly
    if (targets.length < ids.length && attempt < 10)
    {
      this._retry = setTimeout(() => this.show(ids, attempt + 1), 150);
      if (!targets.length) return;
    }

    this._targets = targets;
    this._rings = targets.map(() => createRing());
    targets.forEach(t => this._observer?.observe(t));
    window.addEventListener('resize', this._onLayout);
    window.addEventListener('scroll', this._onLayout, true);
    this._place();
  }

  private _place(): void
  {
    this._targets.forEach((target, i) =>
    {
      const r = target.getBoundingClientRect();
      Object.assign(this._rings[i].style, {
        left:   `${r.left - 4}px`,
        top:    `${r.top - 4}px`,
        width:  `${r.width + 8}px`,
        height: `${r.height + 8}px`,
      });
    });
  }

  private _clear(): void
  {
    this._observer?.disconnect();
    window.removeEventListener('resize', this._onLayout);
    window.removeEventListener('scroll', this._onLayout, true);
    this._rings.forEach(ring => ring.remove());
    this._rings = [];
    this._targets = [];
  }
}

/** A ring element on document.body; styled in code because it lives outside any shadow root. */
function createRing(): HTMLElement
{
  const ring = document.createElement('div');
  ring.className = 'archiyou-help-spotlight';
  ring.setAttribute('aria-hidden', 'true');
  Object.assign(ring.style, {
    position: 'fixed',
    zIndex: '900',
    pointerEvents: 'none',
    borderRadius: '8px',
    border: '2px solid var(--color-primary, #2447e6)',
    transition: 'left 0.2s, top 0.2s, width 0.2s, height 0.2s',
  });
  document.body.append(ring);

  const glow = (alpha: number) => `0 0 0 6px color-mix(in srgb, var(--color-primary, #2447e6) ${alpha}%, transparent)`;
  ring.animate([{ boxShadow: glow(35) }, { boxShadow: glow(5) }], { duration: 900, direction: 'alternate', iterations: Infinity });
  return ring;
}

/** First element matching `selector` anywhere in the document, including open shadow roots. */
function deepQuery(selector: string, root: Document | ShadowRoot = document): Element | null
{
  return root.querySelector(selector)
    ?? [...root.querySelectorAll('*')]
      .filter(el => el.shadowRoot)
      .reduce<Element | null>((found, host) => found ?? deepQuery(selector, host.shadowRoot!), null);
}

function isVisible(el: Element): boolean
{
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-help-tool': EditorHelpTool;
  }
}
