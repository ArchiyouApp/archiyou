import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/popover/popover.js';

import './configurator-metric-card.js';
import './configurator-download-menu.js';

import { editorScript, executing as scriptExecuting, executionResult } from '@archiyou/editor/src/state/workspace';
import type { Metric } from '@archiyou/core/src/calc/types';

@customElement('configurator-metric-bar')
export class ConfiguratorMetricBar extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const metrics = this._collectMetrics();
    const executing = scriptExecuting.get();

    return html`
      <div class="bar">
        ${this._hasOverflow ? html`
          <button class="nav-btn prev" title="Scroll left" @click=${this._scrollPrev}>
            <wa-icon library="lucide" name="chevron-left"></wa-icon>
          </button>
        ` : ''}

        <div class="scroll-area">
          ${metrics.length === 0
            ? executing
              ? html`<span class="empty"><wa-spinner style="font-size:0.9em"></wa-spinner></span>`
              : ''
            : metrics.map(m => html`
                <configurator-metric-card .metric=${m}></configurator-metric-card>
              `)
          }
        </div>

        ${this._hasOverflow ? html`
          <button class="nav-btn next" title="Scroll right" @click=${this._scrollNext}>
            <wa-icon library="lucide" name="chevron-right"></wa-icon>
          </button>
        ` : ''}

        ${this._hasDownloads() ? html`
          <div class="download-wrap">
            <button id="download-btn" class="download-btn" title="Download">
              <wa-icon library="lucide" name="download"></wa-icon>
              <span>Download</span>
              <wa-icon class="download-caret" library="lucide" name="chevron-down"></wa-icon>
            </button>
          </div>
        ` : nothing}
      </div>

      <!-- The export options themselves. A popover rather than a panel inside the
           bar: it renders in a fixed layer, so this component keeps its own fixed
           height and clipping, and Web Awesome handles anchoring, outside-click and
           Escape. -->
      ${this._hasDownloads() ? html`
        <wa-popover
          class="download-popover"
          for="download-btn"
          placement="top-end"
          distance="10"
          without-arrow
          @wa-after-hide=${this._resetDownloadMenu}
        >
          <configurator-download-menu ?preview=${this.preview}></configurator-download-menu>
        </wa-popover>
      ` : nothing}
    `;
  }

  // ── 2. State & Properties ──

  /** True inside the editor's Configurator Preview — passed to the download menu,
   *  which then stands in the publish defaults for a not-yet-published script. */
  @property({ type: Boolean, reflect: true }) preview = false;

  @state() private _hasOverflow = false;
  private _resizeObserver: ResizeObserver | null = null;

  // ── 3. Lifecycle ──
  override disconnectedCallback()
  {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
  }

  override firstUpdated()
  {
    const area = this._scrollArea();
    if (area)
    {
      this._resizeObserver = new ResizeObserver(() => this._checkOverflow());
      this._resizeObserver.observe(area);
      area.addEventListener('scroll', () => this._checkOverflow(), { passive: true });
    }
    this._checkOverflow();
  }

  override updated(_changed: Map<string, unknown>)
  {
    requestAnimationFrame(() => this._checkOverflow());
  }

  // ── 4. Behaviour & Methods ──
  private _collectMetrics(): Metric[]
  {
    const outputs = executionResult.get()?.outputs ?? [];
    const metrics: Metric[] = [];

    outputs
      .filter(o => o.path.category === 'metrics')
      .forEach(o =>
      {
        const raw = o.output;
        if (Array.isArray(raw))
        {
          metrics.push(...(raw as Metric[]));
        }
        else if (raw && typeof raw === 'object')
        {
          metrics.push(...(Object.values(raw) as Metric[]));
        }
      });

    return metrics;
  }

  private _scrollArea(): HTMLElement | null
  {
    return this.renderRoot.querySelector<HTMLElement>('.scroll-area');
  }

  private _scrollPrev()
  {
    this._scrollArea()?.scrollBy({ left: -200, behavior: 'smooth' });
  }

  private _scrollNext()
  {
    this._scrollArea()?.scrollBy({ left: 200, behavior: 'smooth' });
  }

  private _checkOverflow()
  {
    const area = this._scrollArea();
    if (area)
    {
      this._hasOverflow = area.scrollWidth > area.clientWidth;
    }
  }

  /** Closing the menu clears the last run's error/tick, so it reopens clean. Only the
   *  popover's own hide counts — Web Awesome overlays inside it bubble the same
   *  composed event. */
  private _resetDownloadMenu(e: Event)
  {
    if (e.target !== e.currentTarget) return;
    this.renderRoot.querySelector('configurator-download-menu')?.reset();
  }

  /** Is there anything to download? A published configurator that offers no
   *  fulfillments gets no Download button at all rather than one that opens an empty
   *  list; in the preview the button always stands, since that is where an author
   *  goes to see what they are about to offer. */
  private _hasDownloads(): boolean
  {
    return this.preview || (editorScript.get()?.published?.fulfillments?.length ?? 0) > 0;
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: block;
      /* Fixed, self-contained height so the bar stays a constant size and
         never scales with the split-panel divider or its own contents. */
      height: 80px;
      flex: 0 0 80px;
      box-sizing: border-box;
      overflow: hidden;
      border-top: 1px solid var(--color-border);
      background: var(--color-bg-elevated);
    }

    .bar
    {
      display: flex;
      align-items: stretch;
      height: 100%;
    }

    .scroll-area
    {
      display: flex;
      flex: 1;
      overflow-x: hidden;
      scroll-behavior: smooth;
      align-items: stretch;
    }

    .nav-btn
    {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      padding: 0;
      border: none;
      background: var(--color-bg);
      color: var(--color-text-muted, #888);
      cursor: pointer;
      font-size: var(--text-sm);
    }

    .nav-btn.prev
    {
      border-right: 1px solid var(--color-border);
    }

    .nav-btn.next
    {
      border-left: 1px solid var(--color-border);
    }

    .nav-btn:hover
    {
      background: color-mix(in srgb, var(--color-border) 30%, transparent);
      color: var(--color-text);
    }

    .download-wrap
    {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      padding: 0 var(--space-md);
      border-left: 1px solid var(--color-border);
    }

    .download-btn
    {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding: var(--space-sm) var(--space-md);
      border: none;
      border-radius: var(--radius-md, 8px);
      background: var(--color-primary);
      color: var(--color-white, #fff);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 600;
      white-space: nowrap;
    }

    .download-btn:hover
    {
      background: color-mix(in srgb, var(--color-black, #000) 12%, var(--color-primary));
    }

    .download-caret
    {
      margin-left: var(--space-xs);
      font-size: var(--text-xs);
      opacity: 0.85;
    }

    /* The menu draws its own header/rows edge to edge, so the popover contributes
       only the frame around it. */
    .download-popover
    {
      --max-width: 26rem;
    }

    .download-popover::part(body)
    {
      padding: 0;
      overflow: hidden;
      border-color: var(--color-border);
      border-radius: var(--radius-md, 8px);
      background: var(--color-bg-elevated, #fff);
      user-select: auto;
    }

    .empty
    {
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text-muted, #888);
      font-style: italic;
      white-space: nowrap;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-metric-bar': ConfiguratorMetricBar;
  }
}
