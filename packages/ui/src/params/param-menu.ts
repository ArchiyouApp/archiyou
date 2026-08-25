import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import './param-item';
import './param-item-number';
import './param-item-boolean';
import './param-item-text';
import './param-item-options';
import './param-item-list';
import './param-define-menu';

import {
  scriptParams,
  paramMenuCollapsed,
  setParamMenuCollapsed,
  addParamDirect,
  updateParamDirect,
  updateParam,
  deleteParam,
  reorderParams,
  renameParamGroup,
  swapParamGroups,
  saveAsPreset,
  paramVisible,
  paramEnabled,
} from '@archiyou/editor/src/state/workspace';

import { PARAM_TAB_NAME_MAX_LENGTH } from '@archiyou/editor/src/settings';

import type { ScriptParam, ScriptParamData, ParamValueChangeDetail, ParamSpec } from '@archiyou/editor/src/state/workspace';

@customElement('param-menu')
export class ParamMenu extends SignalWatcher(LitElement)
{
  @state() private _activeTab = 'main';
  @state() private _defineMenuOpen = false;
  @state() private _editingParam: ScriptParam | null = null;
  @state() private _editingTab: string | null = null;
  @state() private _tabDraft = '';
  @state() private _pendingGroups = new Set<string>();
  @state() private _dragOverId: string | null = null;
  @state() private _dragTabOver: string | null = null;
  @state() private _deletingTab: string | null = null;
  @state() private _tabsOverflow = false;
  @state() private _canScrollLeft = false;
  @state() private _canScrollRight = false;
  @state() private _savingPreset = false;
  @state() private _presetNameDraft = '';

  private _scrollListeners = new WeakSet<HTMLElement>();

  // ── Render ──

  override render()
  {
    const collapsed = paramMenuCollapsed.get();
    this.toggleAttribute('collapsed', collapsed);

    const groups = this._groups();
    if (!groups.includes(this._activeTab))
    {
      Promise.resolve().then(() => { this._activeTab = 'main'; });
    }

    const params = this._paramsForGroup(this._activeTab);

    return html`
      <div class="header" @click=${this._toggleCollapse}>
        <wa-icon library="lucide" name="sliders-horizontal"></wa-icon>
        <span class="title">parameters</span>
        <span class="spacer"></span>
        <wa-icon library="lucide" name=${collapsed ? 'chevron-down' : 'chevron-up'}></wa-icon>
      </div>

      ${!collapsed ? html`
        <div class="tab-bar"
            @dragover=${this._onTabDragOver}
            @drop=${this._onTabDrop}
            @dragleave=${() => { this._dragTabOver = null; }}>
          ${this._tabsOverflow ? html`
            <button class="tab-nav-btn" ?disabled=${!this._canScrollLeft}
                @click=${() => this._scrollTabs('left')}>
              <wa-icon library="lucide" name="chevron-left"></wa-icon>
            </button>` : nothing}
          <div class="tab-scroll-area">
            ${groups.map(g => this._renderTab(g))}
          </div>
          ${this._tabsOverflow ? html`
            <button class="tab-nav-btn" ?disabled=${!this._canScrollRight}
                @click=${() => this._scrollTabs('right')}>
              <wa-icon library="lucide" name="chevron-right"></wa-icon>
            </button>` : nothing}
          <button class="add-tab-btn" title="Add group" @click=${this._addGroup}>
            <wa-icon library="lucide" name="plus"></wa-icon>
          </button>
        </div>

        <div class="param-list"
            @dragover=${this._onParamDragOver}
            @drop=${this._onParamDrop}
            @dragleave=${this._onParamDragLeave}
            @param-rename=${this._onParamRename}
            @param-edit=${this._onParamEdit}
            @param-delete=${this._onParamDelete}
            @param-value-change=${this._onParamValueChange}>
          ${params.length === 0
            ? html`<div class="empty-list">No parameters — add one below</div>`
            : repeat(params, (p) => p.name, (p) => this._renderParamItem(p))
          }
        </div>

        <div class="add-bar">
          ${this._savingPreset
            ? html`
                <div class="preset-save-row">
                  <input
                    class="preset-name-input"
                    placeholder="Preset name…"
                    .value=${this._presetNameDraft}
                    @input=${(e: InputEvent) =>
                      (this._presetNameDraft = (e.target as HTMLInputElement).value)}
                    @keydown=${this._onPresetNameKeydown}
                    @blur=${this._cancelPresetSave}
                  />
                  <button class="preset-save-confirm" title="Save preset"
                      @mousedown=${(e: Event) => e.preventDefault()}
                      @click=${this._commitPresetSave}>
                    <wa-icon library="lucide" name="check"></wa-icon>
                  </button>
                  <button class="preset-save-cancel" title="Cancel"
                      @mousedown=${(e: Event) => e.preventDefault()}
                      @click=${this._cancelPresetSave}>
                    <wa-icon library="lucide" name="x"></wa-icon>
                  </button>
                </div>`
            : html`
                <div class="save-preset-wrap"
                    title=${params.length === 0 ? "Can't make a preset without params!" : 'Save current values as preset'}>
                  <button class="save-preset-btn"
                      ?disabled=${params.length === 0}
                      @click=${this._startPresetSave}>
                    <wa-icon library="lucide" name="bookmark"></wa-icon>
                    Save as preset
                  </button>
                </div>`
          }
          <span class="add-bar-spacer"></span>
          <button class="add-btn" @click=${this._openAddMenu}>
            <wa-icon library="lucide" name="plus"></wa-icon>
            Add Parameter
          </button>
        </div>

        <param-define-menu
          ?open=${this._defineMenuOpen}
          .editParam=${this._editingParam}
          .groups=${this._groups()}
          .defaultGroup=${this._activeTab}
          @param-define=${this._handleParamDefine}
          @param-define-cancel=${this._handleDefineCancel}
        ></param-define-menu>
      ` : nothing}
    `;
  }

  // ── Helpers ──

  private _groups(): string[]
  {
    const set = new Set(['main', ...scriptParams.get().map(p => p.group ?? 'main'), ...this._pendingGroups]);
    return [...set];
  }

  private _paramsForGroup(group: string): ScriptParam[]
  {
    return scriptParams.get()
      .filter(p => (p.group ?? 'main') === group)
      .filter(p => paramVisible(p)) // dynamic visibleIf() behaviour can hide a param
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  // ── Tab rendering ──

  private _renderTab(group: string)
  {
    const isActive    = group === this._activeTab;
    const isEditing   = group === this._editingTab;
    const isDragOver  = group === this._dragTabOver;
    const isDeleting  = group === this._deletingTab;
    const isDeletable = group !== 'main';

    return html`
      <div
        class="tab ${isActive ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}"
        draggable="true"
        data-group=${group}
        @click=${() => { this._activeTab = group; this._deletingTab = null; }}
        @dblclick=${(e: Event) => { e.stopPropagation(); this._startEditTab(group); }}
        @dragstart=${(e: DragEvent) => this._onTabDragStart(e, group)}
      >
        ${isDeleting
          ? html`
              <span class="tab-confirm-label">Delete?</span>
              <button class="tab-action-btn confirm-yes" title="Confirm delete"
                  @click=${(e: Event) => { e.stopPropagation(); this._confirmDeleteTab(group); }}>
                <wa-icon library="lucide" name="check"></wa-icon>
              </button>
              <button class="tab-action-btn confirm-no" title="Cancel"
                  @click=${(e: Event) => { e.stopPropagation(); this._deletingTab = null; }}>
                <wa-icon library="lucide" name="x"></wa-icon>
              </button>`
          : html`
              ${isEditing
                ? html`
                    <input
                      class="tab-input"
                      .value=${this._tabDraft}
                      maxlength=${PARAM_TAB_NAME_MAX_LENGTH}
                      @blur=${this._commitTabRename}
                      @keydown=${this._onTabKeydown}
                      @click=${(e: Event) => e.stopPropagation()}
                      @input=${(e: InputEvent) =>
                        (this._tabDraft = (e.target as HTMLInputElement).value)}
                    />`
                : html`<span class="tab-label">${group}</span>`
              }
              ${isDeletable && !isEditing
                ? html`
                    <button class="tab-action-btn tab-delete-btn" title="Delete group"
                        @click=${(e: Event) => { e.stopPropagation(); this._deletingTab = group; }}>
                      <wa-icon library="lucide" name="x"></wa-icon>
                    </button>`
                : nothing
              }`
        }
      </div>
    `;
  }

  // ── Param item rendering ──

  private _renderParamItem(p: ScriptParam)
  {
    const isDragOver = p.name === this._dragOverId;
    return html`
      <param-item
        .param=${p}
        ?disabled=${!paramEnabled(p)}
        class=${isDragOver ? 'drag-over' : ''}
        data-name=${ifDefined(p.name)}
      >
        ${this._renderParamControl(p)}
      </param-item>
    `;
  }

  private _renderParamControl(p: ScriptParam)
  {
    switch (p.type)
    {
      case 'number':  return html`<param-item-number  .param=${p} context="editor"></param-item-number>`;
      case 'boolean': return html`<param-item-boolean .param=${p}></param-item-boolean>`;
      case 'text':    return html`<param-item-text    .param=${p}></param-item-text>`;
      case 'options': return html`<param-item-options .param=${p}></param-item-options>`;
      case 'list':    return html`<param-item-list    .param=${p}></param-item-list>`;
      default:        return nothing;
    }
  }

  // ── Tab rename ──

  private _startEditTab(group: string)
  {
    this._editingTab = group;
    this._tabDraft = group;
    this.updateComplete.then(() =>
    {
      this.renderRoot.querySelector<HTMLInputElement>('.tab-input')?.select();
    });
  }

  private _commitTabRename()
  {
    const oldName = this._editingTab;
    const newName = this._tabDraft.trim().slice(0, PARAM_TAB_NAME_MAX_LENGTH);
    this._editingTab = null;

    const existingGroups = this._groups().filter(g => g !== oldName);
    if (newName && existingGroups.includes(newName)) return; // duplicate — discard silently

    if (this._pendingGroups.has(oldName ?? ''))
    {
      const next = new Set(this._pendingGroups);
      next.delete(oldName!);
      if (newName) next.add(newName);
      this._pendingGroups = next;
      if (newName) this._activeTab = newName;
      else this._activeTab = 'main';
    }
    else if (oldName && newName && newName !== oldName)
    {
      renameParamGroup(oldName, newName);
      if (this._activeTab === oldName) this._activeTab = newName;
    }
  }

  private _onTabKeydown(e: KeyboardEvent)
  {
    e.stopPropagation();
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape')
    {
      if (this._editingTab && this._pendingGroups.has(this._editingTab))
      {
        const next = new Set(this._pendingGroups);
        next.delete(this._editingTab);
        this._pendingGroups = next;
        this._activeTab = 'main';
      }
      this._editingTab = null;
    }
  }

  private _addGroup()
  {
    const tempName = `group${this._groups().length}`;
    const next = new Set(this._pendingGroups);
    next.add(tempName);
    this._pendingGroups = next;
    this._activeTab = tempName;
    this._editingTab = tempName;
    this._tabDraft = tempName;
    this.updateComplete.then(() =>
    {
      this.renderRoot.querySelector<HTMLInputElement>('.tab-input')?.select();
    });
  }

  // ── Tab drag ──

  private _onTabDragStart(e: DragEvent, group: string)
  {
    e.stopPropagation();
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', `__tab__:${group}`);
  }

  private _onTabDragOver(e: DragEvent)
  {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    const target = (e.target as HTMLElement).closest('.tab[data-group]') as HTMLElement | null;
    this._dragTabOver = target?.dataset['group'] ?? null;
  }

  private _onTabDrop(e: DragEvent)
  {
    e.preventDefault();
    const data = e.dataTransfer!.getData('text/plain');
    const targetGroup = this._dragTabOver;
    this._dragTabOver = null;
    if (!targetGroup) return;

    if (data.startsWith('__tab__:'))
    {
      // Tab reorder
      const sourceGroup = data.slice('__tab__:'.length);
      if (!sourceGroup || sourceGroup === targetGroup) return;

      swapParamGroups(sourceGroup, targetGroup);
      if (this._activeTab === sourceGroup) this._activeTab = targetGroup;
      else if (this._activeTab === targetGroup) this._activeTab = sourceGroup;

      if (this._pendingGroups.has(sourceGroup))
      {
        const next = new Set(this._pendingGroups);
        next.delete(sourceGroup);
        next.add(targetGroup);
        this._pendingGroups = next;
      }
    }
    else
    {
      // Param moved to a different group via tab drop
      const paramName = data;
      if (!paramName) return;
      const param = scriptParams.get().find(p => p.name === paramName);
      if (!param || param.group === targetGroup) return;
      const targetParams = this._paramsForGroup(targetGroup);
      updateParam(paramName, { group: targetGroup, order: targetParams.length });
      this._activeTab = targetGroup;
    }
  }

  private _confirmDeleteTab(group: string)
  {
    this._deletingTab = null;
    // Move all params in this group to 'main' then remove from pendingGroups
    const params = this._paramsForGroup(group);
    const mainParams = this._paramsForGroup('main');
    params.forEach((p, i) => updateParam(p.name, { group: 'main', order: mainParams.length + i }));

    if (this._pendingGroups.has(group))
    {
      const next = new Set(this._pendingGroups);
      next.delete(group);
      this._pendingGroups = next;
    }
    if (this._activeTab === group) this._activeTab = 'main';
  }

  // ── Param drag ──

  private _onParamDragOver(e: DragEvent)
  {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    const target = (e.target as HTMLElement).closest('param-item[data-name]') as HTMLElement | null;
    this._dragOverId = target?.dataset['name'] ?? null;
  }

  private _onParamDrop(e: DragEvent)
  {
    e.preventDefault();
    const sourceName = e.dataTransfer!.getData('text/plain');
    if (sourceName.startsWith('__tab__:')) return;

    const targetName = this._dragOverId;
    this._dragOverId = null;
    if (!sourceName || !targetName || sourceName === targetName) return;

    const params = this._paramsForGroup(this._activeTab);
    const sourceIdx = params.findIndex(p => p.name === sourceName);
    const targetIdx = params.findIndex(p => p.name === targetName);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const reordered = [...params];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    reorderParams(this._activeTab, reordered.map(p => p.name));
  }

  private _onParamDragLeave(e: DragEvent)
  {
    const related = e.relatedTarget as HTMLElement | null;
    if (!this.renderRoot.querySelector('.param-list')?.contains(related))
    {
      this._dragOverId = null;
    }
  }

  // ── Param event handlers ──

  private _onParamValueChange(e: CustomEvent<ParamValueChangeDetail>)
  {
    const { name, value, units, options } = e.detail;
    const updates: ParamSpec = {};
    if (value   !== undefined) updates.value   = value;
    if (units   !== undefined) updates.units   = units;
    if (options !== undefined) updates.options = options;
    updateParam(name, updates);
  }

  private _onParamRename(e: CustomEvent<{ oldName: string; name: string }>)
  {
    updateParam(e.detail.oldName, { name: e.detail.name });
  }

  private _onParamEdit(e: CustomEvent<ScriptParam>)
  {
    this._openEditMenu(e.detail);
  }

  private _onParamDelete(e: CustomEvent<string>)
  {
    deleteParam(e.detail);
  }

  // ── Define menu ──

  private _openAddMenu()
  {
    this._editingParam = null;
    this._defineMenuOpen = true;
  }

  private _openEditMenu(param: ScriptParam)
  {
    this._editingParam = param;
    this._defineMenuOpen = true;
  }

  private _handleParamDefine(e: CustomEvent<ScriptParamData>)
  {
    // Snapshot edit state before clearing, so the param-define-menu re-opens
    // in a clean "add" state on next use even if the update path throws.
    const editing = this._editingParam;
    this._editingParam = null;
    this._defineMenuOpen = false;

    const d = e.detail;
    const group = d.group ?? 'main';

    if (editing)
    {
      // Edit: route by the param's *current* name (the key in script.params).
      // updateParamDirect preserves `order` and re-keys the map on rename.
      // Use this snapshot, not anything on `d`, to decide edit-vs-add — the
      // event payload alone can't reliably distinguish them.
      updateParamDirect(editing.name, d);
    }
    else
    {
      const order = this._paramsForGroup(group).length;
      addParamDirect({ ...d, order });
    }

    this._activeTab = group;
  }

  private _handleDefineCancel()
  {
    this._defineMenuOpen = false;
    this._editingParam = null;
  }

  // ── Preset save ──

  private _startPresetSave()
  {
    this._presetNameDraft = '';
    this._savingPreset = true;
    this.updateComplete.then(() =>
    {
      this.renderRoot.querySelector<HTMLInputElement>('.preset-name-input')?.focus();
    });
  }

  private _commitPresetSave()
  {
    const name = this._presetNameDraft.trim();
    if (name) saveAsPreset(name);
    this._savingPreset = false;
    this._presetNameDraft = '';
  }

  private _cancelPresetSave()
  {
    this._savingPreset = false;
    this._presetNameDraft = '';
  }

  private _onPresetNameKeydown(e: KeyboardEvent)
  {
    e.stopPropagation();
    if (e.key === 'Enter') this._commitPresetSave();
    if (e.key === 'Escape') this._cancelPresetSave();
  }

  // ── Collapse ──

  private _toggleCollapse()
  {
    setParamMenuCollapsed(!paramMenuCollapsed.get());
  }

  // ── Tab overflow / scroll ──

  override updated()
  {
    const area = this.renderRoot.querySelector<HTMLElement>('.tab-scroll-area');
    if (area && !this._scrollListeners.has(area))
    {
      this._scrollListeners.add(area);
      area.addEventListener('scroll', () => this._updateScrollState(area));
    }
    this._updateTabOverflow();
  }

  private _updateTabOverflow()
  {
    const area = this.renderRoot.querySelector<HTMLElement>('.tab-scroll-area');
    if (!area)
    {
      if (this._tabsOverflow) this._tabsOverflow = false;
      return;
    }
    const overflow = area.scrollWidth > area.clientWidth + 1;
    if (this._tabsOverflow !== overflow) this._tabsOverflow = overflow;
    this._updateScrollState(area);
  }

  private _updateScrollState(area: HTMLElement)
  {
    const left  = area.scrollLeft > 0;
    const right = area.scrollLeft < area.scrollWidth - area.clientWidth - 1;
    if (this._canScrollLeft  !== left)  this._canScrollLeft  = left;
    if (this._canScrollRight !== right) this._canScrollRight = right;
  }

  private _scrollTabs(dir: 'left' | 'right')
  {
    const area = this.renderRoot.querySelector<HTMLElement>('.tab-scroll-area');
    if (!area) return;
    area.scrollBy({ left: dir === 'left' ? -(area.clientWidth * 0.6) : area.clientWidth * 0.6, behavior: 'smooth' });
  }

  // ── Styles ──

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      background: var(--color-bg-elevated);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
      overflow: visible;
    }

    *,
    *::before,
    *::after { box-sizing: border-box; }

    /* ── Header ── */

    .header {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      height: var(--space3xl);
      padding: 0 var(--space-md);
      flex-shrink: 0;
      user-select: none;
      cursor: pointer;
      background: var(--color-gray);
      border-bottom: 1px solid var(--color-border);
    }

    .title {
      font-weight: 500;
      color: var(--color-text);
      font-size: var(--text-sm);
    }

    .spacer { flex: 1; }

    /* ── Tab bar ── */

    .tab-bar {
      display: flex;
      align-items: stretch;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
      overflow: hidden;
      background: var(--color-gray-light, #f5f5f5);
      padding: 0;
    }

    .tab-scroll-area {
      display: flex;
      align-items: stretch;
      flex: 1;
      overflow-x: auto;
      scrollbar-width: none;
      min-width: 0;
    }

    .tab-scroll-area::-webkit-scrollbar { display: none; }

    .tab-nav-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      border: none;
      border-right: 1px solid var(--color-border);
      background: var(--color-gray-light, #f5f5f5);
      cursor: pointer;
      color: var(--color-gray-dark, #555);
      font-size: 10px;
      padding: 0;
    }

    .tab-nav-btn:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
      color: var(--color-text);
    }

    .tab-nav-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: 4px;
      height: var(--space2xl);
      width: max-content;
      padding-left: var(--space-md);
      padding-right: var(--space-md);
      cursor: pointer;
      font-size: var(--text-xs);
      font-weight: 500;
      color: var(--color-gray-dark);
      border-right: 1px solid var(--color-border);
      white-space: nowrap;
      user-select: none;
      transition: background 0.1s;
    }

    .tab:hover {
      background: color-mix(in srgb, var(--color-border) 25%, transparent);
    }

    .tab.active {
      color: var(--color-gray-dark);
      background: color-mix(in srgb, var(--color-gray-dark) 5%, transparent);
      border-bottom: 2px solid color-mix(in srgb, var(--color-gray-dark) 25%, transparent);
    }

    .tab.drag-over {
      background: color-mix(in srgb, var(--color-gray-dark) 15%, transparent);
      border-left: 2px solid var(--color-gray-dark);
    }

    .tab-label { flex-shrink: 0; }

    .tab-input {
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      width: 80px;
      border: 1px solid var(--color-gray-dark);
      border-radius: var(--radius-sm, 4px);
      padding: 1px 4px;
      outline: none;
      background: var(--color-bg, #fff);
      color: var(--color-text);
    }

    /* ── Tab action buttons ── */

    .tab-action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: var(--radius-sm, 3px);
      color: var(--color-gray-dark, #666);
      font-size: 9px;
      flex-shrink: 0;
    }

    .tab-action-btn:hover {
      background: color-mix(in srgb, var(--color-border) 50%, transparent);
    }

    .tab-delete-btn {
      opacity: 0;
      transition: opacity 0.1s;
    }

    .tab:hover .tab-delete-btn { opacity: 0.6; }
    .tab:hover .tab-delete-btn:hover { opacity: 1; color: var(--color-alert); }

    /* ── Tab delete confirmation ── */

    .tab-confirm-label {
      font-size: var(--text-xs);
      color: var(--color-alert, #ef4444);
      font-weight: 500;
    }

    .confirm-yes { color: var(--color-alert, #ef4444); }
    .confirm-yes:hover {
      background: color-mix(in srgb, var(--color-alert, #ef4444) 15%, transparent) !important;
    }

    .add-tab-btn {
      display: flex;
      align-items: center;
      padding: 0 10px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--color-gray-dark, #666);
      font-size: 11px;
    }

    .add-tab-btn:hover { color: var(--color-gray-dark); }

    /* ── Param list ── */

    .param-list {
      flex-shrink: 0;
      max-height: 200px;
      overflow-y: auto;
    }

    param-item.drag-over {
      border-top: 2px solid var(--color-gray-dark);
    }

    .empty-list {
      padding: var(--space-lg);
      color: var(--color-text-gray);
      font-size: var(--text-xs);
    }

    /* ── Add bar ── */

    .add-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: var(--space-lg);
      flex-shrink: 0;
    }

    .add-bar-spacer { flex: 1; }

    .add-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 500;
      color: var(--color-gray-dark);
      background: color-mix(in srgb, var(--color-gray-dark) 10%, transparent);
      border: 1px solid var(--color-gray-dark);
      border-radius: var(--radius-sm, 4px);
      cursor: pointer;
      justify-content: center;
    }

    .add-btn:hover {
      background: color-mix(in srgb, var(--color-gray-dark) 18%, transparent);
    }

    /* ── Save as preset ── */

    .save-preset-wrap {
      display: contents;
    }

    .save-preset-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 500;
      color: var(--color-gray-dark, #666);
      background: transparent;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      cursor: pointer;
    }

    .save-preset-btn:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-border) 30%, transparent);
      color: var(--color-text);
    }

    .save-preset-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .preset-save-row {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
    }

    .preset-name-input {
      flex: 1;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--color-text);
      background: var(--color-bg, #fff);
      border: 1px solid var(--color-gray-dark);
      border-radius: var(--radius-sm, 4px);
      padding: 4px 6px;
      outline: none;
    }

    .preset-save-confirm,
    .preset-save-cancel {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: var(--radius-sm, 4px);
      font-size: 11px;
      color: var(--color-gray-dark, #666);
      flex-shrink: 0;
    }

    .preset-save-confirm { color: var(--color-gray-dark); }
    .preset-save-confirm:hover {
      background: color-mix(in srgb, var(--color-gray-dark) 12%, transparent);
    }

    .preset-save-cancel:hover {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'param-menu': ParamMenu;
  }
}
