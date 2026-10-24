# Sheet styling in tables: Data tool and xlsx export

| | |
|---|---|
| Dates | 2026-10-16 → 2026-10-24 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | Mark van der Net: asked for the sheet's look in the Data tool, added the xlsx export to the plan, reviewed the plan |
| Branch | `develop` (main repo), cloudcalc in the private modules repo |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-16 19:49 +0200  Can you come up with a way to take the styling of cloudcalc/google sheet workbooks and apply inside archiyou's data tool? It would be great that we can match the styling and looks a bit so its all a bit more presentable.
2026-10-16 19:54 +0200  (rejecting the first plan) Please do add exporting those styles. For now only in excel.
2026-10-16 20:48 +0200  Im trying urplan with google sheets integration. Looks good, but i see numbers like (1,000 - thousand) while the original sheet has 1.000 - Can you keep this consistent?
```

## Plan (agent output, reviewed by the human before implementation)

Tables from cloudcalc (Google Sheets / xlsx) reached the editor's Data tool as bare values, with the
Data tool's own striping. The sheet's look is carried through instead:

- **Core** (`packages/core/src/calc`): a `TableStyle` (`header`, `columns` with width, sparse per-row
  `cells` overrides) of `CellStyle`s (`fill`, `color`, `bold`, `italic`, `align`, `format` = an Excel
  number format). `Table.style()` get/set, kept through `sort()` and `setColumns()`, dropped per cell by
  `group()`. `calc.table(name, rows)` takes a `style` the rows array carries. `numfmt.ts`
  `formatNumber(value, format, locale)` for the common Excel formats (decimals, thousands, %, currency
  literals, negative sections, dates). The runner's json table output carries `style` next to `footer`.
- **Excel export** (added by the human to the plan): `Table.toExcel()` writes the style through
  write-excel-file (fill, text colour, bold, italic, alignment, number format, column widths). A file
  attached with `xlsx()` still wins.
- **Data tool**: formats values with `formatNumber` (raw value in the tooltip), gives every distinct cell
  look a class in a constructed stylesheet (no inline styles), drops the striping for a styled table and
  tints on hover with an inset shadow; footer `fill` is now shown; text on a fill gets a contrasting colour.
- **cloudcalc**: `src/xlsx/styles.ts` reads `styles.xml` (number formats, fonts, fills, cellXfs, theme
  colours with tint), the cells' `s` and `<cols>` widths; `tableStyle()` turns that into a TableStyle
  (most common look per column, differing cells as overrides). `LocalWorkbook.tableStyle()`, whole-tab
  tables carry `style`; the client puts it on the rows array (not enumerable, after the result cache) so
  `calc.table('x', wb.table('X'))` gets it without a script change.

Not read: borders, merged cells, conditional formatting, banding/table styles applied on top of cells.
A real Google export could not be fetched in the session; the parser follows the xlsx standard and is
tested on a hand-made stylesheet in the form Google writes.

## Review and decisions by the human
- Asked to add exporting the styles, for now only in Excel.
- Tested with ur_plan: numbers showed as 1,000 where the sheet shows 1.000. Added `TableStyle.locale`:
  cloudcalc takes it from the locale ids in the number formats (`[$€-413]` → nl-NL) and
  `cloudcalc.open(url, { locale })` sets it; the Data tool formats with it, else the viewer's locale.
- Asked for the commits on 2026-10-24, the one in the modules repo with the disclosure too.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| `9dc4a20` (modules repo) | cloudcalc: tables carry the sheet's look | all of the above |
| (this commit) | Tables keep the sheet's look | all of the above |
