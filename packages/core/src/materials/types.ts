/**
 *  materials/types.ts
 *
 *  Type definitions for the archiyou materials system.
 *
 *  Canonical storage is SI: densities in kg/m³, lengths (texture real sizes) in mm.
 *  Conversion to a user's unit system (metric/imperial) happens at read time in
 *  the MaterialManager — the stored data is never mutated.
 */

/** A single measurable material property with its canonical (SI) unit. */
export interface MaterialProperty
{
    /** Numeric value in the canonical `unit`. */
    value: number;
    /** Canonical unit string, e.g. 'kg/m3', 'W/mK', 'MPa'. */
    unit: string;
    /** Human-readable explanation of the property. */
    description?: string;
    /** Where the value came from (citation), for validation/cross-check. */
    source?: string;
}

/** A texture image mapped at a real-world size (always in millimetres). */
export interface MaterialTexture
{
    /** Path (relative to materials/) or data-URI of the image. */
    image: string;
    /** Real-world width the image spans, in mm. */
    realWidth: number;
    /** Real-world height the image spans, in mm. */
    realHeight: number;
    /**
     * Whether the texture tiles across the face (default true). When false — used
     * for `section` (cross-section) textures — the image is fitted once to the face
     * (UVs normalized 0..1, clamped) instead of repeating at real-world scale.
     */
    repeat?: boolean;
}

/** Physically-based rendering surface parameters. */
export interface MaterialPBR
{
    /** CSS color string for base color, e.g. '#b5651d'. */
    color?: string;
    /** Opacity 0..1. */
    alpha?: number;
    /** Metalness 0..1. */
    metallic?: number;
    /** Roughness 0..1. */
    roughness?: number;
}

/**
 * Edge/outline style drawn on a shape that carries a material. Materials get a
 * distinguishing outline even when the user set no explicit stroke — a textured
 * part stays legible when its silhouette and hard edges are drawn.
 */
export interface MaterialEdgeSpec
{
    /** CSS color string for the edge lines. */
    color: string;
    /** Line opacity 0..1. */
    opacity: number;
    /** Line width in pixels. */
    width: number;
}

/** Visualization block: textures for the different face roles + PBR fallback. */
export interface MaterialViz
{
    textures?: {
        /** End-grain / cross-section face (normal to the shortest/thickness axis). */
        section?: MaterialTexture;
        /** Long faces of a part. */
        sides?: MaterialTexture;
        /** Thin edge faces of board-like parts (thickness < thinSideThreshold). */
        thinSides?: MaterialTexture;
    };
    pbr?: MaterialPBR;
}

/**
 * EN 15804 life-cycle modules, in standard order.
 *
 *   A1-A3  product stage (raw supply, transport, manufacturing) — usually declared as
 *          the aggregate `A1A3` rather than the three separately
 *   A4-A5  construction stage (transport to site, installation)
 *   B1-B7  use stage (use, maintenance, repair, replacement, refurbishment,
 *          operational energy, operational water)
 *   C1-C4  end of life (deconstruction, transport, waste processing, disposal)
 *   D      benefits and loads beyond the system boundary (reuse/recovery/recycling)
 */
export const LCA_MODULES = [
    'A1', 'A2', 'A3', 'A1A3', 'A4', 'A5',
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7',
    'C1', 'C2', 'C3', 'C4', 'D',
] as const;

export type LCAModule = typeof LCA_MODULES[number];

/** The cradle-to-gate product stage — what "embodied carbon" means by default. */
export const EMBODIED_MODULES: LCAModule[] = ['A1A3', 'A1', 'A2', 'A3'];

/**
 * Life-cycle assessment block for a material, sourced from a published EPD.
 *
 * Sparse by design: only the modules the source actually declares are present. An
 * absent module means "not declared", never zero — summing must skip it rather than
 * treat it as no impact.
 */
export interface MaterialLCA
{
    /** Which version of the standard the source dataset complies with. */
    standard: 'EN 15804+A2' | 'EN 15804+A1';
    /** Which global-warming indicator the values represent. */
    indicator: 'GWP-total' | 'GWP-fossil';
    /** Unit the values are declared per, e.g. 'kg', 'm3', 'm2'. */
    declaredUnit: string;
    /** How many of `declaredUnit` one declaration covers (e.g. 1000 for "per 1000 kg"). */
    declaredUnitValue?: number;
    /**
     * The gross density the EPD itself declares (kg/m³). Present when the declared unit
     * is volumetric — converting to a per-kg figure must use the EPD's own density, not
     * ours, or the result silently mixes two different sources' assumptions.
     */
    density?: MaterialProperty;
    /** kgCO2e per declared unit, keyed by module. Values are as published, unconverted. */
    modules: Partial<Record<LCAModule, MaterialProperty>>;
    /** Optional GWP-biogenic split, same keying. */
    biogenic?: Partial<Record<LCAModule, MaterialProperty>>;
    /** Provenance — mandatory, this data is only worth having if it is traceable. */
    source: {
        /** Human-readable dataset name, e.g. 'ÖKOBAUDAT 2024-I'. */
        dataset: string;
        /** Dataset UUID in the source database. */
        uuid: string;
        /** Dataset version, e.g. '00.02.000'. */
        version: string;
        /** Direct URL to the dataset. */
        url: string;
        /** ISO date the data was retrieved. */
        retrieved: string;
        /** ISO date the EPD expires, when declared. */
        validUntil?: string;
    };
}

/** Broad material grouping (used for range validation and defaults). */
export type MaterialGroup =
    | 'wood' | 'metal' | 'stone' | 'concrete' | 'masonry' | 'glass'
    | 'plastic' | 'insulation' | 'finish' | 'membrane' | 'composite' | 'other';

/** A full material definition. */
export interface Material
{
    name: string;
    group: MaterialGroup;
    aliases?: string[];
    description?: string;

    density?: MaterialProperty;
    porosity?: MaterialProperty;
    moisture?: MaterialProperty;
    diffusion?: MaterialProperty;
    compressive?: MaterialProperty;
    tensile?: MaterialProperty;
    elastic?: MaterialProperty;
    shear?: MaterialProperty;
    thermalConductivity?: MaterialProperty;
    thermalResistance?: MaterialProperty;
    thermalExpansion?: MaterialProperty;
    heatCapacity?: MaterialProperty;
    fireResistance?: MaterialProperty;
    fireReaction?: MaterialProperty;
    carbon?: MaterialProperty;
    energy?: MaterialProperty;
    water?: MaterialProperty;
    toxicity?: MaterialProperty;
    recyclability?: MaterialProperty;

    /**
     * Full EN 15804 life-cycle breakdown from a published EPD. The flat `carbon` field
     * above is the cradle-to-gate (A1-A3) summary derived from this, kept for
     * convenience and for materials that have no EPD match.
     */
    lca?: MaterialLCA;

    viz?: MaterialViz;
}

/** Keys of Material that are MaterialProperty-typed (for iteration/validation). */
export const MATERIAL_PROPERTY_KEYS = [
    'density', 'porosity', 'moisture', 'diffusion', 'compressive', 'tensile',
    'elastic', 'shear', 'thermalConductivity', 'thermalResistance',
    'thermalExpansion', 'heatCapacity', 'fireResistance', 'fireReaction',
    'carbon', 'energy', 'water', 'toxicity', 'recyclability',
] as const;

export type MaterialPropertyKey = typeof MATERIAL_PROPERTY_KEYS[number];

/**
 * One row of a per-material aggregation over a set of shapes.
 * Shaped for `calc.table('carbon', …)` — see calc/schemas.ts.
 */
export interface MaterialTotalRow
{
    name: string;
    group: MaterialGroup;
    /** How many shapes carry this material. */
    count: number;
    /** Summed volume, in model units³. */
    volume: number;
    /** Summed mass, in kilograms (never pounds — a physical total, not a read-out). */
    mass: number;
    /** Summed cradle-to-gate kgCO2e. Undefined when no shape had usable data. */
    carbon?: number;
    /** True when at least one shape's carbon could not be determined. */
    partial?: boolean;
}

/** Result of MaterialManager.totals(). */
export interface MaterialTotals
{
    byMaterial: MaterialTotalRow[];
    total: {
        mass: number;
        carbon: number;
        /** Shapes skipped because they carry no known material. */
        unaccounted: number;
    };
}

/**
 * Compact render spec threaded from core into the meshup GLTF builder via
 * `Style.material`. Carries everything the builder needs to apply PBR + textures
 * at the correct real-world scale without any dependency on the materials module.
 */
export interface MaterialRenderSpec
{
    name: string;
    pbr?: MaterialPBR;
    textures?: {
        section?: MaterialTexture & { data?: string };
        sides?: MaterialTexture & { data?: string };
        thinSides?: MaterialTexture & { data?: string };
    };
    /** Outline style for the shape's hard edges (materials always get one). */
    edge?: MaterialEdgeSpec;
    /**
     * How strongly the textures read. Scales the greyscale mask's deviation from white:
     * below 1 the linework fades toward the material's flat colour, above 1 it deepens.
     * Applied to the embedded bytes, so it survives export rather than being a
     * viewer-only effect.
     */
    textureStrength?: number;
    /** Faces thinner than this (mm) use the `thinSides` texture. */
    thinSideThresholdMM: number;
    /** Millimetres per one model unit — to scale mm texture sizes to model space. */
    modelUnitMM: number;
}
