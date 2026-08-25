/**
 *  restyle-textures.ts
 *
 *  Re-process the existing texture files in place — no image generation, no API calls.
 *
 *  Currently: auto-level each greyscale tint mask so its linework reads at a consistent
 *  strength across the whole set (see autoContrast in png-grey.ts). The image model's
 *  idea of contrast varies per material, so some textures shipped looking like blank
 *  paper next to others that looked like strong drawings.
 *
 *  Because the masks are already greyscale and decodeGrey handles colour type 0, this is
 *  a cheap re-run whenever the levelling target changes — regenerating 74 images to
 *  adjust contrast would be absurd.
 *
 *  Run:  npm run restyle:textures            # all
 *        npm run restyle:textures -- douglas # by material name
 *        npm run restyle:textures -- --dry   # report only, write nothing
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { decodeGrey, encodeGrey, autoContrast } from './png-grey.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEX_DIR = resolve(HERE, CONFIG.output.texturesDir);

/** 2nd/98th percentile tone, as a 0..1 pair — the numbers we are levelling. */
function levels(pixels: Uint8Array): { p2: number; p98: number }
{
    const hist = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i++) hist[pixels[i]]++;
    const lo = pixels.length * 0.02, hi = pixels.length * 0.98;
    let acc = 0, p2 = 0, p98 = 255, gotLo = false;
    for (let v = 0; v < 256; v++)
    {
        acc += hist[v];
        if (!gotLo && acc >= lo) { p2 = v; gotLo = true; }
        if (acc >= hi) { p98 = v; break; }
    }
    return { p2: p2 / 255, p98: p98 / 255 };
}

function main()
{
    if (!existsSync(TEX_DIR)) { console.error(`No textures at ${TEX_DIR}`); process.exit(1); }

    const args = process.argv.slice(2);
    const dry = args.includes('--dry');
    const filter = args.filter(a => !a.startsWith('--')).map(s => s.toLowerCase());

    const files = readdirSync(TEX_DIR)
        .filter(f => /\.(jpg|png)$/i.test(f))
        .filter(f => !filter.length || filter.some(n => f.toLowerCase().startsWith(n + '_')));

    console.log(`${files.length} texture(s)${dry ? ' (dry run)' : ''}\n`);
    let changed = 0, skipped = 0;

    for (const f of files)
    {
        const path = join(TEX_DIR, f);
        const src = readFileSync(path);
        const img = decodeGrey(src);
        if (!img) { console.log(`- ${f.padEnd(28)} SKIP (unsupported PNG)`); skipped++; continue; }

        const before = levels(img.pixels);
        const out = autoContrast(img);
        const after = levels(out.pixels);

        if (out === img) { console.log(`- ${f.padEnd(28)} already at strength (p2=${before.p2.toFixed(2)})`); skipped++; continue; }

        const enc = encodeGrey(out);
        if (!dry) writeFileSync(path, enc);
        console.log(`- ${f.padEnd(28)} range ${(before.p98 - before.p2).toFixed(2)} → ${(after.p98 - after.p2).toFixed(2)}`
            + `   (p2 ${before.p2.toFixed(2)} → ${after.p2.toFixed(2)})`);
        changed++;
    }

    console.log(`\n${changed} restyled, ${skipped} unchanged.${dry ? ' Nothing written.' : ''}`);
}

main();
