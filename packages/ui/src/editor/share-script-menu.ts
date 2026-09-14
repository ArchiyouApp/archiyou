/**
 * <share-script-menu> — modal for sharing (or re-sharing) the active script.
 *
 * Sharing publishes a versioned copy to the community/shared library. The menu
 * collects a version (prefilled with a +0.1 bump over the highest version the
 * file already used — shared OR published, since `(fileId, version)` is unique
 * server-side), licence, an optional "dev" access flag, and an optional list of
 * users to restrict access to. Prefills every field from the last shared version
 * when one exists. There is no description field: the script carries its own
 * (edited in <file-info>).
 *
 * Emits:
 *   share-script-done   CustomEvent<ScriptData>  — after a successful share
 *   share-script-cancel CustomEvent<void>
 */

import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import { CC_LICENCES } from '@archiyou/core/src/ScriptSchema';
import { THUMBNAIL_OUTPUT_PATH } from '@archiyou/core/src/constants';
import { getOutput } from '@archiyou/core/src/runner/worker/output';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';
import type { CCLicence } from '@archiyou/core/src/ScriptSchema';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import type { PublicUser } from '@archiyou/types';

import { editorScript, userState, bumpScript } from '@archiyou/editor/src/state/workspace';
import { runScript, warmupWorker } from '@archiyou/editor/src/services/execution-service';
import {
  shareScript,
  fetchSharedScript,
  fetchSharedVersions,
  searchUsers,
} from '@archiyou/editor/src/services/sharing';
import { fetchFileVersions } from '@archiyou/editor/src/services/scripts-sync';
import { uploadThumbnail } from '@archiyou/editor/src/services/thumbnails';
import { OVERLAY_MENU_WIDTH } from '@archiyou/editor/src/settings';

/** Friendly labels for the SPDX licence ids. */
const LICENCE_LABELS: Record<string, string> = {
  'CC0-1.0':          'CC0 1.0 — Public Domain',
  'CC-BY-4.0':        'CC BY 4.0 — Attribution',
  'CC-BY-SA-4.0':     'CC BY-SA 4.0 — Attribution-ShareAlike',
  'CC-BY-NC-4.0':     'CC BY-NC 4.0 — Attribution-NonCommercial',
  'CC-BY-ND-4.0':     'CC BY-ND 4.0 — Attribution-NoDerivatives',
  'CC-BY-NC-SA-4.0':  'CC BY-NC-SA 4.0 — Attribution-NonCommercial-ShareAlike',
  'CC-BY-NC-ND-4.0':  'CC BY-NC-ND 4.0 — Attribution-NonCommercial-NoDerivatives',
};

const DEFAULT_LICENCE = 'CC0-1.0';

/** Parse "X.Y…" → [major, minor]; defaults to [0, 0] when unparseable. */
function parseMajorMinor(v: string | null | undefined): [number, number] {
  const m = /^(\d+)\.(\d+)/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** Bump the minor by 0.1 → "X.(Y+1)". No previous version ⇒ "0.1". */
function bumpVersion(last: string | null): string {
  if (!last) return '0.1';
  const [maj, min] = parseMajorMinor(last);
  return `${maj}.${min + 1}`;
}

/** True when `a` is strictly greater than `b` on (major, minor). */
function isHigher(a: string, b: string): boolean {
  const [amaj, amin] = parseMajorMinor(a);
  const [bmaj, bmin] = parseMajorMinor(b);
  return amaj > bmaj || (amaj === bmaj && amin > bmin);
}

/** True when both strings denote the same (major, minor) release. */
function isSameVersion(a: string, b: string): boolean {
  return parseMajorMinor(a).join('.') === parseMajorMinor(b).join('.');
}

/** The highest of `versions` on (major, minor), or null when empty. */
function highestVersion(versions: string[]): string | null {
  return versions.reduce<string | null>((max, v) => (max === null || isHigher(v, max) ? v : max), null);
}

/** Server error text (`{ success, error }` body of a 4xx) when there is one. */
function errorMessage(err: unknown, fallback: string): string {
  const body = (err as { body?: { error?: string } } | undefined)?.body;
  return body?.error ?? (err as Error)?.message ?? fallback;
}

@customElement('share-script-menu')
export class ShareScriptMenu extends SignalWatcher(LitElement)
{
  @property({ type: Boolean, reflect: true }) open = false;

  // ── Form state ──
  @state() private _version     = '0.1';
  @state() private _licence     = DEFAULT_LICENCE;
  @state() private _dev         = false;
  @state() private _selectedUsers: PublicUser[] = [];

  // ── People picker ──
  @state() private _userQuery   = '';
  @state() private _userResults: PublicUser[] = [];
  @state() private _searching   = false;

  // ── Prefill / submit ──
  @state() private _lastVersion: string | null = null;
  /** Every version this file already used server-side (shared or published) —
   *  the server rejects a re-use, so the menu must never suggest one. */
  @state() private _usedVersions: string[] = [];
  @state() private _loading     = false;
  @state() private _submitting  = false;
  @state() private _error       = '';
  /** Iso line drawing for this share, generated in the background (see
   *  _prepareThumbnail). Null until it lands — sharing never waits for it. */
  @state() private _thumbnailSvg: string | null = null;
  /** The in-flight generation, kept so a share that goes out first can still wait for it
   *  AFTERWARDS and attach the drawing out of band (see _attachThumbnailLate). */
  private _thumbnailRun: Promise<void> | null = null;

  private _searchTimer: number | null = null;

  // ── Render ──

  override render()
  {
    if (!this.open) return nothing;

    // Sharing requires an account (the script is stored + attributed server-side).
    if (userState.get().anonymous) return this._renderSignInRequired();

    const isEditing = this._lastVersion !== null;

    return html`
      <div class="backdrop" @click=${this._cancel}></div>
      <div class="dialog" role="dialog" aria-modal="true"
           @click=${(e: Event) => e.stopPropagation()}>

        <div class="dialog-header">
          <wa-icon library="lucide" name="share-2"></wa-icon>
          <span class="header-title">${isEditing ? 'Edit shared script' : 'Share script'}</span>
          <button class="close-btn" @click=${this._cancel}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <div class="dialog-body">
          <p class="intro">
            Shared scripts serve as examples to the community, can be forked to
            create new versions and can be used as components. Please set a
            licence to control the conditions of use by others.
          </p>

          ${this._loading
            ? html`<div class="loading"><wa-spinner></wa-spinner></div>`
            : nothing}

          <!-- Version -->
          <div class="field">
            <label class="field-label">Version</label>
            <div class="version-row">
              <input
                class="text-input version-input"
                type="text"
                .value=${this._version}
                @input=${(e: InputEvent) => { this._version = (e.target as HTMLInputElement).value; this._error = ''; }}
              />
              <span class="hint">${this._lastVersion
                ? html`Last shared version was <strong>${this._lastVersion}</strong>`
                : '(new share)'}</span>
            </div>
          </div>

          <!-- Licence -->
          <div class="field">
            <label class="field-label">Licence</label>
            <!-- The selected attribute on the option (not .value on the select) is
                 what makes wa-select show a preselected licence: a value set before
                 the options are slotted is cleared again. And "change" is the event
                 WebAwesome 3 emits — "wa-change" never fires. -->
            <wa-select
              class="licence-select"
              @change=${(e: Event) => (this._licence = String((e.target as HTMLElement & { value: string }).value ?? ''))}
            >
              ${CC_LICENCES.map(l => html`
                <wa-option value=${l} ?selected=${l === this._licence}>${LICENCE_LABELS[l] ?? l}</wa-option>`)}
            </wa-select>
          </div>

          <!-- Dev access -->
          <div class="field">
            <label class="checkbox-row">
              <input
                type="checkbox"
                .checked=${this._dev}
                @change=${(e: Event) => (this._dev = (e.target as HTMLInputElement).checked)}
              />
              <span>Allow access to the latest dev version under <code>:dev</code></span>
            </label>
          </div>

          <!-- Share only with -->
          <div class="field">
            <label class="field-label">Share only with</label>
            <span class="hint">Leave empty to share with the whole community.</span>
            <div class="user-picker">
              <div class="chips">
                ${this._selectedUsers.map(u => html`
                  <span class="chip">
                    ${u.name ?? u.id}
                    <button class="chip-remove" title="Remove"
                      @click=${() => this._removeUser(u)}>
                      <wa-icon library="lucide" name="x"></wa-icon>
                    </button>
                  </span>`)}
              </div>
              <div class="search-wrap">
                <wa-icon library="lucide" name="search" class="search-icon"></wa-icon>
                <input
                  class="search-input"
                  type="text"
                  placeholder="Search users by name or email…"
                  .value=${this._userQuery}
                  @input=${(e: InputEvent) => this._onUserQueryInput((e.target as HTMLInputElement).value)}
                />
                ${this._searching ? html`<wa-spinner class="search-spinner"></wa-spinner>` : nothing}
              </div>
              ${this._userResults.length > 0
                ? html`
                    <div class="results">
                      ${this._userResults.map(u => html`
                        <button class="result-item" @click=${() => this._addUser(u)}>
                          <span class="result-name">${u.name ?? u.id}</span>
                          ${u.email ? html`<span class="result-email">${u.email}</span>` : nothing}
                        </button>`)}
                    </div>`
                : nothing}
            </div>
          </div>

          ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
        </div>

        <div class="dialog-footer">
          <button class="btn-secondary" @click=${this._cancel} ?disabled=${this._submitting}>Cancel</button>
          <button class="btn-primary" @click=${this._share} ?disabled=${this._submitting}>
            ${this._submitting ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>
    `;
  }

  /** Shown instead of the form when the user is not signed in. */
  private _renderSignInRequired()
  {
    return html`
      <div class="backdrop" @click=${this._cancel}></div>
      <div class="dialog" role="dialog" aria-modal="true"
           @click=${(e: Event) => e.stopPropagation()}>

        <div class="dialog-header">
          <wa-icon library="lucide" name="share-2"></wa-icon>
          <span class="header-title">Share script</span>
          <button class="close-btn" @click=${this._cancel}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <div class="dialog-body">
          <div class="signin-required">
            <wa-icon library="lucide" name="lock"></wa-icon>
            <p>You need to be signed in to share a script. Sign in or create an
              account, then try again.</p>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn-secondary" @click=${this._cancel}>Close</button>
        </div>
      </div>
    `;
  }

  // ── Lifecycle ──

  override updated(changed: Map<string, unknown>)
  {
    // Don't prefetch shared data for an anonymous user (no handle to query).
    if (changed.has('open') && this.open && !userState.get().anonymous)
    {
      void this._prefill();
      // Fire-and-forget, deliberately NOT awaited and never gating the Share button:
      // unlike publishing, sharing has no precheck run to piggyback on, and making the
      // user wait on a preview would be a worse trade than occasionally shipping
      // without one. If it lands before submit it rides along; if it does not, the
      // share goes out first and _attachThumbnailLate() delivers it afterwards.
      this._thumbnailRun = this._prepareThumbnail();
    }

    // Keep the licence dropdown in sync once it has options (its value lags the
    // slotted options on first paint, and prefill arrives after the fetch).
    const select = this.renderRoot?.querySelector('.licence-select') as (HTMLElement & { value: string | string[] | null }) | null;
    if (select && select.value !== this._licence) select.value = this._licence;
  }

  // ── Behaviour ──

  /** Generate the preview in the background. Every failure is swallowed: a share with no
   *  thumbnail is a perfectly good share, and this must never surface an error. */
  private async _prepareThumbnail()
  {
    this._thumbnailSvg = null;
    const scriptData = editorScript.get()?.toData();
    if (!scriptData) return;
    try
    {
      await warmupWorker();
      const result = await runScript({
        kernel:     'mesh',
        script:     scriptData,
        outputs:    [THUMBNAIL_OUTPUT_PATH],
        messages:   ['error'],
        unitSystem: scriptData.units ?? 'metric',
      } as RunnerScriptExecutionRequest);
      this._thumbnailSvg = result
        ? ((getOutput(result, THUMBNAIL_OUTPUT_PATH) as string | undefined) ?? null)
        : null;
    }
    catch
    {
      this._thumbnailSvg = null;
    }
  }

  /** Load the last shared version and prefill every field. */
  private async _prefill()
  {
    // Reset to defaults first.
    this._error = '';
    this._userQuery = '';
    this._userResults = [];
    this._selectedUsers = [];
    this._licence = DEFAULT_LICENCE;
    this._dev = false;
    this._lastVersion = null;
    this._usedVersions = [];

    const script = editorScript.get();
    if (!script) { this._version = '0.1'; return; }

    const author = script.author ?? userState.get().id ?? null;
    const name = script.name ?? null;
    const fileId = script.fileId ?? null;

    if (!author || !name) { this._version = '0.1'; return; }

    this._loading = true;
    try {
      // The shared script gives the metadata to prefill; the version lists give
      // the numbers. `prev.version` alone is not enough: an unversioned working
      // copy can be the newest shared row (saves inherit the shared metadata).
      const [prev, sharedVersions, fileVersions] = await Promise.all([
        fetchSharedScript(author, name),
        fetchSharedVersions(author, name),
        fileId ? fetchFileVersions(fileId) : Promise.resolve<string[]>([]),
      ]);

      if (prev?.shared) {
        this._licence     = prev.shared.licence ?? DEFAULT_LICENCE;
        this._dev         = prev.shared.dev ?? false;
        // Resolve onlyUsers ids into display chips (ids are handles).
        // Display-only stubs: only `id` is known here, the rest are placeholders
        // to satisfy PublicUser (module entitlements and operator rights are
        // irrelevant to a chip).
        this._selectedUsers = (prev.shared.onlyUsers ?? []).map(
          id => ({ id, email: null, name: null, avatarUrl: null, emailVerified: true, modules: [], isAdmin: false }),
        );
      }

      this._lastVersion = highestVersion(sharedVersions) ?? prev?.version ?? null;
      // Versions of *this file* (shared + published) — the server's uniqueness
      // is per (fileId, version), so a version published earlier is taken too.
      this._usedVersions = [...new Set([...fileVersions, ...sharedVersions])]
        .sort((a, b) => (isHigher(a, b) ? 1 : -1));
    } finally {
      this._loading = false;
    }

    this._version = this._nextFreeVersion();
  }

  /** A +0.1 bump over the highest version this file ever used (shared, published
   *  or the last shared one), so the suggestion can never collide server-side. */
  private _nextFreeVersion(): string
  {
    const known = [...this._usedVersions];
    if (this._lastVersion) known.push(this._lastVersion);
    return bumpVersion(highestVersion(known));
  }

  private _onUserQueryInput(value: string)
  {
    this._userQuery = value;
    if (this._searchTimer !== null) clearTimeout(this._searchTimer);
    const q = value.trim();
    if (!q) { this._userResults = []; this._searching = false; return; }
    this._searching = true;
    this._searchTimer = window.setTimeout(async () => {
      try {
        const results = await searchUsers(q);
        const selectedIds = new Set(this._selectedUsers.map(u => u.id));
        this._userResults = results.filter(u => !selectedIds.has(u.id));
      } catch (err) {
        console.error('User search failed:', err);
        this._userResults = [];
      } finally {
        this._searching = false;
      }
    }, 250);
  }

  private _addUser(u: PublicUser)
  {
    if (!this._selectedUsers.some(s => s.id === u.id)) {
      this._selectedUsers = [...this._selectedUsers, u];
    }
    this._userQuery = '';
    this._userResults = [];
  }

  private _removeUser(u: PublicUser)
  {
    this._selectedUsers = this._selectedUsers.filter(s => s.id !== u.id);
  }

  private async _share()
  {
    const version = this._version.trim();
    if (!/^\d+\.\d+/.test(version)) {
      this._error = 'Enter a valid version like 0.1 or 1.2';
      return;
    }
    if (this._lastVersion && !isHigher(version, this._lastVersion)) {
      this._error = `Version must be higher than the last shared version (${this._lastVersion})`;
      return;
    }
    // A version is unique per file server-side, across sharing AND publishing.
    if (this._usedVersions.some(v => isSameVersion(v, version))) {
      this._error = `Version ${version} is already used by this script — try ${this._nextFreeVersion()}`;
      return;
    }

    const script = editorScript.get();
    if (!script) { this._error = 'No active script'; return; }

    // Compose the shared metadata + version onto the script for the request.
    script.version = version;
    script.shared = {
      created:     new Date().toISOString(),
      onlyUsers:   this._selectedUsers.length ? this._selectedUsers.map(u => u.id) : undefined,
      dev:         this._dev || undefined,
      licence:     this._licence as CCLicence,
    };

    this._submitting = true;
    this._error = '';
    try {
      const stored = await shareScript(script, this._thumbnailSvg);
      // The share went out before the drawing was ready — deliver it separately rather
      // than leaving this version without a preview forever. Not awaited: the dialog
      // closes now, the picture arrives when it arrives.
      if (!stored.thumbnail) void this._attachThumbnailLate(stored);
      // Reflect the stored shared metadata + version on the active script.
      script.shared = stored.shared ?? script.shared;
      script.version = stored.version ?? script.version;
      this._usedVersions = [...this._usedVersions, version];
      this._lastVersion = version;
      bumpScript();
      this.dispatchEvent(new CustomEvent<ScriptData>('share-script-done', {
        detail: stored, bubbles: true, composed: true,
      }));
    } catch (err) {
      this._error = errorMessage(err, 'Sharing failed');
    } finally {
      this._submitting = false;
    }
  }

  /**
   * Attach the preview after the share has already been stored.
   *
   * The generating run is never awaited before submitting, so for a slow script the share
   * request simply carries no drawing. Waiting for that run HERE — after the dialog has
   * closed and the user has moved on — costs nobody anything, and turns "sometimes there
   * is no thumbnail" into "the thumbnail appears a few seconds later".
   *
   * Deliberately detached from the component's lifetime: the element is gone by the time
   * this resolves, and that is fine — the closure holds everything it needs. The list
   * showing the new share was rendered before the URL existed, so the picture appears on
   * its next fetch rather than immediately.
   */
  private async _attachThumbnailLate(stored: ScriptData)
  {
    const fileId = stored.fileId ?? null;
    const versionId = (stored.id as string | undefined) ?? null;
    if (!fileId || !versionId) return;

    // Wait for the run that was still going at submit time (already resolved otherwise).
    try { await this._thumbnailRun; } catch { /* _prepareThumbnail swallows its own */ }

    const svg = this._thumbnailSvg;
    // Nothing was ever produced ('empty'/'failed') — that is a script or exporter problem
    // and is already logged; there is nothing to attach and nothing to retry.
    if (!svg) return;

    await uploadThumbnail(fileId, versionId, svg);
  }

  private _cancel()
  {
    if (this._submitting) return;
    this.dispatchEvent(new CustomEvent('share-script-cancel', { bubbles: true, composed: true }));
  }

  // ── Styles ──

  static override styles = css`
    :host { display: contents; }

    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 200;
    }

    .dialog {
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      z-index: 201;
      width: ${unsafeCSS(OVERLAY_MENU_WIDTH)};
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 64px);
      background: var(--color-bg-elevated, #fff);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg, 12px);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      font-family: var(--font-sans);
      overflow: hidden;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border);
      font-weight: 500;
      font-size: var(--text-sm);
      color: var(--color-text);
      flex-shrink: 0;
    }
    .header-title { flex: 1; }

    .close-btn {
      width: 24px; height: 24px;
      border: none; background: transparent; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--color-gray-dark, #666);
      border-radius: var(--radius-sm, 4px);
    }
    .close-btn:hover { background: color-mix(in srgb, var(--color-border) 40%, transparent); }

    .dialog-body {
      display: flex;
      flex-direction: column;
      gap: var(--space-md, 12px);
      overflow-y: auto;
      padding: 16px;
      flex: 1;
    }

    .intro {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
      line-height: 1.45;
    }

    .loading { display: flex; justify-content: center; padding: 4px; }

    .signin-required {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 20px 12px;
      text-align: center;
      color: var(--color-text-muted);
    }
    .signin-required wa-icon {
      font-size: 28px;
      color: var(--color-warning, #d97706);
    }
    .signin-required p {
      margin: 0;
      font-size: var(--text-sm);
      line-height: 1.45;
      max-width: 340px;
    }

    .field { display: flex; flex-direction: column; gap: 4px; }

    .field-label {
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--color-text-muted);
    }

    .hint {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      opacity: 0.85;
    }

    .text-input {
      width: 100%;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      padding: var(--space-xs, 4px) var(--space-sm, 8px);
      outline: none;
      transition: border-color 0.15s;
      box-sizing: border-box;
      resize: vertical;
    }
    .text-input:focus { border-color: var(--color-primary); }
    .version-input { max-width: 140px; }
    .version-row { display: flex; align-items: center; gap: 8px; }

    /* Licence dropdown — smaller option text */
    wa-select { font-size: var(--text-xs); }
    wa-option { font-size: var(--text-xs); }
    wa-option::part(label) { font-size: var(--text-xs); }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--text-sm);
      color: var(--color-text);
      cursor: pointer;
    }
    .checkbox-row code {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
      padding: 0 4px;
      border-radius: 3px;
      font-size: var(--text-xs);
    }

    /* People picker */
    .user-picker { display: flex; flex-direction: column; gap: 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 6px 2px 10px;
      border-radius: 999px;
      background: var(--color-gray-dark, #666);
      color: #fff;
      font-size: var(--text-sm);
    }
    .chip-remove {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px;
      border: none; border-radius: 50%;
      background: none; color: inherit; cursor: pointer;
      opacity: 0.85; font-size: 11px;
    }
    .chip-remove:hover { opacity: 1; background: rgba(255,255,255,0.25); }

    .search-wrap {
      display: flex; align-items: center; gap: 5px;
      padding: 4px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg);
      color: var(--color-text-muted);
    }
    .search-wrap:focus-within { border-color: var(--color-primary); }
    .search-icon { flex-shrink: 0; font-size: 13px; opacity: 0.55; }
    .search-input {
      flex: 1; min-width: 0;
      border: none; outline: none; background: transparent;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
    }
    .search-spinner { font-size: 13px; }

    .results {
      display: flex; flex-direction: column;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg-elevated);
      max-height: 180px;
      overflow-y: auto;
    }
    .result-item {
      display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
      padding: 6px 10px;
      border: none; background: transparent; cursor: pointer;
      text-align: left; width: 100%;
      font-family: var(--font-sans);
    }
    .result-item:hover { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
    .result-name { font-size: var(--text-sm); color: var(--color-text); }
    .result-email { font-size: var(--text-xs); color: var(--color-text-muted); }

    .error {
      font-size: var(--text-sm);
      color: var(--color-alert, #ef4444);
      font-weight: 500;
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .btn-primary, .btn-secondary {
      padding: 7px 16px;
      border-radius: var(--radius-sm, 4px);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      border: none;
    }
    .btn-primary { background: var(--color-primary); color: var(--color-white, #fff); }
    .btn-primary:hover:not(:disabled) { opacity: 0.88; }
    .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-secondary {
      background: transparent;
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }
    .btn-secondary:hover:not(:disabled) { background: color-mix(in srgb, var(--color-border) 30%, transparent); }
    .btn-secondary:disabled { opacity: 0.45; cursor: not-allowed; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'share-script-menu': ShareScriptMenu;
  }
}
