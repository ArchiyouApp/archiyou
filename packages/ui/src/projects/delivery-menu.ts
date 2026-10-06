/**
 * <delivery-menu> — send a client a delivery of one configuration (plans/PROJECTS.md).
 *
 * One form: the configuration, what goes in (the 3D model always; documents and
 * spreadsheets when the script makes them), an optional offer, a message and the
 * recipient. Sending makes the files here in the browser, uploads them to a draft and
 * sends it: the server freezes it, gives it a link and emails the client.
 *
 * Of another author's configurator only the 3D model and what it offers for download can
 * go in (the server checks the same).
 *
 * Emits:
 *   delivery-menu-sent   detail = DeliveryData   a delivery went out
 *   delivery-menu-close  the dialog closed
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

import type { ScriptData } from '@archiyou/core/src/execution/types';
import type { ConfigurationData, DeliveryData, ProjectData } from '@archiyou/types';

import {
  fetchConfiguration, createDelivery, uploadDeliveryFile, sendDelivery, deleteDelivery, generateDeliveryFiles,
} from '@archiyou/editor/src/services/projects';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

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
        <!-- \`selected\` on the option, not .value on the select: a value set before the
             options are slotted is cleared again (as in share-script-menu). -->
        <wa-select size="small" label=${msg('Configuration')}
          @change=${(e: Event) => this._chooseConfiguration((e.target as HTMLSelectElement).value)}>
          ${project.configurations.map(c => html`
            <wa-option value=${c.id} ?selected=${c.id === this._configurationId}>v${c.rev} ${c.label || c.scriptName || ''}</wa-option>`)}
        </wa-select>

        <fieldset>
          <legend>${msg('Included')}</legend>
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

        <wa-input size="small" label=${msg('Title')} required maxlength="120" .value=${this._title}
          @input=${(e: Event) => { this._title = (e.target as HTMLInputElement).value; }}></wa-input>

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

        <wa-textarea size="small" label=${msg('Message')} rows="3" maxlength="2000" .value=${this._message}
          @input=${(e: Event) => { this._message = (e.target as HTMLTextAreaElement).value; }}></wa-textarea>

        <div class="row">
          <wa-input size="small" type="email" label=${msg('To')} required .value=${this._recipientEmail}
            @input=${(e: Event) => { this._recipientEmail = (e.target as HTMLInputElement).value; }}></wa-input>
          <wa-input size="small" label=${msg('Name')} .value=${this._recipientName}
            @input=${(e: Event) => { this._recipientName = (e.target as HTMLInputElement).value; }}></wa-input>
        </div>

        ${configuration?.configurator
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
      <wa-button slot="footer" variant="brand" ?loading=${busy}
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

  @state() private _step: Step = 'form';
  @state() private _error = '';
  @state() private _sent: DeliveryData | null = null;
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
  @state() private _recipientEmail = '';
  @state() private _recipientName = '';
  @state() private _allowAdjust = false;

  // ── 3. Lifecycle ──
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open) this._reset();
  }

  // ── 4. Behaviour & Methods ──
  private _reset()
  {
    const project = this.project;
    if (!project) return;
    this._step = 'form';
    this._error = '';
    this._sent = null;
    this._title = msg(str`Offer ${project.title}`);
    this._withOffer = true;
    this._total = '';
    this._validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    this._offerNote = '';
    this._message = '';
    this._recipientEmail = project.client?.email ?? '';
    this._recipientName = project.client?.name ?? '';
    this._allowAdjust = false;
    void this._chooseConfiguration(this.configuration?.id ?? project.configurations[0]?.id ?? '');
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
      this._error = (err as Error)?.message ?? msg('Could not load the configuration.');
    }
  }

  private async _submit(e: Event)
  {
    e.preventDefault();
    const project = this.project;
    const configuration = project?.configurations.find(c => c.id === this._configurationId);
    if (!project || !configuration || this._step !== 'form') return;
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
        recipientEmail: this._recipientEmail.trim(),
        recipientName: this._recipientName.trim() || null,
        allowAdjust: this._allowAdjust,
      });
      draftId = draft.id;
      for (const file of files) await uploadDeliveryFile(project.id, draft.id, file);

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
    wa-dialog {
      --width: min(34rem, 100vw);
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
