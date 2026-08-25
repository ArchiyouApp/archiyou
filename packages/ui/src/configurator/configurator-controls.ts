import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

import './configurator-presets.js';
import './configurator-params.js';
import '../unit-switch.js';

import { configuratorUnitSystem, setConfiguratorUnitSystem } from '@archiyou/editor/src/state/workspace';
import type { UnitSystem } from '@archiyou/core/src/units/UnitConverter';

@customElement('configurator-controls')
export class ConfiguratorControls extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const sys = configuratorUnitSystem.get();

    return html`
      <div class="unit-toggle-row">
        <wa-icon library="lucide" name="ruler"></wa-icon>
        <unit-switch
          .value=${sys}
          @unit-system-change=${(e: CustomEvent<UnitSystem>) => setConfiguratorUnitSystem(e.detail)}
        ></unit-switch>
        <span class="unit-spacer"></span>
        <span id="unit-help" class="unit-help"><wa-icon library="lucide" name="circle-help"></wa-icon></span>
        <wa-tooltip for="unit-help" placement="bottom">
          Choose how measurements are shown for you. Metric uses millimetres (mm); Imperial uses inches (in).
          This is your local preference and does not change the script.
        </wa-tooltip>
      </div>
      <configurator-presets></configurator-presets>
      <configurator-params
        @configurator-params-changed=${this._forwardParamsChanged}
      ></configurator-params>
    `;
  }

  // ── 4. Behaviour & Methods ──
  private _forwardParamsChanged(e: Event)
  {
    this.dispatchEvent(new CustomEvent('configurator-params-changed', {
      bubbles: true,
      composed: true,
      detail:   (e as CustomEvent).detail,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: block;
    }

    /* Same gap + inline padding as the Presets/Parameters headers below, so the
       ruler icon lines up with their section icons. */
    .unit-toggle-row
    {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      border-bottom: 1px solid var(--color-border);
      background: var(--color-bg-elevated);
    }

    wa-icon
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted, #888);
    }

    .unit-spacer { flex: 1; }

    .unit-help
    {
      display: inline-flex;
      align-items: center;
      cursor: help;
      opacity: 0.6;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-controls': ConfiguratorControls;
  }
}
