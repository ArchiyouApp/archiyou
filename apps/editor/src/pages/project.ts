/**
 * <page-project> — one of the professional's projects, at /projects/:id (plans/PROJECTS.md).
 *
 * The header carries the number, title and status (with only the status changes that are
 * allowed from here). Under it the client, the professional's note and the activity, each
 * a strip that opens on demand, so the rest of the page is for the designs (configurations
 * in the data) and, next to them, the deliveries of the one selected (`?design=<id>`, the
 * newest when the link names none). "From configurator" adds a design from a published
 * configurator (<configurator-picker>).
 * Opening the page clears the project's unread dot (the server marks it seen).
 *
 * No CAD kernel is loaded to show a project; the delivery dialog starts it when it opens.
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
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/details/details.js';
import '@archiyou/ui/projects/project-configurations.js';
import '@archiyou/ui/projects/configurator-picker.js';
import '@archiyou/ui/projects/project-deliveries.js';
import '@archiyou/ui/projects/project-activity.js';
import '@archiyou/ui/projects/project-files.js';
import '@archiyou/ui/projects/delivery-menu.js';

import {
  projectLabel, type ClientData, type ClientInput, type ConfigurationData, type DeliveryData, type ProjectData, type ProjectEvent,
  type ProjectFileData, type ProjectStatus,
} from '@archiyou/types';
import { formatDay } from '@archiyou/ui/projects/project-configurations.js';

import {
  fetchProject, takeCreatedProject, updateProject, deleteProject, setConfigurationLabel, listClients, createClient, updateClient,
  configuratorPathFor, editorOpening, openSourceWithValues, openSnapshotCopy, revokeDelivery,
  uploadProjectFile, deleteProjectFile, downloadProjectFile, PROJECT_FILE_ACCEPT,
} from '../services/projects.js';
import { ApiError } from '../services/api.js';
import { BREAKPOINT_COMPACT } from '../styles/design-tokens.js';
import { userState } from '../state/workspace';

/** The status changes offered from each status (the server allows these and more:
 *  won and lost are not offered from active for now). */
const NEXT_STATUS: Record<ProjectStatus, ProjectStatus[]> = {
  request: ['active', 'lost'],
  active: [],
  won: ['active'],
  lost: ['active'],
};

const CLIENT_FIELDS: Array<keyof ClientInput> = ['name', 'email', 'company', 'phone', 'address'];

/** A client in the list to choose from: name, else email, else company. */
function clientLabel(c: ClientData): string
{
  return c.name ?? c.email ?? c.company ?? msg('(no name)');
}

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

    const design = this._selectedDesign(p);
    return html`
      <div class="top">
        ${this._renderHeader(p)}
        <div class="strips">
          ${this._renderClientStrip(p)}
          ${this._renderNoteStrip(p)}
          ${this._renderFilesStrip(p)}
          ${this._renderActivityStrip(p.events)}
        </div>
      </div>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}

      <div class="columns">
        <section class="card">
          <div class="section-head">
            <h2>${msg('Designs')}</h2>
            <wa-button size="small" appearance="outlined" @click=${() => { this._picking = true; }}>
              <wa-icon slot="start" library="lucide" name="tv-minimal-play"></wa-icon>${msg('New design from configurator')}
            </wa-button>
          </div>
          <project-configurations
            .configurations=${p.configurations}
            selected=${design?.id ?? ''}
            me=${userState.get().id ?? ''}
            @configuration-select=${(e: CustomEvent<ConfigurationData>) => this._selectDesign(e.detail)}
            @configuration-open-configurator=${this._openConfigurator}
            @configuration-open-editor=${this._openEditor}
            @configuration-label=${this._setLabel}
          ></project-configurations>
        </section>

        ${design
          ? html`
            <section class="card">
              <div class="section-head">
                <h2>${msg('Deliveries')} <span class="of">v${design.rev} ${design.label || design.scriptName || ''}</span></h2>
                <wa-button size="small" variant="brand" @click=${() => this._newDelivery(design)}>
                  <wa-icon slot="start" library="lucide" name="send"></wa-icon>${msg('New delivery')}
                </wa-button>
              </div>
              <project-deliveries
                .deliveries=${p.deliveries.filter(d => d.configurationId === design.id)}
                .configurations=${p.configurations}
                @delivery-copy-link=${this._copyLink}
                @delivery-revoke=${this._askRevoke}
              ></project-deliveries>
            </section>`
          : nothing}
      </div>

      ${this._renderChangedDialog()}
      ${this._renderConfirmDialog()}
      <delivery-menu
        ?open=${this._delivering}
        .project=${p}
        .configuration=${this._deliverFrom}
        me=${userState.get().id ?? ''}
        myEmail=${userState.get().email ?? ''}
        myName=${userState.get().name ?? ''}
        @delivery-menu-sent=${() => void this._load()}
        @delivery-menu-file-added=${() => void this._load()}
        @delivery-menu-close=${() => { this._delivering = false; }}
      ></delivery-menu>
      <configurator-picker
        ?open=${this._picking}
        project=${p.id}
        @configurator-picker-close=${() => { this._picking = false; }}
      ></configurator-picker>
    `;
  }

  /** Who it is for; closed it reads "Client: Jane Doe · jane@example.com", or offers to add one. */
  private _renderClientStrip(p: ProjectData)
  {
    const c = p.client;
    const who = c ? [c.name ?? c.company, c.email].filter(Boolean).join(' · ') : '';
    return html`
      <wa-details ?open=${this._openStrips.client} @wa-show=${this._onStrip('client', true)} @wa-hide=${this._onStrip('client', false)}>
        <span slot="summary" class="summary">
          <span class="strip-name">${msg('Client')}</span>
          ${c
            ? html`<span class="strip-text">${who || msg('(no name)')}</span>`
            : html`
              <span class="strip-text muted">${msg('No client')}</span>
              <wa-button size="small" appearance="outlined" @click=${this._addClient}>
                <wa-icon slot="start" library="lucide" name="user-plus"></wa-icon>${msg('Add client')}
              </wa-button>`}
        </span>
        ${this._editingClient ? this._renderClientForm(p) : this._renderClient(c)}
      </wa-details>`;
  }

  private _renderNoteStrip(p: ProjectData)
  {
    const firstLine = (p.note ?? '').trim().split('\n')[0];
    return html`
      <wa-details ?open=${this._openStrips.note} @wa-show=${this._onStrip('note', true)} @wa-hide=${this._onStrip('note', false)}>
        <span slot="summary" class="summary">
          <span class="strip-name">${msg('Notes')}</span>
          <span class=${firstLine ? 'strip-text' : 'strip-text muted'}>${firstLine || msg('Only you see these.')}</span>
        </span>
        <wa-textarea size="small" resize="auto" placeholder=${msg('Only you see this.')}
          .value=${p.note ?? ''} @change=${this._saveNote}></wa-textarea>
      </wa-details>`;
  }

  /** The dossier: files kept with the project, any of which can go with a delivery. */
  private _renderFilesStrip(p: ProjectData)
  {
    const n = (p.files ?? []).length;
    return html`
      <wa-details ?open=${this._openStrips.files} @wa-show=${this._onStrip('files', true)} @wa-hide=${this._onStrip('files', false)}>
        <span slot="summary" class="summary">
          <span class="strip-name">${msg('Dossier files')}</span>
          <span class="strip-text muted">${n === 0 ? msg('No files yet') : n === 1 ? msg('1 file') : msg(str`${n} files`)}</span>
          <wa-button size="small" appearance="outlined" ?loading=${this._uploading} @click=${this._pickFiles}>
            <wa-icon slot="start" library="lucide" name="upload"></wa-icon>${msg('Upload')}
          </wa-button>
        </span>
        <project-files .files=${p.files ?? []}
          @project-file-download=${this._downloadFile}
          @project-file-delete=${this._askDeleteFile}
          @project-files-drop=${(e: CustomEvent<File[]>) => void this._uploadFiles(e.detail)}></project-files>
        <input class="file-input" type="file" multiple accept=${PROJECT_FILE_ACCEPT}
          @change=${this._onFilesChosen}>
      </wa-details>`;
  }

  private _renderActivityStrip(events: ProjectEvent[])
  {
    const last = events.reduce((latest, e) => (e.created > latest ? e.created : latest), '');
    return html`
      <wa-details ?open=${this._openStrips.activity} @wa-show=${this._onStrip('activity', true)} @wa-hide=${this._onStrip('activity', false)}>
        <span slot="summary" class="summary">
          <span class="strip-name">${msg('Activity')}</span>
          <span class="strip-text muted">${events.length === 0
            ? msg('Nothing yet')
            : events.length === 1
              ? msg(str`1 event, ${formatDay(last)}`)
              : msg(str`${events.length} events, last ${formatDay(last)}`)}</span>
        </span>
        <project-activity .events=${events}></project-activity>
      </wa-details>`;
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
        </div>
        <div class="actions">
          <wa-badge variant=${this._statusVariant(p.status)}>${statusLabels[p.status]}</wa-badge>
          ${p.archived ? html`<wa-badge variant="neutral" appearance="outlined">${msg('Archived')}</wa-badge>` : nothing}
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
      return html`<p class="muted">${msg('No client yet.')}</p>`;
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
    const adding = !p.client;
    // An existing client chosen: Add links that one, the form for a new one steps aside
    const picked = adding && this._pickedClientId !== '';
    return html`
      <form class="client-form" @submit=${this._saveClient}>
      ${adding && this._clients.length
        ? html`
          <wa-select class="existing-client" size="small" label=${msg('Existing client')} placeholder=${msg('Choose…')} with-clear
            @input=${this._onPickClient} @change=${this._onPickClient}>
            ${this._clients.map(c => html`<wa-option value=${c.id}>${clientLabel(c)}</wa-option>`)}
          </wa-select>
          ${picked ? nothing : html`<p class="or">${msg('or a new one:')}</p>`}`
        : nothing}
        ${adding && !picked
          ? html`
            <wa-checkbox size="small" ?checked=${this._listClient}
              @change=${(e: Event) => { this._listClient = (e.target as HTMLInputElement).checked; }}>
              ${msg('Add to client list')}
            </wa-checkbox>`
          : nothing}
        ${picked ? nothing : CLIENT_FIELDS.map(f => html`
          <wa-input size="small" name=${f} label=${labels[f]} type=${f === 'email' ? 'email' : 'text'}
            .value=${(this._clientDraft[f] as string | null) ?? ''}
            @input=${(e: Event) => { this._clientDraft = { ...this._clientDraft, [f]: (e.target as HTMLInputElement).value }; }}
          ></wa-input>`)}
        <div class="form-actions">
          <wa-button size="small" appearance="outlined" @click=${() => { this._editingClient = false; }}>${msg('Cancel')}</wa-button>
          <wa-button size="small" variant="brand" type="submit" ?loading=${this._saving}>${adding ? msg('Add') : msg('Save')}</wa-button>
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

  /** Asks before something that cannot be undone (deleting the project, revoking a link). */
  private _renderConfirmDialog()
  {
    const c = this._confirm;
    return html`
      <wa-dialog label=${c?.title ?? ''} ?open=${!!c}
        @wa-after-hide=${(e: Event) => { if (e.target === e.currentTarget) this._confirm = null; }}>
        <p>${c?.text ?? ''}</p>
        <wa-button slot="footer" appearance="outlined" @click=${() => { this._confirm = null; }}>${msg('Cancel')}</wa-button>
        <wa-button slot="footer" variant="danger" @click=${this._confirmed}>${c?.button ?? ''}</wa-button>
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
  /** The existing client chosen to add; '' for a new one from the form. */
  @state() private _pickedClientId = '';
  /** A new client goes in the client list too (else it is kept for this project only). */
  @state() private _listClient = true;
  /** The question the confirm dialog asks, and what happens on yes. */
  @state() private _confirm: { title: string; text: string; button: string; action: () => Promise<void> } | null = null;
  @state() private _delivering = false;
  /** The configuration a new delivery starts from. */
  @state() private _deliverFrom: ConfigurationData | null = null;
  /** A configuration whose source script changed, waiting for the professional's choice. */
  @state() private _changed: (ConfigurationData & { snapshot: ConfigurationData }) | null = null;
  /** Which of the client, note and activity strips are open. */
  @state() private _openStrips = { client: false, note: false, files: false, activity: false };
  /** Dossier files on their way up. */
  @state() private _uploading = false;
  /** The "From configurator" dialog. */
  @state() private _picking = false;
  /** The design chosen on this page; the link's `?design=` until one is clicked. */
  @state() private _designId = '';

  // ── 3. Lifecycle ──
  override willUpdate(changed: Map<string, unknown>)
  {
    if (changed.has('location'))
    {
      this._designId = new URLSearchParams(this.location?.search ?? window.location.search).get('design') ?? '';
      void this._load();
    }
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
      this._project = takeCreatedProject(this._id) ?? await fetchProject(this._id);
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

  /** The chosen design, else the newest (the list is newest first); null without designs. */
  private _selectedDesign(p: ProjectData): ConfigurationData | null
  {
    return p.configurations.find(c => c.id === this._designId) ?? p.configurations[0] ?? null;
  }

  /** Into the address bar too, so a reload or a shared link shows the same design. Not a
   *  navigation: that would load the project again. */
  private _selectDesign(c: ConfigurationData)
  {
    this._designId = c.id;
    const url = new URL(window.location.href);
    url.searchParams.set('design', c.id);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }

  /** Keeps a strip's open state when the person opens or closes it. Only the strip's own
   *  event: a select inside it shows and hides its listbox with the same event names. */
  private _onStrip(strip: 'client' | 'note' | 'files' | 'activity', open: boolean)
  {
    return (e: Event) =>
    {
      if (e.target === e.currentTarget) this._openStrips = { ...this._openStrips, [strip]: open };
    };
  }

  /** "Add client" in the closed strip: open it on the form, without the click also toggling it. */
  private _addClient(e: Event)
  {
    e.stopPropagation();
    this._openStrips = { ...this._openStrips, client: true };
    void this._editClient();
  }

  //// DOSSIER ////

  /** "Upload" in the strip: the file picker, without the click also toggling the strip. */
  private _pickFiles(e: Event)
  {
    e.stopPropagation();
    this.renderRoot.querySelector<HTMLInputElement>('.file-input')?.click();
  }

  private _onFilesChosen(e: Event)
  {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    void this._uploadFiles(files);
  }

  /** One after the other; a file the server refuses says why and the rest still go. */
  private async _uploadFiles(files: File[])
  {
    if (!files.length || this._uploading) return;
    this._uploading = true;
    this._error = '';
    const refused: string[] = [];
    for (const file of files)
    {
      try { await uploadProjectFile(this._id, file); }
      catch (err) { refused.push(errorText(err, msg(str`Could not upload ${file.name}.`))); }
    }
    this._uploading = false;
    this._openStrips = { ...this._openStrips, files: true };
    if (refused.length) this._error = refused.join(' ');
    await this._load();
  }

  private async _downloadFile(e: CustomEvent<ProjectFileData>)
  {
    try { await downloadProjectFile(this._id, e.detail); }
    catch (err) { this._error = errorText(err, msg('Could not download the file.')); }
  }

  private _askDeleteFile(e: CustomEvent<ProjectFileData>)
  {
    const file = e.detail;
    this._confirm = {
      title: msg('Delete file'),
      text: msg(str`Delete ${file.name} from this project? Deliveries that included it keep their copy.`),
      button: msg('Delete'),
      action: async () =>
      {
        await deleteProjectFile(this._id, file.id);
        await this._load();
      },
    };
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
    return msg('Reopen');
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
    if (value === 'delete' && this._project)
    {
      const p = this._project;
      this._confirm = {
        title: msg('Delete project'),
        text: msg(str`Delete ${projectLabel(p.number)} ${p.title} with its designs, deliveries and activity? Links you sent stop working. This cannot be undone.`),
        button: msg('Delete'),
        action: async () =>
        {
          await deleteProject(this._id);
          Router.go('/browser/projects');
        },
      };
    }
  }

  private async _confirmed()
  {
    const action = this._confirm?.action;
    this._confirm = null;
    if (!action) return;
    try
    {
      await action();
    }
    catch (err)
    {
      this._error = errorText(err, msg('That did not work.'));
    }
  }

  //// DELIVERIES ////

  private _newDelivery(configuration: ConfigurationData | null)
  {
    this._deliverFrom = configuration;
    this._delivering = true;
  }

  private async _copyLink(e: CustomEvent<DeliveryData>)
  {
    if (e.detail.link) await navigator.clipboard?.writeText(e.detail.link).catch(() => undefined);
  }

  private _askRevoke(e: CustomEvent<DeliveryData>)
  {
    const delivery = e.detail;
    this._confirm = {
      title: msg('Revoke link'),
      text: msg(str`Revoke the link to #${delivery.number} ${delivery.title}? The client can no longer open it or its files. This cannot be undone.`),
      button: msg('Revoke'),
      action: async () =>
      {
        await revokeDelivery(this._id, delivery.id);
        await this._load();
      },
    };
  }

  //// CLIENT ////

  private async _editClient()
  {
    const client = this._project?.client;
    this._clientDraft = client ? Object.fromEntries(CLIENT_FIELDS.map(f => [f, client[f as keyof ClientData]])) : {};
    this._editingClient = true;
    this._pickedClientId = '';
    this._listClient = true;
    if (!client)
    {
      this._clients = await listClients().catch(() => []);
    }
  }

  /** Web Awesome's select reports a first pick before its value is set (still null), so the
   *  value is read once it has updated. */
  private async _onPickClient(e: Event)
  {
    const select = e.target as HTMLSelectElement & { updateComplete: Promise<boolean> };
    await select.updateComplete;
    this._pickedClientId = String(select.value ?? '');
  }

  /** Add: the existing client chosen, or a new one from the form. Save: the client's changes. */
  private async _saveClient(e: Event)
  {
    e.preventDefault();
    const existing = this._project?.client;
    const draft = this._clientDraft;
    if (!existing && !this._pickedClientId && !CLIENT_FIELDS.some(f => ((draft[f] as string | null) ?? '').trim()))
    {
      this._error = msg('Choose a client, or fill in at least a name or an email address.');
      return;
    }
    this._error = '';
    this._saving = true;
    try
    {
      if (existing)
      {
        await updateClient(existing.id, draft);
        await this._load();
      }
      else
      {
        const clientId = this._pickedClientId || (await this._createOrFindClient({ ...draft, listed: this._listClient })).id;
        this._project = await updateProject(this._id, { clientId });
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

  /** A new client — or, when the email is one of the professional's clients already, that
   *  one (into the client list when this one was to go there). */
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
      const found = (await listClients(email, true)).find(c => c.email === email);
      if (!found) throw err;
      return input.listed && !found.listed ? updateClient(found.id, { ...found, listed: true }) : found;
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

    /* Header and strips: one square block across the page; the sections below are cards */
    .top {
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
    }

    .head {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding: var(--space-lg) var(--space-lg) var(--space-md);
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

    /* Compact: Web Awesome sizes a button from its font, so xs text makes it small */
    .actions wa-button,
    .section-head wa-button,
    .summary wa-button {
      font-size: var(--text-xs);
    }

    .strips wa-details::part(base) {
      border: none;
      border-top: 1px solid var(--color-border);
      border-radius: 0;
      background: transparent;
    }

    .strips wa-details::part(header) {
      padding: var(--space-xs) var(--space-lg);
      min-height: 2.75rem;
    }

    .strips wa-details::part(content) {
      padding: 0 var(--space-lg) var(--space-md) calc(var(--space-lg) + 7rem + var(--space-md));
    }

    @container project (width < ${unsafeCSS(BREAKPOINT_COMPACT)}) {
      .strips wa-details::part(content) { padding-left: var(--space-lg); }
    }

    .summary {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      min-width: 0;
      font-size: var(--text-sm);
    }

    .strip-name {
      flex: 0 0 7rem;
      font-weight: 600;
      color: var(--color-text-muted);
    }

    .strip-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-input {
      display: none;
    }

    /* The strips' content is small: the client, its form, the notes */
    .strips wa-details > .muted,
    .client-form wa-input,
    .client-form wa-checkbox,
    .strips wa-select,
    .strips wa-textarea,
    .strips wa-button {
      font-size: var(--text-xs);
    }

    .strip-text.muted {
      margin: 0;
      color: var(--color-text-muted);
    }

    .columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-lg);
      padding: var(--space-lg);
      align-items: start;
    }

    @container project (width < ${unsafeCSS(BREAKPOINT_COMPACT)}) {
      .columns { grid-template-columns: minmax(0, 1fr); }
    }

    .card {
      min-width: 0;
      padding: var(--space-md);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
    }

    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      margin-bottom: var(--space-sm);
    }

    .section-head h2 {
      margin: 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .of {
      margin-left: var(--space-xs);
      text-transform: none;
      letter-spacing: normal;
      font-weight: 400;
    }

    h2 {
      margin: 0 0 var(--space-sm);
      font-size: var(--text-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
    }

    .client {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-xs) var(--space-md);
      margin: 0 0 var(--space-md);
      font-size: var(--text-xs);
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

    /* Reads as the label of "Existing client" above it */
    .or {
      margin: var(--space-xs) 0 0;
      font-size: var(--text-xs);
      font-weight: var(--wa-form-control-label-font-weight);
      color: var(--wa-form-control-label-color);
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
