/**
 * <delivery-menu> — send a client a delivery of one configuration (plans/PROJECTS.md).
 *
 * One form: the configuration, what goes in (the 3D model always; documents and
 * spreadsheets when the script makes them), an optional offer and a message. It goes to
 * the project's client, or, marked Internal, to the professional's own address: for their
 * own use, and the only choice while the project has no client with an email address.
 * Sending makes the files here in the browser, uploads them to a draft and sends it: the
 * server freezes it, gives it a link and emails it.
 *
 * Of another author's configurator only the 3D model and what it offers for download can
 * go in (the server checks the same).
 *
 * Emits:
 *   delivery-menu-sent         detail = DeliveryData       a delivery went out
 *   delivery-menu-file-added   detail = ProjectFileData    a new file went into the dossier
 *   delivery-menu-close        the dialog closed
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

import type { ScriptData } from '@archiyou/core/src/execution/types';
import type { ConfigurationData, DeliveryData, ProjectData, ProjectFileData } from '@archiyou/types';

import {
  fetchConfiguration, createDelivery, uploadDeliveryFile, sendDelivery, deleteDelivery, generateDeliveryFiles,
  attachProjectFile, uploadProjectFile, PROJECT_FILE_ACCEPT,
} from '@archiyou/editor/src/services/projects';
import { formatBytes } from './project-files.js';
import { warmupWorker } from '@archiyou/editor/src/services/execution-service';

// For the offer fields, off for now (see render)
// const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

type Step = 'form' | 'making' | 'uploading' | 'sending' | 'sent';

/** The categories an output path is about: default/{category}/… */
const categoryOf = (path: string) => path.split('/')[1] ?? '';

@customElement('delivery-menu')
export class DeliveryMenu extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <wa-dialog label=${msg('New delivery')} ?open=${this.open} @wa-after-hide=${this._onAfterHide}>
        ${this.open && this.project ? this._renderBody(this.project) : nothing}
        ${this._renderFooter()}
      </wa-dialog>
    `;
  }

  private _renderBody(project: ProjectData)
  {
    if (this._step === 'sent' && this._sent)
    {
      return html`
        <div class="done">
          <wa-icon library="lucide" name="circle-check"></wa-icon>
          <p>${msg(str`Sent to ${this._sent.recipientEmail}.`)}</p>
        </div>
        <wa-input size="small" readonly label=${msg('Link')} .value=${this._sent.link ?? ''}></wa-input>`;
    }
    if (this._step !== 'form')
    {
      const labels: Record<string, string> = {
        making: msg('Making the files…'), uploading: msg('Uploading…'), sending: msg('Sending…'),
      };
      return html`<div class="progress"><wa-spinner></wa-spinner><span>${labels[this._step]}</span></div>`;
    }

    const configuration = project.configurations.find(c => c.id === this._configurationId);
    return html`
      <form class="form" @submit=${this._submit}>
        ${this._renderAudience(project)}

        <!-- \`selected\` on the option, not .value on the select: a value set before the
             options are slotted is cleared again (as in share-script-menu). -->
        <wa-select size="small" label=${msg('Design')}
          @change=${this._onDesignChange}>
          ${project.configurations.map(c => html`
            <wa-option value=${c.id} ?selected=${c.id === this._configurationId}
              label=${`v${c.rev} · ${c.label || c.scriptName || ''}`}><span class="rev">v${c.rev}</span>${c.label || c.scriptName || ''}</wa-option>`)}
        </wa-select>

        <wa-input size="small" label=${msg('Title')} required maxlength="120" .value=${this._title}
          @input=${(e: Event) => { this._title = (e.target as HTMLInputElement).value; }}></wa-input>

        <fieldset>
          <legend>${msg('Include fulfillment outputs')}</legend>
          <wa-checkbox size="small" checked disabled>${msg('3D model')}</wa-checkbox>
          <wa-checkbox size="small" ?checked=${this._documents} ?disabled=${!this._allowed.documents}
            @change=${(e: Event) => { this._documents = (e.target as HTMLInputElement).checked; }}>
            ${msg('Documents (PDF)')}
          </wa-checkbox>
          <wa-checkbox size="small" ?checked=${this._sheets} ?disabled=${!this._allowed.sheets}
            @change=${(e: Event) => { this._sheets = (e.target as HTMLInputElement).checked; }}>
            ${msg('Spreadsheets (XLSX)')}
          </wa-checkbox>
          ${this._foreign
            ? html`<p class="hint">${msg('Another author\'s configurator: only the model and what it offers for download.')}</p>`
            : nothing}
        </fieldset>

        ${this._renderAttachments()}


        ${nothing /* Offers are off for now (turn back on: this block, and _withOffer in _reset)
        <fieldset>
          <legend>${msg('Offer')}</legend>
          <wa-checkbox size="small" ?checked=${this._withOffer}
            @change=${(e: Event) => { this._withOffer = (e.target as HTMLInputElement).checked; }}>
            ${msg('This is an offer')}
          </wa-checkbox>
          ${this._withOffer
          ? html`
            <div class="row">
              <wa-input size="small" type="number" min="0" step="0.01" label=${msg('Total')} required
                .value=${this._total} @input=${(e: Event) => { this._total = (e.target as HTMLInputElement).value; }}></wa-input>
              <wa-select size="small" label=${msg('Currency')}
                @change=${(e: Event) => { this._currency = (e.target as HTMLSelectElement).value; }}>
                ${CURRENCIES.map(c => html`<wa-option value=${c} ?selected=${c === this._currency}>${c}</wa-option>`)}
              </wa-select>
              <wa-input size="small" type="date" label=${msg('Valid until')} .value=${this._validUntil}
                @input=${(e: Event) => { this._validUntil = (e.target as HTMLInputElement).value; }}></wa-input>
            </div>
            <wa-input size="small" label=${msg('Offer note (optional)')} placeholder=${msg('e.g. excl. delivery and VAT')}
              .value=${this._offerNote} @input=${(e: Event) => { this._offerNote = (e.target as HTMLInputElement).value; }}></wa-input>`
          : nothing}
        </fieldset>
        */}

        <wa-textarea size="small" label=${msg('Message')} rows="3" maxlength="2000" .value=${this._message}
          @input=${(e: Event) => { this._message = (e.target as HTMLTextAreaElement).value; }}></wa-textarea>

        ${this._renderRecipient(project)}

        ${configuration?.configurator && !this._internal
          ? html`
            <wa-checkbox size="small" ?checked=${this._allowAdjust}
              @change=${(e: Event) => { this._allowAdjust = (e.target as HTMLInputElement).checked; }}>
              ${msg('Let the client adjust the design in the configurator and send the changes back')}
            </wa-checkbox>`
          : nothing}

        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        <p class="hint">${msg('The files are made now and frozen: what the client opens never changes.')}</p>
      </form>
    `;
  }

  /** Files of the project's dossier to send along, and a way to add one: a new file goes
   *  into the dossier too, so whatever a client was sent can be found in the project. */
  private _renderAttachments()
  {
    return html`
      <fieldset>
        <legend>${msg('Attach extra files')}</legend>
        ${this._files.length
          ? this._files.map(f => html`
            <wa-checkbox size="small" ?checked=${this._attach.includes(f.id)}
              @change=${(e: Event) => this._toggleAttach(f.id, (e.target as HTMLInputElement).checked)}>
              ${f.name} <span class="size">${formatBytes(f.bytes)}</span>
            </wa-checkbox>`)
          : html`<p class="hint">${msg('No dossier files in this project yet.')}</p>`}
        <div class="attach-new">
          <wa-button size="small" appearance="outlined" ?loading=${this._uploadingFile} @click=${this._pickFile}>
            <wa-icon slot="start" library="lucide" name="upload"></wa-icon>${msg('Upload a new file')}
          </wa-button>
          <span class="hint">${msg('It is also kept in the project\'s dossier files.')}</span>
        </div>
        <input class="file-input" type="file" multiple accept=${PROJECT_FILE_ACCEPT} @change=${this._onFileChosen}>
      </fieldset>`;
  }

  /** Client or Internal. Client is greyed out, with the reason on hover, while the project
   *  has no client with an email address. */
  private _renderAudience(project: ProjectData)
  {
    const blocked = this._clientBlocked(project);
    return html`
      <div class="audience" role="radiogroup" aria-label=${msg('Send to')}>
        <span id="audience-client" class=${blocked ? 'pill blocked' : 'pill'}>
          <wa-button size="small" pill role="radio" aria-checked=${String(!this._internal)} ?disabled=${!!blocked}
            variant=${this._internal ? 'neutral' : 'brand'} appearance=${this._internal ? 'outlined' : 'accent'}
            @click=${() => { this._internal = false; }}>
            <wa-icon slot="start" library="lucide" name="user"></wa-icon>${msg('Client')}
          </wa-button>
        </span>
        <span class="pill">
          <wa-button size="small" pill role="radio" aria-checked=${String(this._internal)}
            variant=${this._internal ? 'brand' : 'neutral'} appearance=${this._internal ? 'accent' : 'outlined'}
            @click=${() => { this._internal = true; }}>
            <wa-icon slot="start" library="lucide" name="lock"></wa-icon>${msg('Internal')}
          </wa-button>
        </span>
        ${blocked ? html`<wa-tooltip for="audience-client" placement="top">${blocked}</wa-tooltip>` : nothing}
      </div>`;
  }

  /** Who it goes to: the project's client or, internal, the professional; never typed here. */
  private _renderRecipient(project: ProjectData)
  {
    const to = this._recipient(project);
    if (!to)
    {
      return html`<p class="recipient missing" role="alert">${msg('Your account has no email address to send it to.')}</p>`;
    }
    const blocked = this._internal ? this._clientBlocked(project) : null;
    return html`
      <p class="recipient">
        <wa-icon library="lucide" name="mail"></wa-icon>
        ${this._internal
          ? msg(str`Sent to you (${to.email}), for internal use`)
          : to.name ? msg(str`Sent to ${to.name} (${to.email})`) : msg(str`Sent to ${to.email}`)}
      </p>
      ${blocked ? html`<p class="hint">${blocked}</p>` : nothing}`;
  }

  private _renderFooter()
  {
    if (this._step === 'sent')
    {
      return html`
        <wa-button slot="footer" appearance="outlined" @click=${this._copyLink}>
          <wa-icon slot="start" library="lucide" name="copy"></wa-icon>${msg('Copy link')}
        </wa-button>
        <wa-button slot="footer" variant="brand" @click=${this._close}>${msg('Done')}</wa-button>`;
    }
    const busy = this._step !== 'form';
    return html`
      <wa-button slot="footer" appearance="outlined" ?disabled=${busy} @click=${this._close}>${msg('Cancel')}</wa-button>
      <wa-button slot="footer" variant="brand" ?loading=${busy} ?disabled=${!this.project || !this._recipient(this.project)}
        @click=${() => this.renderRoot.querySelector<HTMLFormElement>('form')?.requestSubmit()}>
        <wa-icon slot="start" library="lucide" name="send"></wa-icon>${msg('Send')}
      </wa-button>`;
  }

  // ── 2. Properties, State ──
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) project: ProjectData | null = null;
  /** The configuration to start from. */
  @property({ attribute: false }) configuration: ConfigurationData | null = null;
  /** The signed-in professional's handle. */
  @property({ type: String }) me = '';
  /** Their email address and name: where an internal delivery goes. */
  @property({ type: String }) myEmail = '';
  @property({ type: String }) myName = '';

  @state() private _step: Step = 'form';
  @state() private _error = '';
  @state() private _sent: DeliveryData | null = null;
  /** For the professional's own use: sent to their own address instead of the client's. */
  @state() private _internal = false;
  @state() private _configurationId = '';
  @state() private _allowed = { documents: true, sheets: true };
  @state() private _foreign = false;
  @state() private _documents = true;
  @state() private _sheets = false;
  @state() private _title = '';
  @state() private _withOffer = true;
  @state() private _total = '';
  @state() private _currency = 'EUR';
  @state() private _validUntil = '';
  @state() private _offerNote = '';
  @state() private _message = '';
  @state() private _allowAdjust = false;
  /** The dossier as this dialog knows it: the project's files and any uploaded here. */
  @state() private _files: ProjectFileData[] = [];
  /** Dossier files to attach, by id. */
  @state() private _attach: string[] = [];
  @state() private _uploadingFile = false;

  // ── 3. Lifecycle ──
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open)
    {
      this._reset();
      // Sending runs the script for the files; the project page does not load the kernel,
      // so start it while the form is being filled in. Best-effort: a failure shows on send.
      warmupWorker().catch(err => console.warn('delivery-menu: kernel warmup failed:', err));
    }
  }

  // ── 4. Behaviour & Methods ──
  private _reset()
  {
    const project = this.project;
    if (!project) return;
    this._step = 'form';
    this._error = '';
    this._sent = null;
    this._internal = !!this._clientBlocked(project);
    // Offers are off for now: back on with `Offer ${project.title}` and _withOffer = true
    // this._title = msg(str`Offer ${project.title}`);
    // this._withOffer = true;
    this._title = project.title;
    this._withOffer = false;
    this._total = '';
    this._validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    this._offerNote = '';
    this._message = '';
    this._allowAdjust = false;
    this._files = project.files ?? [];
    this._attach = [];
    void this._chooseConfiguration(this.configuration?.id ?? project.configurations[0]?.id ?? '');
  }

  /** Why the client cannot get it (no client, or one without an email address); null when
   *  they can. */
  private _clientBlocked(project: ProjectData): string | null
  {
    if (!project.client) return msg('No client for this project yet. Add one to send things to them.');
    if (!project.client.email) return msg('The client has no email address yet. Add one to send things to them.');
    return null;
  }

  /** The address it goes to, by the Client / Internal choice; null when there is none. */
  private _recipient(project: ProjectData): { email: string; name: string | null } | null
  {
    if (this._internal) return this.myEmail ? { email: this.myEmail, name: this.myName || null } : null;
    const client = project.client;
    return client?.email ? { email: client.email, name: client.name ?? client.company ?? null } : null;
  }

  /** Web Awesome's select can report a change before its value is set, so the value is
   *  read once it has updated. */
  private async _onDesignChange(e: Event)
  {
    const select = e.target as HTMLSelectElement & { updateComplete: Promise<boolean> };
    await select.updateComplete;
    if (select.value) void this._chooseConfiguration(String(select.value));
  }

  /** A configuration was chosen: what can go in depends on its script (and its author). */
  private async _chooseConfiguration(id: string)
  {
    this._configurationId = id;
    const project = this.project;
    const chosen = project?.configurations.find(c => c.id === id);
    if (!project || !chosen) return;
    try
    {
      const full = await fetchConfiguration(project.id, id);
      const script = full.script as unknown as ScriptData;
      const fulfillments = script.published?.fulfillments ?? [];
      this._foreign = !!script.author && script.author !== this.me;

      // Another author's configurator: only what its downloads give every visitor
      const downloadCategories = fulfillments.filter(f => f.category !== 'product').flatMap(f => f.exports.map(categoryOf));
      this._allowed = this._foreign
        ? { documents: downloadCategories.includes('docs'), sheets: downloadCategories.some(c => c === 'tables' || c === 'metrics') }
        : { documents: true, sheets: true };

      // An order: preselect what its product says the author makes for it
      const product = fulfillments.find(f => f.category === 'product' && f.name === chosen.fulfillment);
      const preset = product?.exports.map(categoryOf);
      this._documents = this._allowed.documents && (preset ? preset.includes('docs') : true);
      this._sheets = this._allowed.sheets && (preset ? preset.some(c => c === 'tables' || c === 'metrics') : false);
    }
    catch (err)
    {
      this._error = (err as Error)?.message ?? msg('Could not load the design.');
    }
  }

  private _toggleAttach(id: string, on: boolean)
  {
    this._attach = on ? [...new Set([...this._attach, id])] : this._attach.filter(a => a !== id);
  }

  private _pickFile()
  {
    this.renderRoot.querySelector<HTMLInputElement>('.file-input')?.click();
  }

  /** Into the dossier, then ticked to go with this delivery. */
  private async _onFileChosen(e: Event)
  {
    const input = e.target as HTMLInputElement;
    const chosen = [...(input.files ?? [])];
    input.value = '';
    const project = this.project;
    if (!project || !chosen.length) return;
    this._uploadingFile = true;
    this._error = '';
    for (const file of chosen)
    {
      try
      {
        const kept = await uploadProjectFile(project.id, file);
        this._files = [kept, ...this._files];
        this._attach = [...this._attach, kept.id];
        this.dispatchEvent(new CustomEvent('delivery-menu-file-added', { detail: kept, bubbles: true, composed: true }));
      }
      catch (err)
      {
        const body = (err as { body?: { error?: string } }).body;
        this._error = body?.error ?? msg(str`Could not upload ${file.name}.`);
      }
    }
    this._uploadingFile = false;
  }

  private async _submit(e: Event)
  {
    e.preventDefault();
    const project = this.project;
    const configuration = project?.configurations.find(c => c.id === this._configurationId);
    const to = project ? this._recipient(project) : null;
    if (!project || !to || !configuration || this._step !== 'form') return;
    if (this._withOffer && !(Number(this._total) >= 0 && this._total !== ''))
    {
      this._error = msg('What is the total of the offer?');
      return;
    }

    this._error = '';
    let draftId: string | null = null;
    try
    {
      this._step = 'making';
      const files = await generateDeliveryFiles(project.id, configuration, { documents: this._documents, sheets: this._sheets });

      this._step = 'uploading';
      const draft = await createDelivery(project.id, {
        configurationId: configuration.id,
        title: this._title.trim(),
        message: this._message.trim() || null,
        offer: this._withOffer
          ? { total: Number(this._total), currency: this._currency, validUntil: this._validUntil || null, note: this._offerNote.trim() || null }
          : null,
        recipientEmail: to.email,
        recipientName: to.name,
        allowAdjust: this._allowAdjust && !this._internal,
      });
      draftId = draft.id;
      for (const file of files) await uploadDeliveryFile(project.id, draft.id, file);
      for (const fileId of this._attach) await attachProjectFile(project.id, draft.id, fileId);

      this._step = 'sending';
      this._sent = await sendDelivery(project.id, draft.id);
      this._step = 'sent';
      this.dispatchEvent(new CustomEvent('delivery-menu-sent', { detail: this._sent, bubbles: true, composed: true }));
    }
    catch (err)
    {
      // A draft that did not go out is no use to anyone
      if (draftId) await deleteDelivery(project.id, draftId).catch(() => undefined);
      const body = (err as { body?: { error?: string } }).body;
      this._error = body?.error ?? (err as Error)?.message ?? msg('Sending failed.');
      this._step = 'form';
    }
  }

  private async _copyLink()
  {
    if (this._sent?.link) await navigator.clipboard?.writeText(this._sent.link).catch(() => undefined);
  }

  private _close()
  {
    this.open = false;
  }

  private _onAfterHide(e: Event)
  {
    if (e.target !== e.currentTarget) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent('delivery-menu-close', { bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    /* A third of the screen, never narrower than the form needs */
    wa-dialog {
      --width: min(max(40rem, 33vw), 100vw);
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
    }

    fieldset {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin: 0;
      padding: 0;
      border: none;
    }

    /* The lists and the offer's fields: small, under their legend. Web Awesome sizes a
       control from its font, so xs text makes the whole control small */
    fieldset wa-checkbox,
    fieldset wa-input,
    fieldset wa-select,
    fieldset .attach-new wa-button {
      font-size: var(--text-xs);
    }

    legend {
      margin-bottom: var(--space-xs);
      font-size: var(--text-sm);
    }

    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
      gap: var(--space-sm);
    }

    .hint {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    /* The version before a design's name in the list: quiet, with room after it */
    wa-option .rev {
      margin-right: var(--space-sm);
      color: var(--color-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .size {
      margin-left: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .attach-new {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-sm);
      margin-top: var(--space-xs);
    }

    .file-input {
      display: none;
    }

    .recipient {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      margin: 0;
      font-size: var(--text-sm);
    }

    .audience {
      display: flex;
      gap: var(--space-xs);
    }

    .audience wa-button {
      font-size: var(--text-xs);
    }

    /* Client without a client: greyed out, and the cursor says why not (the tooltip says why) */
    .pill.blocked {
      cursor: not-allowed;
    }

    .pill.blocked wa-button {
      pointer-events: none;
    }

    .recipient.missing {
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--color-warning);
      border-radius: var(--radius-md);
      color: var(--color-text);
    }

    .error {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-danger);
    }

    .progress,
    .done {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-md) 0;
      font-size: var(--text-sm);
    }

    .done wa-icon {
      color: var(--color-success);
    }

    .done p {
      margin: 0;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'delivery-menu': DeliveryMenu;
  }
}
