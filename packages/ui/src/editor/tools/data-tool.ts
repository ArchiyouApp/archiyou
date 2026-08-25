import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { executionResult } from '@archiyou/editor/src/state/workspace';
import type { ComputedFooterRow } from '@archiyou/core/src/calc/types';

type DataRow = Record<string, any>;
type TableData = { rows: DataRow[]; footer: ComputedFooterRow[] };
type TableMap = Record<string, TableData>;

@customElement('editor-data-tool')
export class EditorDataTool extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const result = executionResult.get();

    if (!result)
    {
      return this._renderEmpty('database', 'Run the script to see table data');
    }

    const tableMap = this._buildTableMap();
    const tableNames = Object.keys(tableMap);

    if (tableNames.length === 0)
    {
      return this._renderEmpty('table', 'No tables in this script');
    }

    const selected = (this._selectedTable && tableNames.includes(this._selectedTable))
      ? this._selectedTable
      : tableNames[0];

    const { rows, footer } = tableMap[selected] ?? { rows: [], footer: [] };
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return html`
      <div class="toolbar">
        <wa-select
          class="table-select"
          .value=${selected}
          @change=${(e: Event) =>
          {
            this._selectedTable = ((e.target as HTMLElement & { value: string }).value);
          }}
        >
          ${tableNames.map(name => html`<wa-option value=${name}>${name}</wa-option>`)}
        </wa-select>
        <span class="row-count">${rows.length} row${rows.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="table-wrapper">
        ${columns.length === 0
          ? html`<p class="empty-msg">Table is empty</p>`
          : html`
            <table>
              <thead>
                <tr>
                  ${columns.map(col => html`<th>${col}</th>`)}
                </tr>
              </thead>
              <tbody>
                ${rows.map(row => html`
                  <tr>
                    ${columns.map(col => html`<td title=${String(row[col] ?? '')}>${row[col] ?? ''}</td>`)}
                  </tr>
                `)}
              </tbody>
              ${footer.length === 0
                ? ''
                : html`
                  <tfoot>
                    ${footer.map(fRow => html`
                      <tr class=${fRow.line ? 'footer-row footer-line' : 'footer-row'}>
                        ${columns.map(col =>
                        {
                          const val = fRow.values?.[col] ?? '';
                          return html`<td class=${fRow.bold !== false ? 'footer-bold' : ''} title=${String(val)}>${val}</td>`;
                        })}
                      </tr>
                    `)}
                  </tfoot>
                `}
            </table>
          `}
      </div>
    `;
  }

  // ── 2. State ──
  @state() private _selectedTable: string | null = null;
  @query('.table-select') private _select!: HTMLElement & { value: string };

  // ── 3. Lifecycle ──
  override updated()
  {
    const tableNames = Object.keys(this._buildTableMap());
    if (tableNames.length === 0) return;

    if (!this._selectedTable || !tableNames.includes(this._selectedTable))
    {
      this._selectedTable = tableNames[0];
    }

    // Keep wa-select in sync (its value can lag the slotted options on first paint)
    if (this._select && this._select.value !== this._selectedTable)
    {
      this._select.value = this._selectedTable;
    }
  }

  // ── 4. Behaviour & Methods ──
  private _buildTableMap(): TableMap
  {
    const outputs = executionResult.get()?.outputs ?? [];
    return outputs
      .filter(o => o.path.category === 'tables' && Array.isArray(o.output))
      .reduce<TableMap>((map, o) =>
      {
        const name = o.path.entityName ?? 'table';
        map[name] = {
          rows: o.output as DataRow[],
          footer: (o.footer ?? []) as ComputedFooterRow[],
        };
        return map;
      }, {});
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
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--color-text);
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

    /* ─── Toolbar ─── */
    .toolbar
    {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-xs) var(--space-sm);
      background: var(--color-gray);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .table-select { flex: 1; min-width: 0; font-size: var(--text-xs); --wa-font-size-medium: var(--text-xs); }

    .row-count
    {
      font-size: var(--text-xs);
      color: var(--color-gray-dark);
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ─── Table ─── */
    .table-wrapper
    {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    table
    {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-xs);
    }

    thead
    {
      position: sticky;
      top: 0;
      z-index: 1;
    }

    th
    {
      background: var(--color-neutral-100, #f1f5f9);
      color: var(--color-text);
      font-weight: 600;
      text-align: left;
      padding: 6px 10px;
      border-bottom: 2px solid var(--color-border);
      white-space: nowrap;
    }

    td
    {
      padding: 5px 10px;
      border-bottom: 1px solid var(--color-border);
      color: var(--color-text);
      white-space: nowrap;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    tbody tr:nth-child(even) td { background: var(--color-neutral-50, #f8fafc); }

    tbody tr:hover td
    {
      background: color-mix(in srgb, var(--color-primary) 6%, transparent);
    }

    /* ─── Footer (aggregations) ─── */
    tfoot td
    {
      background: var(--color-neutral-100, #f1f5f9);
      color: var(--color-text);
      white-space: nowrap;
    }

    tfoot tr.footer-line td
    {
      border-top: 2px solid var(--color-border);
    }

    tfoot td.footer-bold { font-weight: 600; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-data-tool': EditorDataTool;
  }
}
