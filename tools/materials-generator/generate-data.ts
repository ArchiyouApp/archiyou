/**
 *  generate-data.ts
 *
 *  Generate the archiyou materials database using Google Gemini. For each material
 *  in CONFIG.materials, prompt Gemini with a strict response schema (canonical SI
 *  units) and require a per-property source citation, then assemble materials.json.
 *
 *  Run:  GEMINI_API_KEY=... npm run generate:data   (or put the key in .env)
 *
 *  Env flags:
 *  - ONLY_UPDATE=true  Skip materials already complete in materials.json and only
 *                      (re)generate the missing/incomplete ones. Handy for resuming
 *                      after a transient API error (e.g. 503 "high demand") without
 *                      re-spending quota on materials that already succeeded.
 */

import './env.js';
import { GoogleGenAI, Type } from '@google/genai';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(HERE, CONFIG.output.databaseFile);

/** Parse a truthy env flag (true/1/yes, case-insensitive). */
const envFlag = (v: string | undefined) => /^(1|true|yes)$/i.test((v ?? '').trim());
const ONLY_UPDATE = envFlag(process.env.ONLY_UPDATE);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** Response schema for a single material property (canonical SI). */
const propertySchema = {
    type: Type.OBJECT,
    properties: {
        value: { type: Type.NUMBER },
        unit: { type: Type.STRING },
        description: { type: Type.STRING },
        source: { type: Type.STRING },
    },
    required: ['value', 'unit', 'source'],
};

/** Response schema constraining Gemini's per-material output. */
const materialSchema = {
    type: Type.OBJECT,
    properties: {
        name: { type: Type.STRING },
        group: { type: Type.STRING },
        aliases: { type: Type.ARRAY, items: { type: Type.STRING } },
        description: { type: Type.STRING },
        density: propertySchema,
        thermalConductivity: propertySchema,
        compressive: propertySchema,
        tensile: propertySchema,
        elastic: propertySchema,
        fireReaction: propertySchema,
        carbon: propertySchema,
        recyclability: propertySchema,
        viz: {
            type: Type.OBJECT,
            properties: {
                pbr: {
                    type: Type.OBJECT,
                    properties: {
                        color: { type: Type.STRING },
                        alpha: { type: Type.NUMBER },
                        metallic: { type: Type.NUMBER },
                        roughness: { type: Type.NUMBER },
                    },
                    required: ['color', 'metallic', 'roughness'],
                },
            },
            required: ['pbr'],
        },
    },
    required: ['name', 'group', 'description', 'density', 'viz'],
};

const SYSTEM = `You are a building-materials engineer assembling a reference database for CAD software.
Report physical properties in CANONICAL SI UNITS ONLY:
- density: kg/m3
- thermalConductivity: W/mK
- compressive / tensile: MPa
- elastic (modulus): GPa
- carbon (embodied): kgCO2e/kg
- recyclability: fraction (0..1)
Every numeric property MUST include a short 'source' citation (e.g. "Engineering ToolBox", "Eurocode 2", "ICE database v3", "Wood Handbook (FPL)").
Give a realistic mid-range value for a typical grade of the material. Only include properties you are confident about; omit uncertain ones rather than guessing.
For viz.pbr provide a plausible base color (CSS hex), metallic (0..1) and roughness (0..1); set alpha < 1 only for transparent materials like glass.`;

async function generateOne(spec: { name: string; group: string; aliases?: string[] }): Promise<any>
{
    const aliasHint = spec.aliases?.length ? ` Known aliases: ${spec.aliases.join(', ')}.` : '';
    const res = await ai.models.generateContent({
        model: CONFIG.dataModel,
        contents: `Produce the material record for "${spec.name}" (group: ${spec.group}).${aliasHint} Use "${spec.name}" as the name and include the aliases.`,
        config: {
            systemInstruction: SYSTEM,
            responseMimeType: 'application/json',
            responseSchema: materialSchema,
            temperature: 0.2,
        },
    });
    const text = res.text;
    if (!text) throw new Error(`no output for ${spec.name}`);
    return JSON.parse(text);
}

/** Coarse group density sanity ranges (kg/m3) — flags gross errors, doesn't reject. */
const DENSITY_RANGE: Record<string, [number, number]> = {
    wood: [80, 1300], metal: [1800, 12000], stone: [1200, 3300], concrete: [250, 2900],
    masonry: [500, 2300], glass: [2000, 2900], plastic: [800, 2300], insulation: [5, 350],
    membrane: [800, 2100], composite: [800, 2600],
};

function warnIfOutOfRange(m: any)
{
    const r = DENSITY_RANGE[m.group];
    const d = m.density?.value;
    if (r && typeof d === 'number' && (d < r[0] || d > r[1]))
        console.warn(`  ⚠ ${m.name}: density ${d} kg/m3 outside expected ${r[0]}–${r[1]} for group '${m.group}'`);
}

/** A material counts as "done" when it carries the schema-required fields. Used by
 *  ONLY_UPDATE to decide which materials still need generating. */
function isComplete(m: any): boolean
{
    return !!(m
        && typeof m.name === 'string'
        && typeof m.group === 'string'
        && typeof m.description === 'string'
        && m.density && typeof m.density.value === 'number'
        && m.viz?.pbr);
}

async function main()
{
    // Preserve any existing viz.textures already authored/generated.
    const existing = existsSync(DB_PATH)
        ? JSON.parse(readFileSync(DB_PATH, 'utf8'))
        : { meta: {}, materials: [] };
    const prevByName = new Map<string, any>((existing.materials ?? []).map((m: any) => [m.name, m]));

    // In ONLY_UPDATE mode, figure out which materials still need generating.
    const todo = ONLY_UPDATE
        ? CONFIG.materials.filter(spec => !isComplete(prevByName.get(spec.name)))
        : CONFIG.materials;

    if (ONLY_UPDATE)
    {
        const doneCount = CONFIG.materials.length - todo.length;
        console.log(`ONLY_UPDATE=true → ${doneCount}/${CONFIG.materials.length} already complete in materials.json; generating ${todo.length} missing with ${CONFIG.dataModel}…`);
        if (todo.length === 0)
        {
            console.log('Nothing to update — all materials already present. Leaving materials.json untouched.');
            return;
        }
    }
    else
    {
        console.log(`Generating ${CONFIG.materials.length} materials with ${CONFIG.dataModel}…`);
    }

    const todoNames = new Set(todo.map(s => s.name));
    let okCount = 0, failCount = 0;

    const materials: any[] = [];
    for (const spec of CONFIG.materials)
    {
        // Keep an already-complete material as-is (only relevant with ONLY_UPDATE).
        if (!todoNames.has(spec.name))
        {
            materials.push(prevByName.get(spec.name));
            continue;
        }

        process.stdout.write(`- ${spec.name} … `);
        try
        {
            const m = await generateOne(spec);
            // keep previously generated textures if present
            const prevTex = prevByName.get(m.name)?.viz?.textures;
            if (prevTex) m.viz = { ...m.viz, textures: prevTex };
            warnIfOutOfRange(m);
            materials.push(m);
            okCount++;
            console.log('ok');
        }
        catch (e)
        {
            failCount++;
            console.log(`FAILED (${(e as Error).message}) — keeping previous if any`);
            const prev = prevByName.get(spec.name);
            if (prev) materials.push(prev);
        }
    }

    const db = {
        $schema: './materials.schema.json',
        meta: {
            note: 'Canonical SI units: density kg/m3, thermalConductivity W/mK, compressive/tensile MPa, elastic GPa, carbon kgCO2e/kg. Generated via tools/materials-generator (Gemini).',
            version: (existing.meta?.version ?? 0) + 1,
            generatedAt: new Date().toISOString(),
        },
        materials,
    };

    mkdirSync(dirname(DB_PATH), { recursive: true });
    writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n');
    console.log(`\nWrote ${materials.length} materials → ${DB_PATH} (${okCount} generated, ${failCount} failed this run).`);
    if (failCount > 0)
        console.log(`${failCount} material(s) failed (e.g. API "high demand"). Re-run with ONLY_UPDATE=true to retry just those.`);
    console.log('Review the values before committing (see crosscheck.ts for a live audit).');
}

main().catch((e) => { console.error(e); process.exit(1); });
