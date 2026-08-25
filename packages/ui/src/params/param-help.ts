/**
 * param-help — the little "?" affordance shown next to a parameter label in
 * `presentation` mode (the configurator). Renders nothing when the param has no
 * description, so callers can drop it in unconditionally.
 *
 * The tooltip anchor id is scoped to this component's shadow root, so many of
 * these can co-exist on a page without colliding.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

@customElement('param-help')
export class ParamHelp extends LitElement
{
  // ── 1. Render ──

  override render()
  {
    const text = this.text?.trim();
    this.toggleAttribute('hidden', !text);
    if (!text) return nothing;

    return html`
      <span id="anchor" class="anchor" tabindex="0" aria-label="Description">
        <wa-icon library="lucide" name="circle-help"></wa-icon>
      </span>
      <wa-tooltip for="anchor" placement=${this.placement}>${text}</wa-tooltip>
    `;
  }

  // ── 2. Properties ──

  @property({ type: String }) text = '';
  @property({ type: String }) placement: 'top' | 'right' | 'bottom' | 'left' = 'right';

  // ── 5. Styles ──

  static override styles = css`
    :host
    {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      line-height: 1;
    }

    :host([hidden]) { display: none; }

    .anchor
    {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: help;
      color: var(--color-text-muted, #888);
      font-size: var(--text-xs);
      opacity: 0.65;
      outline: none;
    }

    .anchor:hover,
    .anchor:focus-visible { opacity: 1; color: var(--color-primary); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'param-help': ParamHelp;
  }
}
