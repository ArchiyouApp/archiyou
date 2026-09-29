/**
 * <editor-versions-tool> — the active script's history on the server: browse the saved
 * versions, see what changed, and bring one back.
 *
 * The server merges autosaves into one row per stretch of work (ScriptStore.saveVersion),
 * so the list reads as checkpoints rather than keystrokes. Selecting a row shows what
 * restoring it would change: a read-only unified diff of the current code against that
 * version (@codemirror/merge, loaded the first time one opens) and a readout of the
 * params and presets that differ. Restoring brings back code, params and presets as a
 * new row, and fires `version-restore` so the page re-runs the script.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '../../version-pill.js';

import { EditorView, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';

import type { ScriptData } from '@archiyou/core/src/execution/types';
import { editorScript, isReadOnly, userState, restoreScriptVersion } from '@archiyou/editor/src/state/workspace';
import { listFileVersions, fetchFileVersion, type VersionMeta } from '@archiyou/editor/src/services/scripts-sync';
import { codeTheme } from '../codebox.js';

/** Rows shown before "Show more", and how many more each click adds. */
const PAGE_SIZE = 100;

/** Param fields that are bookkeeping rather than something a user set. */
const HIDDEN_FIELDS = new Set(['name', 'order', '_definedProgrammatically', '_behaviours']);

/** One param (or preset) that differs between the current script and a version. */
interface EntryChange
{
  name: string;
  kind: 'added' | 'removed' | 'changed';
  /** For 'changed': each differing field, current value → the version's. */
  fields: Array<{ field: string; from: string; to: string }>;
}

/** The diff extension, imported once, on first use: it stays out of the startup bundle. */
let mergeModule: Promise<typeof import('@codemirror/merge')> | null = null;

@customElement('editor-versions-tool')
export class EditorVersionsTool extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    if (userState.get().anonymous)
    {
      return this._renderEmpty('log-in', msg('Sign in to keep version history'));
    }
    if (!editorScript.get() || isReadOnly.get())
    {
      return this._renderEmpty('lock', msg('History is only available for your own scripts'));
    }

    const selected = this._rows.find(r => r.id === this._selectedId);
    return html`
      <div class="bar">
        <span class="count">
          ${this._loading ? msg('Loading…')
            : this._rows.length === 1 ? msg('1 version') : msg(str`${this._rows.length} versions`)}
        </span>
        <wa-button size="small" appearance="plain" title=${msg('Refresh')} @click=${() => this._load()}>
          <wa-icon library="lucide" name="refresh-cw" label=${msg('Refresh')}></wa-icon>
        </wa-button>
      </div>
      ${this._rows.length === 0 && !this._loading
        ? this._renderEmpty('history', msg('No saved versions yet'))
        : html`<div class="list ${selected ? 'has-detail' : ''}">${this._renderList()}</div>`}
      ${selected ? this._renderDetail(selected) : nothing}
    `;
  }

  private _renderList()
  {
    const shown = this._rows.slice(0, this._limit);
    return html`
      ${this._groupByDay(shown).map(group => html`
        <h5>${group.label}</h5>
        <ul>
          ${group.rows.map(row => this._renderRow(row))}
        </ul>
      `)}
      ${this._rows.length > this._limit
        ? html`
          <wa-button class="more" size="small" appearance="outlined" @click=${() => { this._limit += PAGE_SIZE; }}>
            ${msg('Show more')}
          </wa-button>`
        : nothing}
    `;
  }

  private _renderRow(row: VersionMeta)
  {
    const index = this._rows.findIndex(r => r.id === row.id);
    const older = this._rows[index + 1];
    // The name is the same on nearly every row: show it where it starts (a rename, or the first version)
    const showName = !older || older.name !== row.name;
    return html`
      <li class=${row.id === this._selectedId ? 'selected' : ''} @click=${() => this._select(row.id)}>
        <span class="time" title=${timeSpan(row)}>${clockTime(row.updated)}</span>
        <span class="name">${showName ? row.name ?? msg('untitled') : nothing}</span>
        ${row.version ? html`<version-pill version=${row.version}></version-pill>` : nothing}
        ${index === 0 ? html`<span class="current">${msg('Current')}</span>` : nothing}
        <span class="lines">${row.lines === 1 ? msg('1 line') : msg(str`${row.lines} lines`)}</span>
      </li>
    `;
  }

  private _renderDetail(row: VersionMeta)
  {
    const data = this._versions.get(this._cacheKey(row));
    const current = editorScript.get()?.toData();
    const params = data && current ? entryChanges(current.params, data.params) : [];
    const presets = data && current ? entryChanges(current.presets, data.presets) : [];

    return html`
      <div class="detail">
        <div class="detail-bar">
          <span class="caption">${msg('Current → this version')}</span>
          <wa-button size="small" variant="brand" ?loading=${this._restoring}
              ?disabled=${!data || this._sameAsCurrent(data)} @click=${this._restore}>
            <wa-icon slot="start" library="lucide" name="history"></wa-icon>
            ${msg('Restore')}
          </wa-button>
        </div>
        ${params.length || presets.length
          ? html`
            <div class="changes">
              ${this._renderChanges(msg('Params'), params)}
              ${this._renderChanges(msg('Presets'), presets)}
            </div>`
          : nothing}
        <div class="diff">${data ? nothing : html`<span class="loading">${msg('Loading…')}</span>`}</div>
      </div>
    `;
  }

  /** What differs per param (or preset): added, removed, or which fields changed and how. */
  private _renderChanges(title: string, changes: EntryChange[])
  {
    if (!changes.length) return nothing;
    return html`
      <h5>${title}</h5>
      <ul>
        ${changes.map(c => html`
          <li class=${c.kind}>
            <span class="entry">${c.kind === 'added' ? '+ ' : c.kind === 'removed' ? '− ' : ''}${c.name}</span>
            ${c.kind === 'added' ? html`<span class="field">${msg('only in this version')}</span>` : nothing}
            ${c.kind === 'removed' ? html`<span class="field">${msg('not in this version')}</span>` : nothing}
            ${c.fields.map(f => html`
              <span class="field">${f.field} <span class="from">${f.from}</span> → <span class="to">${f.to}</span></span>
            `)}
          </li>
        `)}
      </ul>
    `;
  }

  private _renderEmpty(icon: string, text: string)
  {
    return html`
      <div class="empty">
        <wa-icon library="lucide" name=${icon}></wa-icon>
        <span>${text}</span>
      </div>
    `;
  }

  // ── 2. State ──
  @state() private _rows: VersionMeta[] = [];
  @state() private _loading = false;
  @state() private _limit = PAGE_SIZE;
  @state() private _selectedId: string | null = null;
  @state() private _restoring = false;
  /** Full versions by id + `updated`: the newest row changes under its id while autosaves
   *  merge into it, so the id alone would serve a stale copy. */
  @state() private _versions = new Map<string, ScriptData>();

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    this._themeObserver.disconnect();
    this._diffView?.destroy();
    this._diffView = null;
    this._diffKey = '';
  }

  override willUpdate()
  {
    // The tool opening, another script becoming the active one, or signing in
    const fileId = editorScript.get()?.fileId ?? null;
    const user = userState.get().id ?? null;
    if (fileId !== this._fileId || user !== this._user)
    {
      this._fileId = fileId;
      this._user = user;
      this._selectedId = null;
      this._rows = [];
      this._versions = new Map();
      void this._load();
    }
  }

  override updated()
  {
    void this._renderDiff();
  }

  // ── 4. Behaviour & Methods ──
  private _fileId: string | null = null;
  private _user: string | null = null;
  private _loadToken = 0;
  private _diffView: EditorView | null = null;
  /** What the diff view currently shows (version, current code and theme), so it rebuilds only on a change. */
  private _diffKey = '';
  private _themeObserver = new MutationObserver(() =>
  {
    this._diffKey = '';
    this.requestUpdate();
  });

  private async _load()
  {
    const fileId = this._fileId;
    const token = ++this._loadToken;
    if (!fileId || userState.get().anonymous) { this._rows = []; return; }
    this._loading = true;
    const rows = await listFileVersions(fileId);
    if (token !== this._loadToken) return;
    this._rows = rows;
    this._loading = false;
    if (this._selectedId && !rows.some(r => r.id === this._selectedId)) this._selectedId = null;
    const selected = rows.find(r => r.id === this._selectedId);
    if (selected) void this._fetch(selected);
  }

  private _select(id: string)
  {
    this._selectedId = this._selectedId === id ? null : id;
    const selected = this._rows.find(r => r.id === this._selectedId);
    if (selected) void this._fetch(selected);
  }

  private async _fetch(row: VersionMeta)
  {
    const key = this._cacheKey(row);
    if (!this._fileId || this._versions.has(key)) return;
    const data = await fetchFileVersion(this._fileId, row.id);
    if (!data) return;
    this._versions = new Map(this._versions).set(key, data);
  }

  private _cacheKey(row: VersionMeta): string
  {
    return `${row.id}@${row.updated}`;
  }

  private _sameAsCurrent(data: ScriptData): boolean
  {
    const current = editorScript.get()?.toData();
    return !!current
      && current.code === data.code
      && stableJson(current.params) === stableJson(data.params)
      && stableJson(current.presets) === stableJson(data.presets);
  }

  /** Build or refresh the diff: the selected version, with what differs from the current code. */
  private async _renderDiff()
  {
    const host = this.renderRoot.querySelector<HTMLElement>('.diff');
    const row = this._rows.find(r => r.id === this._selectedId);
    const data = row && this._versions.get(this._cacheKey(row));
    const base = editorScript.get();
    if (!host || !data || !base)
    {
      this._diffView?.destroy();
      this._diffView = null;
      this._diffKey = '';
      return;
    }

    const key = `${this._cacheKey(row)}|${document.documentElement.dataset['theme'] ?? ''}|${base.code}`;
    if (key === this._diffKey && this._diffView?.dom.isConnected) return;
    this._diffKey = key;

    mergeModule ??= import('@codemirror/merge');
    const { unifiedMergeView } = await mergeModule;
    if (key !== this._diffKey) return; // superseded while the module loaded

    this._diffView?.destroy();
    this._diffView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: data.code,
        extensions: [
          lineNumbers(),
          javascript(),
          codeTheme(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          unifiedMergeView({
            original: base.code,
            mergeControls: false,
            syntaxHighlightDeletions: true,
            collapseUnchanged: { margin: 3, minSize: 6 },
          }),
        ],
      }),
    });
  }

  private async _restore()
  {
    const row = this._rows.find(r => r.id === this._selectedId);
    const data = row && this._versions.get(this._cacheKey(row));
    if (!data) return;
    this._restoring = true;
    try
    {
      await restoreScriptVersion(data);
      this.dispatchEvent(new CustomEvent<ScriptData>('version-restore', {
        detail: data,
        bubbles: true,
        composed: true,
      }));
    }
    finally
    {
      this._restoring = false;
    }
    this._selectedId = null;
    await this._load();
  }

  /** Rows (newest first) under a heading per day. */
  private _groupByDay(rows: VersionMeta[]): Array<{ label: string; rows: VersionMeta[] }>
  {
    return rows.reduce((groups, row) =>
    {
      const label = dayLabel(row.updated);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.rows.push(row);
      else groups.push({ label, rows: [row] });
      return groups;
    }, [] as Array<{ label: string; rows: VersionMeta[] }>);
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
      background: var(--color-bg-elevated);
    }

    *, *::before, *::after { box-sizing: inherit; }

    .bar,
    .detail-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-xs) var(--space-sm);
      padding: var(--space-xs) var(--space-md);
      flex-shrink: 0;
      border-bottom: 1px solid var(--color-border);
    }

    .count {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .list {
      flex: 1;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      padding: var(--space-xs) 0 var(--space-md);
    }

    .list.has-detail {
      flex: 0 0 auto;
      max-height: 40%;
      border-bottom: 1px solid var(--color-border);
    }

    h5 {
      margin: var(--space-sm) var(--space-md) var(--space-xs);
      font-size: var(--text-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .04em;
      color: var(--color-text-muted);
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-height: var(--hit-min);
      padding: 0 var(--space-md);
      cursor: pointer;
    }

    li:hover { background: var(--color-surface-subtle); }
    li.selected { background: var(--color-primary-subtle); }

    .time {
      flex-shrink: 0;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .current {
      flex-shrink: 0;
      font-size: var(--text-x-xs);
      font-weight: 600;
      text-transform: uppercase;
      color: var(--color-primary);
    }

    .lines {
      flex-shrink: 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .more {
      display: block;
      margin: var(--space-sm) auto 0;
      width: fit-content;
    }

    .detail {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    .caption {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .changes {
      flex-shrink: 0;
      max-height: 30%;
      overflow-y: auto;
      padding-bottom: var(--space-xs);
      border-bottom: 1px solid var(--color-border);
      font-size: var(--text-xs);
    }

    .changes li {
      flex-wrap: wrap;
      gap: 0 var(--space-sm);
      min-height: 0;
      padding: 2px var(--space-md);
      cursor: default;
    }

    .changes li:hover { background: none; }

    .changes .entry {
      font-family: var(--font-mono, monospace);
      font-weight: 600;
    }

    .changes .added .entry { color: var(--color-success); }
    .changes .removed .entry { color: var(--color-alert); }

    .changes .field { color: var(--color-text-muted); }
    .changes .from { color: var(--color-alert); }
    .changes .to { color: var(--color-success); }

    .diff {
      flex: 1;
      min-height: 0;
      overflow: auto;
      background: var(--color-bg-code);
    }

    .diff .cm-editor {
      font-size: var(--text-xs);
    }

    .diff .cm-editor.cm-focused {
      outline: none;
    }

    .loading {
      display: block;
      padding: var(--space-md);
      color: var(--color-text-muted);
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      flex: 1;
      padding: var(--space-lg);
      text-align: center;
      color: var(--color-text-muted);
    }

    .empty wa-icon {
      font-size: 1.5rem;
    }
  `;
}

function clockTime(epochMs: number): string
{
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** When a row was worked on: from its first save to its last (autosaves merge into it). */
function timeSpan(row: VersionMeta): string
{
  const from = clockTime(row.created);
  const to = clockTime(row.updated);
  return from === to ? to : `${from} – ${to}`;
}

/** "Today", "Yesterday" or the date, for the day headings. */
function dayLabel(epochMs: number): string
{
  const day = new Date(epochMs).toDateString();
  const today = new Date();
  if (day === today.toDateString()) return msg('Today');
  if (day === new Date(today.getTime() - 86_400_000).toDateString()) return msg('Yesterday');
  return new Date(epochMs).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** The params (or presets) that differ between the current script and a version, by name.
 *  Fields are compared flattened (`schema.minimum` reads as `minimum`, `_value` as `value`),
 *  so a changed default or range shows as just that field. */
function entryChanges(
  current: Record<string, unknown> | undefined,
  version: Record<string, unknown> | undefined,
): EntryChange[]
{
  const from = current ?? {};
  const to = version ?? {};
  const names = [...new Set([...Object.keys(from), ...Object.keys(to)])];
  return names.flatMap((name): EntryChange[] =>
  {
    if (!(name in from)) return [{ name, kind: 'added', fields: [] }];
    if (!(name in to)) return [{ name, kind: 'removed', fields: [] }];
    const a = flatten(from[name]);
    const b = flatten(to[name]);
    const fields = [...new Set([...a.keys(), ...b.keys()])]
      .map(path => ({ field: fieldLabel(path), from: a.get(path) ?? '–', to: b.get(path) ?? '–' }))
      .filter(f => f.from !== f.to);
    return fields.length ? [{ name, kind: 'changed', fields }] : [];
  });
}

/** Leaf values of a param (or preset) by dotted path, as short display strings. */
function flatten(value: unknown, prefix = ''): Map<string, string>
{
  if (!value || typeof value !== 'object' || Array.isArray(value))
  {
    return new Map([[prefix, displayValue(value)]]);
  }
  // Unset fields are left out: a live param carries them as undefined, a stored one not at all
  return Object.entries(value)
    .filter(([key, v]) => !HIDDEN_FIELDS.has(key) && v !== undefined)
    .reduce((out, [key, v]) =>
    {
      flatten(v, prefix ? `${prefix}.${key}` : key).forEach((text, path) => out.set(path, text));
      return out;
    }, new Map<string, string>());
}

function fieldLabel(path: string): string
{
  return path.split('.').filter(part => part !== 'schema').map(part => part.replace(/^_/, '')).join(' ') || 'value';
}

function displayValue(value: unknown): string
{
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '–';
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** JSON with object keys sorted, so equal params compare equal whatever their key order. */
function stableJson(value: unknown): string
{
  return JSON.stringify(value ?? {}, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v);
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-versions-tool': EditorVersionsTool;
  }
}
