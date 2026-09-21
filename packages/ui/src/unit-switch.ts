/**
 * unit-switch — the compact Metric/Imperial pill switch.
 *
 * Shared so the editor's file-info header and the configurator's controls row
 * are literally the same control. It is presentation-only: it renders `value`
 * and emits `unit-system-change`; the caller owns the state (the script's unit
 * system in the editor, the end-user's local one in the configurator).
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { UnitSystem } from '@archiyou/core/src/units/UnitConverter';

@customElement('unit-switch')
export class UnitSwitch extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="unit-seg" role="group" @click=${(e: Event) => e.stopPropagation()}>
        <button
          class=${`seg-btn ${this.value === 'metric' ? 'active' : ''}`}
          @click=${() => this._select('metric')}
        >Metric</button>
        <button
          class=${`seg-btn ${this.value === 'imperial' ? 'active' : ''}`}
          @click=${() => this._select('imperial')}
        >Imperial</button>
      </div>
    `;
  }

  // ── 2. Properties ──
  @property({ type: String }) value: UnitSystem = 'metric';

  // ── 4. Behaviour ──
  private _select(system: UnitSystem)
  {
    if (system === this.value) return;
    this.dispatchEvent(new CustomEvent<UnitSystem>('unit-system-change', {
      detail:   system,
      bubbles:  true,
      composed: true,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host { display: inline-flex; flex-shrink: 0; }

    .unit-seg
    {
      display: inline-flex;
      align-items: stretch;
      gap: 2px;
      padding: 2px;
      /* surface-subtle (not gray) so the track still reads against the panel in
         the dark theme, where --color-gray equals the elevated surface. */
      background: var(--color-surface-subtle, #eee);
      border: 1px solid var(--color-divider, #cfcfcf);
      border-radius: var(--radius-full, 9999px);
    }

    .seg-btn
    {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border: none;
      border-radius: var(--radius-full, 9999px);
      background: transparent;
      color: var(--color-text-muted);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      line-height: 1.4;
      cursor: pointer;
      white-space: nowrap;
    }

    .seg-btn:hover { color: var(--color-text); }

    /* Filled dark rather than a white chip: the active unit system is a claim
       about the whole script, so it carries the strongest contrast in the bar. */
    .seg-btn.active
    {
      background: var(--color-secondary, #180c2d);
      color: var(--color-white, #fff);
      font-weight: 600;
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
    }

    .seg-btn.active:hover { color: var(--color-white, #fff); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'unit-switch': UnitSwitch;
  }
}
