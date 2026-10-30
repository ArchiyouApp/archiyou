/**
 * <configurator-action-button> — one of the round buttons over the configurator viewer
 * (configurator-viewer-actions): an icon in a circle that widens to show its label when
 * pointed at or focused, so a row of them stays small over the model.
 *
 * A link with `href` (opens in `target`), else a button whose click reaches the host.
 * `active` keeps it open (its panel is showing); `expanded` always shows the label, for a
 * lone call to action such as "Publish as configurator"; `primary` fills it with the brand
 * colour. The label is always in the DOM, only clipped: it is the accessible name, also
 * while the button is a circle.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

@customElement('configurator-action-button')
export class ConfiguratorActionButton extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    const content = html`
      <wa-icon library="lucide" name=${this.icon}></wa-icon>
      <span class="label"><span>${this.label}</span></span>
    `;
    return this.href
      ? html`<a class="btn" part="button" href=${this.href} target=${this.target || nothing}
          rel=${this.target === '_blank' ? 'noopener' : nothing} title=${this.hint || nothing}>${content}</a>`
      : html`<button class="btn" part="button" type="button" title=${this.hint || nothing}
          aria-pressed=${this.toggle ? String(this.active) : nothing}>${content}</button>`;
  }

  // ── 2. State & Properties ──
  /** Lucide icon name. */
  @property() icon = '';
  @property() label = '';
  /** Tooltip: what the button does, in a few more words than its label. */
  @property() hint = '';
  @property() href = '';
  @property() target = '';
  /** Opens and closes something (aria-pressed follows `active`). */
  @property({ type: Boolean }) toggle = false;
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: Boolean, reflect: true }) expanded = false;
  @property({ type: Boolean, reflect: true }) primary = false;

  // ── 5. Styles ──
  static override styles = css`
    :host { display: inline-flex; }

    .btn
    {
      --size: 32px;
      display: inline-grid;
      /* the label column opens from 0fr to 1fr: the width follows the text, animated */
      grid-template-columns: var(--size) 0fr;
      align-items: center;
      height: var(--size);
      min-width: var(--size);
      padding: 0;
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
      transition: grid-template-columns 220ms ease, border-color 120ms, color 120ms, background 120ms;
    }

    wa-icon { justify-self: center; font-size: 14px; }

    .label { overflow: hidden; }

    .label > span
    {
      display: block;
      padding-right: 12px;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 160ms ease;
    }

    :host([active]) .btn,
    :host([expanded]) .btn,
    .btn:focus-visible
    {
      grid-template-columns: var(--size) 1fr;
    }

    :host([active]) .label > span,
    :host([expanded]) .label > span,
    .btn:focus-visible .label > span
    {
      opacity: 1;
    }

    /* Only where there is a pointer to hover with: a tap goes straight to the action */
    @media (hover: hover)
    {
      .btn:hover { grid-template-columns: var(--size) 1fr; }
      .btn:hover .label > span { opacity: 1; }
    }

    .btn:hover,
    .btn:focus-visible,
    :host([active]) .btn
    {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

    :host([primary]) .btn
    {
      --size: 34px;
      border-color: var(--color-primary);
      background: var(--color-primary);
      color: var(--color-on-primary, #fff);
      font-size: var(--text-sm);
      font-weight: 600;
    }

    :host([primary]) .btn:hover
    {
      background: color-mix(in srgb, var(--color-black, #000) 12%, var(--color-primary));
      color: var(--color-on-primary, #fff);
    }

    @media (prefers-reduced-motion: reduce)
    {
      .btn, .label > span { transition: none; }
    }

    /* A finger needs a bigger target than a pointer */
    @media (pointer: coarse)
    {
      .btn { --size: var(--hit-min, 44px); }
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-action-button': ConfiguratorActionButton;
  }
}
