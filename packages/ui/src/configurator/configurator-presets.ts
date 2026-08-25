import { LitElement, html, css, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import {
  configuratorPresets,
  applyConfiguratorPreset,
  configuratorPresetMenuCollapsed,
  setConfiguratorPresetMenuCollapsed,
} from '@archiyou/editor/src/state/configurator';
import { translate } from '@archiyou/editor/src/state/locale';
import { presetKey } from '@archiyou/core/src/i18n/keys';

@customElement('configurator-presets')
export class ConfiguratorPresets extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const presets = configuratorPresets.get();

    // Hide the whole menu section when there are no presets to show.
    this.toggleAttribute('hidden', presets.length === 0);
    if (presets.length === 0) return nothing;

    const collapsed = configuratorPresetMenuCollapsed.get();

    return html`
      <div class="header" @click=${this._toggleCollapse}>
        <wa-icon library="lucide" name="bookmark"></wa-icon>
        <span class="title">Presets</span>
        <span class="spacer"></span>
        <wa-icon library="lucide" name=${collapsed ? 'chevron-down' : 'chevron-up'}></wa-icon>
      </div>

      ${!collapsed ? html`
        <div class="preset-grid">
          ${presets.map(p => {
            // p.name stays the identifier used to apply the preset; only the caption
            // shown on the button is translated.
            const label = translate.get()(presetKey(p.name), p.name);
            return html`
            <button class="preset-btn" title=${`Apply preset "${label}"`}
              @click=${() => this._apply(p.name)}
            >${label}</button>
          `;})}
        </div>
      ` : nothing}
    `;
  }

  // ── 4. Behaviour & Methods ──

  /** Applying a preset only writes the configurator's runtime values; the page
   *  re-runs the script off `configurator-params-changed`, so announce it here
   *  too (the param controls never fire for a programmatic change). */
  private _apply(name: string)
  {
    applyConfiguratorPreset(name);
    this.dispatchEvent(new CustomEvent('configurator-params-changed', {
      bubbles:  true,
      composed: true,
      detail:   { preset: name },
    }));
  }

  private _toggleCollapse()
  {
    setConfiguratorPresetMenuCollapsed(!configuratorPresetMenuCollapsed.get());
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: block;
      border-bottom: 1px solid var(--color-border);
    }

    :host([hidden])
    {
      display: none;
    }

    .header
    {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      cursor: pointer;
      user-select: none;
      background: var(--color-bg-elevated);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text-muted, #888);
    }

    .header:hover
    {
      background: color-mix(in srgb, var(--color-border) 20%, transparent);
    }

    .title
    {
      font-weight: 500;
      color: var(--color-text);
    }

    .spacer { flex: 1; }

    .preset-grid
    {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      padding: var(--space-sm) var(--space-lg) var(--space-md);
      background: var(--color-bg);
    }

    /* Deliberately a step below the section headers in the type hierarchy. */
    .preset-btn
    {
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      line-height: 1;
      color: var(--color-text);
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full, 100px);
      padding: 5px 10px;
      cursor: pointer;
      white-space: nowrap;
    }

    .preset-btn:hover
    {
      border-color: var(--color-primary);
      color: var(--color-primary);
      background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-elevated));
    }

    .preset-btn:active
    {
      background: color-mix(in srgb, var(--color-primary) 16%, var(--color-bg-elevated));
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-presets': ConfiguratorPresets;
  }
}
