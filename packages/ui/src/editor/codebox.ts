/**
 * <code-editor> — CodeMirror 6 wrapper.
 *
 * Properties:
 *   value   — current code string (set from outside)
 *
 * Events:
 *   change  — CustomEvent<string> fired on every editor change
 *   execute — CustomEvent<string> fired when the user triggers Run (Ctrl+Enter)
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Webawesome imports
import '@awesome.me/webawesome/dist/components/split-panel/split-panel.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';

// CodeMirror imports
import { EditorView, basicSetup } from 'codemirror';
import { keymap, Decoration, DecorationSet } from '@codemirror/view';
import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { archiyouCompletions, registerModuleCompletions, registerComponentNames } from './completions.js';
import { moduleCatalog } from '@archiyou/editor/src/services/module-service';
import { authService } from '@archiyou/editor/src/services/auth-service';
import { fetchPublicShared, fetchSharedWithMe } from '@archiyou/editor/src/services/sharing';

import { SignalWatcher } from '@lit-labs/signals';
import { executing, executionResult, perStatement, autoRun, kernel, scripts, editorScript } from '@archiyou/editor/src/state/workspace';

// ── Shared components for $component() completions ───────────────────────────
/** How long a fetched list of shared components is used before fetching it again. */
const SHARED_COMPONENTS_TTL_MS = 60_000;
let _sharedComponents: { user: string | undefined; at: number; labels: string[] } | null = null;
let _sharedComponentsLoading = false;

/** All shared scripts, own shares included, as `@author/name`, sorted. Returns the cached list at
 *  once (empty the first time) and refreshes it in the background when stale or when
 *  the user changed — completion sources are synchronous. */
function sharedComponentNames(user: string | undefined): string[]
{
  const cached = _sharedComponents;
  const fresh = cached !== null && cached.user === user && Date.now() - cached.at < SHARED_COMPONENTS_TTL_MS;
  if (!fresh && !_sharedComponentsLoading)
  {
    _sharedComponentsLoading = true;
    Promise.all([fetchPublicShared(), fetchSharedWithMe()])
      .then(lists =>
      {
        const labels = lists.flat()
          .filter(d => d?.author && d?.name)
          .map(d => `@${d.author}/${d.name}`.toLowerCase());
        _sharedComponents = { user, at: Date.now(), labels: Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b)) };
      })
      .catch(() => { _sharedComponents = { user, at: Date.now(), labels: [] }; })
      .finally(() => { _sharedComponentsLoading = false; });
  }
  return cached && cached.user === user ? cached.labels : [];
}

/** Light-mode syntax colours, driven by the --color-code-* design tokens.
 *
 *  CodeMirror compiles these into real CSS rules inside the shadow root, so
 *  var() resolves against :root and the palette follows the design system
 *  instead of hard-coding hexes here.
 *
 *  Plain variable references are the brand blue, which is what makes $PARAM
 *  lookups stand out; anything being *called* or *defined* stays ink-coloured,
 *  so `units(...)` and `const WIDTH` read as structure rather than data. */
const lightHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--color-code-comment)', fontStyle: 'italic' },

  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword,
          t.operatorKeyword, t.modifier, t.self, t.null, t.atom],
    color: 'var(--color-code-keyword)' },

  { tag: [t.string, t.special(t.string), t.regexp, t.escape],
    color: 'var(--color-code-string)' },

  { tag: [t.number, t.bool, t.integer, t.float, t.unit],
    color: 'var(--color-code-number)' },

  // Callees, declarations and members: the code's skeleton.
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName,
          t.definition(t.variableName), t.definition(t.propertyName),
          t.className, t.typeName, t.namespace, t.labelName],
    color: 'var(--color-code-ident)' },

  // Bare references — $PARAM lookups land here.
  { tag: [t.variableName, t.special(t.variableName)],
    color: 'var(--color-primary)' },

  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.paren, t.brace],
    color: 'var(--color-code-ident)' },

  { tag: t.meta, color: 'var(--color-code-comment)' },
  { tag: t.invalid, color: 'var(--color-alert)' },
  { tag: t.link, color: 'var(--color-primary)', textDecoration: 'underline' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
]);

const lightTheme = [
  EditorView.theme({}, { dark: false }),
  syntaxHighlighting(lightHighlightStyle),
];
const themeCompartment = new Compartment();
// Toggles editability without rebuilding the editor (read-only shared scripts).
const editableCompartment = new Compartment();

// ── Error-line highlight ──────────────────────────────────────────────────────
/** Effect: set a 1-indexed line number, 'all' for every line, or null to clear. */
const setErrorLine = StateEffect.define<number | 'all' | null>();
const errorLineMark = Decoration.line({ class: 'cm-error-line' });

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr)
  {
    for (const effect of tr.effects)
    {
      if (!effect.is(setErrorLine)) continue;
      if (effect.value === null) return Decoration.none;
      if (effect.value === 'all')
      {
        const marks: ReturnType<typeof errorLineMark.range>[] = [];
        for (let i = 1; i <= tr.state.doc.lines; i++)
          marks.push(errorLineMark.range(tr.state.doc.line(i).from));
        return Decoration.set(marks);
      }
      // Single line — guard against out-of-range
      if (effect.value < 1 || effect.value > tr.state.doc.lines) return Decoration.none;
      const line = tr.state.doc.line(effect.value);
      return Decoration.set([errorLineMark.range(line.from)]);
    }
    return deco.map(tr.changes);
  },
  provide: f => EditorView.decorations.from(f),
});


@customElement('editor-code-box')
export class CodeBox extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const result = executionResult.get();
    const error = result?.errors?.[0];

    return html`
      <div class="wrapper">
        <div class="title-bar">
          <wa-icon library="lucide" name="code"></wa-icon>
          <span class="title">code editor</span>
          <span class="state">
            ${executing.get()
                ? html`<wa-icon library="lucide" name="settings" animation="spin-reverse" label="executing"></wa-icon>`
                : result?.status === 'error'
                    ? html`<wa-icon class="error-icon" library="lucide" name="circle-x" label="error"></wa-icon>`
                    : result?.status === 'success'
                        ? html`
                            <wa-icon class="success-icon" library="lucide" name="circle-check" label="success"></wa-icon>
                            <span class="duration">${this._formatDuration(result.duration)}</span>`
                        : ''
            }
          </span>
          <span class="spacer"></span>
          <button class="execute-button" data-help="run"
              @click=${this._handleRunClick} title="Run (Ctrl+Enter)">
              <wa-icon library="lucide" name="play" label="Execute"></wa-icon>
          </button>
          <div class="options-wrap">
            <button class="options-button ${this._optionsOpen ? 'active' : ''}"
                @click=${this._toggleOptions}
                title="Execution options"
                aria-label="Execution options">
              <wa-icon library="lucide" name="ellipsis-vertical"></wa-icon>
            </button>
            ${this._optionsOpen ? html`
              <div class="options-menu" @click=${(e: Event) => e.stopPropagation()}>
                <div class="options-menu-header">
                  <span class="options-menu-title">Execute options</span>
                  <button class="options-close" @click=${this._closeOptions} aria-label="Close">
                    <wa-icon library="lucide" name="x"></wa-icon>
                  </button>
                </div>
                <wa-checkbox
                    size="small"
                    ?checked=${perStatement.get()}
                    @change=${this._handlePerStatementChange}
                >Execute per statement</wa-checkbox>
                <wa-checkbox
                    size="small"
                    ?checked=${autoRun.get()}
                    @change=${this._handleAutoRunChange}
                >Automatic execute</wa-checkbox>
                <div class="options-field">
                  <span class="options-field-label">Geometry kernel</span>
                  ${this._renderKernelToggle()}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
        ${result?.status === 'error'
          ? html`
              <div class="subheader subheader-error ${typeof error?.lineStart === 'number' && error.lineStart > 0 ? 'subheader-error--clickable' : ''}"
                title=${typeof error?.lineStart === 'number' && error.lineStart > 0
                    ? `ERROR at line ${error.lineStart}: "${this._displayErrorMessage(error)}"`
                    : `ERROR: "${this._displayErrorMessage(error)}"`}
                @click=${() => this._goToErrorLine(error?.lineStart)}>
                <wa-icon class="subheader-error-icon" library="lucide" name="triangle-alert" label="error"></wa-icon>
                <span class="subheader-error-text">${typeof error?.lineStart === 'number' && error.lineStart > 0
                    ? `ERROR at line ${error.lineStart}: "${this._displayErrorMessage(error)}"`
                    : `ERROR: "${this._displayErrorMessage(error)}"`
                  }</span>
              </div>
            `
          : ''}
        <div class="cm-container"></div>
      </div>
    `;
  }

  // ── 2. Properties ──
  @property({ type: String }) code = '';
  /** When true the document is read-only (e.g. a foreign shared script). Run
   *  stays available; only editing is blocked. */
  @property({ type: Boolean }) readonly = false;

  // ── 3. Lifecycle ──
  override firstUpdated()
  {
    // $component('@author/name') completions: the own workspace scripts minus the one being
    // edited (a script cannot be its own component) as `:dev` (their latest version), then
    // everything shared, own shares included. Read when
    // completing, not here: editorScript changes on every edit, and reading it during a
    // Lit update would re-render the codebox per keystroke.
    registerComponentNames(() =>
    {
      const me = authService.getUser()?.id;
      const active = editorScript.get();
      const own = scripts.get()
        .filter(s => s.fileId !== active?.fileId && s.name)
        .map(s => ({ label: me ? `@${s.author ?? me}/${s.name}:dev` : s.name as string, own: true }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const shared = sharedComponentNames(me)
        .filter(label => !own.some(o => o.label === label))
        .map(label => ({ label, own: false }));
      return [...own, ...shared];
    });

    const container = this.renderRoot.querySelector<HTMLElement>('.cm-container')!;

    this._view = new EditorView({
      state: EditorState.create({
        doc: this.code,
        extensions: [
          basicSetup,
          errorLineField,
          javascript({ typescript: true }),
          autocompletion({ override: [archiyouCompletions] }),
          keymap.of([
            {
              key: 'Tab',
              run: (view) =>
              {
                // If the autocomplete popup is open, Tab accepts the active suggestion
                // instead of indenting.
                if (completionStatus(view.state) === 'active' && acceptCompletion(view)) return true;

                const { state } = view;
                // If the selection spans multiple lines, indent each line
                const sel = state.selection.main;
                const fromLine = state.doc.lineAt(sel.from);
                const toLine   = state.doc.lineAt(sel.to);
                if (fromLine.number !== toLine.number || sel.empty === false && sel.to > sel.from)
                {
                  // Indent every line that the selection touches
                  const changes = state.changeByRange(range =>
                  {
                    const startLine = state.doc.lineAt(range.from);
                    const endLine   = state.doc.lineAt(range.to);
                    const inserts: { from: number; insert: string }[] = [];
                    for (let ln = startLine.number; ln <= endLine.number; ln++)
                    {
                      inserts.push({ from: state.doc.line(ln).from, insert: '  ' });
                    }
                    const cs = state.changes(inserts);
                    return { changes: cs, range: range.map(cs) };
                  });
                  view.dispatch(state.update(changes, { userEvent: 'input' }));
                }
                else
                {
                  view.dispatch(state.update(state.replaceSelection('  '), { scrollIntoView: true, userEvent: 'input' }));
                }
                return true;
              },
            },
            {
              key: 'Shift-Tab',
              run: (view) =>
              {
                const { state } = view;
                const changes = state.changeByRange(range =>
                {
                  const line = state.doc.lineAt(range.from);
                  const text = line.text;
                  const stripped = text.startsWith('    ') ? text.slice(4)
                    : text.startsWith('  ') ? text.slice(2)
                    : text.startsWith('\t') ? text.slice(1)
                    : text;
                  const removed = text.length - stripped.length;
                  return removed === 0
                    ? { range }
                    : {
                        changes: { from: line.from, to: line.from + removed, insert: '' },
                        range: range.map(state.changes({ from: line.from, to: line.from + removed, insert: '' })),
                      };
                });
                view.dispatch(state.update(changes, { userEvent: 'delete' }));
                return true;
              },
            },
            {
              key: 'Ctrl-Enter',
              mac: 'Cmd-Enter',
              run: () => { this._fireExecute(); return true; },
            },
            {
              // Help for the word at the cursor (the help panel's API reference)
              key: 'F1',
              run: view => { this._fireCursor('help-lookup', view); return true; },
            },
          ]),
          themeCompartment.of(this._currentTheme()),
          editableCompartment.of(this._editableExtension()),
          EditorView.updateListener.of(update =>
          {
            if (update.docChanged)
            {
              this._skipNextUpdate = true;
              this.dispatchEvent(new CustomEvent<string>('change', {
                detail: update.state.doc.toString(),
                bubbles: true,
                composed: true,
              }));
            }
            if (update.docChanged || update.selectionSet)
            {
              this._fireCursor('cursor-change', update.view);
            }
          }),
        ],
      }),
      parent: container,
    });

    // Switch theme when prefers-color-scheme changes
    this._darkMQ.addEventListener('change', this._onColorSchemeChange);

    // Switch theme when data-theme attribute changes on <html>
    this._themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('readonly') && this._view)
    {
      this._view.dispatch({
        effects: editableCompartment.reconfigure(this._editableExtension()),
      });
    }

    if (changed.has('code') && this._view && !this._skipNextUpdate)
    {
      const current = this._view.state.doc.toString();
      if (current !== this.code)
      {
        this._view.dispatch({
          changes: { from: 0, to: current.length, insert: this.code },
        });
      }
    }
    this._skipNextUpdate = false;

    // Autocomplete for the entitled script modules. Driven off the catalog signal
    // here rather than from module-service, which loads it: that service is also on
    // the published configurator's import path, and completions.ts pulls in CodeMirror
    // — so registering there made every configurator download a code editor it never
    // renders. Reference comparison is enough; the service replaces the array.
    const modules = moduleCatalog.get();
    if (modules !== this._registeredModules)
    {
      this._registeredModules = modules;
      registerModuleCompletions(modules);
    }

    // Sync error-line highlight whenever the execution result signal changes
    const result = executionResult.get();
    if (result !== this._lastAppliedResult)
    {
      this._lastAppliedResult = result;
      this._applyErrorHighlight(result);
    }
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    this._darkMQ.removeEventListener('change', this._onColorSchemeChange);
    this._themeObserver.disconnect();
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
    this._view?.destroy();
    this._view = null;
  }

  // ── 4. Behaviour & Methods ──
  @state() private _optionsOpen = false;
  private _view: EditorView | null = null;
  private _skipNextUpdate = false;
  /** Last catalog registered for autocomplete, compared by reference. */
  private _registeredModules: unknown = null;
  private _lastAppliedResult: ReturnType<typeof executionResult.get> | undefined = undefined;
  private _darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

  /** Editability extensions derived from the `readonly` property. */
  private _editableExtension()
  {
    return [
      EditorView.editable.of(!this.readonly),
      EditorState.readOnly.of(this.readonly),
    ];
  }

  private _currentTheme()
  {
    // data-theme is always set now (light or dark), so it decides; the media
    // query is only a fallback for the first paint before the theme is applied.
    const attr = document.documentElement.dataset['theme'];
    const isDark = attr ? attr === 'dark' : this._darkMQ.matches;
    return isDark ? oneDark : lightTheme;
  }

  /** Get the current editor text. */
  getCode(): string
  {
    return this._view?.state.doc.toString() ?? this.code;
  }

  private _fireExecute()
  {
    this.dispatchEvent(new CustomEvent<string>('execute', {
      detail: this.getCode(),
      bubbles: true,
      composed: true,
    }));
  }

  /** Tell the page where the cursor is ('cursor-change'), or ask for help on the word
   *  there ('help-lookup', F1). The API reference works out the word from code + pos. */
  private _fireCursor(type: 'cursor-change' | 'help-lookup', view: EditorView)
  {
    this.dispatchEvent(new CustomEvent<{ code: string, pos: number }>(type, {
      detail: { code: view.state.doc.toString(), pos: view.state.selection.main.head },
      bubbles: true,
      composed: true,
    }));
  }

  private _onColorSchemeChange = () =>
  {
    this._swapTheme();
  };

  private _themeObserver = new MutationObserver(() =>
  {
    this._swapTheme();
  });

  private _swapTheme()
  {
    this._view?.dispatch({
      effects: themeCompartment.reconfigure(this._currentTheme()),
    });
  }

  private _handleRunClick()
  {
    this._fireExecute();
  }

  private _handlePerStatementChange(e: Event)
  {
    // The checkbox emits a bubbling, composed `change` event that would otherwise
    // reach the editor's own @change (code-sync) handler and wipe the script with
    // this event's empty detail. Keep it inside the codebox.
    e.stopPropagation();
    perStatement.set((e.target as HTMLInputElement).checked);
  }

  private _handleAutoRunChange(e: Event)
  {
    e.stopPropagation(); // same reason as _handlePerStatementChange
    autoRun.set((e.target as HTMLInputElement).checked);
  }

  /** Mesh / BREP segmented control — picks the geometry kernel for the next run.
   *  Same shape as the Metric/Imperial control in file-info, one size down to suit the
   *  options menu. Plain buttons rather than a dropdown: one click to switch, and no
   *  composed `change` event to keep out of the editor's code-sync handler. */
  private _renderKernelToggle()
  {
    const active = kernel.get();
    return html`
      <div class="kernel-seg" role="group">
        <button
            class=${`kernel-seg-btn ${active === 'mesh' ? 'active' : ''}`}
            @click=${() => kernel.set('mesh')}
            title="Mesh (meshup): fast and robust — the default">
          Mesh
        </button>
        <button
            class=${`kernel-seg-btn ${active === 'brep' ? 'active' : ''}`}
            @click=${() => kernel.set('brep')}
            title="BREP (OpenCascade): exact geometry, slower — loads a large WASM on first use">
          BREP
        </button>
      </div>
    `;
  }

  private _toggleOptions()
  {
    this._optionsOpen ? this._closeOptions() : this._openOptions();
  }

  private _openOptions()
  {
    this._optionsOpen = true;
    // Close when clicking anywhere outside the menu (composedPath crosses shadow DOM).
    document.addEventListener('pointerdown', this._onDocPointerDown, true);
  }

  private _closeOptions()
  {
    this._optionsOpen = false;
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
  }

  private _onDocPointerDown = (e: Event) =>
  {
    const path = e.composedPath();
    const wrap = this.renderRoot.querySelector('.options-wrap');
    if (wrap && !path.includes(wrap)) { this._closeOptions(); }
  };

  /** Dispatch the error-line effect to the CodeMirror editor. */
  private _applyErrorHighlight(result: ReturnType<typeof executionResult.get>)
  {
    if (!this._view) return;
    if (result?.status !== 'error') {
      this._view.dispatch({ effects: setErrorLine.of(null) });
      return;
    }
    const lineStart = result.errors?.[0]?.lineStart;
    const value: number | 'all' = (typeof lineStart === 'number' && lineStart > 0)
      ? lineStart
      : 'all';
    this._view.dispatch({ effects: setErrorLine.of(value) });
  }

  /** Extract just the useful error message for the header, without execution banners. */
  private _displayErrorMessage(err: { message?: string; lineStart?: number } | undefined): string
  {
    const msg = err?.message;
    if (!msg) return 'Execution error';

    const lines = msg
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => !line.startsWith('****'));

    if (lines.length === 0)
    {
      return 'Execution error';
    }

    const quotedMessage = lines
      .map(line => line.match(/^- error:\s*'(.*)'$/)?.[1])
      .find((line): line is string => Boolean(line && line.trim().length > 0));

    if (quotedMessage)
    {
      return quotedMessage.trim();
    }

    return lines[0];
  }

  /** Navigate CodeMirror to the given 1-based line number. */
  private _goToErrorLine(lineStart: number | undefined): void
  {
    if (!this._view || typeof lineStart !== 'number' || lineStart < 1) return;
    const doc = this._view.state.doc;
    if (lineStart > doc.lines) return;
    const line = doc.line(lineStart);
    this._view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    this._view.focus();
  }

  /** Format a duration in ms to a human-readable string. */
  private _formatDuration(ms: number | undefined): string
  {
    if (ms === undefined || ms === null) return '';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      position: relative;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    .wrapper {
      display: flex;
      flex-direction: column;
      padding: 0;
      flex: 1;
      min-height: 0;
    }

    .title-bar {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      height: var(--space3xl);
      padding: 0 var(--space-md);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
      flex-shrink: 0;
      background: var(--color-bg-elevated);
      border-bottom: 1px solid var(--color-divider);
    }

    .subheader {
      display: flex;
      align-items: flex-start;
      gap: var(--space-xs, 0.5rem);
      padding: var(--space-2xs, 0.25rem) var(--space-md);
      border-bottom: 1px solid var(--color-border);
      font-family: var(--font-sans);
      font-size: var(--text-xs, 0.75rem);
      line-height: 1.35;
      height: auto;
        max-height: 100px;
      white-space: pre-wrap;
        overflow-y: auto;
        overflow-x: hidden;
      overflow-wrap: anywhere;
      word-break: break-word;
      flex-shrink: 0;
    }

    .subheader-error-icon {
      flex-shrink: 0;
      margin-top: 1px;
    }

    .subheader-error-text {
      flex: 1;
      min-width: 0;
    }

    .subheader-error {
      color: var(--wa-color-danger-500, #ef4444);
      background: color-mix(in srgb, var(--wa-color-danger-500, #ef4444) 8%, transparent);
    }

    .subheader-error--clickable {
      cursor: pointer;
    }

    .subheader-error--clickable:hover {
      background: color-mix(in srgb, var(--wa-color-danger-500, #ef4444) 16%, transparent);
      text-decoration: underline;
    }

    .title {
      font-weight: 600;
      color: var(--color-text);
      font-size: var(--text-sm);
    }

    /* Sentence case ("Code editor", not "code editor") — markup untouched. */
    .title::first-letter { text-transform: uppercase; }

    .spacer { flex: 1; }

    .options-wrap {
      position: relative;
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }

    .options-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--color-text);
      cursor: pointer;
      font-size: 0.85rem;
    }

    .options-button:hover,
    .options-button.active {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
    }

    .options-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 20;
      min-width: 190px;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.5rem;
      background: var(--color-bg-elevated, var(--color-gray));
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md, 6px);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    }

    .options-menu-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding-bottom: 0.35rem;
      margin-bottom: 0.1rem;
      border-bottom: 1px solid var(--color-border);
    }

    .options-menu-title {
      font-size: var(--text-xs, 0.75rem);
      font-weight: 600;
      color: var(--color-text);
    }

    .options-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: none;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--color-gray-dark, #9aa0a6);
      cursor: pointer;
      font-size: 0.75rem;
    }

    .options-close:hover {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
      color: var(--color-text);
    }

    .options-menu wa-checkbox {
      font-size: var(--text-xs, 0.75rem);
    }

    /* ── Geometry-kernel segmented control ──
       Label on its own line, pill underneath. Mirrors the Metric/Imperial control in
       file-info.ts, scaled down for this menu. */

    .options-field {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.3rem;
      margin-top: 0.15rem;
    }

    .options-field-label {
      font-size: var(--text-xs, 0.75rem);
      color: var(--color-text);
    }

    .kernel-seg {
      display: inline-flex;
      align-items: stretch;
      align-self: flex-start;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full, 999px);
      overflow: hidden;
    }

    .kernel-seg-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 3.1rem;
      padding: 0.15rem 0.6rem;
      border: none;
      background: var(--color-bg);
      color: var(--color-text-muted);
      font-family: var(--font-sans);
      font-size: var(--text-xs, 0.75rem);
      line-height: 1.5;
      cursor: pointer;
    }

    .kernel-seg-btn + .kernel-seg-btn {
      border-left: 1px solid var(--color-border);
    }

    .kernel-seg-btn:hover {
      background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg));
    }

    .kernel-seg-btn.active {
      background: var(--color-primary);
      color: var(--color-bg);
    }

    .options-menu wa-checkbox::part(label) {
      font-size: var(--text-xs, 0.75rem);
      color: var(--color-text);
      padding-inline-start: 0.3rem;
    }

    .execute-button {
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.6rem;
      color: var(--color-on-primary, #fff);
      background-color: var(--color-primary);
      border-radius: var(--radius-full);
      cursor: pointer;
      flex-shrink: 0;
      border: none;
      box-shadow: 0 2px 6px color-mix(in srgb, var(--color-primary) 45%, transparent);
      transition: background-color 0.1s, box-shadow 0.1s;
    }

    .execute-button:hover {
      background-color: var(--color-primary-dark);
      box-shadow: 0 3px 10px color-mix(in srgb, var(--color-primary) 55%, transparent);
    }

    .cm-container {
      display: flex;
      flex: 1 1 0;
      min-height: 0;
      overflow: hidden;
    }

    /* Override CodeMirror to fill available height */
    .cm-editor {
      height: 100%;
      min-height: 0;
      flex: 1 1 auto;
    }

    /* Smaller font in editor */
    .cm-content,
    .cm-line,
    .cm-gutters {
      font-size: 0.72rem !important;
    }

    /* ── CodeMirror chrome ──
       The code canvas sits one shade under the white panel headers, and the
       gutter shares that surface instead of being a separate ruled column.
       Token colours still come from CodeMirror's own highlight style. */
    .cm-editor,
    .cm-editor .cm-scroller,
    .cm-editor .cm-gutters {
      background: var(--color-bg-code);
    }

    .cm-editor.cm-focused { outline: none; }

    .cm-editor .cm-gutters {
      border-right: none;
      color: var(--color-text-muted);
      padding-right: var(--space-xs);
    }

    .cm-editor .cm-lineNumbers .cm-gutterElement {
      color: color-mix(in srgb, var(--color-text-gray) 55%, transparent);
    }

    /* The caret's line is a tint of the brand blue rather than CodeMirror's
       default grey-blue, and the gutter marks it with the same tint. */
    .cm-editor .cm-activeLine {
      background: color-mix(in srgb, var(--color-primary) 5%, transparent);
    }

    .cm-editor .cm-activeLineGutter {
      background: color-mix(in srgb, var(--color-primary) 5%, transparent);
      color: var(--color-text-gray);
    }

    .cm-editor .cm-cursor,
    .cm-editor .cm-dropCursor {
      border-left-color: var(--color-primary);
      border-left-width: 2px;
    }

    .cm-editor .cm-selectionBackground,
    .cm-editor .cm-content ::selection {
      background: color-mix(in srgb, var(--color-primary) 18%, transparent) !important;
    }

    .cm-editor .cm-foldPlaceholder {
      background: var(--color-surface-subtle);
      border: 1px solid var(--color-divider);
      color: var(--color-text-gray);
    }

    /* Error line highlight (applied via CodeMirror StateField) */
    .cm-error-line {
      background: rgba(239, 68, 68, 0.18) !important;
    }

    /* Error state in title bar */
    .error-icon {
      color: var(--wa-color-danger-500, #ef4444);
      flex-shrink: 0;
    }

    /* Status + duration read as one badge, so the bar has a single "did it run"
       signal instead of an icon and a stray number. Empty between runs, hence
       :has() rather than unconditional padding. */
    .state {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs, 0.25rem);
      font-size: 0.7rem;
    }

    .state:has(.success-icon),
    .state:has(.error-icon) {
      padding: 2px 8px;
      border-radius: var(--radius-full);
    }

    .state:has(.success-icon) {
      background: var(--color-success-subtle);
      color: var(--color-success);
    }

    .state:has(.error-icon) {
      background: color-mix(in srgb, var(--color-alert) 12%, transparent);
      color: var(--color-alert);
    }

    .success-icon {
      color: var(--color-success, #22c55e);
    }

    .duration {
      font-size: var(--text-xs, 0.75rem);
      color: inherit;
      font-weight: 500;
    }

  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-code-box': CodeBox;
  }
}
