import { Container } from './Container'
import type { ContainerData, ContainerContent, PageSVGContext } from './types'
import { ShapeCollection } from '@archiyou/meshup'
import { isKernelShapeOrCollection, kernelShapeToSVG } from '../modeler/typeguards'
import type { AnyShapeOrCollection } from '../modeler/types'
import { stripOuterSVGTags, getPreserveAspectRatio, convertValueFromToUnit } from './utils'
import { collectAnnotations, annotationMarginMm } from '../annotator/annotationLayer'
import { drawableLayer, renderDrawingFromLayer } from '../modeler/svgLayers'
import type { SVGLayer } from '../modeler/SVGExporter'
import { resolveScale, scaleLabel, type ResolvedScale } from './scale'
import { buildViewFurniture, type Furniture } from './viewFurniture'
import type { ViewOptions, CaptionOptions, BarOptions } from './types'

export class View extends Container
{
    _shapes:ShapeCollection|string; // either a real reference to a ShapeCollection or the name of it that is suppose to be available after running the Doc pipeline
    _resolvedShapesSVG:string; // cached resolved SVG string
    /** The Shapes the SVG above was drawn from, once resolved. A name is looked up in the
     *  pipeline scope, which is gone by the time a component's doc is rendered — so a
     *  re-render (see _resolveShapesToSVGForPage) works from this reference, not the name. */
    _resolvedShapes:ShapeCollection|null = null;
    /** The line-work of this view, drawn once. Re-framing for a page (a different size, a
     *  different scale) re-uses it rather than serializing the drawing again. */
    _resolvedLayer:SVGLayer|null = null;
    /** The scale this view was last drawn at — see _resolveScale(). */
    _resolvedScale:ResolvedScale|null = null;
    /** In-band caption and scale bar — see setOptions(). Both opt-in: a scale on its own
     *  draws nothing, so setting one never changes what an existing drawing looks like.
     *  NOTE: distinct from Container._caption, which is drawn BELOW the container's frame. */
    _viewCaption:boolean|string|CaptionOptions|null = null;
    _viewBar:boolean|BarOptions|null = null;
    /** What to do when a requested scale does not fit — see ViewOptions.overflow. */
    _overflow:'clip'|'fit' = 'clip';
    /** Line weight on the page in mm. Default DRAWING_LINE_WIDTH_MM. */
    _lineWeightMm:number|undefined = undefined;
    _style:any; // general style (TODO)
    _styles:{[key:string]:any}; // style overrides (TODO)
    _dimension:any; // TODO
    _forceAll:boolean = false;

    constructor()
    {
        super(); // no name needed?
        this._type = 'view';
    }

    //// OUTPUT ////

    async toData():Promise<ContainerData> // TODO
    {
        return {
            ...this._toContainerData(),
            content: { 
                data: this._resolveShapesToSVGForPage(...this._sizeMm()), 
                settings: {} 
            } as ContainerContent,
            // What the drawing is ACTUALLY at, as opposed to what was asked for (`scale`).
            // Resolved by the render just above, so the two can never disagree.
            resolvedScale: this._resolvedScale
                ? {
                    ratio: this._resolvedScale.ratio,
                    label: this._resolvedScale.label,
                    unitsPerMm: this._resolvedScale.unitsPerMm,
                    fitted: this._resolvedScale.fitted,
                    fits: this._resolvedScale.fits,
                  }
                : null,
        }
    }

    /** This view's size on the page in millimeters ([0,0] when it is not on a page yet). */
    _sizeMm():[number, number]
    {
        if(!this._page){ return [0, 0] }
        const units = this._page._units;
        // through _autoSizeMm, or toData() would report a different size than was drawn
        return this._autoSizeMm(
            convertValueFromToUnit(this._calculateAbsWidth(), units, 'mm'),
            convertValueFromToUnit(this._calculateAbsHeight(), units, 'mm'),
        );
    }

    /** The drawing, as the kernel draws it — no page in particular. Cached: the page-sized
     *  render (see below) re-draws only the annotations on top of this. */
    resolveShapesToSVG():string
    {
        if(this._resolvedShapesSVG)
        {
            console.info(`DocPageContainerView::resolveShapesToSVG(): Got svg from cache!`);
            return this._resolvedShapesSVG
        }

        const resolved = this._resolvedShapes ?? (isKernelShapeOrCollection(this._shapes) ? this._shapes as ShapeCollection : null);

        // NOTE: remember what we drew. The page-sized re-render reads the annotations off
        // these Shapes — without this a view handed a Shape reference directly (rather than
        // the name of a pipeline variable) re-drew an EMPTY annotation block, and every
        // dimension vanished from the page.
        if(resolved){ this._resolvedShapes = resolved as ShapeCollection; }

        const svg = (resolved)
                        ? kernelShapeToSVG(resolved)
                        :  this.resolveShapeNameToSVG(this._shapes as string)

        this._resolvedShapesSVG = svg; // set to avoid double use

        return this._resolvedShapesSVG;
    }

    /** This view's line-work, drawn once. See renderDrawingFromLayer(). */
    _drawingLayer():SVGLayer|null
    {
        if(this._resolvedLayer){ return this._resolvedLayer }

        this.resolveShapesToSVG(); // resolves a name reference and sets _resolvedShapes
        if(!this._resolvedShapes){ return null }

        this._resolvedLayer = drawableLayer(this._resolvedShapes, { all: this._forceAll });
        return this._resolvedLayer;
    }

    /** Everything the drawing spans, in SVG coordinates: the line-work and the dimensions
     *  hanging off it (which sit outside the geometry by design). Null when there is nothing
     *  to draw. */
    _drawingBox():{ minX:number, minY:number, maxX:number, maxY:number }|null
    {
        const geometry = this._drawingLayer();
        if(!geometry?.box){ return null }

        return collectAnnotations(this._resolvedShapes).reduce((b:any, a:any) =>
        {
            const bb = a?.toShape?.()?.bbox?.();
            const min = bb?.min?.(); const max = bb?.max?.();
            if(typeof min?.x !== 'number' || typeof max?.x !== 'number'){ return b }
            // SVG's y axis points down: model y [min,max] is svg y [-max,-min]
            return {
                minX: Math.min(b.minX, min.x), minY: Math.min(b.minY, -max.y),
                maxX: Math.max(b.maxX, max.x), maxY: Math.max(b.maxY, -min.y),
            };
        }, { ...geometry.box });
    }

    /** The scale this view is drawn at, for a `wMm` x `hMm` box on the page.
     *
     *  Also cached on the instance: Container.toSVG() draws the frame and its caption without
     *  a return channel from _toSVGContent(), and toData() has to report the same number the
     *  renderer used. Two derivations of one scale is exactly how they drift apart.
     */
    _resolveScale(wMm:number, hMm:number):ResolvedScale|null
    {
        const box = this._drawingBox();
        if(!box){ return null }

        const extents = { width: box.maxX - box.minX, height: box.maxY - box.minY };
        if(!(extents.width > 0) || !(extents.height > 0)){ return null }

        const archiyou = this._page?._docs?._archiyou as any;
        const hasAnnotations = collectAnnotations(this._resolvedShapes).length > 0;

        const resolved = resolveScale({
            extents,
            wMm, hMm,
            // Room for the value text at the middle of a dimension line
            marginMm: hasAnnotations ? annotationMarginMm(archiyou?.annotator) : 0,
            modelUnits: archiyou?.modeler?.units?.(),
            unitSystem: archiyou?.modeler?.unitSystem?.(),
            input: this._scale,
            name: this.name,
        });

        /*  A requested scale that does not fit is honoured and clipped by default — the
            script said 1:100 and a drawing set says what it says. `overflow:'fit'` opts out
            for anyone who would rather see the whole drawing than the right scale. */
        if(!resolved.fits && this._overflow === 'fit')
        {
            console.warn(`View::_resolveScale(): view "${this.name}" asked for ${resolved.label}, which does not `
                + `fit — falling back to fitting the drawing (overflow:'fit').`);
            this._resolvedScale = resolveScale({
                extents, wMm, hMm,
                marginMm: hasAnnotations ? annotationMarginMm(archiyou?.annotator) : 0,
                modelUnits: archiyou?.modeler?.units?.(),
                unitSystem: archiyou?.modeler?.unitSystem?.(),
                input: 'fit',
                name: this.name,
            });
            return this._resolvedScale;
        }

        // Zoom sits on top of the scale: 2 means twice as big as the scale says.
        const zoom = (typeof this._zoom === 'number' && this._zoom > 0) ? this._zoom : 1;
        this._resolvedScale = (zoom === 1)
            ? resolved
            : { ...resolved, ratio: resolved.ratio * zoom, unitsPerMm: resolved.unitsPerMm / zoom,
                label: scaleLabel(resolved.ratio * zoom, archiyou?.modeler?.unitSystem?.()),
                fitted: false };

        return this._resolvedScale;
    }

    /** The drawing, drawn for a view of `wMm` x `hMm` on the page.
     *
     *  The line-work is drawn once and re-used; only the annotations are drawn again, because
     *  they are sized in page millimeters and so depend on the scale. Re-assembling is a
     *  string join and a new header, which is what keeps a page of views at page speed.
     */
    _resolveShapesToSVGForPage(wMm:number, hMm:number):string
    {
        const geometry = this._drawingLayer();
        if(!geometry?.box || !(wMm > 0) || !(hMm > 0)){ return this.resolveShapesToSVG() }

        const scale = this._resolveScale(wMm, hMm);
        if(!scale){ return this.resolveShapesToSVG() }

        /*  A fitted drawing is framed by its own extents and shown with preserveAspectRatio,
            exactly as before. A drawing at a REQUESTED scale is framed by the view instead:
            the viewBox spans the page area it was given, in model units, so the drawing comes
            out at that scale and whatever falls outside the frame is simply outside it. */
        const svg = renderDrawingFromLayer(geometry, this._resolvedShapes, {
                        unitsPerMm: scale.unitsPerMm,
                        lineWidthMm: this._lineWeightMm,
                        all: this._forceAll,
                        scoped: this._svgScope(),
                        frame: scale.fitted
                                ? undefined
                                : { mode: 'scale', unitsPerMm: scale.unitsPerMm, wMm, hMm,
                                    align: this._contentAlign ?? this.CONTENT_ALIGN_DEFAULT },
                    });

        return svg ?? this.resolveShapesToSVG();
    }

    /** What this view needs on the page, where it was told to size itself to its content.
     *
     *  At a REQUESTED scale this is exact arithmetic: the drawing spans so many model units,
     *  the scale says how many of those go in a millimeter, and the annotations and any
     *  caption band add their room on top. At 'fit' there is no such size — a fitted drawing
     *  takes whatever it is given — so an auto side is derived from the other one through the
     *  drawing's aspect ratio, which makes the drawing fill the view exactly. With BOTH sides
     *  auto and no scale to go on there is nothing to compute, and the view keeps its size.
     */
    _autoSizeMm(wMm:number, hMm:number):[number, number]
    {
        if(!this._widthAuto && !this._heightAuto){ return [wMm, hMm] }

        const box = this._drawingBox();
        if(!box){ return [wMm, hMm] }

        const extentW = box.maxX - box.minX;
        const extentH = box.maxY - box.minY;
        if(!(extentW > 0) || !(extentH > 0)){ return [wMm, hMm] }

        const archiyou = this._page?._docs?._archiyou as any;
        const marginMm = collectAnnotations(this._resolvedShapes).length
                            ? annotationMarginMm(archiyou?.annotator) : 0;
        const bandMm = this._buildFurniture(wMm, hMm).bandMm;

        // A fixed ratio is a statement about real size, so the millimeters follow from it
        // whatever room the page offered.
        const scale = this._resolveScale(wMm, hMm);
        if(scale && !scale.fitted && scale.unitsPerMm > 0)
        {
            return [
                this._widthAuto  ? extentW / scale.unitsPerMm + 2*marginMm : wMm,
                this._heightAuto ? extentH / scale.unitsPerMm + 2*marginMm + bandMm : hMm,
            ];
        }

        // Fitted: no size of its own, but one side plus the drawing's shape gives the other.
        if(this._widthAuto && this._heightAuto)
        {
            console.warn(`View::width|height('auto'): view "${this.name}" has no scale to size itself by, `
                + `and both sides are 'auto'. Give it a scale, or a width or height to fit into. `
                + `Kept ${+wMm.toFixed(1)}x${+hMm.toFixed(1)}mm.`);
            return [wMm, hMm];
        }

        const aspect = extentW / extentH;
        return this._widthAuto
                ? [(hMm - bandMm - 2*marginMm) * aspect + 2*marginMm, hMm]
                : [wMm, (wMm - 2*marginMm) / aspect + 2*marginMm + bandMm];
    }

    /** Where the drawing's geometry lands across the view, in page millimeters.
     *
     *  The drawing is a nested <svg> with a model-space viewBox, fitted by
     *  preserveAspectRatio — so the shapes fill neither the viewBox (a scaled view frames the
     *  whole container) nor the container (a fitted view letterboxes on one axis). Both steps
     *  are undone here, from the viewBox the renderer actually emitted rather than by
     *  re-deriving the framing.
     */
    _drawingExtentMm(drawingSVG:string, wMm:number, hMm:number):{ min:number, max:number }|undefined
    {
        const box = this._drawingBox();
        const vb = drawingSVG.match(/viewBox="([^"]+)"/)?.[1].split(/[\s,]+/).map(Number);
        if(!box || !vb || vb.length < 4 || !(vb[2] > 0) || !(vb[3] > 0)){ return undefined }

        // preserveAspectRatio 'meet': the smaller scale wins, and the slack is distributed
        // by the alignment (xMin / xMid / xMax).
        const scale = Math.min(wMm / vb[2], hMm / vb[3]);
        const drawnWMm = vb[2] * scale;

        /*  Read the slack from the SAME preserveAspectRatio the drawing was emitted with,
            rather than from _contentAlign: with no alignment set those two disagree
            (getPreserveAspectRatio defaults to xMidYMid, the container's own default is
            left/top), and a fitted view — the only kind that letterboxes — would be measured
            against the wrong edge. */
        const par = getPreserveAspectRatio(this._contentAlign);
        const slack = par.startsWith('xMid') ? (wMm - drawnWMm)/2
                    : par.startsWith('xMax') ? (wMm - drawnWMm)
                    : 0;

        return {
            min: slack + (box.minX - vb[0]) * scale,
            max: slack + (box.maxX - vb[0]) * scale,
        };
    }

    /** A CSS class unique to this view on its page.
     *
     *  A page holds several drawings and their stylesheets all end up in ONE document — the
     *  view's outer <svg> is stripped when it is placed (see _toSVGContent). An unscoped
     *  `.line{stroke-width:…}` from one view therefore restyled every other drawing on the
     *  page, last one winning, in the browser and in svg2pdf alike. */
    _svgScope():string
    {
        const slug = (s:string) => (s ?? '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `ay-${slug(this._page?.name) || 'page'}-${slug(this.name) || 'view'}`;
    }

    resolveShapeNameToSVG(shapesRef:string):string
    {
        if(typeof shapesRef !== 'string')
        {
            throw new Error(`View::resolveShapeNameToSVG(): Given shapes reference is not a string (got ${typeof shapesRef}). Pass either a ShapeCollection or the name (string) of a variable returned from the pipeline.`)
        }

        const archiyou = this._page?._docs?._archiyou as any;
        if(!archiyou)
        {
            console.warn(`View::resolveShapeNameToSVG(): No archiyou modules wired into Doc — cannot resolve shapes reference "${shapesRef}". Was the Doc constructed via the Runner?`);
            return null;
        }

        // Primary path: same scope the pipeline writes to (Doc.executePipelines uses
        // runner.getActiveScope()). Fall back to legacy worker locations.
        const workerScope = archiyou?.runner?.getActiveScope?.()
                            ?? archiyou?.scope
                            ?? archiyou?.worker?.self
                            ?? archiyou?.worker;

        if (!workerScope)
        {
            console.warn(`View::resolveShapeNameToSVG(): Could not determine execution scope for view "${this.name}" — looked at archiyou.runner.getActiveScope(), archiyou.scope, archiyou.worker.self, archiyou.worker. Shapes reference "${shapesRef}" cannot be resolved.`);
            return null;
        }

        if(!(shapesRef in workerScope))
        {
            const scopeKeys = Object.keys(workerScope).filter(k => !k.startsWith('_')).slice(0, 40);
            throw new Error(`View::resolveShapeNameToSVG(): Variable "${shapesRef}" was not found in the execution scope for view "${this.name}". Make sure your pipeline function returns it, e.g. \`pipeline(() => { ${shapesRef} = ...; return { ${shapesRef} } })\`. Available top-level scope keys: ${scopeKeys.join(', ') || '(none)'}.`);
        }

        const realShapes = workerScope[shapesRef];

        if(realShapes === undefined || realShapes === null)
        {
            throw new Error(`View::resolveShapeNameToSVG(): Variable "${shapesRef}" resolved to ${realShapes} for view "${this.name}". The pipeline function returned it but the value is empty.`);
        }

        if(!isKernelShapeOrCollection(realShapes))
        {
            const got = (realShapes as any)?.constructor?.name || typeof realShapes;
            throw new Error(`View::resolveShapeNameToSVG(): Variable "${shapesRef}" for view "${this.name}" is not a Shape or ShapeCollection (got ${got}). Return a Shape/ShapeCollection from your pipeline, e.g. \`${shapesRef} = myMainBox.iso()\`.`);
        }

        this._resolvedShapes = realShapes as ShapeCollection; // so a re-render needs no scope
        return kernelShapeToSVG(realShapes);
    }

    /** Caption this view — inside its frame, in the band at the bottom.
     *
     *  With no argument the view says what it is: its name, and the scale it came out at
     *  ("elevation — 1:20"). A fitted view leaves the scale off, having none worth printing.
     *  Pass a string for the text, or the options object for the rest (format, alignment,
     *  size, colour, whether to append the scale).
     *
     *  This is NOT Container.caption(), which writes below the frame and claims no room. A
     *  drawing's caption belongs to the drawing: it sits inside the view's own box, in space
     *  reserved for it, so it can neither collide with a neighbour nor overlap the geometry.
     *  `caption(false)` removes it.
     */
    caption(value?:string|boolean|CaptionOptions):this
    {
        this._viewCaption = (value === undefined) ? true : (value as any);
        return this;
    }

    /** Apply the options object of `view('elevation', { scale: 1/100, caption: true })`. */
    setOptions(options?:ViewOptions):this
    {
        if(!options || typeof options !== 'object'){ return this }

        if(options.scale !== undefined){ this.scale(options.scale) }
        if(options.zoom !== undefined){ this.zoom(options.zoom) }
        if(options.caption !== undefined){ this._viewCaption = options.caption }
        if(options.bar !== undefined){ this._viewBar = options.bar }
        if(options.lineWeight !== undefined){ this._lineWeightMm = options.lineWeight }
        if(options.overflow !== undefined){ this._overflow = options.overflow }

        return this;
    }

    /** Bind ShapeCollection to View */
    shapes(shapes:AnyShapeOrCollection|string, all:boolean=false)
    {
        this._forceAll = all;
        // a reference to a ShapeCollection from main script
        if (isKernelShapeOrCollection(shapes))
        {
            // Keep the shape/collection as the kernel made it — only that kernel can draw it.
            this._shapes = shapes as ShapeCollection;
        }
        else if(typeof shapes === 'string')
        {
            this._shapes = shapes as string;
        }
        else {
            throw new Error('DocPageContainer:shapes(): Please supply either a reference to ShapeCollection or the name of one that will be available after running the pipeline!');
        }
    }

    //// OUTPUT: SVG ////

    async _toSVGContent(_ctx: PageSVGContext, wMm: number, hMm: number): Promise<string>
    {
        const fmt = (n: number) => +n.toFixed(4);

        /*  Furniture (a caption, a scale bar) is drawn in a band at the BOTTOM of the view,
            and the drawing gets what is left. Reserving the room before the drawing is scaled
            is the whole point: shrinking the drawing afterwards would leave it running under
            its own caption, since preserveAspectRatio still fits into the full height.

            Two passes, because the two depend on each other in one direction only: the band's
            height needs the scale (a bar is a round MODEL length, drawn at the view's scale),
            and the scale needs the height. So: resolve against the full view to size the band,
            then resolve for real against what is left. */
        const furniture = this._buildFurniture(wMm, hMm);
        const drawingHMm = hMm - furniture.bandMm;

        if(!(drawingHMm > 0))
        {
            console.warn(`View::_toSVGContent(): view "${this.name}" (${fmt(hMm)}mm tall) has no room left `
                + `for the drawing after its caption and scale bar (${fmt(furniture.bandMm)}mm). Drew it without them.`);
            return this._drawingSVG(wMm, hMm);
        }

        const drawing = this._drawingSVG(wMm, drawingHMm);
        if(!drawing){ return '' }

        // No furniture: emit exactly what a view has always emitted, a single <svg>.
        if(!furniture.svg){ return drawing }

        /*  Re-lay the furniture now that the drawing has been framed, so it can align to
            where the geometry ACTUALLY sits rather than to the container. Only the x
            positions change — the band's height does not depend on them — so the box
            measured above still holds. */
        const placed = this._buildFurniture(wMm, hMm, this._drawingExtentMm(drawing, wMm, drawingHMm));

        /*  Nested: the outer <svg> is the view's own box in page millimeters — the space the
            furniture is laid out in — and the inner one is the drawing. A nested <svg> clips
            to its own bounds in browsers and in svg2pdf alike, which is also what keeps a
            drawing at a scale too large for its view inside the frame. */
        return `<svg x="0" y="0" width="${fmt(wMm)}" height="${fmt(hMm)}" viewBox="0 0 ${fmt(wMm)} ${fmt(hMm)}">`
            + drawing
            + (placed.svg || furniture.svg)
            + `</svg>`;
    }

    /** The drawing itself, framed for a `wMm` x `hMm` box (no furniture). */
    _drawingSVG(wMm:number, hMm:number):string
    {
        const svgData = this._resolveShapesToSVGForPage(wMm, hMm);
        if (!svgData || typeof svgData !== 'string')
        {
            console.warn(`View::_toSVGContent(): No SVG data in view "${this.name}". Skipped.`);
            return '';
        }

        const fmt = (n: number) => +n.toFixed(4);
        const viewBoxMatch = svgData.match(/viewBox\s*=\s*["']([^"']+)["']/);
        const viewBox      = viewBoxMatch ? viewBoxMatch[1] : '';
        const innerContent = stripOuterSVGTags(svgData);
        const par          = getPreserveAspectRatio(this._contentAlign);
        const vbAttr       = viewBox ? ` viewBox="${viewBox}"` : '';

        return `<svg x="0" y="0" width="${fmt(wMm)}" height="${fmt(hMm)}"${vbAttr} preserveAspectRatio="${par}">${innerContent}</svg>`;
    }

    /** This view's caption and scale bar, and the room they need. */
    _buildFurniture(wMm:number, hMm:number, drawingXMm?:{ min:number, max:number }):Furniture
    {
        if(!this._viewCaption && !this._viewBar){ return { bandMm: 0, svg: '' } }

        const archiyou = this._page?._docs?._archiyou as any;

        return buildViewFurniture({
            wMm, hMm,
            drawingXMm,
            // Sized against the full view for now; _toSVGContent resolves the real scale
            // against what is left once this band is taken off.
            scale: this._resolveScale(wMm, hMm),
            name: this.name,
            caption: this._viewCaption ?? undefined,
            bar: this._viewBar ?? undefined,
            modelUnits: archiyou?.modeler?.units?.(),
            unitSystem: archiyou?.modeler?.unitSystem?.(),
            hasRequestedScale: this._scale !== undefined && this._scale !== 'fit',
        });
    }

    //// UTIL ////

    /** Used to remove DocDocument instances from execution scope
     *  Used in components
     */
    resolveScopeReferences():this
    {
        this.resolveShapesToSVG(); // also sets _resolvedShapes, which the page render needs

        /*  Drop the reference into the execution scope — a component's doc travels without
            it. NOTE: `_shapes`, not `shapes`: assigning `this.shapes` shadowed the METHOD of
            that name on the instance, so the scope reference stayed alive in `_shapes` and a
            later `view.shapes(...)` threw "not a function". */
        this._shapes = null;
        return this;
    }


}
