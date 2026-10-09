import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/copy-button/copy-button.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import { secretManager, AI_PROVIDERS, type KeyInfo, type KeyKind } from '@archiyou/editor/src/services/secret-manager';

/**
 * <editor-keys-menu> — the user's keys: a Google service account, AI provider keys,
 * other API keys. One list for every kind (plans/PROTECTED_CONTENT.md §6).
 *
 * A key never comes back out of this menu — there is no reveal and no edit, only
 * Replace — and it never reaches a script: a script names a key at most
 * (`cloudcalc.open(url, { key: 'urbuild' })`). Keys are used on this page only, and
 * only for the user's own scripts (services/secret-manager.ts).
 *
 * TWO PANES, one modal, like <editor-modules-menu>: the list, and the form that adds
 * or replaces a key.
 *
 * Emits:
 *   keys-menu-cancel  CustomEvent<void>  — the user closed it
 */
@customElement('editor-keys-menu')
export class KeysMenu extends SignalWatcher(LitElement)
{

  // ── 1. Render ──────────────────────────────────────────────────────────────

  override render()
  {
    return html`
      <wa-dialog label=${msg('Keys')} ?open=${this.open} @wa-after-hide=${this._cancel}>
        <div class="viewport">
          <div class=${classMap({ panes: true, 'show-form': this._form !== null })}>
            <section class="pane" ?inert=${this._form !== null}>${this._renderList()}</section>
            <section class="pane" ?inert=${this._form === null}>${this._form ? this._renderForm() : nothing}</section>
          </div>
        </div>
      </wa-dialog>
    `;
  }

  private _renderList()
  {
    const keys = secretManager.keys.get();
    return html`
      <p class="intro">
        ${msg('With keys you can access content that is not public. A script only refers to a key, never reads it. They also remain on your browser and are not uploaded to Archiyou unless you grant rights to a public configurator to use them.')}
      </p>
      <div class="add">
        <wa-select
          size="small"
          class="add-kind"
          aria-label=${msg('Kind of key')}
          @change=${(e: Event) => { this._addKind = String((e.target as any).value ?? 'google-service-account') as KeyKind; }}
        >
          ${(Object.keys(KIND_ICON) as KeyKind[]).map((kind) => html`
            <wa-option value=${kind} ?selected=${kind === this._addKind}>${KIND_LABEL[kind]()}</wa-option>`)}
        </wa-select>
        <button class="btn-primary" @click=${() => this._openForm(this._addKind)}>${msg('Add')}</button>
      </div>
      ${keys.length === 0
        ? html`<p class="empty">${msg('No keys yet. Public Google Sheets need none — add a service account for private ones.')}</p>`
        : html`<div class="list">${keys.map((k) => this._renderKey(k))}</div>`}
      ${this._renderActivity()}
    `;
  }

  private _renderKey(k: KeyInfo)
  {
    const confirming = this._confirmRemove === k.name;
    return html`
      <div class="key">
        <wa-icon class="icon" library="lucide" name=${KIND_ICON[k.kind]}></wa-icon>
        <div class="body">
          <span class="name">${k.name}</span>
          <span class="meta">
            ${kindLabel(k)}${k.isDefault ? html` · <strong>${msg('default')}</strong>` : nothing}${k.storage === 'session' ? html` · ${msg('this tab only')}` : nothing}
          </span>
          ${k.account
            ? html`<span class="hint">${msg('Share sheets with')} <code>${k.account}</code><wa-copy-button value=${k.account}></wa-copy-button></span>`
            : html`<span class="hint"><code>${k.hint}</code> · ${msg(str`only sent to ${k.hosts.join(', ')}`)}</span>`}
        </div>
        <div class="key-actions">
          ${k.kind === 'google-service-account' && !k.isDefault
            ? html`<button class="act" @click=${() => secretManager.setDefault(k.name)}>${msg('Make default')}</button>`
            : nothing}
          <button class="act" @click=${() => this._openForm(k.kind, k)}>${msg('Replace')}</button>
          <button class=${classMap({ act: true, danger: true, confirming })} @click=${() => this._remove(k.name)}>
            ${confirming ? msg('Remove — sure?') : msg('Remove')}
          </button>
        </div>
      </div>
    `;
  }

  private _renderActivity()
  {
    const uses = secretManager.activity.get().slice(0, 8);
    if (!uses.length) return nothing;
    return html`
      <h4 class="activity-title">${msg('Recently')}</h4>
      <ul class="activity">
        ${uses.map((u) => html`
          <li>
            <span class="when">${new Date(u.at).toLocaleTimeString()}</span>
            <code>${u.id.slice(0, 12)}…</code>
            <span>${u.via === 'key' ? msg(str`with ${u.keyName ?? '?'}`) : u.via === 'public' ? msg('public') : ''}</span>
            <span class=${classMap({ outcome: true, bad: u.outcome !== 'used' && u.outcome !== 'cached' })}>${u.outcome.replaceAll('_', ' ')}</span>
          </li>`)}
      </ul>
    `;
  }

  private _renderForm()
  {
    const f = this._form!;
    const replacing = !!f.replacing;
    const sa = f.kind === 'google-service-account' ? previewServiceAccount(f.value) : null;
    return html`
      <div class="form">
        <div class="form-header">
          <button class="back" @click=${this._closeForm}>
            <wa-icon library="lucide" name="arrow-left"></wa-icon>${msg('Keys')}
          </button>
          <span class="form-title">${replacing ? msg(str`Replace ${f.name}`) : FORM_TITLE[f.kind]()}</span>
        </div>

        <wa-input
          label=${msg('Name')}
          hint=${msg('What a script types, e.g. { key: \'urbuild\' }. Lowercase, digits, - and _.')}
          .value=${f.name}
          ?disabled=${replacing}
          @input=${(e: Event) => this._set({ name: String((e.target as any).value ?? '') })}
        ></wa-input>

        ${f.kind === 'ai' ? html`
          <wa-select label=${msg('Provider')} @change=${(e: Event) => this._set({ provider: String((e.target as any).value ?? '') })}>
            ${Object.entries(AI_PROVIDERS).map(([id, p]) => html`<wa-option value=${id} ?selected=${f.provider === id}>${p.label}</wa-option>`)}
          </wa-select>` : nothing}

        ${f.kind === 'api-key' ? html`
          <wa-input
            label=${msg('Sent only to')}
            hint=${msg('The host(s) this key may go to, comma separated — e.g. api.supplier.example')}
            .value=${f.hosts}
            @input=${(e: Event) => this._set({ hosts: String((e.target as any).value ?? '') })}
          ></wa-input>` : nothing}

        ${f.kind === 'google-service-account'
          ? html`
            <wa-textarea
              label=${msg('Service account key (JSON)')}
              hint=${msg('Google Cloud → IAM → Service accounts → Keys → Add key → JSON. Paste the whole file.')}
              rows="6"
              .value=${f.value}
              @input=${(e: Event) => this._set({ value: String((e.target as any).value ?? '') })}
            ></wa-textarea>
            ${sa ? html`
              <div class="hint-box">
                <wa-icon library="lucide" name="lightbulb"></wa-icon>
                <span>
                  ${msg('Share each sheet you want to use with')} <code>${sa}</code><wa-copy-button value=${sa}></wa-copy-button>
                  ${msg('as Viewer. It can read everything shared with it — so use a service account just for Archiyou, and share only what it needs.')}
                </span>
              </div>` : nothing}`
          : html`
            <wa-input
              type="password"
              label=${msg('Key')}
              .value=${f.value}
              @input=${(e: Event) => this._set({ value: String((e.target as any).value ?? '') })}
            ></wa-input>`}

        <wa-checkbox ?checked=${f.session} @change=${(e: Event) => this._set({ session: !!(e.target as any).checked })}>
          ${msg('Forget when I close this tab')}
        </wa-checkbox>
        ${f.kind === 'google-service-account' ? html`
          <wa-checkbox ?checked=${f.isDefault} @change=${(e: Event) => this._set({ isDefault: !!(e.target as any).checked })}>
            ${msg('Use as default key for Google')}
          </wa-checkbox>` : nothing}

        ${this._error ? html`<div class="error">${this._error}</div>` : nothing}

        <div class="form-actions">
          <button class="btn-secondary" @click=${this._closeForm} ?disabled=${this._saving}>${msg('Cancel')}</button>
          <button class="btn-primary" @click=${this._save} ?disabled=${this._saving}>
            ${this._saving ? html`<wa-spinner></wa-spinner>` : nothing}${msg('Save')}
          </button>
        </div>
      </div>
    `;
  }

  // ── 2. State, Properties & Signals ─────────────────────────────────────────

  @property({ type: Boolean, reflect: true }) open = false;

  /** The form being filled in, or null for the list. */
  @state() private _form: KeyForm | null = null;
  /** What the Add button adds. */
  @state() private _addKind: KeyKind = 'google-service-account';
  @state() private _error = '';
  @state() private _saving = false;
  /** The key whose Remove was clicked once; a second click removes it. */
  @state() private _confirmRemove: string | null = null;

  // ── 4. Behaviour & Methods ─────────────────────────────────────────────────

  private _openForm(kind: KeyKind, replacing?: KeyInfo)
  {
    this._error = '';
    this._confirmRemove = null;
    const taken = new Set(secretManager.list().map((k) => k.name));
    const base = kind === 'google-service-account' ? 'google' : kind === 'ai' ? 'ai' : 'api';
    const free = (n: number) : string => (taken.has(n === 1 ? base : `${base}-${n}`) ? free(n + 1) : (n === 1 ? base : `${base}-${n}`));
    this._form = {
      kind,
      name: replacing?.name ?? free(1),
      value: '',
      provider: replacing?.provider ?? Object.keys(AI_PROVIDERS)[0]!,
      hosts: replacing?.kind === 'api-key' ? replacing.hosts.join(', ') : '',
      session: replacing?.storage === 'session',
      isDefault: replacing?.isDefault ?? !secretManager.list().some((k) => k.kind === kind && k.isDefault),
      replacing: replacing?.name,
    };
  }

  private _closeForm()
  {
    this._form = null;
    this._error = '';
  }

  private _set(patch: Partial<KeyForm>)
  {
    this._form = { ...this._form!, ...patch };
    this._error = '';
  }

  private async _save()
  {
    const f = this._form;
    if (!f) return;
    this._saving = true;
    try
    {
      await secretManager.put({
        name: f.name,
        kind: f.kind,
        value: f.value,
        provider: f.kind === 'ai' ? f.provider : undefined,
        hosts: f.kind === 'api-key' ? f.hosts.split(',') : undefined,
        storage: f.session ? 'session' : 'local',
        isDefault: f.kind === 'google-service-account' ? f.isDefault : undefined,
      });
      this._closeForm();
    }
    catch (e)
    {
      this._error = (e as Error)?.message ?? String(e);
    }
    finally
    {
      this._saving = false;
    }
  }

  private _remove(name: string)
  {
    if (this._confirmRemove !== name)
    {
      this._confirmRemove = name;
      return;
    }
    secretManager.remove(name);
    this._confirmRemove = null;
  }

  private _cancel(e?: Event)
  {
    // wa-after-hide bubbles: the kind dropdown closing its list, or a copy button's
    // tooltip fading, sends one up through the dialog too. Only the dialog's own closes it.
    if (e && e.target !== e.currentTarget) return;
    this._closeForm();
    this._confirmRemove = null;
    this.dispatchEvent(new CustomEvent('keys-menu-cancel', { bubbles: true, composed: true }));
  }

  // ── 5. Styles ──────────────────────────────────────────────────────────────

  static override styles = css`
    :host { display: contents; }

    wa-dialog {
      --wa-color-surface-raised: var(--wa-color-surface-default, #fff);
      --width: 44rem;
    }
    @media (max-width: 60rem) {
      wa-dialog { --width: 92vw; }
    }
    wa-dialog::part(title) {
      font-size: var(--text-base, 1rem);
      line-height: var(--text-base, 1rem);
    }

    .viewport { overflow: hidden; height: 62vh; min-height: 22rem; }
    .panes {
      display: grid;
      grid-template-columns: repeat(2, 50%);
      width: 200%;
      height: 100%;
      transition: transform 320ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .panes.show-form { transform: translateX(-50%); }
    @media (prefers-reduced-motion: reduce) { .panes { transition: none; } }
    .pane { height: 100%; overflow-y: auto; overflow-x: hidden; padding-inline: 0.125rem; }

    .intro, .empty {
      margin: 0 0 1rem;
      font-size: var(--text-sm, 0.875rem);
      color: var(--color-text-quiet, #666);
    }
    .add { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
    .add-kind { flex: 0 1 16rem; }

    /* The editor's dialog buttons (share-script-menu, manage-configurators-menu). */
    .btn-primary, .btn-secondary {
      display: inline-flex; align-items: center; gap: 0.4rem;
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
    .btn-secondary { background: transparent; color: var(--color-text); border: 1px solid var(--color-border); }
    .btn-secondary:hover:not(:disabled) { background: color-mix(in srgb, var(--color-border) 30%, transparent); }
    .btn-primary:disabled, .btn-secondary:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary wa-spinner { font-size: var(--text-sm); --track-color: transparent; --indicator-color: currentColor; }

    .list { display: flex; flex-direction: column; gap: 0.5rem; }
    .key {
      display: flex; gap: 0.75rem; align-items: flex-start;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--color-border, #e0e0e0);
      border-radius: 0.5rem;
    }
    .icon { flex: 0 0 auto; margin-top: 0.15rem; }
    .body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
    .name { font-family: var(--wa-font-family-code, monospace); font-size: var(--text-sm, 0.875rem); font-weight: 600; }
    .meta, .hint { font-size: var(--text-xs, 0.75rem); color: var(--color-text-quiet, #666); overflow-wrap: anywhere; }
    .key-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 0.1rem; }
    /* Small text actions, like the row actions of manage-configurators-menu. */
    .act {
      border: none; background: transparent; cursor: pointer;
      padding: 0.15rem 0.4rem;
      border-radius: var(--radius-sm, 4px);
      font-family: var(--font-sans);
      font-size: var(--text-xs, 0.75rem);
      color: var(--color-text-muted, #666);
    }
    .act:hover { background: color-mix(in srgb, var(--color-border) 40%, transparent); color: var(--color-text); }
    .act.danger:hover, .act.confirming { color: var(--color-alert, #ef4444); }
    code {
      font-family: var(--wa-font-family-code, monospace);
      background: var(--color-surface-sunken, rgba(0, 0, 0, 0.06));
      padding: 0.05rem 0.3rem;
      border-radius: 0.25rem;
    }

    .activity-title { margin: 1.25rem 0 0.4rem; font-size: var(--text-sm, 0.875rem); font-weight: 600; }
    .activity { list-style: none; margin: 0; padding: 0; font-size: var(--text-xs, 0.75rem); }
    .activity li { display: flex; gap: 0.5rem; padding: 0.15rem 0; color: var(--color-text-quiet, #666); }
    .activity .when { min-width: 5rem; }
    .outcome.bad { color: var(--wa-color-danger-fill-loud, #c0392b); }

    .form { display: flex; flex-direction: column; gap: 0.9rem; padding-bottom: 1rem; }
    .form-header {
      position: sticky; top: 0; z-index: 1;
      display: flex; align-items: center; gap: 0.5rem;
      padding-bottom: 0.5rem;
      background: var(--wa-color-surface-default, #fff);
      border-bottom: 1px solid var(--color-border, #e0e0e0);
    }
    .form-title { font-weight: 600; font-size: var(--text-sm, 0.875rem); }
    .back {
      display: inline-flex; align-items: center; gap: 0.3rem;
      border: none; background: transparent; cursor: pointer;
      padding: 0.25rem 0.4rem;
      border-radius: var(--radius-sm, 4px);
      font-family: var(--font-sans);
      font-size: var(--text-sm, 0.875rem);
      color: var(--color-text-muted, #666);
    }
    .back:hover { background: color-mix(in srgb, var(--color-border) 40%, transparent); color: var(--color-text); }
    .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }

    /* What to do next with a pasted service account: quiet, but readable. */
    .hint-box {
      display: flex; gap: 0.5rem; align-items: flex-start;
      padding: 0.5rem 0.65rem;
      border: 1px solid var(--color-primary, #0b74de);
      border-radius: var(--radius-sm, 4px);
      font-size: var(--text-xs, 0.75rem);
      line-height: 1.5;
      color: var(--color-text);
    }
    .hint-box wa-icon { flex: 0 0 auto; margin-top: 0.15rem; color: var(--color-primary, #0b74de); }
    .hint-box wa-copy-button { font-size: var(--text-xs, 0.75rem); vertical-align: middle; }
    .error {
      padding: 0.5rem 0.65rem;
      border: 1px solid var(--color-alert, #ef4444);
      border-radius: var(--radius-sm, 4px);
      font-size: var(--text-xs, 0.75rem);
      color: var(--color-alert, #ef4444);
    }
  `;
}

interface KeyForm
{
  kind: KeyKind;
  name: string;
  value: string;
  provider: string;
  hosts: string;
  session: boolean;
  isDefault: boolean;
  /** The name of the key being replaced, if any. */
  replacing?: string;
}

const KIND_ICON: Record<KeyKind, string> = {
  'google-service-account': 'sheet',
  ai: 'sparkles',
  'api-key': 'key-round',
};

const KIND_LABEL: Record<KeyKind, () => string> = {
  'google-service-account': () => msg('Google service account'),
  ai: () => msg('AI key'),
  'api-key': () => msg('API key'),
};

const FORM_TITLE: Record<KeyKind, () => string> = {
  'google-service-account': () => msg('Add a Google service account'),
  ai: () => msg('Add an AI key'),
  'api-key': () => msg('Add an API key'),
};

function kindLabel(k: KeyInfo) : string
{
  if (k.kind === 'google-service-account') return msg('Google service account');
  if (k.kind === 'ai') return msg(str`AI · ${AI_PROVIDERS[k.provider ?? '']?.label ?? k.provider ?? ''}`);
  return msg('API key');
}

/** The service account's email, read from pasted JSON before it is saved — a derived,
 *  non-secret fact that tells the user exactly which address to share sheets with. */
function previewServiceAccount(value: string) : string | null
{
  try
  {
    const parsed = JSON.parse(value);
    return parsed?.type === 'service_account' && typeof parsed.client_email === 'string' ? parsed.client_email : null;
  }
  catch
  {
    return null;
  }
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-keys-menu': KeysMenu;
  }
}
