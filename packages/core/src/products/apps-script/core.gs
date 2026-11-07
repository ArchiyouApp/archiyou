/**
 *  core.gs — the URBUILD library, the part of the core sheet URBUILD_DATABASE_CORE: its buttons
 *  "Bouwerssheet aanmaken" and "Naar de offerte publiceren", and what a builder sheet reads from it.
 *
 *  The core is the source of the products, the operations and the components. A builder works in
 *  their own sheet, a copy of URBUILD_BOUWER_BASE (settings.builder_template) that URBUILD owns and
 *  shares with them. That copy holds the core's data as it was, not linked: the builder changes what
 *  they want, and fetches the core's again with the buttons of its tab update (builder.gs).
 *
 *  Prices go one way: a builder publishes to the core (tabs bouwersprijzen and bouwers), and URBUILD
 *  publishes those to the offer (URBUILD_CLIENT_OFFER_TEMPLATE, settings.offer_sheet), with the core's
 *  CO2 and Rc per component. URBUILD itself is a builder with a sheet of its own.
 *
 *  What a builder sheet gets from the core: a row per component of the core (seedComponent()) with
 *  its size, the core's material per unit, the hours per phase and the core's price per unit as a
 *  reference. The builder does the hours; the material is the core's, unless they give their own.
 */

/** The input columns of the builder's componenten tab, A..I in this order. */
const BUILDER_INPUTS = ['component', 'gebouwdeel', 'groep', 'naam (in de offerte)', 'variant van', 'breedte (mm)', 'hoogte (mm)',
  'diepte (mm)', 'eenheid'];

/** The columns of the core's componenten header that the seed reads, found by the start of their name. */
function coreColumns(header)
{
  const find = (start) => header.findIndex((h) => String(h).trim().toLowerCase().startsWith(start));
  const cols = {
    component: find('component'), gebouwdeel: find('gebouwdeel'), groep: find('componentgroep'), naam: find('naam'),
    breedte: find('representatieve breedte'), hoogte: find('representatieve hoogte'), diepte: find('representatieve diepte'),
    maat: find('representatieve maat'), eenheid: find('eenheid maat'), fase: find('fase'), product: find('product'), omschrijving: find('omschrijving'),
    prijseenheid: find('prijseenheid'), eenheidsprijs: find('eenheidsprijs'), hoeveelheid: find('hoeveelheid in prijseenheid'),
    materiaal: find('materiaalkosten'), totaal: find('totale kosten'),
  };
  PHASES.forEach((p) => { cols[p] = header.findIndex((h) => new RegExp(`^${p}s?kosten`).test(String(h).trim().toLowerCase())); });
  const missing = Object.entries(cols).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length > 0) throw new Error(`componenten: kolommen niet gevonden: ${missing.join(', ')}`);
  return cols;
}

/** The component blocks of the core's componenten rows (below the header): per block its size, its
 *  product lines (the rows of fase materiaal: an operation names its product too), its labour cost
 *  per phase (TOTAAL row) and its price per unit incl. margins. */
function coreBlocks(header, rows)
{
  const c = coreColumns(header);
  return rows.reduce((blocks, r) =>
  {
    if (text(r[c.component]) !== '')
    {
      blocks.push({ id: text(r[c.component]), gebouwdeel: text(r[c.gebouwdeel]), groep: text(r[c.groep]), naam: text(r[c.naam]),
        breedte: num(r[c.breedte]), hoogte: num(r[c.hoogte]), diepte: num(r[c.diepte]), maat: num(r[c.maat]), eenheid: text(r[c.eenheid]) || 'm2',
        lines: [], costs: null, baseline: null });
    }
    const block = blocks[blocks.length - 1];
    if (!block) return blocks;
    const omschrijving = text(r[c.omschrijving]);
    if (/^TOTAAL/i.test(omschrijving))
    {
      block.costs = Object.fromEntries(PHASES.map((p) => [p, num(r[c[p]])]));
      block.costs.material = num(r[c.materiaal]);
    }
    else if (block.costs && block.baseline === null && /^per (m2|st|stuk)\b.*incl/i.test(omschrijving))
    {
      block.baseline = num(r[c.totaal]);
    }
    else if (!block.costs && text(r[c.fase]).toLowerCase() === 'materiaal' && text(r[c.product]) !== '')
    {
      block.lines.push({ product: text(r[c.product]), omschrijving, unit: text(r[c.prijseenheid]), price: num(r[c.eenheidsprijs]),
        qty: num(r[c.hoeveelheid]), material: num(r[c.materiaal]) });
    }
    return blocks;
  }, []);
}

/** The label of each product of the core (tables.producten: header, rows), by its id: productLabel(). */
function productLabels(header, rows)
{
  const id = header.findIndex((h) => text(h) === 'product_id');
  return new Map(rows.filter((r) => text(r[id]) !== '')
    .map((r) => [text(r[id]), productLabel(Object.fromEntries(header.map((h, i) => [text(h), r[i]])))]));
}

/** The builder row of one core block: its inputs, the core's material per unit of the component (excl.
 *  margins, incl. waste), the hours per phase for the representative element (the core's labour cost
 *  at `rate`), the core's price per unit incl. margins, and the products as the offer names them
 *  (`labels`: product id → label). Returns also what to check. */
function seedComponent(block, labels, rate)
{
  const notes = [];
  const unit = block.eenheid === 'st' ? 'st' : 'm2';
  // The size the builder sheet divides by, from the inputs: m2 of breedte x hoogte, or 1 piece.
  const size = unit === 'st' ? 1 : block.breedte * block.hoogte / 1000000;
  const maat = block.maat > 0 ? block.maat : size;
  if (block.maat > 0 && size > 0 && Math.abs(size - block.maat) > 0.01 * block.maat)
  {
    notes.push(`maat ${size} ${unit} uit breedte en hoogte tegen ${block.maat} in het core-sheet: de uren per eenheid wijken af`);
  }
  if (!block.costs) notes.push('geen TOTAAL-regel: uren op 0');
  const material = block.costs ? block.costs.material : block.lines.reduce((s, l) => s + l.material, 0);
  const hours = PHASES.map((p) => (block.costs && rate > 0 ? Math.round(block.costs[p] / rate * 100) / 100 : 0));
  const names = block.lines.map((l) => labels.get(l.product) || l.product);
  return {
    id: block.id,
    inputs: [block.id, block.gebouwdeel, block.groep, block.naam, '', block.breedte || '', block.hoogte || '', block.diepte || '', unit],
    material: maat > 0 ? Math.round(material / maat * 10000) / 10000 : '',
    hours,
    baseline: block.baseline,
    omschrijving: names.filter((n, i) => names.indexOf(n) === i).join(', '),
    notes,
  };
}

/** The offer's BOUWERSPRIJZEN from the core's: its fixed rows ("alle") kept, then every builder's
 *  rows, with the core's CO2 and Rc where the component is the core's. */
function offerPriceRows(offerRows, coreRows, specs)
{
  return [...offerRows.filter((r) => text(r[0]) === 'alle'), ...withSpecs(coreRows.filter((r) => text(r[0]) !== ''), specs)];
}

/** The builders whose prices are no longer valid on `today`: "geldig tot" (the last column) before it. */
function expiredBuilders(builderRows, today)
{
  return builderRows
    .filter((r) => text(r[0]) !== '' && r[r.length - 1] instanceof Date && r[r.length - 1] < today)
    .map((r) => text(r[0]));
}

//// GOOGLE ////

/** What a builder sheet takes from the core, read once: the seeds of its component rows. */
function coreSnapshot(core)
{
  const products = core.getRangeByName('tables.producten').getValues();
  const all = core.getSheetByName('componenten').getDataRange().getValues();
  const headerAt = all.findIndex((r) => text(r[0]).toLowerCase() === 'component');
  const [header, rows] = [all[headerAt], all.slice(headerAt + 1)];
  const labels = productLabels(products[0], products.slice(1));
  const rate = num(named(core, 'settings.rate_labor'));
  return { seeds: coreBlocks(header, rows).map((b) => seedComponent(b, labels, rate)) };
}

/** The Archiyou menu of the core sheet: the functions of core-sheet.gs. */
function onOpenCore()
{
  SpreadsheetApp.getUi().createMenu('Archiyou')
    .addItem('Bouwerssheet aanmaken', 'bouwerssheetAanmaken')
    .addItem('Naar de offerte publiceren', 'naarOffertePubliceren')
    .addToUi();
}

/** Button: a builder sheet for a new builder. A copy of the template, next to it, with the core's
 *  data as it is now; shared with the builder (edit), who also gets edit access to this core sheet:
 *  their sheet fetches the core's data from it and publishes its prices to it. */
function createBuilderSheet()
{
  const ui = SpreadsheetApp.getUi();
  const core = SpreadsheetApp.getActive();
  const name = ui.prompt('Bouwerssheet aanmaken', 'Naam van de bouwer (zo heet hij in de offerte):', ui.ButtonSet.OK_CANCEL);
  if (name.getSelectedButton() !== ui.Button.OK || !name.getResponseText().trim()) return;
  const alias = name.getResponseText().trim();
  const mail = ui.prompt('Bouwerssheet aanmaken', 'E-mail van de bouwer (krijgt bewerkrechten op zijn sheet en op dit core-sheet; leeg = niet delen):', ui.ButtonSet.OK_CANCEL);
  if (mail.getSelectedButton() !== ui.Button.OK) return;
  const template = text(named(core, 'settings.builder_template'));
  if (!template)
  {
    ui.alert('Vul op instellingen eerst "sjabloon bouwerssheet" (settings.builder_template) in.');
    return;
  }

  const source = DriveApp.getFileById(SpreadsheetApp.openByUrl(template).getId());
  const parents = source.getParents();
  const copy = parents.hasNext() ? source.makeCopy(`URBUILD_BOUWER_${alias}`, parents.next()) : source.makeCopy(`URBUILD_BOUWER_${alias}`);
  const book = SpreadsheetApp.openById(copy.getId());
  const snapshot = coreSnapshot(core);
  const seeded = writeSeeds(book, snapshot.seeds, { overwrite: true });
  writeBuilderSettings(book, core, alias);
  setNamed(book, 'settings.updated_components', new Date());
  const email = mail.getResponseText().trim();
  if (email)
  {
    copy.addEditor(email);
    DriveApp.getFileById(core.getId()).addEditor(email);
  }
  ui.alert(`Bouwerssheet aangemaakt: ${book.getUrl()}`
    + (seeded.notes.length ? `\n\nNakijken:\n${seeded.notes.join('\n')}` : ''));
}

/** Button: the prices the builders published to this sheet (tabs bouwersprijzen and bouwers) to the
 *  offer, with the core's CO2 and Rc as they are now. The offer's fixed rows ("alle") stay. */
function publishToOffer()
{
  const ui = SpreadsheetApp.getUi();
  const core = SpreadsheetApp.getActive();
  const url = text(named(core, 'settings.offer_sheet'));
  if (!url)
  {
    ui.alert('Vul op instellingen eerst "offerte-sheet" (settings.offer_sheet) in.');
    return;
  }
  const coreBuilders = core.getSheetByName('bouwers');
  const builderWidth = coreBuilders.getLastColumn();
  const builders = dataRows(coreBuilders, CORE_FIRST_ROW, builderWidth).filter((r) => text(r[0]) !== '');
  const prices = dataRows(core.getSheetByName('bouwersprijzen'), CORE_FIRST_ROW, PRICE_HEADER.length).filter((r) => text(r[0]) !== '');
  if (prices.length === 0)
  {
    ui.alert('Er zijn nog geen bouwersprijzen: een bouwer publiceert ze vanuit zijn bouwerssheet (tabblad publiceer prijzen).');
    return;
  }
  const expired = expiredBuilders(builders, new Date());
  const names = builders.map((r) => `${text(r[0])} (${prices.filter((p) => text(p[0]) === text(r[0])).length} componenten)`);
  const ok = ui.alert('Naar de offerte publiceren', `${names.join('\n')}`
    + (expired.length ? `\n\nNiet meer geldig: ${expired.join(', ')}. Toch publiceren?` : ''), ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  const offer = SpreadsheetApp.openByUrl(url);
  const target = offer.getSheetByName('BOUWERSPRIJZEN');
  const rows = offerPriceRows(dataRows(target, OFFER_FIRST_ROW, PRICE_HEADER.length), prices, coreSpecs(core));
  writeRows(target, OFFER_FIRST_ROW, rows, PRICE_HEADER.length);
  writeRows(offer.getSheetByName('BOUWERS'), OFFER_FIRST_ROW, builders, builderWidth);
  ui.alert(`${rows.length} prijzen van ${builders.length} bouwer(s) gepubliceerd in ${offer.getName()}.`);
}
