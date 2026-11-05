/**
 *  PDFExporter
 *
 *  Renders Documents to PDF by using their per-page SVG (DocSVGPage) as the
 *  intermediate representation. Each page's standalone SVG is painted into its
 *  own jsPDF page via svg2pdf.js — there is no per-container PDF drawing here.
 *  The page layout (positions, scaling, text, tables, views, graphics) is owned
 *  entirely by the SVG exporter (Document.toSVGPages() / Page.toSVG()).
 *
 *  IMPORTANT:
 *      Loading is dynamic. To use PDF exporting add these dependencies:
 *      - jspdf
 *      - svg2pdf.js
 *
 *  RUNTIME / DOM REQUIREMENT:
 *      svg2pdf.js walks a live SVG DOM element (getBBox/getCTM/getComputedStyle),
 *      so a DOM is required:
 *        - browser main thread  -> uses the native DOMParser            (supported)
 *        - node                 -> uses jsdom (must be installed)        (best-effort)
 *        - browser web worker   -> no DOM, cannot render                 (throws)
 *      PDF generation in the browser therefore happens on the main thread
 *      (e.g. the document-viewer "Save as PDF" button), never inside the worker.
 */

import { jsPDF } from 'jspdf'
// The ES build by path: svg2pdf.js has no exports map, so plain Node ESM resolves `main`, a UMD
// build that looks for a global `jspdf` and throws on import. Bundlers already picked this file
// (its `module`/`browser` field), so for them nothing changes.
import 'svg2pdf.js/dist/svg2pdf.es.min.js'

import type { DocSVGPage } from './types'

import { mmToPoints } from './utils'

import { OutfitByteString } from '../../assets/fonts/Outfit'
import { OutfitSemiBoldByteString } from '../../assets/fonts/OutfitSemiBold'

declare var WorkerGlobalScope: any; // avoid TS errors with possibly-unknown global

/** Per-document set of standalone page SVGs, keyed by document name. */
export type PDFExporterInput = Record<string, Array<DocSVGPage>>;

export class PDFExporter
{
    //// SETTINGS ////

    TEXT_FONT_DEFAULT = 'Outfit';

    //// END SETTINGS ////

    blobs:Record<string,Blob> = {}; // Generated documents as blobs, by doc name

    _jsPDF:any;     // the module
    _jsPDFDoc:any;  // the jsPDF document constructor
    _hasJsPDF:boolean = false;

    /** Make PDFExporter instance. Typically constructed empty and driven via
     *  export(data); optionally pass data (+ onDone) to export immediately. */
    constructor(data?:PDFExporterInput, onDone?:(buffers:Record<string,ArrayBuffer>) => any)
    {
        if(data)
        {
            this.export(data)
                .catch((e) => console.error(e))
                .then((buffers) =>
                {
                    if(typeof onDone === 'function' && buffers)
                    {
                        onDone(buffers);
                    }
                })
        }
    }

    reset()
    {
        this.blobs = {};
    }

    /** Render the given documents (per-page SVGs) to PDF.
     *  @returns Record of ArrayBuffers by document name. */
    async export(data:PDFExporterInput): Promise<Record<string, ArrayBuffer>>
    {
        this.reset();

        try {
            await this.loadJsPDF();
        }
        catch(e)
        {
            console.error(`PDFExporter::export(): Could not load 'jspdf'. ERROR: "${e}". Make sure it is added to the project. PDFExporter will not work!`)
            return null;
        }

        // In Node we need a jsdom DOM for svg2pdf; in the browser the native DOM is used.
        // Its globals are only there while rendering, so the rest of the process does not
        // take itself for a browser afterwards.
        const restoreGlobals = (!this.isBrowser() && !this.isWorker())
            ? await this.loadDomForNode().then(() => this._setNodeGlobals())
            : () => {};

        try {
            for(const [docName, pages] of Object.entries(data))
            {
                this.blobs[docName] = await this._renderDoc(docName, pages);
            }
        }
        finally {
            restoreGlobals();
        }

        // NOTE: callers handle saving/downloading (e.g. the document-viewer downloads
        // the returned buffer); _saveBlobToBrowserFile() is available for File System
        // Access API saves but is not auto-invoked here.

        // Turn all into ArrayBuffers for further processing
        const docsByNameArrayBuffer:Record<string, ArrayBuffer> = {};
        for(const [k, blob] of Object.entries(this.blobs))
        {
            docsByNameArrayBuffer[k] = await blob.arrayBuffer();
        }
        return docsByNameArrayBuffer;
    }

    /** Load jsPDF as module dynamically and register custom fonts */
    async loadJsPDF():Promise<PDFExporter>
    {
        if(this.hasJsPDF())
        {
            return this;
        }

        this._jsPDF = await import('jspdf'); // module entry
        this._jsPDFDoc = this._jsPDF.jsPDF;  // document constructor

        // Register custom fonts so SVG text in 'Outfit' renders correctly
        const addCustomFonts = function(this:any)
        {
            this.addFileToVFS('Outfit.ttf', OutfitByteString);
            this.addFileToVFS('OutfitBold.ttf', OutfitSemiBoldByteString); // semi-bold used as bold
            this.addFont('Outfit.ttf', 'Outfit', 'normal');
            this.addFont('OutfitBold.ttf', 'Outfit', 'bold');
        }
        this._jsPDFDoc.API.events.push(['addFonts', addCustomFonts]);

        this._hasJsPDF = true;
        return this;
    }

    hasJsPDF():boolean
    {
        return this._hasJsPDF;
    }

    /** Render a single document (its per-page SVGs) into one jsPDF document Blob */
    async _renderDoc(docName:string, pages:Array<DocSVGPage>):Promise<Blob>
    {
        if(!pages || pages.length === 0)
        {
            console.warn(`PDFExporter::_renderDoc(): Document "${docName}" has no pages. Producing an empty PDF.`);
        }

        let pdfDoc:jsPDF;

        for(let i = 0; i < pages.length; i++)
        {
            const page = pages[i];
            const wPt = mmToPoints(page.widthMm);
            const hPt = mmToPoints(page.heightMm);
            // Derive orientation from the actual dimensions so jsPDF doesn't swap w/h
            const orientation = (wPt >= hPt) ? 'landscape' : 'portrait';

            if(i === 0)
            {
                pdfDoc = new this._jsPDFDoc({
                    orientation,
                    unit: 'pt',
                    format: [wPt, hPt],
                    putOnlyUsedFonts: true,
                }) as jsPDF;
                pdfDoc.setFont(this.TEXT_FONT_DEFAULT, 'normal');
            }
            else {
                pdfDoc.addPage([wPt, hPt], orientation);
            }

            const svgEl = this._svgStringToElement(page.svg);
            try {
                // svg2pdf paints the SVG into the current page at 1mm -> mmToPoints(1)pt
                await (pdfDoc as any).svg(svgEl, { x: 0, y: 0, width: wPt, height: hPt });
            }
            finally {
                this._releaseSvgElement(svgEl);
            }
        }

        // If a document somehow had zero pages, still produce a valid (blank) PDF
        if(!pdfDoc)
        {
            pdfDoc = new this._jsPDFDoc({ unit: 'pt' }) as jsPDF;
        }

        return pdfDoc.output('blob' as any, { filename: `${docName}.pdf` }) as any as Blob;
    }

    //// DOM ACQUISITION ////

    /** Parse an SVG string into a live DOM SVG element that svg2pdf can walk.
     *  In the browser the element is attached offscreen so getBBox()/layout work. */
    _svgStringToElement(svg:string):Element
    {
        if(this.isWorker())
        {
            throw new Error(`PDFExporter: Cannot render PDF inside a Web Worker (no DOM). Generate PDFs on the main thread or in Node (with jsdom).`);
        }

        if(this.isBrowser())
        {
            const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
            const el = document.importNode(parsed, true) as Element;

            // Attach offscreen so text measurement / getBBox resolve correctly
            const host = document.createElement('div');
            host.setAttribute('data-pdf-svg-host', '');
            host.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;';
            host.appendChild(el);
            document.body.appendChild(host);
            return el;
        }

        // Node: requires jsdom (best-effort). We set up minimal globals svg2pdf expects.
        return this._svgStringToElementNode(svg);
    }

    /** Remove the offscreen host used during rendering (browser only) */
    _releaseSvgElement(el:Element)
    {
        if(this.isBrowser())
        {
            const host = el?.parentElement;
            if(host && host.hasAttribute('data-pdf-svg-host'))
            {
                host.remove();
            }
        }
    }

    _jsdomWindow:any; // cached jsdom window in node

    _svgStringToElementNode(svg:string):Element
    {
        if(!this._jsdomWindow)
        {
            throw new Error(`PDFExporter: jsdom DOM not initialized. Call loadDomForNode() before exporting in Node.`);
        }
        const doc = this._jsdomWindow.document;
        const parsed = new this._jsdomWindow.DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        const el = doc.importNode(parsed, true) as Element;
        doc.body.appendChild(el);
        return el;
    }

    /** Initialize a jsdom DOM (Node only). export() calls it, and sets the globals svg2pdf
     *  relies on only while rendering (see _setNodeGlobals). */
    async loadDomForNode():Promise<void>
    {
        if(this.isBrowser() || this.isWorker() || this._jsdomWindow){ return; }

        await this.loadJsPDF(); // its fonts measure the text, below

        const jsdomPkg = 'jsdom'; // indirection so browser bundlers don't try to resolve it
        const { JSDOM, VirtualConsole } = await import(/* @vite-ignore */ jsdomPkg);
        // a console of its own: svg2pdf tries a canvas first, and jsdom reports that as "not implemented"
        const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { virtualConsole: new VirtualConsole() });
        this._jsdomWindow = dom.window;

        // svg2pdf parses the <style>s of the SVG in a document of its own (createHTMLDocument), but
        // jsdom only parses the style sheets of a document that has a window: give it ours. What it
        // adds there goes when the export is done (see _setNodeGlobals).
        dom.window.document.implementation.createHTMLDocument = () => dom.window.document;

        // jsdom does no layout, so it has no getBBox(), and its canvas has no 2D context. svg2pdf
        // measures text with one of them (for text-anchor middle/end): measure with jsPDF's own
        // metrics of the font the PDF uses instead. Only the width is read.
        const measurer = new this._jsPDFDoc({ unit: 'pt' });
        const fontNames = Object.keys(measurer.getFontList());
        dom.window.SVGElement.prototype.getBBox = function(this:Element)
        {
            const fontSize = parseFloat(this.getAttribute('font-size') ?? '16') || 16;
            const family = (this.getAttribute('font-family') ?? '').split(',')
                .map(f => f.trim().replace(/^['"]|['"]$/g, ''))
                .find(f => fontNames.includes(f)) ?? 'helvetica';
            const bold = /bold|[6-9]00/.test(this.getAttribute('font-weight') ?? '');
            measurer.setFont(family, bold && family === 'Outfit' ? 'bold' : 'normal');
            const width = measurer.getStringUnitWidth(this.textContent ?? '') * fontSize;
            return { x: 0, y: 0, width, height: fontSize };
        };

        // svg2pdf asks an Image how big a bitmap is (a hatch with a texture, a picture on a
        // page); jsdom's Image never loads without a canvas. jsPDF reads it off the file.
        this._NodeImage = class
        {
            width = 0; height = 0
            onload:(() => void)|null = null
            onerror:((e:any) => void)|null = null
            set src(src:string)
            {
                setTimeout(() =>
                {
                    try
                    {
                        const { width, height } = measurer.getImageProperties(src);
                        this.width = width; this.height = height;
                        this.onload?.();
                    }
                    catch(e){ this.onerror?.(e) }
                });
            }
        };
    }

    _NodeImage:any; // see loadDomForNode

    /** Put the jsdom globals that svg2pdf reaches for on globalThis; returns the function that
     *  puts back what was there. `window` is left alone: other code tests it to detect a browser. */
    _setNodeGlobals():() => void
    {
        const g = globalThis as any;
        const w = this._jsdomWindow;
        const names = ['document', 'DOMParser', 'CSSStyleSheet', 'CSSStyleRule', 'Image'];
        const before = names.map(n => [n, Object.getOwnPropertyDescriptor(g, n)] as const);
        names.forEach(n => { g[n] = (n === 'Image') ? this._NodeImage : w[n]; });

        return () =>
        {
            w.document.body.replaceChildren(); // the pages and style sheets of this export
            before.forEach(([n, d]) =>
            {
                if(d){ Object.defineProperty(g, n, d); }
                else { delete g[n]; }
            });
        };
    }

    //// FILE SAVE (browser / node file handle) ////

    /** Save the given doc (or the first) to a file via the File System Access API */
    async _saveBlobToBrowserFile(docName?:string)
    {
        docName = docName || Object.keys(this.blobs)[0];
        const blob = this.blobs[docName];
        if(!blob){ return; }

        if(this.isBrowser() && typeof (window as any).showSaveFilePicker === 'function')
        {
            const fileHandle = await this._getNewFileHandle("PDF", "application/pdf", "pdf");
            await this._writeFile(fileHandle, blob);
            console.info("Saved PDF to " + fileHandle.name);
        }
    }

    /** Get first generated Blob */
    getBlob():Blob|null
    {
        return (Object.values(this.blobs).length) ? Object.values(this.blobs)[0] : null;
    }

    async _getNewFileHandle(desc:string, mime:string, ext:string, open = false)
    {
        const options = {
          types: [ { description: desc, accept: { [mime]: ['.' + ext] } } ],
        };

        return open
            ? await (window as any).showOpenFilePicker(options)
            : await (window as any).showSaveFilePicker(options);
    }

    async _writeFile(fileHandle:any, contents:Blob)
    {
        const writable = await fileHandle.createWritable();
        await writable.write(contents);
        await writable.close();
    }

    //// ENV DETECTION ////

    isBrowser():boolean
    {
        return typeof window === 'object' && !this.isWorker();
    }

    isWorker():boolean
    {
        return (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope)
    }
}
