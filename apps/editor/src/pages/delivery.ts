/**
 * <page-delivery> — what a professional's client opens from the email, at /d/:token
 * (plans/PROJECTS.md). No account, no editor around it.
 *
 * The design in 3D (the frozen GLB in the viewer, no CAD kernel: this route sits outside
 * layout-main, which is what loads the kernel), the documents and spreadsheets, and, for
 * an offer, the total with Accept / Request changes / Decline. Opening the page and
 * downloading are what the professional sees; the footer says so. No cookies.
 *
 * Chrome is plain English, as on the configurator.
 */

import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { RouterLocation } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@archiyou/ui/viewer/model-viewer.js';
import type { ModelViewer } from '@archiyou/ui/viewer/model-viewer.js';
import { formatMoney } from '@archiyou/ui/projects/project-deliveries.js';

import type { DeliveryFile, DeliveryResponse, DeliveryView } from '@archiyou/types';

import { fetchDeliveryView, deliveryFileUrl, respondToDelivery } from '../services/projects.js';
import type { ApiError } from '../services/api.js';
import { BREAKPOINT_COMPACT } from '../styles/design-tokens.js';

const KIND_ICONS: Record<string, string> = { model: 'box', document: 'file-text', sheet: 'sheet', preview: 'image' };

@customElement('page-delivery')
export class PageDelivery extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    if (this._loading) return html`<div class="center"><wa-spinner></wa-spinner></div>`;
    if (this._gone !== null)
    {
      return html`
        <div class="center">
          <wa-icon library="lucide" name="link-2-off"></wa-icon>
          <h1>This link is no longer available</h1>
          <p>${this._gone ? `Please contact ${this._gone} for a new one.` : 'It may have been mistyped, or withdrawn.'}</p>
        </div>`;
    }
    const d = this._view;
    if (!d) return nothing;

    const model = d.files.find(f => f.kind === 'model');
    const others = d.files.filter(f => f.kind === 'document' || f.kind === 'sheet');
    return html`
      <header class="bar">
        <img class="logo" src="/img/archiyou_logo_header.png" alt="Archiyou">
        <span class="from">From <strong>${d.professional}</strong></span>
      </header>

      <div class="layout">
        <section class="viewer">
          ${model
            ? html`<model-viewer presentation></model-viewer>`
            : html`<div class="center"><wa-icon library="lucide" name="box"></wa-icon></div>`}
        </section>

        <aside class="side">
          <h1>${d.title}</h1>
          <p class="sub">
            ${d.recipient ? html`Prepared for ${d.recipient} · ` : nothing}${d.sentAt ? new Date(d.sentAt).toLocaleDateString() : ''}
          </p>
          ${d.message ? html`<p class="message">${d.message}</p>` : nothing}

          ${d.offer ? this._renderOffer(d) : nothing}

          ${others.length || model
            ? html`
              <section class="files">
                <h2>Files</h2>
                ${[...others, ...(model ? [model] : [])].map(f => this._renderFile(f))}
              </section>`
            : nothing}

          ${d.adjustPath
            ? html`
              <a class="adjust" href=${d.adjustPath}>
                <wa-icon library="lucide" name="sliders-horizontal"></wa-icon>
                Adjust this design and send ${d.professional} your changes
              </a>`
            : nothing}
        </aside>
      </div>

      <footer class="privacy">
        ${d.professional} sees when this page is opened and when files are downloaded. No cookies are used.
      </footer>
    `;
  }

  private _renderOffer(d: DeliveryView)
  {
    const offer = d.offer!;
    return html`
      <section class="offer">
        <div class="total">${formatMoney(offer.total, offer.currency)}</div>
        ${offer.validUntil ? html`<div class="valid">Valid until ${new Date(offer.validUntil).toLocaleDateString()}</div>` : nothing}
        ${offer.note ? html`<p class="offer-note">${offer.note}</p>` : nothing}
        ${d.response ? this._renderAnswer(d) : this._renderRespond()}
      </section>`;
  }

  private _renderAnswer(d: DeliveryView)
  {
    const said: Record<DeliveryResponse, string> = {
      accepted: 'You accepted this offer',
      declined: 'You declined this offer',
      changes: 'You asked for changes',
    };
    return html`
      <p class="answer ${d.response}">
        <wa-icon library="lucide" name=${d.response === 'accepted' ? 'circle-check' : d.response === 'declined' ? 'circle-x' : 'message-square'}></wa-icon>
        ${said[d.response!]}${d.responseAt ? ` on ${new Date(d.responseAt).toLocaleDateString()}` : ''}.
        ${d.response !== 'accepted' && d.responseNote ? html`<q>${d.responseNote}</q>` : nothing}
      </p>`;
  }

  private _renderRespond()
  {
    if (this._answering)
    {
      const accept = this._answering === 'accepted';
      return html`
        <div class="respond">
          <label class="note-label">
            ${accept ? 'A note (optional)' : this._answering === 'changes' ? 'What should change?' : 'Why not? (optional)'}
            <textarea rows="3" maxlength="2000" .value=${this._note}
              @input=${(e: Event) => { this._note = (e.target as HTMLTextAreaElement).value; }}></textarea>
          </label>
          ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
          <div class="buttons">
            <wa-button size="small" appearance="outlined" @click=${() => { this._answering = null; }}>Back</wa-button>
            <wa-button size="small" variant=${accept ? 'success' : 'brand'} ?loading=${this._sending}
              ?disabled=${this._answering === 'changes' && !this._note.trim()}
              @click=${this._respond}>
              ${accept ? 'Accept the offer' : this._answering === 'changes' ? 'Send' : 'Decline the offer'}
            </wa-button>
          </div>
        </div>`;
    }
    return html`
      <div class="buttons">
        <wa-button variant="success" @click=${() => this._answer('accepted')}>
          <wa-icon slot="start" library="lucide" name="check"></wa-icon>Accept
        </wa-button>
        <wa-button appearance="outlined" @click=${() => this._answer('changes')}>Request changes</wa-button>
        <wa-button appearance="plain" @click=${() => this._answer('declined')}>Decline</wa-button>
      </div>`;
  }

  private _renderFile(f: DeliveryFile)
  {
    const viewable = f.kind === 'document';
    return html`
      <div class="file">
        <wa-icon library="lucide" name=${KIND_ICONS[f.kind] ?? 'file'}></wa-icon>
        <span class="name">${f.name}</span>
        <span class="size">${this._size(f.bytes)}</span>
        ${viewable
          ? html`<a href=${deliveryFileUrl(this._token, f.name)} target="_blank" rel="noopener">View</a>`
          : nothing}
        <a href=${deliveryFileUrl(this._token, f.name, true)} download=${f.name}>Download</a>
      </div>`;
  }

  // ── 2. Properties, State ──
  /** Set by the router. */
  @property({ attribute: false }) location?: RouterLocation;

  @state() private _view: DeliveryView | null = null;
  @state() private _loading = true;
  /** The link is gone: the sender's name when it was revoked, '' when it never existed. */
  @state() private _gone: string | null = null;
  @state() private _answering: DeliveryResponse | null = null;
  @state() private _note = '';
  @state() private _sending = false;
  @state() private _error = '';

  // ── 3. Lifecycle ──
  override willUpdate(changed: Map<string, unknown>)
  {
    if (changed.has('location')) void this._load();
  }

  override updated()
  {
    void this._loadModel();
  }

  // ── 4. Behaviour & Methods ──
  private get _token(): string
  {
    return (this.location?.params as Record<string, string> | undefined)?.token ?? '';
  }

  private async _load()
  {
    this._loading = true;
    try
    {
      this._view = await fetchDeliveryView(this._token);
      document.title = `${this._view.title} · ${this._view.professional}`;
    }
    catch (err)
    {
      const body = (err as ApiError)?.body as { data?: { professional?: string } } | undefined;
      this._gone = body?.data?.professional ?? '';
    }
    finally
    {
      this._loading = false;
    }
  }

  private _modelLoaded = false;

  /** Put the frozen model in the viewer, once it is on the page. */
  private async _loadModel()
  {
    const viewer = this.renderRoot.querySelector<ModelViewer>('model-viewer');
    const model = this._view?.files.find(f => f.kind === 'model');
    if (!viewer || !model || this._modelLoaded) return;
    this._modelLoaded = true;
    try
    {
      const res = await fetch(deliveryFileUrl(this._token, model.name));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      viewer.load(await res.arrayBuffer());
    }
    catch (err)
    {
      console.warn('delivery: the model could not be loaded:', err);
    }
  }

  private _answer(response: DeliveryResponse)
  {
    this._answering = response;
    this._note = '';
    this._error = '';
  }

  private async _respond()
  {
    const response = this._answering;
    if (!response) return;
    this._sending = true;
    this._error = '';
    try
    {
      await respondToDelivery(this._token, response, this._note.trim() || null);
      this._answering = null;
      await this._load();
    }
    catch (err)
    {
      const body = (err as ApiError)?.body as { error?: string } | undefined;
      this._error = body?.error ?? 'Sending failed. Please try again.';
    }
    finally
    {
      this._sending = false;
    }
  }

  private _size(bytes: number): string
  {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      min-height: 100dvh;
      box-sizing: border-box;
      container: delivery / inline-size;
      font-family: var(--font-sans);
      color: var(--color-text);
      background: var(--color-surface-subtle);
    }

    *,
    *::before,
    *::after {
      box-sizing: inherit;
    }

    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      padding: var(--space-sm) var(--space-lg);
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
      font-size: var(--text-sm);
    }

    .logo {
      height: 1.5rem;
    }

    .layout {
      flex: 1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 24rem;
      min-height: 0;
    }

    @container delivery (width < ${unsafeCSS(BREAKPOINT_COMPACT)}) {
      .layout { grid-template-columns: minmax(0, 1fr); }
      .viewer { height: 55vh; }
    }

    .viewer {
      position: relative;
      min-height: 20rem;
      background: var(--color-bg);
    }

    .viewer model-viewer {
      position: absolute;
      inset: 0;
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: var(--space-lg);
      padding: var(--space-lg);
      background: var(--color-bg);
      border-left: 1px solid var(--color-border);
      overflow-y: auto;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-2xl);
    }

    h2 {
      margin: 0 0 var(--space-sm);
      font-size: var(--text-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
    }

    .sub {
      margin: calc(-1 * var(--space-md)) 0 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .message {
      margin: 0;
      white-space: pre-wrap;
    }

    .offer {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding: var(--space-lg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface-subtle);
    }

    .total {
      font-family: var(--font-display);
      font-size: var(--text-3xl);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .valid,
    .offer-note {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm);
      margin-top: var(--space-sm);
    }

    .respond {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
    }

    .note-label {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      font-size: var(--text-sm);
    }

    textarea {
      width: 100%;
      padding: var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-bg);
      color: var(--color-text);
      font: inherit;
      font-size: var(--input-font-size, var(--text-sm));
      resize: vertical;
    }

    .answer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs);
      margin: var(--space-sm) 0 0;
      font-weight: 600;
    }

    .answer.accepted wa-icon { color: var(--color-success); }
    .answer.declined wa-icon { color: var(--color-danger); }

    .answer q {
      flex-basis: 100%;
      font-weight: normal;
      color: var(--color-text-muted);
    }

    .files {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .file {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-height: var(--hit-min);
      font-size: var(--text-sm);
    }

    .file .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file .size {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    a {
      color: var(--color-primary);
    }

    .adjust {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      font-size: var(--text-sm);
    }

    .error {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-danger);
    }

    .privacy {
      padding: var(--space-sm) var(--space-lg);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      text-align: center;
    }

    .center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      flex: 1;
      height: 100%;
      padding: var(--space-lg);
      color: var(--color-text-muted);
      text-align: center;
    }

    .center wa-icon {
      font-size: var(--text-3xl);
    }

    .center h1 {
      color: var(--color-text);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-delivery': PageDelivery;
  }
}
