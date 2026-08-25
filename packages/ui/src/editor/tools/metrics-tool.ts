import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { executionResult } from '@archiyou/editor/src/state/workspace';
import type { Metric } from '@archiyou/core/src/calc/types';
import './metric-card.js';

@customElement('editor-metrics-tool')
export class EditorMetricsTool extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const result = executionResult.get();

    if (!result)
    {
      return this._renderEmpty('chart-simple', 'Run the script to see metrics');
    }

    const metrics = this._collectMetrics();

    if (metrics.length === 0)
    {
      return this._renderEmpty('chart-simple', 'No metrics in this script');
    }

    return html`
      <div class="metrics-grid">
        ${metrics.map(metric => html`
          <editor-metric-card .metric=${metric}></editor-metric-card>
        `)}
      </div>
    `;
  }

  // ── 4. Behaviour & Methods ──
  private _collectMetrics(): Metric[]
  {
    const outputs = executionResult.get()?.outputs ?? [];
    const metrics: Metric[] = [];

    outputs
      .filter(o => o.path.category === 'metrics')
      .forEach(o =>
      {
        const raw = o.output;
        if (Array.isArray(raw))
        {
          metrics.push(...(raw as Metric[]));
        }
        else if (raw && typeof raw === 'object')
        {
          // output may be Record<string, Metric>
          metrics.push(...(Object.values(raw) as Metric[]));
        }
      });

    return metrics;
  }

  private _renderEmpty(icon: string, message: string)
  {
    return html`
      <div class="empty-state">
        <wa-icon library="lucide" name=${icon} class="empty-icon"></wa-icon>
        <span class="empty-msg">${message}</span>
      </div>
    `;
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      font-family: var(--font-sans);
      color: var(--color-text);
      background: var(--color-gray, #f3f3f3);
    }

    /* ─── Metrics grid ─── */
    .metrics-grid
    {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-md);
      padding: var(--space-md);
      align-content: flex-start;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    editor-metric-card
    {
      flex: 1 1 140px;
      min-width: 120px;
      max-width: 240px;
    }

    /* ─── Empty state ─── */
    .empty-state
    {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      width: 100%;
      height: 100%;
      color: var(--color-gray-dark);
    }

    .empty-icon { font-size: 2rem; opacity: 0.4; }

    .empty-msg
    {
      font-size: var(--text-sm);
      color: var(--color-gray-dark);
      text-align: center;
      padding: 0 var(--space-lg);
      margin: 0;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-metrics-tool': EditorMetricsTool;
  }
}
