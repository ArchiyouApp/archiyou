import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { executionResult } from '@archiyou/editor/src/state/workspace';
import type { ComputedFooterRow, CellStyle, TableStyle } from '@archiyou/core/src/calc/types';
import { formatNumber } from '@archiyou/core/src/calc/numfmt';
import { cellStyleOf } from '@archiyou/core/src/calc/style';

type DataRow = Record<string, any>;
type TableData = { rows: DataRow[]; footer: ComputedFooterRow[]; style?: TableStyle };
type TableMap = Record<string, TableData>;

/** Gives each distinct cell look a class name and collects the CSS for them */
class StyleClasses
{
  private _byKey = new Map<string, string>();
  private _rules: string[] = [];

  /** The class for a style ('' for none); widths in px */
  get(style: CellStyle & { width?: number } | undefined, numeric = false): string
  {
    const decls = styleDeclarations(style ?? {}, numeric);
    if (decls.length === 0) return '';
    const key = decls.join(';');
    if (!this._byKey.has(key))
    {
      const name = `s${this._byKey.size}`;
      this._byKey.set(key, name);
      // doubled class to win over the default th/td/tfoot rules
      this._rules.push(`.${name}.${name} { ${key} }`);
    }
    return this._byKey.get(key)!;
  }

  css(): string
  {
    return this._rules.join('\n');
  }
}

/** CSS declarations for a cell style. Colours are checked, as they come from the script or a sheet. */
function styleDeclarations(style: CellStyle & { width?: number }, numeric: boolean): string[]
{
  const color = (c?: string) => (c && /^#[0-9a-f]{3,8}$/i.test(c)) ? c : undefined;
  const fill = color(style.fill);
  // text on a fill without its own colour: pick dark or light so it stays readable in dark mode too
  const text = color(style.color) ?? (fill ? contrastText(fill) : undefined);
  const align = style.align ?? (numeric ? 'right' : undefined);
  return [
    fill ? `background: ${fill}` : '',
    text ? `color: ${text}` : '',
    style.bold === true ? 'font-weight: 600' : style.bold === false ? 'font-weight: 400' : '',
    style.italic ? 'font-style: italic' : '',
    (align && ['left', 'center', 'right'].includes(align)) ? `text-align: ${align}` : '',
    (typeof style.width === 'number' && style.width > 0) ? `min-width: ${Math.round(style.width)}px` : '',
  ].filter(Boolean);
}

/** The locale if the runtime knows it, else undefined (the viewer's own) */
function validLocale(locale?: string): string | undefined
{
  if (!locale) return undefined;
  try
  {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : undefined;
  }
  catch
  {
    return undefined;
  }
}

/** Black or white text, whichever reads better on a '#rrggbb' fill */
function contrastText(fill: string): string
{
  const hex = fill.length <= 5 ? [...fill.slice(1, 4)].map(c => c + c).join('') : fill.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.55 ? '#1a1a1a' : '#ffffff';
}

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

    const { rows, footer, style } = tableMap[selected] ?? { rows: [], footer: [] };
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    // a table with a style (from a sheet or Table.style()) shows that look instead of the striping
    const classes = new StyleClasses();
    this._tableCss = classes;
    const cell = (value: any, cellStyle: CellStyle | undefined, extra = '') =>
    {
      const formatted = (cellStyle?.format) ? formatNumber(value, cellStyle.format, validLocale(style?.locale)) : null;
      const cls = [classes.get(cellStyle, !!style && typeof value === 'number'), extra].filter(Boolean).join(' ');
      return html`<td class=${cls} title=${String(value ?? '')}>${formatted ?? value ?? ''}</td>`;
    };

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
            <table class=${style ? 'styled' : ''}>
              <thead>
                <tr>
                  ${columns.map(col => html`<th class=${classes.get({ ...(style?.header ?? {}), width: style?.columns?.[col]?.width })}>${col}</th>`)}
                </tr>
              </thead>
              <tbody>
                ${rows.map((row, i) => html`
                  <tr>
                    ${columns.map(col => cell(row[col], style ? cellStyleOf(style, i, col) : undefined))}
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
                          // footers take the column's number format and alignment, and their own fill
                          const { fill, color, bold, italic, ...colLook } = style?.columns?.[col] ?? {};
                          return cell(val, { ...colLook, width: undefined, fill: fRow.fill } as CellStyle, fRow.bold !== false ? 'footer-bold' : '');
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
  override firstUpdated()
  {
    // the table's own look goes in a sheet of its own, so cells need no inline styles
    this.shadowRoot!.adoptedStyleSheets = [...this.shadowRoot!.adoptedStyleSheets, this._styleSheet];
  }

  override updated()
  {
    const css = this._tableCss?.css() ?? '';
    if (css !== this._appliedCss)
    {
      this._styleSheet.replaceSync(css);
      this._appliedCss = css;
    }

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
  private _styleSheet = new CSSStyleSheet();
  private _tableCss: StyleClasses | null = null;
  private _appliedCss = '';

  private _buildTableMap(): TableMap
  {
    const outputs = executionResult.get()?.outputs ?? [];
    return outputs
      .filter(o => o.path.category === 'tables' && o.path.pipeline === 'default' && Array.isArray(o.output))
      .reduce<TableMap>((map, o) =>
      {
        const name = o.path.entityName ?? 'table';
        map[name] = {
          rows: o.output as DataRow[],
          footer: (o.footer ?? []) as ComputedFooterRow[],
          style: o.style,
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

    table:not(.styled) tbody tr:nth-child(even) td { background: var(--color-neutral-50, #f8fafc); }

    table:not(.styled) tbody tr:hover td
    {
      background: color-mix(in srgb, var(--color-primary) 6%, transparent);
    }

    /* A styled table shows its own fills: no striping, and the hover tints over the fill */
    table.styled tbody tr:hover td
    {
      box-shadow: inset 0 0 0 9999px color-mix(in srgb, var(--color-primary) 8%, transparent);
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

