/**
 *  config.ts — provider/model settings for the materials generator.
 *
 *  Defaults: Claude (data) + Google Nano Banana (textures). Swap the provider
 *  fields to retarget. Keys come from the environment (.env / shell).
 */

export interface GeneratorConfig
{
    /** Provider — Google Gemini for both data and images. */
    provider: 'gemini';
    /** Gemini model used to author material property data (structured JSON). */
    dataModel: string;
    /** Gemini image model ("Nano Banana") for textures. */
    imageModel: string;

    /** The full list of materials to generate (name + group hint). */
    materials: Array<{ name: string; group: string; aliases?: string[] }>;

    /** Output paths (relative to repo root). */
    output: {
        databaseFile: string;
        texturesDir: string;
    };
}

export const CONFIG: GeneratorConfig = {
    provider: 'gemini',
    // Gemini model for property data. flash is free-tier eligible; use
    // gemini-2.5-pro on a paid tier for higher-quality engineering values.
    // Override via GEMINI_DATA_MODEL.
    dataModel: process.env.GEMINI_DATA_MODEL ?? 'gemini-2.5-flash',

    // Google "Nano Banana" image model for textures. Override via GEMINI_IMAGE_MODEL.
    imageModel: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',

    output: {
        databaseFile: '../../packages/core/src/materials/materials.json',
        texturesDir: '../../packages/core/src/materials/textures',
    },

    // The construction/fabrication material list from WIP_MATERIALS.md, plus a few additions.
    materials: [
        { name: 'concrete', group: 'concrete', aliases: ['reinforced concrete'] },
        { name: 'cement', group: 'concrete' },
        { name: 'sand', group: 'stone' },
        { name: 'gravel', group: 'stone' },
        { name: 'stone', group: 'stone' },
        { name: 'mortar', group: 'masonry' },
        { name: 'grout', group: 'masonry' },
        { name: 'steel', group: 'metal', aliases: ['structural steel', 'mild steel'] },
        { name: 'rebar', group: 'metal' },
        { name: 'aluminum', group: 'metal', aliases: ['aluminium'] },
        { name: 'copper', group: 'metal' },
        { name: 'iron', group: 'metal', aliases: ['cast iron'] },
        { name: 'lead', group: 'metal' },
        { name: 'zinc', group: 'metal' },
        { name: 'wire', group: 'metal' },
        { name: 'bricks', group: 'masonry', aliases: ['brick'] },
        { name: 'blocks', group: 'masonry', aliases: ['concrete block'] },
        { name: 'granite', group: 'stone' },
        { name: 'marble', group: 'stone' },
        { name: 'limestone', group: 'stone' },
        { name: 'sandstone', group: 'stone' },
        { name: 'slate', group: 'stone' },
        { name: 'glass', group: 'glass', aliases: ['float glass'] },
        { name: 'terracotta', group: 'masonry' },
        { name: 'softwood', group: 'wood', aliases: ['pine', 'spruce'] },
        { name: 'hardwood', group: 'wood', aliases: ['oak', 'beech'] },
        { name: 'douglas', group: 'wood', aliases: ['douglas fir'] },
        { name: 'plywood', group: 'wood', aliases: ['multiplex'] },
        { name: 'osb', group: 'wood', aliases: ['oriented strand board'] },
        { name: 'glulam', group: 'wood' },
        { name: 'clt', group: 'wood', aliases: ['cross laminated timber'] },
        { name: 'bamboo', group: 'wood' },
        { name: 'fiberboard', group: 'wood', aliases: ['mdf'] },
        { name: 'pvc', group: 'plastic' },
        { name: 'hdpe', group: 'plastic' },
        { name: 'eps', group: 'insulation', aliases: ['expanded polystyrene'] },
        { name: 'xps', group: 'insulation', aliases: ['extruded polystyrene'] },
        { name: 'polyurethane', group: 'insulation' },
        { name: 'polycarbonate', group: 'plastic' },
        { name: 'acrylic', group: 'plastic', aliases: ['plexiglass'] },
        { name: 'epdm', group: 'membrane' },
        { name: 'fiberglass', group: 'composite' },
        { name: 'mineralwool', group: 'insulation', aliases: ['rockwool'] },
        { name: 'cellulose', group: 'insulation' },
        { name: 'woodfiber', group: 'insulation' },
        { name: 'cork', group: 'insulation' },
        { name: 'straw', group: 'insulation' },
        { name: 'sprayfoam', group: 'insulation' },
        { name: 'drywall', group: 'finish', aliases: ['gypsum board', 'plasterboard'] },
        { name: 'plaster', group: 'finish' },
        { name: 'stucco', group: 'finish' },
        { name: 'paint', group: 'finish' },
        { name: 'varnish', group: 'finish' },
        { name: 'ceramic tiles', group: 'finish' },
        { name: 'porcelain tiles', group: 'finish' },
        { name: 'terrazzo', group: 'finish' },
        { name: 'vinyl flooring', group: 'finish' },
        { name: 'linoleum', group: 'finish' },
        { name: 'carpet', group: 'finish' },
        { name: 'asphalt', group: 'membrane' },
        { name: 'bitumen', group: 'membrane' },
        { name: 'membrane', group: 'membrane' },
    ],
};
