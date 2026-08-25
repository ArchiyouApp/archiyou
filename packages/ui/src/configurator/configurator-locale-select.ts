/**
 * <configurator-locale-select> — language picker for a published configurator.
 *
 * Only rendered when the configurator actually carries more than one language. A picker
 * offering languages that would silently fall back to the original is worse than none.
 *
 * The script's own source language leads the list and is marked "(original)": machine
 * translation is good enough to ship but not good enough to pass off as authored copy,
 * and a reader who notices an odd phrase should be able to see the author's own words.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import {
  availableLocales, configuratorLocale, scriptLocale,
  setConfiguratorLocale, localeLabel,
} from '@archiyou/editor/src/state/locale';

@customElement('configurator-locale-select')
export class ConfiguratorLocaleSelect extends SignalWatcher(LitElement)
{
  override render()
  {
    const locales = availableLocales.get();
    if (locales.length < 2) return nothing;

    const active = configuratorLocale.get();
    const source = scriptLocale.get();

    return html`
      <label class="wrap" title="Language">
        <wa-icon library="lucide" name="languages"></wa-icon>
        <select
          class="select"
          aria-label="Language"
          @change=${(e: Event) => setConfiguratorLocale((e.target as HTMLSelectElement).value)}
        >
          ${locales.map(locale => html`
            <option value=${locale} ?selected=${locale === active}>
              ${localeLabel(locale)}${locale === source ? ' (original)' : ''}
            </option>`)}
        </select>
      </label>
    `;
  }

  static override styles = css`
    :host { display: inline-flex; }

    .wrap {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--color-text-muted);
      font-size: var(--text-xs);
      cursor: pointer;
    }

    .select {
      appearance: none;
      background: transparent;
      border: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: var(--radius-sm, 4px);
    }

    .select:hover { background: color-mix(in srgb, var(--color-border) 40%, transparent); }
    .select:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-locale-select': ConfiguratorLocaleSelect;
  }
}
