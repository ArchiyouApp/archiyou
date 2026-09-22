/**
 * reference.ts — the API reference pages of the docs site.
 *
 * The data is the editor's own reference, packages/ui/src/editor/help/api.generated.json,
 * written from the doc comments by packages/core/scripts/generate-api.ts (TypeDoc). So the
 * site and the editor's help panel always describe the same API; regenerate after changing
 * doc comments. English only: the pages are generated, not in help/.
 *
 * Pages: /reference/ (overview), /reference/globals/ (functions and modules a script can
 * use directly) and one page per class, /reference/<class>/.
 *
 * Plain Node, so astro.config.mjs can build the sidebar from it too.
 */

import { readFileSync } from 'node:fs';

/** Same format as generate-api.ts writes */
export interface ApiParam
{
  name: string;
  type: string;
  optional?: boolean;
  default?: string;
  doc?: string;
}

export interface ApiEntry
{
  id: string;
  name: string;
  owner?: string;
  kind: 'function' | 'method' | 'property' | 'class' | 'module';
  static?: boolean;
  sig?: string;
  alt?: string[];
  returns?: string;
  doc?: string;
  returnsDoc?: string;
  params?: ApiParam[];
  examples?: string[];
  extends?: string;
  deprecated?: boolean;
}

/** Relative to apps/docs (the working directory of astro dev/build) */
export const API_FILE = '../../packages/ui/src/editor/help/api.generated.json';

/** Sidebar groups for the classes, in this order; a class not listed goes under "More" */
const CLASS_GROUPS: Array<{ label: string, classes: string[] }> = [
  { label: 'Shapes', classes: ['Mesh', 'Curve', 'Polygon', 'ShapeCollection', 'Sketch', 'SceneNode'] },
  { label: 'Geometry', classes: ['Point', 'Vector', 'Vertex', 'Bbox', 'OBbox'] },
  { label: 'Modules', classes: ['Docs', 'Document', 'Calc', 'Make', 'FabFacade', 'MaterialManager', 'ParamManager', 'RunnerComponentImporter', 'Handle'] },
];

export function readApi(file = API_FILE): ApiEntry[]
{
  return (JSON.parse(readFileSync(file, 'utf8')) as { entries: ApiEntry[] }).entries;
}

/** URL of a class page, or of a member on it (#anchor) */
export function referenceUrl(owner: string | undefined, member?: string): string
{
  const page = owner ? `/reference/${owner.toLowerCase()}/` : '/reference/globals/';
  return member ? `${page}#${anchor(member)}` : page;
}

/** Heading id of a member: its name, safe for a URL fragment */
export function anchor(name: string): string
{
  return name.replace(/[^A-Za-z0-9_$-]/g, '-');
}

export function classes(entries: ApiEntry[]): ApiEntry[]
{
  return entries.filter(e => e.kind === 'class');
}

export function globals(entries: ApiEntry[]): ApiEntry[]
{
  return entries.filter(e => !e.owner && e.kind !== 'class');
}

export function membersOf(entries: ApiEntry[], owner: string): ApiEntry[]
{
  return entries.filter(e => e.owner === owner);
}

/** The classes by sidebar group, in CLASS_GROUPS order */
export function classGroups(entries: ApiEntry[]): Array<{ label: string, classes: ApiEntry[] }>
{
  const all = classes(entries);
  const listed = new Set(CLASS_GROUPS.flatMap(g => g.classes));
  return [
    ...CLASS_GROUPS.map(g => ({ label: g.label, classes: g.classes.map(name => all.find(c => c.name === name)).filter((c): c is ApiEntry => !!c) })),
    { label: 'More', classes: all.filter(c => !listed.has(c.name)) },
  ].filter(g => g.classes.length);
}

/** Starlight sidebar group for the reference */
export function referenceSidebar(entries: ApiEntry[])
{
  return {
    label: 'Reference',
    items: [
      { label: 'Overview', link: '/reference/' },
      { label: 'Globals', link: '/reference/globals/' },
      ...classGroups(entries).map(g => ({
        label: g.label,
        collapsed: true,
        items: g.classes.map(c => ({ label: c.name, link: referenceUrl(c.name) })),
      })),
    ],
  };
}
