/**
 *  materials/ranges.ts
 *
 *  Plausible physical ranges for material properties, per group. Used by the
 *  MaterialManager tests (deterministic, offline) and by the standalone
 *  cross-check script to flag generated values that fall outside reality.
 *
 *  Values are in the canonical SI units (density kg/m³, thermalConductivity W/mK,
 *  strengths MPa, elastic GPa). Ranges are deliberately generous — they catch
 *  gross errors (wrong order of magnitude, wrong unit) rather than enforce a
 *  single "correct" number.
 */

import type { MaterialGroup, MaterialPropertyKey } from './types';

export interface Range { min: number; max: number }

/** Global fallback ranges applied to every material regardless of group. */
export const GLOBAL_RANGES: Partial<Record<MaterialPropertyKey, Range>> = {
    density:             { min: 5,     max: 22000 },  // EPS foam → lead
    thermalConductivity: { min: 0.02,  max: 450 },    // insulation → copper
    compressive:         { min: 0.01,  max: 1000 },
    tensile:             { min: 0.01,  max: 3000 },
    elastic:             { min: 0.0001, max: 450 },   // GPa: foam → steel
    porosity:            { min: 0,     max: 1 },
    recyclability:       { min: 0,     max: 1 },
    // kgCO2e/kg cradle-to-gate. The lower bound is NEGATIVE on purpose: under
    // EN 15804+A2 the biogenic carbon taken up by timber makes GWP-total negative
    // at the factory gate.
    carbon:              { min: -3,    max: 30 },
};

/**
 * Group-specific cradle-to-gate (A1-A3) carbon ranges, kgCO2e per kg.
 * As with density, generous enough to catch order-of-magnitude and unit errors
 * (e.g. a value declared per m³ or per tonne slipping in as per-kg) rather than to
 * pin down a single correct figure.
 */
export const GROUP_CARBON_RANGES: Partial<Record<MaterialGroup, Range>> = {
    wood:       { min: -2.0,  max: 1.5 },   // biogenic uptake → often negative
    metal:      { min: 0.3,   max: 25 },    // recycled steel → primary aluminium
    stone:      { min: 0.001, max: 1.5 },   // loose sand/gravel are near-zero

    concrete:   { min: 0.05,  max: 1.2 },   // mixes ≈ 0.1; neat Portland cement ≈ 0.9
    masonry:    { min: 0.1,   max: 1.0 },
    glass:      { min: 0.5,   max: 2.5 },
    plastic:    { min: 1.0,   max: 12 },
    insulation: { min: 0.3,   max: 12 },    // mineral wool → XPS with blowing agents
    membrane:   { min: 1.0,   max: 8 },
    composite:  { min: 0.2,   max: 10 },
    finish:     { min: 0.05,  max: 8 },     // plasterboard ≈ 0.2
};

/** Group-specific density ranges (kg/m³) — the most diagnostic property. */
export const GROUP_DENSITY_RANGES: Partial<Record<MaterialGroup, Range>> = {
    wood:       { min: 100,  max: 1200 },
    metal:      { min: 2000, max: 12000 },
    stone:      { min: 1500, max: 3200 },
    concrete:   { min: 300,  max: 2800 },
    masonry:    { min: 600,  max: 2200 },
    glass:      { min: 2200, max: 2800 },
    plastic:    { min: 850,  max: 2200 },
    insulation: { min: 5,    max: 300 },
    membrane:   { min: 900,  max: 2000 },
};

/**
 * Return the effective range for a property on a material of `group`.
 * A group-specific range wins over the global range when present.
 */
export function rangeFor(key: MaterialPropertyKey, group: MaterialGroup): Range | undefined
{
    if (key === 'density' && GROUP_DENSITY_RANGES[group]) return GROUP_DENSITY_RANGES[group];
    if (key === 'carbon'  && GROUP_CARBON_RANGES[group])  return GROUP_CARBON_RANGES[group];
    return GLOBAL_RANGES[key];
}
