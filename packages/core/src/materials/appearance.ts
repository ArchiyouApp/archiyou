/**
 *  materials/appearance.ts — how a material looks in the viewer and in drawings.
 *
 *  The only material data kept in code. What a material IS (density, λ, strength, LCA,
 *  price) comes from the `materialen` tab of the core sheet, where everyone can check it
 *  (see fromRows.ts). How it LOOKS is presentation: a colour and a roughness, here by the sheet's
 *  `materiaal_id`, so a shape given `.material('osb')` looks like OSB without any sheet loaded.
 *  A material the sheet has and this table does not gets a plain colour from its group.
 *
 *  Its texture goes by its name only: ./textures/<materiaal_id>_sides.jpg for its faces, and
 *  <materiaal_id>_section.jpg for where it is cut (a drawing's hatch). A material without such a
 *  file has its colour only; to give it a texture, add the file. The textures are greyscale masks
 *  that the viewer multiplies by `pbr.color`. Their size in the world follows the material's group
 *  (TEXTURE_SIZE).
 */

import type { MaterialGroup, MaterialViz } from './types';

/** How large a texture is in the world (mm), by the material's group: a mask of wood shows
 *  500 x 875 mm of it. A cut face (section) shows 500 x 500 mm. */
const TEXTURE_SIZE: Record<MaterialGroup, [number, number]> = {
    wood: [500, 875], insulation: [1200, 2100], metal: [1500, 2625], concrete: [3000, 3000],
    composite: [3000, 3000], masonry: [1000, 1000], finish: [1000, 1000], glass: [2000, 3000],
    stone: [1000, 1000], plastic: [1000, 1000], membrane: [1000, 1000], other: [1000, 1000],
};

/** The textures a material has by its name: a file that is not there is a colour only (see
 *  MaterialManager.loadTextureDataURI) */
function texturesOf(id: string, group: MaterialGroup): NonNullable<MaterialViz['textures']>
{
    const [w, h] = TEXTURE_SIZE[group] ?? TEXTURE_SIZE.other;
    return {
        sides: { image: `./textures/${id}_sides.jpg`, realWidth: w, realHeight: h, repeat: false },
        section: { image: `./textures/${id}_section.jpg`, realWidth: 500, realHeight: 500, repeat: false },
    };
}

const look = (color: string, roughness: number, extra: { metallic?: number; alpha?: number } = {}): MaterialViz => ({
    pbr: { color, roughness, metallic: extra.metallic ?? 0, ...(extra.alpha !== undefined ? { alpha: extra.alpha } : {}) },
});

/** The look per `materiaal_id` of the core sheet. */
export const APPEARANCE: Record<string, MaterialViz> = {
    // constructiehout
    naaldhout_constructief: look('#8B5A2B', 0.7),
    naaldhout_geschaafd: look('#9a6a38', 0.65),
    gelamineerd_hout: look('#cba46c', 0.7),
    i_ligger: look('#a87a48', 0.7),
    // gevel
    douglas: look('#c08a4a', 0.72),
    lariks: look('#b98a55', 0.72),
    thermohout: look('#5e3d24', 0.7),
    hergebruikt_hout: look('#7d6a55', 0.75),
    // plaatmateriaal
    osb: look('#c2a06a', 0.8),
    esb: look('#c9ad7c', 0.75),
    multiplex: look('#d9b380', 0.7),
    drielagenplaat: look('#d6b07a', 0.7),
    cementspaanplaat: look('#9a9a94', 0.85),
    gipsplaat: look('#e0e0e0', 0.7),
    // isolatie and wood fibre boards
    houtvezel_buitenplaat: look('#7a5a3a', 0.85),
    houtvezelplaat: look('#9b7650', 0.9),
    houtvezel_flex: look('#a88257', 0.95),
    hennepvezel: look('#b9a77a', 0.95),
    glaswol: look('#e3cf73', 0.95),
    stro: look('#d9c27a', 0.95),
    eps: look('#f4f4f0', 0.9),
    xps: look('#c7e0ef', 0.85),
    // metal
    rvs: look('#b8bcc0', 0.35, { metallic: 1 }),
    verzinkt_staal: look('#9aa3ab', 0.45, { metallic: 0.9 }),
    schroefpaal: look('#5a5f63', 0.55, { metallic: 1 }),
    constructiestaal: look('#808080', 0.5, { metallic: 1 }),
    wapeningsstaal: look('#666666', 0.5, { metallic: 0.9 }),
    zink: look('#8E9BA7', 0.4, { metallic: 0.9 }),
    gecoat_staal: look('#3b3f42', 0.5, { metallic: 0.6 }),
    // fundering, dakbedekking, afwerking
    beton: look('#808080', 0.8),
    keramische_dakpan: look('#b4583a', 0.8),
    hergebruikte_dakpan: look('#9b5a40', 0.85),
    leem_grondlaag: look('#a8865e', 0.9),
    leem_afwerklaag: look('#c8a983', 0.9),
    keramische_tegel: look('#d8d4cc', 0.4),
    houten_vloer: look('#9b6b3e', 0.6),
    groendak: look('#5f7a3a', 0.95),
    epdm: look('#2b2b2b', 0.8),
    // folies and tape
    dampremmende_folie: look('#d9d9d9', 0.6, { alpha: 0.6 }),
    dampopen_folie: look('#e6e6e6', 0.6, { alpha: 0.6 }),
    luchtdichte_tape: look('#2f6db3', 0.5),
    // kozijnen
    houten_raam: look('#e8e2d6', 0.6),
    houten_kozijn: look('#e8e2d6', 0.6),
    houten_deur: look('#8a6a48', 0.6),
    houten_deur_glas: look('#8a6a48', 0.6),
    staldeur: look('#7a5a3a', 0.65),
    binnendeur: look('#f0ede6', 0.5),
    dakraam: look('#F8F8F8', 0.05, { alpha: 0.25 }),
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

/** How a material looks: its own colour, else its group's; and the textures of its name. */
export function appearanceOf(id: string, group?: MaterialGroup): MaterialViz
{
    const g = group ?? APPEARANCE_GROUP[id] ?? 'other';
    return { ...(APPEARANCE[id] ?? look(GROUP_COLOR[g] ?? GROUP_COLOR.other, 0.8)), textures: texturesOf(id, g) };
}
