/**
 * <add-to-project-menu> — put the model on screen into a project (plans/PROJECTS.md).
 *
 * Used by the editor (hamburger "Add to project…") and the configurator ("Add to
 * project"): the host hands over `build`, which returns the script and its values at the
 * moment the professional confirms. Anyone signed in with a verified email can add any
 * script, their own or another author's.
 *
 * Emits:
 *   add-to-project-done    detail = { projectId, configurationId }   a configuration was added
 *   add-to-project-close   the dialog closed (after adding or not): the host resets its flag
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';
import { Router } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import { projectLabel, type ProjectSummary } from '@archiyou/types';

import { userState } from '@archiyou/editor/src/state/workspace';
import {
  listProjects, createProject, addConfiguration, uploadConfigurationThumbnail, type ConfigurationInput,
} from '@archiyou/editor/src/services/projects';

/** Server error text and code (`{ success, error, code }` body of a 4xx) when there is one. */
function errorOf(err: unknown): { message: string; code?: string }
{
  const body = (err as { body?: { error?: string; code?: string } } | undefined)?.body;
  return { message: body?.error ?? (err as Error)?.message ?? msg('Something went wrong.'), code: body?.code };
}

@customElement('add-to-project-menu')
export class AddToProjectMenu extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    // Kept in the tree and driven by `?open`, so wa-dialog plays its show transition
    return html`
      <wa-dialog label=${msg('Add to project')} ?open=${this.open} @wa-after-hide=${this._onAfterHide}>
        ${this.open ? this._renderBody() : nothing}
        ${this._renderFooter()}
      </wa-dialog>
    `;
  }

  private _renderBody()
  {
    if (userState.get().anonymous)
    {
      return html`<p class="note">${msg('Sign in to keep configurations in your projects.')}</p>`;
    }
    if (this._unverified)
    {
      return html`<p class="note">${msg('Confirm your email address first: projects can email your clients.')}</p>`;
    }
    if (this._added)
    {
      return html`
        <p class="done">
          <wa-icon library="lucide" name="circle-check"></wa-icon>
          ${msg(str`Added as v${this._added.rev} to ${this._added.label}.`)}
        </p>`;
    }
    if (this._loading)
    {
      return html`<div class="loading"><wa-spinner></wa-spinner></div>`;
    }

    const q = this._query.trim().toLowerCase();
    const shown = this._projects.filter(p => !q
      || p.title.toLowerCase().includes(q)
      || (p.clientName ?? '').toLowerCase().includes(q)
      || projectLabel(p.number).toLowerCase().includes(q));

    return html`
      <div class="choices" role="radiogroup" aria-label=${msg('Project')}>
        <label class=${this._target === 'new' ? 'choice selected' : 'choice'}>
          <input type="radio" name="target" .checked=${this._target === 'new'} @change=${() => { this._target = 'new'; }}>
          <wa-icon library="lucide" name="folder-plus"></wa-icon>
          <span class="choice-text">${msg('New project')}</span>
        </label>
        ${this._target === 'new'
          ? html`
            <wa-input class="title" size="small" label=${msg('Title')} .value=${this._title}
              @input=${(e: Event) => { this._title = (e.target as HTMLInputElement).value; }}></wa-input>`
          : nothing}

        ${this._projects.length > 6
          ? html`
            <wa-input class="search" size="small" type="search" placeholder=${msg('Search projects…')}
              .value=${this._query} @input=${(e: Event) => { this._query = (e.target as HTMLInputElement).value; }}>
              <wa-icon slot="start" library="lucide" name="search"></wa-icon>
            </wa-input>`
          : nothing}

        <div class="list">
          ${shown.map(p => html`
            <label class=${this._target === p.id ? 'choice selected' : 'choice'}>
              <input type="radio" name="target" .checked=${this._target === p.id} @change=${() => { this._target = p.id; }}>
              <span class="number">${projectLabel(p.number)}</span>
              <span class="choice-text">${p.title}</span>
              ${p.clientName ? html`<span class="client">${p.clientName}</span>` : nothing}
            </label>`)}
        </div>
      </div>

      <wa-input class="label" size="small" label=${msg('Label (optional)')} placeholder=${msg('e.g. Oak, wider top')}
        .value=${this._label} @input=${(e: Event) => { this._label = (e.target as HTMLInputElement).value; }}></wa-input>

      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
    `;
  }

  private _renderFooter()
  {
    if (this._added)
    {
      return html`
        <wa-button slot="footer" appearance="outlined" @click=${this._close}>${msg('Close')}</wa-button>
        <wa-button slot="footer" variant="brand" @click=${this._openProject}>${msg('Open project')}</wa-button>`;
    }
    const blocked = userState.get().anonymous || this._unverified;
    return html`
      <wa-button slot="footer" appearance="outlined" @click=${this._close}>${msg('Cancel')}</wa-button>
      ${blocked
        ? nothing
        : html`
          <wa-button slot="footer" variant="brand" ?loading=${this._submitting}
            ?disabled=${this._loading || (this._target === 'new' && !this._title.trim())}
            @click=${this._submit}>${msg('Add')}</wa-button>`}
    `;
  }

  // ── 2. Properties, State ──
  @property({ type: Boolean, reflect: true }) open = false;
  /** Builds what gets added, when the professional confirms. Set by the host. */
  @property({ attribute: false }) build: (() => ConfigurationInput | null) | null = null;
  /** Suggested title for a new project (usually the script's name). */
  @property({ type: String }) suggestedTitle = '';

  @state() private _projects: ProjectSummary[] = [];
  @state() private _loading = false;
  @state() private _submitting = false;
  @state() private _error = '';
  @state() private _unverified = false;
  @state() private _query = '';
  /** A project id, or 'new'. */
  @state() private _target = 'new';
  @state() private _title = '';
  @state() private _label = '';
  @state() private _added: { projectId: string; configurationId: string; rev: number; label: string } | null = null;

  // ── 3. Lifecycle ──
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open) void this._load();
  }

  // ── 4. Behaviour & Methods ──
  private async _load()
  {
    this._added = null;
    this._error = '';
    this._label = '';
    this._query = '';
    this._target = 'new';
    this._title = this.suggestedTitle;
    if (userState.get().anonymous) return;

    this._loading = true;
    try
    {
      this._projects = (await listProjects()).data;
      this._unverified = false;
    }
    catch (err)
    {
      const { message, code } = errorOf(err);
      this._unverified = code === 'email_not_verified';
      if (!this._unverified) this._error = message;
    }
    finally
    {
      this._loading = false;
    }
  }

  private async _submit()
  {
    const input = this.build?.();
    if (!input)
    {
      this._error = msg('There is no script to add.');
      return;
    }
    const configuration = { ...input, label: this._label.trim() || null };

    this._submitting = true;
    this._error = '';
    try
    {
      let projectId: string;
      let configurationId: string;
      let rev: number;
      let number: number;
      let title: string;
      if (this._target === 'new')
      {
        const project = await createProject({ title: this._title.trim(), configuration });
        projectId = project.id;
        configurationId = project.configurations[0].id;
        rev = project.configurations[0].rev;
        ({ number, title } = project);
      }
      else
      {
        const project = this._projects.find(p => p.id === this._target)!;
        const added = await addConfiguration(project.id, configuration);
        projectId = project.id;
        configurationId = added.id;
        rev = added.rev;
        ({ number, title } = project);
      }
      // The picture is a bonus: the configuration is there whether or not it lands
      void uploadConfigurationThumbnail(projectId, configurationId);
      this._added = { projectId, configurationId, rev, label: `${projectLabel(number)} ${title}` };
      this.dispatchEvent(new CustomEvent('add-to-project-done', {
        detail: { projectId, configurationId },
        bubbles: true,
        composed: true,
      }));
    }
    catch (err)
    {
      const { message, code } = errorOf(err);
      this._unverified = code === 'email_not_verified';
      this._error = message;
    }
    finally
    {
      this._submitting = false;
    }
  }

  private _openProject()
  {
    const id = this._added?.projectId;
    this._close();
    if (id) Router.go(`/projects/${id}`);
  }

  private _close()
  {
    this.open = false;
  }

  /** Only the dialog's own hide: nested Web Awesome overlays re-emit `wa-after-hide`. */
  private _onAfterHide(e: Event)
  {
    if (e.target !== e.currentTarget) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent('add-to-project-close', { bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    wa-dialog {
      --width: min(30rem, 100vw);
    }

    .note,
    .done {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text);
    }

    .done {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
    }

    .done wa-icon {
      color: var(--color-success);
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: var(--space-lg);
    }

    .choices {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      max-height: 16rem;
      overflow-y: auto;
    }

    .choice {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-height: var(--hit-min, 2.25rem);
      padding: var(--space-xs) var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: var(--text-sm);
      cursor: pointer;
    }

    .choice.selected {
      border-color: var(--color-primary);
      background: var(--color-primary-subtle);
    }

    .choice input {
      margin: 0;
    }

    .choice-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .number,
    .client {
      flex-shrink: 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .number {
      font-variant-numeric: tabular-nums;
    }

    .label {
      margin-top: var(--space-md);
    }

    .error {
      margin: var(--space-sm) 0 0;
      font-size: var(--text-sm);
      color: var(--color-danger);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'add-to-project-menu': AddToProjectMenu;
  }
}
