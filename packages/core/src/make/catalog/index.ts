/**
 *  make/catalog — the products of the make database: what they are (products.ts) and how a
 *  script finds them by name (Catalog.ts).
 */

export { Catalog, normalize, distance, type Lookup, type LookupHow, type Resolution, type ResolveIssue } from './Catalog';
export { toProduct, fit, orient, partQuantities, sizeText, productLabel, type Product, type ProductRow, type ProductMeasure, type ProductQuantities } from './products';
