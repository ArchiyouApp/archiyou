/**
 * bottom-sheet — a panel that slides up from the bottom of its (positioned)
 * parent and rests at a few heights ("detents"). The configurator puts its
 * parameters in one on phones; the editor opens its tool panels in one.
 *
 *   <bottom-sheet detents="peek half full">
 *     <div slot="header">always visible, also the drag handle</div>
 *     …scrolling content…
 *   </bottom-sheet>
 *
 * Detents: `peek` shows only the header (height --sheet-peek), `half` is half
 * the parent, `full` leaves --sheet-top-gap of the parent visible above it.
 * Drag the header or grab bar to resize; on release it settles on the nearest
 * detent, or the next one in the direction of a flick. A tap cycles through
 * them. With `dismissible`, dragging below the lowest detent fires
 * `sheet-dismiss`.
 *
 * `docked` turns all of that off: the sheet becomes a plain column (header on
 * top, content scrolling below), which is how the configurator shows the same
 * element as its sidebar on wide screens. Switching between the two never
 * re-creates the slotted content.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

export type SheetDetent = 'peek' | 'half' | 'full';

/** Pointer travel (px) before a press on the header counts as a drag, not a tap. */
const DRAG_SLOP_PX = 6;
/** Release speed (px/ms) above which the sheet goes with the flick instead of the nearest detent. */
const FLICK_SPEED = 0.4;
/** Slotted controls in the header keep their own taps. */
const INTERACTIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']);

@localized()
@customElement('bottom-sheet')
export class BottomSheet extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="grab"
          @pointerdown=${this._onPointerDown}
          @pointermove=${this._onPointerMove}
          @pointerup=${this._onPointerUp}
          @pointercancel=${this._onPointerUp}>
        <button class="handle"
            aria-label=${msg('Resize panel')}
            aria-expanded=${this.detent !== this._detents()[0]}
            @click=${this._onHandleClick}></button>
        <slot name="header"></slot>
      </div>
      <div class="body" ?inert=${!this.docked && this.detent === 'peek'}>
        <slot></slot>
      </div>
    `;
  }

  // ── 2. State & Properties ──

  /** Space-separated detents the sheet can rest at, lowest first. */
  @property() detents = 'peek half full';

  /** The detent the sheet rests at now. */
  @property({ reflect: true }) detent: SheetDetent = 'peek';

  /** Plain column instead of a sheet (wide screens). */
  @property({ type: Boolean, reflect: true }) docked = false;

  /** Dragging below the lowest detent fires `sheet-dismiss`. */
  @property({ type: Boolean }) dismissible = false;

  private _press: { id: number; startY: number; startHeight: number; dragging: boolean } | null = null;
  private _samples: { y: number; t: number }[] = [];

  // ── 4. Behaviour & Methods ──

  private _detents(): SheetDetent[]
  {
    return this.detents.split(/\s+/).filter(Boolean) as SheetDetent[];
  }

  /** Pixel height of each detent, measured from the parent and the CSS tokens. */
  private _heightOf(detent: SheetDetent): number
  {
    const parentHeight = this.offsetParent?.clientHeight ?? window.innerHeight;
    const style = getComputedStyle(this);
    if (detent === 'peek') return parseFloat(style.getPropertyValue('--sheet-peek')) || 64;
    if (detent === 'half') return parentHeight / 2;
    return parentHeight - (parseFloat(style.getPropertyValue('--sheet-top-gap')) || 48);
  }

  private _setDetent(detent: SheetDetent)
  {
    this.detent = detent;
    this.dispatchEvent(new CustomEvent('sheet-change', {
      detail: { detent },
      bubbles: true,
      composed: true,
    }));
  }

  /** Tap: next detent up, and from the top back to the lowest. */
  private _cycle()
  {
    const detents = this._detents();
    const i = detents.indexOf(this.detent);
    this._setDetent(detents[(i + 1) % detents.length]);
  }

  /** Keyboard only (detail 0): pointer taps are already handled by the press. */
  private _onHandleClick(e: MouseEvent)
  {
    if (e.detail === 0) this._cycle();
  }

  private _onPointerDown(e: PointerEvent)
  {
    if (this.docked || e.button !== 0) return;
    const interactive = e.composedPath().some(el =>
      el instanceof HTMLElement && el !== e.currentTarget && INTERACTIVE.has(el.tagName) && !el.classList.contains('handle'));
    if (interactive) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this._press = { id: e.pointerId, startY: e.clientY, startHeight: this.getBoundingClientRect().height, dragging: false };
    this._samples = [{ y: e.clientY, t: e.timeStamp }];
  }

  private _onPointerMove(e: PointerEvent)
  {
    const press = this._press;
    if (!press || e.pointerId !== press.id) return;

    const dy = e.clientY - press.startY;
    if (!press.dragging && Math.abs(dy) < DRAG_SLOP_PX) return;
    if (!press.dragging)
    {
      press.dragging = true;
      this.toggleAttribute('dragging', true);
    }

    const max = this._heightOf('full');
    const height = Math.min(max, Math.max(0, press.startHeight - dy));
    this.style.setProperty('--drag-height', `${height}px`);

    this._samples = [...this._samples, { y: e.clientY, t: e.timeStamp }].filter(s => e.timeStamp - s.t < 100);
  }

  private _onPointerUp(e: PointerEvent)
  {
    const press = this._press;
    if (!press || e.pointerId !== press.id) return;
    this._press = null;

    if (!press.dragging)
    {
      if (e.type === 'pointerup') this._cycle();
      return;
    }

    const height = this.getBoundingClientRect().height;
    this.removeAttribute('dragging');
    this.style.removeProperty('--drag-height');

    const first = this._samples[0];
    const speed = first && e.timeStamp > first.t ? (first.y - e.clientY) / (e.timeStamp - first.t) : 0; // > 0 = up
    const detents = this._detents();
    const heights = detents.map(d => this._heightOf(d));

    if (this.dismissible && (height < heights[0] * 0.6 || (speed < -FLICK_SPEED && height < heights[0])))
    {
      this.dispatchEvent(new CustomEvent('sheet-dismiss', { bubbles: true, composed: true }));
      return;
    }

    const nearest = heights.reduce((best, h, i) => Math.abs(h - height) < Math.abs(heights[best] - height) ? i : best, 0);
    const flicked = speed > FLICK_SPEED
      ? heights.findIndex(h => h > height + 1)
      : speed < -FLICK_SPEED
        ? heights.reduce((found, h, i) => h < height - 1 ? i : found, -1)
        : -1;

    this._setDetent(detents[flicked >= 0 ? flicked : nearest]);
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      --sheet-peek: 64px;
      --sheet-top-gap: 48px;

      position: absolute;
      inset-inline: 0;
      bottom: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: var(--sheet-peek);
      overflow: hidden;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      background: var(--color-bg-elevated);
      box-shadow: 0 -4px 20px rgb(0 0 0 / 0.14);
      transition: height 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    :host([detent="half"])  { height: 50%; }
    :host([detent="full"])  { height: calc(100% - var(--sheet-top-gap)); }
    :host([dragging])       { height: var(--drag-height); transition: none; }

    :host([docked])
    {
      position: static;
      height: auto;
      min-height: 0;
      border-radius: 0;
      box-shadow: none;
      transition: none;
    }

    .grab
    {
      position: relative;
      flex-shrink: 0;
      touch-action: none;
      cursor: grab;
      user-select: none;
    }

    :host([dragging]) .grab { cursor: grabbing; }
    :host([docked]) .grab   { touch-action: auto; cursor: auto; user-select: auto; }

    /* A thin bar on the top edge; the button around it is the keyboard way in. */
    .handle
    {
      position: absolute;
      top: 0;
      left: 50%;
      z-index: 1;
      translate: -50% 0;
      width: 64px;
      height: 16px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: inherit;
    }

    .handle::before
    {
      content: '';
      position: absolute;
      top: 6px;
      left: 50%;
      translate: -50% 0;
      width: 36px;
      height: 4px;
      border-radius: var(--radius-full);
      background: var(--color-border);
    }

    .handle:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; border-radius: var(--radius-sm); }

    :host([docked]) .handle { display: none; }

    .body
    {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'bottom-sheet': BottomSheet;
  }
}
