import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

export interface HandleOverlay
{
  id: string;
  icon: string;
  visible: boolean;
  param: string | null;
  paramFnSrc: string | null;
  paramsFnSrc: string | null;
}

export interface HandleOverlayPos
{
  x: number;       // screen px (projected anchor)
  y: number;       // screen px
  visible: boolean;
}

export interface HandleDragEventDetail
{
  id: string;
  pointerEvent: PointerEvent;
}

/**
 * HTML/CSS overlay for script-authored interaction handles, layered on top of
 * the 3D viewer canvas.
 *
 * `handles` is set once per model load (Lit renders the nodes). Per-frame
 * positions are pushed imperatively via `setPositions()` — no Lit re-render in
 * the render loop. Drag events bubble through CustomEvent so model-viewer can
 * wire up raycasting and re-execution.
 */
@customElement('viewer-handles-overlay')
export class ViewerHandlesOverlay extends LitElement
{
  @property({ attribute: false }) handles: HandleOverlay[] = [];

  private _nodes = new Map<string, HTMLElement>();
  @property({ attribute: false }) private _draggingId: string | null = null;

  override render()
  {
    return html`
      ${repeat(this.handles, (h) => h.id, (h) =>
      {
        const dragging = this._draggingId === h.id;
        return html`
          <div
            class="ay-handle-anchor"
            data-id=${h.id}
          >
            <div
              class="ay-handle ${dragging ? 'ay-handle--dragging' : ''}"
              part="handle"
              @pointerdown=${(e: PointerEvent) => this._onPointerDown(h, e)}
            >
              <wa-icon library="lucide" name=${h.icon}></wa-icon>
            </div>
          </div>
        `;
      })}
    `;
  }

  private _onPointerDown(h: HandleOverlay, e: PointerEvent)
  {
    e.stopPropagation();
    e.preventDefault();
    this._draggingId = h.id;

    const onMove = (ev: PointerEvent) =>
    {
      this.dispatchEvent(new CustomEvent<HandleDragEventDetail>('handle-drag-move', {
        bubbles: true, composed: true,
        detail: { id: h.id, pointerEvent: ev },
      }));
    };

    const onUp = (ev: PointerEvent) =>
    {
      this._draggingId = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.dispatchEvent(new CustomEvent<HandleDragEventDetail>('handle-drag-end', {
        bubbles: true, composed: true,
        detail: { id: h.id, pointerEvent: ev },
      }));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    this.dispatchEvent(new CustomEvent<HandleDragEventDetail>('handle-drag-start', {
      bubbles: true, composed: true,
      detail: { id: h.id, pointerEvent: e },
    }));
  }

  override updated()
  {
    this._nodes.clear();
    this.renderRoot.querySelectorAll<HTMLElement>('.ay-handle-anchor').forEach((el) =>
    {
      const id = el.dataset['id'];
      if (id) this._nodes.set(id, el);
    });
  }

  /** Imperatively position handle anchors each frame (from the viewer loop). */
  setPositions(positions: Record<string, HandleOverlayPos>): void
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
      z-index: 6; /* above labels-overlay (5), below viewer-menu (10) */

      --ay-handle-size:        28px;
      --ay-handle-bg:          #2563EB;
      --ay-handle-color:       #fff;
      --ay-handle-radius:      6px;
      --ay-handle-shadow:      0 2px 8px rgba(0, 0, 0, 0.25);
      --ay-handle-bg-hover:    #1D4ED8;
      --ay-handle-bg-dragging: #1E40AF;
    }

    .ay-handle-anchor {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      will-change: transform;
    }

    .ay-handle {
      position: absolute;
      transform: translate(-50%, -50%);
      width: var(--ay-handle-size);
      height: var(--ay-handle-size);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ay-handle-bg);
      color: var(--ay-handle-color);
      border-radius: var(--ay-handle-radius);
      box-shadow: var(--ay-handle-shadow);
      pointer-events: auto;
      cursor: grab;
      user-select: none;
      touch-action: none;
      transition: background 0.1s ease;
    }

    .ay-handle:hover {
      background: var(--ay-handle-bg-hover);
    }

    .ay-handle--dragging {
      cursor: grabbing;
      background: var(--ay-handle-bg-dragging);
    }

    .ay-handle wa-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
      pointer-events: none;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'viewer-handles-overlay': ViewerHandlesOverlay;
  }
}
