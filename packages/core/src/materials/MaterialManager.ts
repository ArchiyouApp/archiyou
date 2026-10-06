/**
 *  materials/MaterialManager.ts
 *
 *  Central registry of materials. Loads the materials.json database, resolves
 *  names/aliases, and performs unit-system-aware derived calculations (mass /
 *  weight) and property read-out.
 *
 *  Wired like the other archiyou modules (see Calc.ts): construct empty, then
 *  setArchiyou(modules) to gain access to the modeler (units) and shapes.
 */

import { Check, Errors } from 'typebox/value';

import type { ArchiyouModules } from '../types';
import type {
    LCAModule, Material, MaterialLCA, MaterialProperty, MaterialPropertyKey, MaterialRenderSpec,
    MaterialTotalRow, MaterialTotals,
} from './types';
import { EMBODIED_MODULES, MATERIAL_PROPERTY_KEYS } from './types';
import { MaterialSchema } from './schemas';
import { MM_PER_UNIT } from '../units/UnitConverter';

import materialsDb from './materials.json';

/** Pounds per kilogram, for imperial mass read-out. */
const LB_PER_KG = 2.2046226218;

/** The bundled database is checked against MaterialSchema once per load of this module. Every
 *  run builds a new MaterialManager, and checking it each time cost ~4.5 ms per run: half of a
 *  small script's run, and again for every component activation. */
let materialsDbChecked = false;

/** Resolve a bundled texture file to a fetchable URL (Vite emits ./textures/* as assets). */
function textureUrl(filename: string): string | null
{
    try { return new URL(`./textures/${filename}`, import.meta.url).href; }
    catch { return null; }
}

/**
 * Read a bundled texture's bytes.
 *
 * In the browser/worker the asset URL is http(s) and fetch handles it. Under Node —
 * which the server-side execution worker uses — Vite resolves the same asset to a
 * `file://` URL, and Node's fetch refuses those. Without the filesystem fallback,
 * server-rendered GLBs come out silently untextured.
 */
async function loadBytes(url: string): Promise<Uint8Array>
{
    if (url.startsWith('file:'))
    {
        // The specifiers are built at runtime on purpose: a static `import('node:fs')`
        // would be followed by the browser bundler, which then either warns loudly or
        // fails, even though this branch is unreachable outside Node.
        const nodeImport = (m: string) => import(/* @vite-ignore */ `node:${m}`);
        const [{ readFile }, { fileURLToPath }] = await Promise.all([
            nodeImport('fs/promises'), nodeImport('url'),
        ]);
        return new Uint8Array(await readFile(fileURLToPath(url)));
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

/**
 * Scale a tint mask's deviation from white: `out = 1 - (1 - v) * strength`.
 *
 * One axis in both directions. Below 1 the linework fades toward white — which, once
 * glTF multiplies the mask by baseColorFactor, means fading toward the material's flat
 * colour. Above 1 it deepens, making the drawing read more strongly.
 *
 * Anchored at white so the material never shifts off its declared hue: white stays white
 * at any strength, only the ink moves.
 *
 * This has to touch actual pixels — glTF multiplies texture by factor, and no factor can
 * rescale contrast. Doing it here rather than in the viewer means the result survives
 * export, so a downloaded GLB looks like what was on screen.
 *
 * Canvas APIs only, so this is a browser/worker path; in Node the mask is left as
 * authored (see the caller's warning). The generator already bakes a baseline strength
 * into the files, so Node output is still correct, just not tunable.
 */
async function scaleTextureStrength(dataUri: string, strength: number): Promise<string>
{
    const g: any = globalThis as any;
    if (typeof g.createImageBitmap !== 'function' || typeof g.OffscreenCanvas !== 'function')
        return dataUri;

    const blob = await (await fetch(dataUri)).blob();
    const bitmap = await g.createImageBitmap(blob);
    const canvas = new g.OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUri;

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    // 256-entry LUT rather than per-pixel maths — these are multi-megapixel images.
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++)
        lut[v] = Math.max(0, Math.min(255, Math.round(255 - (255 - v) * strength)));

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    ctx.putImageData(img, 0, 0);

    // Note: canvas re-encodes to RGB, so an adjusted mask loses the single-channel
    // packing the generator applied. Only pays when strength !== 1, which is the default.
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return `data:image/png;base64,${bytesToBase64(new Uint8Array(await out.arrayBuffer()))}`;
}

/** Sniff image mime type from the leading magic bytes (files may be PNG or JPEG). */
function sniffMime(b: Uint8Array): string
{
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    return 'image/png';
}

/** Base64-encode bytes in either Node (Buffer) or the browser/worker (btoa). */
function bytesToBase64(bytes: Uint8Array): string
{
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK)
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
    return btoa(bin);
}

/**
 * Classify an EPD's declared unit. ÖKOBAUDAT mixes SI symbols with German
 * abbreviations — `qm` (Quadratmeter) is m², `cbm` (Kubikmeter) is m³ — so matching
 * 'm2'/'m3' alone silently misreads a large share of the database.
 */
function declaredUnitKind(unit: string): 'mass' | 'volume' | 'area' | 'other'
{
    switch (unit.trim().toLowerCase())
    {
        // Only kg — a tonne declaration would need a 1000× factor, and treating it as
        // mass here would be off by exactly that, silently.
        case 'kg':                                    return 'mass';
        case 'm3': case 'm^3': case 'm³': case 'cbm': return 'volume';
        case 'm2': case 'm^2': case 'm²': case 'qm':  return 'area';
        default:                                     return 'other';
    }
}

/** Default thickness (mm) below which board faces use the `thinSides` texture. */
export const DEFAULT_THIN_SIDE_THRESHOLD_MM = 25;

/**
 * Outline colour. `'material'` derives it from the material's own `viz.pbr.color`,
 * darkened by DEFAULT_MATERIAL_LINE_DARKEN — so a timber part gets a deep brown outline
 * rather than a hard technical black, while staying legible against its own surface.
 * Any CSS colour string here instead pins every material to that literal colour.
 */
export const DEFAULT_MATERIAL_LINE_COLOR: string = 'material';

/**
 * How far the derived outline is darkened from the base colour (0 = black, 1 = the
 * literal base colour).
 *
 * Not 1: an outline in exactly the surface colour is invisible, which is the bug this
 * whole path had before — edges were being drawn, in the same colour as the face they
 * sat on. 0.45 keeps the hue clearly readable while still reading as a contour.
 */
export const DEFAULT_MATERIAL_LINE_DARKEN = 0.45;

/**
 * Outline weight, in pixels.
 *
 * 1 is a hairline: the viewer renders it with THREE.LineBasicMaterial, which is the
 * cheaper path but whose linewidth WebGL ignores — so 1 is effectively the *only* width
 * that path can draw. Any value above 1 switches to LineSegments2/LineMaterial, which
 * honours the width but costs more per line on a large scene.
 */
export const DEFAULT_MATERIAL_LINE_OPACITY = 1.0;
export const DEFAULT_MATERIAL_LINE_WIDTH = 1;

/** Parse `#rgb`/`#rrggbb` to 0..255 components. Null when it is not a plain hex colour. */
function parseHex(color: string): [number, number, number] | null
{
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Scale a hex colour toward black by `factor` (0..1). Falls back to black. */
function darken(color: string, factor: number): string
{
    const rgb = parseHex(color);
    if (!rgb) return '#000000';
    const to2 = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)))
        .toString(16).padStart(2, '0');
    return `#${to2(rgb[0])}${to2(rgb[1])}${to2(rgb[2])}`;
}

/**
 * How strongly a material's texture reads.
 *
 * Scales the mask's deviation from white: below 1 the linework fades toward the flat
 * material colour, above 1 it deepens. Defaults to 1 because the generator already
 * auto-levels every mask to a baseline strength (autoContrast in png-grey.ts) — this is
 * the per-script adjustment on top of that, not the primary control.
 */
export const DEFAULT_MATERIAL_TEXTURE_STRENGTH = 1.0;

/**
 * A material bound to a specific shape. Returned by `shape.material()` (getter).
 * Adds derived calculations that need the shape's geometry (volume).
 */
export class BoundMaterial
{
    readonly material: Material;
    private _manager: MaterialManager;
    private _shape: any; // AnySmartShape — kept loose to avoid a circular import

    constructor(manager: MaterialManager, material: Material, shape?: any)
    {
        this._manager = manager;
        this.material = material;
        this._shape = shape;
    }

    get name(): string { return this.material.name; }
    get group(): string { return this.material.group; }

    /** Density as a {value,unit} in the active unit system. */
    density(): MaterialProperty | undefined { return this._manager.property(this.material, 'density'); }

    /** Any property, converted to the active unit system where possible. */
    property(key: MaterialPropertyKey): MaterialProperty | undefined
    {
        return this._manager.property(this.material, key);
    }

    /** Raw underlying property (canonical SI), unconverted. */
    raw(key: MaterialPropertyKey): MaterialProperty | undefined
    {
        return this.material[key] as MaterialProperty | undefined;
    }

    /**
     * Mass of the bound shape in the active unit system (kg metric / lb imperial).
     * Requires a solid shape with a volume() method.
     */
    mass(): number | undefined
    {
        if (!this._shape || typeof this._shape.volume !== 'function')
        {
            console.warn(`Material::mass(): material '${this.name}' is not bound to a solid shape`);
            return undefined;
        }
        const volumeModelUnits = this._shape.volume();
        return this._manager.massFor(this.material, volumeModelUnits);
    }

    /** Alias of mass() — the colloquial "weight" (a mass read-out, not a force). */
    weight(): number | undefined { return this.mass(); }

    /** The raw EN 15804 life-cycle block, or undefined when the material has no EPD. */
    lca(): MaterialLCA | undefined { return this.material.lca; }

    /**
     * kgCO2e per kilogram for the given life-cycle modules.
     *   'embodied' (default) — cradle to gate, A1-A3
     *   'total'              — every module the EPD declares
     *   LCAModule[]          — an explicit selection
     * Returns undefined when the material has no usable data, rather than 0 — an
     * unknown impact must never silently read as a zero impact.
     */
    carbonIntensity(modules: LCAModule[] | 'embodied' | 'total' = 'embodied'): number | undefined
    {
        return this._manager.carbonIntensityOf(this.material, modules);
    }

    /**
     * Total kgCO2e for the bound shape: its mass × the per-kg intensity.
     * Always in kilograms of CO2e regardless of unit system — the impact of a beam does
     * not change because the user is reading its size in inches.
     */
    carbon(modules: LCAModule[] | 'embodied' | 'total' = 'embodied'): number | undefined
    {
        const perKg = this.carbonIntensity(modules);
        if (perKg === undefined) return undefined;
        const massKg = this._manager.massKgFor(this.material, this._shapeVolume());
        return massKg === undefined ? undefined : massKg * perKg;
    }

    /** Volume of the bound shape in model units³, or undefined when not a solid. */
    private _shapeVolume(): number | undefined
    {
        if (!this._shape || typeof this._shape.volume !== 'function')
        {
            console.warn(`Material::carbon(): material '${this.name}' is not bound to a solid shape`);
            return undefined;
        }
        return this._shape.volume();
    }

    /** Multi-line, human readable read-out (used for console pretty-print). */
    describe(): string { return this._manager.describe(this.material); }

    toString(): string { return this.describe(); }

    // Node console pretty-print
    [Symbol.for('nodejs.util.inspect.custom')](): string { return this.describe(); }
}

export class MaterialManager
{
    //// SETTINGS ////
    thinSideThresholdMM = DEFAULT_THIN_SIDE_THRESHOLD_MM;
    /** Outline colour: 'material' derives it from the material, or a literal CSS colour. */
    materialLineColor: string = DEFAULT_MATERIAL_LINE_COLOR;
    /** How far a derived outline is darkened from the base colour (0 = black, 1 = base). */
    materialLineDarken = DEFAULT_MATERIAL_LINE_DARKEN;
    /** Opacity of that outline (0..1) — slightly transparent to sit in the texture. */
    materialLineOpacity = DEFAULT_MATERIAL_LINE_OPACITY;
    /** Width of that outline, in pixels. */
    materialLineWidth = DEFAULT_MATERIAL_LINE_WIDTH;
    /** How strongly textures read: <1 fades toward the flat colour, >1 deepens. */
    materialTextureStrength = DEFAULT_MATERIAL_TEXTURE_STRENGTH;
    //// END SETTINGS ////

    _archiyou!: ArchiyouModules;
    private _index = new Map<string, Material>();
    /** Cache of loaded texture images: image path → data URI. */
    private _texCache = new Map<string, string>();

    constructor()
    {
        // use setArchiyou() to init; load the DB immediately so lookups work standalone (tests)
        this.load();
    }

    setArchiyou(ay: ArchiyouModules)
    {
        this._archiyou = ay;
        if (this._index.size === 0) this.load();
    }

    /** (Re)build the name/alias index from the bundled database. */
    load()
    {
        this._index.clear();
        const materials = ((materialsDb as any)?.materials ?? []) as Material[];
        if (!materialsDbChecked)
        {
            materials.forEach(m =>
            {
                // Warn, never throw: one malformed entry must not break a user's script.
                if (!Check(MaterialSchema, m))
                {
                    const first = [...Errors(MaterialSchema, m)][0] as any;
                    console.warn(`MaterialManager: material '${(m as any)?.name ?? '?'}' fails schema`
                        + `${first ? ` at ${first.path ?? '?'}: ${first.message}` : ''}`);
                }
            });
            materialsDbChecked = true;
        }
        materials.forEach(m =>
        {
            this._index.set(m.name.toLowerCase(), m);
            (m.aliases ?? []).forEach(a => this._index.set(a.toLowerCase(), m));
        });
    }

    /** All materials in the database. */
    all(): Material[]
    {
        return [...new Set(this._index.values())];
    }

    /** Look up a material definition by name or alias. */
    get(name: string): Material | null
    {
        if (!name) return null;
        return this._index.get(name.toLowerCase()) ?? null;
    }

    /** Whether a material name/alias is known. */
    has(name: string): boolean { return !!this.get(name); }

    /**
     * Resolve a material by name, optionally bound to a shape so mass/weight
     * calculations work. Warns and returns null on unknown names.
     */
    resolve(name?: string, shape?: any): BoundMaterial | null
    {
        if (!name) return null;
        const m = this.get(name);
        if (!m)
        {
            console.warn(`MaterialManager::resolve(): unknown material '${name}'`);
            return null;
        }
        return new BoundMaterial(this, m, shape);
    }

    /** The active display unit system, from the modeler (defaults metric). */
    private unitSystem(): 'metric' | 'imperial'
    {
        return this._archiyou?.modeler?.unitSystem?.() ?? 'metric';
    }

    /** Millimetres per one model unit (geometry space). */
    private modelUnitMM(): number
    {
        const u = this._archiyou?.modeler?.units?.() ?? 'mm';
        return MM_PER_UNIT[u] ?? 1;
    }

    /**
     * Mass of a volume (given in model-unit³) for a material, presented in the
     * active unit system: kilograms (metric) or pounds (imperial).
     */
    massFor(material: Material, volumeModelUnits: number): number | undefined
    {
        const density = material.density?.value;
        if (density === undefined)
        {
            console.warn(`MaterialManager: material '${material.name}' has no density; cannot compute mass`);
            return undefined;
        }
        // model-unit³ → m³ : (mm per unit / 1000)³ metres per unit, cubed
        const metresPerUnit = this.modelUnitMM() / 1000;
        const volumeM3 = volumeModelUnits * metresPerUnit ** 3;
        const massKg = density * volumeM3; // density is kg/m³
        return this.unitSystem() === 'imperial' ? massKg * LB_PER_KG : massKg;
    }

    /**
     * Mass in KILOGRAMS for a volume in model-unit³ — the unit-system-independent
     * counterpart of massFor(), used wherever a physical quantity (carbon) must not
     * change with the user's display preference.
     */
    massKgFor(material: Material, volumeModelUnits?: number): number | undefined
    {
        const density = material.density?.value;
        if (density === undefined || volumeModelUnits === undefined) return undefined;
        const metresPerUnit = this.modelUnitMM() / 1000;
        return density * volumeModelUnits * metresPerUnit ** 3;
    }

    /**
     * kgCO2e per kilogram of a material for the given life-cycle modules.
     *
     * Prefers the full `lca` block (published EPD, per declared unit) and converts to
     * per-kg using the EPD's OWN declared density. Falls back to the flat `carbon`
     * summary — but only for the embodied (A1-A3) case, since that is all the flat
     * field represents.
     */
    carbonIntensityOf(
        material: Material,
        modules: LCAModule[] | 'embodied' | 'total' = 'embodied',
    ): number | undefined
    {
        const lca = material.lca;
        if (!lca)
        {
            if (modules !== 'embodied') return undefined;
            return material.carbon?.value;
        }

        const wanted: LCAModule[] = modules === 'total'
            ? (Object.keys(lca.modules) as LCAModule[])
            : modules === 'embodied' ? EMBODIED_MODULES : modules;

        const sum = this.sumModules(lca, wanted);
        if (sum === undefined) return undefined;

        const perDeclaredUnit = sum / (lca.declaredUnitValue ?? 1);
        switch (declaredUnitKind(lca.declaredUnit))
        {
            case 'mass':
                return perDeclaredUnit;
            case 'volume':
            {
                // The EPD's own gross density, else ours — never a guess.
                const density = lca.density?.value ?? material.density?.value;
                return density ? perDeclaredUnit / density : undefined;
            }
            default:
                // Area ('qm'/m2) and piece declarations depend on a thickness or size
                // this module does not know. No honest per-kg figure exists.
                return undefined;
        }
    }

    /**
     * Sum selected modules of an LCA block, in kgCO2e per declared unit.
     *
     * A1A3 and its constituents A1/A2/A3 are the same impact declared two ways, so
     * taking both would double-count: prefer the aggregate when present. Modules the
     * EPD does not declare are skipped (absent ≠ zero); undefined is returned only when
     * NONE of the requested modules exist.
     */
    private sumModules(lca: MaterialLCA, wanted: LCAModule[]): number | undefined
    {
        const has = (m: LCAModule) => lca.modules[m]?.value;
        const useAggregate = wanted.includes('A1A3') && has('A1A3') !== undefined;

        let sum = 0, found = false;
        for (const m of wanted)
        {
            if (useAggregate && (m === 'A1' || m === 'A2' || m === 'A3')) continue;
            const v = has(m);
            if (v === undefined) continue;
            sum += v;
            found = true;
        }
        return found ? sum : undefined;
    }

    /**
     * Aggregate mass and carbon per material across a set of shapes (default: the whole
     * active scene). Rows are shaped for calc.table('carbon', …) — see calc/schemas.ts.
     *
     * Shapes without a material, or materials without usable data, contribute what they
     * can and no more: a row's `carbon` is undefined rather than 0 when unknown, and the
     * grand total reports how many shapes it could not account for.
     */
    totals(shapes?: any): MaterialTotals
    {
        const list: any[] = Array.isArray(shapes)
            ? shapes
            : (typeof shapes?.all === 'function' ? shapes.all()
                : (this._archiyou?.modeler?.scene?.()?.shapes?.()?.all?.() ?? []));

        const rows = new Map<string, MaterialTotalRow>();
        let unaccounted = 0;

        for (const shape of list)
        {
            const name = shape?._material;
            const material = name ? this.get(name) : null;
            if (!material) { unaccounted++; continue; }

            const volume = typeof shape.volume === 'function' ? shape.volume() : undefined;
            const massKg = this.massKgFor(material, volume);
            const perKg = this.carbonIntensityOf(material, 'embodied');

            let row = rows.get(material.name);
            if (!row)
            {
                row = { name: material.name, group: material.group, count: 0, volume: 0, mass: 0 };
                rows.set(material.name, row);
            }
            row.count++;
            if (volume !== undefined) row.volume += volume;
            if (massKg !== undefined) row.mass += massKg;
            if (massKg !== undefined && perKg !== undefined)
                row.carbon = (row.carbon ?? 0) + massKg * perKg;
            else row.partial = true;
        }

        const byMaterial = [...rows.values()].sort((a, b) => (b.carbon ?? 0) - (a.carbon ?? 0));
        return {
            byMaterial,
            total: {
                mass: byMaterial.reduce((s, r) => s + r.mass, 0),
                carbon: byMaterial.reduce((s, r) => s + (r.carbon ?? 0), 0),
                unaccounted,
            },
        };
    }

    /**
     * Return a property in the active unit system. Density is converted
     * kg/m³ ↔ lb/ft³; other properties pass through (their SI units are
     * system-neutral). Missing properties return undefined.
     */
    property(material: Material, key: MaterialPropertyKey): MaterialProperty | undefined
    {
        const p = material[key] as MaterialProperty | undefined;
        if (!p) return undefined;
        if (key === 'density' && this.unitSystem() === 'imperial')
        {
            // 1 kg/m³ = 0.0624279606 lb/ft³
            return { ...p, value: p.value * 0.0624279606, unit: 'lb/ft3' };
        }
        return p;
    }

    /**
     * Build the compact render spec threaded into the meshup GLTF builder.
     * Always returns a spec — a material without any `viz` block still carries the
     * edge style, so every materialized shape gets its distinguishing outline.
     */
    renderSpec(material: Material): MaterialRenderSpec
    {
        const viz = material.viz;
        return {
            name: material.name,
            pbr: viz?.pbr,
            textures: viz?.textures as MaterialRenderSpec['textures'],
            edge: {
                color: this.edgeColorFor(material),
                opacity: this.materialLineOpacity,
                width: this.materialLineWidth,
            },
            textureStrength: this.materialTextureStrength,
            thinSideThresholdMM: this.thinSideThresholdMM,
            modelUnitMM: this.modelUnitMM(),
        };
    }

    /**
     * The outline colour for a material.
     *
     * With the default `'material'` setting this is the material's own base colour taken
     * toward black by `materialLineDarken`, so the contour keeps the material's hue
     * instead of reading as a hard technical black. Set `materialLineColor` to a literal
     * CSS colour to pin every material to the same outline.
     */
    edgeColorFor(material: Material): string
    {
        if (this.materialLineColor !== 'material') return this.materialLineColor;
        const base = material.viz?.pbr?.color;
        return base ? darken(base, this.materialLineDarken) : '#000000';
    }

    /**
     * Load a texture image (by its materials.json path, e.g. './textures/x.jpg')
     * and return it as a base64 data URI, cached. Returns null if unavailable.
     */
    async loadTextureDataURI(imagePath: string): Promise<string | null>
    {
        if (this._texCache.has(imagePath)) return this._texCache.get(imagePath)!;
        const filename = imagePath.replace(/^.*[/\\]/, ''); // basename
        const url = textureUrl(filename);
        if (!url) return null;
        try
        {
            const bytes = await loadBytes(url);
            const dataUri = `data:${sniffMime(bytes)};base64,${bytesToBase64(bytes)}`;
            this._texCache.set(imagePath, dataUri);
            return dataUri;
        }
        catch (e)
        {
            console.warn(`MaterialManager: could not load texture '${imagePath}': ${(e as Error).message}`);
            return null;
        }
    }

    /**
     * Fill in the base64 `data` for every material texture referenced by the given
     * shapes' render specs, so the GLTF builder can bake them into the GLB. Called
     * from the async export path (Modeler.toGLB). No-op when nothing carries textures.
     */
    async embedTexturesInShapes(shapes: any): Promise<void>
    {
        // Accept a plain array or a SmartShapeCollection (.all()).
        const list: any[] = Array.isArray(shapes)
            ? shapes
            : (typeof shapes?.all === 'function' ? shapes.all() : []);
        for (const shape of list)
        {
            const spec = shape?.style?.material;
            if (!spec || typeof spec !== 'object' || !spec.textures) continue;

            const strength = spec.textureStrength ?? 1;

            for (const role of ['sides', 'section'] as const)
            {
                const tex = spec.textures[role];
                if (!tex?.image || tex.data) continue;

                let data = await this.loadTextureDataURI(tex.image);
                if (!data) continue;
                if (strength !== 1)
                {
                    // Masks are greyscale and anchored at white, so the adjustment is
                    // material-independent — hence shareable and cacheable across every
                    // material that uses this image.
                    const scaled = await this._scaledTexture(tex.image, data, strength);
                    if (scaled === data) this._warnNoScale();
                    data = scaled;
                }
                tex.data = data;
            }
        }
    }

    /** Cache of strength-adjusted textures: `${imagePath}@${strength}` → data URI. */
    private _strengthCache = new Map<string, string>();

    /** Rescale a greyscale mask's ink, memoised across every material using it. */
    private async _scaledTexture(imagePath: string, data: string, strength: number): Promise<string>
    {
        const key = `${imagePath}@${strength}`;
        const hit = this._strengthCache.get(key);
        if (hit) return hit;
        const scaled = await scaleTextureStrength(data, strength);
        this._strengthCache.set(key, scaled);
        return scaled;
    }

    private _scaleWarned = false;

    /** Warn once: canvas-less runtimes (Node) can't rescale, so masks export as authored. */
    private _warnNoScale()
    {
        if (this._scaleWarned) return;
        this._scaleWarned = true;
        console.warn('MaterialManager: materialTextureStrength needs OffscreenCanvas '
            + '(browser/worker); textures are embedded as authored here.');
    }

    /** Human-readable, multi-line read-out of a material's known properties. */
    describe(material: Material): string
    {
        const lines: string[] = [];
        lines.push(`Material: ${material.name}${material.group ? ` (${material.group})` : ''}`);
        if (material.aliases?.length) lines.push(`  aliases: ${material.aliases.join(', ')}`);
        if (material.description) lines.push(`  ${material.description}`);
        for (const key of MATERIAL_PROPERTY_KEYS)
        {
            const p = this.property(material, key);
            if (p) lines.push(`  ${key}: ${p.value} ${p.unit}`);
        }
        return lines.join('\n');
    }
}
