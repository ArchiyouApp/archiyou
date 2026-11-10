/**
 * fulfillment.ts — the pure part of handing a configurator's fulfillment over, shared by
 * the editor (downloads made in the browser) and the server (files made for an email).
 *
 * A fulfillment (see ScriptPublishedFulfillmentSchema) is a named bundle of output paths:
 * "Model" → `default/model/stl`, "Documents" → `default/docs/*​/pdf`. Handing one over
 * means expanding its `exports` into concrete paths, running the script for them and
 * turning the outputs into named files. This module does the first and the last; the run
 * and the saving (a browser download, an email) belong to the caller.
 */

import {
  SCRIPT_OUTPUT_MODEL_FORMATS,
  SCRIPT_OUTPUT_METRIC_FORMATS,
  SCRIPT_OUTPUT_TABLE_FORMATS,
  SCRIPT_OUTPUT_DOC_FORMATS,
} from '../constants';
import type { FulfillmentAccess, ScriptPublishedFulfillmentData } from '../ScriptSchema';
import type { ScriptOutputData, ScriptOutputDataWrapper } from './types';

//// KIND AND ACCESS ////

/** A product to order ("Order product"), rather than files to download. */
export function isProduct(fulfillment: ScriptPublishedFulfillmentData | null | undefined): boolean
{
  return fulfillment?.category === 'product';
}

/** Files from the Download menu: every fulfillment that is no product (absent = download). */
export function isDownload(fulfillment: ScriptPublishedFulfillmentData | null | undefined): boolean
{
  return !!fulfillment && !isProduct(fulfillment);
}

/** Who can get this fulfillment. Absent means anyone; a download published before access
 *  existed with delivery 'email' means 'email'. An emailed product makes no sense (the
 *  order form asks for an address anyway), so a product never answers 'email'. */
export function accessOf(fulfillment: ScriptPublishedFulfillmentData | null | undefined): FulfillmentAccess
{
  const access = fulfillment?.access ?? (fulfillment?.delivery === 'email' ? 'email' : 'anyone');
  return (access === 'email' && isProduct(fulfillment)) ? 'anyone' : access;
}

/** Handed over by email: the server makes the files and mails them. */
export function isEmailed(fulfillment: ScriptPublishedFulfillmentData | null | undefined): boolean
{
  const access = accessOf(fulfillment);
  return isDownload(fulfillment) && (access === 'email' || access === 'clients');
}

//// FORMATS ////

/** File extension + mime type per output format. A format missing here is still
 *  deliverable — it falls back to its own name as the extension and to a generic
 *  binary/text mime — but adding it keeps the filename and the OS association right. */
const FORMAT_META: Record<string, { ext: string, mime: string }> = {
  // model
  glb:   { ext: 'glb',  mime: 'model/gltf-binary' },
  gltf:  { ext: 'gltf', mime: 'model/gltf+json' },
  step:  { ext: 'step', mime: 'application/step' },
  stl:   { ext: 'stl',  mime: 'model/stl' },
  obj:   { ext: 'obj',  mime: 'model/obj' },
  dae:   { ext: 'dae',  mime: 'model/vnd.collada+xml' },
  amf:   { ext: 'amf',  mime: 'application/x-amf' },
  fcstd: { ext: 'FCStd', mime: 'application/x-extension-fcstd' },
  ifc:   { ext: 'ifc',  mime: 'application/x-step' },
  scad:  { ext: 'scad', mime: 'application/x-openscad' },
  btlx:  { ext: 'btlx', mime: 'application/xml' },
  dxf:   { ext: 'dxf',  mime: 'application/dxf' },
  svg:   { ext: 'svg',  mime: 'image/svg+xml' },
  // docs
  pdf:   { ext: 'pdf',  mime: 'application/pdf' },
  // Per-page standalone SVGs: one output, several .svg files.
  'svg-pages': { ext: 'svg', mime: 'image/svg+xml' },
  // tables / metrics
  xlsx:  { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  json:  { ext: 'json', mime: 'application/json' },
  // tables: a flat page (an offer, or the table's rows)
  html:  { ext: 'html', mime: 'text/html' },
};

/** Formats a category's `*` expands to. */
const CATEGORY_FORMATS: Record<string, readonly string[]> = {
  model:   SCRIPT_OUTPUT_MODEL_FORMATS,
  metrics: SCRIPT_OUTPUT_METRIC_FORMATS,
  tables:  SCRIPT_OUTPUT_TABLE_FORMATS,
  docs:    SCRIPT_OUTPUT_DOC_FORMATS,
};

/**
 * Formats a `*` never expands to. All four CAN be exported — an author who wants one
 * names it explicitly in the fulfillment — but none of them may be pulled in by a
 * wildcard, because a wildcard promises "everything this model can give" and these
 * four depend on something the model does not control:
 *
 *   step    — needs the brep kernel (scope.exporter); on the default kernel the
 *             export throws, and one throwing format fails the whole run, taking the
 *             formats that did work down with it
 *   obj     — converted by the Archiyou Services backend, so it fails whenever that
 *             is unreachable (offline, self-hosted), same all-or-nothing effect
 *   svg-pages — the per-page intermediate the PDF is painted from, not a separate
 *             deliverable: in a `*` it would ship the same drawing twice (once as
 *             the document SVG, once as page SVGs with a "-2" suffix)
 *   btlx    — timber machining data: it only means something for a timber model, and
 *             it needs the mesh kernel (on brep it throws, with the same effect as step)
 */
const WILDCARD_EXCLUDED_FORMATS = ['step', 'obj', 'svg-pages', 'btlx'];

/** The file extension a format ends up as, without the dot ('svg-pages' → 'svg'). */
export function formatExtension(format: string): string
{
  return FORMAT_META[format]?.ext ?? format;
}

export function formatMime(format: string, binary: boolean): string
{
  return FORMAT_META[format]?.mime ?? (binary ? 'application/octet-stream' : 'text/plain');
}

//// EXPORT PATHS ////

/** One concrete output path of a fulfillment (no format wildcard left). */
export interface FulfillmentExport
{
  /** The output path actually requested, e.g. `default/docs/*​/svg-pages`. Differs
   *  from `format` only for PDFs painted from pages — see requestFormat. */
  path: string;
  pipeline: string;
  category: string;
  /** '*' (all), a concrete name, or null for the model (which has no entity). */
  entity: string | null;
  /** The format the user is promised and gets on disk ('pdf'). */
  format: string;
  /** The format asked of the runner. Same as `format` except for docs PDFs in the
   *  browser: those are requested as 'svg-pages' and painted into a PDF on the main
   *  thread — svg2pdf needs text metrics (getBBox/canvas measureText), which no worker has. */
  requestFormat: string;
}

/** Docs are rendered to PDF on the browser's main thread from their per-page SVGs. */
export const PDF_SOURCE_FORMAT = 'svg-pages';

const PATH_REGEX =
  /^(?<pipeline>[^/]+)\/(?<category>[^/]+)(?:\/(?<entity>[^/]+))?\/(?<format>[^/?]+)(?:\?(?<options>.*))?$/;

/**
 * The concrete exports of a fulfillment: its authored `exports` with every format
 * wildcard expanded. Deduplicated, order preserved.
 *
 * `pdfFromPages` (the browser's way, default) asks for a doc PDF as 'svg-pages'; the
 * server asks for 'pdf' itself.
 *
 * Also the source of the format list shown next to a download in the menu, so what
 * the user reads is exactly what the download asks the runner for.
 */
export function fulfillmentExports(
  fulfillment: ScriptPublishedFulfillmentData,
  { pdfFromPages = true }: { pdfFromPages?: boolean } = {},
): FulfillmentExport[]
{
  const expanded = (fulfillment?.exports ?? []).flatMap((path): FulfillmentExport[] =>
  {
    const groups = path.match(PATH_REGEX)?.groups;
    if (!groups) return [];

    const { pipeline, category, options } = groups;
    const entity = category === 'model' ? null : (groups.entity ?? '*');
    const query  = options ? `?${options}` : '';

    const formats = (groups.format === '*')
      ? (CATEGORY_FORMATS[category] ?? []).filter(f => !WILDCARD_EXCLUDED_FORMATS.includes(f))
      : [groups.format];

    return formats.map(format =>
    {
      const requestFormat = (pdfFromPages && category === 'docs' && format === 'pdf') ? PDF_SOURCE_FORMAT : format;
      return {
        path: entity === null
          ? `${pipeline}/${category}/${requestFormat}${query}`
          : `${pipeline}/${category}/${entity}/${requestFormat}${query}`,
        pipeline,
        category,
        entity,
        format,
        requestFormat,
      };
    });
  });

  // Two authored rows can overlap ('default/model/stl' plus 'default/model/*');
  // asking the runner for the same path twice would export it twice. Keyed by path
  // AND format: a fulfillment offering both .pdf and per-page .svg requests one
  // 'svg-pages' path but delivers two different things from it.
  return expanded.filter((e, i) =>
    expanded.findIndex(o => o.path === e.path && o.format === e.format) === i);
}

/** Distinct file extensions a fulfillment delivers, in the order they were authored. */
export function fulfillmentFormats(fulfillment: ScriptPublishedFulfillmentData): string[]
{
  const extensions = fulfillmentExports(fulfillment).map(e => formatExtension(e.format));
  return extensions.filter((ext, i) => extensions.indexOf(ext) === i);
}

/** What a fulfillment is made of — 'model', 'docs', 'tables', 'metrics' — in the order
 *  they were authored. */
export function fulfillmentCategories(fulfillment: ScriptPublishedFulfillmentData): string[]
{
  const categories = fulfillmentExports(fulfillment).map(e => e.category);
  return categories.filter((c, i) => categories.indexOf(c) === i);
}

//// OUTPUTS → FILES ////

export interface FulfillmentFile
{
  name: string;
  data: Uint8Array | string;
  mime: string;
}

/** Which file format(s) this output has to be delivered in. Matched on the path the
 *  runner was asked for, so one 'svg-pages' output can yield both a .pdf and .svg
 *  pages when the fulfillment offers both. */
export function deliveredFormats(output: ScriptOutputData, deliveries: FulfillmentExport[]): string[]
{
  const requested = output?.path?.requestedPath;
  const matches = deliveries.filter(d => d.path === requested).map(d => d.format);
  return matches.length ? matches : [output.path.format as string];
}

/** The file(s) one output becomes when delivered as `format`, for every format but a PDF
 *  painted from pages (the browser does that one itself). */
export function plainFilesForOutput(
  output: ScriptOutputData,
  format: string,
  base: string,
  used: Set<string>,
): FulfillmentFile[]
{
  const stem  = fileStem(output, base);
  const ext   = formatExtension(format);
  const parts = (output.path.format === PDF_SOURCE_FORMAT)
    ? pagesToSvg(output.output)
    : normalizeOutput(output.output);

  return parts.map((data, i) => ({
    // A document delivered as SVG is one file per page, so those get a page suffix.
    name: uniqueName(`${stem}${parts.length > 1 ? `_p${i + 1}` : ''}.${ext}`, used),
    data,
    mime: formatMime(format, typeof data !== 'string'),
  }));
}

/** `<base>_<entity>`: what the files of one output are named after. */
export function fileStem(output: ScriptOutputData, base: string): string
{
  const entity = output.path.entityName;
  const name   = entity && entity !== '*' ? sanitize(entity) : null;
  return [base, name].filter(Boolean).join('_');
}

/** Outputs the runner made for the caller, without the internal ones the viewer uses. */
export function deliverableOutputs(outputs: ScriptOutputData[]): ScriptOutputData[]
{
  return (outputs ?? []).filter(o => !!o?.path?.format && o.path.format !== 'internal');
}

/** The standalone page SVGs of a 'svg-pages' output (DocSVGPage[]). Older/other
 *  shapes that hand back plain strings are accepted too. */
export function pagesToSvg(output: unknown): string[]
{
  if (!Array.isArray(output)) return [];
  return output
    .map(page => (typeof page === 'string' ? page : (page as { svg?: string })?.svg))
    .filter((svg): svg is string => typeof svg === 'string' && svg.length > 0);
}

/** One output value → the file bodies it represents.
 *
 *  The worker hands back raw values (strings for text formats, ArrayBuffer for
 *  binary ones); the server's JSON path wraps binaries as base64 (see core's
 *  convertBinaryToBase64), so both shapes are accepted here. Anything else is a
 *  data structure (a table, a doc, metrics) and is written as JSON. */
export function normalizeOutput(output: unknown): Array<Uint8Array | string>
{
  if (output === null || output === undefined) return [];

  if (typeof output === 'string') return output.length ? [output] : [];

  if (output instanceof ArrayBuffer)
  {
    return output.byteLength ? [new Uint8Array(output)] : [];
  }

  if (ArrayBuffer.isView(output))
  {
    const view = output as ArrayBufferView;
    return view.byteLength
      ? [new Uint8Array(view.buffer, view.byteOffset, view.byteLength)]
      : [];
  }

  // base64-wrapped binary (server-side JSON transport)
  const wrapper = output as ScriptOutputDataWrapper;
  if (wrapper.encoding === 'base64' && typeof wrapper.data === 'string')
  {
    const bytes = base64ToBytes(wrapper.data);
    return bytes.length ? [bytes] : [];
  }

  return [JSON.stringify(output, null, 2)];
}

function base64ToBytes(base64: string): Uint8Array
{
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

//// FILENAMES ////

/** `<script name>_<version>` — the stem every delivered file starts with. Working
 *  copies previewed before publishing have no version yet; those fall back to 0.0.0. */
export function baseName(name: string | null | undefined, version: string | null | undefined): string
{
  return `${sanitize(name ?? 'model')}_${version ?? '0.0.0'}`;
}

export function sanitize(name: string): string
{
  return String(name).replace(/[\\/:*?"<>|\s]+/g, '-');
}

/** Keep names unique inside one hand-over — two docs can share a name once their
 *  entity names are sanitized. */
export function uniqueName(name: string, used: Set<string>): string
{
  if (!used.has(name))
  {
    used.add(name);
    return name;
  }
  const dot  = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`)) i++;
  const unique = `${stem}-${i}${ext}`;
  used.add(unique);
  return unique;
}
