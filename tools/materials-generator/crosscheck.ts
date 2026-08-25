/**
 *  crosscheck.ts — MANUAL, non-CI validation of generated material values.
 *
 *  Uses Gemini with Google Search grounding to compare each material's stored
 *  properties against public reference sources and prints a diff report. This is
 *  a human auditing aid, NOT a test — it makes live network calls and is
 *  intentionally kept out of the vitest suite.
 *
 *  Run:  GEMINI_API_KEY=... npm run materials:crosscheck   (or key in .env)
 *  Audit a subset:  npm run materials:crosscheck -- steel douglas concrete
 */

import './env.js';
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(HERE, CONFIG.output.databaseFile);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function checkOne(m: any): Promise<string>
{
    const props = JSON.stringify(
        Object.fromEntries(Object.entries(m).filter(([k]) =>
            ['density', 'thermalConductivity', 'compressive', 'tensile', 'elastic', 'carbon'].includes(k))),
    );
    const res = await ai.models.generateContent({
        model: CONFIG.dataModel,
        contents: `Cross-check these stored properties for the building material "${m.name}" against public references. Report each property as OK (within a reasonable published range) or FLAG (with the expected range and a source). Be terse — one line per property.\n\nStored (SI units):\n${props}`,
        config: {
            tools: [{ googleSearch: {} }],
            temperature: 0,
        },
    });
    return res.text ?? '(no response)';
}

async function main()
{
    const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
    const only = process.argv.slice(2);
    const materials = (db.materials as any[]).filter((m) => !only.length || only.includes(m.name));

    console.log(`Cross-checking ${materials.length} materials against public sources (${CONFIG.dataModel})…\n`);
    for (const m of materials)
    {
        console.log(`### ${m.name} (${m.group})`);
        try { console.log(await checkOne(m)); }
        catch (e) { console.log(`  (check failed: ${(e as Error).message})`); }
        console.log('');
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
