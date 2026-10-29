/**
 * <project-activity> — a project's timeline: orders, configurations, status changes,
 * deliveries and what the client did with them (plans/PROJECTS.md). Newest first.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { ProjectEvent } from '@archiyou/types';

const ICONS: Record<string, string> = {
  'order.received': 'shopping-cart',
  'configuration.added': 'box',
  'status.changed': 'flag',
  'delivery.sent': 'send',
  'delivery.revoked': 'link-2-off',
  'delivery.opened': 'eye',
  'file.downloaded': 'download',
  'delivery.accepted': 'circle-check',
  'delivery.declined': 'circle-x',
  'delivery.changes_requested': 'message-square',
  'adjust.opened': 'sliders-horizontal',
  'adjust.requested': 'sliders-horizontal',
};

/** "3 minutes ago", "yesterday", "2 Oct". */
export function timeAgo(iso: string): string
{
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7]];
  const found = steps.reduce<{ value: number; unit: Intl.RelativeTimeFormatUnit | null }>((acc, [unit, size]) =>
  {
    if (acc.unit) return acc;
    return Math.abs(acc.value) < size ? { value: acc.value, unit } : { value: acc.value / size, unit: null };
  }, { value: seconds, unit: null });
  return found.unit
    ? rtf.format(Math.round(found.value), found.unit)
    : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

@customElement('project-activity')
export class ProjectActivity extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    if (this.events.length === 0) return html`<p class="empty">${msg('Nothing happened yet.')}</p>`;
    return html`
      <ol>
        ${this.events.map(e => html`
          <li class=${e.actor === 'client' ? 'client' : ''}>
            <wa-icon library="lucide" name=${ICONS[e.type] ?? 'dot'}></wa-icon>
            <span class="text">${this._describe(e)}</span>
            <time datetime=${e.created} title=${new Date(e.created).toLocaleString()}>${timeAgo(e.created)}</time>
          </li>`)}
      </ol>
    `;
  }

  // ── 2. Properties ──
  @property({ attribute: false }) events: ProjectEvent[] = [];

  // ── 4. Behaviour & Methods ──
  private _describe(e: ProjectEvent)
  {
    const meta = (e.meta ?? {}) as Record<string, unknown>;
    const n = meta.number !== undefined ? `#${meta.number}` : '';
    const statuses: Record<string, string> = {
      request: msg('request'), active: msg('active'), won: msg('won'), lost: msg('lost'),
    };
    switch (e.type)
    {
      case 'order.received':
        return meta.fulfillment ? msg(str`Order received: ${meta.fulfillment}`) : msg('Order received');
      case 'configuration.added':
        return meta.origin === 'adjust'
          ? msg(str`The client sent changes: v${meta.rev}`)
          : meta.origin === 'order' ? msg(str`v${meta.rev} ordered`) : msg(str`v${meta.rev} added`);
      case 'status.changed':
        return msg(str`Status ${statuses[meta.from as string] ?? meta.from} → ${statuses[meta.to as string] ?? meta.to}`);
      case 'delivery.sent':
        return meta.to ? msg(str`Delivery ${n} sent to ${meta.to}`) : msg(str`Delivery ${n} sent`);
      case 'delivery.revoked':
        return msg(str`Delivery ${n} link revoked`);
      case 'delivery.opened':
        return msg(str`Delivery ${n} opened`);
      case 'file.downloaded':
        return msg(str`${meta.file} downloaded`);
      case 'delivery.accepted':
        return msg(str`Offer ${n} accepted`);
      case 'delivery.declined':
        return msg(str`Offer ${n} declined`);
      case 'delivery.changes_requested':
        return html`${msg(str`Changes requested on ${n}`)}${meta.note ? html`<q>${meta.note}</q>` : nothing}`;
      case 'adjust.opened':
        return msg('The client is adjusting the design');
      case 'adjust.requested':
        return msg(str`The client changed ${(meta.changed as string[] | undefined)?.join(', ') ?? ''}`);
      default:
        return e.type;
    }
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: block;
    }

    .empty {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    ol {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: baseline;
      gap: var(--space-sm);
      font-size: var(--text-sm);
    }

    li wa-icon {
      color: var(--color-text-muted);
      transform: translateY(0.125rem);
    }

    li.client wa-icon {
      color: var(--color-primary);
    }

    .text q {
      display: block;
      color: var(--color-text-muted);
    }

    time {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      white-space: nowrap;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'project-activity': ProjectActivity;
  }
}
