import { LitElement, html, css, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';

import '../params/param-item.js';
import '../params/param-item-number.js';
import '../params/param-item-boolean.js';
import '../params/param-item-text.js';
import '../params/param-item-options.js';
import '../params/param-item-list.js';
import '../params/param-item-object-list.js';
import '../params/param-item-object.js';

import '../params/param-help.js';

import {
  configuratorParamMenuCollapsed,
  setConfiguratorParamMenuCollapsed,
} from '@archiyou/editor/src/state/configurator';
import { configuratorParams, configuratorValueFor, setConfiguratorValue } from '@archiyou/editor/src/state/configurator';
import { activeParamEntry, isObjectListParam } from '@archiyou/editor/src/state/workspace';
import { translate } from '@archiyou/editor/src/state/locale';
import { groupKey } from '@archiyou/core/src/i18n/keys';

import type { ScriptParam, ParamValueChangeDetail, ParamEntryRef } from '@archiyou/editor/src/state/workspace';

@customElement('configurator-params')
export class ConfiguratorParams extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const collapsed = configuratorParamMenuCollapsed.get();
    const params    = configuratorParams.get();
    const groups    = this._groups(params);
    // Read here, act on it in updated(): signal reads belong in render() so SignalWatcher
    // tracks them, the same pattern model-viewer uses for its pending-* fields.
    this._pendingActiveEntry = activeParamEntry.get();

    return html`
      <div class="header" @click=${this._toggleCollapse}>
        <wa-icon library="lucide" name="sliders-horizontal"></wa-icon>
        <span class="title">Parameters</span>
        <span class="spacer"></span>
        <wa-icon library="lucide" name=${collapsed ? 'chevron-down' : 'chevron-up'}></wa-icon>
      </div>

      ${!collapsed ? html`
        <div class="body" @param-value-change=${this._handleParamValueChange}>
          ${groups.length <= 1
            ? this._renderGroup('main', params)
            : html`
                <wa-tab-group>
                  ${groups.map(g => html`<wa-tab panel=${g}>${translate.get()(groupKey(g), g)}</wa-tab>`)}
                  ${groups.map(g => html`
                    <wa-tab-panel name=${g}>
                      ${this._renderGroup(g, params)}
                    </wa-tab-panel>
                  `)}
                </wa-tab-group>
              `
          }
          ${params.length === 0
            ? html`<div class="empty">No parameters defined</div>`
            : nothing
          }
        </div>
      ` : nothing}
    `;
  }

  // ── 2. State & Properties ──

  private _pendingActiveEntry: ParamEntryRef | null = null;
  /** The entry ref we last revealed, so a param-menu that the user deliberately collapsed
   *  stays collapsed until something new is actually activated. */
  private _lastRevealedEntry: string | null = null;

  // ── 3. Lifecycle ──

  override updated()
  {
    // A handle click in the 3D view activates a param entry; here that has to open the
    // menu and select the right tab, or the row it activated is somewhere the user cannot
    // see. The editor's equivalent lives in setActiveParamEntry(); this menu's collapse
    // flag is configurator-local, so it is reacted to rather than written from there.
    const ref = this._pendingActiveEntry;
    const key = ref ? `${ref.param}/${ref.index}` : null;
    if (key === this._lastRevealedEntry) return;
    this._lastRevealedEntry = key;
    if (!ref) return;

    setConfiguratorParamMenuCollapsed(false);

    const group = configuratorParams.get().find(p => p.name === ref.param)?.group ?? 'main';
    this.updateComplete.then(() =>
    {
      const tabs = this.renderRoot.querySelector('wa-tab-group') as (HTMLElement & { active: string }) | null;
      if (tabs) tabs.active = group;
    });
  }

  // ── 4. Behaviour & Methods ──
  private _groups(params: ScriptParam[]): string[]
  {
    const seen = new Set<string>();
    const groups: string[] = [];
    for (const p of params)
    {
      const g = p.group ?? 'main';
      if (!seen.has(g))
      {
        seen.add(g);
        groups.push(g);
      }
    }
    // 'main' first
    const idx = groups.indexOf('main');
    if (idx > 0)
    {
      groups.splice(idx, 1);
      groups.unshift('main');
    }
    return groups;
  }

  private _renderGroup(group: string, params: ScriptParam[])
  {
    const groupParams = params
      .filter(p => (p.group ?? 'main') === group)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // The number control draws its own label row (label + value box on one line,
    // slider underneath), so param-item stands back for it.
    return groupParams.map(p => html`
      <param-item .param=${p} .t=${translate.get()} readonly mode="presentation" ?hideLabel=${p.type === 'number'}>
        ${this._renderControl(p)}
      </param-item>
    `);
  }

  private _renderControl(p: ScriptParam)
  {
    // Values live in the configurator's own signal, never on the shared
    // ScriptParam — hand them in so presets are reflected in the controls.
    const v = configuratorValueFor(p);

    switch (p.type)
    {
      case 'number':  return html`<param-item-number  .param=${p} .value=${v} mode="presentation" context="configurator"></param-item-number>`;
      case 'boolean': return html`<param-item-boolean .param=${p} .value=${v} mode="presentation"></param-item-boolean>`;
      case 'text':    return html`<param-item-text    .param=${p} .value=${v} mode="presentation"></param-item-text>`;
      case 'options': return html`<param-item-options .param=${p} .value=${v} mode="presentation"></param-item-options>`;
      case 'list':    return isObjectListParam(p)
                        ? html`<param-item-object-list .param=${p} .value=${v} .t=${translate.get()} mode="presentation"></param-item-object-list>`
                        : html`<param-item-list        .param=${p} .value=${v} mode="presentation"></param-item-list>`;
      case 'object':  return html`<param-item-object  .param=${p} .value=${v} .t=${translate.get()} mode="presentation"></param-item-object>`;
      default:        return nothing;
    }
  }

  private _toggleCollapse()
  {
    setConfiguratorParamMenuCollapsed(!configuratorParamMenuCollapsed.get());
  }

  private _handleParamValueChange(e: CustomEvent<ParamValueChangeDetail>)
  {
    const { name, value } = e.detail;
    if (value !== undefined) setConfiguratorValue(name, value);

    this.dispatchEvent(new CustomEvent('configurator-params-changed', {
      bubbles:  true,
      composed: true,
      detail:   e.detail,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: block;
      border-bottom: 1px solid var(--color-border);
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

    .body
    {
      background: var(--color-bg);
    }

    .empty
    {
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text-muted, #888);
      font-style: italic;
      padding: var(--space-md);
    }

    /* Tabs read as a peer of the "Parameters" header, so they share its type
       size; the inline margin keeps them off the panel edges. */
    wa-tab-group
    {
      --track-color: var(--color-border);
      --indicator-color: var(--color-primary);
    }

    wa-tab-group::part(tabs)
    {
      margin: 0 var(--space-lg);
    }

    wa-tab::part(base)
    {
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      padding: var(--space-sm) var(--space-md);
    }

    wa-tab-panel
    {
      padding: 0;
    }

    wa-tab-panel::part(base)
    {
      padding: 0;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-params': ConfiguratorParams;
  }
}
