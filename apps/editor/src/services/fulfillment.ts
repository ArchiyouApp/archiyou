/**
 * fulfillment.ts — turn a published configurator's fulfillments into files the
 * end-user actually gets.
 *
 * A fulfillment (see ScriptPublishedFulfillmentSchema) is a named bundle of output
 * paths the author offers from the configurator's Download menu: "Model" →
 * `default/model/stl`, "Documents" → `default/docs/*​/pdf`. Downloading one means:
 *
 *   1. expand the authored `exports` into concrete output paths. FORMAT wildcards
 *      are resolved here rather than left to the runner, so a `*` can leave out
 *      the formats a wildcard may not promise (see WILDCARD_EXCLUDED_FORMATS).
 *      ENTITY wildcards (which table? which doc?) stay in: only the runner knows
 *      those names.
 *   2. run the script for exactly those paths with the end-user's current param
 *      values (buildConfiguratorRequest — the same request the model on screen came
 *      from, so a download can never disagree with the preview). A doc offered as
 *      PDF is requested as 'svg-pages' instead: svg2pdf measures text with
 *      getBBox()/canvas measureText, which a Web Worker cannot do at all — and a
 *      DOM shim would silently measure every string as 0 wide rather than fail.
 *   3. write the results out, painting any PDF here on the main thread: one file →
 *      that file; several → a .zip
 *
 * Used by <configurator-download-menu>, which works the same in the editor's
 * Configurator Preview and on the published /configurators/… page: both run the
 * script client-side in the shared worker.
 */

import { zipSync, type Zippable } from 'fflate';

import {
  SCRIPT_OUTPUT_MODEL_FORMATS,
  SCRIPT_OUTPUT_METRIC_FORMATS,
  SCRIPT_OUTPUT_TABLE_FORMATS,
  SCRIPT_OUTPUT_DOC_FORMATS,
} from '@archiyou/core/src/constants';
import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';
import type { ScriptOutputData, ScriptOutputDataWrapper } from '@archiyou/core/src/execution/types';
import type { DocSVGPage } from '@archiyou/core/src/docs/types';

import { editorScript } from '../state/core.js';
import { buildConfiguratorRequest } from '../state/configurator.js';
import { runScript } from './execution-service.js';

//// FORMATS ////

/** File extension + mime type per output format. A format missing here is still
 *  downloadable — it falls back to its own name as the extension and to a generic
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
  dxf:   { ext: 'dxf',  mime: 'application/dxf' },
  svg:   { ext: 'svg',  mime: 'image/svg+xml' },
  // docs
  pdf:   { ext: 'pdf',  mime: 'application/pdf' },
  // Per-page standalone SVGs: one output, several .svg files.
  'svg-pages': { ext: 'svg', mime: 'image/svg+xml' },
  // tables / metrics
  xlsx:  { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  json:  { ext: 'json', mime: 'application/json' },
};

/** Formats a category's `*` expands to. */
const CATEGORY_FORMATS: Record<string, readonly string[]> = {
  model:   SCRIPT_OUTPUT_MODEL_FORMATS,
  metrics: SCRIPT_OUTPUT_METRIC_FORMATS,
  tables:  SCRIPT_OUTPUT_TABLE_FORMATS,
  docs:    SCRIPT_OUTPUT_DOC_FORMATS,
};

/**
 * Formats a `*` never expands to. All three CAN be exported — an author who wants one
 * names it explicitly in the fulfillment — but none of them may be pulled in by a
 * wildcard, because a wildcard promises "everything this model can give" and these
 * three depend on something the model does not control:
 *
 *   step    — needs the brep kernel (scope.exporter); on the default kernel the
 *             export throws, and one throwing format fails the whole run, taking the
 *             formats that did work down with it
 *   obj     — converted by the Archiyou Services backend, so it fails whenever that
 *             is unreachable (offline, self-hosted), same all-or-nothing effect
 *   svg-pages — the per-page intermediate the PDF is painted from, not a separate
 *             deliverable: in a `*` it would ship the same drawing twice (once as
 *             the document SVG, once as page SVGs with a "-2" suffix)
 */
const WILDCARD_EXCLUDED_FORMATS = ['step', 'obj', 'svg-pages'];

/** The file extension a format ends up as, without the dot ('svg-pages' → 'svg'). */
export function formatExtension(format: string): string
{
  return FORMAT_META[format]?.ext ?? format;
}

function formatMime(format: string, binary: boolean): string
{
  return FORMAT_META[format]?.mime ?? (binary ? 'application/octet-stream' : 'text/plain');
}

//// EXPORT PATHS ////

/** One concrete output path of a fulfillment (no format wildcard left). */
export interface FulfillmentExport
{
  /** The output path actually requested, e.g. `default/docs/*​/svg-pages`. Differs
   *  from `format` only for PDFs — see requestFormat. */
  path: string;
  pipeline: string;
  category: string;
  /** '*' (all), a concrete name, or null for the model (which has no entity). */
  entity: string | null;
  /** The format the user is promised and gets on disk ('pdf'). */
  format: string;
  /** The format asked of the runner. Same as `format` except for docs PDFs: those
   *  are requested as 'svg-pages' and painted into a PDF here — svg2pdf needs text
   *  metrics (getBBox/canvas measureText), which no worker has. */
  requestFormat: string;
}

/** Docs are rendered to PDF on the main thread from their per-page SVGs. */
const PDF_SOURCE_FORMAT = 'svg-pages';

const PATH_REGEX =
  /^(?<pipeline>[^/]+)\/(?<category>[^/]+)(?:\/(?<entity>[^/]+))?\/(?<format>[^/?]+)(?:\?(?<options>.*))?$/;

/**
 * The concrete exports of a fulfillment: its authored `exports` with every format
 * wildcard expanded and the non-file formats dropped. Deduplicated, order preserved.
 *
 * Also the source of the format list shown next to a download in the menu, so what
 * the user reads is exactly what the download asks the runner for.
 */
export function fulfillmentExports(fulfillment: ScriptPublishedFulfillmentData): FulfillmentExport[]
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
      const requestFormat = (category === 'docs' && format === 'pdf') ? PDF_SOURCE_FORMAT : format;
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

/** Distinct formats a fulfillment delivers, in the order they were authored. Used
 *  for the "(.stl, .dxf)" part of a menu row. */
export function fulfillmentFormats(fulfillment: ScriptPublishedFulfillmentData): string[]
{
  const extensions = fulfillmentExports(fulfillment).map(e => formatExtension(e.format));
  return extensions.filter((ext, i) => extensions.indexOf(ext) === i);
}

/** What a fulfillment is made of — 'model', 'docs', 'tables', 'metrics' — in the order
 *  they were authored. More than one means a mixed bundle. Drives the icon the menu
 *  puts on the row: what you get matters more at a glance than which file type it
 *  arrives in. */
export function fulfillmentCategories(fulfillment: ScriptPublishedFulfillmentData): string[]
{
  const categories = fulfillmentExports(fulfillment).map(e => e.category);
  return categories.filter((c, i) => categories.indexOf(c) === i);
}

/** True when this fulfillment is handed over for free, i.e. the configurator can
 *  simply produce the files. Paid and email deliveries need a flow (payment,
 *  address collection) that does not exist yet — the menu marks those instead. */
export function isFreeDownload(fulfillment: ScriptPublishedFulfillmentData): boolean
{
  return fulfillment?.delivery === 'anonymous download' && (fulfillment?.price ?? 0) <= 0;
}

//// DOWNLOADING ////

export interface FulfillmentFile
{
  name: string;
  data: Uint8Array | string;
  mime: string;
}

export interface FulfillmentDownloadResult
{
  /** Name of the file that was handed to the browser (the .zip when bundled). */
  filename: string;
  /** How many produced files it contains. */
  fileCount: number;
}

/**
 * Run the script for one fulfillment and save the result.
 *
 * Rejects with a message meant for the end-user: an empty result is a real failure
 * from their point of view ("Download" produced nothing), not something to swallow.
 */
export async function downloadFulfillment(
  fulfillment: ScriptPublishedFulfillmentData,
): Promise<FulfillmentDownloadResult>
{
  const exports = fulfillmentExports(fulfillment);
  if (exports.length === 0)
  {
    throw new Error('This download has no output formats set up.');
  }

  // One path per request even when two deliveries share it (pdf + per-page svg).
  const paths = exports.map(e => e.path).filter((p, i, all) => all.indexOf(p) === i);
  const result = await runScript(buildConfiguratorRequest(paths));

  if (!result || result.status === 'error')
  {
    const detail = result?.errors?.[0]?.message ?? result?.messages?.[0]?.message;
    throw new Error(detail ? `The model could not be generated: ${detail}` : 'The model could not be generated.');
  }

  const base  = downloadBaseName();
  const files = await outputsToFiles(result.outputs ?? [], base, exports);

  if (files.length === 0)
  {
    throw new Error('This configuration produced no files for this download.');
  }

  if (files.length === 1)
  {
    saveFile(files[0]);
    return { filename: files[0].name, fileCount: 1 };
  }

  const zipName = `${base}_${sanitize(fulfillment.name || 'download')}.zip`;
  saveFile({ name: zipName, data: zipFiles(files), mime: 'application/zip' });
  return { filename: zipName, fileCount: files.length };
}

//// OUTPUTS → FILES ////

/**
 * Turn the runner's outputs into named files.
 *
 * One output is usually one file, but not always: a docs 'svg-pages' output is a
 * whole document, delivered either as one .pdf (rendered here) or as one .svg per
 * page — which of the two is what the fulfillment asked for, so `deliveries` (the
 * fulfillment's exports) decides. Without them each output is delivered in the
 * format it came back as.
 *
 * Outputs the runner could not produce (undefined/empty) are skipped rather than
 * saved as empty files.
 */
export async function outputsToFiles(
  outputs: ScriptOutputData[],
  base: string,
  deliveries: FulfillmentExport[] = [],
): Promise<FulfillmentFile[]>
{
  const used  = new Set<string>();
  const files: FulfillmentFile[] = [];

  // Sequential: naming is deduplicated against `used` and PDF rendering is async,
  // so the order files land in has to stay the order the runner returned them in.
  for (const output of outputs)
  {
    const outputFormat = output?.path?.format ?? '';
    // The runner also returns the internal/data outputs the viewer uses; those are
    // not part of any fulfillment request, but skip them defensively.
    if (!outputFormat || outputFormat === 'internal') continue;

    for (const format of deliveredFormats(output, deliveries))
    {
      files.push(...await filesForOutput(output, format, base, used));
    }
  }

  return files;
}

/** Which file format(s) this output has to be delivered in. Matched on the path the
 *  runner was asked for, so one 'svg-pages' output can yield both a .pdf and .svg
 *  pages when the fulfillment offers both. */
function deliveredFormats(output: ScriptOutputData, deliveries: FulfillmentExport[]): string[]
{
  const requested = output?.path?.requestedPath;
  const matches = deliveries.filter(d => d.path === requested).map(d => d.format);
  return matches.length ? matches : [output.path.format as string];
}

/** The file(s) one output becomes when delivered as `format`. */
async function filesForOutput(
  output: ScriptOutputData,
  format: string,
  base: string,
  used: Set<string>,
): Promise<FulfillmentFile[]>
{
  const entity = output.path.entityName;
  const name   = entity && entity !== '*' ? sanitize(entity) : null;
  const stem   = [base, name].filter(Boolean).join('_');
  const ext    = formatExtension(format);

  // A document requested as PDF comes back as its per-page SVGs; painting them into
  // a PDF needs text metrics, so it happens here on the main thread.
  if (format === 'pdf' && output.path.format === PDF_SOURCE_FORMAT)
  {
    const pdf = await renderPdf(entity ?? 'document', output.output);
    return pdf ? [{ name: uniqueName(`${stem}.pdf`, used), data: pdf, mime: formatMime('pdf', true) }] : [];
  }

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

/** The standalone page SVGs of a 'svg-pages' output (DocSVGPage[]). Older/other
 *  shapes that hand back plain strings are accepted too. */
function pagesToSvg(output: unknown): string[]
{
  if (!Array.isArray(output)) return [];
  return output
    .map(page => (typeof page === 'string' ? page : (page as DocSVGPage)?.svg))
    .filter((svg): svg is string => typeof svg === 'string' && svg.length > 0);
}

/** Render one document's pages to a PDF here on the main thread. jsPDF/svg2pdf are
 *  loaded on demand — a configurator that offers no PDF never pays for them.
 *  Returns null when the document has no pages to render.
 *
 *  A failure is raised, not swallowed: the PDF is usually the thing the visitor came
 *  for, and a zip quietly missing it is worse than being told it could not be made. */
async function renderPdf(docName: string, output: unknown): Promise<Uint8Array | null>
{
  const pages = (Array.isArray(output) ? output : []).filter(p => typeof (p as DocSVGPage)?.svg === 'string');
  if (pages.length === 0) return null;

  try
  {
    const { PDFExporter } = await import('@archiyou/core/src/docs/PDFExporter');
    const buffers = await new PDFExporter().export({ [docName]: pages as DocSVGPage[] });
    const buffer = buffers?.[docName];
    return buffer ? new Uint8Array(buffer) : null;
  }
  catch (err)
  {
    console.error(`fulfillment: rendering the PDF for "${docName}" failed:`, err);
    throw new Error(`The PDF for “${docName}” could not be created.`);
  }
}

/** One output value → the file bodies it represents.
 *
 *  The worker hands back raw values (strings for text formats, ArrayBuffer for
 *  binary ones); the server's JSON path wraps binaries as base64 (see core's
 *  convertBinaryToBase64), so both shapes are accepted here. Anything else is a
 *  data structure (a table, a doc, metrics) and is written as JSON. */
function normalizeOutput(output: unknown): Array<Uint8Array | string>
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

function zipFiles(files: FulfillmentFile[]): Uint8Array
{
  const encoder = new TextEncoder();
  const zippable: Zippable = Object.fromEntries(files.map(file =>
    [file.name, typeof file.data === 'string' ? encoder.encode(file.data) : file.data],
  ));
  // Level 6: STL/DXF/SVG compress very well and are the bulk of what goes in here;
  // the already-compressed members (pdf, xlsx, glb) only cost a little CPU.
  return zipSync(zippable, { level: 6 });
}

//// FILENAMES ////

/** `<script name>_<version>` — the stem every downloaded file starts with. Working
 *  copies previewed before publishing have no version yet; those fall back to 0.0.0,
 *  the same as the editor's own exports. */
export function downloadBaseName(): string
{
  const script = editorScript.get();
  return `${sanitize(script?.name ?? 'model')}_${script?.version ?? '0.0.0'}`;
}

function sanitize(name: string): string
{
  return String(name).replace(/[\\/:*?"<>|\s]+/g, '-');
}

/** Keep names unique inside one download — two docs can share a name once their
 *  entity names are sanitized. */
function uniqueName(name: string, used: Set<string>): string
{
  if (!used.has(name))
  {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`)) i++;
  const unique = `${stem}-${i}${ext}`;
  used.add(unique);
  return unique;
}

//// SAVING ////

function saveFile(file: FulfillmentFile): void
{
  const blob = new Blob([file.data as BlobPart], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  // Revoke late: Safari needs the URL to survive the click that starts the save.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
