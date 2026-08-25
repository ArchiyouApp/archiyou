/**
 *  generate-textures.ts
 *
 *  Generate material textures with Google "Nano Banana" (Gemini image), write them
 *  to packages/core/src/materials/textures/, and patch each material's viz.textures
 *  block into materials.json.
 *
 *  Roles:
 *   - sides   : the LARGEST/broadest continuous face of the material.
 *   - section : the cut cross-section — for solid wood the tree end-grain (growth
 *               rings), for boards the layered/ply edge, otherwise the sawn body.
 *  (thinSides was removed — boards use `section` for their thin cut faces.)
 *
 *  Every texture is authored at the material's MAXIMUM obtainable real-world extent
 *  (wood sides ≈ a log face at 500×889 mm — the model's 9:16 ceiling) and marked
 *  repeat:false, so the renderer crops a randomly-offset region per part rather than
 *  tiling a small pattern.
 *
 *  Textures are GREYSCALE tint masks, not coloured albedo: glTF multiplies them by the
 *  material's baseColorFactor, so white keeps the declared colour and black goes to
 *  black. See MONO below — this is load-bearing, a coloured texture double-tints.
 *
 *  Style is deliberately GRAPHICAL (high contrast, strong linework) — see GRAPHIC.
 *
 *  Run:  GEMINI_API_KEY=... npm run generate:textures
 */

import './env.js';
import { GoogleGenAI } from '@google/genai';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { toGreyscalePNG } from './png-grey.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(HERE, CONFIG.output.databaseFile);
const TEX_DIR = resolve(HERE, CONFIG.output.texturesDir);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Role = 'sides' | 'section';
interface RoleSpec { realWidth: number; realHeight: number; repeat?: boolean }

/**
 * Which face roles to generate per group, with real-world texture sizes (mm).
 *
 * MAX-EXTENT STRATEGY: every texture is authored at the LARGEST real-world size we can
 * actually obtain for that material — wood `sides` covers most of a log, stone a full
 * slab, metal a full sheet. A part therefore usually fits inside a single tile and the
 * renderer crops it (at a random offset per part) instead of repeating. That is why
 * everything is `repeat: false`: these are crops, not tiles. Parts that DO overrun their
 * tile fall back to REPEAT wrapping in the GLTF builder.
 *
 * Sizes are pre-snapped to aspects the image model actually honours (see
 * SUPPORTED_ASPECTS). The 9:16 ceiling is why wood `sides` is 500×889 rather than a full
 * 500×4000 log: the model refuses anything taller, so a beam longer than ~889 mm still
 * repeats. generateSized() re-derives these from the returned pixels either way, so the
 * stored mm always describe the image on disk.
 *
 * Wood `sides` is DIRECTIONAL: portrait, with image Y = the longitudinal grain axis.
 */
const ROLES: Record<string, Partial<Record<Role, RoleSpec>>> = {
    // WOOD is the only group with a `section`. A cut face only deserves its own texture
    // when it genuinely looks different from the outer face — end grain vs longitudinal
    // grain, or the ply/strand stack on a board edge. For an isotropic material (sand,
    // grout, cement, metal, stone, foam) the sawn face looks like the surface, so a
    // separately generated image just makes one part read as two different materials.
    // Without a `section`, every face falls through to `sides` in the GLTF builder.
    wood:       { sides: { realWidth: 500,  realHeight: 889,  repeat: false }, section: { realWidth: 500, realHeight: 500, repeat: false } },
    stone:      { sides: { realWidth: 1500, realHeight: 2667, repeat: false } },
    concrete:   { sides: { realWidth: 3000, realHeight: 3000, repeat: false } },
    masonry:    { sides: { realWidth: 1000, realHeight: 1000, repeat: false } },
    metal:      { sides: { realWidth: 1500, realHeight: 2667, repeat: false } },
    glass:      { sides: { realWidth: 2000, realHeight: 3000, repeat: false } },
    plastic:    { sides: { realWidth: 1000, realHeight: 1778, repeat: false } },
    membrane:   { sides: { realWidth: 1000, realHeight: 1778, repeat: false } },
    finish:     { sides: { realWidth: 1000, realHeight: 1000, repeat: false } },
    insulation: { sides: { realWidth: 1200, realHeight: 2133, repeat: false } },
    composite:  { sides: { realWidth: 1200, realHeight: 2133, repeat: false } },
    default:    { sides: { realWidth: 1000, realHeight: 1000, repeat: false } },
};

const isBoard = (name: string) => /plywood|multiplex|osb|oriented strand|clt|cross.?laminated|glulam|glue.?lam|fiberboard|mdf|particle|chip.?board/i.test(name);
const isPlywood = (name: string) => /plywood|multiplex/i.test(name);
const isOSB = (name: string) => /osb|oriented strand/i.test(name);
const isLaminatedTimber = (name: string) => /clt|cross.?laminated|glulam|glue.?lam/i.test(name);
const isPressedBoard = (name: string) => /fiberboard|mdf|particle|chip.?board/i.test(name);

/**
 * The house visual language: graphical rather than photographic. High contrast and
 * strong linework survive being viewed at architectural scale (and at the low pixels-per-mm
 * a max-extent tile implies), where a photographic texture just reads as grey mush.
 */
const GRAPHIC = 'STYLE — high-contrast GRAPHICAL ILLUSTRATION, not a photograph: every feature drawn as '
    + 'crisp dark linework over flat tonal areas with hard edges, strong contrast between light and dark. '
    + 'No soft gradients, no photographic grain or noise, no blur, no glossy highlights, no bevels or '
    + '3D shading. Fine-line engraving / woodcut / screen-print feel, while remaining a faithful '
    + 'depiction of the real material\'s structure.';

/**
 * Density instruction. Without this the model answers "graphical" with a handful of huge
 * flat shapes, which reads as abstract wallpaper at architectural scale. The style must
 * come from LINE QUALITY (crisp, flat, high contrast), never from lack of detail.
 */
const DETAIL = 'DENSITY — the pattern must be RICH and DENSE, packed with fine detail at every scale: '
    + 'many hundreds of distinct fine lines and small features filling the whole frame, plus finer '
    + 'sub-detail between them. Do NOT simplify, stylise away, or reduce to a few large flat shapes — '
    + 'this must look like a highly detailed technical illustration of the real material, not a minimal '
    + 'graphic or a logo. Zero large empty or uniform areas.';

/**
 * Textures are GREYSCALE masks, not coloured albedo.
 *
 * glTF defines base colour as `baseColorFactor × baseColorTexture`. Feeding it a
 * greyscale image makes that multiply do the tinting for us: white keeps the material's
 * declared colour, black goes to black. So one texture serves any colour, recolouring is
 * a data change rather than a regeneration, and the model only has to draw — it no longer
 * has to hit a hue, which it was bad at (dense linework kept averaging the colour away).
 *
 * It also removes a double-tint: a COLOURED texture multiplied by a coloured factor
 * rendered ~2.5x too dark. Greyscale is what makes that multiply correct.
 *
 * The image must be LIGHT overall — multiply can only darken, so a dark texture drags
 * every material below its declared colour.
 */
const MONO = 'MONOCHROME — output must be PURE GREYSCALE with absolutely NO colour: no brown, no beige, '
    + 'no warm or cool tint, no sepia. Every pixel is white, black or a neutral grey. '
    + 'Use the FULL tonal range: the open body of the material is pure WHITE, and the linework is '
    + 'genuinely DARK — strong lines at near-black, secondary lines at mid grey. Do NOT draw everything '
    + 'in pale washed-out light grey; a faint drawing is the most common failure here. '
    + 'CRITICAL: this is a continuous MATERIAL SURFACE, not a drawing on a page — no paper, no page, '
    + 'no border, no frame, no outline around the subject, no vignette, no margin, no white space at '
    + 'the edges. The material and its pattern run right off all four edges of the image. '
    + 'This is a tint mask that gets multiplied by a colour later — white keeps the material colour, '
    + 'dark lines darken it, so the drawing needs real contrast to be visible at all.';

/**
 * Average annual growth-ring spacing, in mm.
 *
 * THE reason `sides` and `section` must share a number. Both faces cut the same timber,
 * so the ring spacing you see end-on is the same spacing you see as grain lines along
 * the plank. Left to itself the model picks an unrelated density for each, and a beam
 * ends up looking like two different trees depending on which face you look at.
 *
 * Feature counts below are DERIVED from this and the frame size, so the two roles stay
 * consistent automatically if the sizes in ROLES ever change.
 */
const RING_SPACING_MM = 4;

/**
 * The characteristic visible feature of each material, and its real-world size in mm.
 *
 * Same principle as RING_SPACING_MM, generalised. Told only "be detailed", the model
 * produces a soft photographic wash for anything granular — concrete, sand and gravel
 * all came back with a tonal range under 0.1, i.e. visually flat once tinted. Naming the
 * feature AND its size lets the prompt state an actual count for the frame, which is the
 * instruction it reliably follows.
 *
 * Keyed by material name first, then by group. Sizes are deliberately real: aggregate is
 * genuinely ~16 mm, a brick is 215 mm.
 */
interface Feature { mm: number; what: string }

const FEATURES: Record<string, Feature> = {
    // stone group — far too varied for a single group entry
    sand:        { mm: 0.6, what: 'individual sand grains' },
    gravel:      { mm: 30,  what: 'rounded gravel stones, each one separately outlined' },
    granite:     { mm: 4,   what: 'interlocking feldspar, quartz and mica crystals, each separately outlined' },
    marble:      { mm: 250, what: 'sweeping branching veins running across the slab' },
    limestone:   { mm: 6,   what: 'fossil and shell fragments with fine bedding specks' },
    sandstone:   { mm: 3,   what: 'cemented sand grains with faint bedding laminae' },
    slate:       { mm: 40,  what: 'cleavage bands and fine parallel laminations' },

    // mineral / masonry
    concrete:    { mm: 16,  what: 'coarse aggregate stones embedded in the matrix, each separately outlined' },
    cement:      { mm: 2,   what: 'fine powder agglomerations and hairline shrinkage cracks' },
    mortar:      { mm: 2,   what: 'sand particles suspended in the mortar matrix' },
    grout:       { mm: 2,   what: 'fine sand particles in the grout matrix' },
    bricks:      { mm: 215, what: 'brick units separated by mortar joints, in a running bond' },
    blocks:      { mm: 440, what: 'block units separated by mortar joints' },
    terracotta:  { mm: 300, what: 'overlapping roof tile units' },

    // insulation / plastic
    eps:         { mm: 4,   what: 'fused expanded polystyrene beads, each separately outlined' },
    xps:         { mm: 1,   what: 'fine closed foam cells' },
    sprayfoam:   { mm: 3,   what: 'irregular open foam cells' },
    mineralwool: { mm: 2,   what: 'tangled mineral fibres crossing in all directions' },

    // group fallbacks
    metal:       { mm: 150, what: 'directional mill lines, fine scratches and subtle patina mottling' },
    glass:       { mm: 400, what: 'faint reflection banding across an otherwise clean panel' },
    plastic:     { mm: 50,  what: 'extrusion lines and subtle surface mottling' },
    membrane:    { mm: 50,  what: 'the woven reinforcement grid showing through the surface' },
    finish:      { mm: 300, what: 'board joints, fine paper fibre texture and taped seams' },
    composite:   { mm: 20,  what: 'the bonded particle / fibre structure' },
    stone:       { mm: 80,  what: 'irregular cut stone units with jointing' },
};

/** Feature guidance for a material, with a count derived from the frame width. */
function featureHint(name: string, group: string, spec: RoleSpec): string
{
    const f = FEATURES[name.toLowerCase()] ?? FEATURES[group];
    if (!f) return '';

    const across = spec.realWidth / f.mm;
    // Only state a count when it is a number the model can actually act on. Below ~5 it
    // is not a texture, above ~400 it is uncountable and the instruction backfires.
    const count = (across >= 5 && across <= 400)
        ? `Across the ${spec.realWidth} mm width of this frame that is ROUGHLY ${Math.round(across)} of them. `
        : '';

    return `FEATURE SCALE — the defining detail of this material is ${f.what}, at a real size of about `
        + `${f.mm} mm. ${count}Draw them at that scale, clearly and individually delineated with dark `
        + `outlines — not as a soft blurry speckle or a uniform wash.`;
}

/** Prompt phrased to avoid the IMAGE_RECITATION filter (original/synthetic/procedural). */
function promptFor(name: string, group: string, role: Role, spec: RoleSpec): string
{
    const orig = 'Generate an original, synthetic, procedural, crisp and finely detailed GREYSCALE material texture — a tint mask for 3D rendering.';
    const lit = 'Flat even studio lighting, straight-on orthographic view, no shadows, no perspective, no text or logos.';
    const size = `The frame covers about ${spec.realWidth} mm × ${spec.realHeight} mm of real material — detail must be at that scale, not zoomed in.`;
    // Max-extent crops are never tiled, so seamless edges are not required.
    const fill = 'The material must fill the ENTIRE frame edge to edge — no borders, no margins, no background, no whitespace.';

    if (role === 'sides')
    {
        if (group === 'wood')
        {
            let face: string;
            if (isPlywood(name)) face = `the smooth continuous outer VENEER FACE of ${name} (the large broad face, NOT the thin layered edge)`;
            else if (isOSB(name)) face = `the broad flat FACE of OSB covered in flat compressed wood strands/flakes`;
            else face = `the broad sawn plank FACE of ${name} — the single largest/broadest face, as if cut from a whole tree trunk`;
            // Grain-line spacing on a sawn face IS the ring spacing — same tree, same number.
            const lines = Math.round(spec.realWidth / RING_SPACING_MM);
            return `${orig} Tall PORTRAIT orientation. ${size} `
                + `CRITICAL: the wood grain must run strictly VERTICALLY, parallel to the image's Y (height) axis — this is the longitudinal direction of the timber. Long grain lines running unbroken from top to bottom, never sideways. `
                + `GRAIN SCALE — this is the single most important instruction: the annual growth rings of this timber are ${RING_SPACING_MM} mm apart, so across the ${spec.realWidth} mm width of this frame there must be ROUGHLY ${lines} major vertical grain lines, evenly filling the full width. Not fewer, not dramatically more. `
                + `Between each pair of major lines add several finer secondary fibre lines, so no area is left flat or empty. `
                + `Include the full character of real sawn timber: several elongated cathedral / flame figure patterns where the grain arcs around, scattered knots with grain deflecting tightly around them, medullary rays, fine checks and colour banding between earlywood and latewood. `
                + `${fill} ${MONO} ${GRAPHIC} ${DETAIL} ${lit} Show ${face}.`;
        }
        const face = `the largest broad flat FACE / main surface of ${name}, as one continuous uniform surface`;
        return `${orig} ${size} ${featureHint(name, group, spec)} ${fill} ${MONO} ${GRAPHIC} ${DETAIL} ${lit} Show ${face}.`;
    }

    // section — a cut cross-section, fitted to the face (never tiled)
    let sec: string;
    if (isPlywood(name)) sec = `the cut EDGE cross-section of a ${name} panel: a horizontal stack of many (~9) thin wood veneer plies glued together, a striped layered edge. This is the thin cut side, NOT the broad grain face`;
    else if (isOSB(name)) sec = `the cut EDGE cross-section of an OSB board: densely compressed wood strands and flakes bonded in layers, seen from the thin side, NOT the flat face`;
    else if (isLaminatedTimber(name)) sec = `the cut cross-section of ${name}: several stacked glued solid-timber laminations (thick layers), NOT the broad face`;
    else if (isPressedBoard(name)) sec = `the cut EDGE cross-section of ${name}: a dense uniform pressed wood-fibre core seen from the thin side, NOT the face`;
    else if (group === 'wood')
    {
        // Rings run from the pith to the edge, so the count spans the RADIUS — half the
        // frame. Derived from the same spacing the longitudinal face uses.
        const rings = Math.round((spec.realWidth / 2) / RING_SPACING_MM);
        return `${orig} ${size} `
            + `Show the END-GRAIN cross-section of solid ${name} — a slice cut straight across the trunk, showing concentric annual growth rings and radial grain as seen looking at the sawn end of a log or beam. `
            + `RING SCALE — this is the single most important instruction: the annual growth rings of this timber are ${RING_SPACING_MM} mm apart, so from the centre out to the edge of this ${spec.realWidth} mm frame there must be ROUGHLY ${rings} rings. Not dramatically more, not fewer — the ring spacing must read as ${RING_SPACING_MM} mm at this scale. `
            + `Rings must be thin crisp lines, NOT thick bands, unevenly spaced (narrow dense bands alternating with wider ones), and NOT perfect circles: they wander and go slightly oval, as real timber does. `
            + `Between the rings show fine radial grain: many hairline rays running outward from the centre, plus radial shrinkage checks splitting across several rings, and the small offset dense pith at the very centre. `
            + `CRITICAL: ${fill} Show NO bark and no outer non-essential material; only the clean inner cross-cut timber. `
            + `${MONO} ${GRAPHIC} ${DETAIL} ${lit}`;
    }
    // Non-wood cross-section: whatever the cut through the material's body reveals.
    else sec = `the CUT CROSS-SECTION through solid ${name} — the internal body revealed by a saw cut: aggregate, grains, voids, fibres or layers as appropriate to the material. NOT the outer finished face`;

    return `${orig} ${size} ${featureHint(name, group, spec)} ${fill} ${MONO} ${GRAPHIC} ${DETAIL} ${lit} Show ${sec}.`;
}

/**
 * Aspect ratios the Gemini image model accepts. VERIFIED against the API — it rejects
 * the extreme ones (1:4, 1:8, 4:1, 8:1) with a 400, so 9:16 / 16:9 are the practical
 * limits. Do not add ratios back without probing the model first: an unsupported value
 * makes generateImage() fall back to no hint at all, which quietly yields a square.
 */
const SUPPORTED_ASPECTS: Array<[string, number]> = [
    ['9:16', 0.5625], ['2:3', 2 / 3], ['3:4', 0.75], ['4:5', 0.8], ['1:1', 1],
    ['5:4', 1.25], ['4:3', 4 / 3], ['3:2', 1.5], ['16:9', 16 / 9], ['21:9', 21 / 9],
];

/**
 * The supported aspects ordered by how close they are to a desired width:height,
 * closest first. Used to retry when the model silently ignores the requested ratio
 * (it does this for the extreme ones, e.g. 1:8, and just returns a square).
 */
function aspectsNearest(w: number, h: number): Array<[string, number]>
{
    const target = w / h;
    return [...SUPPORTED_ASPECTS].sort(
        (a, b) => Math.abs(a[1] - target) - Math.abs(b[1] - target));
}

/**
 * Pixel dimensions of a generated image. The model returns PNG or JPEG regardless of
 * our .jpg filename (MaterialManager sniffs the mime the same way), so handle both.
 */
function imageSize(buf: Buffer): { width: number; height: number } | null
{
    // PNG: IHDR width/height are the two big-endian u32 at offset 16.
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50)
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };

    // JPEG: walk the segment chain to the SOF marker.
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    let i = 2;
    while (i < buf.length - 9)
    {
        if (buf[i] !== 0xFF) { i++; continue; }
        let m = buf[i + 1];
        while (m === 0xFF) { i++; m = buf[i + 1]; }          // fill bytes
        if (m === 0x01 || (m >= 0xD0 && m <= 0xD9)) { i += 2; continue; } // standalone
        const isSOF = m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
        if (isSOF) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
}

/** Generate one image, retrying past transient IMAGE_RECITATION / empty results.
 *  Requests the given aspect ratio; falls back to no aspect hint if the model rejects it.
 *  Returns the image bytes, or null when the model never produced one. */
async function generateImage(prompt: string, aspect?: string, attempts = 3): Promise<Buffer | null>
{
    let useAspect = aspect;
    for (let i = 0; i < attempts; i++)
    {
        let res;
        try
        {
            res = await ai.models.generateContent({
                model: CONFIG.imageModel,
                contents: prompt,
                ...(useAspect ? { config: { imageConfig: { aspectRatio: useAspect } } as any } : {}),
            });
        }
        catch (e)
        {
            // The model may reject an unsupported aspect ratio — retry without the hint.
            if (useAspect) { useAspect = undefined; continue; }
            throw e;
        }
        const cand = res.candidates?.[0];
        for (const part of cand?.content?.parts ?? [])
        {
            const data = (part as any).inlineData?.data;
            if (data) return Buffer.from(data, 'base64');
        }
        // no image (often finishReason IMAGE_RECITATION) — retry with a nudge
        if (i < attempts - 1) prompt += ' Make it a distinct, non-photographic procedural pattern.';
    }
    return null;
}

/** Accept a returned aspect within 5% of the requested one. */
const ASPECT_TOLERANCE = 0.05;

/**
 * Generate an image at (as close as possible to) the desired mm proportions, and report
 * the real-world size the result ACTUALLY represents.
 *
 * The model silently ignores its more extreme aspect ratios — ask for 1:8 and it hands
 * back a square without complaint — so we verify the returned pixel ratio and retry down
 * the list of nearby supported aspects. Whatever we end up with, `realHeight` is derived
 * from the true pixel ratio: the stored mm size must describe the image on disk, or every
 * UV mapping stretches by the discrepancy.
 */
async function generateSized(
    promptOf: (spec: RoleSpec) => string, outPath: string, want: RoleSpec,
): Promise<{ realWidth: number; realHeight: number; aspect: string; exact: boolean } | null>
{
    const target = want.realWidth / want.realHeight;
    const candidates = aspectsNearest(want.realWidth, want.realHeight).slice(0, 3);
    let last: { buf: Buffer; size: { width: number; height: number }; aspect: string } | null = null;

    for (const [aspect, ratio] of candidates)
    {
        const realHeight = Math.round(want.realWidth / ratio);
        const buf = await generateImage(promptOf({ ...want, realHeight }), aspect);
        if (!buf) continue;
        const size = imageSize(buf);
        if (!size) { last = { buf, size: { width: 1, height: 1 }, aspect }; break; }

        const got = size.width / size.height;
        last = { buf, size, aspect };
        if (Math.abs(got - target) / target <= ASPECT_TOLERANCE) break; // honoured — done
        // else: the model ignored the hint; try the next-nearest supported aspect
    }

    if (!last) return null;
    // Textures are tint masks, so all three channels are identical — store one.
    // Roughly a 60% saving per file, and a no-op if the model ever returns JPEG.
    writeFileSync(outPath, toGreyscalePNG(last.buf));
    const realHeight = Math.round(want.realWidth * last.size.height / last.size.width);
    const exact = Math.abs((last.size.width / last.size.height) - target) / target <= ASPECT_TOLERANCE;
    return { realWidth: want.realWidth, realHeight, aspect: last.aspect, exact };
}

/**
 * Drop texture entries (and their files) for roles a material's group no longer declares
 * in ROLES. Keeps the table authoritative: change ROLES, run `--prune`, done — no API
 * calls and no hand-editing of materials.json.
 */
function prune(db: any): void
{
    let removedEntries = 0, removedFiles = 0;

    for (const m of db.materials as any[])
    {
        const allowed = ROLES[m.group] ?? ROLES.default;
        const textures = m.viz?.textures;
        if (!textures) continue;

        for (const role of Object.keys(textures))
        {
            if (allowed[role as Role]) continue;

            const image = textures[role]?.image;
            delete textures[role];
            removedEntries++;
            console.log(`- ${m.name}/${role} removed (group '${m.group}' has no ${role})`);

            if (image)
            {
                const file = join(TEX_DIR, image.replace(/^.*[/\\]/, ''));
                if (existsSync(file)) { rmSync(file); removedFiles++; }
            }
        }
        if (!Object.keys(textures).length) delete m.viz.textures;
    }

    writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n');
    console.log(`\n${removedEntries} texture entr(ies) and ${removedFiles} file(s) removed.`);
}

async function main()
{
    if (!existsSync(DB_PATH)) { console.error(`No materials.json at ${DB_PATH} — run generate:data first.`); process.exit(1); }
    mkdirSync(TEX_DIR, { recursive: true });

    const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

    if (process.argv.includes('--prune')) return prune(db);

    // Optional filter: `npm run generate:textures -- wood` (group) or `-- douglas oak` (names).
    // A material matches when its group OR name is listed; no args → all materials.
    const filter = process.argv.slice(2).filter(a => !a.startsWith('--')).map(s => s.toLowerCase());
    const matches = (m: any) => filter.length === 0 || filter.includes(m.group) || filter.includes(m.name.toLowerCase());
    if (filter.length) console.log(`Filter: ${filter.join(', ')} → ${(db.materials as any[]).filter(matches).length} material(s)`);

    for (const m of db.materials as any[])
    {
        if (!matches(m)) continue;
        const roles = ROLES[m.group] ?? ROLES.default;
        const textures: Record<string, any> = {};
        for (const [role, spec] of Object.entries(roles) as [Role, RoleSpec][])
        {
            if (!spec) continue;
            const file = `${m.name.replace(/\s+/g, '_')}_${role}.jpg`;
            const outPath = join(TEX_DIR, file);
            process.stdout.write(`- ${m.name}/${role} … `);
            try
            {
                const res = await generateSized(
                    (s) => promptFor(m.name, m.group, role, s), outPath, spec);
                if (res)
                {
                    const entry: any = { image: `./textures/${file}`, realWidth: res.realWidth, realHeight: res.realHeight };
                    if (spec.repeat === false) entry.repeat = false; // fit-to-face crop, don't tile
                    textures[role] = entry;
                    const note = res.exact ? '' : ` — model would not honour ${spec.realWidth}×${spec.realHeight}, stored actual`;
                    console.log(`ok (${res.realWidth}×${res.realHeight} mm${note})`);
                }
                else { console.log('no image returned'); }
            }
            catch (e) { console.log(`FAILED (${(e as Error).message})`); }
        }
        if (Object.keys(textures).length) m.viz = { ...(m.viz ?? {}), textures };
    }

    writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n');
    console.log(`\nPatched textures into ${DB_PATH}; images in ${TEX_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
