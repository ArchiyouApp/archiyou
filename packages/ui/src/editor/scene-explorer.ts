import { LitElement, html, css, nothing } from 'lit';
import type { HTMLTemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { buildScenegraphPath, scenegraph, toggleNodeVisibility, activeBottomPanel, 
    setActiveBottomPanel, selectedPath, setSelectedPath } from '@archiyou/editor/src/state/workspace';
import type { SceneNodeData } from '@archiyou/core/src/modeler/types';
import { SCENE_EXPLORER_MINIMIZED_TREE_LEVEL } from '@archiyou/editor/src/settings';

/** Pick a row icon by node kind. Layer/group nodes have no held shape;
 *  Mesh/Curve nodes show their geometry icon. */
function nodeIcon(node: SceneNodeData): string
{
  if (!node.shape) return 'layers'; // container / layer
  // Children-bearing leaf nodes are uncommon; default to a box for shapes.
  return 'box';
}

@customElement('scene-explorer')
export class SceneExplorer extends SignalWatcher(LitElement)
{
  @property({ type: Boolean }) standalone = false;

  /** Path keys (slash-joined) of expanded rows. */
  @state() private _expandedNodes = new Set<string>();

  /** Tree display mode driven by the toggle button:
   *  false = maximized (every node expanded — the default),
   *  true  = minimized (expanded only up to SCENE_EXPLORER_MINIMIZED_TREE_LEVEL,
   *          i.e. the Scene root + its direct children). */
  @state() private _minimized = false;

  /** Current search query (case-insensitive substring match on node names).
   *  While non-empty it overrides the minimize/maximize expansion: the paths to
   *  all matching nodes are expanded and the matches are highlighted. */
  @state() private _search = '';

  /** Track which tree we've seeded expansion for; reset on new tree identity. */
  private _knownTree?: SceneNodeData;

  /** Last selectedPath we reacted to, so a selection made in the 3D viewer
   *  expands the tree to reveal (and highlight) the matching node. */
  private _knownSelected: string | null = null;

  override render()
  {
    const collapsed = this.standalone ? false : activeBottomPanel.get() !== 'scene';
    if (!this.standalone) this.toggleAttribute('collapsed', collapsed);

    const tree = scenegraph.get();

    // Re-seed expansion when a new tree arrives. Identity is the root
    // reference — `reconcileScenegraph` returns a fresh clone on every run.
    // Honours the current display mode (auto / minimized / collapsed) so a
    // user's chosen mode sticks across re-runs.
    if (tree && tree !== this._knownTree)
    {
      this._knownTree = tree;
      this._reseedExpansion();
    }

    // When the selection changes (e.g. a click in the 3D viewer), expand the
    // tree down to the selected node so its highlighted row is actually visible.
    const sel = selectedPath.get();
    if (sel !== this._knownSelected)
    {
      this._knownSelected = sel;
      if (sel) this._expandToPath(sel);
    }

    return html`
      ${!this.standalone ? html`
        <div class="header" @click=${this._activate}>
          <wa-icon library="lucide" name="network"></wa-icon>
          <span class="title">scene</span>
          <span class="spacer"></span>
          <wa-icon library="lucide" name=${collapsed ? 'chevron-down' : 'chevron-up'}></wa-icon>
        </div>
      ` : nothing}

      ${!collapsed ? html`
        <div class="subheader">
          <div class="search-wrap">
            <wa-icon class="search-icon" library="lucide" name="search"></wa-icon>
            <input
              class="search-input"
              type="text"
              placeholder="Search nodes…"
              .value=${this._search}
              @input=${this._onSearchInput}
            />
            ${this._search ? html`
              <button class="search-clear" title="Clear search" @click=${this._clearSearch}>
                <wa-icon library="lucide" name="x"></wa-icon>
              </button>
            ` : nothing}
          </div>
          <button
            class="mini-btn"
            title=${this._minimized ? 'Expand all nodes' : 'Minimize scene tree'}
            @click=${this._toggleMinimize}
          >
            <wa-icon
              library="lucide"
              name=${this._minimized ? 'list-tree' : 'list-collapse'}
            ></wa-icon>
          </button>
        </div>

        <div class="tree">
          ${tree
            ? this._renderNode(tree, '', 0)
            : html`<div class="empty">No scene loaded</div>`
          }
        </div>
      ` : nothing}
    `;
  }

  private _renderNode(node: SceneNodeData, parentPath: string, depth: number): HTMLTemplateResult
  {
    const path       = buildScenegraphPath(parentPath, node.name);
    const isHidden   = node.style.visible === false;
    const hasKids    = node.children.length > 0;
    const isExpanded = this._expandedNodes.has(path);
    const isSelected = selectedPath.get() === path;
    const isMatch    = this._nodeMatches(node);
    const color      = node.style.color;
    const opacity    = node.style.opacity;

    return html`
      <div class="node-row ${isSelected ? 'selected' : ''}" style="padding-left: ${depth * 14 + 6}px">
        <button
          class="expand-btn"
          ?disabled=${!hasKids}
          @click=${() => hasKids && this._toggleExpand(path)}
        >
          ${hasKids
            ? html`<wa-icon library="lucide" name=${isExpanded ? 'chevron-down' : 'chevron-right'}></wa-icon>`
            : nothing}
        </button>

        <wa-icon class="node-icon" library="lucide" name=${nodeIcon(node)}></wa-icon>

        <span
          class="node-name ${isHidden ? 'faded' : ''} ${isMatch ? 'match' : ''}"
          title=${node.name}
          @click=${() => this._select(path)}
        >${node.name}</span>

        ${color ? html`
          <span class="mat-swatch" style="background:${color}" title=${color}></span>
        ` : nothing}
        ${typeof opacity === 'number' && opacity < 0.99 ? html`
          <span class="mat-opacity">${Math.round(opacity * 100)}%</span>
        ` : nothing}

        <button
          class="vis-btn"
          title=${isHidden ? 'Show node' : 'Hide node'}
          @click=${() => toggleNodeVisibility(path)}
        >
          <wa-icon library="lucide" name=${isHidden ? 'eye-off' : 'eye'}></wa-icon>
        </button>
      </div>

      ${isExpanded && hasKids
        ? node.children.map(c => this._renderNode(c, path, depth + 1))
        : nothing}
    `;
  }

  // ── State helpers ──

  private _activate = () =>
    setActiveBottomPanel(activeBottomPanel.get() === 'scene' ? 'none' : 'scene');

  /** Toggle between the "minimized" outline (level
   *  SCENE_EXPLORER_MINIMIZED_TREE_LEVEL) and the fully-expanded tree. */
  private _toggleMinimize = (e: Event) =>
  {
    e.stopPropagation(); // don't also toggle the whole panel via the header
    this._minimized = !this._minimized;
    this._reseedExpansion();
  };

  // ── Search ──

  private _onSearchInput = (e: Event) =>
  {
    this._search = (e.target as HTMLInputElement).value.trim();
    this._reseedExpansion();
  };

  private _clearSearch = () =>
  {
    this._search = '';
    this._reseedExpansion();
  };

  /** Case-insensitive substring match of a node name against the active query. */
  private _nodeMatches(node: SceneNodeData): boolean
  {
    if (!this._search) return false;
    return node.name.toLowerCase().includes(this._search.toLowerCase());
  }

  /** A search overrides the minimize/maximize expansion: expand the ancestor
   *  paths of every match so the matches are revealed. */
  private _reseedExpansion()
  {
    if (this._search) this._applySearch();
    else this._applyTreeMode();
  }

  /** Expand the ancestor paths of all nodes matching the current query. */
  private _applySearch()
  {
    const tree = scenegraph.get();
    if (!tree) { this._expandedNodes = new Set(); return; }
    const expanded = new Set<string>();
    this._collectSearchExpansion(tree, '', [], expanded);
    this._expandedNodes = expanded;
  }

  /** Walk the tree carrying the list of ancestor paths; when a node matches,
   *  add all its ancestors to the expanded set so the node becomes visible. */
  private _collectSearchExpansion(node: SceneNodeData, parentPath: string, ancestors: string[], set: Set<string>)
  {
    const path = buildScenegraphPath(parentPath, node.name);
    if (this._nodeMatches(node)) ancestors.forEach(a => set.add(a));
    node.children.forEach(c => this._collectSearchExpansion(c, path, [...ancestors, path], set));
  }

  /** Expand the ancestor chain of `targetPath` (additively) so the selected node
   *  is revealed in the tree. Names are encoded, so we locate the node by walking
   *  the tree rather than splitting the path string. */
  private _expandToPath(targetPath: string)
  {
    const tree = scenegraph.get();
    if (!tree) return;

    const next = new Set(this._expandedNodes);
    let found = false;

    const walk = (node: SceneNodeData, parentPath: string, ancestors: string[]): void =>
    {
      if (found) return;
      const path = buildScenegraphPath(parentPath, node.name);
      if (path === targetPath) { ancestors.forEach(a => next.add(a)); found = true; return; }
      node.children.forEach(c => walk(c, path, [...ancestors, path]));
    };
    walk(tree, '', []);

    if (found) this._expandedNodes = next;
  }

  /** Rebuild `_expandedNodes` from the current display mode. */
  private _applyTreeMode()
  {
    const tree = scenegraph.get();
    if (!tree) { this._expandedNodes = new Set(); return; }

    const expanded = new Set<string>();
    if (this._minimized)
    {
      // minimized: keep only nodes shallower than the configured level expanded
      this._collectPathsToDepth(tree, '', 0, expanded);
    }
    else
    {
      // maximized: expand everything (default)
      this._collectPaths(tree, '', expanded);
    }
    this._expandedNodes = expanded;
  }

  /** Collect paths of nodes whose depth is below the minimized level (so their
   *  children remain visible); deeper nodes stay collapsed. */
  private _collectPathsToDepth(node: SceneNodeData, parentPath: string, depth: number, set: Set<string>)
  {
    const path = buildScenegraphPath(parentPath, node.name);
    if (depth < SCENE_EXPLORER_MINIMIZED_TREE_LEVEL) set.add(path);
    node.children.forEach(c => this._collectPathsToDepth(c, path, depth + 1, set));
  }

  /** Select this node (toggles off if already selected). Drives the viewer
   *  highlight and, for onClick shapes, the re-run. */
  private _select(path: string)
  {
    setSelectedPath(selectedPath.get() === path ? null : path);
  }

  private _toggleExpand(path: string)
  {
    const next = new Set(this._expandedNodes);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this._expandedNodes = next;
  }

  private _collectPaths(node: SceneNodeData, parentPath: string, set: Set<string>)
  {
    const path = buildScenegraphPath(parentPath, node.name);
    set.add(path);
    node.children.forEach(c => this._collectPaths(c, path, set));
  }

  // ── Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      border-top: 1px solid var(--color-border);
      background: var(--color-bg-elevated);
      overflow: hidden;
    }

    *,
    *::before,
    *::after { box-sizing: border-box; }

    /* ── Header ── */

    .header {
      display: flex;
      align-items: center;
      gap: var(--space-sm, 8px);
      padding: 0.35rem 1rem;
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

    /* minimize / collapse tree toggle */
    .mini-btn {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-gray-dark, #666);
      font-size: 12px;
    }

    .mini-btn:hover { color: var(--color-text); }

    /* ── Subheader (tree toolbar) ── */

    .subheader {
      display: flex;
      align-items: center;
      gap: var(--space-sm, 8px);
      padding: 4px 6px 4px 10px;
      flex-shrink: 0;
      user-select: none;
      border-bottom: 1px solid var(--color-border);
    }

    /* search box */
    .search-wrap {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 1px 4px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg, #fff);
    }

    .search-wrap:focus-within {
      border-color: var(--color-primary, #3b82f6);
    }

    .search-icon {
      flex-shrink: 0;
      font-size: 11px;
      color: var(--color-gray-dark, #666);
    }

    .search-input {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      background: transparent;
      font-family: var(--font-sans);
      font-size: 0.72rem;
      color: var(--color-text);
    }

    .search-clear {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-gray-dark, #666);
      font-size: 9px;
    }

    .search-clear:hover { color: var(--color-text); }

    /* ── Tree ── */

    .tree {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 4px 0;
    }

    .empty {
      padding: 0.5rem 1rem;
      color: var(--color-text-muted, #6b7280);
      font-size: var(--text-sm);
    }

    .node-row {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 26px;
      padding-right: 6px;
      cursor: default;
    }

    .node-row:hover {
      background: color-mix(in srgb, var(--color-border) 30%, transparent);
    }

    .node-row.selected {
      background: color-mix(in srgb, var(--color-primary, #3b82f6) 22%, transparent);
    }

    /* expand chevron */
    .expand-btn {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-gray-dark, #666);
      font-size: 10px;
    }

    .expand-btn:disabled {
      cursor: default;
      opacity: 0;
    }

    /* type icon */
    .node-icon {
      flex-shrink: 0;
      font-size: 11px;
      color: var(--color-gray-dark, #666);
    }

    /* name */
    .node-name {
      flex: 1;
      font-size: 0.72rem;
      font-family: var(--font-mono, monospace);
      color: var(--color-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }

    .node-name.faded { opacity: 0.35; }

    /* search hit highlight — strong primary */
    .node-name.match {
      background: var(--color-primary, #3b82f6);
      border-radius: 3px;
      padding: 0 3px;
      font-weight: 600;
      color: #fff;
    }

    /* material swatch */
    .mat-swatch {
      flex-shrink: 0;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      border: 1px solid rgba(0,0,0,0.15);
    }

    .mat-opacity {
      flex-shrink: 0;
      font-size: 0.65rem;
      color: var(--color-text-muted, #6b7280);
    }

    /* visibility toggle */
    .vis-btn {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text, #111);
      font-size: 11px;
      opacity: 0;
      transition: opacity 0.1s;
    }

    .node-row:hover .vis-btn { opacity: 1; }
    .node-row .vis-btn[title="Show node"] { opacity: 0.5; }
    .node-row:hover .vis-btn[title="Show node"] { opacity: 1; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'scene-explorer': SceneExplorer;
  }
}
