/**
 *  materials/fromSheet.ts — materials from the `materialen` tab of the core sheet.
 *
 *  The core sheet (URBUILD_DATABASE_CORE) is the one source of what a material is: its density,
 *  thermal conductivity λ (EN ISO 10456 design values), vapour resistance, fire class, strength,
 *  recyclability, average price and EN 15804 life-cycle carbon. It is kept online so everyone can
 *  check it and see where each value comes from. This file only reads one row into a Material.
 *
 *  The tab's columns, as the sheet names them (row 2 of the tab, the named range
 *  `tables.materialen`):
 *
 *      materiaal_id, toepassing, naam, omschrijving, prijs, prijseenheid, prijsbasis, prijsbron,
 *      dichtheid (kg/m3), warmtegeleidingscoëfficiënt λ (W/(m·K)), dampdiffusieweerstand μ
 *      (droog / nat), brandklasse (EN 13501-1), sterkteklasse, druksterkte (MPa), treksterkte
 *      (MPa), elasticiteitsmodulus (GPa), recyclebaarheid (fractie), bron eigenschappen,
 *      functionele eenheid (EPD), omrekenfactor → m3, A1-A3, A4, A5, C1, C2, C3, C4, D,
 *      GWP-biogeen A1-A3, norm, dataset, LCA-bron, geldig tot, LCA-opmerkingen
 *
 *  The LCA columns are per m³ (the sheet converts each EPD's own unit with `omrekenfactor`).
 */

import type { LCAModule, Material, MaterialGroup, MaterialProperty } from './types';
import { appearanceOf } from './appearance';

type Row = Record<string, unknown>;

/** The sheet's `toepassing` → the group drawings, IFC and the viewer know. */
const GROUP_OF_APPLICATION: Record<string, MaterialGroup> = {
    constructiehout: 'wood',
    gevel: 'wood',
    plaatmateriaal: 'wood',
    isolatie: 'insulation',
    folies: 'membrane',
    bevestigingsmiddelen: 'metal',
    fundering: 'concrete',
    dakbedekking: 'other',
    afwerking: 'finish',
    kozijnen: 'other',
};

/** Materials whose group is not their application's. */
const GROUP_OF_MATERIAL: Record<string, MaterialGroup> = {
    gipsplaat: 'finish',
    cementspaanplaat: 'composite',
    houtvezel_buitenplaat: 'wood',
    houtvezelplaat: 'insulation',
    schroefpaal: 'metal',
    constructiestaal: 'metal',
    wapeningsstaal: 'metal',
    zink: 'metal',
    gecoat_staal: 'metal',
    keramische_dakpan: 'masonry',
    hergebruikte_dakpan: 'masonry',
    epdm: 'membrane',
    houten_raam: 'wood',
    houten_kozijn: 'wood',
    houten_deur: 'wood',
    houten_deur_glas: 'wood',
    staldeur: 'wood',
    binnendeur: 'wood',
    houten_vloer: 'wood',
    dakraam: 'glass',
};

/** The LCA columns and the module each holds. */
const LCA_COLUMNS: Array<[string, LCAModule]> = [
    ['A1-A3', 'A1A3'], ['A4', 'A4'], ['A5', 'A5'], ['C1', 'C1'], ['C2', 'C2'], ['C3', 'C3'], ['C4', 'C4'], ['D', 'D'],
];

const text = (value: unknown): string => String(value ?? '').trim();

/**
 * A cell as a number. cloudcalc hands numbers over as numbers; a sheet read as text gives
 * '€ 1,021.79' or '1,200' (US-style separators, as the sheet formats them) or '50 / 20'
 * (the first number counts).
 */
export function sheetNumber(value: unknown): number | undefined
{
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    const match = text(value).replace(/[€\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : undefined;
}

/** A column by its name, ignoring case and spacing; also by the start of the name ('dichtheid'). */
function cell(row: Row, name: string): unknown
{
    const want = name.toLowerCase().replace(/\s+/g, ' ');
    const key = Object.keys(row).find(k => k.toLowerCase().replace(/\s+/g, ' ') === want)
        ?? Object.keys(row).find(k => k.toLowerCase().replace(/\s+/g, ' ').startsWith(want));
    return key === undefined ? undefined : row[key];
}

const property = (row: Row, column: string, unit: string, source?: string): MaterialProperty | undefined =>
{
    const value = sheetNumber(cell(row, column));
    return value === undefined ? undefined : { value, unit, ...(source ? { source } : {}) };
};

/** One row of the `materialen` tab as a Material, or null for an empty or headless row. */
export function materialFromRow(row: Row): Material | null
{
    const id = text(cell(row, 'materiaal_id'));
    if (!id) return null;

    const application = text(cell(row, 'toepassing')).toLowerCase();
    const group = GROUP_OF_MATERIAL[id] ?? GROUP_OF_APPLICATION[application] ?? 'other';
    const source = text(cell(row, 'bron eigenschappen')) || undefined;

    const material: Material = {
        name: id,
        group,
        application: application || undefined,
        description: [text(cell(row, 'naam')), text(cell(row, 'omschrijving'))].filter(Boolean).join(': ') || undefined,
        density: property(row, 'dichtheid', 'kg/m3', source),
        thermalConductivity: property(row, 'warmtegeleidingscoëfficiënt', 'W/mK', source),
        diffusion: property(row, 'dampdiffusieweerstand', '-', source),
        compressive: property(row, 'druksterkte', 'MPa', source),
        tensile: property(row, 'treksterkte', 'MPa', source),
        elastic: property(row, 'elasticiteitsmodulus', 'GPa', source),
        recyclability: property(row, 'recyclebaarheid', 'fraction', source),
        fireClass: text(cell(row, 'brandklasse')) || undefined,
        strengthClass: text(cell(row, 'sterkteklasse')) || undefined,
        viz: appearanceOf(id, group),
    };

    const price = sheetNumber(cell(row, 'prijs'));
    if (price !== undefined)
    {
        material.price = { value: price, unit: `EUR/${text(cell(row, 'prijseenheid')) || 'm3'}`, source: text(cell(row, 'prijsbron')) || undefined };
    }

    const modules = Object.fromEntries(LCA_COLUMNS
        .map(([column, module]) => [module, sheetNumber(cell(row, column))] as const)
        .filter(([, value]) => value !== undefined)
        .map(([module, value]) => [module, { value: value!, unit: 'kgCO2e/m3' }]));
    if (Object.keys(modules).length > 0)
    {
        const standard = text(cell(row, 'norm'));
        material.lca = {
            standard: standard.includes('A1') && !standard.includes('A2') ? 'EN 15804+A1' : 'EN 15804+A2',
            indicator: 'GWP-total',
            declaredUnit: 'm3',
            declaredUnitValue: 1,
            density: material.density,
            modules,
            source: {
                dataset: text(cell(row, 'dataset')),
                uuid: '',
                version: '',
                url: text(cell(row, 'LCA-bron')),
                retrieved: '',
                validUntil: text(cell(row, 'geldig tot')) || undefined,
            },
        };
    }

    // properties the sheet leaves empty are left out, not set to undefined
    Object.keys(material).forEach(k => (material as any)[k] === undefined && delete (material as any)[k]);
    return material;
}

/** All rows of the tab as Materials. */
export function materialsFromRows(rows: Array<Row>): Material[]
{
    return rows.map(materialFromRow).filter((m): m is Material => m !== null);
}
