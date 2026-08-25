import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { Metric } from '@archiyou/core/src/calc/types';
import { METRIC_DEFAULT_ICON } from '@archiyou/core/src/constants';

@customElement('configurator-metric-card')
export class ConfiguratorMetricCard extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    const { metric } = this;
    if (!metric) return html``;

    const icon  = metric.options?.icon ?? METRIC_DEFAULT_ICON;
    const pre   = metric.options?.pre  ?? '';
    const unit  = metric.options?.unit ?? '';
    const label = metric.label || metric.name;
    const value = metric.data;

    return html`
      <div class="card">
        <div class="header">
          <wa-icon class="card-icon" library="lucide" name=${icon}></wa-icon>
          <span class="card-label" title=${label}>${label}</span>
        </div>
        <div class="value-row">
          <span class="card-value">${pre}${value}</span>
          ${unit ? html`<span class="card-unit">${unit}</span>` : ''}
        </div>
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
      flex-shrink: 0;
      height: 100%;
    }

    .card
    {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: var(--space-xs);
      padding: var(--space-sm) var(--space-xl);
      background: var(--color-bg-elevated);
      border-right: 1px solid var(--color-border);
      min-width: 160px;
      max-width: 240px;
      height: 100%;
      box-sizing: border-box;
    }

    .header
    {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .card-icon
    {
      font-size: var(--text-sm);
      color: var(--color-primary);
      flex-shrink: 0;
    }

    /* The metric name sits at the same level as the "Presets"/"Parameters"
       section headers, set in caps to read as a label rather than a value. */
    .card-label
    {
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Value left, unit pushed to the card's right edge. */
    .value-row
    {
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
      width: 100%;
    }

    .card-value
    {
      font-family: var(--font-sans);
      font-size: var(--text-lg, 1.125rem);
      font-weight: 700;
      color: var(--color-text);
      line-height: 1.2;
      word-break: break-word;
      min-width: 0;
    }

    .card-unit
    {
      margin-left: auto;
      flex-shrink: 0;
      font-size: var(--text-xs);
      font-weight: 400;
      color: var(--color-text-muted, #888);
      white-space: nowrap;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'configurator-metric-card': ConfiguratorMetricCard;
  }
}
