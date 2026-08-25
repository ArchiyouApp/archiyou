import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { Metric } from '@archiyou/core/src/calc/types';
import { METRIC_DEFAULT_ICON } from '@archiyou/core/src/constants';

@customElement('editor-metric-card')
export class EditorMetricCard extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    const { metric } = this;
    if (!metric) return html``;

    const icon = metric.options?.icon ?? METRIC_DEFAULT_ICON;
    const pre  = metric.options?.pre  ?? '';
    const unit = metric.options?.unit ?? '';
    const label = metric.label || metric.name;
    const value = metric.data;

    return html`
      <div class="card">
        <div class="header">
          <wa-icon class="card-icon" library="lucide" name=${icon}></wa-icon>
          <span class="card-label">${label}</span>
        </div>
        <div class="card-value">${pre}${value}<span class="card-unit">${unit}</span></div>
      </div>
    `;
  }

  // ── 2. Properties ──
  @property({ attribute: false }) metric: Metric | null = null;

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: block;
    }

    .card
    {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding: var(--space-md);
      background: var(--color-bg, #ffffff);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg, 12px);
      min-width: 0;
    }

    .header
    {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .card-icon
    {
      font-size: var(--text-base, 1rem);
      color: var(--color-primary);
      flex-shrink: 0;
    }

    .card-label
    {
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-gray-dark, #666);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card-value
    {
      font-family: var(--font-sans);
      font-size: var(--text-2xl, 1.5rem);
      font-weight: 700;
      color: var(--color-text, #414651);
      line-height: 1.2;
      word-break: break-word;
    }

    .card-unit
    {
      font-size: var(--text-md, 1rem);
      font-weight: 400;
      color: var(--color-gray-dark, #666);
      margin-left: 0.15em;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-metric-card': EditorMetricCard;
  }
}
