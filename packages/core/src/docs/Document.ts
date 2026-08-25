/**
 *
 *  Document.ts
 *
 *      A single Document that is part of a Docs module instance.
 *      It owns its pages, its active page/container state and the entire
 *      fluent document-building API.
 *
 *      Example:
 *          docs
 *          .create('myDoc')   // returns a Document
 *          .units('mm')
 *          .page('isometry')
 *          .size('A4')
 *          .padding('10mm')
 *          .orientation('landscape')
 *          .view('isometric view')
 *          .shapes(leftfrontback)
 *          .scale('auto')
 *          .width('100%')
 *          .height('100%')
 *          .position('topleft')
 *          .text('My design')
 *          .var('title');
 */

import { Docs } from './Docs'
import { Page } from './Page'
import { Container } from './Container'
import { View } from './View'
import { Text } from './Text'
import { TextArea } from './TextArea'
import { Table } from './Table'
import { Image } from './Image'
import { Graphic } from './Graphic'

import { ShapeCollection } from '@archiyou/meshup'
import { isKernelShapeOrCollection } from '../modeler/typeguards'

import { ScriptParam } from '../execution/ScriptParam'
import type { ScriptParamData } from '../execution/types'

import type { DataRows } from '../calc/types'

import type { DocUnits, PageSize, PageOrientation, DocPipeline, DocData,
    PageSide, ContainerSide, ContainerSizeRelativeTo, ScaleInput, ImageOptions, TextOptions,
    AnyPageContainer, TableContainerOptions as TableOptions, DocPathStyle,
    ContainerAlignment, ContainerHAlignment, ContainerVAlignment,
    ContainerPositionLike, ContainerPositionAbs, DocUnitsWithPerc, PercentageString,
    ValueWithUnitsString, WidthHeightInput, ContainerTableInput,
    DocGraphicInputRect, DocGraphicInputCircle, DocGraphicInputOrthoLine,
    ContainerBlock, TitleBlockInput, LabelBlockOptions, DocSVGPage, ViewOptions } from './types'

import { isDocUnits, isPercentageString, isValueWithUnitsString, isAnyPageContainer,
    isContainerPositionCoordRel, isWidthHeightInput, isContainerTableInput, isPageOrientation,
    isContainerPositionLike, isContainerHAlignment, isContainerVAlignment, isContainerAlignment,
    isContainerPositionCoordAbs, isPageSize } from './typeguards'

import { convertValueFromToUnit, escapeXml } from './utils'
import { isNumeric } from '../utils'
import { DOC_DEFAULT_LOGO_URL } from '../constants'


/** A document that is part of a Docs module instance.
 *  It owns its pages, its working state and the document-building API. */
export class Document
{
    //// SETTINGS ////
    DOC_DEFAULT_NAME = 'Document'; // default name for document
    DOC_UNITS_DEFAULT:DocUnits = 'mm'; // default document units
    DOC_PAGE_SIZE_DEFAULT:PageSize = 'A4'; // default ISO page size (A0-A7)
    DOC_PAGE_ORIENTATION_DEFAULT:PageOrientation = 'landscape'; // default page orientation
    CONTENT_ALIGN_DEFAULT:ContainerAlignment = ['left', 'top'];
    TEXT_SIZE_DEFAULT = '10mm';
    TYPES_WITHOUT_CAPTION = ['text', 'textarea'];
    //// END SETTINGS

    _name:string; // name of document
    _pageSize:PageSize; // ISO page size (A0-A7)
    _pageOrientation:PageOrientation;
    _units:DocUnits;

    _docs:Docs; // reference to Docs module
    _pages:Array<Page> = []; // pages in this document
    _pipelines:Array<DocPipeline> = []; // pipelines for this document, see DocPipeline
    _activePage?:Page; // active page in this document
    _activeContainer:AnyPageContainer; // active container in this document
    _lastBlock:ContainerBlock; // keep track of latest created block
    _variables:Record<string, any> = {}; // references to containers, to set content later
    _component?:string; // component name if this document is part of a component - used for naming on merge

    constructor(doc:Docs, name:string)
    {
        this._docs = doc; // reference to Docs module
        this._name = name;

        this._pageSize = this.DOC_PAGE_SIZE_DEFAULT; // default page size
        this._pageOrientation = this.DOC_PAGE_ORIENTATION_DEFAULT; // default page orientation
        this._units = this.DOC_UNITS_DEFAULT; // default document units
    }

    /** Add page to this document */
    createPage(name:string):Page
    {
        if(this.pageExists(name)){ throw new Error(`Document::page: Page name "${name}" is already taken. Please use unique names!`)}
        const newPage = new Page(this._docs, this, name);
        this._pages.push(newPage);
        this._activePage = newPage; // set active page if not set
        console.info(`Document::createPage(): Created new page "${name}" in document "${this._name}" [#${this._pages.length}] with default settings [${this._units} - ${this._pageSize} - ${this._pageOrientation}]`);
        return newPage;
    }

    pageExists(name:string):boolean
    {
        return !!(this._pages.find(p => p.name === name));
    }

    addPipeline(p:DocPipeline):this
    {
        if(!p || !p.fn || typeof p.fn !== 'function')
        {
            throw new Error(`Document::addPipeline(): Invalid pipeline function. Please provide a valid function.`);
        }
        this._pipelines.push(p);
        return this;
    }

    //// DOCUMENT SETTINGS API ////

    /** Set name of this document */
    name(name:string):this
    {
        this._name = name;
        return this;
    }

    /** Set Unit for this Document: 'mm','cm' or 'inch' */
    units(units:DocUnits):this
    {
        if(!isDocUnits(units)){ throw new Error(`Document::units: Invalid units. Use 'mm', 'cm' or 'inch'`);}
        this._units = units;
        return this;
    }

    /** Set general page ISO size (A0,A4 etc) for this doc */
    pageSize(size:PageSize):this
    {
        if(!isPageSize(size)){ throw new Error(`Document::pageSize: Invalid ISO page size. Use: A0, A4 etc!`);}
        this._pageSize = size;
        return this;
    }

    /** Set general page orientation for this doc */
    pageOrientation(o:PageOrientation):this
    {
        if(!isPageOrientation(o)){ throw new Error(`Document::pageOrientation: Invalid page orientation. Use 'landscape' or 'portrait'`);}
        this._pageOrientation = o;
        return this;
    }

    /** Check if there is an active Page, otherwise create a default one
     *  This avoids errors when user forgets to create a page
    */
    _getOrMakeActivePage()
    {
        if(!this._activePage)
        {
            console.warn(`Document::_getOrMakeActivePage(): No active page. Creating default page 'default'`);
            this.page('default');
        }
        return this._activePage;
    }

    /** Add a new page to the doc with given name */
    page(name:string):this
    {
        if(!name){ throw new Error(`Document::page: Please supply a name to a page!`)}

        this._activePage = this.createPage(name);

        return this;
    }

    /** Define script that is executed before this Document is generated */
    pipeline(fn: () => any):this
    {
        if(typeof fn !== 'function')
        {
            throw new Error(`Document::pipeline(): Please supply a function that is executed before generating this Document!`);
        }

        if(!fn.hasOwnProperty('prototype'))
        {
            console.warn(`Document::pipeline(): You supplied a function defined with arrows. Use return { var1, var2 } to export variables to execution scope!`);
        }

        this.addPipeline({ fn: fn, done: false } as DocPipeline);

        return this;
    }

    //// PAGE API ////

    /** Set size of active Page */
    size(size:PageSize):this
    {
        this._checkPageIsActive();
        this._activePage.size(size);

        return this;
    }

    /** Set padding of active Page (width (left and right) and height (top and bottom))
     *  Use relative width/height ([0-1]), number with percentage (5%) or number with real units ('1cm','0.5"')
    */
    padding(w:WidthHeightInput, h?:WidthHeightInput):this // in doc units
    {
        if(!isWidthHeightInput(w)){ throw new Error(`Document::padding: Please supply padding (width,height) as relative width/height ([0-1]), percentage string (10%) or a number with units ('1cm','0.5"')`);}
        this._checkPageIsActive();
        this._activePage.padding(w,h);

        return this;
    }

    /** Set orientation ('landscape' or 'portrait') of active page */
    orientation(o:PageOrientation):this
    {
        if(!isPageOrientation(o)){ throw new Error(`Document::orientation: Invalid page orientation. Use 'landscape' or 'portrait'`);}
        this._checkPageIsActive();
        this._activePage._orientation = o;

        return this;
    }

    //// BASIC CONTAINERS ////

    /** Add View Container to active Page
     *
     *  `view('elevation', { scale: 1/100, caption: true, bar: true })` — options may take the
     *  place of the shapes, or follow them. The two are told apart structurally (a Shape and
     *  a ShapeCollection both answer isShapeClass()/isShapeCollection()), so an options object
     *  can never be mistaken for geometry. Passing options where shapes were expected used to
     *  drop them silently.
     */
    view(name?:string, shapesOrOptions?:ShapeCollection|string|ViewOptions, options?:ViewOptions):this
    {
        if(typeof name !== 'string'){ throw new Error(`Document::view: Please supply a name to the view!`);}
        this._checkPageIsActive();

        const newViewContainer = new View().on(this._getOrMakeActivePage()).setName(name);
        this._activeContainer = newViewContainer;

        const givenShapes = (isKernelShapeOrCollection(shapesOrOptions) || typeof shapesOrOptions === 'string')
                                ? shapesOrOptions
                                : null;
        const givenOptions = (givenShapes === null) ? shapesOrOptions as ViewOptions : options;

        newViewContainer.setOptions(givenOptions);

        if(givenShapes !== null)
        {
            this.shapes(givenShapes as ShapeCollection|string);
        }
        return this;
    }

    /** Add Image Container to active Page */
    image(url:string, options?:ImageOptions):this
    {
        if(typeof url !== 'string' || url.trim() === ''){ throw new Error(`Document::image: Please supply a string with the image url`);}
        // http(s), a data: uri, or a path on the app's own origin ('/img/logo.png' — which
        // is what the default titleblock logo is). Any OTHER scheme is refused: 'file:' and
        // friends are not something a document should be able to reach.
        const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
        if(scheme && !['http','https','data'].includes(scheme))
        {
            throw new Error(`Document::image: Cannot load an image from '${scheme}:'. Use an http(s) url, a data: uri, or a path like '/img/logo.png'.`);
        }

        const newImageContainer = new Image(url, options).on(this._getOrMakeActivePage());
        this._activeContainer = newImageContainer;

        return this;
    }

    /** Add Text line to active Page */
    text(text:string|number, options?:TextOptions):this
    {
        if( (typeof text !== 'string') && (typeof text !== 'number') ){ throw new Error('Document::text(): Please supply a string or number for a Text Container!') }
        text = (typeof text !== 'string') ? (text?.toString() || '') : text;

        const newTextContainer = new Text(text, options).on(this._getOrMakeActivePage());
        this._activeContainer = newTextContainer;
        return this;
    }

    /** Add multiline text area */
    textarea(text:string|number, options?:TextOptions):this
    {
        if( (typeof text !== 'string') && (typeof text !== 'number') ){ throw new Error('Document::textarea(): Please supply a string or number for a Text Container!') }
        text = (typeof text !== 'string') ? (text?.toString() || '') : text;

        const newTextAreaContainer = new TextArea(text, options).on(this._getOrMakeActivePage());
        this._activeContainer = newTextAreaContainer;
        return this;
    }

    /** Add table to active Page
     *  @param nameOrData name of Calc table or raw data rows
    */
    table(nameOrData:ContainerTableInput, options?:TableOptions):this
    {
        if(!isContainerTableInput){ throw new Error(`Document::table: Please enter a name of existing Calc Table or data rows in format [{ rows: [[x1,y1,z1],[x2,y2,z2]] columns: ['field1', 'field2', 'field3']}`); }
        if(typeof nameOrData === 'string' && !this._docs._archiyou.calc){ throw new Error(`Document::table: Cannot get table data from Calc module. Calc is not initialized. Use calc.init()`); }
        if(typeof nameOrData === 'string' && !this._docs._archiyou.calc.tables().includes(nameOrData as string)){ { throw new Error(`Document::table: Cannot get table data from Calc module. No such table: '${nameOrData}'. Available tables: ${this._docs._archiyou.calc.tables().join(',')}`); } }

        // either get data from Calc or use raw data input
        // in form: [{ col1: v1, col2: v2 }, ...]
        let dataRows:DataRows;
        let footer = options?.footer; // raw-data callers may pass footer explicitly
        if(typeof nameOrData === 'string')
        {
            const calcTable = this._docs._archiyou.calc.db.table(nameOrData as string);
            dataRows = calcTable.toDataRows();
            footer = calcTable.computeFooterRows(); // pull declared footers from the Calc table
        }
        else {
            dataRows = nameOrData as DataRows;
        }

        const newTable = new Table(dataRows, { ...options, footer }).on(this._getOrMakeActivePage());

        this._activeContainer = newTable;

        return this;
    }


    //// GRAPHICAL ELEMENTS ////

    /** Draw rect graphic on current page
     *  @param input { size (when width=height), width, height, round }
     */
    rect(input?:number|string|DocGraphicInputRect, style?:DocPathStyle):this
    {
        const RECT_DEFAULT_LINE_WIDTH = 3; // in pnt
        const RECT_DEFAULT_FILL_COLOR = null;
        const RECT_DEFAULT_STROKE_COLOR = 'black';

        if(typeof input === 'number' || typeof input === 'string'){ input = { width: input, height:input } as DocGraphicInputRect } // convert to DocGraphicInputRect
        else if(!(typeof input === 'object' && (input.width))){ throw new Error(`Document::rect: Please supply at least a number (width=height) or options object { width, height, ?round, ?units, ?data }}`); }

        input.height = input.height ?? input.width; // make sure we got height or make equal sides

        // styling
        if(!style)
        {
            console.warn(`Document::rect(input, style): You can use the argument style { lineWidth, strokeColor, fillColor } to style this rect!`)
            input.style = {};
        }
        else {
            // styling
            input.style = style;
            input.style.lineWidth = (input.style?.lineWidth)
                                        ? convertValueFromToUnit(this._splitInputNumberUnits(input.style.lineWidth)[0],
                                                                    this._splitInputNumberUnits(input.style.lineWidth)[1],
                        'pnt')  : RECT_DEFAULT_LINE_WIDTH; // always in pnts
            input.style.strokeColor = input.style?.strokeColor ?? RECT_DEFAULT_STROKE_COLOR;
            input.style.fillColor = input.style?.fillColor ?? RECT_DEFAULT_FILL_COLOR;
        }

        const newGraphicContainer = new Graphic('rect', input).on(this._activePage);
        this._activeContainer = newGraphicContainer;

        this.width(this._activePage._resolveValueWithUnitsStringToRel(this._splitInputNumberUnits(input.width).join(''), 'width'));
        this.height(this._activePage._resolveValueWithUnitsStringToRel(this._splitInputNumberUnits(input.height).join(''), 'height'));

        return this;
    }

    /** Draw circle graphic on current page
     *  @param input { size (=radius), radius }
     */
    circle(input?:number|string|DocGraphicInputCircle, style?:DocPathStyle):this
    {
        const CIRCLE_DEFAULT_LINE_WIDTH = 3; // in pnt
        const CIRCLE_DEFAULT_FILL_COLOR = null;
        const CIRCLE_DEFAULT_STROKE_COLOR = 'black'

        if(typeof input === 'number' || typeof input === 'string'){ input = { radius: input } as DocGraphicInputCircle }
        else if(!(typeof input === 'object' && (input.radius))){ throw new Error(`Document::circle: Please supply at least a number (for radius) or options object { radius, ?units, ?data }}`); }

        // radius is converted into container width and height that will be used for rendering, but for later reference we set units
        input.radius =  this._splitInputNumberUnits(input.radius)[0];
        input.units = this._splitInputNumberUnits(input.radius)[1]; // will be default doc units (mm) is not given

        // styling
        if(!style){ console.warn(`Document::circle(input, style): You can use the argument style { lineWidth, strokeColor, fillColor } to style this rect!`) }

        // styling
        input.style = style ?? {};
        input.style.lineWidth = (input.style?.lineWidth)
                                    ? convertValueFromToUnit(this._splitInputNumberUnits(input.style.lineWidth)[0], this._splitInputNumberUnits(input.style.lineWidth)[1],
                    'pnt')  : CIRCLE_DEFAULT_LINE_WIDTH; // always in pnts
        input.style.strokeColor = input.style?.strokeColor ?? CIRCLE_DEFAULT_STROKE_COLOR;
        input.style.fillColor = input.style?.fillColor ?? CIRCLE_DEFAULT_FILL_COLOR;


        const newGraphicContainer = new Graphic('circle', input).on(this._activePage);
        this._activeContainer = newGraphicContainer;

        this.width(this._activePage._resolveValueWithUnitsStringToRel(this._splitInputNumberUnits(input.radius*2).join(''), 'width'));
        this.height(this._activePage._resolveValueWithUnitsStringToRel(this._splitInputNumberUnits(input.radius*2).join(''), 'height'));

        return this;
    }


    /** Draw ortho (horizontal|vertical) line graphic on current page
     *  @param input string (10mm), number (10, with default units, mm) or object with options
     *  @param thickness strokeWidth
     *  @param color
     */
    _oline(type:'h'|'v', input?:string|number|DocGraphicInputOrthoLine, thickness?:number|string, color?:string):this
    {
        const STROKE_DEFAULT_WIDTH = 3; // in pnt
        const STROKE_DEFAULT_COLOR = 'black'

        if(!input || (typeof input === 'object' && !input.length))
        {
            throw new Error(`Document::hline: Please supply at least a number (length) or options object { length, ?units, ?data }}`);
        }

        // verify input in object
        if (typeof input === 'object')
        {
            // NOTE: _splitInputNumberUnits always return number and units (default if none given)
            input = {
                        ...input, // take over attributes like thickness
                        length: this._splitInputNumberUnits(input.length)[0],
                        units: this._splitInputNumberUnits(input.length)[1],
                    } as DocGraphicInputOrthoLine;
        }
        else {
            // or a raw number or string
            input = { length: this._splitInputNumberUnits(input)[0], units: this._splitInputNumberUnits(input)[1] } as DocGraphicInputOrthoLine;
        }

        // styling
        if(!input.style){ input.style = {}}

        // Style attributes can be in DocGraphicInputOrthoLine
        thickness = thickness ?? input?.thickness;
        color = color ?? input?.color;


        input.style.lineWidth = (thickness)
            ? convertValueFromToUnit(
                    this._splitInputNumberUnits(thickness)[0],
                    this._splitInputNumberUnits(thickness)[1],
                    'pnt')  : STROKE_DEFAULT_WIDTH; // always in pnts
        input.style.strokeColor = color || STROKE_DEFAULT_COLOR;

        const newGraphicContainer = new Graphic((type === 'h') ? 'hline' : 'vline', input)
                                        .on(this._activePage);

        this._activeContainer = newGraphicContainer;

        if(type === 'h')
        {
            this.width(this._activePage._resolveValueWithUnitsStringToRel(input.length + input.units, 'width'));
            this.height(this._activePage._resolveValueWithUnitsStringToRel(input.style.lineWidth + 'pnt', 'height'));
        }
        else {
            this.height(this._activePage._resolveValueWithUnitsStringToRel(input.length + input.units, 'height'));
            this.width(this._activePage._resolveValueWithUnitsStringToRel(input.style.lineWidth + 'pnt', 'width'));
        }

        this.pivot([0,1]); // default pivot left top instead of Graphic default center ([0.5,0.5])


        return this;
    }

    hline(input?:string|number|DocGraphicInputOrthoLine, thickness?:number|string, color?:string):this
    {
        return this._oline('h', input, thickness, color);
    }

    vline(input?:string|number|DocGraphicInputOrthoLine, thickness?:number|string, color?:string):this
    {
        return this._oline('v', input, thickness, color);
    }

    //// VARIABLES ////

    /** Set content of active container as variable with given name */
    var(name:string):this
    {
        if(typeof name !== 'string' || name.length === 0){ throw new Error(`Document::var(name): Please supply a variable name as string!`); }
        if(!this._activeContainer){ throw new Error(`Document::var(name): No active container to set variable for!`); }

        if(name in Object.keys(this._variables))
        {
            console.warn(`Document::var(name): Overwriting existing variable "${name}" that refers to container "${this._variables[name].name}"!`);
        }
        this._variables[name] = this._activeContainer;

        return this;
    }

    /** Set variable that sets content of a container */
    set(name:string, value:string):this
    {
        if(typeof name !== 'string' || name.length === 0){ throw new Error(`Document::set(name, value): Please supply a variable name as string!`); }
        if(!value){ throw new Error(`Document::set(name, value): Please supply a variable value!`); }
        if(!(name in this._variables)){ 
            throw new Error(`Document::set(name, value): Variable "${name}" does not exist. Available are: ${Object.keys(this._variables).join(', ')}`); }

        this._variables[name].setContent(value);

        return this;
    }


    //// BLOCKS OF CONTAINERS ////

    /** Place default title block
     *  @param data:TitleBlockInput
     */
    titleblock(data?:TitleBlockInput):this
    {
        const TITLE_BLOCK_NUM = 60;
        const TITLEBLOCK_WIDTH = `${TITLE_BLOCK_NUM}mm`;
        const BLOCK_MARGIN = this._activePage._resolveValueWithUnitsStringToRel('1mm', 'height');

        const DEFAULT_SETTINGS = {
            title : 'Untitled',
            designer : 'Unknown',
            logoUrl: DOC_DEFAULT_LOGO_URL,
            designLicense: 'CC BY-NC',
            manualLicense: 'CC BY-NC',
        }

        if(!data){
            throw new Error('Document::titleblock: Please provide information { title, design, logoUrl, designLicense, manualLicense }');
        }

        const settings = { ...DEFAULT_SETTINGS, ...data } as TitleBlockInput;

        // logo
        this.image(settings.logoUrl)
            .pivot(1,0) // right bottom
            .position(1,0) // right bottom
            .width('30mm')
            .height('8mm')

        // Version info left of the logo. Positioned relative to the page's own width —
        // the previous `297-30` mm hardcoded A4 landscape, so on any other page size
        // (A4 portrait, A3, …) this text sat outside the page and was never drawn.
        const pageWidthMm = convertValueFromToUnit(this._activePage._width, this._activePage._units, 'mm') ?? 297;
        this.text(this._getVersionSummary(), { size: '2mm'})
            .width(`${TITLE_BLOCK_NUM/2}mm`)
            .height('3mm')
            .pivot(1,0)
            .position([`${pageWidthMm-30}mm`, '6mm'] as ContainerPositionAbs);

        // Metric labelblock
        this.labelblock('metrics', this._getMetricSummary(), { y: '11mm', width: TITLEBLOCK_WIDTH, numTextLines: 2 }); // TODO: dynamic param readout
        const metricsBlock = this.lastBlock();

        // Param labelblock
        this.labelblock('params', this._getParamSummary(), { y: metricsBlock.bbox[3] + BLOCK_MARGIN, width: TITLEBLOCK_WIDTH, numTextLines: 2 }); // TODO: dynamic param readout
        const paramsBlock = this.lastBlock();

        // Info labelblock
        this.labelblock(
                        ['designer', 'design license', 'manual license'],
                        [ settings.designer, settings.designLicense, settings.manualLicense],
                        { y: paramsBlock.bbox[3] + BLOCK_MARGIN, textSize : '3.5mm', width: TITLEBLOCK_WIDTH, numTextLines: 1 });
        const designBlock =  this.lastBlock();

        this.hline({ thickness: '2pnt', color: 'black', length: TITLEBLOCK_WIDTH})
            .position(1, designBlock.bbox[3] + BLOCK_MARGIN*2)
            .pivot(1,0.5)
        // header
        this.text( data?.title || DEFAULT_SETTINGS.title, { size: '8mm', bold: true })
            .pivot(1,0)
            .width(TITLEBLOCK_WIDTH)
            .position(1, designBlock.bbox[3] + BLOCK_MARGIN*2);

        return this;
    }

    _getParamSummary():string
    {
        const PARAM_SPLIT_CHARS = ['_','-', ' ']; // at which chars to split the param name
        const PARAM_NAME_MAXCHAR = 4;
        const PARAM_IS_VALUE_CHAR = ':'
        const PARAM_SEPERATOR_CHAR = ' '

        // Params + values come from the ParamManager in the running scope: it holds the
        // live set — both the params that came in on the request AND any declared from
        // the script with $PARAMS.define() — each with its current value.
        //
        // NOTE: this used to read `_archiyou.worker._activeExecRequest`. There is no
        // `worker` module on ArchiyouModules (a leftover from the pre-monorepo app), so
        // the lookup was always undefined and every titleblock read "no parameters".
        // Only the fields the summary needs — ScriptParam instances and plain wire data
        // (ScriptParamData) both satisfy this, so either source can be read the same way.
        type ParamSummarySource = { name?:string, label?:string, default?:any, _value?:any };

        const paramManager = (this._docs._archiyou?.runner?.getActiveScope?.() as any)?._paramManager;
        const managedParams = paramManager?.getParams?.() as Array<ParamSummarySource>|undefined;

        // Fall back to the request's own params when there is no manager (e.g. a doc
        // rendered outside a run).
        const requestParams = this._docs._archiyou?.runner?.getActiveExecRequest?.()?.script?.params as Record<string,ScriptParamData>;
        const params:Array<ParamSummarySource> = managedParams ?? (requestParams ? Object.values(requestParams) : []);

        if (params.length === 0){ return 'no parameters' }

        const paramsWithValues = params.map((p) => ({
                                    name: p?.name,
                                    label: p?.label,
                                    value: (p as any)?._value ?? p?.default,
                                }))

        return paramsWithValues.map(p => {
            const paramName = p.label || p.name;
            if(!paramName){ return null } // unnamed param: nothing sensible to summarise
            let paramSummaryName;
            if(paramName.length <= PARAM_NAME_MAXCHAR)
            {
                paramSummaryName = paramName;
            }
            // Shorten long name of param like BEAM_WIDTH = BW, SEAT-HEIGHT => SH
            else {
                // Empty parts (from repeated separators like BEAM__WIDTH) have no [0] to read
                const paramNameParts = (this._splitStringRecurse([paramName], PARAM_SPLIT_CHARS) ?? []).filter(s => s.length > 0);
                paramSummaryName = paramNameParts.slice(0,PARAM_NAME_MAXCHAR).reduce((agg,cur) => agg += cur[0].toUpperCase(), '');
            }
            return `${paramSummaryName}${PARAM_IS_VALUE_CHAR}${this._formatMetricParamValue(p.value)}`;
        })
        .filter(Boolean)
        .join(PARAM_SEPERATOR_CHAR)

    }

    _getMetricSummary():string
    {
        const METRIC_SPLIT_CHARS = ['_','-', ' ']; // at which chars to split the param name
        const METRIC_NAME_MAXCHAR = 4;
        const METRIC_IS_VALUE_CHAR = ':'
        const METRIC_SEPERATOR_CHAR = ' '

        // Object.values(undefined) THROWS — the `if(!metrics)` below never caught a missing
        // calc module, it just crashed titleblock() (and with it the whole document).
        const metrics = Object.values((this._docs._archiyou as any)?.calc?.metrics() ?? {}); // TODO: publishScript too?
        if (metrics.length === 0)
        {
            return 'no metrics'
        }

        return metrics.map((m: any) => {
            const metricName = m.label || m.name;
            if(!metricName){ return null } // unnamed metric: nothing sensible to summarise
            let metricSummaryName;
            if(metricName.length <= METRIC_NAME_MAXCHAR)
            {
                metricSummaryName = metricName;
            }
            else {
                const metricNameParts = (this._splitStringRecurse([metricName], METRIC_SPLIT_CHARS) ?? []).filter(s => s.length > 0);
                metricSummaryName = metricNameParts.slice(0,METRIC_NAME_MAXCHAR).reduce((agg,cur) => agg += cur[0].toUpperCase(), '');
            }
            return `${metricSummaryName}${METRIC_IS_VALUE_CHAR}${this._formatMetricParamValue(m.data as any)} ${m?.options?.unit ?? ''}`;
        })
        .filter(Boolean)
        .join(METRIC_SEPERATOR_CHAR)
    }

    _formatMetricParamValue(v:string|number):string
    {
        const MAX_LENGTH = 5;
        const TRANSFORM_REPLACE_VALUES = {
            true : 'yes',
            false : 'no',
            mm : '', // remove mm
        }

        let s = (typeof v !== 'string') ? (v?.toString() || 'none') : v;
        Object.keys(TRANSFORM_REPLACE_VALUES)
            .forEach((r,i) => {
                if(s.includes(r))
                {
                    s = s.replace(r, TRANSFORM_REPLACE_VALUES[r]);
                }
            })

        return s.slice(0, MAX_LENGTH)
    }

    /** Get version in different contexts
     *  In editor we use ScriptVersion->PublishScript instances
     *  In compute worker PublishScript
     */
    _getVersion():string
    {
        // Same dead `_archiyou.worker` lookup as _getParamSummary(): read the running
        // request from the Runner instead, so a published/shared script shows its real
        // semver instead of a permanent 'v0'.
        const script = this._docs._archiyou?.runner?.getActiveExecRequest?.()?.script as any;
        const version = script?.version           // Script.version (set on publish/share)
            || script?.published?.version         // published metadata
            || '0'

        return `v${version}`
    }

    /** Get version string like 'v1.0 at 10-20-2025 */
    _getVersionSummary():string
    {
        return `${this._getVersion()} at ${new Date().toLocaleString('nl-NL')}`;
    }

    _splitStringRecurse(strings:Array<string>, splitChars:Array<string>):Array<string>
    {
        if(Array.isArray(splitChars) && splitChars.length > 0)
        {
            let newStrings = [];
            strings.forEach(s => {
                    newStrings = newStrings.concat(s.split(splitChars[0]))
                }
            ); // remain flat
            if (splitChars.length > 1)
            {
                newStrings = this._splitStringRecurse(newStrings, splitChars.slice(1))
            }

            return newStrings
        }
    }

    /** Create a block with one or more label and one or more texts
     *  The first label/text pair fills half of the container
     *  Used mostly for titleblock
     */
    labelblock(labels:string|Array<string>, texts:string|Array<string>, options:LabelBlockOptions = {}):this
    {
        const MAX_ITEMS = 3; // max label/text pairs
        const LABELBLOCK_MARGIN_BETWEEN = '1mm'
        const LABELBLOCK_DEFAULTS = {
            x: 1, // right of page
            y: 0,
            width: '80mm',
            pivot: [1,0],
            textSize: '2.5mm',
            secondaryTextSize: '2mm',
            labelSize: '1.5mm',
            numTextLines: 1,
            margin: '1mm',
            line: true,
        } as LabelBlockOptions

        // Take care of multiple text/label, but no more than MAX_ITEMS
        labels = (typeof labels === 'string') ? [labels] : (Array.isArray(labels)) ? labels.slice(0,MAX_ITEMS) : null;
        texts = (typeof texts === 'string') ? [texts] : (Array.isArray(texts)) ? texts.slice(0,MAX_ITEMS) : null;

        if(!labels || !texts )
        {
            throw new Error(`Document::labelblock(): Please supply at least one label(s) and text(s). And optional: { x, y, width, pivot, textSize, labelSize, numTextLines, margin, line }`)
        }

        options = { ...LABELBLOCK_DEFAULTS, ...options }

        // prepare all info needed to start drawing
        const blockWidthRel = this._activePage._resolveValueWithUnitsStringToRel(options.width, 'width');
        const blockMarginRel = this._activePage._resolveValueWithUnitsStringToRel(options.margin, 'height');
        const blockMarginBetweenRel = this._activePage._resolveValueWithUnitsStringToRel(LABELBLOCK_MARGIN_BETWEEN, 'height');

        const blockTextSizePnt = this.parseInputNumberUnitsConvertTo(options.textSize, 'pnt');
        const blockSecondaryTextSizePnt = this.parseInputNumberUnitsConvertTo(options.secondaryTextSize, 'pnt');
        const blockLabelSizePnt = this.parseInputNumberUnitsConvertTo(options.labelSize, 'pnt');
        const blockTextSizeRel = this._activePage._resolveValueWithUnitsStringToRel(blockTextSizePnt + 'pnt', 'height');
        const blockLabelSizeRel = this._activePage._resolveValueWithUnitsStringToRel(blockLabelSizePnt + 'pnt', 'height');

        const blockHeightRel = blockTextSizeRel*(options?.numTextLines ?? 1) + blockLabelSizeRel + 2*blockMarginRel + blockMarginBetweenRel;

        const xRel =  this._activePage._resolveValueWithUnitsStringToRel(options.x, 'width');
        const yRel = this._activePage._resolveValueWithUnitsStringToRel(options.y, 'height');

        // We always draw locally from left,bottom: shift positions based on pivot
        const blockXRel = xRel + (1-options.pivot[0])*blockWidthRel;
        const blockYRel = yRel - options.pivot[1]*blockHeightRel;

        this.hline({ thickness: '1pnt', color: 'black', length: blockWidthRel })
            .pivot(1,1)
            .position(blockXRel, blockYRel)

        labels.forEach((label,i,arr) =>
        {
            // label
            this.text(label, { size: blockLabelSizePnt})
            .width(blockWidthRel)
            .pivot((i==0) ? 1 : (arr.length > 1) ? 0.5*i/(arr.length-1) : 0.5,0)
            .position(blockXRel, blockYRel+blockMarginRel+blockTextSizeRel*options?.numTextLines*1.1+blockMarginBetweenRel); // NOTE: small factor to correct for bigger height

            // main text
            this.text(texts[i] || '', { size: (i === 0) ? blockTextSizePnt : blockSecondaryTextSizePnt }) // Secondary texts are smaller
                .width(blockWidthRel)
                .pivot((i==0) ? 1 : (arr.length > 1) ? 0.5*i/(arr.length-1) : 0.5,0)
                .position(blockXRel, blockYRel+blockMarginRel+((options?.numTextLines-1)*blockTextSizeRel))
        })

        this._lastBlock = {
            x: blockXRel,
            y: blockYRel,
            width: blockWidthRel,
            height: blockHeightRel,
            pivot: options.pivot,
            bbox: [
                blockXRel -  blockWidthRel,
                blockXRel,
                blockYRel,
                blockYRel + blockHeightRel
            ]
        }

        return this // Return Document to not break chaining. Use doc.lastBlock() to get block info
    }

    /** Get last created ContainerBlock */
    lastBlock():ContainerBlock
    {
        return this._lastBlock
    }

    //// DEFINE ACTIVE CONTAINER ////

    /** Set Page width or Container width based if View is active */
    width(n:WidthHeightInput):this
    {
        if(this._activeContainer)
        {
             this._activeContainer.width(n)
        }
        else {
            this._checkPageIsActive();
            this._activePage.width(n);
        }

        return this;
    }

    /** Set Page width or View width based if View is active */
    height(n:WidthHeightInput):this
    {
        if(this._activeContainer)
        {
             this._activeContainer.height(n)
        }
        else {
            this._checkPageIsActive();
            this._activePage.height(n);
        }
        return this;
    }

    /** Set Position of active Container
     *   @param x
     *     - if 0 <= x <= 1 relative to page content area 0.5 center)
     *     - if > 1 in default Document units (mostly mm)
     *     - Alignment: topleft, bottom(center)
     *     - absolute with units ('10mm')
     *     - or array [x,y]
     *   @param y see x, but without array
     */
    position(x:number|ContainerPositionLike, y?:number|string):this
    {
        if(!this._activeContainer)
        {
            throw new Error(`Document::position(): Can not set position of active container. No active container`);
        }
        if(!this._activePage)
        {
            throw new Error(`Document::position(): Can not set position of active container. No active page. Create at least one page!`);
        }

        // two parameters, combine into ContainerPositionRel array
        if(typeof y === 'number' || typeof y === 'string')
        {
            this._activeContainer.position([x,y] as ContainerPositionLike);
        }
        else if(isContainerPositionLike(x))
        {
            this._activeContainer.position(x as ContainerPositionLike)
        }
        else {
            throw new Error(`Document::position(): Invalid input: "[${x},${y}]". Use alignment: 'topright', relative coords [0.5,1], or ['10mm',0]`)
        }

        return this;
    }

     /** Set Pivot of active Container
     *   - relative to page content area (0.5,0.5 => center)
     *   - ContainerAlignment: 'left', 'top'
     *
     *      NOTE: We won't allow offsets with units ('10mm')
     */
    pivot(x:number|ContainerPositionLike|string|Array<number|number>, y?:number):this
    {
        if(!this._activeContainer || !this._activePage)
        {
            throw new Error(`Document::pivot(): Can not set pivot of active container. No active container and/or Page created!`);
        }

        const args = Array.from(arguments); // IMPORTANT: needs to be an array

        // if something like pivot('topleft') - backward compatable
        if (typeof x === 'string')
        {
            args[0] = x.match(/left|right|center/gi)?.at(0) || 'center';
            args[1] = x.match(/top|center|bottom/gi)?.at(0) || 'center';
        }
        // pivot([1,0]) - backward compatable
        else if(Array.isArray(x))
        {
            args[0] = x[0];
            args[1] = x[1];
        }
        // Some forgiveness with order of alignment strings (top,left versus left,top)
        else if(isContainerVAlignment(args[0]) && isContainerHAlignment(args[1]))
        {
            args.reverse();
        }

        if (isContainerPositionLike(args))
        {
            this._activeContainer.pivot(args as ContainerPositionLike)
        }
        else if (typeof x === 'number')
        {
            this._activeContainer.pivot([x,y||0]);
        }
        else {
            throw new Error(`Document::pivot(): Invalid pivot. Try Alignment like ('topleft') or ('left', 'top') or coords relative ([0-1],[0-1]) relative to page content area origin`);
        }
        return this;
    }

    /** Turn on border on active container with optional styling */
    border(style?:DocPathStyle):this
    {
        if(!this._activeContainer){ throw new Error(`Document::border(): Cannot set border on active container! Make a container first!`)};
        (this._activeContainer as View).border(style);

        return this;
    }

    /** set contentAlign on active container */
    contentAlign(align:ContainerHAlignment|ContainerVAlignment|ContainerAlignment):this
    {
        if(!this._activeContainer){ throw new Error(`Document::contentAlign(): Cannot set contentAlign. No active container. Please make one first!`)};
        let newContentAlign:ContainerAlignment = [...this.CONTENT_ALIGN_DEFAULT] as ContainerAlignment;
        if(isContainerHAlignment(align))
        {
            newContentAlign[0] = align as ContainerHAlignment;
        }
        else if(isContainerVAlignment(align))
        {
            newContentAlign[1] = align as ContainerVAlignment;
        }
        else if(isContainerAlignment(align))
        {
            newContentAlign = align as ContainerAlignment;
        }

        this._activeContainer._contentAlign = newContentAlign;

        return this;
    }

    /** Set caption on active container */
    /** Caption the active container. On a view, no argument means "say what you are": its
     *  name, and the scale it is drawn at. See View.caption(). */
    caption(s?:string|boolean|Record<string,any>):this
    {
        if(!this._activeContainer){ throw new Error(`Document::caption(): Cannot set caption. No active container. Please make one first!`)};
        if(this.TYPES_WITHOUT_CAPTION.includes(this._activeContainer._type)){ console.warn(`Document::caption(): Container type ${this._activeContainer._type} does not support caption!`); return this; }
        this._activeContainer.caption(s);
        return this;
    }

    title(s?:string):this
    {
        if(!this._activeContainer){ throw new Error(`Document::title(): Cannot set title. No active container. Please make one first!`)};
        if(this.TYPES_WITHOUT_CAPTION.includes(this._activeContainer._type)){ console.warn(`Document::title(): Container type ${this._activeContainer._type} does not support title!`); return this; }
        this._activeContainer.title(s);
        return this;
    }

    //// FORWARD TO SPECIFIC CONTAINER TYPES ////

    /** Bind ShapeCollection to View: either a real reference or the name of a ShapeCollection after running the doc pipeline */
    shapes(shapes:ShapeCollection|string, all:boolean=false):this
    {
        if(!this._activeContainer){ throw new Error(`Document::shapes(): Cannot add Shapes because no View Container is active! Make a View first with view("myView")!`)};
        if(this._activeContainer._type !== 'view'){ { throw new Error(`Document::shapes(): Cannot add Shapes because no active container is a not a View. Check the order of your statements!`)};}
        (this._activeContainer as View).shapes(shapes, all);

        return this;
    }

    zoom(level:number):this
    {
        if(!this._activeContainer){ throw new Error(`Document::zoom(): Cannot add Shapes because no View Container is active! Make a View first with view("myView")!`)};
        if(this._activeContainer._type !== 'view'){ { throw new Error(`Document::zoom(): Cannot add Shapes because no active container is a not a View. Check the order of your statements!`)};}
        (this._activeContainer as View).zoom(level);

        return this;
    }

    scale(factor?:ScaleInput):this
    {
        if(!factor) factor = 'auto' as ScaleInput;

        if(!this._activeContainer){ throw new Error(`Document::scale(): Cannot add Shapes because no View Container is active! Make a View first with view("myView")!`)};
        if(this._activeContainer._type !== 'view'){ { throw new Error(`Document::scale(): Cannot add Shapes because no active container is a not a View. Check the order of your statements!`)};}
        (this._activeContainer as View).scale(factor);

        return this;
    }

    //// DOCUMENT AGGREGATION OPERATIONS ////

    /** Merge incoming Document instances with this document
     *  @param d single or collection of Document instance
    */
    merge(d:Document|Array<Document>|Record<string, Document>, namePrefix:string=''):this
    {
        const docsArray = (Array.isArray(d)) ? d
                            : d instanceof Document
                                ? [d]
                                : Object.values(d);

        if(docsArray.length === 0){ throw new Error(`Document::merge: Please supply at least one Document to merge!`); }

        docsArray.forEach((doc, i) =>
        {
            if(!(doc instanceof Document)){ console.error(`Document::merge: Encountered a object of type ${typeof doc} which is not a Document at index ${i}. Skipping it!`)};
            const mergedDocName= `${doc?._component || ''}:${doc._name}`; // use component name if available
            // Now just add the pages of incoming document to this one
            doc._pages.forEach((page) =>
            {
                // Page name in format {{prefix}}[{{component}}]-{{pagename}} like: leftWall[WallComponent]-workdrawings
                const mergedPageName = `${namePrefix}${(doc?._component) ? '[' + doc?._component + ']' : ''}-${page.name}`;
                if(!this.pageExists(mergedPageName))
                {
                    page.name = mergedPageName;
                    this._pages.push(page); // add page to this document
                    console.info(`Document::merge: Merged page "${page.name}" from Document "${mergedDocName}" into Document "${this._name}"`);
                }
                else {
                    // NOTE: this should not happen!
                    console.warn(`Document::merge: Page "${page.name}" already exists in Document "${this._name}". Skipping it!`);
                }
            });

        })

        return this;
    }

    //// UTILS ////

    /* count containers of a type on active page
                and check how many are called table{x}, image{x} etc
                and iterate count */
    _generateContainerName(containerOrName:string|Container):string
    {
        const START_ITER_COUNT = 0;

        const reqName = (isAnyPageContainer(containerOrName)) ? (containerOrName.name || containerOrName._type) : (typeof containerOrName === 'string') ? containerOrName as string : null;

        if (!reqName){ throw new Error(`Document::_generateContainerName. Please supply a string or Container instance to get a name! Got: ${containerOrName}`); }

        const containersWithSameName = this._activePage._containers.filter( c => c.name === reqName || c.name.match(new RegExp(`${reqName}[\\d]+$`))); // match exactly the same or name{NUM}

        if(containersWithSameName.length === 0)
        {
            return reqName;
        }
        else {
            // look for highest iterator
            let max = START_ITER_COUNT;
            containersWithSameName.forEach( c =>
            {
                const nums = c.name.match(/[\d]+$/)
                if (nums)
                {
                    const count = parseInt(nums[0]);
                    if(count > max)
                    {
                        max = count;
                    }
                }
            });
            const reqNameClean = reqName.replace(/[\d]+$/, '')
            return `${reqNameClean}${(max+1).toString()}`;
        }
    }


    _checkPageIsActive()
    {
        if(!this._activePage){ throw new Error(`Document::_checkPageIsActive: Cannot set page attribute: No page added yet!`);}
        return true;
    }

     /** Transform WidthHeightInput to relative width/height */
     // NOTE: we need to return ContainerSizeRelativeTo too so to register it in the container
     _resolveWidthHeightInput(n:WidthHeightInput, page:Page, side:ContainerSide):[number,ContainerSizeRelativeTo]
     {
         if(typeof n === 'number')
         {
             return [n as number, 'page-content-area' as ContainerSizeRelativeTo];
         }
         else if(isPercentageString(n))
         {
             return [this._resolvePercentageString(n), 'page-content-area' as ContainerSizeRelativeTo];
         }
         else if(isValueWithUnitsString(n))
         {
             // IMPORTANT: Even absolute coordinates (10mm) are relative to page content area - not page!
             // TODO: Do we need this to be more implicit for the user?
             return [this._resolveValueWithUnitsStringToRel(n, page, side), 'page-content-area' as ContainerSizeRelativeTo]; // absolute units are relative to page (because padding might change and thus size of content area)
         }

         return null;
     }

     /** Percentage of page space, page minus page-padding (not entire padding) */
     _resolvePercentageString(s:PercentageString):number
     {
        // TODO: take padding into account !
        if(typeof s !== 'string'){ return null };
        const m = s.match(/(\-*[\d\.]+)%$/);
        if (m)
        {
            return parseFloat(m[1])/100;
        }
        return null;
     }

     /** Return width or height in relative coords of current Page and Document units */
     _resolveValueWithUnitsStringToRel(s:ValueWithUnitsString, page:Page, side:PageSide):number
     {
        // if given number, fallback to page units (default: mm)
        if(typeof s === 'number')
        {
            if(isContainerPositionCoordRel(s))
            {
                s = (s * 100) + '%' // relative [0-1], convert to 100%
            }
            else {
                s = s + this._units;
            }
        }
        else if(typeof s !== 'string')
        {
            console.error(`Document::_resolveValueWithUnitsStringToRel(): Invalid input given: ${s}`);
            return null;
        }

        // if already relative (40%)
        const percMatch = s.match(/(\-*[\d\.]+)(%)$/);

        if(percMatch)
        {
            const relNum = parseFloat(percMatch[1])/100; // back from 10% to 0.1
            return relNum
        }

        // if any absolute coordinate and unit
        const m = s.match(/(\-*[\d\.]+)(mm|cm|inch|\"|pnt)$/);
        if (m)
        {
            let num = parseFloat(m[1]); // value in units
            let units = m[2];
            // convert if units is '"" (short hand for inch)
            if (units === '"') units = 'inch';

            // given unit is not the Document unit
            if(units !== this._units)
            {
                num = convertValueFromToUnit(num, units as DocUnits, this._units);
            }

            // We have the num in doc units. Now make relative
            let sideLength = page[`_${side}`];
            let relativeValue = num / sideLength;

            // give a warning if it's out of the page
            if(relativeValue > 1 || relativeValue < 0)
            {
                console.warn(`Document::_resolveValueWithUnitsStringToRel: You supplied a value ('${s}') that is outside the page size! Check if this is correct!`)
            }

            return relativeValue;

         }
         return null;
     }

     /** Split given string like 10mm to number and unit and do some checking
      *     NOTE: We handle relative numbers ([0-1]) here too, in that case
     */
     _splitInputNumberUnits(s:string|number):[number,DocUnitsWithPerc]|null
     {
        if(typeof s === 'number')
        {
            if(isContainerPositionCoordRel(s))
            {
                return [s*100, '%']; // convert 0.1 => 10%
            }
            else
            {
                // absolute numbers but without unit, we use the default doc unit (mm mostly)
                return [s, this._units];
            }
        }
        if(typeof s !== 'string') return null;

        let result:[number,DocUnitsWithPerc];

        ['mm', 'cm', 'inch', 'pnt','%'].every( unit => {
            if(s.includes(unit))
            {
                result = [parseFloat(s.replace('unit', '')), unit as DocUnitsWithPerc]
                return false;
            }
            return true;
        })

        if (result){ return result; }

        // other attempt
        if (!result && isNumeric(s))
        {
            return [parseFloat(s), this._units]; // return default doc units
        }

        console.warn(`Document::_splitInputNumberUnits(${s}): Could not split input to number and units!`)
        return null;
     }


     parseInputNumberUnitsConvertTo(n:string|number, unit:DocUnitsWithPerc):number|null
     {
        const num = this._splitInputNumberUnits(n)[0];
        const inUnit = this._splitInputNumberUnits(n)[1];

        return convertValueFromToUnit(num, inUnit, unit)

     }

    //// EXPORT SVG ////

    async toSVG(cache?: Record<string, any>): Promise<string>
    {
        const PAGE_GAP_MM = 10;
        const fmt = (n: number) => +n.toFixed(4);

        // Page dimensions in mm
        const pageSizesMm = this._pages.map(p => ({
            wMm: convertValueFromToUnit(p._width,  p._units, 'mm'),
            hMm: convertValueFromToUnit(p._height, p._units, 'mm'),
        }));

        // Vertical stacking: compute y-offsets for each page
        const yOffsets: number[] = [];
        let yOffset = 0;
        for (const { hMm } of pageSizesMm)
        {
            yOffsets.push(yOffset);
            yOffset += hMm + PAGE_GAP_MM;
        }
        const totalHeight = yOffset - PAGE_GAP_MM;
        const totalWidth  = Math.max(...pageSizesMm.map(p => p.wMm));

        // Shared clip-path ID counter across all pages in this document
        let clipCounter = 0;
        const nextClipId = () => `clip${++clipCounter}`;

        const hasMultiplePages = this._pages.length > 1;

        // Render each page
        const pageLayers: string[] = [];
        for (let i = 0; i < this._pages.length; i++)
        {
            const { layer } = await this._pages[i].toSVG(yOffsets[i], nextClipId, cache, hasMultiplePages);
            pageLayers.push(layer);
        }

        // InkScape named view with one <inkscape:page> per page
        const inkscapePages = this._pages.map((p, i) =>
            `    <inkscape:page id="page${i+1}" x="0" y="${fmt(yOffsets[i])}" width="${fmt(pageSizesMm[i].wMm)}" height="${fmt(pageSizesMm[i].hMm)}" inkscape:label="${escapeXml(p.name)}"/>`
        ).join('\n');

        const namedView = `  <sodipodi:namedview id="namedview">\n${inkscapePages}\n  </sodipodi:namedview>`;

        const globalDefs = hasMultiplePages
            ? [
                `  <defs>`,
                `    <filter id="page-shadow" x="-5%" y="-5%" width="110%" height="110%">`,
                `      <feDropShadow dx="0" dy="0.5" stdDeviation="1.5" flood-color="rgba(0,0,0,0.28)"/>`,
                `    </filter>`,
                `  </defs>`,
              ].join('\n')
            : '';

        return [
            `<?xml version="1.0" encoding="UTF-8"?>`,
            `<svg`,
            `  xmlns="http://www.w3.org/2000/svg"`,
            `  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`,
            `  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"`,
            `  id="${escapeXml(this._name)}"`,
            `  width="${fmt(totalWidth)}mm"`,
            `  height="${fmt(totalHeight)}mm"`,
            `  viewBox="0 0 ${fmt(totalWidth)} ${fmt(totalHeight)}"`,
            hasMultiplePages ? `  data-multipage="true"` : '',
            `  version="1.1">`,
            namedView,
            globalDefs,
            ...pageLayers,
            `</svg>`,
        ].filter(l => l !== '').join('\n');
    }

    /** Export each page of this Document as its own standalone SVG string.
     *  This is the intermediate step for PDF export: one PDF page per DocSVGPage.
     *  Unlike toSVG() (which stacks all pages into one combined SVG for on-screen
     *  display), each entry here is a self-contained <svg> sized to that page. */
    async toSVGPages(cache?: Record<string, any>): Promise<Array<DocSVGPage>>
    {
        const fmt = (n: number) => +n.toFixed(4);

        // Clip-path IDs only need to be unique within each standalone page SVG,
        // but we keep a single counter to avoid any cross-page collisions.
        let clipCounter = 0;
        const nextClipId = () => `clip${++clipCounter}`;

        const pages: Array<DocSVGPage> = [];

        for (const page of this._pages)
        {
            const widthMm  = convertValueFromToUnit(page._width,  page._units, 'mm');
            const heightMm = convertValueFromToUnit(page._height, page._units, 'mm');

            // Render the page layer standalone: no vertical offset, no page shadow.
            // The returned layer already embeds its own <defs> (clip-paths).
            const { layer } = await page.toSVG(0, nextClipId, cache, false);

            const svg = [
                `<?xml version="1.0" encoding="UTF-8"?>`,
                `<svg`,
                `  xmlns="http://www.w3.org/2000/svg"`,
                `  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`,
                `  width="${fmt(widthMm)}mm"`,
                `  height="${fmt(heightMm)}mm"`,
                `  viewBox="0 0 ${fmt(widthMm)} ${fmt(heightMm)}"`,
                `  version="1.1">`,
                layer,
                `</svg>`,
            ].join('\n');

            pages.push({
                name: page.name,
                widthMm,
                heightMm,
                orientation: page._orientation,
                svg,
            });
        }

        return pages;
    }

    //// EXPORT DATA ////

    async toData(cache:Record<string, any>|undefined):Promise<DocData>
    {
        const docPagesData = [];

        if(this._pages.length === 0)
        {
            console.warn(`Document::toData(): No pages in document "${this._name}". Please create at least one page!`);
        }
        else {
            for(let i = 0; i < this._pages.length; i++)
            {
                const pageData = await this._pages[i].toData();
                docPagesData.push(pageData);
            }
        }

        return {
            name: this._name,
            units: this._units,
            pages: docPagesData,
            // set model units to calculate scale later
            modelUnits: this._docs._archiyou?.modeler?.units()
        }
    }

    toString():string
    {
        return `<Document "${this._name}" with ${this._pages.length} page(s)>`;
    }

    //// COMPONENTS ////

    /** Remove all references that tie this Document instance to the execution scope */
    resolveScopeReferences():this
    {
        this._docs.executePipelines(); // make sure pipelines are executed before moving around
        this._pages.forEach( p =>
        {
            p?.resolveScopeReferences();
        });
        return this;
    }
}
