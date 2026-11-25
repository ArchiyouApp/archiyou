/**
 *  materials/appearance.ts — how a material looks in the viewer and in drawings.
 *
 *  The only material data kept in code. What a material IS (density, λ, strength, LCA,
 *  price) comes from the `materialen` tab of the core sheet, where everyone can check it
 *  (see fromRows.ts). How it LOOKS is presentation: a colour, a roughness and a texture mask,
 *  so a shape given `.material('osb')` looks like OSB without any sheet loaded.
 *
 *  Keyed by the sheet's `materiaal_id`. The textures in ./textures are greyscale masks that the
 *  viewer multiplies by `pbr.color`, so one mask serves several materials: wood fibre, straw
 *  and hemp share the mineral wool mask, each in its own colour.
 *
 *  A material the sheet has and this table does not gets a plain colour from its group.
 */

import type { MaterialGroup, MaterialViz } from './types';

/** A texture set: the mask images and their real-world size in mm. */
interface Masks
{
    sides: { image: string; realWidth: number; realHeight: number; repeat: boolean };
    section?: { image: string; realWidth: number; realHeight: number; repeat: boolean };
}

const mask = (name: string, w: number, h: number, section = false): Masks => ({
    sides: { image: `./textures/${name}_sides.jpg`, realWidth: w, realHeight: h, repeat: false },
    ...(section ? { section: { image: `./textures/${name}_section.jpg`, realWidth: 500, realHeight: 500, repeat: false } } : {}),
});

const MASKS = {
    softwood: mask('softwood', 500, 875, true),
    hardwood: mask('hardwood', 500, 875, true),
    douglas: mask('douglas', 500, 875, true),
    glulam: mask('glulam', 500, 875, true),
    plywood: mask('plywood', 500, 875, true),
    clt: mask('clt', 500, 875, true),
    osb: mask('osb', 500, 875, true),
    fibre: mask('mineralwool', 1200, 2100),
    eps: mask('eps', 1200, 1644),
    xps: mask('xps', 1200, 2100),
    drywall: mask('drywall', 1000, 1000),
    cement: mask('cement', 3000, 3000),
    concrete: mask('concrete', 3000, 3000),
    steel: mask('steel', 1500, 2625),
    zinc: mask('zinc', 1500, 2625),
    rebar: mask('rebar', 1500, 2625),
    terracotta: mask('terracotta', 1000, 1000),
    glass: mask('glass', 2000, 3000),
} as const;

const look = (color: string, roughness: number, masks?: Masks, extra: { metallic?: number; alpha?: number } = {}): MaterialViz => ({
    pbr: { color, roughness, metallic: extra.metallic ?? 0, ...(extra.alpha !== undefined ? { alpha: extra.alpha } : {}) },
    ...(masks ? { textures: masks } : {}),
});

/** The look per `materiaal_id` of the core sheet. */
export const APPEARANCE: Record<string, MaterialViz> = {
    // constructiehout
    naaldhout_constructief: look('#8B5A2B', 0.7, MASKS.softwood),
    naaldhout_geschaafd: look('#9a6a38', 0.65, MASKS.softwood),
    gelamineerd_hout: look('#cba46c', 0.7, MASKS.glulam),
    i_ligger: look('#a87a48', 0.7, MASKS.softwood),
    // gevel
    douglas: look('#c08a4a', 0.72, MASKS.douglas),
    lariks: look('#b98a55', 0.72, MASKS.softwood),
    thermohout: look('#5e3d24', 0.7, MASKS.hardwood),
    hergebruikt_hout: look('#7d6a55', 0.75, MASKS.softwood),
    // plaatmateriaal
    osb: look('#c2a06a', 0.8, MASKS.osb),
    esb: look('#c9ad7c', 0.75, MASKS.osb),
    multiplex: look('#d9b380', 0.7, MASKS.plywood),
    drielagenplaat: look('#d6b07a', 0.7, MASKS.clt),
    cementspaanplaat: look('#9a9a94', 0.85, MASKS.cement),
    gipsplaat: look('#e0e0e0', 0.7, MASKS.drywall),
    // isolatie and wood fibre boards
    houtvezel_buitenplaat: look('#7a5a3a', 0.85, MASKS.fibre),
    houtvezelplaat: look('#9b7650', 0.9, MASKS.fibre),
    houtvezel_flex: look('#a88257', 0.95, MASKS.fibre),
    hennepvezel: look('#b9a77a', 0.95, MASKS.fibre),
    glaswol: look('#e3cf73', 0.95, MASKS.fibre),
    stro: look('#d9c27a', 0.95, MASKS.fibre),
    eps: look('#f4f4f0', 0.9, MASKS.eps),
    xps: look('#c7e0ef', 0.85, MASKS.xps),
    // metal
    rvs: look('#b8bcc0', 0.35, MASKS.steel, { metallic: 1 }),
    verzinkt_staal: look('#9aa3ab', 0.45, MASKS.zinc, { metallic: 0.9 }),
    schroefpaal: look('#5a5f63', 0.55, MASKS.steel, { metallic: 1 }),
    constructiestaal: look('#808080', 0.5, MASKS.steel, { metallic: 1 }),
    wapeningsstaal: look('#666666', 0.5, MASKS.rebar, { metallic: 0.9 }),
    zink: look('#8E9BA7', 0.4, MASKS.zinc, { metallic: 0.9 }),
    gecoat_staal: look('#3b3f42', 0.5, MASKS.steel, { metallic: 0.6 }),
    // fundering, dakbedekking, afwerking
    beton: look('#808080', 0.8, MASKS.concrete),
    keramische_dakpan: look('#b4583a', 0.8, MASKS.terracotta),
    hergebruikte_dakpan: look('#9b5a40', 0.85, MASKS.terracotta),
    leem_grondlaag: look('#a8865e', 0.9, MASKS.cement),
    leem_afwerklaag: look('#c8a983', 0.9, MASKS.cement),
    keramische_tegel: look('#d8d4cc', 0.4),
    houten_vloer: look('#9b6b3e', 0.6, MASKS.hardwood),
    groendak: look('#5f7a3a', 0.95),
    epdm: look('#2b2b2b', 0.8),
    // folies and tape
    dampremmende_folie: look('#d9d9d9', 0.6, undefined, { alpha: 0.6 }),
    dampopen_folie: look('#e6e6e6', 0.6, undefined, { alpha: 0.6 }),
    luchtdichte_tape: look('#2f6db3', 0.5),
    // kozijnen
    houten_raam: look('#e8e2d6', 0.6, MASKS.softwood),
    houten_kozijn: look('#e8e2d6', 0.6, MASKS.softwood),
    houten_deur: look('#8a6a48', 0.6, MASKS.hardwood),
    houten_deur_glas: look('#8a6a48', 0.6, MASKS.hardwood),
    staldeur: look('#7a5a3a', 0.65, MASKS.softwood),
    binnendeur: look('#f0ede6', 0.5),
    dakraam: look('#F8F8F8', 0.05, MASKS.glass, { alpha: 0.25 }),
};

/** The group of each material above, for drawings and IFC before the sheet is loaded (the sheet
 *  says it too: fromRows.ts derives it from `toepassing`). */
export const APPEARANCE_GROUP: Record<string, MaterialGroup> = Object.fromEntries([
    ...['naaldhout_constructief', 'naaldhout_geschaafd', 'gelamineerd_hout', 'i_ligger', 'douglas', 'lariks', 'thermohout',
        'hergebruikt_hout', 'osb', 'esb', 'multiplex', 'drielagenplaat', 'houtvezel_buitenplaat', 'houten_vloer', 'houten_raam',
        'houten_kozijn', 'houten_deur', 'houten_deur_glas', 'staldeur', 'binnendeur'].map(id => [id, 'wood']),
    ...['houtvezelplaat', 'houtvezel_flex', 'hennepvezel', 'glaswol', 'stro', 'eps', 'xps'].map(id => [id, 'insulation']),
    ...['rvs', 'verzinkt_staal', 'schroefpaal', 'constructiestaal', 'wapeningsstaal', 'zink', 'gecoat_staal'].map(id => [id, 'metal']),
    ...['gipsplaat', 'leem_grondlaag', 'leem_afwerklaag', 'keramische_tegel'].map(id => [id, 'finish']),
    ...['dampremmende_folie', 'dampopen_folie', 'luchtdichte_tape', 'epdm'].map(id => [id, 'membrane']),
    ['cementspaanplaat', 'composite'], ['beton', 'concrete'], ['keramische_dakpan', 'masonry'], ['hergebruikte_dakpan', 'masonry'],
    ['dakraam', 'glass'], ['groendak', 'other'],
]) as Record<string, MaterialGroup>;

/** A plain colour per group, for materials without an entry above. */
const GROUP_COLOR: Record<MaterialGroup, string> = {
    wood: '#a87a48', metal: '#808080', stone: '#8b8b8b', concrete: '#808080', masonry: '#a55233',
    glass: '#f8f8f8', plastic: '#dcdcd8', insulation: '#d9c27a', finish: '#e0e0e0',
    membrane: '#d9d9d9', composite: '#9a9a94', other: '#b0b0b0',
};

/** How a material looks: its own entry, else its group's colour. */
export function appearanceOf(id: string, group?: MaterialGroup): MaterialViz
{
    return APPEARANCE[id] ?? look(GROUP_COLOR[group ?? 'other'] ?? GROUP_COLOR.other, 0.8);
}
