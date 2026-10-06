/**
 * <page-project> — one of the professional's projects, at /projects/:id (plans/PROJECTS.md).
 *
 * The header carries the number, title and status (with only the status changes that are
 * allowed from here); the main column the configurations (and, from phase 3, the
 * deliveries); the side column the client, the professional's note and the activity.
 * Opening the page clears the project's unread dot (the server marks it seen).
 */

import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';
import { Router, type RouterLocation } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@archiyou/ui/projects/project-configurations.js';
import '@archiyou/ui/projects/project-activity.js';

import { projectLabel, type ClientData, type ClientInput, type ConfigurationData, type ProjectData, type ProjectStatus } from '@archiyou/types';

import {
  fetchProject, updateProject, deleteProject, setConfigurationLabel, listClients, createClient, updateClient,
  configuratorPathFor, editorOpening, openSourceWithValues, openSnapshotCopy,
} from '../services/projects.js';
import { ApiError } from '../services/api.js';
import { BREAKPOINT_COMPACT } from '../styles/design-tokens.js';
import { userState } from '../state/workspace';

/** The status changes offered from each status (the server enforces the same table). */
const NEXT_STATUS: Record<ProjectStatus, ProjectStatus[]> = {
  request: ['active', 'lost'],
  active: ['won', 'lost'],
  won: ['active'],
  lost: ['active'],
};

const CLIENT_FIELDS: Array<keyof ClientInput> = ['name', 'email', 'company', 'phone', 'address'];

/** Server error text from an ApiError body, else the error's own message. */
function errorText(err: unknown, fallback: string): string
{
  const body = (err as ApiError | undefined)?.body as { error?: string } | undefined;
  return body?.error ?? (err as Error)?.message ?? fallback;
}

@customElement('page-project')
export class PageProject extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    if (userState.get().anonymous)
    {
      return html`<div class="center"><p>${msg('Sign in to see your projects.')}</p></div>`;
    }
    if (this._error && !this._project)
    {
      return html`
        <div class="center">
          <wa-icon library="lucide" name="folder-x"></wa-icon>
          <p>${this._error}</p>
          <wa-button appearance="outlined" @click=${() => Router.go('/browser/projects')}>${msg('Back to projects')}</wa-button>
        </div>`;
    }
    const p = this._project;
    if (!p) return html`<div class="center"><wa-spinner></wa-spinner></div>`;

    return html`
      ${this._renderHeader(p)}
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}

      <div class="columns">
        <div class="main">
          <section>
            <h2>${msg('Configurations')}</h2>
            <project-configurations
              .configurations=${p.configurations}
              me=${userState.get().id ?? ''}
              @configuration-open-configurator=${this._openConfigurator}
              @configuration-open-editor=${this._openEditor}
              @configuration-label=${this._setLabel}
            ></project-configurations>
          </section>
        </div>

        <aside class="side">
          <section class="card">
            <h2>${msg('Client')}</h2>
            ${this._editingClient ? this._renderClientForm(p) : this._renderClient(p.client)}
          </section>

          <section class="card">
            <h2>${msg('Note')}</h2>
            <wa-textarea size="small" resize="auto" placeholder=${msg('Only you see this.')}
              .value=${p.note ?? ''} @change=${this._saveNote}></wa-textarea>
          </section>

          <section class="card">
            <h2>${msg('Activity')}</h2>
            <project-activity .events=${p.events}></project-activity>
          </section>
        </aside>
      </div>

      ${this._renderChangedDialog()}
      ${this._renderDeleteDialog(p)}
    `;
  }

  private _renderHeader(p: ProjectData)
  {
    const statusLabels = this._statusLabels();
    return html`
      <header class="head">
        <a class="back" href="/browser/projects">
          <wa-icon library="lucide" name="arrow-left"></wa-icon>${msg('Projects')}
        </a>
        <div class="title-row">
          <span class="number">${projectLabel(p.number)}</span>
          <wa-input class="title" size="small" .value=${p.title} aria-label=${msg('Title')}
            @change=${this._rename}></wa-input>
          <wa-badge variant=${this._statusVariant(p.status)}>${statusLabels[p.status]}</wa-badge>
          ${p.archived ? html`<wa-badge variant="neutral" appearance="outlined">${msg('Archived')}</wa-badge>` : nothing}
        </div>
        <div class="actions">
          ${NEXT_STATUS[p.status].map(to => html`
            <wa-button size="small" variant=${to === 'lost' ? 'neutral' : 'brand'}
              appearance=${to === 'active' && p.status === 'request' ? 'accent' : 'outlined'}
              @click=${() => this._setStatus(to)}>${this._transitionLabel(p.status, to)}</wa-button>`)}
          <wa-dropdown placement="bottom-end" @wa-select=${this._onMenu}>
            <wa-button slot="trigger" size="small" appearance="plain">
              <wa-icon library="lucide" name="ellipsis" label=${msg('More')}></wa-icon>
            </wa-button>
            <wa-dropdown-item value="archive">
              <wa-icon slot="icon" library="lucide" name=${p.archived ? 'archive-restore' : 'archive'}></wa-icon>
              ${p.archived ? msg('Unarchive') : msg('Archive')}
            </wa-dropdown-item>
            <wa-dropdown-item value="delete" variant="danger">
              <wa-icon slot="icon" library="lucide" name="trash-2"></wa-icon>
              ${msg('Delete project')}
            </wa-dropdown-item>
          </wa-dropdown>
        </div>
      </header>
    `;
  }

  private _renderClient(client: ClientData | null)
  {
    if (!client)
    {
      return html`
        <p class="muted">${msg('No client yet.')}</p>
        <wa-button size="small" appearance="outlined" @click=${this._editClient}>
          <wa-icon slot="start" library="lucide" name="user-plus"></wa-icon>${msg('Add client')}
        </wa-button>`;
    }
    return html`
      <dl class="client">
        ${client.name ? html`<dt>${msg('Name')}</dt><dd>${client.name}</dd>` : nothing}
        ${client.company ? html`<dt>${msg('Company')}</dt><dd>${client.company}</dd>` : nothing}
        ${client.email ? html`<dt>${msg('Email')}</dt><dd><a href="mailto:${client.email}">${client.email}</a></dd>` : nothing}
        ${client.phone ? html`<dt>${msg('Phone')}</dt><dd><a href="tel:${client.phone}">${client.phone}</a></dd>` : nothing}
        ${client.address ? html`<dt>${msg('Address')}</dt><dd class="address">${client.address}</dd>` : nothing}
      </dl>
      <wa-button size="small" appearance="outlined" @click=${this._editClient}>
        <wa-icon slot="start" library="lucide" name="pencil"></wa-icon>${msg('Edit')}
      </wa-button>`;
  }

  private _renderClientForm(p: ProjectData)
  {
    const labels: Record<string, string> = {
      name: msg('Name'), email: msg('Email'), company: msg('Company'), phone: msg('Phone'), address: msg('Address'),
    };
    return html`
      ${!p.client && this._clients.length
        ? html`
          <wa-select size="small" label=${msg('Existing client')} placeholder=${msg('Choose…')}
            @change=${this._pickClient}>
            ${this._clients.map(c => html`<wa-option value=${c.id}>${c.name ?? c.email ?? c.company}</wa-option>`)}
          </wa-select>
          <p class="muted or">${msg('or a new one:')}</p>`
        : nothing}
      <form class="client-form" @submit=${this._saveClient}>
        ${CLIENT_FIELDS.map(f => html`
          <wa-input size="small" name=${f} label=${labels[f]} type=${f === 'email' ? 'email' : 'text'}
            .value=${(this._clientDraft[f] as string | null) ?? ''}
            @input=${(e: Event) => { this._clientDraft = { ...this._clientDraft, [f]: (e.target as HTMLInputElement).value }; }}
          ></wa-input>`)}
        <div class="form-actions">
          <wa-button size="small" appearance="outlined" @click=${() => { this._editingClient = false; }}>${msg('Cancel')}</wa-button>
          <wa-button size="small" variant="brand" type="submit" ?loading=${this._saving}>${msg('Save')}</wa-button>
        </div>
      </form>`;
  }

  /** The source script changed since the snapshot: open which? */
  private _renderChangedDialog()
  {
    const pending = this._changed;
    return html`
      <wa-dialog label=${msg('The script has changed')} ?open=${!!pending}
        @wa-after-hide=${(e: Event) => { if (e.target === e.currentTarget) this._changed = null; }}>
        <p>${pending ? msg(str`The script is no longer what it was when v${pending.rev} was saved.`) : ''}</p>
        <wa-button slot="footer" appearance="outlined" @click=${() => this._openChanged('copy')}>
          ${pending ? msg(str`Open v${pending.rev} as a copy`) : ''}
        </wa-button>
        <wa-button slot="footer" variant="brand" @click=${() => this._openChanged('source')}>
          ${msg('Open the current script with these values')}
        </wa-button>
      </wa-dialog>`;
  }

  private _renderDeleteDialog(p: ProjectData)
  {
    return html`
      <wa-dialog label=${msg('Delete project')} ?open=${this._confirmDelete}
        @wa-after-hide=${(e: Event) => { if (e.target === e.currentTarget) this._confirmDelete = false; }}>
        <p>${msg(str`Delete ${projectLabel(p.number)} ${p.title} with its configurations, deliveries and activity? Links you sent stop working. This cannot be undone.`)}</p>
        <wa-button slot="footer" appearance="outlined" @click=${() => { this._confirmDelete = false; }}>${msg('Cancel')}</wa-button>
        <wa-button slot="footer" variant="danger" @click=${this._delete}>${msg('Delete')}</wa-button>
      </wa-dialog>`;
  }

  // ── 2. Properties, State ──
  /** Set by the router. */
  @property({ attribute: false }) location?: RouterLocation;

  @state() private _project: ProjectData | null = null;
  @state() private _error = '';
  @state() private _saving = false;
  @state() private _editingClient = false;
  @state() private _clientDraft: ClientInput = {};
  /** The professional's other clients, for "Existing client". */
  @state() private _clients: ClientData[] = [];
  @state() private _confirmDelete = false;
  /** A configuration whose source script changed, waiting for the professional's choice. */
  @state() private _changed: (ConfigurationData & { snapshot: ConfigurationData }) | null = null;

  // ── 3. Lifecycle ──
  override willUpdate(changed: Map<string, unknown>)
  {
    if (changed.has('location')) void this._load();
  }

  // ── 4. Behaviour & Methods ──
  private get _id(): string
  {
    return (this.location?.params as Record<string, string> | undefined)?.id ?? '';
  }

  private async _load()
  {
    if (!this._id || userState.get().anonymous) return;
    this._error = '';
    try
    {
      this._project = await fetchProject(this._id);
    }
    catch (err)
    {
      this._project = null;
      this._error = (err as ApiError)?.status === 404 ? msg('This project does not exist.') : errorText(err, msg('Could not load the project.'));
    }
  }

  /** Run a change against the server and show the project it returns. */
  private async _apply(change: () => Promise<ProjectData | void>)
  {
    this._error = '';
    try
    {
      const next = await change();
      if (next) this._project = next;
      else await this._load();
    }
    catch (err)
    {
      this._error = errorText(err, msg('That did not work.'));
    }
  }

  private _statusLabels(): Record<ProjectStatus, string>
  {
    return { request: msg('Request'), active: msg('Active'), won: msg('Won'), lost: msg('Lost') };
  }

  private _statusVariant(status: ProjectStatus): 'warning' | 'brand' | 'success' | 'neutral'
  {
    return ({ request: 'warning', active: 'brand', won: 'success', lost: 'neutral' } as const)[status];
  }

  private _transitionLabel(from: ProjectStatus, to: ProjectStatus): string
  {
    if (from === 'request') return to === 'active' ? msg('Start project') : msg('Decline');
    if (to === 'active') return msg('Reopen');
    return to === 'won' ? msg('Mark won') : msg('Mark lost');
  }

  private _rename(e: Event)
  {
    const title = (e.target as HTMLInputElement).value.trim();
    if (!title || title === this._project?.title) return;
    void this._apply(() => updateProject(this._id, { title }));
  }

  private _setStatus(status: ProjectStatus)
  {
    void this._apply(() => updateProject(this._id, { status }));
  }

  private _saveNote(e: Event)
  {
    const note = (e.target as HTMLTextAreaElement).value;
    if (note === (this._project?.note ?? '')) return;
    void this._apply(() => updateProject(this._id, { note }));
  }

  private _onMenu(e: CustomEvent<{ item: { value: string } }>)
  {
    const value = e.detail.item.value;
    if (value === 'archive') void this._apply(() => updateProject(this._id, { archived: !this._project?.archived }));
    if (value === 'delete') this._confirmDelete = true;
  }

  private async _delete()
  {
    this._confirmDelete = false;
    try
    {
      await deleteProject(this._id);
      Router.go('/browser/projects');
    }
    catch (err)
    {
      this._error = errorText(err, msg('Could not delete the project.'));
    }
  }

  //// CLIENT ////

  private async _editClient()
  {
    const client = this._project?.client;
    this._clientDraft = client ? Object.fromEntries(CLIENT_FIELDS.map(f => [f, client[f as keyof ClientData]])) : {};
    this._editingClient = true;
    if (!client)
    {
      this._clients = await listClients().catch(() => []);
    }
  }

  private _pickClient(e: Event)
  {
    const clientId = (e.target as HTMLSelectElement).value;
    if (!clientId) return;
    this._editingClient = false;
    void this._apply(() => updateProject(this._id, { clientId }));
  }

  private async _saveClient(e: Event)
  {
    e.preventDefault();
    this._saving = true;
    try
    {
      const existing = this._project?.client;
      if (existing)
      {
        await updateClient(existing.id, this._clientDraft);
        await this._load();
      }
      else
      {
        const client = await this._createOrFindClient(this._clientDraft);
        this._project = await updateProject(this._id, { clientId: client.id });
      }
      this._editingClient = false;
    }
    catch (err)
    {
      this._error = errorText(err, msg('Could not save the client.'));
    }
    finally
    {
      this._saving = false;
    }
  }

  /** A new client — or, when the email is one of the professional's clients already, that one. */
  private async _createOrFindClient(input: ClientInput): Promise<ClientData>
  {
    try
    {
      return await createClient(input);
    }
    catch (err)
    {
      const email = input.email?.trim().toLowerCase();
      if ((err as ApiError)?.status !== 409 || !email) throw err;
      const found = (await listClients(email)).find(c => c.email === email);
      if (!found) throw err;
      return found;
    }
  }

  //// CONFIGURATIONS ////

  private async _openConfigurator(e: CustomEvent<ConfigurationData>)
  {
    try
    {
      const path = await configuratorPathFor(this._id, e.detail);
      if (path) Router.go(path);
    }
    catch (err)
    {
      this._error = errorText(err, msg('Could not open the configurator.'));
    }
  }

  private async _openEditor(e: CustomEvent<ConfigurationData>)
  {
    try
    {
      const { kind, snapshot } = await editorOpening(this._id, e.detail);
      if (kind === 'changed')
      {
        this._changed = { ...e.detail, snapshot };
        return;
      }
      const path = kind === 'source' ? openSourceWithValues(snapshot) : openSnapshotCopy(snapshot);
      if (path) Router.go(path);
    }
    catch (err)
    {
      this._error = errorText(err, msg('Could not open the script.'));
    }
  }

  private _openChanged(how: 'source' | 'copy')
  {
    const snapshot = this._changed?.snapshot;
    this._changed = null;
    if (!snapshot) return;
    const path = how === 'source' ? openSourceWithValues(snapshot) : openSnapshotCopy(snapshot);
    if (path) Router.go(path);
  }

  private _setLabel(e: CustomEvent<{ configuration: ConfigurationData; label: string | null }>)
  {
    const { configuration, label } = e.detail;
    void this._apply(async () => { await setConfigurationLabel(this._id, configuration.id, label); });
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      box-sizing: border-box;
      container: project / inline-size;
      font-family: var(--font-sans);
      color: var(--color-text);
      background: var(--color-surface-subtle);
    }

    *,
    *::before,
    *::after {
      box-sizing: inherit;
    }

    .head {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding: var(--space-lg);
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
    }

    .back {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      width: fit-content;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
      text-decoration: none;
    }

    .back:hover {
      color: var(--color-primary);
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
    }

    .number {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      font-weight: 700;
      color: var(--color-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .title {
      flex: 1;
      min-width: 0;
      max-width: 36rem;
    }

    .title::part(base) {
      border-color: transparent;
      background: transparent;
    }

    .title:hover::part(base),
    .title:focus-within::part(base) {
      border-color: var(--color-border);
    }

    .title::part(input) {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      font-weight: 700;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-sm);
    }

    .columns {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 20rem;
      gap: var(--space-lg);
      padding: var(--space-lg);
      align-items: start;
    }

    @container project (width < ${unsafeCSS(BREAKPOINT_COMPACT)}) {
      .columns { grid-template-columns: minmax(0, 1fr); }
    }

    .main,
    .side {
      display: flex;
      flex-direction: column;
      gap: var(--space-lg);
      min-width: 0;
    }

    h2 {
      margin: 0 0 var(--space-sm);
      font-size: var(--text-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
    }

    .card {
      padding: var(--space-md);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    .client {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-xs) var(--space-md);
      margin: 0 0 var(--space-md);
      font-size: var(--text-sm);
    }

    .client dt {
      color: var(--color-text-muted);
    }

    .client dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .client .address {
      white-space: pre-line;
    }

    .client-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-sm);
    }

    .muted {
      margin: 0 0 var(--space-sm);
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .or {
      margin-top: var(--space-sm);
    }

    .error {
      margin: var(--space-md) var(--space-lg) 0;
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--color-danger);
      border-radius: var(--radius-md);
      font-size: var(--text-sm);
      color: var(--color-danger);
    }

    .center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      flex: 1;
      color: var(--color-text-muted);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-project': PageProject;
  }
}
