/**
 * publish-constants — defaults, labels and output-path helpers for the
 * <publish-script-menu>. Keeps the (de)serialization of fulfillment `exports`
 * (output-path strings) out of the component.
 *
 * Output-path convention (see @archiyou/core ScriptOutputPath):
 *   `pipeline/category[/entity]/format`   — model has no entity segment.
 * A fulfillment row in the UI groups one pipeline/category/entity with a set of
 * formats; each (row × format) serialises to one path string.
 */

import {
  SCRIPT_OUTPUT_MODEL_FORMATS,
  SCRIPT_OUTPUT_TABLE_FORMATS,
  SCRIPT_OUTPUT_DOC_FORMATS,
} from '@archiyou/core/src/constants';
import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';

/** Build the public configurator URL on the current frontend origin. Used as a
 *  fallback when the server did not stamp `published.url` (it normally does, from
 *  the server's FRONTEND_URL). Never hard-codes archiyou.com, so it is correct in
 *  dev too. */
export function configuratorUrl(author: string, name: string, version: string): string {
  const base = (typeof window !== 'undefined' && window.location?.origin) || '';
  // Encoded per segment (script names may contain spaces); the ':' separating
  // name from version is part of the route pattern, so it stays literal.
  return `${base}/configurators/${encodeURIComponent(author)}`
    + `/${encodeURIComponent(name)}:${encodeURIComponent(version)}`;
}

/** Rebase an absolute URL onto the current frontend origin, keeping path/query/hash.
 *  `published.url` is stamped server-side from FRONTEND_URL at publish time, so it goes
 *  stale the moment the script travels between environments: a script published against
 *  a dev server keeps `http://localhost:5173/...` forever, and a server deployed without
 *  FRONTEND_URL stamps localhost for everyone. The configurator is always served from the
 *  same origin as the editor showing the link, so the current origin is the reliable half
 *  and only the stored path is worth keeping. Returns the input untouched off-browser. */
export function onCurrentOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  const base = (typeof window !== 'undefined' && window.location?.origin) || '';
  if (!base) return url;
  try {
    const parsed = new URL(url, base);
    return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;   // not a URL we can parse — leave it alone rather than lose it
  }
}

/** The public configurator URL to show or copy for a published script: the server-stamped
 *  one when present (rebased onto this origin), else built from author/name/version. */
export function publicConfiguratorUrl(
  storedUrl: string | null | undefined,
  author: string,
  name: string,
  version: string,
): string {
  return onCurrentOrigin(storedUrl) ?? configuratorUrl(author, name, version);
}

/** Wildcard token used in output paths for "all entities" / "all formats". */
export const OUTPUT_WILDCARD = '*';

/** Entity groups offered in the output-path editor (metrics intentionally omitted). */
export type PublishEntityGroup = 'model' | 'tables' | 'docs';
export const PUBLISH_ENTITY_GROUPS: PublishEntityGroup[] = ['model', 'tables', 'docs'];

export const ENTITY_GROUP_LABELS: Record<PublishEntityGroup, string> = {
  model: 'Model',
  tables: 'Data tables',
  docs: 'Documents',
};

/** Available output formats per entity group (from core constants). */
export function formatsForGroup(group: PublishEntityGroup): string[] {
  switch (group) {
    case 'model':  return [...SCRIPT_OUTPUT_MODEL_FORMATS];
    case 'tables': return [...SCRIPT_OUTPUT_TABLE_FORMATS];
    case 'docs':   return [...SCRIPT_OUTPUT_DOC_FORMATS];
    default:       return [];
  }
}

/** Whether a group carries named entities (tables/docs) vs. the single model. */
export function groupHasEntities(group: PublishEntityGroup): boolean {
  return group !== 'model';
}

/** Friendly labels for the SPDX licence ids (mirrors share-script-menu). */
export const LICENCE_LABELS: Record<string, string> = {
  'CC0-1.0':          'CC0 1.0 — Public Domain',
  'CC-BY-4.0':        'CC BY 4.0 — Attribution',
  'CC-BY-SA-4.0':     'CC BY-SA 4.0 — Attribution-ShareAlike',
  'CC-BY-NC-4.0':     'CC BY-NC 4.0 — Attribution-NonCommercial',
  'CC-BY-ND-4.0':     'CC BY-ND 4.0 — Attribution-NoDerivatives',
  'CC-BY-NC-SA-4.0':  'CC BY-NC-SA 4.0 — Attribution-NonCommercial-ShareAlike',
  'CC-BY-NC-ND-4.0':  'CC BY-NC-ND 4.0 — Attribution-NonCommercial-NoDerivatives',
};

export const DEFAULT_LICENCE = 'CC0-1.0';

/** The auto-filled fulfillments shown when publishing a script for the first time. */
export const DEFAULT_FULFILLMENTS: ScriptPublishedFulfillmentData[] = [
  {
    name: 'Model',
    description: 'The parametric 3D model, ready to download in common formats.',
    exports: ['default/model/*'],
    delivery: 'anonymous download',
    price: 0,
  },
  {
    name: 'Data',
    description: 'Data tables such as parts lists and bills of materials.',
    exports: ['default/tables/*/*'],
    delivery: 'anonymous download',
    price: 0,
  },
  {
    name: 'Documents',
    description: 'Generated documents and technical drawings.',
    exports: ['default/docs/*/*'],
    delivery: 'anonymous download',
    price: 0,
  },
];

//// OUTPUT-PATH ROWS ⇄ EXPORT STRINGS ////

/** A grouped output-path row in the fulfillment editor. `entity` is a path token:
 *  '*' (all) or a concrete entity name; ignored for the `model` group. */
export interface OutputRow {
  pipeline: string;
  category: PublishEntityGroup;
  entity: string;   // '*' or a concrete entity name
  formats: string[]; // '*' (all) or concrete formats
}

const PATH_REGEX =
  /^(?<pipeline>[^/]+)\/(?<category>[^/]+)(?:\/(?<entity>[^/]+))?\/(?<format>[^/?]+)(?:\?.*)?$/;

/** Parse fulfillment `exports` into grouped rows (merging shared pipeline/category/
 *  entity into one row with multiple formats). Unparseable/unknown-group paths are
 *  skipped. */
export function exportsToRows(exports: string[]): OutputRow[] {
  const byKey = new Map<string, OutputRow>();
  for (const path of exports ?? []) {
    const m = path.match(PATH_REGEX);
    if (!m?.groups) continue;
    const category = m.groups.category as PublishEntityGroup;
    if (!PUBLISH_ENTITY_GROUPS.includes(category)) continue;
    const pipeline = m.groups.pipeline;
    const entity = groupHasEntities(category) ? (m.groups.entity ?? OUTPUT_WILDCARD) : OUTPUT_WILDCARD;
    const format = m.groups.format;
    const key = `${pipeline}|${category}|${entity}`;
    const row = byKey.get(key);
    if (row) {
      if (!row.formats.includes(format)) row.formats.push(format);
    } else {
      byKey.set(key, { pipeline, category, entity, formats: [format] });
    }
  }
  return [...byKey.values()];
}

/** Serialise grouped rows back into fulfillment `exports` path strings (one per
 *  row × format). Model rows omit the entity segment. When every available format
 *  is selected the set collapses to the '*' wildcard (compact, means "all").
 *  Deduplicated, order preserved. */
export function rowsToExports(rows: OutputRow[]): string[] {
  const out: string[] = [];
  for (const row of rows ?? []) {
    const all = formatsForGroup(row.category);
    const allSelected = all.length > 0 && all.every(f => row.formats.includes(f));
    const formats = allSelected ? [OUTPUT_WILDCARD] : row.formats;
    for (const format of formats) {
      const path = groupHasEntities(row.category)
        ? `${row.pipeline}/${row.category}/${row.entity || OUTPUT_WILDCARD}/${format}`
        : `${row.pipeline}/${row.category}/${format}`;
      if (!out.includes(path)) out.push(path);
    }
  }
  return out;
}
