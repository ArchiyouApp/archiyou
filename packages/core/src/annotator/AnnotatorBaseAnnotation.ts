import { uuid4 } from '../utils' // utils

import type { ArchiyouModules } from '../types'
import type { AnyShape, Bbox } from '../modeler/types'
import type { AnnotationType } from './types'

export class BaseAnnotation
{
    uuid:string;
    value:string|number;
    _type:AnnotationType;
    protected _archiyou: ArchiyouModules;

    constructor(type?:AnnotationType)
    {
        this.uuid = uuid4();
        this._type = type;
    }

    setArchiyou(modules: ArchiyouModules): this
    {
        this._archiyou = modules;
        return this;
    }

    get classes()
    {
        return this._archiyou.modeler.classes;
    }

    static isAnnotation(obj:any):boolean
    {
        return (typeof obj === 'object') && obj.hasOwnProperty('uuid') && obj.hasOwnProperty('_type');
    }

    /** Type of Annotation, reimplemented in extended classes */
    type():AnnotationType
    {
        return this._type;
    }

    update()
    {
        // override
    }

    sameId():string|null
    {
        // override
        return null;
    }

    //// OPERATIONS ////

    inBbox(bbox:Bbox):boolean
    {
        return bbox.contains(this.toShape())
    }

    //// EXPORTS ////

    toSVG():string|null
    {
        return null; // override by child class
    }


    toShape():AnyShape|null
    {
        return null; // override by child class
    }

    toData():any
    {
        // overwritten
    }


}