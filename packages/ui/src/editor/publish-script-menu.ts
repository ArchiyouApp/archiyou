/**
 * <publish-script-menu> — modal for publishing (or re-publishing) the active
 * script as an online configurator.
 *
 * Publishing makes the parametric script available as an embeddable configurator
 * where end-users tweak parameters and download "fulfillments" (a model, data
 * tables, documents). The menu collects a title, description, version (prefilled
 * with a +0.1 bump over the highest version the file already used — published OR
 * shared, since `(fileId, version)` is unique server-side), public flag, licence
 * and a list of fulfillments — each a named bundle of output paths with a delivery
 * method and optional price. Fulfillments are edited in a sub-pane on the same
 * modal.
 *
 * Prechecks (before the form shows): the user must be signed in, and the script
 * is executed once to measure duration + gather meta (entity names for the
 * output-path dropdowns). Scripts slower than 10s are rejected as too heavy.
 *
 * Emits:
 *   publish-script-done   CustomEvent<void>  — after a successful publish + Close
 *   publish-script-cancel CustomEvent<void>
 *
 * Mirrors <share-script-menu> in structure and styling.
 */

import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import { CC_LICENCES, FULFILLMENT_DELIVERIES } from '@archiyou/core/src/ScriptSchema';
import { THUMBNAIL_OUTPUT_PATH } from '@archiyou/core/src/constants';
import { getOutput } from '@archiyou/core/src/runner/worker/output';
import type { CCLicence, FulfillmentDelivery, ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';
import type { ScriptData, ScriptMeta } from '@archiyou/core/src/execution/types';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';

import { editorScript, userState, bumpScript } from '@archiyou/editor/src/state/workspace';
import { runScript, warmupWorker } from '@archiyou/editor/src/services/execution-service';
import { publishScript, fetchPublishedScript, updateConfigurator } from '@archiyou/editor/src/services/publishing';
import { fetchFileVersions } from '@archiyou/editor/src/services/scripts-sync';
import { shareReferencedComponents, type ComponentShareResult } from '@archiyou/editor/src/services/component-sharing';
import { OVERLAY_MENU_WIDTH } from '@archiyou/editor/src/settings';

import {
  publicConfiguratorUrl,
  DEFAULT_FULFILLMENTS,
  DEFAULT_LICENCE,
  ENTITY_GROUP_LABELS,
  LICENCE_LABELS,
  OUTPUT_WILDCARD,
  PUBLISH_ENTITY_GROUPS,
  exportsToRows,
  formatsForGroup,
  groupHasEntities,
  rowsToExports,
  type OutputRow,
  type PublishEntityGroup,
} from './publish-constants.js';

/** Scripts slower than this (ms) are rejected as too heavy to publish for now. */
const HEAVY_THRESHOLD_MS = 10_000;

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

/** Deep-ish clone of a fulfillment (safe for local editing). */
function cloneFulfillment(f: ScriptPublishedFulfillmentData): ScriptPublishedFulfillmentData {
  return { ...f, exports: [...(f.exports ?? [])] };
}

@customElement('publish-script-menu')
export class PublishScriptMenu extends SignalWatcher(LitElement)
{
  @property({ type: Boolean, reflect: true }) open = false;

  /** When set, the menu edits this already-published version IN PLACE (edit mode):
   *  the version is locked, no "last published" hints, and submitting updates that
   *  version's metadata rather than appending a new one. Null = fresh publish. */
  @property({ attribute: false }) editData: ScriptData | null = null;

  // ── Edit mode ──
  @state() private _editMode = false;

  // ── Precheck ──
  @state() private _precheckLoading = false;
  @state() private _precheckError   = '';
  @state() private _duration: number | null = null;
  @state() private _tooHeavy        = false;
  @state() private _meta: ScriptMeta | null = null;
  /** Line drawing captured from the precheck run, sent alongside the script on publish.
   *  Entirely automatic and not surfaced in the form: the author cannot influence it, so
   *  showing it would only add noise. Null when the script draws nothing at all or the
   *  drawing exceeded its size cap — publishing is never blocked by it. */
  @state() private _thumbnailSvg: string | null = null;

  // ── Form state ──
  @state() private _view: 'form' | 'fulfillment' = 'form';
  @state() private _version     = '0.1';
  @state() private _public      = true;
  @state() private _licence     = DEFAULT_LICENCE;
  @state() private _fulfillments: ScriptPublishedFulfillmentData[] = [];

  // ── Prefill / submit ──
  @state() private _lastVersion: string | null = null;
  /** Every version this file already used server-side (published or shared) —
   *  the server rejects a re-use, so the menu must never suggest one. */
  @state() private _usedVersions: string[] = [];
  @state() private _submitting  = false;
  @state() private _error       = '';
  @state() private _success: { url: string; public: boolean; count: number; components: ComponentShareResult[] } | null = null;

  // ── Fulfillment editor (sub-pane) ──
  @state() private _editIndex: number | null = null; // index being edited, null = new
  @state() private _fName        = '';
  @state() private _fDescription = '';
  @state() private _fDelivery: FulfillmentDelivery = 'anonymous download';
  @state() private _fPrice       = 0;
  @state() private _fRows: OutputRow[] = [];
  @state() private _fError       = '';

  // ── Render ──

  override render()
  {
    if (!this.open) return nothing;

    // Publishing requires an account (the script is stored + attributed server-side).
    if (userState.get().anonymous) return this._renderSignInRequired();

    return html`
      <div class="backdrop" @click=${this._cancel}></div>
      <div class="dialog" role="dialog" aria-modal="true"
           @click=${(e: Event) => e.stopPropagation()}>

        <div class="dialog-header">
          <wa-icon library="lucide" name="rocket"></wa-icon>
          <span class="header-title">${this._headerTitle()}</span>
          <button class="close-btn" @click=${this._cancel}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <div class="dialog-body">
          ${this._renderBody()}
        </div>

        <div class="dialog-footer">
          ${this._renderFooter()}
        </div>
      </div>
    `;
  }

  private _headerTitle(): string
  {
    if (this._success) return this._editMode ? 'Configurator updated' : 'Published';
    if (this._view === 'fulfillment') return this._editIndex === null ? 'Add fulfillment' : 'Edit fulfillment';
    return this._editMode ? 'Edit configurator' : 'Publish as configurator';
  }

  private _renderBody()
  {
    if (this._precheckLoading)
    {
      return html`<div class="loading"><wa-spinner></wa-spinner><span>Running script…</span></div>`;
    }
    if (this._precheckError)
    {
      return html`<div class="warning">
        <wa-icon library="lucide" name="triangle-alert"></wa-icon>
        <p>${this._precheckError}</p>
      </div>`;
    }
    if (this._tooHeavy)
    {
      return html`<div class="warning">
        <wa-icon library="lucide" name="triangle-alert"></wa-icon>
        <p>This script is too heavy to publish for now.</p>
        <span class="hint">${this._durationLabel()}</span>
      </div>`;
    }
    if (this._success) return this._renderSuccess();
    if (this._view === 'fulfillment') return this._renderFulfillmentEditor();
    return this._renderForm();
  }

  private _renderFooter()
  {
    if (this._success)
    {
      return html`<button class="btn-primary" @click=${this._close}>Close</button>`;
    }
    if (this._precheckLoading || this._precheckError || this._tooHeavy)
    {
      return html`<button class="btn-secondary" @click=${this._cancel}>Close</button>`;
    }
    if (this._view === 'fulfillment')
    {
      return html`
        <button class="btn-secondary" @click=${this._cancelFulfillment}>Cancel</button>
        <button class="btn-primary" @click=${this._saveFulfillment}>Save fulfillment</button>`;
    }
    return html`
      <button class="btn-secondary" @click=${this._cancel} ?disabled=${this._submitting}>Cancel</button>
      <button class="btn-primary" @click=${this._publish} ?disabled=${this._submitting}>
        ${this._editMode
          ? (this._submitting ? 'Saving…' : 'Save changes')
          : (this._submitting ? 'Publishing…' : 'Publish')}
      </button>`;
  }

  // ── Main form ──

  private _renderForm()
  {
    return html`
      <p class="intro">
        ${this._editMode
          ? html`Update this published configurator’s details, licence and fulfillments.
              Its version stays the same; publish a new version from the editor to change the model.`
          : html`Make your parametric script available online as a configurator. Please define
              what the user can do with it by choosing a licence and defining fulfillments.
              Your configurator will be available online and can be embedded into your website.`}
      </p>

      <div class="duration-line">
        <wa-icon library="lucide" name="timer"></wa-icon>
        <span>${this._durationLabel()}</span>
      </div>

      <!-- Version -->
      <div class="field">
        <label class="field-label">Version</label>
        <div class="version-row">
          <input
            class="text-input version-input"
            type="text"
            ?disabled=${this._editMode}
            .value=${this._version}
            @input=${(e: InputEvent) => { this._version = (e.target as HTMLInputElement).value; this._error = ''; }}
          />
          ${this._editMode
            ? html`<span class="hint">editing this version — cannot be changed</span>`
            : this._lastVersion
              ? html`<span class="hint">last published: <strong>${this._lastVersion}</strong></span>`
              : html`<span class="hint">(new)</span>`}
        </div>
        ${!this._editMode && this._usedVersions.length > 0
          ? html`<span class="hint">Versions already used by this script:
              <strong>${this._usedVersions.join(', ')}</strong></span>`
          : nothing}
      </div>

      <!-- Public -->
      <div class="field">
        <label class="checkbox-row">
          <input
            type="checkbox"
            .checked=${this._public}
            @change=${(e: Event) => (this._public = (e.target as HTMLInputElement).checked)}
          />
          <span>Public — feature this configurator in our public lists</span>
        </label>
      </div>

      <!-- Licence -->
      <div class="field">
        <label class="field-label">Licence</label>
        <!-- The selected attribute on the option (not value on the select) is what
             makes wa-select show a preselected licence; "change" is the event
             WebAwesome 3 emits — "wa-change" never fires. -->
        <wa-select
          class="licence-select"
          @change=${(e: Event) => (this._licence = String((e.target as HTMLElement & { value: string }).value ?? ''))}
        >
          ${CC_LICENCES.map(l => html`
            <wa-option value=${l} ?selected=${l === this._licence}>${LICENCE_LABELS[l] ?? l}</wa-option>`)}
        </wa-select>
      </div>

      <!-- Fulfillments -->
      <div class="field">
        <label class="field-label">Fulfillments</label>
        <span class="hint">What users can generate and download from your configurator.</span>
        <div class="fulfillment-list">
          ${this._fulfillments.length === 0
            ? html`<span class="hint empty">No fulfillments yet.</span>`
            : this._fulfillments.map((f, i) => this._renderFulfillmentRow(f, i))}
        </div>
        <button class="btn-add" @click=${this._startAddFulfillment}>
          <wa-icon library="lucide" name="plus"></wa-icon> Add fulfillment
        </button>
      </div>

      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
    `;
  }

  private _renderFulfillmentRow(f: ScriptPublishedFulfillmentData, i: number)
  {
    const nExports = f.exports?.length ?? 0;
    const priceLabel = f.delivery === 'pay' ? ` ${f.price ?? 0}` : '';
    const formats = this._fulfillmentFormats(f);
    return html`
      <div class="fulfillment-item">
        <div class="fulfillment-line">
          <span class="fulfillment-name">${f.name || '(unnamed)'}</span><span class="fulfillment-meta"> · ${nExports} export${nExports === 1 ? '' : 's'} · ${formats} · ${f.delivery}${priceLabel}</span>
        </div>
        <div class="fulfillment-actions">
          <button class="icon-btn" title="Edit" @click=${() => this._startEditFulfillment(i)}>
            <wa-icon library="lucide" name="pencil"></wa-icon>
          </button>
          <button class="icon-btn" title="Delete" @click=${() => this._deleteFulfillment(i)}>
            <wa-icon library="lucide" name="trash-2"></wa-icon>
          </button>
        </div>
      </div>`;
  }

  /** Distinct output formats across a fulfillment's exports, for the summary
   *  line. The '*' wildcard is expanded to every concrete format available for
   *  that group, so the card names all formats rather than just "all". */
  private _fulfillmentFormats(f: ScriptPublishedFulfillmentData): string
  {
    const formats = new Set<string>();
    for (const row of exportsToRows(f.exports ?? []))
    {
      for (const fmt of (row.formats.length ? row.formats : [OUTPUT_WILDCARD]))
      {
        if (fmt === OUTPUT_WILDCARD)
        {
          for (const groupFmt of formatsForGroup(row.category)) formats.add(groupFmt);
        }
        else
        {
          formats.add(fmt);
        }
      }
    }
    return [...formats].join(', ') || '—';
  }

  // ── Fulfillment editor ──

  private _renderFulfillmentEditor()
  {
    const pipelines = this._pipelines();
    return html`
      <div class="field">
        <label class="field-label">Name</label>
        <input
          class="text-input"
          type="text"
          placeholder="e.g. Model, Data, Documents"
          .value=${this._fName}
          @input=${(e: InputEvent) => { this._fName = (e.target as HTMLInputElement).value; this._fError = ''; }}
        />
      </div>

      <div class="field">
        <label class="field-label">Description</label>
        <textarea
          class="text-input desc-input"
          rows="2"
          placeholder="What does this fulfillment deliver?"
          .value=${this._fDescription}
          @input=${(e: InputEvent) => (this._fDescription = (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>

      <div class="field two-col">
        <div class="col">
          <label class="field-label">Delivery</label>
          <select
            class="mini-select"
            .value=${this._fDelivery}
            @change=${(e: Event) => (this._fDelivery = (e.target as HTMLSelectElement).value as FulfillmentDelivery)}
          >
            ${FULFILLMENT_DELIVERIES.map(d => html`<option value=${d} ?selected=${d === this._fDelivery}>${d}</option>`)}
          </select>
        </div>
        ${this._fDelivery === 'pay'
          ? html`
            <div class="col">
              <label class="field-label">Price</label>
              <input
                class="text-input price-input"
                type="number"
                min="0"
                step="0.01"
                .value=${String(this._fPrice)}
                @input=${(e: InputEvent) => (this._fPrice = Number((e.target as HTMLInputElement).value) || 0)}
              />
            </div>`
          : nothing}
      </div>

      <div class="field">
        <label class="field-label">Outputs</label>
        <span class="hint">Each output line resolves to downloadable files. Toggle the formats to include.</span>
        <div class="rows">
          ${this._fRows.map((row, i) => this._renderOutputRow(row, i, pipelines))}
        </div>
        <button class="btn-add" @click=${this._addRow}>
          <wa-icon library="lucide" name="plus"></wa-icon> Add output
        </button>
      </div>

      ${this._fError ? html`<div class="error">${this._fError}</div>` : nothing}
    `;
  }

  private _renderOutputRow(row: OutputRow, i: number, pipelines: string[])
  {
    const entityNames = this._entityNames(row.category);
    const formats = formatsForGroup(row.category);
    return html`
      <div class="output-row">
        <div class="output-selects">
          <select
            class="mini-select"
            title="Pipeline"
            @change=${(e: Event) => this._updateRow(i, { pipeline: (e.target as HTMLSelectElement).value })}
          >
            ${pipelines.map(p => html`<option value=${p} ?selected=${p === row.pipeline}>${p}</option>`)}
          </select>

          <select
            class="mini-select"
            title="Entity group"
            @change=${(e: Event) => this._setRowGroup(i, (e.target as HTMLSelectElement).value as PublishEntityGroup)}
          >
            ${PUBLISH_ENTITY_GROUPS.map(g => html`
              <option value=${g} ?selected=${g === row.category}>${ENTITY_GROUP_LABELS[g]}</option>`)}
          </select>

          <select
            class="mini-select"
            title="Entity"
            ?disabled=${!groupHasEntities(row.category)}
            @change=${(e: Event) => this._updateRow(i, { entity: (e.target as HTMLSelectElement).value })}
          >
            <option value=${OUTPUT_WILDCARD} ?selected=${row.entity === OUTPUT_WILDCARD}>all</option>
            ${entityNames.map(n => html`<option value=${n} ?selected=${n === row.entity}>${n}</option>`)}
          </select>

          <button class="icon-btn" title="Remove output" @click=${() => this._removeRow(i)}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <div class="format-tags">
          ${formats.map(fmt => {
            const on = row.formats.includes(fmt);
            return html`
              <button
                class="tag ${on ? 'tag-on' : ''}"
                @click=${() => this._toggleRowFormat(i, fmt)}
              >${fmt}</button>`;
          })}
        </div>
      </div>`;
  }

  // ── Success ──

  private _renderSuccess()
  {
    const s = this._success!;
    return html`
      <div class="success">
        <wa-icon class="success-icon" library="lucide" name="circle-check"></wa-icon>
        <p class="success-title">${this._editMode ? 'Your configurator was updated!' : 'Your configurator is published!'}</p>
        <p class="success-line">It is available at:</p>
        <a class="success-url" href=${s.url} target="_blank" rel="noopener">${s.url}</a>
        <p class="success-line">
          ${s.public
            ? 'It is also featured in our public list of configurators because you chose “Public”.'
            : 'It is not featured in our public lists because you did not choose “Public”. Anyone with the link can still use it.'}
        </p>
        ${this._renderSharedComponents(s.components)}
        <p class="hint">${s.count} fulfillment${s.count === 1 ? '' : 's'} · version ${this._version}</p>
      </div>`;
  }

  /** Tell the author what publishing did to their other scripts. Sharing is a visible
   *  change to a script they did not explicitly share, so it is never silent — and the
   *  distinction matters: shared means readable, not published as a configurator. */
  private _renderSharedComponents(components: ComponentShareResult[])
  {
    const shared  = components.filter(c => c.action === 'shared');
    const already = components.filter(c => c.action === 'already-shared');
    if (!shared.length && !already.length) return nothing;

    const label = (c: ComponentShareResult) => c.version ? `${c.name} ${c.version}` : c.name;

    return html`
      <div class="components-note">
        <wa-icon library="lucide" name="share-2"></wa-icon>
        <div>
          ${shared.length ? html`
            <p class="success-line">
              This configurator uses ${shared.length === 1 ? 'a component' : 'components'} from your other
              scripts, so ${shared.length === 1 ? 'it was' : 'they were'} <strong>shared</strong> automatically —
              otherwise the configurator cannot load ${shared.length === 1 ? 'it' : 'them'}:
            </p>
            <ul class="components-list">${shared.map(c => html`<li>${label(c)}</li>`)}</ul>` : nothing}
          ${already.length ? html`
            <p class="success-line">
              Already shared and unchanged: ${already.map(label).join(', ')}.
            </p>` : nothing}
          <p class="hint">
            Sharing only makes a script readable. These components are not published as
            configurators of their own and do not appear in your configurator list.
          </p>
        </div>
      </div>`;
  }

  /** Shown instead of the form when the user is not signed in. */
  private _renderSignInRequired()
  {
    return html`
      <div class="backdrop" @click=${this._cancel}></div>
      <div class="dialog" role="dialog" aria-modal="true"
           @click=${(e: Event) => e.stopPropagation()}>

        <div class="dialog-header">
          <wa-icon library="lucide" name="rocket"></wa-icon>
          <span class="header-title">Publish as configurator</span>
          <button class="close-btn" @click=${this._cancel}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <div class="dialog-body">
          <div class="warning">
            <wa-icon library="lucide" name="lock"></wa-icon>
            <p>You need to be logged in to publish as configurator.</p>
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
    if (changed.has('open') && this.open && !userState.get().anonymous) void this._prepare();

    // Keep the licence dropdown in sync once it has options (its value lags the
    // slotted options on first paint, and prefill arrives after the fetch).
    const select = this.renderRoot?.querySelector('.licence-select') as (HTMLElement & { value: string | string[] | null }) | null;
    if (select && select.value !== this._licence) select.value = this._licence;
  }

  // ── Precheck + prefill ──

  private _resetAll()
  {
    this._precheckError = '';
    this._error = '';
    this._tooHeavy = false;
    this._duration = null;
    this._meta = null;
    this._thumbnailSvg = null;
    this._success = null;
    this._view = 'form';
    this._public = true;
    this._licence = DEFAULT_LICENCE;
    this._lastVersion = null;
    this._usedVersions = [];
    this._version = '0.1';
    this._editMode = false;
    this._fulfillments = DEFAULT_FULFILLMENTS.map(cloneFulfillment);
  }

  /** Run the script (duration + meta), then prefill. In edit mode the source is the
   *  edited published version (`editData`); otherwise the active script. */
  private async _prepare()
  {
    this._resetAll();
    this._editMode = !!this.editData;

    this._precheckLoading = true;
    try
    {
      // Edit mode is self-contained on the edited version; fresh mode runs the
      // active script.
      const scriptData: ScriptData | undefined = this._editMode
        ? this.editData ?? undefined
        : editorScript.get()?.toData();
      if (!scriptData) { this._precheckError = 'No active script to publish.'; return; }

      await warmupWorker();
      // The thumbnail rides along on the precheck run rather than costing a second
      // execution: the hidden-line projection is cheap next to the script itself, and
      // this run already has to happen to measure duration and collect ScriptMeta.
      const result = await runScript({
        kernel:     'mesh',
        script:     scriptData,
        outputs:    ['default/model/glb', THUMBNAIL_OUTPUT_PATH],
        messages:   ['error'],
        unitSystem: scriptData.units ?? 'metric',
      } as RunnerScriptExecutionRequest);

      this._duration = result?.duration ?? 0;
      this._meta = result?.meta ?? null;
      // Best-effort: a script that draws nothing at all, or one whose drawing blew the
      // size cap, simply gets no preview. Never blocks publishing.
      this._thumbnailSvg = result
        ? ((getOutput(result, THUMBNAIL_OUTPUT_PATH) as string | undefined) ?? null)
        : null;

      // Heaviness only blocks a fresh publish — an already-published configurator
      // must stay editable.
      if (!this._editMode && (this._duration ?? 0) > HEAVY_THRESHOLD_MS) { this._tooHeavy = true; return; }

      if (this._editMode) this._prefillFromEdit(scriptData);
      else await this._prefill(editorScript.get()!);
    }
    catch (err)
    {
      this._precheckError = (err as Error)?.message ?? 'Could not run the script.';
    }
    finally
    {
      this._precheckLoading = false;
    }
  }

  /** Edit mode: prefill the form from the edited published version and lock the
   *  version (no bump, no "last published" hint). */
  private _prefillFromEdit(data: ScriptData)
  {
    const p = data.published;
    this._version       = data.version ?? '';
    this._licence       = p?.licence ?? DEFAULT_LICENCE;
    this._public        = p?.public ?? true;
    this._fulfillments  = (p?.fulfillments?.length ? p.fulfillments : DEFAULT_FULFILLMENTS).map(cloneFulfillment);
    this._lastVersion   = null; // no previous-version messaging in edit mode
  }

  private async _prefill(script: NonNullable<ReturnType<typeof editorScript.get>>)
  {
    const author = script.author ?? userState.get().id ?? null;
    const name = script.name ?? null;

    // Versions of *this file*: uniqueness is per (fileId, version) across the
    // published AND shared libraries, so a version shared earlier is taken too.
    this._usedVersions = script.fileId
      ? [...new Set(await fetchFileVersions(script.fileId))].sort((a, b) => (isHigher(a, b) ? 1 : -1))
      : [];

    if (author && name)
    {
      const prev = await fetchPublishedScript(author, name);
      if (prev?.published)
      {
        this._lastVersion = prev.version ?? null;
        this._licence     = prev.published.licence ?? DEFAULT_LICENCE;
        this._public      = prev.published.public ?? true;
        if (prev.published.fulfillments?.length)
        {
          this._fulfillments = prev.published.fulfillments.map(cloneFulfillment);
        }
      }
    }

    this._version = this._nextFreeVersion();
  }

  /** A +0.1 bump over the highest version this file ever used (published, shared
   *  or the last published one), so the suggestion can never collide server-side. */
  private _nextFreeVersion(): string
  {
    const known = [...this._usedVersions];
    if (this._lastVersion) known.push(this._lastVersion);
    return bumpVersion(highestVersion(known));
  }

  // ── Fulfillment list actions ──

  private _startAddFulfillment()
  {
    this._editIndex = null;
    this._fName = '';
    this._fDescription = '';
    this._fDelivery = 'anonymous download';
    this._fPrice = 0;
    this._fRows = [this._defaultRow()];
    this._fError = '';
    this._view = 'fulfillment';
  }

  private _startEditFulfillment(i: number)
  {
    const f = this._fulfillments[i];
    if (!f) return;
    this._editIndex = i;
    this._fName = f.name ?? '';
    this._fDescription = f.description ?? '';
    this._fDelivery = f.delivery ?? 'anonymous download';
    this._fPrice = f.price ?? 0;
    // Expand a stored '*' wildcard into every concrete format so all tags show selected.
    const rows = exportsToRows(f.exports ?? []).map(r => ({
      ...r,
      formats: r.formats.includes(OUTPUT_WILDCARD) ? formatsForGroup(r.category) : r.formats,
    }));
    this._fRows = rows.length ? rows : [this._defaultRow()];
    this._fError = '';
    this._view = 'fulfillment';
  }

  private _deleteFulfillment(i: number)
  {
    this._fulfillments = this._fulfillments.filter((_, idx) => idx !== i);
  }

  private _cancelFulfillment()
  {
    this._view = 'form';
  }

  private _saveFulfillment()
  {
    const name = this._fName.trim();
    if (!name) { this._fError = 'Please enter a name for this fulfillment.'; return; }

    const exports = rowsToExports(this._fRows);
    if (exports.length === 0) { this._fError = 'Add at least one output.'; return; }

    const fulfillment: ScriptPublishedFulfillmentData = {
      name,
      description: this._fDescription.trim() || undefined,
      exports,
      delivery: this._fDelivery,
      price: this._fDelivery === 'pay' ? this._fPrice : 0,
    };

    if (this._editIndex === null)
    {
      this._fulfillments = [...this._fulfillments, fulfillment];
    }
    else
    {
      const idx = this._editIndex;
      this._fulfillments = this._fulfillments.map((f, i) => (i === idx ? fulfillment : f));
    }
    this._view = 'form';
  }

  // ── Output row helpers ──

  private _defaultRow(): OutputRow
  {
    // Start with every available format selected.
    return { pipeline: this._pipelines()[0], category: 'model', entity: OUTPUT_WILDCARD, formats: formatsForGroup('model') };
  }

  private _pipelines(): string[]
  {
    const p = this._meta?.pipelines;
    return p && p.length ? Array.from(new Set<string>(p)) : ['default'];
  }

  private _entityNames(group: PublishEntityGroup): string[]
  {
    if (group === 'tables') return this._meta?.tables ?? [];
    if (group === 'docs')   return this._meta?.docs ?? [];
    return [];
  }

  private _updateRow(i: number, patch: Partial<OutputRow>)
  {
    this._fRows = this._fRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  }

  private _setRowGroup(i: number, group: PublishEntityGroup)
  {
    // Available entities + formats depend on the group — reset entity and select all formats.
    this._updateRow(i, { category: group, entity: OUTPUT_WILDCARD, formats: formatsForGroup(group) });
  }

  private _toggleRowFormat(i: number, fmt: string)
  {
    const row = this._fRows[i];
    if (!row) return;
    const next = row.formats.includes(fmt)
      ? row.formats.filter(f => f !== fmt)
      : [...row.formats, fmt];
    this._updateRow(i, { formats: next });
  }

  private _addRow()
  {
    this._fRows = [...this._fRows, this._defaultRow()];
  }

  private _removeRow(i: number)
  {
    this._fRows = this._fRows.filter((_, idx) => idx !== i);
  }

  // ── Publish ──

  private async _publish()
  {
    if (this._editMode) return this._saveEdit();

    const version = this._version.trim();
    if (!/^\d+\.\d+/.test(version))
    {
      this._error = 'Enter a valid version like 0.1 or 1.2';
      return;
    }
    if (this._lastVersion && !isHigher(version, this._lastVersion))
    {
      this._error = `Version must be higher than the last published version (${this._lastVersion})`;
      return;
    }
    // A version is unique per file server-side, across publishing AND sharing.
    if (this._usedVersions.some(v => isSameVersion(v, version)))
    {
      this._error = `Version ${version} is already used by this script — try ${this._nextFreeVersion()}`;
      return;
    }

    const script = editorScript.get();
    if (!script) { this._error = 'No active script'; return; }

    // Compose the published metadata + version onto the script for the request.
    script.version = version;
    script.published = {
      title:        script.name || undefined,
      description:  script.description?.trim() || undefined,
      public:       this._public,
      licence:      this._licence as CCLicence,
      // `validated` is deliberately absent: it is admin-only state that the server owns
      // (ScriptStore.toRow forces it off on every insert, ScriptStore.setValidated is the
      // only writer). Sending it from here would be ignored and read as if it mattered.
      fulfillments: this._fulfillments,
    };

    this._submitting = true;
    this._error = '';
    try
    {
      // Share the script's $component() dependencies FIRST. A published configurator
      // carries only this script's code; its components are read from the author's
      // shared library at run time, so publishing before they are readable would put a
      // broken configurator online. A failure here aborts the publish (reported below).
      const components = await shareReferencedComponents(script, this._licence as CCLicence);
      const failed = components.filter(c => c.action === 'failed' || c.action === 'not-found');
      if (failed.length)
      {
        this._error = failed.map(c => c.action === 'not-found'
          ? `Component “${c.name}” was not found in your scripts — the configurator cannot run without it.`
          : `Could not share component “${c.name}”: ${c.error ?? 'unknown error'}`,
        ).join(' ');
        return;
      }

      const stored = await publishScript(script, this._thumbnailSvg);
      // Reflect the stored metadata + version on the active script.
      script.published = stored.published ?? script.published;
      script.version = stored.version ?? script.version;
      this._usedVersions = [...this._usedVersions, version];
      this._lastVersion = version;
      bumpScript();

      const author = stored.author ?? script.author ?? userState.get().id ?? 'me';
      const name = stored.name ?? script.name ?? 'script';
      // The server stamps published.url from FRONTEND_URL; keep only its path and
      // put it back on the current origin, so the link is right even when that env
      // var is unset or points at another environment.
      this._success = {
        url: publicConfiguratorUrl(stored.published?.url, author, name, stored.version ?? version),
        public: this._public,
        count: this._fulfillments.length,
        components,
      };
    }
    catch (err)
    {
      this._error = errorMessage(err, 'Publishing failed');
    }
    finally
    {
      this._submitting = false;
    }
  }

  /** Edit mode: update the edited version's published metadata in place (version +
   *  code snapshot untouched). */
  private async _saveEdit()
  {
    const editData = this.editData;
    if (!editData || !editData.id) { this._error = 'Missing configurator to edit'; return; }

    const payload: ScriptData = {
      ...editData,
      published: {
        ...(editData.published ?? {}),
        title:        editData.name || undefined,
        description:  editData.description?.trim() || undefined,
        public:       this._public,
        licence:      this._licence as CCLicence,
        // Not sent — server-owned, and preserved across a metadata edit by
        // ScriptStore.updatePublishedVersion(). See the publish path above.
        fulfillments: this._fulfillments,
      },
    };

    this._submitting = true;
    this._error = '';
    try
    {
      // Edit mode re-runs the script in _prepare(), so this also regenerates the
      // preview — an existing configurator can get a fresh thumbnail without a
      // version bump (the filename is content-addressed, so the URL changes with it).
      const stored = await updateConfigurator(payload, this._thumbnailSvg);
      const author = stored.author ?? editData.author ?? userState.get().id ?? 'me';
      const name   = stored.name ?? editData.name ?? 'script';
      this._success = {
        url: publicConfiguratorUrl(stored.published?.url, author, name, stored.version ?? this._version),
        public: this._public,
        count: this._fulfillments.length,
        // Edit mode touches only the published metadata; the code snapshot (and so its
        // component references) is untouched, and those were shared when it was published.
        components: [],
      };
    }
    catch (err)
    {
      this._error = errorMessage(err, 'Saving failed');
    }
    finally
    {
      this._submitting = false;
    }
  }

  private _durationLabel(): string
  {
    const ms = this._duration ?? 0;
    return ms >= 1000 ? `Script runs in ${(ms / 1000).toFixed(1)} s` : `Script runs in ${Math.round(ms)} ms`;
  }

  private _cancel()
  {
    if (this._submitting) return;
    this.dispatchEvent(new CustomEvent('publish-script-cancel', { bubbles: true, composed: true }));
  }

  private _close()
  {
    this.dispatchEvent(new CustomEvent('publish-script-done', { bubbles: true, composed: true }));
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

    .loading {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 24px 4px;
      color: var(--color-text-muted);
      font-size: var(--text-sm);
    }

    .warning {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 20px 12px;
      text-align: center;
      color: var(--color-text-muted);
    }
    .warning wa-icon { font-size: 28px; color: var(--color-warning, #d97706); }
    .warning p { margin: 0; font-size: var(--text-sm); line-height: 1.45; max-width: 340px; }

    .duration-line {
      display: flex; align-items: center; gap: 6px;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .field { display: flex; flex-direction: column; gap: 4px; }
    .field.two-col { flex-direction: row; gap: 12px; }
    .field.two-col .col { display: flex; flex-direction: column; gap: 4px; flex: 1; }

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
    .hint.empty { padding: 4px 0; }

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
    .price-input { max-width: 140px; }
    .version-row { display: flex; align-items: center; gap: 8px; }
    .desc-input { font-size: var(--text-xs); }

    .mini-select {
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--color-text);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      padding: 3px 6px;
      outline: none;
    }
    .mini-select:focus { border-color: var(--color-primary); }
    .mini-select:disabled { opacity: 0.5; }

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

    /* Fulfillment list */
    .fulfillment-list { display: flex; flex-direction: column; gap: 4px; }
    .fulfillment-item {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 6px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg);
    }
    /* single-line summary: name · N exports · formats · delivery (ellipsis on overflow) */
    .fulfillment-line {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-size: var(--text-xs);
      line-height: 1.5;
    }
    .fulfillment-name { color: var(--color-text); font-weight: 600; }
    .fulfillment-meta { color: var(--color-text-muted); }
    .fulfillment-actions { display: flex; gap: 1px; flex-shrink: 0; }

    .icon-btn {
      width: 22px; height: 22px;
      border: none; background: transparent; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted, #666);
      border-radius: var(--radius-sm, 4px);
      font-size: 12px;
    }
    .icon-btn:hover { background: color-mix(in srgb, var(--color-border) 40%, transparent); color: var(--color-text); }

    .btn-add {
      align-self: flex-start;
      display: inline-flex; align-items: center; gap: 5px;
      margin-top: 4px;
      padding: 5px 10px;
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: transparent;
      color: var(--color-text);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      cursor: pointer;
    }
    .btn-add:hover { border-color: var(--color-primary); color: var(--color-primary); }

    /* Output rows */
    .rows { display: flex; flex-direction: column; gap: 10px; }
    .output-row {
      display: flex; flex-direction: column; gap: 6px;
      padding: 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-bg);
    }
    .output-selects { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .output-selects .mini-select { flex: 1; min-width: 90px; }
    .output-selects .icon-btn { flex-shrink: 0; margin-left: auto; }

    .format-tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .tag {
      padding: 2px 8px;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      background: transparent;
      color: var(--color-text-muted);
      font-family: var(--font-mono, monospace);
      font-size: var(--text-xs);
      cursor: pointer;
      transition: all 0.12s;
    }
    .tag:hover { border-color: var(--color-primary); }
    .tag-on {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: var(--color-white, #fff);
    }

    /* Success */
    .success {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 12px 8px; text-align: center;
    }
    .success-icon { font-size: 40px; color: var(--color-success, #16a34a); }
    .success-title { margin: 4px 0 0; font-size: var(--text-base); font-weight: 600; color: var(--color-text); }
    .success-line { margin: 0; font-size: var(--text-sm); color: var(--color-text-muted); line-height: 1.45; max-width: 380px; }
    .success-url {
      font-family: var(--font-mono, monospace);
      font-size: var(--text-sm);
      color: var(--color-primary);
      word-break: break-all;
    }

    /* Auto-shared components. Left-aligned inside the centred success block: it is a
       list of names, and centred lists are hard to scan. */
    .components-note {
      display: flex; gap: 8px; align-items: flex-start;
      margin-top: 4px; padding: 10px 12px;
      text-align: left;
      border: 1px solid var(--color-border, #e5e7eb);
      border-radius: 6px;
      background: var(--color-surface-sunken, rgba(0, 0, 0, 0.03));
      max-width: 380px;
    }
    .components-note wa-icon { flex: 0 0 auto; margin-top: 2px; color: var(--color-text-muted); }
    .components-note .success-line { max-width: none; }
    .components-list {
      margin: 4px 0 6px; padding-left: 18px;
      font-size: var(--text-sm); color: var(--color-text);
    }
    .components-list li { font-family: var(--font-mono, monospace); }

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
    'publish-script-menu': PublishScriptMenu;
  }
}
