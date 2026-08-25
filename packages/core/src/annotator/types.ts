import type { BaseAnnotation } from './AnnotatorBaseAnnotation'
import type { DimensionLine } from './AnnotatorDimensionLine'
import type { Label } from './AnnotatorLabel'
import type { MainAxis } from '../modeler/types'
import { type Static } from 'typebox'
import { DimensionOptionsSchema, LabelOptionsSchema } from './schemas'

export type DimensionOptions = Static<typeof DimensionOptionsSchema>
export type LabelOptions = Static<typeof LabelOptionsSchema>

/** Bring all annotations in one type */
export type AnnotationType = 'base'|'dimensionLine' | 'label' // TODO MORE
export type Annotation = BaseAnnotation|DimensionLine|Label
export type AnnotationData = DimensionLineData | LabelData
export type AnnotationAutoDimStrategy = 'part' | 'levels'

/** Exporting Label instances as data (HTML/CSS overlay annotation) */
export interface LabelData
{
    _id?:string,
    _type?:AnnotationType
    type?:'label'
    position:[number,number,number] // anchor point (shape center) in model coords
    value:string
    class?:string // extra CSS class for viewer styling
    line?:boolean // draw a leader line from anchor to the label box
    offset?:number // leader length in screen px
    angle?:number // leader angle in degrees (90 = up on screen)
    circle?:boolean // circle marker at the anchor end of the leader
    arrow?:boolean // DEPRECATED: legacy alias for `circle`
    param?:string // name param bound to this label
}

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
    paramRemapSrc?:string // source of the optional remap function of param(name, remap): re-created in the viewer
    _labelPosition?:Array<number|number|number> // for internal use
    showUnits?:boolean
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
