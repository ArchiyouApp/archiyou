/**
 *  materials/index.ts — public surface of the materials module.
 */

export {
    MaterialManager, BoundMaterial, DEFAULT_THIN_SIDE_THRESHOLD_MM,
    DEFAULT_MATERIAL_LINE_COLOR, DEFAULT_MATERIAL_LINE_OPACITY, DEFAULT_MATERIAL_LINE_WIDTH,
    DEFAULT_MATERIAL_LINE_DARKEN,
    DEFAULT_MATERIAL_TEXTURE_STRENGTH,
} from './MaterialManager';
export * from './types';
export { rangeFor, GLOBAL_RANGES, GROUP_DENSITY_RANGES, GROUP_CARBON_RANGES } from './ranges';
export { MaterialSchema, MaterialLCASchema, MaterialsDbSchema, MATERIAL_SCHEMAS } from './schemas';
