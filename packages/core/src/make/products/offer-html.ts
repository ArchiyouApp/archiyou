/**
 *  offer-html.ts — an offer as one flat HTML page for the client.
 *
 *  The offer is priced once, in the offer template (URBUILD_CLIENT_OFFER_TEMPLATE) that
 *  ProductManager.offer() computes; this file only reads it and lays it out. Two steps:
 *
 *   - offerPageData(source): the computed template's tables (tables.bouwkosten, tables.proces,
 *     tables.scenarios, tables.bouwers) and outputs (outputs.bouwkosten.*) → plain data: the
 *     ticked rows per section with their costs by category ('DIY' where the scenario leaves a
 *     category to the client), the totals, the process steps and options, who does what.
 *   - renderOfferHtml(data): that data → a page. Inline CSS, no scripts, no external files, so
 *     it can be mailed, put in a project's files, opened on a phone and printed on A4.
 *
 *  Dutch, like the template.
 */

//// TYPES ////

/** A cost of one category on an offer line: an amount, 'DIY' (the client does it) or nothing. */
export type OfferCost = number | 'DIY' | null;

export interface OfferLine
{
    onderdeel: string;
    type: string;
    specificatie: string;
    hoeveelheid: number | null;
    eenheid: string;
    prijs: number | null;
    costs: Array<OfferCost>;
    totaal: number | null;
}

export interface OfferSection
{
    titel: string;
    toelichting: string;
    lines: Array<OfferLine>;
}

export interface OfferProcesItem
{
    titel: string;
    prijs: number;
    conditie: string;
}

export interface OfferPageData
{
    titel: string;
    klant: string;
    notitie: string;
    datum: Date;
    bouwer: string;
    prijspeil: Date | null;
    scenario: string;
    /** The names of the cost categories, as the template's columns name them. */
    categories: Array<string>;
    sections: Array<OfferSection>;
    totals: { subtotaal: number, opslagen: number, totaal: number, exclBtw: number, btw: number, perM2: number | null, perM3: number | null, inclProces: number | null };
    proces: { items: Array<OfferProcesItem>, totaal: number | null };
    /** Per scenario which categories the builder delivers (the rest is DIY), in the template's order. */
    scenarios: { categories: Array<string>, names: Array<string>, delivers: Array<Array<boolean>> } | null;
    gebouw: Array<{ label: string, value: number, unit: string }>;
}

/** What offerPageData() reads: the computed template's tables and outputs, and the offer's inputs. */
export interface OfferSource
{
    bouwkosten: Array<Record<string, unknown>>;
    proces?: Array<Record<string, unknown>>;
    scenarios?: Array<Record<string, unknown>>;
    bouwers?: Array<Record<string, unknown>>;
    outputs: Record<string, any>;
    input: Record<string, any>;
}

export interface OfferPageOptions
{
    /** The page's title. Default: 'Offerte'. */
    titel?: string;
    /** Who the offer is for. */
    klant?: string;
    /** A note under the totals. */
    notitie?: string;
    /** The date on the offer. Default: today. */
    datum?: Date;
}

//// SETTINGS ////

/** The inputs of the template shown as the building's size, with their label and unit. */
const GEBOUW_INPUTS: Array<[string, string, string]> = [
    ['floorarea_net', 'Netto vloeroppervlak', 'm²'],
    ['floorarea_gross', 'Bruto vloeroppervlak', 'm²'],
    ['volume_net', 'Netto inhoud', 'm³'],
    ['storeys', 'Bouwlagen', ''],
];
const CATEGORY_LABELS: Record<string, string> = {
    material: 'Materiaal', onsite: 'Onsite', voorbewerking: 'Voorbewerking', assemblage: 'Assemblage', montage: 'Montage', afbouw: 'Afbouw',
};

//// DATA ////

const text = (v: unknown): string => String(v === undefined || v === null ? '' : v).trim();
const num = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const key = (row: Record<string, unknown>, start: string): string | undefined =>
    Object.keys(row).find(k => k.trim().toLowerCase().startsWith(start));

/** A date the sheet gives as a serial number (days since 1899-12-30), as a Date. */
export function sheetDate(v: unknown): Date | null
{
    if (v instanceof Date) return v;
    const n = num(v);
    if (n !== null) return n <= 0 ? null : new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
    const parsed = /^\d{4}-\d{2}-\d{2}/.test(text(v)) ? new Date(text(v)) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

/** The offer as data: see the file's comment. */
export function offerPageData(source: OfferSource, options: OfferPageOptions = {}): OfferPageData
{
    const rows = source.bouwkosten ?? [];
    const sample = rows.find(r => Object.keys(r).length > 0) ?? {};
    const keys = Object.keys(sample);
    const priceAt = keys.findIndex(k => k.trim().toLowerCase().startsWith('prijs per eenheid'));
    const totalAt = keys.findIndex(k => k.trim().toLowerCase().startsWith('totaal'));
    const categories = priceAt >= 0 && totalAt > priceAt ? keys.slice(priceAt + 1, totalAt) : [];
    const k = {
        aan: key(sample, 'aan') ?? keys[0], onderdeel: key(sample, 'onderdeel') ?? keys[1], type: key(sample, 'type'),
        spec: key(sample, 'specificatie'), qty: key(sample, 'kwantiteit'), unit: key(sample, 'eenheid'),
        price: keys[priceAt], total: keys[totalAt],
    };
    const cell = (r: Record<string, unknown>, name: string | undefined) => (name === undefined ? undefined : r[name]);

    // a number in column aan starts a section; true in it is a ticked row; a text below a section title explains it
    const sections = rows.reduce<Array<OfferSection>>((out, r) =>
    {
        const aan = cell(r, k.aan);
        const onderdeel = text(cell(r, k.onderdeel));
        if (typeof aan === 'number' && onderdeel)
        {
            out.push({ titel: onderdeel, toelichting: '', lines: [] });
        }
        else if (aan === true && out.length > 0)
        {
            out[out.length - 1]!.lines.push({
                onderdeel,
                type: text(cell(r, k.type)),
                specificatie: text(cell(r, k.spec)),
                hoeveelheid: num(cell(r, k.qty)),
                eenheid: text(cell(r, k.unit)),
                prijs: num(cell(r, k.price)),
                costs: categories.map(c => (text(r[c]).toUpperCase() === 'DIY' ? 'DIY' : num(r[c]))),
                totaal: num(cell(r, k.total)),
            });
        }
        else if (aan !== false && onderdeel && out.length > 0 && out[out.length - 1]!.lines.length === 0 && !out[out.length - 1]!.toelichting)
        {
            out[out.length - 1]!.toelichting = onderdeel;
        }
        return out;
    }, []).filter(s => s.lines.length > 0);

    const b = source.outputs?.['bouwkosten'] ?? {};
    const totaal = num(b['totaal']) ?? 0;
    const subtotaal = num(b['subtotaal']) ?? 0;
    const exclBtw = num(b['excl_btw']) ?? totaal;
    const inclProces = num(b['incl_proces']);

    const bouwer = text(source.input?.['bouwer']);
    const builder = (source.bouwers ?? []).find(r => text(r['bouwer']) === bouwer);
    const scenario = text(source.input?.['scenario']);

    return {
        titel: options.titel ?? 'Offerte',
        klant: options.klant ?? '',
        notitie: options.notitie ?? '',
        datum: options.datum ?? new Date(),
        bouwer,
        prijspeil: builder ? sheetDate(builder['prijspeil']) : null,
        scenario,
        categories,
        sections,
        totals: { subtotaal, opslagen: totaal - subtotaal, totaal, exclBtw, btw: totaal - exclBtw, perM2: num(b['per_m2']), perM3: num(b['per_m3']), inclProces },
        proces: procesData(source.proces ?? []),
        scenarios: scenarioData(source.scenarios ?? []),
        gebouw: GEBOUW_INPUTS
            .map(([name, label, unit]) => ({ label, unit, value: num(source.input?.[name]) }))
            .filter((g): g is { label: string, unit: string, value: number } => g.value !== null && g.value > 0),
    };
}

/** The process steps (a number in aan, their price on the description row right below) and the
 *  ticked options; subtotal and total rows are not items. */
function procesData(rows: Array<Record<string, unknown>>): { items: Array<OfferProcesItem>, totaal: number | null }
{
    const sample = rows.find(r => Object.keys(r).length > 0) ?? {};
    const keys = Object.keys(sample);
    const k = { aan: key(sample, 'aan') ?? keys[0], onderdeel: key(sample, 'onderdeel') ?? keys[1], prijs: key(sample, 'prijs incl'), conditie: key(sample, 'condities') };
    const get = (r: Record<string, unknown> | undefined, name: string | undefined) => (r === undefined || name === undefined ? undefined : r[name]);
    const blank = (v: unknown) => v === '' || v === undefined || v === null;
    const totalRow = rows.find(r => /^TOTAAL PROCESKOSTEN/i.test(text(get(r, k.onderdeel))));
    const items = rows.map((r, i): OfferProcesItem | null =>
    {
        const aan = get(r, k.aan);
        const titel = text(get(r, k.onderdeel));
        if (!titel || /totaal/i.test(titel)) return null;
        if (typeof aan === 'number')
        {
            const below = rows[i + 1];
            const priced = below !== undefined && blank(get(below, k.aan)) ? below : undefined;
            return { titel, prijs: num(get(priced, k.prijs)) ?? 0, conditie: text(get(priced, k.conditie)) };
        }
        return aan === true ? { titel, prijs: num(get(r, k.prijs)) ?? 0, conditie: text(get(r, k.conditie)) } : null;
    }).filter((i): i is OfferProcesItem => i !== null && i.prijs !== 0);
    return { items, totaal: totalRow ? num(get(totalRow, k.prijs)) : null };
}

/** Who does what per scenario: tables.scenarios has a row per category and a column per scenario. */
function scenarioData(rows: Array<Record<string, unknown>>): OfferPageData['scenarios']
{
    if (rows.length === 0) return null;
    const names = Object.keys(rows[0]!).filter(c => c.trim().toLowerCase() !== 'kosten');
    const kosten = Object.keys(rows[0]!).find(c => c.trim().toLowerCase() === 'kosten') ?? '';
    const used = rows.filter(r => text(r[kosten]) !== '');
    return {
        categories: used.map(r => text(r[kosten])),
        names,
        delivers: used.map(r => names.map(n => r[n] === true)),
    };
}

//// HTML ////

const escape = (v: unknown): string => text(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const EURO = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const EURO_ROUND = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 });
const euro = (v: number | null, round = false): string => (v === null ? '' : (round ? EURO_ROUND : EURO).format(v));
const day = (d: Date | null): string => (d ? d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' }) : '');
const label = (c: string): string => CATEGORY_LABELS[c.trim().toLowerCase()] ?? c;

/** The offer page: see the file's comment. */
export function renderOfferHtml(data: OfferPageData): string
{
    const costsOf = (l: OfferLine) => l.costs
        .map((c, i) => ({ c, name: data.categories[i] ?? '' }))
        .filter(({ c }) => c === 'DIY' || (c !== null && c !== 0))
        .map(({ c, name }) => `<span class="cost${c === 'DIY' ? ' diy' : ''}">${escape(label(name))} ${c === 'DIY' ? 'zelf' : euro(c as number)}</span>`)
        .join('');
    const line = (l: OfferLine) => `
        <tr>
          <td class="what"><strong>${escape(l.onderdeel)}</strong>${l.type ? ` · ${escape(l.type)}` : ''}
            ${l.specificatie ? `<div class="spec">${escape(l.specificatie)}</div>` : ''}
            <div class="costs">${costsOf(l)}</div></td>
          <td class="n">${l.hoeveelheid === null ? '' : `${NUMBER.format(l.hoeveelheid)} ${escape(l.eenheid)}`}</td>
          <td class="n">${euro(l.prijs)}</td>
          <td class="n total">${euro(l.totaal)}</td>
        </tr>`;
    const section = (s: OfferSection) => `
      <tbody>
        <tr class="section"><th colspan="4">${escape(s.titel)}${s.toelichting ? `<div class="note">${escape(s.toelichting)}</div>` : ''}</th></tr>
        ${s.lines.map(line).join('')}
      </tbody>`;

    const t = data.totals;
    // the template's amounts include BTW; BTW and the amount without it come last
    const totals = [
        ['Onderdelen', euro(t.subtotaal), ''],
        ['Projectkosten, bouwplaats, bedrijfskosten, winst en risico', euro(t.opslagen), ''],
        ['Totaal bouwkosten incl. BTW', euro(t.totaal), 'grand'],
    ].map(([name, value, cls]) => `<tr class="${cls}"><td>${name}</td><td class="n">${value}</td></tr>`).join('');
    const ratios = [
        `waarvan BTW ${euro(t.btw)}, excl. BTW ${euro(t.exclBtw)}`,
        t.perM2 !== null ? `${euro(t.perM2, true)} per m² netto vloeroppervlak` : '',
        t.perM3 !== null ? `${euro(t.perM3, true)} per m³ netto inhoud` : '',
    ].filter(Boolean).join(' · ');

    const proces = data.proces.items.length === 0 ? '' : `
    <section>
      <h2>Ontwerp en begeleiding</h2>
      <table class="list">
        ${data.proces.items.map(i => `<tr><td>${escape(i.titel)}${i.conditie ? ` <span class="muted">(${escape(i.conditie)})</span>` : ''}</td><td class="n">${euro(i.prijs)}</td></tr>`).join('')}
        ${data.proces.totaal !== null ? `<tr class="grand"><td>Totaal ontwerp en begeleiding incl. BTW</td><td class="n">${euro(data.proces.totaal)}</td></tr>` : ''}
      </table>
      ${t.inclProces !== null && t.inclProces !== t.totaal ? `<p class="sum">Bouwkosten en ontwerp samen: <strong>${euro(t.inclProces)}</strong> incl. BTW</p>` : ''}
    </section>`;

    const s = data.scenarios;
    const scenarios = !s ? '' : `
    <section>
      <h2>Wat de bouwer doet, per scenario</h2>
      <p class="muted">Zelf = dat deel doet u zelf; het zit dan niet in de prijs.</p>
      <div class="wrap"><table class="matrix">
        <thead><tr><th></th>${s.names.map(n => `<th class="${n === data.scenario ? 'chosen' : ''}">${escape(n)}</th>`).join('')}</tr></thead>
        <tbody>${s.categories.map((c, i) => `<tr><td>${escape(label(c))}</td>${s.names.map((n, j) =>
            `<td class="${n === data.scenario ? 'chosen' : ''}">${s.delivers[i]![j] ? 'bouwer' : 'zelf'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </section>`;

    const facts = [
        data.klant ? ['Voor', escape(data.klant)] : null,
        ['Datum', day(data.datum)],
        data.bouwer ? ['Bouwer', escape(data.bouwer)] : null,
        data.prijspeil ? ['Prijspeil', day(data.prijspeil)] : null,
        data.scenario ? ['Scenario', escape(data.scenario)] : null,
        ...data.gebouw.map(g => [g.label, `${NUMBER.format(g.value)} ${g.unit}`.trim()]),
    ].filter((f): f is Array<string> => f !== null).map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');

    return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(data.titel)}${data.klant ? ` · ${escape(data.klant)}` : ''}</title>
<style>
  :root { --ink: #1f2328; --muted: #656d76; --line: #d8dee4; --soft: #f6f8fa; --accent: #2f6f4f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 32px 0 8px; }
  .muted, .note, .spec { color: var(--muted); }
  .spec, .note { font-size: 13px; font-weight: normal; }
  dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px 16px; margin: 16px 0 8px; }
  dt { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  dd { margin: 0; font-weight: 600; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 6px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
  thead th { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  tr.section th { background: var(--soft); font-size: 14px; padding-top: 10px; }
  .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .total { font-weight: 600; }
  .costs { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
  .cost { font-size: 12px; background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 0 8px; }
  .cost.diy { color: var(--muted); border-style: dashed; }
  .totals { margin-left: auto; max-width: 460px; }
  .totals td, .list td { border-bottom: 1px solid var(--line); }
  tr.grand td { font-weight: 700; font-size: 17px; border-bottom: 2px solid var(--ink); }
  .ratios, .sum { text-align: right; }
  .matrix td, .matrix th { text-align: center; }
  .matrix td:first-child { text-align: left; }
  .matrix .chosen { background: #e8f3ec; color: var(--accent); font-weight: 600; }
  footer { margin-top: 40px; font-size: 12px; color: var(--muted); }
  @media (max-width: 560px) { .lines thead th:nth-child(3), .lines td:nth-child(3) { display: none; } }
  @media print {
    @page { size: A4; margin: 16mm 14mm; }
    body { font-size: 11pt; }
    main { max-width: none; padding: 0; }
    tbody, tr, section { break-inside: avoid; }
    .wrap { overflow: visible; }
  }
</style>
</head>
<body>
<main>
  <header>
    <h1>${escape(data.titel)}</h1>
    <dl>${facts}</dl>
  </header>

  <section>
    <h2>Bouwkosten</h2>
    <div class="wrap"><table class="lines">
      <thead><tr><th>Onderdeel</th><th class="n">Hoeveelheid</th><th class="n">Per eenheid</th><th class="n">Totaal incl. BTW</th></tr></thead>
      ${data.sections.map(section).join('')}
    </table></div>
    <table class="totals">${totals}</table>
    ${ratios ? `<p class="ratios muted">${ratios}</p>` : ''}
    ${data.notitie ? `<p>${escape(data.notitie)}</p>` : ''}
  </section>
  ${scenarios}
  ${proces}
  <footer>Dit is een prijsindicatie op basis van representatieve onderdelen en de prijzen van de bouwer op de genoemde prijspeildatum. Prijzen incl. BTW tenzij anders vermeld.</footer>
</main>
</body>
</html>
`;
}
