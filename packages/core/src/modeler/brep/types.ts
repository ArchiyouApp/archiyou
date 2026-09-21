import { Point, Vector, Shape, Vertex, Edge, Wire, Face, Shell,
        Solid, ShapeCollection, VertexCollection, Bbox } from '.'

import type { Brep, Exporter } from '.'

/*  This file still holds a slab of legacy APP types (Doc/Container/Script/Runner/Metric)
    from before the monorepo split — they predate those modules having their own type files.
    The names below are what they refer to; importing them from their real homes keeps this
    file honest until the legacy section is moved out for good. */
import type { BaseAnnotation } from '../../annotator/AnnotatorBaseAnnotation'
import type { Make } from '../Make'
import type { Script } from '../../Script'
import type { ScriptParam } from '../../execution/ScriptParam'
import type { Metric, DataRows } from '../../calc/types'
import type { ParamOperation, ScriptOutputData, PublishLicense } from '../../execution/types'
import type { DocPathStyle } from '../../docs/types'
import type { RunnerScriptExecutionRequest } from '../../runner/types'
import type { Docs } from '../../docs/Docs'
import type { Container } from '../../docs/Container'
import type { View } from '../../docs/View'
import type { DimensionLine } from '../../annotator/AnnotatorDimensionLine'
import type { CodeParser } from '../../execution/CodeParser'
import type { Calc } from '../../calc/Calc'
import type { Db as CalcDb } from '../../calc/Db'
import type { Runner } from '../../runner/Runner'

import type { ScriptData, ScriptParamData } from '../../execution/types'

// Stubs for modules not yet ported to archiyou-core-next
export type ParamManager = any;
export type Services = any;

import type { Console } from '../../console/Console'

//// UNION TYPES ////

export type ModelUnits = 'mm'|'cm'|'dm'|'m'|'km'|'inch'|'feet'|'yd'|'mi'; // matches ModelUnitsSchema (modeler/schemas.ts)
export type Units = DocUnits | ModelUnits
export type UnitsWithPerc = Units | '%'
import type { StyleData } from '@archiyou/meshup'

export type Coord = number|string
export type MainAxis = 'x'|'y'|'z'
export type Plane = 'xy' | 'xz' | 'yz'
export type Axis =  'x' | '-x' | 'y' | '-y' | 'z' | '-z' | Plane // Axis and Planes
export type SideX = 'left'|'right'
export type SideY = 'front'|'back'
export type SideZ = 'top'|'bottom'
export type Side = SideX|SideY|SideZ
export type SketchPlaneName = Plane | Side
export type CoordArray = [Coord,Coord,Coord]
export type PointLike = Coord|Array<Coord>|Vector|Point|Vertex // PointLike: All Datatypes that informationally could be seen as a Point
export type PointLikeSequence = Array<PointLike>|ShapeCollection // PointLikeSequence: An array of PointLike types
export type ShapeType = 'Vertex'|'Edge'|'Wire'|'Face'|'Shell'|'Solid'
export type ShapeTypes = Array<ShapeType>
export type LinearShape = Edge|Wire // LinearShape: A Shape that is linear.
export type PointLikeOrAnyShape = PointLike|AnyShape
// NOTE: Need to remove Shape here?
export type AnyShape = Shape|Vertex|Edge|Wire|Face|Shell|Solid // Single Shape, excluding ShapeCollection
export type AnyTypedShape = Vertex|Edge|Wire|Face|Shell|Solid
export type AnyShapeCollection = ShapeCollection|VertexCollection
export type AnyShapeSequence = AnyShapeCollection|Array<AnyShape> 
export type AnyShapeOrCollection = AnyShape|AnyShapeCollection
export type AnyShapeOrSequence = AnyShape|AnyShapeSequence // Both Shapes, ShapeCollection or Arrays of Shapes
export type PointLikeOrVertexCollection = PointLike|VertexCollection
export type PointLikeOrAnyShapeOrCollection = PointLike|AnyShape|AnyShapeCollection
export type ColorInput = string|number
export type Pivot = PointLike|string
export type Alignment = string|PointLike // 'leftbottomtop' or [0,0.5,1.0]
export type BboxAlignment = Array<number>|Alignment // [bbox_offset_perc_x,bbox_offset_perc_y] or combinations of left, top, front
export type LinearShapeTail = 'start'|'end'
export type ThickenDirection = 'all'|'center'|PointLike|Side
export type OrientationXY = 'horizontal'|'vertical'

export type SelectionString = string;
export type AnyShapeOrCollectionOrSelectionString = AnyShape|AnyShapeCollection|SelectionString;
export type PointLikeOrAnyShapeOrCollectionOrSelectionString = PointLikeOrAnyShapeOrCollection|SelectionString;

export type MakeShapeCollectionInput = PointLikeOrAnyShapeOrCollection|PointLikeSequence|Array<PointLikeOrAnyShapeOrCollection|PointLikeSequence>
export type MakeWireInput = PointLikeSequence|AnyShapeOrCollection|Array<PointLikeSequence|AnyShapeOrCollection>;
export type MakeFaceInput = Wire|PointLikeSequence|AnyShapeSequence
export type MakeShellInput = Array<Face|Edge>|ShapeCollection
export type MakeSolidInput = Array<Shell>|ShapeCollection

/** Pipelines are calculations that need to run to generate certain outputs */
export type PipelineType = 'docs' | '3dprint' | 'cnc' | 'techdraw' | 'laser'

//// INTERFACES ////

/** Saved Scripts by Version */
export interface ScriptVersion 
{
    id? : string,
    file_id? : string,
    user_id? : string,
    user_name? : string,
    file_name? : string,
    prev_version_id? : string,
    created_at? : string,
    updated_at? : string,
    params? : Array<ScriptParam>,
    code : string,
    shared?: boolean,
    shared_version_tag?:string,
    shared_auto_sync? : boolean,
    shared_category?: string,
    shared_description?: string
}

/** After execution of the script (on client or server) we fill in some metadata */
export interface ScriptMeta
{
    // Information after execution of script
    units: ModelUnits, // units of the script
    pipelines: Array<string>, // pipelines that are part of the script
    metrics: Array<string>, // metric names that are part of the script
    tables: Array<string>, // table names that are part of the script
    docs: Array<string>, // names of docs that are part of the script
    numShapes?: number
    bbox?: Array<number|number|number|number|number|number>, // bbox of scene [minX, minY, minZ, maxX, maxY, maxZ]
}

/** Information on how the Script is published 
 *  If null then the script is not published
 *  Before publishing the script is executed and validated, so here we also add information 
 *  that comes out of execution
*/
export interface ScriptPublished
{
    title?:string // nice title of the script
    libraryUrl?:string // url to the library where the script is published
    url?:string // url to the published script - without library url - this anticipates different publication urls
    published?:Date // Date of publication
    description?:string // public description of script
    public?:boolean // if the script is public or not
    params?: Record<string, any>; // the parameters that are public with override configuration, others are default
    presets?: Array<string>; // presets that are public
}

/** A group of all modules of Archiyou for easy access  */
export interface ArchiyouApp
{
    oc?: any // open cascade module
    worker?: any, // Keep track of scope of root scope of Archiyou core app - TODO: TS typing
    runner?:Runner, // The instance of the Runner where the script is run
    scope?:any // Scope where the script is run in
    brep?: Brep,
    doc?: Docs,
    console?: Console,
    executor?: CodeParser,
    exporter?: Exporter,
    calc?: Calc,
    make?: Make,
    services?: Services,
    // TODO: importer?
    gizmos?: Array<Gizmo>, // TODO: move this to Geom?
    paramManager?:ParamManager
    config?: Record<string,any> // all environment variables
}

export interface ArchiyouAppInfoBbox
{
    min:Array<number|number|number> // leftfrontbottom 
    max:Array<number|number|number> // rightbacktop
    width: number
    height: number
}

export type ArchiyouOutputFormatType = 'step'|'stl'|'gltf'

export interface ArchiyouOutputSettings
{
    // what to calculate/output
    metrics?:boolean
    tables?:boolean
    docs?:boolean|Array<string> // true/false, or names of included docs
    pipelines?:boolean|Array<string> // true for all, false for none, or array with names to include
    formats?:boolean|Array<ArchiyouOutputFormatType> // true for all, false for none, or names of formats to include
    messages?:boolean|Array<ConsoleMessageType> // true/false, or names of included message types
}

export type ConsoleMessageType = 'info'|'geom'|'user'|'warn'|'error'|'exec'

/** A console Message */
export interface ConsoleMessage
{
    type: ConsoleMessageType,
    time: string,
    from: string, // component
    message: string,
}

/** Special Archiyou data inserted into asset.archiyou
    TODO: We use RunnerScriptExecutionResult internally - which has a lot of overlap with this
    When we start using GLB format internally these types will merge
*/
export interface ArchiyouData
{
    scenegraph: SceneGraphNode
    gizmos: Array<Gizmo>,
    annotations: Array<DimensionLineData>, 
    docs: {[key:string]:DocData} // all documents in data and serialized content
    errors?: Array<StatementResult>, // only needed for internal use in the future
    messages?: Array<ConsoleMessage>, // NOTE: for internal use and export in GLTF
    metrics?: Record<string, Metric>,  
    tables?:{[key:string]:any}, // raw data tables
    managedParams?:Record<ParamOperation, Array<ScriptParamData>>
}


/** TODO */
export interface ExportSVGOptions 
{

}

export interface ExportGLTFOptions 
{
    binary?: boolean
    quality?: MeshingQualitySettings
    archiyouFormat?: boolean // use Archiyou format
    archiyouOutput?:ArchiyouOutputSettings
    includePointsAndLines?: boolean // export loose points and edges 
    extraShapesAsPointLines?: boolean // for visualization purposes seperate points and lines
}   



export type EngineStateStatus = 'init' | 'loaded' | 'executing' | 'executed'

export interface EngineState
{
    engine: 'cloud' | 'local',
    status?: EngineStateStatus,  // TODO: error/succes??
    executionTime?: number|undefined, // duration in ms
    statements?: Array<StatementResult>
}

export interface MeshingQuality
{

}

export interface ComputeTask
{
    uuid?: string,
    type: string,  // execute, execute+export?
    user_id? : string,
    broker_id? : string,
    client_id?: string,
    created_at?: Date,
    params? : Array<ScriptParam>,
    code: string
}

export interface RunnerScriptExecutionResult
{
    created_at: Date,
    status:'success'|'error',
    duration: number
    request: RunnerScriptExecutionRequest,

    scenegraph?: SceneGraphNode
    gizmos?: Array<Gizmo>,
    annotations?: Array<any> // TODO: TS typing: DimensionLineData etc. 
    managedParams?:Record<ParamOperation, Array<ScriptParamData>>

    statements?: Array<StatementResult>
    errors?: Array<StatementResult>, // seperate the error statements (for backward compat)
    warnings?: Array<string>, // warnings that occured related to request or execution
    messages?: Array<ConsoleMessage>, // based on settings in request you find the relevant messages

    meta?: ScriptMeta, // meta information on the script execution
    
    // All outputs in flat array with request path and data
    outputs?: Array<ScriptOutputData>
}

/** Results of component execution 
 *  This is a flattened version of RunnerScriptExecutionResult for direct use in execution scope
 *  Any output is in internal format
 *   - models -> Obj (which contains Shapes)
 *   - metrics -> Record<string,Metric>
 *   - tables -> CalcTable (or CalcDb?)
 *   - docs -> Docs
 *
*/
export type ImportComponentOutput = ShapeCollection|Record<string,Metric>|Calc|Docs|null
export interface ImportComponentResultPipeline {
    model?: ShapeCollection|null,
    metrics?: Record<string,Metric>|null,
    tables?:CalcDb|null,
    docs?: Docs|null
}
/** Result with multiple pipelines */
export type ImportComponentResultPipelines = Record<string, ImportComponentResultPipeline>
/** Combined type: direct output, per pipeline or multiple pipelines */
export type ImportComponentResult = ImportComponentOutput|ImportComponentResultPipeline|ImportComponentResultPipelines


///// SHAPES/GEOMETRY BASICS /////

/** All possible attributes for Shapes */
// TODO: Can we allow user attributes??
export interface ShapeAttributes
{
    hidden?:boolean // lines that are hidden behind other shapes in projection
    outline?:boolean // outlines after projection
    visible?:boolean
    dashed?:boolean
}

/** A cursor in a coordinate system. Used in Sketcher and others in the future */
export interface Cursor
{
    point: Point,
    direction?: Vector, // tangent of last Shape at Point
}

export interface PolarCoord
{
    length: number,
    angle: number,
    relativeAngle?: boolean,
}

/** Represents a link between two Shapes */
export interface Link {
    from : Point,
    to : Point,
    fromSupport: Vertex|Edge|Face, // Vertex, Edge, or Face in from Shape that contains the Point
    toSupport: Vertex|Edge|Face, // Vertex, Edge, or Face in to Shape
    fromParams : Array<number>, // NOT WORKING
    toParams : Array<number>, // NOT WORKING
    distance : number,
}

export interface SceneGraphNode {
    name: string,
    type: string,
    nodes: Array<SceneGraphNode>,
    details?: SceneGraphNodeDetails,
}

export interface SceneGraphNodeDetails {
    visible?: boolean,
    color?: number,
    subType?: string, 
    numVertices?:number,
    numEdges?:number,
    numWires?:number,
}


export interface Gizmo
{
    name: string, 
    _id? : string, // uuid
    axis : string, // axis the gizmo moves in [x,y,z,xy,xz,yz,xyz]
    position: Array<number>, // start position of gizmo
    domains : Array<number>, // domains per axis relative to position [xmin,xmax], [[xmin,xmax],[ymin,ymax]] or [[xmin,xmax],[ymin,ymax],[zmin,zmax]]
    step: number, // step size of gizmo - TODO: tie into param
    toParams : Object, // { axis : params } or paramName : { axis: 'x', range: [valueMin, valueMax]} }
    _curPosition?: Array<number>,
    _index?: number,
    _obj? : any // Three Object3D
    _dummy?: any, // Three Object3D
    _domainBounds?: Array<Array<any>>,
    _paramValues : Object, // { param: value }
}

/** For applying select strings */
export interface Selection
{
    string: SelectionString,
    targetShape: string, // Vertex, Edge etc.
    singleResult?: boolean, // *NOT IMPLEMENTED*Are we looking for one or more 
    paramValue?: any,
    selectorMethod?: any, // method on Shape to select (with param) the needed entities
    selectedShapes?: Shape|ShapeCollection // previously selection
}

export interface SelectionShapeTargetSetting
{
    single?: boolean,
    targetShapeType: string,
    ignoreCase?: boolean,
}

export interface SelectorSetting 
{
    testLong: string,
    testShort: string,
    params: Array<string>,
    worksOn: Array<string>,
    selectorMethod: string, // name of method
}

export interface SelectorPointRange
{
    point?: Array<number>,
    operator?: string, // < > <= >=
    range?: number,
}

export interface SelectorAxisCoord
{
    axis?: 'x'|'y'|'z',
    coord?: number,
    tolerance: number,
}

export interface SelectorBbox
{
    from?: Array<number>,
    to?: Array<number>
}

export interface SelectorIndex
{
    indices?: Array<number>, // indices of Subshapes
}

//// SHAPE CLONING ////

export interface ShapeClone
{
    from: AnyShape
    transformations:Array<any> // TODO
}

//// SCRIPT CODE STATEMENTS ////

/** The Script seperated into statements */
export interface Statement
{
    code:string; // the real code
    startIndex?: number;
    endIndex?: number;
    lineStart?:number; // the line the statement starts (it can actually span multiple lines)
    lineEnd?:number;
    columnStartIndex?:number;
    columnEndIndex?:number;
}

export interface StatementResult extends Statement
{
    status: 'error'|'success'
    message?: string,
    duration?: number
    durationPerc?:number // Added by Archiyou app ProfilingMenu
}

//// ANNOTATIONS ////

/** Bring all annotations in one type */
export type AnnotationType = 'base'|'dimensionLine' | 'label' // TODO MORE
export type Annotation = BaseAnnotation|DimensionLine  // TODO: more: label
export type AnnotationData = DimensionLineData // TODO
export type AnnotationAutoDimStrategy = 'part' | 'levels'

/** Exporting DimensionLine instances as data */
export interface DimensionLineData
{
    _id?:string, // internal id
    _type?:AnnotationType
    start:[number,number,number] // start point of line (ie the arrow)
    end:[number,number,number]
    targetStart:[number,number,number]
    targetEnd:[number,number,number]
    targetDir:[number,number,number]
    dir:[number,number,number]
    value:number
    static?:boolean // if value can be calculated from distance between start-end or is static (for example after projection)
    units?:string
    offsetVec?:[number,number,number]
    offsetLength?:number
    offset?:Array<number|number|number> // offset vector with length in model units
    interactive:boolean
    round?:boolean 
    roundDecimals?:number
    param:string // name param binded to this dimension line
    _labelPosition?:Array<number|number|number> // for internal use
    showUnits?:boolean
}

/** Used with Shape.dimension() as options 
 *  NOTE: update typeguards when adding fields to this
*/
export interface DimensionOptions 
{
    units?:ModelUnits
    offset?:number // offsetLength (minus for other direction)
    offsetVec?:Vector
    ortho?:boolean|MainAxis
    roundDecimals?:number // round to number decimals. Default is 0
}

export interface DimensionLevel
{
    axis:MainAxis // axis of dimension cut line. Horizontal cut is axis y, vertical is x
    at: number // coordinate on given axis, relative or absolute
    coordType?: 'relative' | 'absolute' // auto determine
    align?: 'min'|'auto'|'max'|false|true // align dimension lines to Shape/Collection. Use false to disable.
    minDistance?: number // skip when distance is less then minDistance
    offset?:number
    showLine?:boolean // show DEBUG line
}

export interface DimensionLevelSettings
{
    levels: Array<DimensionLevel>
}

//// DOC ////

export type DocUnits = 'mm'|'cm'|'inch'|'pnt' 
export type DocUnitsWithPerc = DocUnits | '%' // Percent of page (side is dependent of measure)
export type PercentageString = string // 100%, 5% etc.
export type ValueWithUnitsString = number|string // string with number and DocUnitsWithPerc
export type WidthHeightInput = number|PercentageString|ValueWithUnitsString;
export type ContainerTableInput = string | DataRows

export interface DocSettings {
    proxy: string // url of proxy
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
export type ZoomRelativeTo = 'container'|'world'
export type ScaleInput = 'auto'|number;
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
    zoomLevel?:ScaleInput, // number or 'auto' [default]
    zoomRelativeTo?:ZoomRelativeTo,
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

export interface toSVGOptions
{
    all?:boolean // also invisible
    only2D?:boolean // only export 2D shapes
    annotations?:boolean
    fills?:boolean // Generate fills in SVG
    outlines?:boolean // Calculate the Shape outlines (Slow!)
    /** Model units per millimeter ON THE PAGE. Set by a document view from the scale it fits
     *  this drawing at, so annotations come out at their real page size (see the
     *  DIMENSION_*_MM settings on the Annotator). */
    unitsPerMm?:number
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

//// INTERFACES FOR OUTPUTS ////

export interface VertexMesh {
    objId : string,
    ocId : string,
    vertices: Array<number>, // vertices instead of vertex for consistency
    indexInShape: number
}

export interface EdgeMesh {
    objId : string,
    ocId : string,
    vertices: Array<number>, // coord buffer!
    indexInShape: number
}

export interface FaceMesh {
    objId : string,
    ocId : string,
    numTriangles : number,
    vertices: Array<number>, // triangle vertices
    normals: Array<number>, // Vertex normals
    uvCoords: Array<number>,
    triangleIndices: Array<number>,
    indexInShape: number,
}

export interface MeshCache {
    vertices:Array<VertexMesh>|null,
    edges:Array<EdgeMesh>|null,
    faces:Array<FaceMesh>|null,
}

/** MeshShape is a very verbose format in which to save Shape Mesh data
 *  Inclusing for every Vertex, Edge and Face:
 *      - objId
 *      - ocId
 *      - vertex or vertices
 * 
 *  NOTE: is it really needed?
 */
export interface MeshShape {
    objId: string,
    vertices : Array<VertexMesh>,
    edges : Array<EdgeMesh>,
    faces : Array<FaceMesh>,
    style? : StyleData, // meshup Style data - see Shape._getObjStyle()
}

export interface MeshInfo {
    objId: string,
    shapeId: number,
    subShapeType: 'Face'|'Edge'|'Vertex';
    indexInShape: number,
    color?: number,
    faceGroupVertexIndices?:number,
    edgeGroupLineSegmentsRange?:Array<number>,
}

export interface MeshShapeBufferStats {
    numVertices: number,
    numEdges: number, // real OC Edges
    numLines?: number, // num lines from triangulated Edges
    numTriangles: number,
    numFaces: number,
    numShapes: number, 
}

/** New optimized Mesh buffer: combines all Vertices, Edges and Face triangles in one buffer  */
export interface MeshShapeBuffer {
    verticesBuffer: Array<number>, // vertex coords buffer
    verticesInfo:Array<MeshInfo>, 
    edgesBuffer: Array<number>, // edges coords buffer
    lineEdgesInfo: Array<MeshInfo> // line edge info
    trianglesVertices: Array<number>, // faces coords buffer
    trianglesVertexColors: Array<number>, // per vertices 3 color values (RGB)
    triangleIndices: Array<number>,
    triangleNormals: Array<number>,
    triangleUVs: Array<number>,
    trianglesInfo: Array<MeshInfo>,
    stats: MeshShapeBufferStats,
}

export interface MeshingQualitySettings 
{
    linearDeflection: number,
    angularDeflection: number,
    tolerance: number,
    edgeMinimalPoints: number,
    edgeMinimalLength: number,
}

export interface SelectedMeshShapeInfo
{
    meshInfo: MeshInfo,
    stats: MeshShapeBufferStats,
}
