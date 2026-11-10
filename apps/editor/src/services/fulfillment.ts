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
 * The pure half (paths, naming, output normalizing) lives in core's
 * execution/fulfillment.ts, shared with the server, which makes the files of an emailed
 * fulfillment. It is re-exported here.
 *
 * Used by <configurator-download-menu>, which works the same in the editor's
 * Configurator Preview and on the published /configurators/… page: both run the
 * script client-side in the shared worker.
 */

import { zipSync, type Zippable } from 'fflate';
import { msg, str } from '@lit/localize';

import {
  accessOf, baseName, deliverableOutputs, deliveredFormats, fileStem, formatMime,
  fulfillmentExports, isDownload, plainFilesForOutput, PDF_SOURCE_FORMAT, sanitize, uniqueName,
  type FulfillmentExport, type FulfillmentFile,
} from '@archiyou/core/src/execution/fulfillment';
import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';
import type { ScriptOutputData } from '@archiyou/core/src/execution/types';
import type { DocSVGPage } from '@archiyou/core/src/docs/types';

import { editorScript } from '../state/core.js';
import { buildConfiguratorRequest } from '../state/configurator.js';
import { runScript } from './execution-service.js';

export {
  accessOf, formatExtension, fulfillmentCategories, fulfillmentExports, fulfillmentFormats,
  isDownload, isEmailed, isProduct,
  type FulfillmentExport, type FulfillmentFile,
} from '@archiyou/core/src/execution/fulfillment';

/** True when this fulfillment is handed over for free in the browser, to anyone: the
 *  configurator can simply produce the files. Paid deliveries need a flow that does not
 *  exist yet; gated ones go past the server first (see services/fulfillment-access). */
export function isFreeDownload(fulfillment: ScriptPublishedFulfillmentData): boolean
{
  return isDownload(fulfillment)
    && accessOf(fulfillment) === 'anyone'
    && (fulfillment?.delivery ?? 'anonymous download') !== 'pay'
    && (fulfillment?.price ?? 0) <= 0;
}

//// DOWNLOADING ////

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
    throw new Error(msg('This download has no output formats set up.'));
  }

  // One path per request even when two deliveries share it (pdf + per-page svg).
  const paths = exports.map(e => e.path).filter((p, i, all) => all.indexOf(p) === i);
  const result = await runScript(buildConfiguratorRequest(paths));

  if (!result || result.status === 'error')
  {
    const detail = result?.errors?.[0]?.message ?? result?.messages?.[0]?.message;
    throw new Error(detail ? msg(str`The model could not be generated: ${detail}`) : msg('The model could not be generated.'));
  }

  const base  = downloadBaseName();
  const files = await outputsToFiles(result.outputs ?? [], base, exports);

  if (files.length === 0)
  {
    throw new Error(msg('This configuration produced no files for this download.'));
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
  for (const output of deliverableOutputs(outputs))
  {
    for (const format of deliveredFormats(output, deliveries))
    {
      files.push(...await filesForOutput(output, format, base, used));
    }
  }

  return files;
}

/** The file(s) one output becomes when delivered as `format`. */
async function filesForOutput(
  output: ScriptOutputData,
  format: string,
  base: string,
  used: Set<string>,
): Promise<FulfillmentFile[]>
{
  // A document requested as PDF comes back as its per-page SVGs; painting them into
  // a PDF needs text metrics, so it happens here on the main thread.
  if (format === 'pdf' && output.path.format === PDF_SOURCE_FORMAT)
  {
    const pdf = await renderPdf(output.path.entityName ?? 'document', output.output);
    return pdf ? [{ name: uniqueName(`${fileStem(output, base)}.pdf`, used), data: pdf, mime: formatMime('pdf', true) }] : [];
  }
  return plainFilesForOutput(output, format, base, used);
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
    throw new Error(msg(str`The PDF for “${docName}” could not be created.`));
  }
}

export function zipFiles(files: FulfillmentFile[]): Uint8Array
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
  return baseName(script?.name, script?.version);
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
