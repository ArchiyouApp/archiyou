/**
 * <project-configurations> — a project's configurations, newest first (plans/PROJECTS.md).
 * The screen calls them designs; the data keeps `configuration`.
 *
 * Presentational: each row shows the picture, `v3`, how it got here, the script, the
 * values that make it (those that differ from the defaults) and the client's message.
 * One row is `selected` (the page shows its deliveries); the page does the opening.
 *
 * Emits (detail = the ConfigurationData):
 *   configuration-select              a row was chosen
 *   configuration-open-configurator   it came from a published configurator
 *   configuration-open-editor
 *   configuration-deliver             make a delivery of it
 *   configuration-label               detail = { configuration, label }
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';

import type { ConfigurationData, ConfigurationOrigin } from '@archiyou/types';

import { assetUrl } from '@archiyou/editor/src/services/api';

/** A parameter value as a person reads it. An item of a list parameter by its name when it
 *  has one (openings: "Frontdoor, SlidingdoorBack"); the whole value is in the tooltip. */
export function formatValue(value: unknown): string
{
  if (Array.isArray(value)) return value.map(v => formatValue(v)).join(', ');
  if (value !== null && typeof value === 'object')
  {
    const named = (value as Record<string, unknown>).name ?? (value as Record<string, unknown>).label;
    return typeof named === 'string' && named ? named : JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? msg('yes') : msg('no');
  return String(value ?? '');
}

/** Day and month, with the year only when it is not this year. */
export function formatDay(iso: string | null): string
{
  if (!iso) return '';
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

@customElement('project-configurations')
export class ProjectConfigurations extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    if (this.configurations.length === 0)
    {
      return html`
        <p class="empty">
          ${msg('No designs yet. Add one from a configurator, or in the editor choose Add to project… in the menu.')}
        </p>`;
    }
    return html`${this.configurations.map(c => this._renderRow(c))}`;
  }

  private _renderRow(c: ConfigurationData)
  {
    const changed = Object.entries(c.changed);
    const foreign = !!c.scriptAuthor && c.scriptAuthor !== this.me;
    const selected = c.id === this.selected;
    return html`
      <article class=${selected ? 'row selected' : 'row'} tabindex="0" aria-current=${selected ? 'true' : 'false'}
        @click=${(e: Event) => this._select(e, c)} @keydown=${(e: KeyboardEvent) => this._selectByKey(e, c)}>
        <div class="thumb">
          ${c.thumbnail
            ? html`<img src=${assetUrl(c.thumbnail) ?? ''} alt="" loading="lazy">`
            : html`<wa-icon library="lucide" name="box"></wa-icon>`}
        </div>

        <div class="body">
          <div class="head">
            <span class="rev">v${c.rev}</span>
            ${this._editing === c.id
              ? html`
                <wa-input class="label-input" size="small" .value=${c.label ?? ''} autofocus
                  @change=${(e: Event) => this._saveLabel(c, (e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') this._editing = null; }}></wa-input>`
              : html`
                <span class="name">${c.label || c.scriptName || msg('untitled')}</span>
                <button class="icon-button" title=${msg('Rename')} @click=${() => { this._editing = c.id; }}>
                  <wa-icon library="lucide" name="pencil"></wa-icon>
                </button>
                <span class="day">${formatDay(c.created)}</span>`}
            <wa-badge variant=${this._originVariant(c.origin)} appearance="filled-outlined">${this._originLabel(c)}</wa-badge>
          </div>

          <div class="meta">
            ${c.label && c.scriptName ? html`<span>${c.scriptName}</span>` : nothing}
            ${foreign ? html`<span>${msg(str`by ${c.scriptAuthor}`)}</span>` : nothing}
            ${c.configurator ? html`<span>${c.configurator.name}:${c.configurator.version}</span>` : nothing}
          </div>

          <p class="values" title=${changed.map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n')}>
            ${changed.length
              ? changed.map(([name, value], i) => html`${i ? ' · ' : ''}<span class="param">${name.toLowerCase()}</span> ${formatValue(value)}`)
              : msg('All parameters at their defaults')}
          </p>

          ${c.message ? html`<blockquote class="message">${c.message}</blockquote>` : nothing}

          <div class="actions">
            ${c.configurator
              ? html`
                <wa-button size="small" appearance="outlined" @click=${() => this._emit('configuration-open-configurator', c)}>
                  <wa-icon slot="start" library="lucide" name="tv-minimal-play"></wa-icon>
                  ${msg('Open configurator')}
                </wa-button>`
              : nothing}
            ${foreign
              ? nothing
              : html`
                <wa-button size="small" appearance="outlined" @click=${() => this._emit('configuration-open-editor', c)}>
                  <wa-icon slot="start" library="lucide" name="code"></wa-icon>
                  ${msg('Open in editor')}
                </wa-button>`}
            ${this.canDeliver
              ? html`
                <wa-button size="small" variant="brand" appearance="outlined" @click=${() => this._emit('configuration-deliver', c)}>
                  <wa-icon slot="start" library="lucide" name="send"></wa-icon>
                  ${msg('New delivery')}
                </wa-button>`
              : nothing}
          </div>
        </div>
      </article>
    `;
  }

  // ── 2. Properties, State ──
  @property({ attribute: false }) configurations: ConfigurationData[] = [];
  /** The signed-in professional's handle, to tell their own scripts from other authors'. */
  @property({ type: String }) me = '';
  /** Show "New delivery" on each row. */
  @property({ type: Boolean }) canDeliver = false;
  /** Id of the chosen row. */
  @property({ type: String }) selected = '';

  /** The configuration whose label is being edited. */
  @state() private _editing: string | null = null;

  // ── 4. Behaviour & Methods ──
  /** A click on the row, not on one of its buttons or the label field. */
  private _select(e: Event, c: ConfigurationData)
  {
    const interactive = e.composedPath().some(el => el instanceof HTMLElement && el.matches('button, wa-button, wa-input, a'));
    if (!interactive && c.id !== this.selected) this._emit('configuration-select', c);
  }

  private _selectByKey(e: KeyboardEvent, c: ConfigurationData)
  {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    if (c.id !== this.selected) this._emit('configuration-select', c);
  }

  private _originLabel(c: ConfigurationData): string
  {
    const labels: Record<ConfigurationOrigin, string> = {
      order: c.fulfillment ? msg(str`Order: ${c.fulfillment}`) : msg('Order'),
      added: msg('Added'),
      adjust: msg('Changes from client'),
    };
    return labels[c.origin];
  }

  private _originVariant(origin: ConfigurationOrigin): 'warning' | 'neutral' | 'brand'
  {
    return origin === 'order' ? 'warning' : origin === 'adjust' ? 'brand' : 'neutral';
  }

  private _saveLabel(configuration: ConfigurationData, label: string)
  {
    this._editing = null;
    if ((configuration.label ?? '') === label.trim()) return;
    this._emit('configuration-label', { configuration, label: label.trim() || null });
  }

  private _emit<T>(name: string, detail: T)
  {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
    }

    .empty {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .row {
      display: flex;
      gap: var(--space-md);
      padding: var(--space-sm);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      cursor: pointer;
    }

    .row:hover {
      border-color: var(--color-gray-dark);
    }

    .row:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }

    /* Chosen: a blue outline, no fill, so the picture and text keep a white ground */
    .row.selected {
      border-color: var(--color-primary);
      box-shadow: inset 0 0 0 1px var(--color-primary);
      cursor: default;
    }

    .thumb {
      flex: 0 0 5rem;
      height: 5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-bg);
      border-radius: var(--radius-sm);
      color: var(--color-text-muted);
      overflow: hidden;
    }

    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      padding: var(--space-xs);
      box-sizing: border-box;
    }

    .body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .head {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
    }

    .rev {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--color-primary);
    }

    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }

    .label-input {
      flex: 1;
      min-width: 0;
    }

    .day {
      flex-shrink: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .head wa-badge {
      margin-left: auto;
      flex-shrink: 0;
    }

    .icon-button {
      display: inline-flex;
      padding: var(--space-xs);
      border: none;
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;
    }

    .icon-button:hover {
      color: var(--color-text);
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-md);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    /* The values that make it, as one quiet line (two at most; all of it in the tooltip) */
    .values {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      margin: 0;
      font-size: var(--text-xs);
      color: var(--color-text);
    }

    .values .param {
      color: var(--color-text-muted);
    }

    .message {
      margin: 0;
      padding: var(--space-xs) var(--space-sm);
      border-left: 3px solid var(--color-border);
      font-size: var(--text-sm);
      white-space: pre-wrap;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      margin-top: var(--space-xs);
    }

    /* Web Awesome sizes a button from its font: xs text makes the whole button small */
    .actions wa-button {
      font-size: var(--text-xs);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'project-configurations': ProjectConfigurations;
  }
}
