/**
 *  publish-prices.gs — the button of a product sheet: "Archiyou → Prijzen publiceren naar de offerte".
 *
 *  Apps Script, bound to the product sheet (URHOUSE_MATERIALS_PRODUCTS_COMPONENTS, and every builder's
 *  copy of it: a copy takes its script along). Install once: Extensions → Apps Script, paste this file,
 *  save, reload the sheet. The first click asks the builder to allow it to edit spreadsheets.
 *
 *  A builder keeps their own calculation private. The button publishes only what an offer needs, under
 *  the builder's name in the offer (instellingen: settings.offer_alias), so a client compares builders
 *  without knowing who is who:
 *   - PRIJZEN: per component its gebouwdeel, group, name, unit, specification, and price per unit by
 *     cost category (incl. the builder's margins, excl. BTW and surcharges), and per m3
 *   - BOUWERS: the date of the prices, the scenarios the builder offers, the surcharges and BTW
 *  It replaces this builder's rows in the offer sheet (settings.offer_sheet) and leaves the others.
 *
 *  What it reads is the sheet's interface, by name: outputs.<component>.{costs, costm2|costst, costm3,
 *  gebouwdeel, groep, naam, producten}, outputs.opslagen.*, settings.offer_*, tables.producten.
 *  The specification follows core's ProductManager.prices() (packages/core/src/products/ProductManager.ts);
 *  the functions above GOOGLE are plain JavaScript, tested in tests/unit/products/publish-prices.test.ts.
 */

const CATEGORIES = ['material', 'onsite', 'voorbewerking', 'assemblage', 'montage', 'afbouw'];
const SURCHARGES = ['projectkosten', 'bouwplaats', 'bedrijfskosten', 'risico', 'winst', 'btw'];
const LINEAR = ['balk', 'paal', 'profiel'];
const SHEET = ['plaat', 'mat', 'rol', 'baan', 'laag', 'pan'];
/** The first data row of PRIJZEN and BOUWERS in the offer sheet; above it the title and the header. */
const FIRST_ROW = 6;

/** A product as a specification names it: its type up to the first comma outside brackets, and the
 *  size that tells it apart ('SLS-regel 38x235', 'Houtvezel buitenplaat 16 mm'). */
function productLabel(row)
{
  const type = String(row.type || row.product_id || '').replace(/\([^)]*\)/g, (m) => m.replace(/,/g, '\u0000'))
    .split(',')[0].replace(/\u0000/g, ',').trim();
  const vorm = String(row.vorm || '').trim().toLowerCase();
  const size = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const section = [row.dikte, row.breedte, row.hoogte].map(size).filter((v) => v !== null).sort((a, b) => a - b);
  const text = LINEAR.includes(vorm) && section.length === 2 ? section.map(Math.round).join('x')
    : SHEET.includes(vorm) && size(row.dikte) ? `${size(row.dikte)} mm` : '';
  return text ? `${type} ${text}` : type;
}

/** The components of the sheet: what has a cost per m3, a group and a name. */
function componentIds(names)
{
  const has = (n) => names.includes(n);
  return [...new Set(names.map((n) => (n.match(/^outputs\.([^.]+)\.costm3$/) || [])[1]).filter(Boolean))]
    .filter((c) => has(`outputs.${c}.groep`) && has(`outputs.${c}.naam`) && has(`outputs.${c}.costs`)
      && (has(`outputs.${c}.costm2`) || has(`outputs.${c}.costst`)));
}

/** The rows of PRIJZEN for one builder. `components` in the order of the sheet:
 *  { id, gebouwdeel, groep, naam, unit, costs: [6], costm3, producten: 'id, id' }. */
function priceRows(components, products, alias, date)
{
  const byId = new Map(products.map((p) => [String(p.product_id).trim(), p]));
  return components.map((c) =>
  {
    const omschrijving = [...new Set(String(c.producten || '').split(',').map((id) => id.trim())
      .filter((id) => byId.has(id)).map((id) => productLabel(byId.get(id))))].join(', ');
    const costs = CATEGORIES.map((_, i) => Number(c.costs[i]) || 0);
    const total = costs.reduce((sum, v) => sum + v, 0);
    return [alias, date, c.gebouwdeel, c.groep, c.id, c.naam, omschrijving, c.unit, ...costs, total, Number(c.costm3) || ''];
  });
}

/** The row of BOUWERS for one builder: the scenarios in the order of the offer sheet's header. */
function builderRow(alias, date, scenarios, offered, surcharges)
{
  return [alias, date, ...scenarios.map((s) => offered[s] === true), ...SURCHARGES.map((k) => Number(surcharges[k]) || 0)];
}

/** The data rows of a tab with this builder's rows replaced: the others kept in their order. */
function mergeRows(existing, alias, fresh)
{
  return [...existing.filter((r) => String(r[0]).trim() !== '' && String(r[0]).trim() !== alias), ...fresh];
}

//// GOOGLE ////

function onOpen()
{
  SpreadsheetApp.getUi().createMenu('Archiyou').addItem('Prijzen publiceren naar de offerte', 'publishPrices').addToUi();
}

function publishPrices()
{
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const value = (name) => { const r = ss.getRangeByName(name); return r ? r.getValue() : null; };
  const alias = String(value('settings.offer_alias') || '').trim();
  const url = String(value('settings.offer_sheet') || '').trim();
  if (!alias || !url)
  {
    ui.alert('Vul op instellingen eerst "naam in de offerte" en "offerte-sheet" in.');
    return;
  }

  const names = ss.getNamedRanges().map((r) => r.getName());
  const components = componentIds(names)
    .map((id) => ({
      id,
      row: ss.getRangeByName(`outputs.${id}.costm3`).getRow(),
      gebouwdeel: value(`outputs.${id}.gebouwdeel`),
      groep: value(`outputs.${id}.groep`),
      naam: value(`outputs.${id}.naam`),
      unit: names.includes(`outputs.${id}.costm2`) ? 'm2' : 'st',
      costs: ss.getRangeByName(`outputs.${id}.costs`).getValues()[0],
      costm3: value(`outputs.${id}.costm3`),
      producten: value(`outputs.${id}.producten`),
    }))
    .sort((a, b) => a.row - b.row);
  const [header, ...rows] = ss.getRangeByName('tables.producten').getValues();
  const products = rows.filter((r) => r[header.indexOf('product_id')])
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  const offeredRange = ss.getRangeByName('settings.offer_scenarios');
  const offered = Object.fromEntries((offeredRange ? offeredRange.getValues() : []).map(([name, on]) => [String(name).trim(), on === true]));
  const surcharges = Object.fromEntries(SURCHARGES.map((k) => [k, value(`outputs.opslagen.${k}`)]));
  const date = new Date();

  const offer = SpreadsheetApp.openByUrl(url);
  const prijzen = offer.getSheetByName('PRIJZEN');
  const bouwers = offer.getSheetByName('BOUWERS');
  const scenarios = bouwers.getRange(FIRST_ROW - 1, 3, 1, 4).getValues()[0].map((s) => String(s).trim());
  replaceRows(prijzen, alias, priceRows(components, products, alias, date));
  replaceRows(bouwers, alias, [builderRow(alias, date, scenarios, offered, surcharges)]);
  ui.alert(`${components.length} componenten gepubliceerd als "${alias}" in ${offer.getName()}.`);
}

/** Write a tab's data rows with this builder's replaced, and clear what is left below. */
function replaceRows(sheet, alias, fresh)
{
  const width = fresh[0].length;
  const last = Math.max(sheet.getLastRow(), FIRST_ROW);
  const existing = sheet.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, width).getValues();
  const rows = mergeRows(existing, alias, fresh);
  sheet.getRange(FIRST_ROW, 1, existing.length, width).clearContent();
  sheet.getRange(FIRST_ROW, 1, rows.length, width).setValues(rows);
}
