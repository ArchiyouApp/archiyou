import { Docs } from './Docs'
import { Document } from './Document'
import { View } from './View'
import type { PageSide, WidthHeightInput, PageData, DocUnits, PageSize, PageOrientation, AnyPageContainer, ValueWithUnitsString, PageSVGContext } from './types'
import { isPageSize, isAnyPageContainer } from './typeguards'
import { convertValueFromToUnit, escapeXml } from './utils'
 

//// PAGE CLASS ////

export class Page 
{
    //// SETTINGS ////
    DEFAULT_PADDING:WidthHeightInput = '1cm';
    DEFAULT_SIZE:PageSize = 'A4';
    PAGE_ISO_SIZE_TO_WIDTH_HEIGHT_MM = { // landscape
        A0: { w : 1189, h:841 },
        A1: { w : 841, h:594  },
        A2: { w : 594, h:420  },
        A3: { w : 420, h:297  },
        A4: { w : 297, h:210  },
        A5: { w : 210, h:148  },
        A6: { w : 148 , h:105  },
        A7: { w : 105, h:74  },
    }
    

    //// END SETTINGS ////

    name:string;
    _docs:Docs; // main Docs module
    _doc:Document; // doc instance to which this page belongs
    _units:DocUnits; // taken from _docs module and _doc
    _size:PageSize; // ISO page size (A0-A7)
    _width:number; // in doc units (mm,cm,inch)
    _height:number;
    _orientation:PageOrientation = 'landscape';
    _padding:Array<number>; // relative to [width,height]
    _containers:Array<AnyPageContainer> = [];
    _variables: {[key:string]:any} = {}; // template variables

    constructor(doc:Docs, DocDocumentName:Document, name:string)
    {
        this.name = name;
        this._docs = doc;
        this._doc = DocDocumentName;
        this.setDefaultsFromDoc();
        this.setDefaults();
    }

    /** Inherit settings from Document and Doc parents */
    setDefaultsFromDoc()
    {
        /** Set defaults from Document */
        this._units = this._doc._units || this._docs.DOC_UNITS_DEFAULT;
        this._orientation = this._doc._pageOrientation || this._docs.PAGE_ORIENTATION_DEFAULT;
        this.size(this._doc._pageSize || this._docs.PAGE_SIZE_DEFAULT);
    }

    setDefaults()
    {
        this.padding(this.DEFAULT_PADDING);
    }

    size(size:PageSize)
    {
        if(!isPageSize(size)){ throw new Error(`Doc::pageSize: Invalid ISO page size. Use: A0-A7`);}
        this._size = size;
        this._sizeToWidthHeight(this._size); // set width and height in Document units
    }

    /** Set width of Page in Document units */
    width(n:WidthHeightInput):Page
    {
        if (typeof n === 'number')
        {
            this._width = n;
            return this;
        }
        else if(typeof n === 'string')
        {
            const m = n.match(/[\d\.]+/); // strip all units etc.
            if (m && m[0])
            {
                this._width = parseFloat(m[0]);
                return this;
            }
        }
        throw new Error(`Page::width(): Invalid value for width: "${n}". Supply a number (in Document units)`)
    }

    /** Set height of Page in Document units */
    height(n:WidthHeightInput):Page
    {
        if (typeof n === 'number')
        {
             this._height = n;
             return this;
        }
        else if(typeof n === 'string')
        {
            const m = n.match(/[\d\.]+/); // strip all units etc. We don't care for now. TODO: make more robust
            if (m && m[0])
            {
                this._width = parseFloat(m[0]);
                return this;
            }
        }
        throw new Error(`Page::width(): Invalid value for width: "${n}". Supply a number (in Document units)`)
    }

    orientation():Page
    {
        // TODO
        return this;
    }

    /** Set padding width (left and right) and height (top and bottom) 
     *  Use relative width/height ([0-1]), number with percentage (5%) or number with real units ('1cm','0.5"')
    */
    padding(w:WidthHeightInput, h?:WidthHeightInput):Page
    {
        // only resolved size needed, padding is always relative to page
        const paddingX = this._doc._resolveWidthHeightInput(w, this, 'width')[0];
        const paddingY = this._doc._resolveWidthHeightInput((h || w), this, 'height')[0];

        if( (paddingX > 0.5 || paddingX < 0) || (paddingY > 0.5 || paddingY < 0))
        {
            throw new Error(`Page::padding(): Cannot make padding bigger than 0.5 or less then zero!. Check values!`);
        }

        // NOTE: padding percentage is relative to WIDTH
        this._padding = [paddingX, paddingY];
        return this;
    }

    /** Add AnyPageContainer to page */
    add(container:AnyPageContainer)
    {
        if(!isAnyPageContainer){  throw new Error(`Page::add: Invalid container!`);}
        if(this._containerExists(container.name)){  throw new Error(`Page::add: Container with name "${container.name}" already exists!`);}
        
        if(!this._containers.includes(container))
        { 
            this._containers.push(container) 
        };
    }

    //// UTILS ////

    // Alias forwarding to Document._resolveValueWithUnitsStringToRel
    /** Transform numeric value with units to relative position to page width or height */
    _resolveValueWithUnitsStringToRel(s:ValueWithUnitsString, side:PageSide):number
    {
        return this?._doc._resolveValueWithUnitsStringToRel(s,this,side);
    }


    //// OUTPUTS ////

    async toSVG(yOffset: number, nextClipId: () => string, cache?: Record<string, any>, shadow?: boolean): Promise<{layer: string, defs: string}>
    {
        const fmt        = (n: number) => +n.toFixed(4);
        const pageWidthMm  = convertValueFromToUnit(this._width,  this._units, 'mm');
        const pageHeightMm = convertValueFromToUnit(this._height, this._units, 'mm');
        const hPaddingMm   = (this._padding[0] ?? 0) * pageWidthMm;
        const vPaddingMm   = (this._padding[1] ?? 0) * pageHeightMm;

        const ctx: PageSVGContext = { pageWidthMm, pageHeightMm, hPaddingMm, vPaddingMm, nextClipId, cache };

        const defs:     string[] = [];
        const contents: string[] = [];

        for (const container of this._containers)
        {
            const { def, html } = await container.toSVG(ctx);
            if (def)  { defs.push(def); }
            if (html) { contents.push(html); }
        }

        const defsBlock = defs.length
            ? `  <defs>\n${defs.map(d => '    ' + d).join('\n')}\n  </defs>`
            : '';

        const wMm       = fmt(pageWidthMm);
        const hMm       = fmt(pageHeightMm);
        const transform = yOffset > 0 ? ` transform="translate(0,${fmt(yOffset)})"` : '';
        const pageIndex = this._doc._pages.indexOf(this);

        const layer = [
            `  <g id="layer${pageIndex + 1}"`,
            `     inkscape:label="${escapeXml(this.name)}"`,
            `     inkscape:groupmode="layer"${transform}>`,
            `    <rect x="0" y="0" width="${wMm}" height="${hMm}" fill="white" stroke="none"${shadow ? ' filter="url(#page-shadow)"' : ''}/>`,
            defsBlock,
            ...contents,
            `  </g>`,
        ].filter(l => l !== '').join('\n');

        return { layer, defs: defs.join('\n') };
    }

    async toData(cache?:Record<string,any>|undefined):Promise<PageData>
    {
        // async load (some) containers
        const containersData = [];
        for(let i = 0; i < this._containers.length; i++)
        {
            const containerData = await (this._containers[i].toData(cache));
            if(containerData)
            { 
                containersData.push(containerData);
            }
            else 
            { 
                console.warn(`Page::toData(): Container "${this._containers[i].name}" has no data!`);
            }
        }

        return {
            _entity: 'page',
            name: this.name,
            size: this._size,
            width: this._width,
            height: this._height,
            orientation: this._orientation,
            padding: this._padding,
            containers: containersData,
            docUnits: this._units // taken from doc, used in rendering
        } as PageData;
    }

    //// COMPONENTS ////

    resolveScopeReferences():this
    {
        this._containers.forEach( c => 
        {
            if((c as any)?.resolveScopeReferences) // check if method exists
            {
                (c as View).resolveScopeReferences(); // make sure all shapes are resolved to SVG
            }
        });
        return this;
    }

    //// UTILS

    _containerExists(name:string):boolean
    {
        return this._containers.some( c => c.name === name);
    }

    /** Transform given ISO page size (A0-A7) to units in Document units */
    _sizeToWidthHeight(size:PageSize)
    {
        let pageWidth = this.PAGE_ISO_SIZE_TO_WIDTH_HEIGHT_MM[size].w;
        let pageHeight = this.PAGE_ISO_SIZE_TO_WIDTH_HEIGHT_MM[size].h;

        // Convert to units in Document
        if(this._units === 'cm')
        { 
            pageWidth /= 10;
            pageHeight /= 10;
        }
        else if(this._units === 'inch')
        {
            pageWidth = convertValueFromToUnit(pageWidth, 'mm', 'inch');
            pageHeight = convertValueFromToUnit(pageHeight, 'mm', 'inch');
        }

        this.width(pageWidth);
        this.height(pageHeight);
    }   
}
