/**
 * tests/fulfillment.test.ts — the pure half of services/fulfillment.ts: what a
 * fulfillment's authored `exports` actually ask the runner for, and how the outputs
 * that come back become files.
 *
 * Both are easy to get quietly wrong (a wildcard that pulls in a format the kernel
 * cannot produce fails the whole run; a stale extension writes a .svg-pages file
 * nothing opens), and neither needs a worker, a DOM or a script to test.
 */

import { describe, it, expect, vi } from 'vitest';

// The real exporter is jsPDF + svg2pdf and needs a browser DOM (that is the whole
// reason PDFs are built on the main thread). Stubbed so the delivery logic around it
// can be tested in Node; PDF rendering itself is not under test here.
vi.mock('@archiyou/core/src/docs/PDFExporter', () => ({
  PDFExporter: class
  {
    async export(data: Record<string, Array<{ svg: string }>>)
    {
      return Object.fromEntries(
        Object.entries(data).map(([name, pages]) =>
          [name, new TextEncoder().encode(`%PDF ${name} ${pages.length}`).buffer]),
      );
    }
  },
}));

import {
  fulfillmentExports, fulfillmentFormats, fulfillmentCategories, formatExtension,
  isFreeDownload, outputsToFiles,
} from '../src/services/fulfillment.js';
import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';
import type { ScriptOutputData } from '@archiyou/core/src/execution/types';

/** A fulfillment with just the fields these functions read. */
function fulfillment(exports: string[], extra: Partial<ScriptPublishedFulfillmentData> = {}): ScriptPublishedFulfillmentData
{
  return { name: 'Test', exports, delivery: 'anonymous download', ...extra };
}

/** One runner output. `entityName` is null for the model. `requestedPath` is what
 *  the runner was asked for — how a delivery is matched back to its output. */
function output(format: string, out: unknown, entityName: string | null = null, requestedPath?: string): ScriptOutputData
{
  return { path: { format, entityName, requestedPath } as any, output: out as any };
}

/** A standalone page SVG as Document.toSVGPages() returns it. */
function page(svg: string): any
{
  return { name: 'p', widthMm: 210, heightMm: 297, orientation: 'portrait', svg };
}

describe('fulfillmentExports', () =>
{
  it('leaves a concrete path alone', () =>
  {
    expect(fulfillmentExports(fulfillment(['default/model/stl'])).map(e => e.path))
      .toEqual(['default/model/stl']);
  });

  it('expands a model format wildcard, minus the formats a wildcard may not promise', () =>
  {
    const formats = fulfillmentExports(fulfillment(['default/model/*'])).map(e => e.format);

    expect(formats).toContain('stl');
    expect(formats).toContain('glb');
    expect(formats).toContain('dxf');
    // step needs the brep kernel and obj the Archiyou Services backend; either one
    // throwing takes down every other format in the same run.
    expect(formats).not.toContain('step');
    expect(formats).not.toContain('obj');
  });

  it('expands a table wildcard to every table format — all of them are files', () =>
  {
    const formats = fulfillmentExports(fulfillment(['default/tables/*/*'])).map(e => e.format);
    expect(formats).toEqual(['json', 'xlsx']);
  });

  it('keeps the entity wildcard: only the runner knows which docs exist', () =>
  {
    expect(fulfillmentExports(fulfillment(['default/docs/*/svg'])).map(e => e.path))
      .toEqual(['default/docs/*/svg']);
  });

  it('asks for a doc PDF as svg-pages, but still promises .pdf', () =>
  {
    const [e] = fulfillmentExports(fulfillment(['default/docs/manual/pdf']));
    // The worker has no text metrics, so the PDF is painted on the main thread from
    // the per-page SVGs (see filesForOutput).
    expect(e.path).toBe('default/docs/manual/svg-pages');
    expect(e.requestFormat).toBe('svg-pages');
    expect(e.format).toBe('pdf');
    expect(fulfillmentFormats(fulfillment(['default/docs/manual/pdf']))).toEqual(['pdf']);
  });

  it('keeps pdf and per-page svg apart even though both request one path', () =>
  {
    const exports = fulfillmentExports(fulfillment(['default/docs/*/pdf', 'default/docs/*/svg-pages']));
    expect(exports.map(e => e.path)).toEqual(['default/docs/*/svg-pages', 'default/docs/*/svg-pages']);
    expect(exports.map(e => e.format)).toEqual(['pdf', 'svg-pages']);
  });

  it('drops the entity segment for the model and keeps it for a named doc', () =>
  {
    expect(fulfillmentExports(fulfillment(['default/model/glb']))[0].entity).toBeNull();
    expect(fulfillmentExports(fulfillment(['default/docs/manual/pdf']))[0].entity).toBe('manual');
  });

  it('preserves format options', () =>
  {
    expect(fulfillmentExports(fulfillment(['default/model/dxf?annotations=true'])).map(e => e.path))
      .toEqual(['default/model/dxf?annotations=true']);
  });

  it('deduplicates paths two authored rows both produce', () =>
  {
    const paths = fulfillmentExports(fulfillment(['default/model/stl', 'default/model/*'])).map(e => e.path);
    expect(paths.filter(p => p === 'default/model/stl')).toHaveLength(1);
  });

  it('skips an unparseable path instead of requesting it', () =>
  {
    expect(fulfillmentExports(fulfillment(['nonsense', 'default/model/stl'])).map(e => e.path))
      .toEqual(['default/model/stl']);
  });

  it('survives a fulfillment with no exports', () =>
  {
    expect(fulfillmentExports(fulfillment([]))).toEqual([]);
  });
});

describe('fulfillmentFormats', () =>
{
  it('lists the extensions once each, in authored order', () =>
  {
    expect(fulfillmentFormats(fulfillment(['default/docs/*/pdf', 'default/docs/*/svg', 'default/model/svg'])))
      .toEqual(['pdf', 'svg']);
  });

  it('reports svg-pages as the .svg files it really writes', () =>
  {
    expect(formatExtension('svg-pages')).toBe('svg');
    expect(fulfillmentFormats(fulfillment(['default/docs/*/svg-pages']))).toEqual(['svg']);
  });
});

describe('fulfillmentCategories', () =>
{
  it('names what the fulfillment is made of', () =>
  {
    expect(fulfillmentCategories(fulfillment(['default/model/stl']))).toEqual(['model']);
    expect(fulfillmentCategories(fulfillment(['default/docs/*/pdf']))).toEqual(['docs']);
    expect(fulfillmentCategories(fulfillment(['default/tables/*/xlsx']))).toEqual(['tables']);
  });

  it('lists each category once, in authored order — several means a mixed bundle', () =>
  {
    expect(fulfillmentCategories(fulfillment([
      'default/docs/*/pdf', 'default/tables/*/xlsx', 'default/docs/*/svg',
    ]))).toEqual(['docs', 'tables']);
  });

  it('is empty when there is nothing to deliver', () =>
  {
    expect(fulfillmentCategories(fulfillment([]))).toEqual([]);
    expect(fulfillmentCategories(fulfillment(['nonsense']))).toEqual([]);
  });
});

describe('isFreeDownload', () =>
{
  it('is true for a free anonymous download', () =>
  {
    expect(isFreeDownload(fulfillment(['default/model/stl']))).toBe(true);
    expect(isFreeDownload(fulfillment(['default/model/stl'], { price: 0 }))).toBe(true);
  });

  it('is false as soon as money or an address is involved', () =>
  {
    expect(isFreeDownload(fulfillment(['default/model/stl'], { delivery: 'pay', price: 5 }))).toBe(false);
    expect(isFreeDownload(fulfillment(['default/model/stl'], { delivery: 'email' }))).toBe(false);
    // A price on an otherwise anonymous download still has to be paid.
    expect(isFreeDownload(fulfillment(['default/model/stl'], { price: 5 }))).toBe(false);
  });
});

describe('outputsToFiles', () =>
{
  it('names a model output after the script and version', async () =>
  {
    const files = await outputsToFiles([output('stl', 'solid box')], 'chair_1.2.0');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('chair_1.2.0.stl');
    expect(files[0].mime).toBe('model/stl');
  });

  it('adds the entity name for a named doc or table', async () =>
  {
    const files = await outputsToFiles([output('pdf', new ArrayBuffer(4), 'manual')], 'chair_1.2.0');
    expect(files[0].name).toBe('chair_1.2.0_manual.pdf');
    expect(files[0].data).toBeInstanceOf(Uint8Array);
  });

  it('writes one .svg per page for a document delivered as svg-pages', async () =>
  {
    const out = output('svg-pages', [page('<svg>1</svg>'), page('<svg>2</svg>')], 'plan');
    const files = await outputsToFiles([out], 'chair_1.2.0');
    expect(files.map(f => f.name)).toEqual(['chair_1.2.0_plan_p1.svg', 'chair_1.2.0_plan_p2.svg']);
    // The page objects must be unwrapped — writing the DocSVGPage as JSON into a
    // .svg file is exactly the bug this pins.
    expect(files[0].data).toBe('<svg>1</svg>');
  });

  it('decodes a base64-wrapped binary (the server transport shape)', async () =>
  {
    const wrapper = { type: 'ArrayBuffer', encoding: 'base64', data: btoa('PDF'), length: 3 };
    const files = await outputsToFiles([output('pdf', wrapper)], 'chair_1.2.0');
    expect(Array.from(files[0].data as Uint8Array)).toEqual([80, 68, 70]);
  });

  it('writes a data structure as JSON', async () =>
  {
    const files = await outputsToFiles([output('json', { rows: [1, 2] }, 'parts')], 'chair_1.2.0');
    expect(files[0].name).toBe('chair_1.2.0_parts.json');
    expect(JSON.parse(files[0].data as string)).toEqual({ rows: [1, 2] });
  });

  it('skips outputs the model could not produce rather than saving empty files', async () =>
  {
    const files = await outputsToFiles(
      [output('svg', ''), output('dxf', undefined), output('stl', 'solid box')],
      'chair_1.2.0',
    );
    expect(files.map(f => f.name)).toEqual(['chair_1.2.0.stl']);
  });

  it('keeps names unique when two entities sanitize to the same thing', async () =>
  {
    const files = await outputsToFiles(
      [output('pdf', 'a', 'my doc'), output('pdf', 'b', 'my/doc')],
      'chair_1.2.0',
    );
    expect(files.map(f => f.name)).toEqual(['chair_1.2.0_my-doc.pdf', 'chair_1.2.0_my-doc-2.pdf']);
  });

  it('does not name a file after the wildcard when the runner leaves one in', async () =>
  {
    expect((await outputsToFiles([output('json', { a: 1 }, '*')], 'chair_1.2.0'))[0].name)
      .toBe('chair_1.2.0.json');
  });

  it('delivers one svg-pages output as both the .pdf and the .svg pages it was asked for', async () =>
  {
    const deliveries = fulfillmentExports(
      fulfillment(['default/docs/*/pdf', 'default/docs/*/svg-pages']),
    );
    const out = output('svg-pages', [page('<svg>1</svg>')], 'manual', 'default/docs/*/svg-pages');

    const files = await outputsToFiles([out], 'chair_1.2.0', deliveries);

    expect(files.map(f => f.name)).toEqual(['chair_1.2.0_manual.pdf', 'chair_1.2.0_manual.svg']);
    expect(files[0].mime).toBe('application/pdf');
    expect(files[1].data).toBe('<svg>1</svg>');
  });

  it('renders a doc requested as PDF from its per-page SVGs', async () =>
  {
    const deliveries = fulfillmentExports(fulfillment(['default/docs/manual/pdf']));
    const out = output('svg-pages', [page('<svg>1</svg>'), page('<svg>2</svg>')], 'manual',
      'default/docs/manual/svg-pages');

    const files = await outputsToFiles([out], 'chair_1.2.0', deliveries);

    expect(files.map(f => f.name)).toEqual(['chair_1.2.0_manual.pdf']);
    expect(new TextDecoder().decode(files[0].data as Uint8Array)).toBe('%PDF manual 2');
  });
});
