/**
 *  builder.gs — the URBUILD library, the part of a builder sheet (a copy of URBUILD_BOUWER_BASE):
 *  the buttons of its tabs update ("Componenten bijwerken") and publiceer prijzen ("Prijzen publiceren").
 *
 *  A builder sheet is the builder's: its components are values, taken from the core (settings.core_sheet)
 *  when it was made. The material per unit is the core's (a builder may give their own price instead);
 *  the builder does the hours per phase.
 *   - Componenten bijwerken refreshes the core's material and reference price per component, adds the
 *     core's new components, and on request also refreshes the builder's rows of the core's components
 *     (size, hours, description) with the core's; the builder's own material prices stay;
 *   - Prijzen publiceren writes per component the price per unit by cost category, with the hours
 *     and the core's CO2 and Rc, to the core's tab bouwersprijzen, and the builder's date, scenarios,
 *     surcharges and "geldig tot" to the core's tab bouwers. URBUILD publishes them to the offer.
 *  The builder's name in the offer is settings.offer_alias.
 */

/** The first data row of the builder's componenten tab; a group row and the header above it. */
const BUILDER_FIRST_ROW = 3;

/** The columns of a builder sheet's tables.componenten that a price row takes, by header name;
 *  the optional ones may be missing. */
const COMPONENT_COLUMNS = { id: 'component', gebouwdeel: 'gebouwdeel', groep: 'groep', naam: 'naam (in de offerte)',
  unit: 'eenheid', omschrijving: 'omschrijving', costm3: 'totaal per m3' };
const OPTIONAL_COLUMNS = { base: 'variant van', hours: 'totale tijd (uur)', size: 'maat', volume: 'volume (m3)' };

/** The price rows (PRICE_HEADER) of a builder sheet, from its tables.componenten (header first): per
 *  component with an id, a group, a name and a price. The hours are the builder's (per unit and per
 *  m3 of the representative element); CO2 and Rc are the core's (`specs`, by component id: of the
 *  component it is a variant of). */
function componentRows(table, alias, date, specs)
{
  const [header, ...rows] = table;
  const at = (name) => header.findIndex((h) => text(h) === name);
  const col = Object.fromEntries(Object.entries({ ...COMPONENT_COLUMNS, ...OPTIONAL_COLUMNS }).map(([k, name]) => [k, at(name)]));
  const costCols = CATEGORIES.map(at);
  const missing = [...Object.values(COMPONENT_COLUMNS).filter((n) => at(n) < 0), ...CATEGORIES.filter((c, i) => costCols[i] < 0)];
  if (missing.length > 0) throw new Error(`tables.componenten mist de kolommen: ${missing.join(', ')}`);
  const cell = (r, k) => (col[k] < 0 ? '' : r[col[k]]);
  const per = (hours, size) => (num(hours) > 0 && num(size) > 0 ? num(hours) / num(size) : '');
  return rows
    .filter((r) => text(r[col.id]) !== '' && text(r[col.groep]) !== '' && text(r[col.naam]) !== '')
    .map((r) => ({ r, costs: costCols.map((i) => num(r[i])) }))
    .filter(({ costs }) => costs.reduce((sum, v) => sum + v, 0) > 0)
    .map(({ r, costs }) =>
    {
      const spec = (specs && specs.get(text(cell(r, 'base')) || text(r[col.id]))) || { gwp: [], rc: '' };
      return [alias, date, text(r[col.gebouwdeel]), text(r[col.groep]), text(r[col.id]), text(r[col.naam]),
        text(r[col.omschrijving]), text(r[col.unit]) === 'st' ? 'st' : 'm2', ...costs, costs.reduce((sum, v) => sum + v, 0),
        numberOrBlank(r[col.costm3]), numberOrBlank(spec.gwp[0]), numberOrBlank(spec.gwp[1]), numberOrBlank(spec.rc),
        per(cell(r, 'hours'), cell(r, 'size')), per(cell(r, 'hours'), cell(r, 'volume'))];
    });
}

/** The builder's row of the tab bouwers: the scenarios in the order of its header, the surcharges, the
 *  DIY factor (blank: the offer takes 1) and how long the prices are valid. */
function builderRow(alias, date, scenarios, offered, surcharges, diyFactor, validUntil)
{
  return [alias, date, ...scenarios.map((s) => offered[s] === true), ...SURCHARGES.map((k) => num(surcharges[k])),
    numberOrBlank(diyFactor), validUntil];
}

/** The scenarios of a tab bouwers, from its header: the columns between the date and the surcharges. */
function scenariosOf(header)
{
  const names = header.map(text);
  return names.slice(2, names.indexOf(SURCHARGES[0]));
}

/** Where each seed goes in the builder's componenten tab: the row of its id, else after the last row
 *  in use. `ids` are the tab's column A from BUILDER_FIRST_ROW on. Returns [{ row, seed, appended }] (1-based). */
function placeSeeds(ids, seeds)
{
  const clean = ids.map(text);
  const lastUsed = clean.reduce((last, v, i) => (v !== '' ? i : last), -1);
  return seeds.reduce((acc, seed) =>
  {
    const at = clean.indexOf(seed.id);
    const row = at >= 0 ? at : lastUsed + 1 + acc.filter((p) => p.appended).length;
    acc.push({ row: BUILDER_FIRST_ROW + row, seed, appended: at < 0 });
    return acc;
  }, []);
}

/** A short list for a dialog: the first `max` and how many more. */
function listed(ids, max)
{
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} en ${ids.length - max} meer`;
}

//// GOOGLE ////

/** Write the seeds into a builder sheet's componenten tab: the core's new components always, its
 *  others only with `overwrite`; the core's material and reference price of each always. The
 *  builder's own material price (column "eigen materiaal per eenheid") is never touched. */
function writeSeeds(book, seeds, options)
{
  const tab = book.getSheetByName('componenten');
  const ids = tab.getRange(BUILDER_FIRST_ROW, 1, Math.max(tab.getMaxRows() - BUILDER_FIRST_ROW + 1, 1), 1).getValues().map(([v]) => v);
  const header = tab.getRange(BUILDER_FIRST_ROW - 1, 1, 1, tab.getLastColumn()).getValues()[0].map(text);
  const at = (name) =>
  {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`componenten: kolom "${name}" niet gevonden`);
    return i + 1;
  };
  const [hoursAt, materialAt, baselineAt, descriptionAt] = ['uren onsite', 'URBUILD materiaal per eenheid', 'URBUILD per eenheid', 'omschrijving'].map(at);
  const placed = placeSeeds(ids, seeds);
  placed.forEach(({ row, seed, appended }) =>
  {
    if (appended || options.overwrite)
    {
      tab.getRange(row, 1, 1, BUILDER_INPUTS.length).setValues([seed.inputs]);
      tab.getRange(row, hoursAt, 1, PHASES.length).setValues([seed.hours]);
      tab.getRange(row, descriptionAt).setValue(seed.omschrijving);
    }
    tab.getRange(row, materialAt).setValue(seed.material);
    tab.getRange(row, baselineAt).setValue(seed.baseline === null ? '' : seed.baseline);
  });
  return {
    added: placed.filter((p) => p.appended).map((p) => p.seed.id),
    refreshed: options.overwrite ? placed.filter((p) => !p.appended).map((p) => p.seed.id) : [],
    notes: seeds.filter((s) => s.notes.length > 0).map((s) => `${s.id}: ${s.notes.join('; ')}`),
  };
}

/** The settings a new builder sheet takes from the core: rate, margins, surcharges, and the core itself. */
function writeBuilderSettings(book, core, alias)
{
  ['settings.rate_labor', 'settings.margin_material', 'settings.margin_labor',
    'outputs.opslagen.bouwplaats', 'outputs.opslagen.bedrijfskosten', 'outputs.opslagen.projectkosten',
    'outputs.opslagen.risico', 'outputs.opslagen.winst', 'outputs.opslagen.btw'].forEach((n) => setNamed(book, n, named(core, n)));
  setNamed(book, 'settings.core_sheet', core.getUrl());
  if (alias) setNamed(book, 'settings.offer_alias', alias);
}

/** The core sheet of this builder sheet (settings.core_sheet), or null after saying what is missing. */
function openCore(ui, book)
{
  const url = text(named(book, 'settings.core_sheet'));
  if (!url)
  {
    ui.alert('Vul op instellingen eerst het URBUILD core-sheet (settings.core_sheet) in.');
    return null;
  }
  return SpreadsheetApp.openByUrl(url);
}

/** The Archiyou menu of a builder sheet: the functions of builder-sheet.gs. */
function onOpenBuilder()
{
  SpreadsheetApp.getUi().createMenu('Archiyou')
    .addItem('Componenten bijwerken', 'componentenBijwerken')
    .addSeparator()
    .addItem('Prijzen publiceren', 'prijzenPubliceren')
    .addToUi();
}

/** Button: the core's material and reference prices, its new components, and on request its
 *  version of the components this sheet already has. */
function updateComponents()
{
  const ui = SpreadsheetApp.getUi();
  const book = SpreadsheetApp.getActive();
  const core = openCore(ui, book);
  if (!core) return;
  const answer = ui.alert('Componenten bijwerken', 'Het URBUILD-materiaal en de URBUILD-prijs per eenheid worden die van '
    + 'de core, en nieuwe componenten van de core komen erbij. Je eigen materiaalprijzen blijven staan.\n\nOok de componenten '
    + 'die je al hebt overschrijven met de core (maten, uren, omschrijving)?\n\nJa = overschrijven, Nee = laten zoals ze zijn.', ui.ButtonSet.YES_NO_CANCEL);
  if (answer === ui.Button.CANCEL || answer === ui.Button.CLOSE) return;
  const snapshot = coreSnapshot(core);
  const seeded = writeSeeds(book, snapshot.seeds, { overwrite: answer === ui.Button.YES });
  setNamed(book, 'settings.updated_components', new Date());
  ui.alert(`Componenten bijgewerkt.\n\nNieuw: ${seeded.added.length ? listed(seeded.added, 12) : 'geen'}`
    + (seeded.refreshed.length ? `\nOverschreven: ${seeded.refreshed.length}` : '')
    + (seeded.notes.length ? `\n\nNakijken:\n${seeded.notes.join('\n')}` : ''));
}

/** Button: this sheet's prices to the core (tabs bouwersprijzen and bouwers), under its name in the
 *  offer and valid until the date of the tab publiceer prijzen. */
function publishPrices()
{
  const ui = SpreadsheetApp.getUi();
  const book = SpreadsheetApp.getActive();
  const alias = text(named(book, 'settings.offer_alias'));
  const validUntil = named(book, 'settings.valid_until');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!alias)
  {
    ui.alert('Vul op instellingen eerst "naam in de offerte" in.');
    return;
  }
  if (!(validUntil instanceof Date) || validUntil < today)
  {
    ui.alert('Vul op publiceer prijzen een datum "geldig tot" in, vandaag of later.');
    return;
  }
  const core = openCore(ui, book);
  if (!core) return;
  const date = new Date();
  const rows = componentRows(book.getRangeByName('tables.componenten').getValues(), alias, date, coreSpecs(core));
  if (rows.length === 0)
  {
    ui.alert('Geen componenten met een groep, een naam en een prijs gevonden: er is niets gepubliceerd.');
    return;
  }
  const until = Utilities.formatDate(validUntil, Session.getScriptTimeZone(), 'd-M-yyyy');
  const ok = ui.alert('Prijzen publiceren', `${rows.length} componenten als "${alias}", geldig tot ${until}, naar het URBUILD core-sheet. `
    + 'URBUILD zet ze daarna in de offerte.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  const prices = core.getSheetByName('bouwersprijzen');
  const builders = core.getSheetByName('bouwers');
  const header = builders.getRange(CORE_FIRST_ROW - 1, 1, 1, builders.getLastColumn()).getValues()[0];
  const scenarios = scenariosOf(header);
  const offeredRange = book.getRangeByName('settings.offer_scenarios');
  const offered = Object.fromEntries((offeredRange ? offeredRange.getValues() : []).map(([name, on]) => [text(name), on === true]));
  const surcharges = Object.fromEntries(SURCHARGES.map((k) => [k, named(book, `outputs.opslagen.${k}`)]));
  const diy = named(book, 'settings.diy_factor') ?? named(core, 'settings.diy_factor');
  replaceRows(prices, CORE_FIRST_ROW, alias, rows, PRICE_HEADER.length);
  replaceRows(builders, CORE_FIRST_ROW, alias, [builderRow(alias, date, scenarios, offered, surcharges, diy, validUntil)], header.length);
  setNamed(book, 'settings.published_at', date);
  setNamed(book, 'settings.published_count', rows.length);
  ui.alert(`${rows.length} componenten gepubliceerd als "${alias}".`);
}
