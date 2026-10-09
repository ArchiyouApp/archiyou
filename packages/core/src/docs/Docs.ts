/**
 *
 *  Docs.ts
 *
 *     Docs module: owns a collection of Documents (see them as 'files') and
 *     exports them (toData/toPDF/toSVG). The actual document-building API lives
 *     on the Document class - Docs.create() returns a Document to build on.
 *
 *     For backwards compatibility, the former fluent methods are kept here as
 *     thin delegating shims that forward to a default/active Document.
 *
 *      Important entities:
 *        - Docs - this module, set of Documents
 *        - Document - set of pages + the building API
 *        - Page
 *        - Container - blocks on the page with content
 *
 *      Example:
 *          docs
 *          .create('myDoc')   // returns a Document
 *          .units('mm')
 *          .page('isometry')
 *          .view('isometric view')
 *          .shapes(leftfrontback)
 *          .text('My design');
 *
 */

import { ArchiyouModules } from '../types';

import { ShapeCollection } from '@archiyou/meshup';

import type { PageOrientation, ScaleInput, ImageOptions, TextOptions,
        ContainerAlignment, ContainerHAlignment, ContainerVAlignment,
        ContainerPositionLike, PageSize, DocPathStyle, WidthHeightInput,
        ContainerTableInput, TableContainerOptions as TableOptions,
        DocGraphicInputRect, DocGraphicInputCircle, DocGraphicInputOrthoLine,
        ContainerBlock, TitleBlockInput, LabelBlockOptions, InstructableOptions,
        DocSettings, DocUnits, DocData, DocSVGPage, ViewOptions } from './types'
import type { UnitSystem } from '../units/UnitConverter'

import { Document } from './Document'
import { Pipeline } from '../execution/Pipeline'
import { Instruct } from './instruct/Instruct'
import { PDFExporter } from './PDFExporter'


//// MAIN CLASS ////

export class Docs
{
    //// SETTINGS ////
    DOC_DEFAULT_NAME = 'doc'
    DOC_UNITS_DEFAULT:DocUnits = 'mm';
    PAGE_SIZE_DEFAULT:PageSize = 'A4';
    PAGE_ORIENTATION_DEFAULT:PageOrientation = 'landscape';
    CONTENT_ALIGN_DEFAULT:ContainerAlignment = ['left', 'top'];
    TEXT_SIZE_DEFAULT = '10mm';
    TYPES_WITHOUT_CAPTION = ['text', 'textarea'];

    //// END SETTINGS ////
    _archiyou:ArchiyouModules; // all archiyou modules together
    _settings:DocSettings; // some essential settings like _settings.proxy

    _calc:any; // Cannot use reference to Calc here, because we don't allow references outside core
    _pdfExporter:PDFExporter;

    _docs:Array<Document> = []; // multiple Documents names (see them as 'files')

    _activeDoc:Document; // active Document instance

    _runUnitSystem?:UnitSystem; // the run's system for documents (request.docUnitSystem), see Document.resolveUnitSystem()

    _missingPipelines:Set<string> = new Set(); // pipeline names a document uses but the script lacks, warned once
    _instructs:Array<Instruct> = []; // instructables (see instruct/Instruct.ts)

    _assetsCache:Record<string,any> = {}; // keep assets like images in cache to avoid reloading on every toData() call


    constructor(settings?:DocSettings, ay?:ArchiyouModules) // null is allowed
    {
        this._pdfExporter = new PDFExporter(); // empty PDF exporter
        this.setArchiyou(ay);

        //// DEFAULTS
        this._setDefaults();

        //// SETTINGS AND CHECKS ////
        // No settings is fine: getAssetProxyUrl() falls back to the running
        // request's assetProxyUrl, which is how the editor supplies it.
        this._settings = settings;
    }

    /** BASE url of the asset proxy for anything this document fetches (images).
     *  Explicit settings win; otherwise it comes from the request being executed, which
     *  is where the editor puts it (execution-service sets assetProxyUrl = API_BASE_URL).
     *  undefined means "no proxy configured" — the caller then fetches directly, which
     *  works in node but is blocked by CORS/CSP in the browser.
     *
     *  '' is a MEANINGFUL value (root-relative `/proxy`), so this must not collapse it
     *  to a falsy "unset". */
    getAssetProxyUrl():string|undefined
    {
        const fromSettings = this._settings?.proxy;
        if(typeof fromSettings === 'string') return fromSettings;
        const fromRequest = this._archiyou?.runner?.getActiveExecRequest?.()?.assetProxyUrl;
        return (typeof fromRequest === 'string') ? fromRequest : undefined;
    }

    /** ABSOLUTE origin to resolve a root-relative image path against when the run has
     *  no origin of its own (node). Explicit settings win, else the running request's
     *  appBaseUrl, which the server fills from FRONTEND_URL. undefined in a browser
     *  run that was never told one — there location.origin is the answer anyway. */
    getAppBaseUrl():string|undefined
    {
        const fromSettings = this._settings?.baseUrl;
        if(typeof fromSettings === 'string' && fromSettings) return fromSettings;
        const fromRequest = this._archiyou?.runner?.getActiveExecRequest?.()?.appBaseUrl;
        return (typeof fromRequest === 'string' && fromRequest) ? fromRequest : undefined;
    }

    hasDocs():boolean
    {
        return this._docs.length > 0
    }

    //// MAIN FUNCTIONS ////

    setArchiyou(ay?:ArchiyouModules)
    {
        if(ay)
        {
            this._archiyou = ay;
        }
    }

    get modelerClasses()
    {
        if(!this._archiyou || !this._archiyou.modeler)
        {
            throw new Error(`Docs::modelerClasses: Cannot get modeler classes. Archiyou modules not set or modeler module not found! Please set archiyou modules with setArchiyou() before using.`);
        }
        return this._archiyou.modeler.classes;
    }

    /** Reset state of Docs instance */
    reset()
    {
        this._docs = [];
        this._activeDoc = null;
        this._runUnitSystem = undefined;
        this._instructs = [];
        this._missingPipelines = new Set();
    }

    _setDefaults():Docs
    {
        this.reset();
        return this;
    }

    //// PIPELINES ////

    /** Add a document's pipeline (doc.pipeline(fn)): to the script's pipelines when a Runner
     *  runs it, so it can be picked and exported like any other, else on its own
     *  @internal */
    _registerPipeline(name:string, fn:(mainScope?:any) => any):Pipeline
    {
        const runner = this._archiyou?.runner as any;
        return (typeof runner?.pipeline === 'function')
            ? runner.pipeline(name, fn, runner.getActiveScope(), true)
            : new Pipeline(name, fn);
    }

    /** The pipelines a document uses, names looked up in the script's pipelines
     *  @param warn say so when a name is not found
     *  @internal */
    _pipelinesOf(doc:Document, warn:boolean = true):Array<Pipeline>
    {
        const runner = this._archiyou?.runner as any;
        return doc._pipelines
            .map(p =>
            {
                if(typeof p !== 'string'){ return p }
                const found = runner?.getPipelineByName?.(p) as Pipeline|undefined;
                if(!found && warn && !this._missingPipelines.has(p))
                {
                    this._missingPipelines.add(p);
                    const message = `Document "${doc._name}" uses pipeline '${p}', but there is no $pipeline('${p}', ...) in this script`;
                    console.warn(`Docs::_pipelinesOf(): ${message}`);
                    this._archiyou?.console?.warn?.(message);
                }
                return found;
            })
            .filter(Boolean);
    }

    /** Names of the documents that use pipeline `name`
     *  @internal */
    _pipelineDocs(name:string):Array<string>
    {
        return this._docs
            .filter(doc => this._pipelinesOf(doc, false).some(p => p.name === name))
            .map(doc => doc._name);
    }

    /** Run the pipelines of the documents that are not done yet, right away
     *  @param include names of the documents (all when empty)
     *  @param exclude names of the documents to leave out
     *  @internal */
    executePipelines(include:Array<string> = [], exclude:Array<string> = []):void
    {
        const scope = this._archiyou?.runner?.getActiveScope?.();
        this._pipelinesToRun(include, exclude).forEach(p => p.runSync(scope, this._archiyou));
    }

    /** Run the pipelines of the documents that are not done yet, awaiting async ones
     *  @param include names of the documents (all when empty)
     *  @internal */
    async _runPipelines(include:Array<string> = []):Promise<void>
    {
        const scope = this._archiyou?.runner?.getActiveScope?.();
        await this._pipelinesToRun(include, []).reduce(
            async (previous, p) => { await previous; await p.run(scope, this._archiyou); },
            Promise.resolve());
    }

    _pipelinesToRun(include:Array<string>, exclude:Array<string>):Array<Pipeline>
    {
        const all = include.length === 0 || include.includes('*');
        const pipelines = this._docs
            .filter(doc => (all || include.includes(doc._name)) && !exclude.includes(doc._name))
            .flatMap(doc => this._pipelinesOf(doc));
        return [...new Set(pipelines)].filter(p => !p.done);
    }

    //// DOCS API ////

    /** Make a new document and build on it: pages, views, text, tables. It starts in mm on
     *  A4 landscape (inch on Letter for a model in inches or feet); see units(), pageSize()
     *  and pageOrientation(). Each document becomes a PDF in the Doc tool and the outputs.
     *  @param name  Its name (default 'doc1', 'doc2', …).
     *  @returns The new document.
     *
     *  @example
     *  box(1000, 500, 700)
     *  iso = all().iso().tmp()
     *  docs.create('plan')
     *      .page('overview')
     *      .text('My design')
     *      .view('iso', iso).width(0.5).position('right').pivot('right')
     */
    create(name?:string):Document
    {
        const docName = `${this.DOC_DEFAULT_NAME}${this._docs.length+1}` // start a unnamed doc
        const newDoc = new Document(this, name || docName);
        this._docs.push(newDoc); // create new Document with default name
        this._activeDoc = newDoc; // set active Document

        return newDoc;
    }

    //// INSTRUCTABLES ////

    /** Make or get an instructable — a step-by-step manual generated from the finished scene.
     *
     *  Mirrors create(): the Docs module owns them, the Instruct carries the building API.
     *  One script can hold several (an assembly manual and a maintenance manual are different
     *  sequences over the same model), and calling this twice with one name returns the same
     *  one rather than starting a second.
     *
     *      docs.instruct('assembly')
     *          .title('Workbench')
     *          .parts()                       // identify + label + print
     *          .step('Bolt the rails to the legs')
     *              .shapes('A', 'B')
     *              .subject('B')
     *              .camera('front')
     *              .move({ from: 'top' });
     */
    instruct(name:string = 'instructable'):Instruct
    {
        const existing = this._instructs.find(i => i._name === name);
        if(existing){ return existing }

        const made = new Instruct(this, name);
        this._instructs.push(made);

        return made;
    }

    /** Names of the instructables in this script. */
    instructs():Array<string>
    {
        return this._instructs.map(i => i._name);
    }

    /** One instructable by name, or null. */
    getInstruct(name:string):Instruct|null
    {
        return this._instructs.find(i => i._name === name) ?? null;
    }

    /** Check if there is an active Document, otherwise create a default one */
    checkAndMakeDefaultDoc():Document
    {
        if(!this._activeDoc)
        {
            this.create();
        }

        return this._activeDoc;
    }

    //// BACKWARDS-COMPATIBLE FLUENT SHIMS ////
    /*  These forward to a default/active Document so existing scripts that call
        building methods directly on the module (e.g. docs.page('x').text(...))
        keep working. They all return the Document to continue chaining. */

    name(name:string):Document { return this.checkAndMakeDefaultDoc().name(name); }
    units(units:DocUnits):Document { return this.checkAndMakeDefaultDoc().units(units); }
    pageSize(size:PageSize):Document { return this.checkAndMakeDefaultDoc().pageSize(size); }
    pageOrientation(o:PageOrientation):Document { return this.checkAndMakeDefaultDoc().pageOrientation(o); }
    page(name:string):Document { return this.checkAndMakeDefaultDoc().page(name); }
    pipeline(pipeline:string|Pipeline|((mainScope?:any) => any)):Document { return this.checkAndMakeDefaultDoc().pipeline(pipeline); }
    size(size:PageSize):Document { return this.checkAndMakeDefaultDoc().size(size); }
    padding(w:WidthHeightInput, h?:WidthHeightInput):Document { return this.checkAndMakeDefaultDoc().padding(w,h); }
    orientation(o:PageOrientation):Document { return this.checkAndMakeDefaultDoc().orientation(o); }
    view(name?:string, shapesOrOptions?:ShapeCollection|string|ViewOptions, options?:ViewOptions):Document { return this.checkAndMakeDefaultDoc().view(name, shapesOrOptions, options); }
    image(url:string, options?:ImageOptions):Document { return this.checkAndMakeDefaultDoc().image(url, options); }
    text(text:string|number, options?:TextOptions):Document { return this.checkAndMakeDefaultDoc().text(text, options); }
    textarea(text:string|number, options?:TextOptions):Document { return this.checkAndMakeDefaultDoc().textarea(text, options); }
    table(nameOrData:ContainerTableInput, options?:TableOptions):Document { return this.checkAndMakeDefaultDoc().table(nameOrData, options); }
    rect(input?:number|string|DocGraphicInputRect, style?:DocPathStyle):Document { return this.checkAndMakeDefaultDoc().rect(input, style); }
    circle(input?:number|string|DocGraphicInputCircle, style?:DocPathStyle):Document { return this.checkAndMakeDefaultDoc().circle(input, style); }
    hline(input?:string|number|DocGraphicInputOrthoLine, thickness?:number|string, color?:string):Document { return this.checkAndMakeDefaultDoc().hline(input, thickness, color); }
    vline(input?:string|number|DocGraphicInputOrthoLine, thickness?:number|string, color?:string):Document { return this.checkAndMakeDefaultDoc().vline(input, thickness, color); }
    var(name:string):Document { return this.checkAndMakeDefaultDoc().var(name); }
    tag(name:string):Document { return this.checkAndMakeDefaultDoc().tag(name); }
    set(name:string, value:string):Document { return this.checkAndMakeDefaultDoc().set(name, value); }
    titleblock(data?:TitleBlockInput):Document { return this.checkAndMakeDefaultDoc().titleblock(data); }
    labelblock(labels:string|Array<string>, texts:string|Array<string>, options?:LabelBlockOptions):Document { return this.checkAndMakeDefaultDoc().labelblock(labels, texts, options); }
    instructable(name?:string, options?:InstructableOptions):Document { return this.checkAndMakeDefaultDoc().instructable(name, options); }
    lastBlock():ContainerBlock { return this.checkAndMakeDefaultDoc().lastBlock(); }
    width(n:WidthHeightInput):Document { return this.checkAndMakeDefaultDoc().width(n); }
    height(n:WidthHeightInput):Document { return this.checkAndMakeDefaultDoc().height(n); }
    position(x:number|string|ContainerPositionLike, y?:number|string):Document { return this.checkAndMakeDefaultDoc().position(x, y); }
    pivot(x:number|ContainerPositionLike|string|Array<number|number>, y?:number):Document { return this.checkAndMakeDefaultDoc().pivot(x, y); }
    border(style?:DocPathStyle):Document { return this.checkAndMakeDefaultDoc().border(style); }
    contentAlign(align:ContainerHAlignment|ContainerVAlignment|ContainerAlignment):Document { return this.checkAndMakeDefaultDoc().contentAlign(align); }
    caption(s?:string|boolean|Record<string,any>):Document { return this.checkAndMakeDefaultDoc().caption(s); }
    title(s?:string):Document { return this.checkAndMakeDefaultDoc().title(s); }
    shapes(shapes:ShapeCollection|string, all:boolean=false):Document { return this.checkAndMakeDefaultDoc().shapes(shapes, all); }
    zoom(level:number):Document { return this.checkAndMakeDefaultDoc().zoom(level); }
    scale(factor?:ScaleInput):Document { return this.checkAndMakeDefaultDoc().scale(factor); }
    merge(d:Document|Array<Document>|Record<string, Document>, namePrefix:string=''):Document { return this.checkAndMakeDefaultDoc().merge(d, namePrefix); }

    //// OUTPUT ////

    /** The names of the documents made so far.
     *  @returns Like ['plan', 'parts'].
     */
    docs():Array<string>
    {
        return this._docs.map(doc => doc._name);
    }

    /** A document by its name, to add to it later in the script.
     *  @param name  The document's name.
     *  @returns The document, or null when there is none by that name.
     */
    getDoc(name:string):Document|null
    {
        const doc = this._docs.find(d => d._name === name);
        return doc || null;
    }

    getDocs(only:Array<string>|any=[]):Array<Document>
    {
        // checks
        only = (Array.isArray(only)) ? only : [];
        const doFilter = only.length > 0 && only.includes('*') === false; // if onlyDocs is empty or includes '*', we export all docs

        this.executePipelines(doFilter ? only : []);

        if(doFilter)
        {
            return this._docs.filter(doc => only.includes(doc._name));
        }
        else {
            return this._docs;
        }
    }

    /** For moving Docs internally around from component scopes
     *  @param only names of the documents (all when not given) */
    toInternalData(only?:Array<string>):Array<Document>
    {
        if(typeof this._docs !== 'object' || this._docs.length === 0) return [];

        return Object.values(this._docs)
            .filter(curDoc => !only || only.includes(curDoc._name))
            .map( curDoc => curDoc.resolveScopeReferences());

    }

    /** Export pure data */
    async toData(onlyDocs:string|Array<string>, noCache:boolean=false):Promise<{[key:string]:DocData} | undefined>
    {
        onlyDocs = (Array.isArray(onlyDocs))
                ? onlyDocs : typeof onlyDocs === 'string' ? [onlyDocs] : [];

        const doFilter = onlyDocs.length > 0 && onlyDocs.includes('*') === false; // if onlyDocs is empty or includes '*', we export all docs

        this.executePipelines(doFilter ? onlyDocs : []);

        const docs = {};

        for(let d = 0; d < this._docs.length; d++)
        {
            const doc = this._docs[d];
            if(!doFilter || (doFilter && onlyDocs.includes(doc._name)))
            {
                const docData = await doc.toData(noCache ? this._assetsCache : undefined);
                if(docData)
                {
                    docs[doc._name] = docData;
                }
            }
            else {
                console.warn(`Docs::toData(): Skipping doc "${doc._name}" because it is not in the onlyDocs list!`);
            }
        };

        return docs;
    }

    /** Export selected or all Documents to pdfs
     *  @param only string/Array of doc names to export. Default is all
     *  @returns Either single pdf ArrayBuffer or Record of ArrayBuffers if multiple docs are exported
     */
    async toPDF(only:string|Array<string>=[]):Promise<ArrayBuffer | Record<string, ArrayBuffer>>
    {
        const onlyDocs = (Array.isArray(only)) ? only : (typeof only === 'string') ? [only] : [];
        const docs = this.getDocs(onlyDocs);

        // PDF is a thin wrapper over SVG: render each page to a standalone SVG,
        // then let the exporter paint each into its own PDF page (see PDFExporter).
        const pagesByDocName: Record<string, Array<DocSVGPage>> = {};
        for (const doc of docs)
        {
            pagesByDocName[doc._name] = await doc.toSVGPages(this._assetsCache);
        }

        const pdfBuffersByDocName = await this._pdfExporter.export(pagesByDocName);

        return (Object.keys(pdfBuffersByDocName).length === 1)
                ? Object.values(pdfBuffersByDocName)[0] // single buffer
                : pdfBuffersByDocName; // multiple buffers by doc name
    }

    /** Export selected or all Documents as per-page standalone SVG strings.
     *  This is the intermediate step used for PDF export, but is also surfaced
     *  to the app (e.g. the document-viewer "Save as PDF" button) so PDF
     *  rendering can happen on the main thread where a DOM is available.
     *  @param only string/Array of doc names to export. Default is all.
     *  @returns Either a single Array<DocSVGPage> or Record<docName, Array<DocSVGPage>> for multiple docs.
     */
    async toSVGPages(only:string|Array<string>=[]):Promise<Array<DocSVGPage> | Record<string, Array<DocSVGPage>>>
    {
        const onlyDocs = (Array.isArray(only)) ? only : (typeof only === 'string') ? [only] : [];
        const docs = this.getDocs(onlyDocs);

        const pagesByDocName: Record<string, Array<DocSVGPage>> = {};
        for (const doc of docs)
        {
            pagesByDocName[doc._name] = await doc.toSVGPages(this._assetsCache);
        }

        return (Object.keys(pagesByDocName).length === 1)
                ? Object.values(pagesByDocName)[0]   // single doc
                : pagesByDocName;                      // multiple by doc name
    }

    /** Export selected or all Documents as InkScape-compatible multi-page SVG strings.
     *  @param only string/Array of doc names to export. Default is all.
     *  @returns Either a single SVG string or Record<docName, svgString> if multiple docs are exported.
     */
    async toSVG(only:string|Array<string>=[]):Promise<string | Record<string, string>>
    {
        const onlyDocs = (Array.isArray(only)) ? only : (typeof only === 'string') ? [only] : [];
        const docs = this.getDocs(onlyDocs);

        const svgStringsByDocName: Record<string, string> = {};
        for (const doc of docs)
        {
            svgStringsByDocName[doc._name] = await doc.toSVG(this._assetsCache);
        }

        return (Object.keys(svgStringsByDocName).length === 1)
                ? Object.values(svgStringsByDocName)[0]   // single SVG string
                : svgStringsByDocName;                     // multiple strings by doc name
    }

}
