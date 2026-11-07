/**
 *  common.gs — the URBUILD library (Apps Script), shared part. See core.gs and builder.gs.
 *
 *  One standalone Apps Script project "URBUILD" holds common.gs, core.gs and builder.gs. The core
 *  sheet and the builder template each have a short bound script (core-sheet.gs, builder-sheet.gs)
 *  that adds the library under the identifier URBUILD and calls it: a fix is made once, in the library.
 *
 *  Install, once:
 *   1. script.google.com → New project "URBUILD"; add the files common.gs, core.gs, builder.gs
 *      (File → New → Script, names without .gs) and paste them. Save.
 *   2. Deploy → New deployment → type Library → Deploy. Share the project with the builders (view),
 *      so their sheets can load it. Project settings → copy the Script ID.
 *   3. In URBUILD_DATABASE_CORE: Extensions → Apps Script → Libraries + → paste the Script ID,
 *      identifier URBUILD, the latest version → Add. Replace the code with core-sheet.gs. Save.
 *   4. The same in URBUILD_BOUWER_BASE with builder-sheet.gs. A builder sheet is a copy of it, so it
 *      takes its script and the library along.
 *   5. Reload the sheets: the menu Archiyou appears. A button is a drawing (Insert → Drawing) with
 *      "Assign script": the function names in core-sheet.gs and builder-sheet.gs.
 *  A new library version: Deploy → Manage deployments → edit → New version, then in each bound script
 *  Libraries → URBUILD → that version (or leave the core's on "HEAD" while developing).
 *
 *  The functions above GOOGLE are plain JavaScript, tested in tests/unit/products/apps-script.test.ts.
 */

const CATEGORIES = ['material', 'onsite', 'voorbewerking', 'assemblage', 'montage', 'afbouw'];
const SURCHARGES = ['projectkosten', 'bouwplaats', 'bedrijfskosten', 'risico', 'winst', 'btw'];
const PHASES = ['onsite', 'voorbewerking', 'assemblage', 'montage', 'afbouw'];
const LINEAR = ['balk', 'paal', 'profiel'];
const SHEET = ['plaat', 'mat', 'rol', 'baan', 'laag', 'pan'];

/** The price list of builders, the same 21 columns in the core (bouwersprijzen) and the offer
 *  (BOUWERSPRIJZEN): per component its price per unit by cost category, then CO2, Rc and hours. */
const PRICE_HEADER = ['bouwer', 'prijspeil', 'gebouwdeel', 'groep', 'component', 'naam', 'omschrijving', 'eenheid',
  'materiaal', 'onsite', 'voorbewerking', 'assemblage', 'montage', 'afbouw', 'totaal per eenheid', 'totaal per m3',
  'GWP A1-A3 per eenheid', 'GWP A4-C4 per eenheid', 'Rc', 'uren per eenheid', 'uren per m3'];
/** Per builder (core: bouwers, offer: BOUWERS): the date, the scenarios offered, the surcharges in %,
 *  the DIY factor and how long the prices are valid. The scenarios are those of the sheet's header. */
const BUILDER_HEADER_END = [...SURCHARGES, 'doe-het-zelf factor', 'geldig tot'];

/** The first data row in the core's tabs bouwersprijzen and bouwers (title, header above it). */
const CORE_FIRST_ROW = 3;
/** The first data row of the offer's BOUWERSPRIJZEN and BOUWERS (title, notes and header above it). */
const OFFER_FIRST_ROW = 6;

const text = (v) => String(v === undefined || v === null ? '' : v).trim();
const num = (v) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : 0);

/** A number for a cell of a price list, else blank. */
function numberOrBlank(v)
{
  return (v === '' || v === null || v === undefined || !Number.isFinite(Number(v))) ? '' : Number(v);
}

/** A product as a specification names it: its type up to the first comma outside brackets, and the
 *  size that tells it apart ('SLS-regel 38x235', 'Houtvezel buitenplaat 16 mm'). */
function productLabel(row)
{
  const type = String(row.type || row.product_id || '').replace(/\([^)]*\)/g, (m) => m.replace(/,/g, '\u0000'))
    .split(',')[0].replace(/\u0000/g, ',').trim();
  const vorm = String(row.vorm || '').trim().toLowerCase();
  const size = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const section = [row.dikte, row.breedte, row.hoogte].map(size).filter((v) => v !== null).sort((a, b) => a - b);
  const label = LINEAR.includes(vorm) && section.length === 2 ? section.map(Math.round).join('x')
    : SHEET.includes(vorm) && size(row.dikte) ? `${size(row.dikte)} mm` : '';
  return label ? `${type} ${label}` : type;
}

/** The data rows of a tab with this builder's rows replaced: the others kept in their order. */
function mergeRows(existing, alias, fresh)
{
  return [...existing.filter((r) => text(r[0]) !== '' && text(r[0]) !== alias), ...fresh];
}

/** CO2 and Rc of the core's components, per component id: { gwp: [A1-A3, A4-C4], rc }, per unit. */
function withSpecs(rows, specs)
{
  const at = (name) => PRICE_HEADER.indexOf(name);
  return rows.map((r) =>
  {
    const spec = specs.get(text(r[at('component')]));
    if (!spec) return r;
    const row = r.slice();
    row[at('GWP A1-A3 per eenheid')] = numberOrBlank(spec.gwp[0]);
    row[at('GWP A4-C4 per eenheid')] = numberOrBlank(spec.gwp[1]);
    row[at('Rc')] = numberOrBlank(spec.rc);
    return row;
  });
}

//// GOOGLE ////

/** The core's CO2 and Rc per component: its named ranges outputs.<id>.gwp (3 cells) and .rc. */
function coreSpecs(core)
{
  const names = core.getNamedRanges().map((r) => r.getName());
  return new Map(names
    .map((n) => (n.match(/^outputs\.([^.]+)\.gwp$/) || [])[1])
    .filter(Boolean)
    .map((id) => [id, {
      gwp: core.getRangeByName(`outputs.${id}.gwp`).getValues()[0],
      rc: names.includes(`outputs.${id}.rc`) ? core.getRangeByName(`outputs.${id}.rc`).getValue() : '',
    }]));
}

/** The data rows of a tab, `width` columns from `firstRow` on, up to its last row. */
function dataRows(sheet, firstRow, width)
{
  const last = sheet.getLastRow();
  return last < firstRow ? [] : sheet.getRange(firstRow, 1, last - firstRow + 1, width).getValues();
}

/** Write the data rows of a tab from `firstRow` on, and clear what was below them. */
function writeRows(sheet, firstRow, rows, width)
{
  const old = dataRows(sheet, firstRow, width);
  if (old.length > 0) sheet.getRange(firstRow, 1, old.length, width).clearContent();
  if (rows.length > 0) sheet.getRange(firstRow, 1, rows.length, width).setValues(rows);
}

/** Replace this builder's rows in a tab, keep the others. */
function replaceRows(sheet, firstRow, alias, fresh, width)
{
  writeRows(sheet, firstRow, mergeRows(dataRows(sheet, firstRow, width), alias, fresh), width);
}

/** The value of a named range, or null when the sheet has none. */
function named(book, name)
{
  const range = book.getRangeByName(name);
  return range ? range.getValue() : null;
}

/** Set a named range when the sheet has it. */
function setNamed(book, name, value)
{
  const range = book.getRangeByName(name);
  if (range) range.setValue(value);
}
