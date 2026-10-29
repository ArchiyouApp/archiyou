/**
 * <configurator-order-form> — "Order product" on a configurator (plans/PROJECTS.md).
 *
 * The visitor picks the product (when the configurator offers more than one), leaves a
 * name, an email address and a message, and the design on screen goes to the author as a
 * request in their Projects. Lives in the metric bar's popover, like the download menu.
 * Configurator chrome is plain English, as elsewhere in the configurator.
 *
 * In the editor's preview nothing is sent: orders work once the script is published.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';
import type { ScriptData } from '@archiyou/core/src/execution/types';

import { editorScript, buildConfiguratorRequest } from '@archiyou/editor/src/state/workspace';
import { configuratorLocale } from '@archiyou/editor/src/state/locale';
import { isProduct } from '@archiyou/editor/src/services/fulfillment';
import { sendOrder } from '@archiyou/editor/src/services/projects';

@customElement('configurator-order-form')
export class ConfiguratorOrderForm extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const author = editorScript.get()?.author ?? 'The maker';
    if (this._sent)
    {
      return html`
        <div class="sent">
          <wa-icon library="lucide" name="circle-check"></wa-icon>
          <p><strong>Sent.</strong> ${this.changes ? 'Your changes are on their way.' : `${author} will get back to you at ${this._email.trim()}.`}</p>
        </div>`;
    }

    const products = this.products();
    const chosen = products.find(p => p.name === this._product) ?? products[0];
    return html`
      <form @submit=${this._submit}>
        <div class="header">${this.changes ? 'Send your changes' : 'Order this design'}</div>

        ${products.length > 1 && !this.changes
          ? html`
            <fieldset class="products">
              <legend>Product</legend>
              ${products.map(p => html`
                <label class=${p.name === chosen?.name ? 'product selected' : 'product'}>
                  <input type="radio" name="product" .checked=${p.name === chosen?.name}
                    @change=${() => { this._product = p.name; }}>
                  <span class="product-name">${p.name}</span>
                  ${p.price ? html`<span class="price">${this._price(p.price)}</span>` : nothing}
                  ${p.description ? html`<span class="product-description">${p.description}</span>` : nothing}
                </label>`)}
            </fieldset>`
          : !this.changes && (chosen?.description || chosen?.price)
            ? html`
              <p class="about">
                ${chosen.description ?? ''}
                ${chosen.price ? html`<span class="price">From ${this._price(chosen.price)}</span>` : nothing}
              </p>`
            : nothing}

        ${this.changes
          ? html`<p class="about">The design as it is on screen now goes back to whoever sent it to you.</p>`
          : html`
            <label class="field">
              <span>Name</span>
              <input type="text" autocomplete="name" maxlength="200" .value=${this._name}
                @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}>
            </label>
            <label class="field">
              <span>Email <span class="required">*</span></span>
              <input type="email" autocomplete="email" required maxlength="254" .value=${this._email}
                @input=${(e: Event) => { this._email = (e.target as HTMLInputElement).value; this._error = ''; }}>
            </label>
            <label class="field">
              <span>Phone</span>
              <input type="tel" autocomplete="tel" maxlength="50" .value=${this._phone}
                @input=${(e: Event) => { this._phone = (e.target as HTMLInputElement).value; }}>
            </label>`}
        <label class="field">
          <span>Message</span>
          <textarea rows="3" maxlength="2000" placeholder=${this.changes ? 'What did you change, and why?' : `Anything ${author} should know?`}
            .value=${this._message}
            @input=${(e: Event) => { this._message = (e.target as HTMLTextAreaElement).value; }}></textarea>
        </label>
        <!-- People never see this; bots fill it in (the server keeps nothing then). -->
        <input class="trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"
          .value=${this._website} @input=${(e: Event) => { this._website = (e.target as HTMLInputElement).value; }}>

        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        ${this.preview ? html`<p class="note">Preview: orders arrive once this configurator is published.</p>` : nothing}

        <button class="send" type="submit" ?disabled=${this._sending || this.preview || (!this.changes && !this._email.trim())}>
          ${this._sending ? 'Sending…' : this.changes ? 'Send changes' : 'Send order'}
        </button>
        ${this.changes ? nothing : html`<p class="privacy">${author} receives your details and this design to answer you.</p>`}
      </form>
    `;
  }

  // ── 2. Properties, State ──
  /** In the editor's configurator preview: show the form, send nothing. */
  @property({ type: Boolean }) preview = false;
  /** The client came from a delivery's "Adjust this design": their changes go back to the
   *  professional who sent it, by this token, and no contact details are asked. */
  @property({ type: String }) deliveryToken = '';

  @state() private _product = '';
  @state() private _name = '';
  @state() private _email = '';
  @state() private _phone = '';
  @state() private _message = '';
  @state() private _website = '';
  @state() private _sending = false;
  @state() private _sent = false;
  @state() private _error = '';

  // ── 4. Behaviour & Methods ──
  /** The product fulfillments of this configurator. */
  products(): ScriptPublishedFulfillmentData[]
  {
    return (editorScript.get()?.published?.fulfillments ?? []).filter(isProduct);
  }

  /** Sending changes to a delivery rather than a new order. */
  get changes(): boolean
  {
    return !!this.deliveryToken;
  }

  /** Back to an empty form, after a sent order (the popover calls this when it closes). */
  reset()
  {
    if (!this._sent) return;
    this._sent = false;
    this._message = '';
  }

  private _price(price: number): string
  {
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  private async _submit(e: Event)
  {
    e.preventDefault();
    const products = this.products();
    const product = products.find(p => p.name === this._product) ?? products[0];
    const request = buildConfiguratorRequest([]);
    const script = request.script as ScriptData | undefined;
    if (this.preview || !script?.id || (!product && !this.changes)) return;

    this._sending = true;
    this._error = '';
    try
    {
      await sendOrder({
        versionId: script.id,
        values: request.params ?? {},
        unitSystem: request.unitSystem ?? null,
        lang: configuratorLocale.get(),
        message: this._message.trim() || null,
        website: this._website,
        ...(this.changes
          ? { deliveryToken: this.deliveryToken }
          : {
            fulfillment: product?.name ?? '',
            contact: { email: this._email.trim(), name: this._name.trim() || null, phone: this._phone.trim() || null },
          }),
      });
      this._sent = true;
    }
    catch (err)
    {
      const body = (err as { body?: { error?: string } }).body;
      this._error = body?.error ?? 'Sending failed. Please try again.';
    }
    finally
    {
      this._sending = false;
    }
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: block;
      width: min(22rem, 100vw - 16px);
      font-family: var(--font-sans);
      color: var(--color-text);
    }

    form,
    .sent {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding: var(--space-md);
    }

    .header {
      font-weight: 600;
    }

    .about,
    .note,
    .privacy {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .privacy {
      font-size: var(--text-xs);
    }

    .price {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
      color: var(--color-text);
    }

    .products {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin: 0;
      padding: 0;
      border: none;
    }

    .products legend {
      margin-bottom: var(--space-xs);
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .product {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-sm);
      padding: var(--space-xs) var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: var(--text-sm);
      cursor: pointer;
    }

    .product.selected {
      border-color: var(--color-primary);
      background: var(--color-primary-subtle);
    }

    .product-description {
      flex-basis: 100%;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      font-size: var(--text-sm);
    }

    .required {
      color: var(--color-danger);
    }

    input,
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: var(--hit-min);
      padding: var(--space-xs) var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-bg);
      color: var(--color-text);
      font: inherit;
      font-size: var(--input-font-size, var(--text-sm));
    }

    textarea {
      resize: vertical;
    }

    input:focus,
    textarea:focus {
      outline: 2px solid var(--color-primary);
      outline-offset: -1px;
    }

    /* Off-screen rather than display:none, which some bots skip */
    .trap {
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      opacity: 0;
    }

    .error {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-danger);
    }

    .send {
      min-height: var(--hit-min);
      padding: var(--space-sm) var(--space-md);
      border: none;
      border-radius: var(--radius-md);
      background: var(--color-primary);
      color: var(--color-on-primary, #fff);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .send:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .sent {
      flex-direction: row;
      align-items: flex-start;
    }

    .sent wa-icon {
      flex-shrink: 0;
      margin-top: 0.15rem;
      color: var(--color-success);
    }

    .sent p {
      margin: 0;
      font-size: var(--text-sm);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-order-form': ConfiguratorOrderForm;
  }
}
