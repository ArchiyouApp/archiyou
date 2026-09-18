import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { capCentreShiftPx } from '../cap-centring.js';

export interface OverlayLabel
{
  id: string;
  text: string;
  variant: 'label' | 'dimension';
  class?: string;
  /** The box the text sits in. Default 'circle' for a label, 'rect' for a dimension value —
   *  which has no box of its own to speak of, only a knockout behind the digits. */
  shape?: 'circle' | 'rect';
  /** What marks the anchor end of the leader. Default 'none'. */
  target?: 'circle' | 'arrow' | 'none';
  /** Just the label: no leader, no marker, sitting on the anchor. Default false here — the
   *  page defaults the other way, see AnnotatorLabel's header for why. */
  labelOnly?: boolean;
  // Optional CSS leader (screen space). 90deg = straight up on screen.
  line?: boolean;     // leader shown unless explicitly false (default true)
  length?: number;    // leader length in screen px
  offset?: number;    // DEPRECATED: `length`
  angle?: number;     // leader angle in deg (0 = +x, 90 = straight up)
  circle?: boolean;   // DEPRECATED: `target: 'circle'`
  /** When set, clicking the label turns it into an inline editor that
   *  fires `dim-param-change` with `{ param, value }` on commit. */
  param?: string;
  /** Source of the optional remap function of `.param(name, remap)`, passed on in
   *  the commit event; the host rebuilds and applies it. */
  paramRemapSrc?: string;
  interactive?: boolean;
  rawValue?: number | string;
}

/** Event payload fired when a bound dimension's value is edited and
 *  committed (Enter / debounced typing / blur). The host re-validates
 *  against the parameter schema before applying. */
export interface DimensionParamChangeDetail
{
  param: string;
  value: string;
  /** Source of the script's remap function, when the dimension was bound with one. */
  remapSrc?: string;
}

export interface OverlayLabelPos
{
  x: number;       // screen px (projected anchor)
  y: number;       // screen px
  visible: boolean;
}

const DEFAULT_LEN = 40;
const DEFAULT_ANGLE = 90;

/**
 * HTML/CSS overlay for annotations (shape labels + dimension value text),
 * layered on top of the 3D viewer canvas.
 *
 * `labels` is set once per model load (Lit renders the nodes then). Per-frame
 * anchor screen positions are pushed imperatively via `setPositions()` — no
 * Lit re-render in the render loop. Leader geometry (length/angle) is
 * screen-space and static per label, computed once at render.
 *
 * Everything is easy to restyle via CSS:
 *   - classes: `.ay-label`, `.ay-label--label`, `.ay-label--dimension`, `.ay-leader`, `.ay-circle`,
 *     plus any per-label class passed from the script
 *   - shadow parts: `::part(label)`, `::part(leader)`, `::part(circle)`
 *   - CSS custom properties (see `:host` defaults below), e.g.
 *     `viewer-labels-overlay { --ay-label-bg:#000; --ay-leader-color:red }`
 */
/** Debounce delay (ms) for typed value commits — long enough to let the user
 *  finish typing a multi-digit number but short enough to feel live. */
const EDIT_DEBOUNCE_MS = 400;

@customElement('viewer-labels-overlay')
export class ViewerLabelsOverlay extends LitElement
{
  @property({ attribute: false }) labels: OverlayLabel[] = [];

  private _nodes = new Map<string, HTMLElement>();
  /** ID of the label currently in edit mode (only one at a time). */
  @property({ attribute: false }) private _editingId: string | null = null;
  /** Per-label debounce timers so typing only commits after a pause. */
  private _editTimers = new Map<string, ReturnType<typeof setTimeout>>();

  override render()
  {
    return html`
      ${repeat(this.labels, (l) => l.id, (l) =>
      {
        // Dimension values sit right on the anchor: never offset, never a leader
        const hasLeader = l.variant !== 'dimension' && l.line !== false && l.labelOnly !== true;
        const len = hasLeader ? (l.length ?? l.offset ?? DEFAULT_LEN) : 0;
        const shape = l.shape ?? (l.variant === 'dimension' ? 'rect' : 'circle');
        const target = l.target ?? (l.circle ? 'circle' : 'none');
        const angle = l.angle ?? DEFAULT_ANGLE;
        const rad = (angle * Math.PI) / 180;
        const dx = Math.cos(rad) * len;
        const dy = -Math.sin(rad) * len;            // screen Y is down
        const phi = (Math.atan2(dy, dx) * 180) / Math.PI; // leader rotation

        const editing = l.interactive && this._editingId === l.id;
        const interactive = !!l.interactive && !!l.param;
        const initialValue = String(l.rawValue ?? l.text);

        return html`
          <div class="ay-anchor" data-id=${l.id}>
            ${hasLeader ? html`
              <div class="ay-leader" part="leader"
                   style="width:${len}px;transform:rotate(${phi}deg)">
                ${target === 'circle' ? html`<span class="ay-circle" part="circle"></span>` : ''}
                ${target === 'arrow' ? html`<span class="ay-arrow" part="arrow"></span>` : ''}
              </div>` : ''}
            ${editing ? html`
              <input
                class="ay-label ay-label--${l.variant} ay-label--editing ${l.class ?? ''}"
                part="label"
                type="text"
                .value=${initialValue}
                style="left:${dx}px;top:${dy}px"
                @click=${(e: Event) => e.stopPropagation()}
                @input=${(e: Event) => this._onEditInput(l, e)}
                @keydown=${(e: KeyboardEvent) => this._onEditKey(l, e)}
                @blur=${(e: Event) => this._onEditBlur(l, e)}
              />
            ` : html`
              <div
                class="ay-label ay-label--${l.variant} ay-label--${shape} ${interactive ? 'ay-label--interactive' : ''} ${l.class ?? ''}"
                part="label"
                style="left:${dx}px;top:${dy}px"
                @click=${interactive ? (e: Event) => this._onLabelClick(l, e) : null}
              ><span class="ay-label-text">${l.text}</span></div>
            `}
          </div>`;
      })}
    `;
  }

  private _onLabelClick(l: OverlayLabel, e: Event)
  {
    e.stopPropagation();
    this._editingId = l.id;
    // After Lit renders the input, focus + select all so typing replaces the value.
    this.updateComplete.then(() =>
    {
      const input = this.renderRoot
        .querySelector<HTMLInputElement>(`.ay-anchor[data-id="${l.id}"] input.ay-label--editing`);
      input?.focus();
      input?.select();
    });
  }

  private _onEditInput(l: OverlayLabel, e: Event)
  {
    const value = (e.target as HTMLInputElement).value;
    // Debounced commit so each keystroke doesn't trigger a re-execute.
    this._clearEditTimer(l.id);
    this._editTimers.set(l.id, setTimeout(() =>
    {
      this._commitEdit(l, value, /* keepEditing */ true);
    }, EDIT_DEBOUNCE_MS));
  }

  private _onEditKey(l: OverlayLabel, e: KeyboardEvent)
  {
    e.stopPropagation();
    if (e.key === 'Enter')
    {
      e.preventDefault();
      this._clearEditTimer(l.id);
      const value = (e.target as HTMLInputElement).value;
      this._commitEdit(l, value, /* keepEditing */ false);
    }
    else if (e.key === 'Escape')
    {
      e.preventDefault();
      this._clearEditTimer(l.id);
      this._editingId = null;
    }
  }

  private _onEditBlur(l: OverlayLabel, e: Event)
  {
    this._clearEditTimer(l.id);
    const value = (e.target as HTMLInputElement).value;
    this._commitEdit(l, value, /* keepEditing */ false);
  }

  private _commitEdit(l: OverlayLabel, value: string, keepEditing: boolean)
  {
    if (!l.param) return;
    // Schema validation happens in the host (model-viewer), which knows the
    // current script params. We just emit; the host silently drops invalid.
    this.dispatchEvent(new CustomEvent<DimensionParamChangeDetail>('dim-param-change', {
      detail: { param: l.param, value, remapSrc: l.paramRemapSrc },
      bubbles: true,
      composed: true,
    }));
    if (!keepEditing) this._editingId = null;
  }

  private _clearEditTimer(id: string)
  {
    const t = this._editTimers.get(id);
    if (t)
    {
      clearTimeout(t);
      this._editTimers.delete(id);
    }
  }

  override updated()
  {
    this._nodes.clear();
    this.renderRoot.querySelectorAll<HTMLElement>('.ay-anchor').forEach((el) =>
    {
      const id = el.dataset['id'];
      if (id) this._nodes.set(id, el);
    });

    this._syncCapCentring();
  }

  /** Put the measured cap-band shift where the stylesheet can reach it.
   *
   *  Measured off a real label rather than assumed, because where the browser puts a baseline
   *  inside a line box is not a fixed fraction of the font size — see cap-centring.ts. Cached
   *  per font there, so this costs nothing on a re-render.
   */
  private _syncCapCentring(): void
  {
    const label = this.renderRoot.querySelector<HTMLElement>('.ay-label');
    if (!label) return;

    this.style.setProperty('--ay-cap-shift', `${capCentreShiftPx(label).toFixed(3)}px`);
  }

  /** Imperatively position label anchors each frame (from the viewer loop). */
  setPositions(positions: Record<string, OverlayLabelPos>): void
  {
    for (const [id, el] of this._nodes)
    {
      const p = positions[id];
      if (!p || !p.visible)
      {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
  }

  static override styles = css`
    :host {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 5; /* above canvas (0), below viewer-menu (10) */

      /* ── Theming knobs (override on the element) ── */
      --ay-label-bg: var(--color-bg, #fff);
      --ay-label-color: var(--color-text, #1e293b);
      --ay-label-border-color: var(--color-border, #cbd5e1);
      --ay-label-border: 1px solid var(--ay-label-border-color);
      --ay-label-radius: var(--radius-sm, 4px);
      --ay-label-padding: var(--space-xs, 4px) var(--space-sm, 8px);
      --ay-label-font-size: var(--text-xs, 0.75rem);
      --ay-label-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

      --ay-dim-bg: var(--color-bg, #fff);
      --ay-dim-color: var(--color-text, #1e293b);
      /* Dimension values read smaller than shape labels — they sit on the
         drawing itself, so keep them unobtrusive. */
      --ay-dim-font-size: 0.625rem;

      /* Leader line — its own style, matches the label border color */
      --ay-leader-color: var(--ay-label-border-color);
      --ay-leader-width: 1px;

      /* Marker at the anchor end: a dot, or an arrowhead pointing back down the leader */
      --ay-circle-size: 8px;
      --ay-circle-bg: var(--ay-label-border-color);
      --ay-circle-border-color: var(--ay-label-border-color);
      --ay-arrow-size: 9px;
      --ay-arrow-color: var(--ay-label-border-color);

      /* A circled label is sized off its text, never smaller than this */
      --ay-label-circle-size: 1.9em;
    }

    /* 0-size anchor positioned at the projected screen point */
    .ay-anchor {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      will-change: transform;
    }

    /*  Optical centring: the cap band goes in the middle of the badge, not the line box.
        The shift is measured — see cap-centring.ts for why it cannot be a constant — and
        pushed in as a variable by _syncCapCentring(). */
    .ay-label-text {
      display: block;
      transform: translateY(var(--ay-cap-shift, 0px));
    }

    .ay-label {
      position: absolute;
      transform: translate(-50%, -50%);
      white-space: nowrap;
      font-family: var(--font-sans, sans-serif);
      font-size: var(--ay-label-font-size);
      line-height: 1.2;
      color: var(--ay-label-color);
      background: var(--ay-label-bg);
      border: var(--ay-label-border);
      padding: var(--ay-label-padding);
      box-shadow: var(--ay-label-shadow);
      user-select: none;
    }

    /* Square corners. The rounded box the labels used to have is gone: it read as a tooltip
       rather than as a drawing annotation, and it has no counterpart on the printed page. */
    .ay-label--rect {
      border-radius: 0;
    }

    /* The circled letter a manual numbers its parts with. aspect-ratio keeps it round as the
       text grows past the minimum, rather than letting it stretch into a pill. */
    .ay-label--circle {
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      min-width: var(--ay-label-circle-size);
      min-height: var(--ay-label-circle-size);
      aspect-ratio: 1;
      padding: 0 0.35em;
      border-radius: 50%;
    }

    /* Dimension value text — background matches the viewer, no shadow */
    .ay-label--dimension {
      font-size: var(--ay-dim-font-size);
      color: var(--ay-dim-color);
      background: var(--ay-dim-bg);
      border: none;
      box-shadow: none;
      font-variant-numeric: tabular-nums;
    }

    /* Bound-to-param dimensions: clickable, accept pointer events even though
       the overlay host swallows them by default. */
    .ay-label--interactive {
      pointer-events: auto;
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
    }
    .ay-label--interactive:hover {
      background: color-mix(in srgb, var(--ay-label-bg) 70%, var(--ay-label-color) 30%);
    }

    /* Inline editor for interactive dimensions */
    .ay-label--editing {
      pointer-events: auto;
      cursor: text;
      font: inherit;
      font-family: var(--font-sans, sans-serif);
      font-size: var(--ay-label-font-size);
      color: var(--ay-dim-color);
      background: var(--ay-label-bg);
      border: 1px solid var(--ay-label-border-color);
      border-radius: var(--ay-label-radius);
      padding: var(--ay-label-padding);
      outline: none;
      width: 6ch;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .ay-label--editing:focus {
      border-color: var(--ay-label-color);
    }
    /* Editing a dimension keeps the (smaller) dimension text size */
    .ay-label--dimension.ay-label--editing {
      font-size: var(--ay-dim-font-size);
    }

    /* Leader line from the anchor to the label box */
    .ay-leader {
      position: absolute;
      top: 0;
      left: 0;
      height: var(--ay-leader-width);
      background: var(--ay-leader-color);
      transform-origin: 0 50%;
    }

    /* Arrowhead at the anchor end, pointing back down the leader at the shape. The leader is
       already rotated, so this only ever points along its own -x. */
    .ay-arrow {
      position: absolute;
      left: 0;
      top: 50%;
      width: 0;
      height: 0;
      border-top: calc(var(--ay-arrow-size) / 2) solid transparent;
      border-bottom: calc(var(--ay-arrow-size) / 2) solid transparent;
      border-right: var(--ay-arrow-size) solid var(--ay-arrow-color);
      transform: translate(0, -50%);
    }

    /* Circle marker at the anchor end of the leader (points at the shape) */
    .ay-circle {
      position: absolute;
      left: 0;
      top: 50%;
      width: var(--ay-circle-size);
      height: var(--ay-circle-size);
      box-sizing: border-box;
      border-radius: 50%;
      background: var(--ay-circle-bg);
      border: 1px solid var(--ay-circle-border-color);
      transform: translate(-50%, -50%);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'viewer-labels-overlay': ViewerLabelsOverlay;
  }
}
