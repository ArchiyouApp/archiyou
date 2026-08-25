import { Page } from './Page'

import type {
    WidthHeightInput,
    DocPathStyle, ContainerPositionRel,
    ContainerType, ContainerHAlignment, ContainerVAlignment, ContainerAlignment, ScaleInput,
    ContainerSizeRelativeTo, ContainerPositionLike, ContainerData, Frame,
    ContainerContent,  ContainerPositionCoordAbs, ContainerPositionCoordRel, PageSide, ValueWithUnitsString,
    PageSVGContext } from './types'

import { isContainerHAlignment, isContainerVAlignment, isContainerAlignment,
            isContainerPositionLike, isContainerPositionCoordAbs, isScaleInput,
            isContainerPositionCoordRel, isWidthHeightInput, isContainerPositionRel, isContainerPositionAbs
 } from './typeguards'

import { convertTextHeightUnitsToFontPoints, pointsToMm, escapeXml, pathStyleToSVGAttrs, SVG_TEXT_FONT_FAMILY } from './utils'
import { DOC_CONTAINER_TITLE_TEXT_HEIGHT, DOC_CONTAINER_CAPTION_TEXT_HEIGHT,
    DOC_CONTAINER_CAPTION_TEXT_PADDING_FACTOR } from '../constants'

export class Container
{
    //// SETTINGS ////
    WIDTH_DEFAULT = 1.0; // in perc of content areaContainerPositionLike
    HEIGHT_DEFAULT = 1.0;
    PIVOT_DEFAULT:ContainerAlignment = ['left', 'top'];
    POSITION_DEFAULT:ContainerAlignment = ['left', 'top'];
    CONTENT_ALIGN_DEFAULT:ContainerAlignment = ['left','top'];

    //// END SETTINGS ////

    name:string;
    _page:Page; // through page also root doc
    _parent:Container; // if nested on other container
    _type:ContainerType;
    _width:number; // in relative coordinates [0-1] of page content area width or page width (when _widthRelativeTo = 'page')
    _height:number; // in relative coordinates [0-1] of page content area height or page height (when _heightRelativeTo = 'page')
    _widthRelativeTo:ContainerSizeRelativeTo = 'page-content-area'; // NOTE: 'page-content-area is the area that remains after page padding [DEFAULT]
    _heightRelativeTo:ContainerSizeRelativeTo = 'page-content-area';
    _position:Array<number|number>; // x,y in relative coords [0-1] of page-content-area
    _pivot:Array<number|number>; // x,y in percentage [0-1] of [containerWidth,containerHeight] - leftbottom = [0,0]
    _border:boolean = false;
    _borderStyle:DocPathStyle;
    _frame:Frame;
    _index:number; // ordering z-index
    _contentAlign:ContainerAlignment;
    _content:any; // TODO: raw content (like Svg for View, source for Image etc)
    /** Drawing scale — see scale(). 'fit' (fill the container) unless a script says otherwise. */
    _scale:ScaleInput = 'fit';
    /** Zoom on top of that scale — see zoom(). */
    _zoom:number = 1;
    /** width('auto') / height('auto'): size this container to its content — see _autoSizeMm(). */
    _widthAuto:boolean = false;
    _heightAuto:boolean = false;

    _title:string; // title of container placed above container (for example: "Front elevation") 
    _caption:string; // caption of container placed below container (for example: "View from the front")

    constructor() 
    {
        // Name is generated when added to page/doc
    }

    _setDefaults()
    {
        // NOTE: this is set up when in constructor, don't apply options here because they will overwrite options in constructor
        if(!this._width) this.width(this.WIDTH_DEFAULT);
        if(!this._height) this.height(this.HEIGHT_DEFAULT);
        if(!this._pivot) this.pivot(this.PIVOT_DEFAULT);
        if(!this._position) this.position(this.POSITION_DEFAULT);
    }

    /** Options set after container is placed on page */
    _onPlaced(i?:any):any
    {
        // Overriden by child class
    }

    on(page:Page):this
    {
        this._page = page;
        this._setDefaults(); 

        this.name = this._page._doc._generateContainerName(this._type); // For now, just use type to name the container
        this._onPlaced(); // specific methods on child 

        page.add(this); // Add to Page

        return this;
    }

    checkOnPage()
    {
        if(!this._page)
        { 
            throw new Error(`DocPageContainer::checkOnPage(): Cannot set certain attributes if the Container is not on a page yet!`)
        }
    }

    setName(n:string):this
    {
        if(n){ this.name = n;}
        return this;
    }

    /** Set content of this Container
     *  Subclasses can override this to set specific content types
     */
    setContent(v:any):this
    {
        console.info(`Container::setContent(): Setting content of container "${this.name}" from "${this._content}" to: ${v}`);
        this._content = v;
        return this;
    }

    /** Set width of this Container. A number is a fraction of the page area ([0-1]), or use
     *  units ("30mm", "40%"), or 'auto' to size it to what the container holds. */
    width(n:WidthHeightInput)
    {
        this.checkOnPage();
        if(!isWidthHeightInput(n)){ throw new Error(`Container::width: Invalid input "${n}": Use a number, number with units ("30mm"), a string like "40%", or 'auto'!`)};

        this._widthAuto = (n === 'auto');
        if(this._widthAuto){ return }  // the value stands in until the content is measured

        [this._width, this._widthRelativeTo] = this._page._doc._resolveWidthHeightInput(n, this._page, 'width');
    }

    /** Set height of this Container. See width(). */
    height(n:WidthHeightInput)
    {
        this.checkOnPage();
        if(!isWidthHeightInput(n)){ throw new Error(`Container::height: Invalid input "${n}": Use a number, number with units ("30mm"), a string like "40%", or 'auto'!`)};

        this._heightAuto = (n === 'auto');
        if(this._heightAuto){ return }

        [this._height, this._heightRelativeTo] = this._page._doc._resolveWidthHeightInput(n, this._page, 'height');
    }

    /** The size this container actually takes, given the size the page allotted it.
     *
     *  Where width()/height() were told 'auto', a subclass answers with what its content
     *  needs. Only a view can: it knows its drawing and the scale it draws at, so the
     *  millimeters follow. Everything else keeps the size it was given. */
    _autoSizeMm(wMm:number, hMm:number):[number, number]
    {
        if(this._widthAuto || this._heightAuto)
        {
            console.warn(`Container::width|height('auto'): a ${this._type} cannot size itself to its `
                + `content — only a view can (it knows its drawing and its scale). Kept ${+wMm.toFixed(1)}x${+hMm.toFixed(1)}mm.`);
        }
        return [wMm, hMm];
    }

    /** Set position with a ContainerAlignment or percentage of width and height [x,y] or absolute position with units */
    position(p:ContainerPositionLike):Container
    {
        this.checkOnPage();
        if(!isContainerPositionLike(p)){ throw new Error(`Container::position: Invalid input "${p}": Use [widthPerc,heightPerc] or ContainerAlignment ('center','topleft'etc)`)};
        
        this._setPositionCoord(p[0], 'width');
        this._setPositionCoord(p[1], 'height');
        
        return this;
    }

    _setPositionCoord(c:ContainerPositionCoordAbs|ContainerPositionCoordRel, side:PageSide):number
    {
        const p = (isContainerPositionCoordRel(c)) ? 
                    c
                    : isContainerHAlignment(c) ? this._containerHAlignmentToPositionRel(c) 
                        : isContainerVAlignment(c) ? this._containerVAlignmentToPositionRel(c)
                            : isContainerPositionCoordAbs(c) ? this._page?._resolveValueWithUnitsStringToRel(c, side) // page can not be there yet!
                                : null

        if(p === null){  throw new Error(`Doc::Container::position(): Invalid position coord: "${c}" (translated to ${p} relative). Try a page alignment like top,left or coords relative ([0-1]) relative to page left bottom or absolute coordinates with units like 10mm`);}

        if(!this._position){ this._position = [.5,.5]; }

        this._position[(side === 'width') ? 0 : 1] = p;
        return p;
    }

    /** Set pivot with a ContainerAlignment ('top', 'topright') or percentage of width and height [x,y]  */
    pivot(p:ContainerPositionLike):Container
    {   
        if(!isContainerPositionLike(p))
        { 
            throw new Error(`Container::pivot(): Invalid input "${p}": Use [widthPerc,heightPerc] or ContainerAlignment ('center','topleft'etc)`)
        };

        if(isContainerPositionRel(p))
        {
            this._pivot = p as Array<number|number>;
        }
        else if(isContainerAlignment(p))
        {
            this._pivot = this._containerAlignmentToPosition(p);
        }
        else if(isContainerPositionAbs(p))
        {
            throw new Error(`Doc::Container::pivot(${p}): Setting the pivot as absolute coords ['10mm','20mm] is not (yet) supported!`);
        } 
        else {
            throw new Error(`Doc::Container::pivot(${p}): Invalid pivot. Try a page alignment like 'topleft' or coords relative ([0-1]) relative to page left bottom or absolute coordinates with units like 10mm`);
        }

        return this;
    }

    /** Zoom in or out of whatever this container would otherwise show: 2 fills it with half
     *  the drawing, 1/2 with twice as much. Relative to the container, so it composes with
     *  scale() rather than replacing it. */
    zoom(factor:number):this
    {
        if(typeof factor !== 'number' || !isFinite(factor) || factor <= 0){ throw new Error(`Container::zoom(): Invalid input "${factor}" for zoom relative to container: Use a number like 2 (zoom in 2x) or 1/2 (zoom out 2x)`)};
        this._zoom = factor;
        return this;
    }

    /** The drawing scale of this container: 'fit' (default), 'auto', a ratio like 1/100, a
     *  list to choose from, or a written scale like '1:100'.
     *
     *  NOTE: scale and zoom used to share one field (`_zoomLevel`) and be told apart by a
     *  second one, so `.scale(1/100).zoom(2)` quietly threw the scale away. They are separate
     *  now: the effective scale is the resolved scale times the zoom. */
    scale(factor:ScaleInput):this
    {
        if(!isScaleInput(factor)){ throw new Error(`Container::scale(): Invalid input "${JSON.stringify(factor)}" to set the drawing scale: Use 'fit', 'auto' (largest standard scale that fits), a number like 2 (2:1) or 1/10 (1:10), a list of them, or a written scale like '1:100'`)};
        this._scale = factor;
        return this;
    }

    /** Turn on border on this container. Use without param to use default style */
    border(style?:string|DocPathStyle)
    {
        this._border = true;
        this._borderStyle = (typeof style === 'object') ? style : (typeof style === 'string') ? { strokeColor: style } as DocPathStyle : null; 
    }

    //// ADDED CONTEXTUAL CONTENT ////
    
    /** Caption this container: a line of text under its frame.
     *
     *  A VIEW overrides this — see View.caption(). There the caption belongs to the drawing:
     *  it goes inside the frame, it can name the scale, and it needs no text at all, since a
     *  view knows what it is. Every other container is a box on a page with nothing to say
     *  about itself, so it needs to be told. */
    caption(s?:string|boolean|Record<string,any>):this
    {
        if(typeof s !== 'string' || !s.trim())
        {
            console.warn(`Container::caption(): a ${this._type} caption needs a string — `
                + `caption("Parts list"). Only a view can caption itself (it uses its name and scale).`);
            return this;
        }
        this._caption = s;
        return this
    }

    title(s:string):this
    {
        if(!s || typeof s !== 'string'){ throw new Error(`DocPageContainer::title(): Please supply a title string!`)}
        this._title = s;
        return this
    }

    //// OUTPUT ////

    /** Transform from relative width (to page or page-content-area) to absolute (in DocUnits) */
    _calculateAbsWidth():number
    {
        const relToSize =  (this._widthRelativeTo === 'page-content-area') ?
            this._page._width - 2*this._page._width*this._page._padding[0] : this._page._width
        return this._width * relToSize;
    }

    /** Transform from relative height (to page or page-content-area) to absolute (in DocUnits) */
    _calculateAbsHeight():number
    {
        const relToSize = (this._heightRelativeTo === 'page-content-area') ?
            this._page._height - 2*this._page._height*this._page._padding[1] : this._page._height
        return this._height * relToSize;
    }

    /** Alias for page._resolveValueWithUnitsStringToRel with active page (if any) */
    _resolveValueWithUnitsStringToRel(s:ValueWithUnitsString, side:PageSide):number|null
    {
        if(!this._page)
        { 
            console.warn(`DocPageContainer::_resolveValueWithUnitsStringToRel(): Container is not yet on page. Cannot make "${s}" relative`);
            return null;
        };

        return this._page._resolveValueWithUnitsStringToRel(s, side)
    }


    /** Export Data of Container */
    async toData(cache?:Record<string,any>|undefined):Promise<ContainerData>
    {
        // will be overriden by subclasses (DocPageContainerImage, DocPageContainerText etc)
        return null;
    }

    /**
     * Render this container to SVG, returning the clip-path def and the container <g> element separately.
     * Called by Page.toSVG() for each container.
     */
    async toSVG(ctx: PageSVGContext): Promise<{def: string, html: string}>
    {
        const fmt = (n: number) => +n.toFixed(4);

        // Compute container dimensions in mm
        const contentW = ctx.pageWidthMm - 2 * ctx.hPaddingMm;
        const contentH = ctx.pageHeightMm - 2 * ctx.vPaddingMm;

        const wBase = this._widthRelativeTo === 'page' ? ctx.pageWidthMm : contentW;
        const hBase = this._heightRelativeTo === 'page' ? ctx.pageHeightMm : contentH;
        // 'auto' asks the container what its content needs; the rest keep what they were given
        const [wMm, hMm] = this._autoSizeMm((this._width ?? 0) * wBase, (this._height ?? 0) * hBase);

        // Compute top-left position in page-local SVG coords (mm, y-down)
        // Doc model: position[0,1] is anchor in content-area relative [0-1], y-up.
        // Pivot[0,1] is where the anchor sits within the container, relative [0-1], y-up.
        const pivotAbsX = (this._position?.[0] ?? 0) * contentW + ctx.hPaddingMm;
        const pivotAbsY = (1 - (this._position?.[1] ?? 1)) * contentH + ctx.vPaddingMm; // y-flip
        const tlX = pivotAbsX - (this._pivot?.[0] ?? 0) * wMm;
        const tlY = pivotAbsY - (1 - (this._pivot?.[1] ?? 1)) * hMm;

        const innerSVG = await this._toSVGContent(ctx, wMm, hMm);

        if (!innerSVG && !this._border && !this._title && !this._caption)
        {
            return { def: '', html: '' };
        }

        const hasClipBounds = wMm > 0 && hMm > 0;
        const clipId = hasClipBounds ? ctx.nextClipId() : '';
        const clipDef = hasClipBounds
            ? `<clipPath id="${clipId}"><rect x="0" y="0" width="${fmt(wMm)}" height="${fmt(hMm)}"/></clipPath>`
            : '';

        const DEFAULT_BORDER_STYLE: DocPathStyle = { strokeColor: '#999999', lineWidth: 0.5 };

        const borderSVG = this._border
            ? `<rect x="0" y="0" width="${fmt(wMm)}" height="${fmt(hMm)}" fill="none" ${pathStyleToSVGAttrs({ ...DEFAULT_BORDER_STYLE, ...(this._borderStyle ?? {}) })}/>`
            : '';

        const titleHeightMm  = pointsToMm(convertTextHeightUnitsToFontPoints(`${DOC_CONTAINER_TITLE_TEXT_HEIGHT}mm`));
        const titleYMm       = -(titleHeightMm * DOC_CONTAINER_CAPTION_TEXT_PADDING_FACTOR);
        const titleSVG = this._title
            ? `<text x="0" y="${fmt(titleYMm)}" font-family="${SVG_TEXT_FONT_FAMILY}" font-size="${fmt(titleHeightMm)}" fill="black" dominant-baseline="auto">${escapeXml(this._title)}</text>`
            : '';

        const captionHeightMm = pointsToMm(convertTextHeightUnitsToFontPoints(`${DOC_CONTAINER_CAPTION_TEXT_HEIGHT}mm`));
        const captionYMm      = hMm + captionHeightMm * DOC_CONTAINER_CAPTION_TEXT_PADDING_FACTOR;
        const captionSVG = this._caption
            ? `<text x="${fmt(wMm / 2)}" y="${fmt(captionYMm)}" font-family="${SVG_TEXT_FONT_FAMILY}" font-size="${fmt(captionHeightMm)}" fill="black" text-anchor="middle" dominant-baseline="text-before-edge" alignment-baseline="text-top">${escapeXml(this._caption)}</text>`
            : '';

        const html = [
            `    <g transform="translate(${fmt(tlX)},${fmt(tlY)})">`,
            titleSVG ? `      ${titleSVG}` : '',
            hasClipBounds
                ? `      <g clip-path="url(#${clipId})">`
                : '',
            innerSVG
                ? hasClipBounds
                    ? `        ${innerSVG}`
                    : `      ${innerSVG}`
                : '',
            hasClipBounds ? `      </g>` : '',
            borderSVG ? `      ${borderSVG}` : '',
            captionSVG ? `      ${captionSVG}` : '',
            `    </g>`,
        ].filter(l => l !== '').join('\n');

        return { def: clipDef, html };
    }

    /** Override in subclasses to render the container's own content as an SVG string. */
    async _toSVGContent(_ctx: PageSVGContext, _wMm: number, _hMm: number): Promise<string>
    {
        return '';
    }

    /** Output raw Container data */
    // NOTE: We use toData from the subclasses of Container (they use this function)
    _toContainerData():ContainerData
    {

        const c = {
            _entity: 'container',
            name: this.name,
            parent: this._parent?.name,
            type: this._type,
            width: this._width, // relative to page-content-area or page
            widthRelativeTo: this._widthRelativeTo,
            widthAbs: this._calculateAbsWidth(),
            height: this._height, // relative to page-content-area or page
            heightRelativeTo: this._heightRelativeTo,
            heightAbs: this._calculateAbsHeight(), // in doc units
            position: this._position,
            pivot: this._pivot,
            border: this._border,
            borderStyle: this._borderStyle,
            frame: this._frame,
            index: this._index,
            contentAlign: this._contentAlign || this.CONTENT_ALIGN_DEFAULT,
            content: null,
            scale: this._scale ?? 'fit',
            zoom: this._zoom ?? 1,
            docUnits: this._page._units, // needed to scale the content
            modelUnits: this._page?._docs?._archiyou?.modeler?.units(), // needed to scale the content
            caption: this._caption,
            title: this._title,
        }

        return c;
    }

  

    //// UTILS ////

    _containerHAlignmentToPositionRel(ax:ContainerHAlignment):number
    {
        if(!isContainerHAlignment(ax)){ throw new Error(`DocPageContainer::_containerHAlignmentToPositionRel: Please supply a valid ContainerHAlignment ['left','right','center']`) }
        const ALIGNMENT_TO_WPERC = { 'center' : 0.5, 'left' : 0.0, 'right' : 1.0 }
        return ALIGNMENT_TO_WPERC[ax] ?? 0.5;
    }

    _containerVAlignmentToPositionRel(ay:ContainerVAlignment):number
    {
        if(!isContainerVAlignment(ay)){ throw new Error(`DocPageContainer::_containerHAlignmentToPositionRel: Please supply a valid ContainerHAlignment ['left','right','center']`) }
        const ALIGNMENT_TO_VPERC = { 'top' : 1.0, 'center' : 0.5, 'bottom' : 0.0 }
        return ALIGNMENT_TO_VPERC[ay] ?? 0.5;
    }

    _containerAlignmentToPosition(a:ContainerAlignment):ContainerPositionRel
    {
        if(!isContainerAlignment(a)){ throw new Error(`DocPageContainer::_containerAlignmentToPosition: Please supply a valid ContainerAlignment like ['left','center']`) }

        return [
                    this._containerHAlignmentToPositionRel(a[0]), 
                    this._containerVAlignmentToPositionRel(a[1])
                ] 
    }

}
