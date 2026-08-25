import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { executionResult } from '@archiyou/editor/src/state/workspace';
import type { ScriptStatementResult } from '@archiyou/core/src/execution/types';

/** Per-statement execution profiling. Reads result.statements (populated only when the
 *  script ran in per-statement mode) and lists statements slowest-first with a duration
 *  bar, so hot spots are obvious. The failing statement (if any) is flagged. */
@customElement('editor-profiling-tool')
export class EditorProfilingTool extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const statements = executionResult.get()?.statements;

    // No statements means the last run wasn't in per-statement mode (or there was none).
    if (!statements || statements.length === 0)
    {
      return html`
        <div class="empty">
          <wa-icon library="lucide" name="timer"></wa-icon>
          <p>No per-statement timings.</p>
          <p class="hint">Enable the <strong>per-statement</strong> checkbox next to the Run button, then run the script.</p>
        </div>
      `;
    }

    const totalMs = statements.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    // Slowest first; keep original index so we can show source order too.
    const ranked = statements
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (b.s.duration ?? 0) - (a.s.duration ?? 0));

    return html`
      <div class="summary">
        <span>${statements.length} statements</span>
        <span class="total">${this._formatDuration(totalMs)} total</span>
      </div>

      <div class="rows">
        ${ranked.map(({ s }) => this._renderRow(s))}
      </div>
    `;
  }

  private _renderRow(s: ScriptStatementResult)
  {
    const isError = s.status === 'error';
    const perc = Math.max(0, Math.min(100, s.durationPerc ?? 0));
    const lineLabel = (s.lineStart != null && s.lineEnd != null && s.lineEnd !== s.lineStart)
      ? `L${s.lineStart}–${s.lineEnd}`
      : `L${s.lineStart ?? '?'}`;

    return html`
      <div class="row ${isError ? 'row-error' : ''}">
        <span class="line">${lineLabel}</span>
        <span class="code" title=${s.code ?? ''}>${this._snippet(s.code)}</span>
        <span class="bar-wrap">
          <span class="bar" style="width:${perc}%"></span>
        </span>
        <span class="perc">${perc}%</span>
        <span class="dur">${this._formatDuration(s.duration)}</span>
        ${isError ? html`<wa-icon class="err-icon" library="lucide" name="circle-x" title=${s.message ?? 'error'}></wa-icon>` : null}
      </div>
    `;
  }

  // ── 4. Behaviour & Methods ──
  /** First non-empty line of a statement, trimmed to keep rows single-line. */
  private _snippet(code?: string): string
  {
    if (!code) return '';
    const firstLine = code.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
    return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  }

  private _formatDuration(ms?: number): string
  {
    if (ms == null) return '—';
    if (ms >= 1) return `${Math.round(ms)}ms`;
    if (ms >= 0.01) return `${ms.toFixed(2)}ms`;
    return '<0.01ms';
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      background: var(--color-bg-elevated);
      overflow: hidden;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
    }

    *, *::before, *::after { box-sizing: border-box; }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      height: 100%;
      padding: 1rem 1.5rem;
      text-align: center;
      color: var(--color-text);
    }

    .empty wa-icon { font-size: 1.6rem; opacity: 0.5; }
    .empty p { margin: 0; }
    .empty .hint { font-size: var(--text-xs); color: var(--color-gray-dark); }

    .summary {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 10px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--color-border);
      font-size: var(--text-xs);
      color: var(--color-text);
    }

    .summary .total { font-weight: 600; }

    .rows {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) 70px 34px auto auto;
      align-items: center;
      gap: 8px;
      padding: 0.2rem 0.6rem;
      font-size: 0.72rem;
      border-left: 2px solid transparent;
    }

    .row:hover { background: color-mix(in srgb, var(--color-border) 25%, transparent); }
    .row-error { border-left-color: #ef4444; background: color-mix(in srgb, #ef4444 6%, transparent); }

    .line {
      color: var(--color-gray-dark);
      font-family: var(--font-mono, monospace);
      white-space: nowrap;
    }

    .code {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--color-text);
      font-family: var(--font-mono, monospace);
    }

    .bar-wrap {
      height: 8px;
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
      border-radius: var(--radius-full);
      overflow: hidden;
    }

    .bar {
      display: block;
      height: 100%;
      background: var(--color-primary);
      border-radius: var(--radius-full);
    }

    .row-error .bar { background: #ef4444; }

    .perc, .dur {
      text-align: right;
      white-space: nowrap;
      color: var(--color-text);
      font-variant-numeric: tabular-nums;
    }

    .dur { font-weight: 600; }

    .err-icon { color: #ef4444; font-size: 0.8rem; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-profiling-tool': EditorProfilingTool;
  }
}
