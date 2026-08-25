import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';
import '@awesome.me/webawesome/dist/components/popover/popover.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import '@dile/editor/editor.js';
import '../unit-switch.js';

import {
  editorScript,
  userState,
  fileManagerCollapsed,
  setFileManagerCollapsed,
  updateScriptName,
  updateScriptMetadata,
  updateScriptMeta,
  isScriptNameTaken,
  scriptUnitSystem,
  setScriptUnitSystem,
  isReadOnly,
  forkScript,
} from '@archiyou/editor/src/state/workspace';

import type { ScriptMetadata } from '@archiyou/editor/src/state/workspace';
import type { UnitSystem } from '@archiyou/core/src/units/UnitConverter';

import {
  FILE_MANAGER_DISABLED_TOOLBAR_ITEMS,
  SCRIPT_PREDEFINED_TAGS,
} from '@archiyou/editor/src/settings';

import { fetchSharedScript } from '@archiyou/editor/src/services/sharing';
import { fetchPublishedScript } from '@archiyou/editor/src/services/publishing';

import { publicConfiguratorUrl } from './publish-constants';

/** Parse "X.Y…" → [major, minor]; defaults to [0, 0] when unparseable. */
function parseMajorMinor(v: string | null | undefined): [number, number] {
  const m = /^(\d+)\.(\d+)/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** True when `a` is strictly greater than `b` on (major, minor). */
function isHigherVersion(a: string, b: string): boolean {
  const [amaj, amin] = parseMajorMinor(a);
  const [bmaj, bmin] = parseMajorMinor(b);
  return amaj > bmaj || (amaj === bmaj && amin > bmin);
}

// ── Field help explanations — edit here to update all tooltips ────────────────

const FIELD_HELP: Record<string, string> = {
  name:        'The script identifier (lowercase). Used when referencing this script from other scripts or the API.',
  version:     'Automatically set when the script is published. Read-only — use the Publish action to update it.',
  links:       'Public URLs for this script, once shared or published as a configurator.',
  description: 'A one- or two-sentence summary shown in listings and search results.',
  details:     'Full documentation: purpose, usage instructions, parameter notes and any technical background.',
  tags:        'Searchable keywords. Only predefined tags are allowed to keep the catalogue consistent.',
  units:       'The main unit system for this script. Metric works in millimetres (mm); Imperial works in inches (in). It sets the default unit for parameters and how sizes and dimensions are shown. The configurator lets end-users view either system.',
};

@customElement('editor-file-info')
export class EditorFileInfo extends SignalWatcher(LitElement)
{

  // ── 1. Render ──────────────────────────────────────────────────────────────

  override render()
  {
    const collapsed = fileManagerCollapsed.get();
    this.toggleAttribute('collapsed', collapsed);

    // Capture the state at opening (first expanded render) so Cancel can revert.
    if (collapsed) this._snapshot = null;
    else if (this._snapshot === null) this._snapshot = structuredClone(this._draft);
    const script = editorScript.get();
    const displayName = script?.name ?? 'untitled';
    const readOnly = isReadOnly.get();

    return html`
      <div class="header" @click=${this._toggleCollapse}>
        <wa-icon library="lucide" name="file"></wa-icon>

        ${this._editingName && !readOnly
          ? (() => {
              const taken = this._nameCollides(this._nameDraft);
              return html`
                <input
                  id=${`fm-name-header-${this._uid}`}
                  class=${`name-input${taken ? ' invalid' : ''}`}
                  .value=${this._nameDraft}
                  @input=${(e: InputEvent) => (this._nameDraft = (e.target as HTMLInputElement).value)}
                  @blur=${this._commitNameEdit}
                  @keydown=${this._onNameKeydown}
                  @click=${(e: Event) => e.stopPropagation()}
                />
                ${taken
                  ? html`
                      <span class="name-taken header" @click=${(e: Event) => e.stopPropagation()}>
                        <wa-icon library="lucide" name="triangle-alert"></wa-icon>
                        already exists
                      </span>`
                  : nothing}
              `;
            })()
          : html`
              <span
                class="script-name"
                title=${displayName}
                @dblclick=${(e: Event) => { if (readOnly) return; e.stopPropagation(); this._startNameEdit(displayName); }}
              >${displayName}</span>

              ${script?.version
                ? html`<span class="script-version">v${script.version}</span>`
                : this._fallbackVersion()
                  ? html`<span class="script-version" title="Last shared/published version — this working copy has unsaved changes since">v${this._fallbackVersion()}</span>`
                  : nothing}

              ${readOnly
                ? html`
                    <span
                      id=${`fm-readonly-${this._uid}`}
                      class="fm-readonly"
                      @click=${(e: Event) => e.stopPropagation()}
                    >
                      <wa-icon library="lucide" name="lock"></wa-icon>
                      read-only
                    </span>
                    <wa-tooltip for=${`fm-readonly-${this._uid}`} placement="bottom">
                      This is a shared script${script?.author ? ` by ${script.author}` : ''}. Fork it to make your own editable copy.
                    </wa-tooltip>`
                : html`
                    ${userState.get().anonymous
                      ? html`
                          <span
                            id=${`fm-not-signed-in-${this._uid}`}
                            class="fm-warning"
                            @click=${(e: Event) => e.stopPropagation()}
                          >
                            <wa-icon library="lucide" name="triangle-alert"></wa-icon>
                          </span>
                          <wa-tooltip for=${`fm-not-signed-in-${this._uid}`} placement="bottom">
                            Not signed in. Saving is local only.
                          </wa-tooltip>`
                      : nothing}

                    <button
                      class="edit-name-btn"
                      title="Rename script"
                      id="edit-name-btn"
                      @click=${(e: Event) => { e.stopPropagation(); this._startNameEdit(displayName); }}
                    >
                      <wa-icon library="lucide" name="pencil"></wa-icon>
                    </button>`}
              `
        }

        <span class="spacer"></span>

        ${readOnly
          ? html`
              <button
                class="fork-btn"
                title="Fork to an editable copy"
                @click=${(e: Event) => { e.stopPropagation(); this._handleFork(); }}
              >
                <wa-icon library="lucide" name="git-fork"></wa-icon>
                Fork
              </button>`
          : nothing}

        <unit-switch
            class="unit-quick"
            title="Script units — Metric (mm) / Imperial (in)"
            .value=${scriptUnitSystem.get()}
            @unit-system-change=${(e: CustomEvent<UnitSystem>) => setScriptUnitSystem(e.detail)}
        ></unit-switch>

        <wa-icon library="lucide" name=${collapsed ? 'chevron-down' : 'chevron-up'}></wa-icon>
      </div>

      ${!collapsed ? this._renderBody() : nothing}

      <wa-popover
        class="name-error-popover"
        placement=${this._nameErrorAnchor === 'header' ? 'bottom' : 'right'}
        for=${this._nameErrorAnchor === 'header'
          ? `fm-name-header-${this._uid}`
          : `fm-name-form-${this._uid}`}
        ?open=${this._nameErrorOpen}
        @click=${(e: Event) => e.stopPropagation()}
      >${this._nameErrorText}</wa-popover>
    `;
  }

  private _renderBody()
  {
    const script  = editorScript.get();
    const fallbackVersion = this._fallbackVersion();
    const version = script?.version ?? (fallbackVersion ? `${fallbackVersion} (last shared/published — unsaved changes since)` : '—');

    return html`
      <div class="body">
        <div class="form">

          ${this._renderField('name', (() => {
            const taken = this._nameCollides(this._draft.projectName);
            return html`
              <input
                id=${`fm-name-form-${this._uid}`}
                class=${`text-input${taken ? ' invalid' : ''}`}
                .value=${this._draft.projectName}
                placeholder="script name…"
                @input=${(e: InputEvent) =>
                  (this._draft = { ...this._draft, projectName: (e.target as HTMLInputElement).value })}
              />
              ${taken
                ? html`
                    <div class="name-taken">
                      <wa-icon library="lucide" name="triangle-alert"></wa-icon>
                      already exists
                    </div>`
                : nothing}
            `;
          })())}

          ${this._renderField('version', html`
            <input
              class="text-input"
              .value=${version}
              disabled
            />
          `)}

          ${this._renderField('links', this._renderLinks())}

          ${this._renderField('units', this._renderUnitToggle())}

          ${this._renderField('description', html`
            <div class="editor-wrap">
              <dile-editor
                name="description"
                .value=${this._draft.description}
                disableToolbarItems=${FILE_MANAGER_DISABLED_TOOLBAR_ITEMS}
                @element-changed=${(e: CustomEvent<{ name: string; value: string }>) =>
                  (this._draft = { ...this._draft, description: e.detail.value })}
              ></dile-editor>
            </div>
          `)}

          ${this._renderField('details', html`
            <div class="editor-wrap">
              <dile-editor
                name="details"
                .value=${this._draft.projectDetails}
                disableToolbarItems=${FILE_MANAGER_DISABLED_TOOLBAR_ITEMS}
                @element-changed=${(e: CustomEvent<{ name: string; value: string }>) =>
                  (this._draft = { ...this._draft, projectDetails: e.detail.value })}
              ></dile-editor>
            </div>
          `)}

          ${this._renderField('tags', this._renderTagManager())}

        </div>

        <div class="footer">
          <wa-button
            variant="neutral"
            appearance="outlined"
            size="small"
            @click=${this._handleCancel}
          >Cancel</wa-button>
          <wa-button
            variant="brand"
            appearance="filled"
            size="small"
            @click=${this._handleSave}
          >Save</wa-button>
        </div>
      </div>
    `;
  }

  private _renderTagManager()
  {
    const selected  = this._draft.categories;
    const available = SCRIPT_PREDEFINED_TAGS.filter(t => !selected.includes(t));

    return html`
      <div class="tag-manager">
        ${available.length > 0
          ? html`
              <wa-dropdown
                class="tag-add"
                placement="bottom-start"
                @wa-select=${this._onAddTagSelect}
              >
                <wa-button
                  slot="trigger"
                  appearance="outlined"
                  variant="neutral"
                  size="small"
                  with-caret
                >
                  <wa-icon slot="start" library="lucide" name="plus"></wa-icon>
                  Add tag
                </wa-button>
                ${available.map(t => html`
                  <wa-dropdown-item value=${t}>${t}</wa-dropdown-item>`)}
              </wa-dropdown>`
          : nothing}
        <div class="tag-list">
          ${selected.length === 0
            ? html`<span class="tag-empty">No tags yet</span>`
            : selected.map(tag => html`
                <span class="tag-chip selected">
                  ${tag}
                  <button
                    class="tag-remove"
                    title="Remove tag"
                    @click=${() => this._removeTag(tag)}
                  >
                    <wa-icon library="lucide" name="x"></wa-icon>
                  </button>
                </span>
              `)}
        </div>
      </div>
    `;
  }

  /** The public editor URL for the latest shared version of this script. There is
   *  no stored `shared.url` on the wire (unlike `published.url`), so it is built
   *  the same way editor deep links are: /editor/{author}/{name}:{version}. Falls
   *  back to the last-known shared library version when the working copy's own
   *  `version` has reset to null (see `_lastSharedVersion`). */
  private _sharedUrl(): string | null
  {
    const script = editorScript.get();
    const version = script?.version ?? this._lastSharedVersion;
    if (!script?.shared || !script.author || !script.name || !version) return null;
    const base = (typeof window !== 'undefined' && window.location?.origin) || '';
    return `${base}/editor/${encodeURIComponent(script.author)}/${encodeURIComponent(script.name)}:${encodeURIComponent(version)}`;
  }

  /** The higher of the last shared/published version — shown in the header and
   *  Version field when the working copy's own `version` has reset to null. */
  private _fallbackVersion(): string | null
  {
    const shared    = this._lastSharedVersion;
    const published = this._lastPublishedVersion?.version ?? null;
    if (shared && published) return isHigherVersion(shared, published) ? shared : published;
    return shared ?? published;
  }

  /** Public URLs for the latest shared/published version of this script — shown
   *  under the Links field. Neither shared nor published ⇒ a hint to do so. */
  private _renderLinks()
  {
    const script = editorScript.get();
    const sharedUrl = this._sharedUrl();

    const publishedVersion = script?.version ?? this._lastPublishedVersion?.version ?? null;
    const publishedUrl = (script?.published || this._lastPublishedVersion) && script?.author && script?.name && publishedVersion
      ? publicConfiguratorUrl(
          script?.published?.url ?? this._lastPublishedVersion?.url,
          script!.author!, script!.name!, publishedVersion)
      : null;

    if (!sharedUrl && !publishedUrl)
    {
      return html`<span class="links-empty">Please share or publish to generate share links</span>`;
    }

    return html`
      <div class="links-list">
        ${sharedUrl
          ? html`
              <div class="link-row">
                <span class="link-label">Shared</span>
                <a class="link-url" href=${sharedUrl} target="_blank" rel="noopener">${sharedUrl}</a>
              </div>`
          : nothing}
        ${publishedUrl
          ? html`
              <div class="link-row">
                <span class="link-label">Configurator</span>
                <a class="link-url" href=${publishedUrl} target="_blank" rel="noopener">${publishedUrl}</a>
              </div>`
          : nothing}
      </div>
    `;
  }

  /** Metric / Imperial segmented control — sets the script's main unit system.
   *  Always shows exactly one option as active. */
  private _renderUnitToggle()
  {
    const sys = scriptUnitSystem.get();
    return html`
      <div class="unit-seg" role="group" @click=${(e: Event) => e.stopPropagation()}>
        <button
          class=${`seg-btn ${sys === 'metric' ? 'active' : ''}`}
          @click=${() => setScriptUnitSystem('metric')}
        >
          <wa-icon library="lucide" name="ruler"></wa-icon>
          Metric <span class="seg-hint">mm</span>
        </button>
        <button
          class=${`seg-btn ${sys === 'imperial' ? 'active' : ''}`}
          @click=${() => setScriptUnitSystem('imperial')}
        >
          <wa-icon library="lucide" name="ruler"></wa-icon>
          Imperial <span class="seg-hint">in</span>
        </button>
      </div>
    `;
  }

  private _renderField(key: string, control: unknown)
  {
    const helpId  = `help-${key}-${this._uid}`;
    const label   = key.charAt(0).toUpperCase() + key.slice(1);
    const helpText = FIELD_HELP[key] ?? '';

    return html`
      <div class="field">
        <div class="field-label-row">
          <span class="field-label">${label}</span>
          <span id=${helpId} class="help-icon">
            <wa-icon library="lucide" name="circle-help"></wa-icon>
          </span>
          <wa-tooltip for=${helpId} placement="right">${helpText}</wa-tooltip>
        </div>
        ${control}
      </div>
    `;
  }

  // ── 2. State ───────────────────────────────────────────────────────────────

  @state() private _editingName = false;
  @state() private _nameDraft   = '';
  @state() private _draft: ScriptMetadata = this._freshDraft();

  /** Snapshot of the draft taken when the body is opened — used by Cancel. */
  private _snapshot: ScriptMetadata | null = null;

  /** Stable per-instance uid suffix for tooltip `for` references. */
  private readonly _uid = Math.random().toString(36).slice(2, 7);

  /** Name-collision popover state. */
  @state() private _nameErrorOpen  = false;
  @state() private _nameErrorText  = '';
  @state() private _nameErrorAnchor: 'header' | 'form' = 'header';
  private _nameErrorTimer: number | null = null;

  /** The active script's own `version` resets to null on every ordinary save
   *  ("reset-on-save" — see ScriptStore), so a working copy that was shared or
   *  published in the past looks unversioned again on reload even though a
   *  concrete version still exists in the shared/published library. These hold
   *  that last-known library version (fetched separately) so the header, the
   *  Version field and the Links section can still show it. Null when the
   *  script's own `version` is already concrete (nothing to look up), or when
   *  the file has never been shared/published. */
  @state() private _lastSharedVersion: string | null = null;
  @state() private _lastPublishedVersion: { version: string; url?: string } | null = null;

  /** Tracks the fileId of the script the form is currently bound to,
   *  so we can re-populate when the active script changes (e.g. after
   *  Open Script). */
  private _activeFileId: string | null = null;

  // ── 3. Lifecycle ───────────────────────────────────────────────────────────

  override updated(_changed: Map<string, unknown>)
  {
    // dile-editor hardcodes section.for-input { font-size: 0.9rem } in its
    // shadow root and exposes no var to override it. Inject a stylesheet so
    // the body/paragraph text matches our text-sm. (Heading sizes are left
    // alone — markdown semantics.)
    this._patchDileEditorFontSize();
  }

  private _dileEditorSheet: CSSStyleSheet | null = null;
  private _patchDileEditorFontSize()
  {
    if (!this._dileEditorSheet)
    {
      try
      {
        this._dileEditorSheet = new CSSStyleSheet();
        this._dileEditorSheet.replaceSync(`
          section.for-input { font-size: var(--text-sm, 0.875rem); }
          .ProseMirror      { font-size: var(--text-sm, 0.875rem); }
        `);
      }
      catch { return; /* constructable sheets unsupported */ }
    }
    const sheet = this._dileEditorSheet;
    this.renderRoot.querySelectorAll('dile-editor').forEach(el =>
    {
      const sr = (el as HTMLElement).shadowRoot;
      if (sr && !sr.adoptedStyleSheets.includes(sheet))
      {
        sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
      }
    });
  }

  override willUpdate(_changed: Map<string, unknown>)
  {
    // SignalWatcher runs update() whenever a watched signal ticks, so this
    // fires on every script switch. Re-derive the form draft from the
    // canonical Script whenever the active script changes.
    const script = editorScript.get();
    const fid = script?.fileId ?? null;
    if (fid !== this._activeFileId)
    {
      this._activeFileId = fid;
      this._draft        = this._draftFromScript();
      this._snapshot     = null;          // re-captured on next body-open render
      this._editingName  = false;
      this._nameDraft    = '';
      this._nameErrorOpen = false;
      if (this._nameErrorTimer !== null)
      {
        clearTimeout(this._nameErrorTimer);
        this._nameErrorTimer = null;
      }
      void this._loadLastLibraryVersions(script, fid);
    }
  }

  /** Look up the last shared/published version of the active file when its own
   *  `version` is null (see the field comment on `_lastSharedVersion`). Guards
   *  against a stale response landing after the user has already switched to a
   *  different script. */
  private async _loadLastLibraryVersions(
    script: ReturnType<typeof editorScript.get>,
    fid: string | null,
  )
  {
    this._lastSharedVersion    = null;
    this._lastPublishedVersion = null;
    if (!script || script.version || !script.author || !script.name) return;

    const [shared, published] = await Promise.all([
      fetchSharedScript(script.author, script.name),
      fetchPublishedScript(script.author, script.name),
    ]);
    if (this._activeFileId !== fid) return; // stale — active script has changed

    this._lastSharedVersion    = shared?.version ?? null;
    this._lastPublishedVersion = published?.version
      ? { version: published.version, url: published.published?.url ?? undefined }
      : null;
  }

  // ── 4. Behaviour ───────────────────────────────────────────────────────────

  private _freshDraft(): ScriptMetadata
  {
    return {
      projectName:    editorScript.get()?.name ?? '',
      version:        '',
      description:    '',
      projectDetails: '',
      categories:     [],
    };
  }

  /** Build the form draft directly from the canonical Script — the
   *  source of truth post-refactor. The legacy `scriptMetadata` signal
   *  is no longer consulted here so script switches always show fresh data. */
  private _draftFromScript(): ScriptMetadata
  {
    const script = editorScript.get();
    return {
      projectName:    script?.name ?? '',
      version:        script?.version ?? '',
      description:    script?.description ?? '',
      projectDetails: script?.details ?? '',
      categories:     [...(script?.tags ?? [])],
    };
  }

  private _toggleCollapse()
  {
    setFileManagerCollapsed(!fileManagerCollapsed.get());
  }

  private _startNameEdit(currentName: string)
  {
    this._nameDraft    = currentName;
    this._editingName  = true;
    // NOTE: deliberately do NOT expand the menu here — renaming happens inline
    // in the header; the body stays collapsed until the user opens it.

    this.updateComplete.then(() =>
    {
      this.renderRoot.querySelector<HTMLInputElement>('.name-input')?.select();
    });
  }

  /** Would renaming the active file to `candidate` clash with another file?
   *
   *  Keeping the name it already has is never a clash. Without that check a file
   *  whose name happens to duplicate another one (say, one of several
   *  "untitled") warns the moment the panel opens and refuses to save, even
   *  though the user never touched the name. */
  private _nameCollides(candidate: string): boolean
  {
    const name = candidate.trim();
    if (!name) return false;

    const script = editorScript.get();
    if (!script) return false;
    if (name.toLowerCase() === (script.name ?? '').trim().toLowerCase()) return false;

    return isScriptNameTaken(name, script.fileId);
  }

  private _commitNameEdit()
  {
    const name = this._nameDraft.trim();
    if (!name) { this._editingName = false; return; }

    if (this._nameCollides(name))
    {
      this._showNameError('header', name);
      return; // keep editor open so the user can correct
    }

    this._editingName = false;
    // Commit to the active Script so the header re-renders from the signal,
    // and keep the form draft in sync.
    updateScriptName(name);
    this._draft = { ...this._draft, projectName: name };
  }

  /** Display the collision popover and auto-dismiss after a few seconds. */
  private _showNameError(anchor: 'header' | 'form', tried: string)
  {
    this._nameErrorAnchor = anchor;
    this._nameErrorText   = `File name "${tried}" already taken!`;
    this._nameErrorOpen   = true;

    if (this._nameErrorTimer !== null) clearTimeout(this._nameErrorTimer);
    this._nameErrorTimer = window.setTimeout(() =>
    {
      this._nameErrorOpen  = false;
      this._nameErrorTimer = null;
    }, 2500);
  }

  private _onNameKeydown(e: KeyboardEvent)
  {
    e.stopPropagation();
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') this._editingName = false;
  }

  private _onAddTagSelect(e: CustomEvent)
  {
    const tag = (e.detail.item as { value: string }).value;
    if (tag) this._addTag(tag);
  }

  private _addTag(tag: string)
  {
    if (this._draft.categories.includes(tag)) return;
    this._draft = { ...this._draft, categories: [...this._draft.categories, tag] };
  }

  private _removeTag(tag: string)
  {
    this._draft = {
      ...this._draft,
      categories: this._draft.categories.filter(t => t !== tag),
    };
  }

  private _handleCancel()
  {
    // Revert to the state captured when the menu was opened, then close.
    this._draft = this._snapshot
      ? structuredClone(this._snapshot)
      : this._freshDraft();
    this._editingName = false;
    setFileManagerCollapsed(true);
  }

  /** Fork the read-only shared script into an editable copy owned by the user. */
  private _handleFork()
  {
    const fork = forkScript();
    if (fork)
    {
      // The fork became active (edit mode); surface it so the editor can re-run.
      this.dispatchEvent(new CustomEvent('script-forked', { bubbles: true, composed: true }));
    }
  }

  private _handleSave()
  {
    if (isReadOnly.get()) return;   // read-only shared scripts cannot be saved
    const script = editorScript.get();
    if (!script) return;

    // Update the script name on the actual Script object
    const newName = this._draft.projectName.trim();
    if (newName)
    {
      if (this._nameCollides(newName))
      {
        this._showNameError('form', newName);
        return; // abort save — keep the panel open
      }
      updateScriptName(newName);
    }

    // Persist metadata onto the canonical Script (description / details / tags)
    updateScriptMeta({
      description: this._draft.description,
      details:     this._draft.projectDetails,
      tags:        this._draft.categories,
    });

    // Keep the editor metadata signal in sync with what we just saved
    updateScriptMetadata(script.id, { ...this._draft });

    setFileManagerCollapsed(true);
  }

  // ── 5. Styles ──────────────────────────────────────────────────────────────

  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      width: 100%;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      background: var(--color-bg-elevated);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    *,
    *::before,
    *::after { box-sizing: border-box; }

    /* ── Name collision popover ── */

    .name-error-popover {
      --background-color: var(--color-alert, #ef4444);
      --border-color:     var(--color-alert, #ef4444);
      color:              var(--color-white, #fff);
      font-size:          var(--text-xs);
      font-weight:        500;
    }

    /* ── Header ── */

    .header
    {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      height: var(--space3xl);
      padding: 0 var(--space-md);
      flex-shrink: 0;
      user-select: none;
      cursor: pointer;
      color: color-mix(in srgb, var(--color-primary) 72%, var(--color-text) 28%);
      background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bg-elevated) 90%);
      border-bottom: 1px solid color-mix(in srgb, var(--color-primary) 22%, var(--color-border) 78%);
    }

    :host([collapsed]) .header
    {
      border-bottom: none;
    }

    /* Name + version are separate items of the centered header row, so they only
       line up when their line boxes match: same font-size AND same line-height.
       (With 12px next to 14px the header centers the two boxes, which leaves
       their text baselines apart and the version riding high.) The version stays
       secondary through its muted color and regular weight. */
    .script-name
    {
      font-weight: 500;
      color: color-mix(in srgb, var(--color-primary) 68%, var(--color-text) 32%);
      font-size: var(--text-sm);
      line-height: 20px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 160px;
      cursor: default;
    }

    .script-version
    {
      font-size: var(--text-sm);
      line-height: 20px;
      color: var(--color-gray-dark, #666);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .name-input
    {
      flex: 1;
      min-width: 0;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
      background: var(--color-bg);
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-sm, 4px);
      padding: 2px 6px;
      outline: none;
    }

    .name-input.invalid
    {
      border-color: var(--color-alert, #ef4444);
    }

    /* Header variant of the "already exists" warning — inline, no top margin. */
    .name-taken.header
    {
      margin-top: 0;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .edit-name-btn
    {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      background: none;
      border: none;
      cursor: pointer;
      color: color-mix(in srgb, var(--color-primary) 52%, var(--color-text-muted) 48%);
      border-radius: var(--radius-sm, 4px);
      opacity: 0;
      transition: opacity 0.1s;
      flex-shrink: 0;
    }

    .header:hover .edit-name-btn { opacity: 1; }

    .spacer { flex: 1; }

    /* ── Quick mm/in unit switch (header) — shared <unit-switch> pill ── */
    .unit-quick { flex-shrink: 0; }

    /* Read-only badge (foreign shared script) */
    .fm-readonly
    {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 22px;
      padding: 0 8px;
      border-radius: var(--radius-sm, 4px);
      background: color-mix(in srgb, var(--color-warning, #d97706) 16%, transparent);
      color: var(--color-warning, #d97706);
      font-size: var(--text-xs);
      font-weight: 500;
      white-space: nowrap;
      cursor: help;
      flex-shrink: 0;
    }

    /* Fork button (read-only header) */
    .fork-btn
    {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 22px;
      padding: 0 10px;
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-primary);
      color: var(--color-white, #fff);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .fork-btn:hover { opacity: 0.88; }

    /* Not-signed-in warning (saving is local-only) */
    .fm-warning
    {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--color-warning, #d97706);
      font-size: 1rem;
      cursor: help;
      flex-shrink: 0;
    }

    /* ── Body ── */

    .body
    {
      display: flex;
      flex-direction: column;
      position: relative;
      max-height: 480px;
      font-size: var(--text-sm);
    }

    .form
    {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-md);
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
      /* leave room for fixed footer */
      padding-bottom: calc(var(--space-md) + 44px);
    }

    /* ── Field ── */

    .field
    {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .field-label-row
    {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .field-label
    {
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--color-text-muted);
    }

    .help-icon
    {
      display: flex;
      align-items: center;
      font-size: 12px;
      color: var(--color-text-muted);
      opacity: 0.5;
      cursor: default;
    }

    /* ── Links field ── */

    .links-empty
    {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
      opacity: 0.7;
      font-style: italic;
    }

    .links-list
    {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .link-row
    {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }

    .link-label
    {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      flex-shrink: 0;
    }

    .link-url
    {
      font-size: var(--text-sm);
      color: var(--color-gray-dark, #666);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .link-url:hover { color: var(--color-primary); }

    /* ── Unit-system segmented control ── */

    .unit-seg
    {
      display: inline-flex;
      align-items: stretch;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      overflow: hidden;
      align-self: flex-start;
    }

    .seg-btn
    {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: var(--space-xs) var(--space-md);
      border: none;
      background: var(--color-bg);
      color: var(--color-text-muted);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      cursor: pointer;
    }

    .seg-btn + .seg-btn { border-left: 1px solid var(--color-border); }

    .seg-btn:hover { background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg)); }

    .seg-btn.active
    {
      background: var(--color-primary);
      color: var(--color-bg);
    }

    .seg-hint
    {
      font-size: var(--text-xs);
      opacity: 0.7;
    }

    /* ── Text input ── */

    .text-input
    {
      width: 100%;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      padding: var(--space-xs) var(--space-sm);
      outline: none;
      transition: border-color 0.15s;
    }

    .text-input:focus
    {
      border-color: var(--color-primary);
    }

    .text-input.invalid,
    .text-input.invalid:focus
    {
      border-color: var(--color-alert, #ef4444);
    }

    /* ── Inline "already exists" name warning ── */

    .name-taken
    {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
      color: var(--color-alert, #ef4444);
      font-size: var(--text-xs);
      font-weight: 500;
    }

    .text-input:disabled
    {
      opacity: 0.5;
      cursor: not-allowed;
      background: var(--color-gray);
    }

    /* ── Dile editor theming ── */

    .editor-wrap
    {
      --dile-editor-border: 1px solid var(--color-border);
      --dile-editor-background-color: var(--color-bg);
      --dile-editor-text-color: var(--color-text);
      --dile-editor-focus-color: var(--color-primary);
      --dile-editor-views-nav-background-color: var(--color-gray);
      --dile-editor-views-nav-color: var(--color-text-muted);
      --dile-editor-views-nav-selected-color: var(--color-primary);
      --dile-editor-views-nav-selected-line-color: var(--color-primary);
      --dile-editor-line-height: 1.5rem;
      --dile-input-label-color: transparent;
      --dile-input-label-font-size: 0;

      /* Markdown toolbar icons: smaller + app colors (these inherit into the
         dile-editor shadow tree). NOTE: the icon glyphs themselves are baked
         into @dile/editor and cannot be swapped for the app's lucide set
         without replacing that component. */
      --dile-icon-size: 16px;
      --dile-icon-color: var(--color-gray-dark, #666);
      /* This var feeds the toolbar's --dile-icon-color (dile-editor-toolbar.js)
         and the active-item color — primary made the icons blue. */
      --dile-editor-toolbar-color: var(--color-gray-dark, #666);

      /* Link dialog buttons — match the main app's button styling */
      --dile-primary-color: var(--color-primary);
      --dile-primary-dark-color: var(--color-primary);
      --dile-primary-light-color: var(--color-primary);
      --dile-on-primary-color: #fff;
      --dile-button-border-radius: var(--radius-sm, 4px);
      --dile-button-border-width: 1px;
      --dile-button-font-size: var(--text-sm);
      --dile-button-font-weight: 500;
      --dile-button-padding-y: var(--space-xs);
      --dile-button-padding-x: var(--space-md);
      --dile-button-hover-background-color: var(--color-primary);
      --dile-button-hover-text-color: #fff;
      --dile-button-hover-border-color: var(--color-primary);
    }

    .editor-wrap dile-editor
    {
      display: block;
      font-family: var(--font-sans);
    }

    /* ── Tag manager ── */

    .tag-manager
    {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .tag-list
    {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs);
      min-height: 24px;
    }

    .tag-empty
    {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      opacity: 0.7;
      font-style: italic;
    }

    .tag-chip
    {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px 2px 10px;
      border-radius: 999px;
      border: 1px solid var(--color-border);
      background: var(--color-bg);
      color: var(--color-text-muted);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      user-select: none;
    }

    .tag-chip.selected
    {
      background: var(--color-gray-dark, #666);
      border-color: var(--color-gray-dark, #666);
      color: #fff;
    }

    .tag-remove
    {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      width: 14px;
      height: 14px;
      border: none;
      border-radius: 50%;
      background: none;
      color: inherit;
      cursor: pointer;
      opacity: 0.8;
      font-size: 12px;
    }

    .tag-remove:hover
    {
      opacity: 1;
      background: rgba(255, 255, 255, 0.25);
    }

    .tag-add
    {
      display: inline-block;
      align-self: flex-start;
      width: fit-content;
    }

    .tag-add wa-button
    {
      width: auto;
    }

    /* ── Fixed footer ── */

    .footer
    {
      position: sticky;
      bottom: 0;
      display: flex;
      justify-content: flex-end;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      background: var(--color-bg-elevated);
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-file-info': EditorFileInfo;
  }
}
