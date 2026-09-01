
import type { ModelUnits } from '../modeler/types';
import type { PublishLicense } from '../execution/types';

import { Container } from './Container';
import { View } from './View';

import type { DataRows, ComputedFooterRow } from '../calc/types';

export type DocUnits = 'mm'|'cm'|'inch'|'pnt' 
export type DocUnitsWithPerc = DocUnits | '%' // Percent of page (side is dependent of measure)
export type PercentageString = string // 100%, 5% etc.
export type ValueWithUnitsString = number|string // string with number and DocUnitsWithPerc
/** 'auto' sizes a container to what it holds — see Container.width()/height(). Only a view
 *  can answer that today: it knows its drawing and the scale it is drawn at. */
export type WidthHeightInput = number|PercentageString|ValueWithUnitsString|'auto';
export type ContainerTableInput = string | DataRows

export interface DocSettings {
    /** BASE url of the Archiyou asset proxy — `${proxy}/proxy?url=…`, matching
     *  RunnerScriptExecutionRequest.assetProxyUrl. '' means root-relative. Leave it
     *  unset and Docs falls back to the running request's own assetProxyUrl. */
    proxy: string
    /** ABSOLUTE origin to resolve root-relative image paths against when there is no
     *  browser origin (a node-side render). Matches
     *  RunnerScriptExecutionRequest.appBaseUrl, which Docs falls back to. */
    baseUrl?: string
}

export interface DocData {
    name:string
    units:DocUnits
    pages:Array<PageData>
    modelUnits:ModelUnits
}


export interface DocPipeline
{
    fn:() => any
    done: boolean
}

/** Context passed down from Page.toSVG() into each Container.toSVG() call. */
export interface PageSVGContext
{
    pageWidthMm:  number
    pageHeightMm: number
    hPaddingMm:   number  // absolute mm, resolved from relative padding
    vPaddingMm:   number
    nextClipId:   () => string
    cache?:       Record<string, any>
}

/** A single page rendered as a standalone SVG string, used as the intermediate
 *  step for PDF export (one PDF page per DocSVGPage). */
export interface DocSVGPage
{
    name:string
    widthMm:number
    heightMm:number
    orientation:PageOrientation
    svg:string // standalone <svg> for just this page
}

//// DOC:PAGE ////

export type PageSize = 'A0'|'A1'|'A2'|'A3'|'A4'|'A5'|'A6'|'A7';
export type PageOrientation = 'landscape'|'portrait';
export type PageSide = 'width'|'height'
export type AnyPageContainer = Container|View

export interface PageData {
    _entity:'page'
    name:string
    size:PageSize
    width:number // in units given in docUnits
    height:number // in units given in docUnits
    orientation:PageOrientation
    padding:Array<number|number> // horizontal (left and right), vertical (top and bottom) relative to Page width/height
    containers:Array<ContainerData>
    variables?:{[key:string]:any}
    docUnits:DocUnits, // gets taken from parent doc
}   

//// DOC:PAGE:CONTAINER ////

export type ContainerType = 'view'|'image'|'text'|'textarea'|'table'|'graphic'
export type ContainerHAlignment = 'left'|'center'|'right'
export type ContainerVAlignment = 'top' | 'center' | 'bottom'
export type ContainerAlignment = [ContainerHAlignment,ContainerVAlignment] // like [left,top]
export type ContainerSide = 'width'|'height'
/** @deprecated scale and zoom are separate concerns now — see Container.scale()/zoom().
 *  Kept only because the brep types still declare their own copy. */
export type ZoomRelativeTo = 'container'|'world'
/** A drawing scale, as a script writes it.
 *   - 'fit'    fill the container, whatever ratio that comes to (the default, and what a
 *              view has always done)
 *   - 'auto'   the largest STANDARD scale that fits (1:50, 1:100, … — see scale.ts)
 *   - number   an exact ratio: 1/100 is 1:100, 2 is 2:1
 *   - number[] candidates; the largest that fits is used
 *   - string   as written: '1:100', '1/100', or the imperial '1/4"=1\''
 */
export type ScaleInput = 'fit'|'auto'|number|Array<number|string>|string;
export type ContainerSizeRelativeTo = 'page' | 'page-content-area'; // page-content area is page without the padding on both sides

export type ContainerPositionCoordRel = number // [0-1]
export type ContainerPositionCoordAbs = number|string // >=1 or 10mm

export type ContainerPositionRel= Array<number|number> // This is relative coords [ [0,1],[0,1]] from left bottom
export type ContainerPositionAbs = Array<string|string> // '10mm', '20mm'
export type ContainerPositionLike = ContainerPositionRel|ContainerAlignment|ContainerPositionAbs

export type ContainerData = { // Combine all Container types for convenience
    _entity:string
    name:string
    parent?:string // Name of parent - NOT USED YET
    type:ContainerType
    width:number // relative to (see: widthRelativeTo)
    widthRelativeTo:ContainerSizeRelativeTo
    widthAbs?:number // in doc units (added on place)
    height:number // relative to (see: widthRelativeTo)
    heightRelativeTo:ContainerSizeRelativeTo
    heightAbs?:number // in doc units (added on place)
    position:ContainerPositionRel// relative to page-content-area
    pivot:ContainerPositionRel
    border?:boolean // border around container
    borderStyle?:DocPathStyle // style to draw border
    frame?:any // advanced shapes as border
    index?:number

    contentAlign:ContainerAlignment // alignment of content inside container
    content:any; // TODO: raw content
    /** What the script asked for: 'fit' [default] | 'auto' | a ratio | a list | '1:100' */
    scale?:ScaleInput,
    /** Zoom on top of the scale (1 = none) */
    zoom?:number,
    /** What the drawing came out at, once resolved against the room it had. */
    resolvedScale?:{ ratio:number, label:string, unitsPerMm:number, fitted:boolean, fits:boolean }|null,
    docUnits:DocUnits, 
    modelUnits:ModelUnits,
    
    caption?:string
    title?:string

    _domElem?:HTMLDivElement, // added on placement
}

export interface Frame {
    color:string // TODO
    thickness:number
    shape:'rect'|'circle'
}

export interface ContainerContent 
{
    source?:string, // source url (used for quick access if possible)
    format?:'jpg'|'svg'|'png';
    data:any; // main data - can be base64
    footer?:Array<ComputedFooterRow>; // optional computed footer rows (tables)
    settings:{[key:string]:any}
}


//// DOC:PAGE:CONTAINER:IMAGE ////

export type ImageOptionsFit = 'fill'|'contain'|'cover' // taken from CSS, see https://www.w3schools.com/css/css3_object-fit.asp
// fill is unproportianlly, contain is fit inside with margin, cover is fill proportianally

export function isImageOptionsFit(o:any): o is ImageOptionsFit
{
    return ['fill','contain','cover'].includes(o);
}

export interface ImageOptions 
{
    fit?: ImageOptionsFit
    align?: ContainerAlignment // for example ['left', 'top]  
    opacity?: number // [0-100]
    brightness?:number // [0-100]
    contrast?:number // [0-100]
    saturation?:number
    grayscale?:number // [0-100]
}

//// DOC:PAGE:CONTAINER:TABLE ////

// NOTE: uses DataRows for input from Calc

export interface TableContainerOptions
{
    fontsize?: number
    fontcolor?: string
    footer?: Array<ComputedFooterRow> // computed footer rows (from calc.Table.computeFooterRows())
}

//// DOCS:PAGE:CONTAINER:TEXT ////

export type TextAreaAlign = 'left'|'right'|'center'|'fill';
export type TextBaseline = 'alphabetic'|'ideographic'|'bottom'|'top'|'middle'|'hanging'

// see: https://raw.githack.com/MrRio/jsPDF/master/docs/jsPDF.html#text
export interface TextOptions
{
    size?:number|string // saved in 'points' (like in Word) - units are also allowed but converted in options
    color?:string // always converted to hex
    width?:number // TODO: needed?
    height?:number // TODO: needed?
    bold?:boolean
    underline?:boolean // TODO implement in renderer
    strike?:boolean // TODO implement in renderer   
    oblique?:boolean // TODO implement in renderer
    align?:TextAreaAlign // Not used. Use: Cotnainer.contentAlign
    baseline?:TextBaseline
    angle?:number // in degrees
    // NOTE: some of these parameters are plugged directly into jsPDF.text()
}

//// DOCS:PAGE:CONTAINER:GRAPHIC

export type DocGraphicType = 'rect'|'circle'|'ellipse'|'line'|'hline'|'vline'|'triangle' // Later: poly?

// Default simple input
export interface DocGraphicInputBase
{
    type?:DocGraphicType
    units?:DocUnitsWithPerc // default in mm
    style?:DocPathStyle
    data?:any // TODO later: things to put inside graphic, like label number
}

export interface DocGraphicInputRect extends DocGraphicInputBase
{
    // if size => size=width=height
    width:number
    height:number
    round?:number
}

export interface DocGraphicInputCircle extends DocGraphicInputBase
{
    // if size => size = radius
    radius:number
}

export interface DocGraphicInputLine extends DocGraphicInputBase
{
    // if size => size = length
    start:[number,number]
    end:[number,number]
}

export interface DocGraphicInputOrthoLine extends DocGraphicInputBase
{
    length:number|string // number in default units or with units
    thickness:number|string
    color:string
}


//// DOCS:PAGE:CONTAINER:VIEW ////

/** Options for a document view: `view('elevation', { scale: 1/100, caption: true, bar: true })` */
export interface ViewOptions
{
    /** 'fit' [default] | 'auto' | 1/100 | [1/100,1/200] | '1:100' | '1/4"=1\'' */
    scale?:ScaleInput
    /** Zoom on top of the scale (2 = twice as big as the scale says) */
    zoom?:number
    /** A caption INSIDE the view, in a band at the bottom. true uses the view's name and,
     *  when a scale was asked for, its label ("Elevation — 1:100"). */
    caption?:boolean|string|CaptionOptions
    /** A graduated scale bar in the same band. */
    bar?:boolean|BarOptions
    /** Line weight in millimeters ON THE PAGE. Default 0.25mm. */
    lineWeight?:number
    /** What to do when a requested scale does not fit the container:
     *   - 'clip' [default] honour the scale and show what fits (with a warning)
     *   - 'fit'  fall back to fitting the drawing */
    overflow?:'clip'|'fit'
    /** Extra CSS for the drawing, selector → declarations — see View.css(). */
    css?:Record<string,string>
}

export interface CaptionOptions
{
    /** Default: the view's name */
    text?:string
    /** Append the scale label. Default: true when the view has a requested scale. */
    scale?:boolean
    /** Default '{name} — {scale}' */
    format?:string
    align?:ContainerHAlignment
    /** Text height in millimeters on the page. Default 3. */
    size?:number
    color?:string
}

/** A graduated scale bar — the drawing's scale said in geometry rather than in words, so it
 *  survives being photocopied or rescaled. */
export interface BarOptions
{
    /** Length in MODEL units, or 'auto' [default] for a round number about a third of the
     *  view's width. */
    length?:number|'auto'
    /** Number of segments. Default 4. */
    divisions?:number
    /** Bar height in millimeters on the page. Default 1.5. */
    height?:number
    align?:ContainerHAlignment
    /** 'alternating' [default] fills every other segment; 'ticks' draws a line with ticks. */
    style?:'alternating'|'ticks'
    /** Label the ends. Default true. */
    labels?:boolean
    /** Unit for the labels. Default 'auto' (picked from the length). */
    units?:'auto'|ModelUnits
}


export interface toSVGOptions
{
    all?:boolean // also invisible
    only2D?:boolean // only export 2D shapes
    annotations?:boolean
    fills?:boolean // Generate fills in SVG
    outlines?:boolean // Calculate the Shape outlines (Slow!)
}

export interface SVGtoPDFtransform
{
    svgUnits:string
    scale: number // SVG to PDF units scale
    translateX: number // first SVG transform to center
    translateY: number
    containerTranslateX: number // offset for container position including pivot
    containerTranslateY: number
    boundBy:'width'|'height' // content is bound by width or height
    contentOffsetX: number // Offset to align content
    contentOffsetY: number
    
}

export interface toDXFOptions 
{
    all?:boolean // also invisible
    annotations?:boolean // add annotations
    // TODO: more
}

//// DOCS:PAGE:CONTAINER:TEXTAREA ////

export interface TextAreaOptions
{
    size?:number|string // saved in 'point' (like in Word) - units are also allowed but converted in options
    color?:string // always converted to hex
    align?:TextAreaAlign
}

//// DOCS:BLOCKS

/** Important data of created ContainerBlock */
export interface ContainerBlock
{
    width:number // relative to page/content-area
    height:number // relative
    x:number // relative
    y:number // relative
    pivot:[number,number]
    bbox?:[number,number,number,number] // left,right,bottom,top (in rel coords, original left bottom)
}

export interface TitleBlockInput
{
    title ?: string
    designer ?: string
    logoUrl ?: string // default: archiyou logo
    designLicense ?: PublishLicense // license of the design
    manualLicense ?: PublishLicense // license of the manual
}

/** How `Document.instructable()` lays an instructable's steps onto pages. */
export interface InstructableOptions
{
    /** Step cells across the page. Default 2. */
    columns?:number
    /** Step cells down the page. Default 2 — so four steps a page on A4 landscape. */
    rows?:number
    /** Gap between cells, as a fraction of the content area. Default 0.03. */
    gutter?:number
    /** Draw the step number. Default true. */
    numbering?:boolean
    /** Text height of the step number. Default '7mm'. */
    numberSize?:string|number
    /** Text height of the step title. Default '4.5mm'. */
    titleSize?:string|number
    /** Text height of the note / tools line. Default '3mm'. */
    noteSize?:string|number
    /** Lines reserved for the note under each drawing. Default 2; 0 leaves none. */
    noteLines?:number
    /** Draw a border around each step cell. Default false. */
    border?:boolean
    /** Colour of the parts a step is NOT about, so the subject reads against them.
     *  Default '#b0b0b0'. Null draws context the same as the subject. */
    contextColor?:string|null
    /** Colour of the part a step IS about. Default null — the drawing's own black. */
    subjectColor?:string|null
    /** Hidden-line strategy for the step drawings. Default 'clip', which is the one that
     *  keeps per-part identity and so makes contextColor possible at all. */
    strategy?:'raycast'|'exact'|'clip'|'painter'
    /** Base name for the pages this creates. Default the instructable's own name. */
    pageName?:string
}

export interface LabelBlockOptions
{
    x?:string|number
    y?:string|number
    width?:string|number // 10mm, 5%, 0.5
    pivot?:[number,number]
    textSize?:string|number
    secondaryTextSize?:string|number
    labelSize?:string|number
    numTextLines?:number // number of lines of text
    margin?:number|string // between label/text and outer block
    line?:boolean
}


/** Configurator on how to draw shapes on documents (HTML or PDF) 
 *  These settings correspond to the style functions of jsPDF (with some exceptions!)
*/
export interface DocPathStyle {
    // see: https://pdfkit.org/docs/vector.html
    lineWidth?:number // in pnts
    // NOTE: butt=miter, bevel=square etc. see: https://artskydj.github.io/jsPDF/docs/jspdf.js.html#line4237
    lineCap?:'butt'|'round'|'bevel'
    lineJoin?:'butt'|'round'|'bevel'
    lineDashPattern?:Array<number|number> // size, space
    strokeColor?:string // 'red', '#FF0000'
    strokeOpacity?:number // [0.0-1.0] - NOTE: on jsPDF this is (set)drawColor 
    fillColor?:string
    fillOpacity?:number
    dash?: Array<number>
}

export interface PDFLinePath 
{
    path: string // the d of SVG paths in PDF coords: M 10 10 L 200 200 ...
    style: DocPathStyle
}
