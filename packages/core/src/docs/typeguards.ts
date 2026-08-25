import { parseScaleRatio } from './scale'
import type {
    ContainerHAlignment, ContainerVAlignment, ContainerPositionAbs,
    ContainerAlignment, ContainerPositionCoordAbs, ContainerPositionCoordRel,
    ContainerPositionRel, ContainerPositionLike, ScaleInput, ImageOptionsFit,
    TextAreaAlign, PageSize, PageOrientation, AnyPageContainer,
    DocUnits, DocUnitsWithPerc, PercentageString, ValueWithUnitsString,
    WidthHeightInput, ContainerTableInput,
} from "./types"

import { Container } from "./Container"
import { View } from "./View"
import { isDataRows } from "../calc/typeguards"


export function isContainerHAlignment(o:any): o is ContainerHAlignment
{
    return ['left', 'center', 'right'].includes(o)
}

export function isContainerVAlignment(o:any): o is ContainerVAlignment
{
    return ['top', 'center', 'bottom'].includes(o)
}

export function isContainerAlignment(o:any): o is ContainerAlignment
{
    return Array.isArray(o) && isContainerHAlignment(o[0]) && isContainerVAlignment(o[1])
}

/** A absolute container position coord: 10mm, 10(=default unit) */
export function isContainerPositionCoordAbs(o:any): o is ContainerPositionCoordAbs
{
    return ((typeof o === 'string') && o.match(/mm|cm|inch|pnt/)) !== null // either string with units
            || ((typeof o === 'number') && o > 1)
}

export function isContainerPositionCoordRel(o:any): o is ContainerPositionCoordRel
{
    return (typeof o === 'number' && (o >= 0.0 && o <= 1.0))
}

export function isContainerPositionRel(o:any): o is ContainerPositionRel
{
    return (Array.isArray(o) 
                && o.length === 2 
                && o.every(e => isContainerPositionCoordRel(e)))
            
}

export function isContainerPositionAbs(o:any): o is ContainerPositionAbs
{
    return  ( 
            Array.isArray(o) && o.length === 2 
            && o.every(e => isContainerPositionCoordAbs(e))
        )
}

/** Things that can be turned into a ContainerPositionRel (Array<number|number>) */
export function isContainerPositionLike(o:any): o is ContainerPositionLike
{
    return isContainerPositionRel(o)
        || isContainerAlignment(o) 
        || isContainerPositionAbs(o)
}



/** NOTE: this used to be called as `if(!isScaleInput)` — the FUNCTION, never invoked — so the
 *  guard it stood in was always true and nothing was ever rejected. */
export function isScaleInput(o:any): o is ScaleInput {
    if(o === 'fit' || o === 'auto'){ return true }
    if(typeof o === 'number'){ return isFinite(o) && o > 0 }
    if(typeof o === 'string'){ return parseScaleRatio(o) !== null }
    if(Array.isArray(o)){ return o.length > 0 && o.every(c => parseScaleRatio(c as any) !== null) }
    return false;
}

export function isImageOptionsFit(o:any): o is ImageOptionsFit
{
    return ['fill','contain','cover'].includes(o);
}

export function isTextAreaAlign(o:any): o is TextAreaAlign
{
    return ['left', 'right', 'center', 'fill'].includes(o);
}

export function isPageSize(o:any): o is PageSize
{
    if(typeof o !== 'string'){ return false };
    return o.match(/A[0-7]$/) !== null;
}

export function isPageOrientation(o:any): o is PageOrientation
{
    if(typeof o !== 'string'){ return false };
    return ['landscape','portrait'].includes(o as string);
}

export function isAnyPageContainer(o:any): o is AnyPageContainer
{
    return o instanceof Container ||
            o instanceof View; // TODO: more
}

export function isDocUnits(o:any): o is DocUnits
{
    if(typeof o !== 'string'){ return false };
    return ['mm','cm','inch','pnt'].includes(o as string);
}

export function isDocUnitsWithPerc(o:any): o is DocUnitsWithPerc
{
    if(typeof o !== 'string'){ return false };
    return ['mm','cm','inch','pnt','%'].includes(o as string);
}

export function isPercentageString(o:any): o is PercentageString 
{
    if(typeof o !== 'string'){ return false };
    return o.match(/\-*[\d\.]+%$/) !== null;
}

export function isValueWithUnitsString(o:any): o is PercentageString 
{
    if(typeof o !== 'string'){ return false };
    return o.match(/\-*[\d\.]+mm|cm|inch|\"|pnt$/) !== null;
}

export function isWidthHeightInput(o:any): o is WidthHeightInput
{
    return o === 'auto' ||
        typeof o === 'number' ||
        isPercentageString(o) ||
        isValueWithUnitsString(o);
}

export function isContainerTableInput(o:any): o is ContainerTableInput
{
    return (typeof o === 'string') || isDataRows(o)
}