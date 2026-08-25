/**
 *  Annotator.ts
 *      Make different annotations on the model like dimensions, labels etc.
 *      Their main purpose is offering information on top of the model - and are not part of the Shapes 
 *      Only on output they might be turned into real Shapes like text Faces etc.
 */ 

import type { ArchiyouModules } from '../types';
import type { MainAxis, AnyShape, AnyShapeCollection } from '../modeler/types'
// Geometry types live in meshup, not modeler/types — the latter only re-exports
// the AnyShape* aliases. See the note in AnnotatorDimensionLine.ts: the BREP
// kernel has identically-named Point/Vector, so be explicit about the source.
// meshup's 1D shape is `Curve`; there is no `Edge`.
import type { PointLike, Point, Vector, Curve, Bbox } from '@archiyou/meshup'

import type {
    DimensionOptions,DimensionLevelSettings,DimensionLevel,
    Annotation, AnnotationData, AnnotationAutoDimStrategy, LabelOptions
} from './types'

import { BaseAnnotation } from './AnnotatorBaseAnnotation';
import { DimensionLine } from './AnnotatorDimensionLine';
import { Label } from './AnnotatorLabel';

import { validate, optional } from '../decorators'
import { PointLikeSchema } from '../modeler/schemas'

import { roundTo } from '../utils' // utils


export class Annotator
{
    //// SETTINGS ////
    DIMENSION_BOX_OFFSET_DEFAULT = 20;

    /*  On-page sizes of annotations in an exported drawing, in millimeters. A document view
        scales its drawing to fit the page, so anything sized in model units comes out at a
        different size in every view; these are converted with that view's scale, so a
        dimension reads the same on an A4 whether it measures a 50mm dowel or a 12m truss.
        Change them from a script: `annotator.DIMENSION_TEXT_SIZE_MM = 3`. */

    /** Height of the value text (mm on the page) */
    DIMENSION_TEXT_SIZE_MM = 1.5;
    /** Width of an arrowhead, tip to tip (mm on the page) */
    DIMENSION_ARROW_SIZE_MM = 1;
    /** Line weight of the dimension line and its arrows (mm on the page) */
    DIMENSION_LINE_WIDTH_MM = 0.15;
    /** Colour behind a dimension's value text, so it stays readable where the line, the
     *  geometry or another dimension runs under it. Null draws no box. */
    DIMENSION_TEXT_BACKGROUND_COLOR:string|null = 'white';
    /** Room left around a drawing for the parts of a dimension that stick out past the line
     *  itself — the value text at its middle, the arrowheads straddling its ends (mm on the
     *  page). Null derives it from the text size, which is what it has to clear. */
    DIMENSION_MARGIN_MM:number|null = null;

    /*  Proportions of a dimension's value label, as multiples of the text height — so they
        hold at any text size and any drawing scale. */

    /** A dimension line shorter than this many text heights cannot hold its own value, so
     *  the value steps aside onto a leader beside it. */
    DIMENSION_SMALL_LINE_FACTOR = 2;
    /** How far along that leader the value sits, in text heights. */
    DIMENSION_LEADER_LENGTH_FACTOR = 1.5;
    /** Width of the backing box per character of the value, in text heights. There are no
     *  font metrics where a drawing is written (a worker, or node), so the box is estimated;
     *  0.6em is a safe average advance for the sans faces documents use. */
    DIMENSION_TEXT_CHAR_WIDTH_FACTOR = 0.6;
    /** Padding of that box, in text heights. */
    DIMENSION_TEXT_PADDING_FACTOR = 0.5;
    /** Height of that box, in text heights. */
    DIMENSION_TEXT_HEIGHT_FACTOR = 1.2;

    //// END SETTINGS ////

    _archiyou:ArchiyouModules;

    name:string;
    annotations:Array<Annotation> = [];
    // labels:Array<Label> = []; // TODO

    constructor()
    {
        // TODO
    }

    setArchiyou(modules: ArchiyouModules)
    {
        this._archiyou = modules;
    }

    /** Modeler classes */
    get classes()
    {
        return this._archiyou.modeler.classes;
    }

    /** Make dimension line. Is added to list automatically */
    @validate(optional(PointLikeSchema), optional(PointLikeSchema))
    dimensionLine(start?:PointLike, end?:PointLike, options?:DimensionOptions, autoAdd:boolean=true)
    {
        const newDimension = new DimensionLine(start as Point, end as Point, options, this._archiyou);
        if(autoAdd){ this.annotations.push(newDimension);}
        return newDimension;
    }

    /** Make a Dimension Line without adding to list yet! */
    @validate(optional(PointLikeSchema), optional(PointLikeSchema))
    makeDimensionLine(start?:PointLike, end?:PointLike, options?:DimensionOptions)
    {
        return this.dimensionLine(start,end,options,false);
    }

    /** Make a Label. Is added to the annotation list automatically.
     *  Typically called with no args then chained: annotator.label().fromShape(shape, value) */
    label(position?:PointLike, value?:string, options?:LabelOptions, autoAdd:boolean=true):Label
    {
        const newLabel = new Label(position as Point, value, options).setArchiyou(this._archiyou) as Label;
        if(autoAdd){ this.annotations.push(newLabel); }
        return newLabel;
    }

    /** Make a Label without adding to the list yet! */
    makeLabel(position?:PointLike, value?:string, options?:LabelOptions):Label
    {
        return this.label(position, value, options, false);
    }

    /** Create dimension lines for the bounding box of a Shape.
     *  Kernel-agnostic: uses only Bbox.min()/max()/center() so it works for
     *  both brep and mesh bodies (no Bbox.getSidesShape() dependency).
     *  TODO: use oriented bbox too
     */
    dimensionBox(shape:AnyShape)
    {
        const Point = this.classes.Point;
        const Vector = this.classes.Vector;

        const bbox = shape.bbox();
        const pad3 = (a:Array<number|undefined>):[number,number,number] => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
        const mn = pad3(bbox.min().toArray());
        const mx = pad3(bbox.max().toArray());
        const c  = pad3(bbox.center().toArray());

        // Each side: an edge along one axis at the min/min corner, plus the axis
        // along which its dimension line is offset away from the box center.
        //   width  → X edge, offset along Y (front)
        //   depth  → Y edge, offset along X (left)
        //   height → Z edge, offset along X (left)
        const SIDES:Array<{ start:[number,number,number], end:[number,number,number], offsetAxis:0|1|2 }> = [
            { start:[mn[0],mn[1],mn[2]], end:[mx[0],mn[1],mn[2]], offsetAxis:1 },
            { start:[mn[0],mn[1],mn[2]], end:[mn[0],mx[1],mn[2]], offsetAxis:0 },
            { start:[mn[0],mn[1],mn[2]], end:[mn[0],mn[1],mx[2]], offsetAxis:0 },
        ];

        for (const side of SIDES)
        {
            // Construct empty → setArchiyou → init, so this.classes is available
            // during init() (kernel Point methods like toVector() are needed downstream)
            const dim = new DimensionLine()
                            .setArchiyou(this._archiyou)
                            .init(
                                new Point(side.start[0], side.start[1], side.start[2]),
                                new Point(side.end[0], side.end[1], side.end[2]),
                            );

            if (!dim.value || dim.value === 0) { continue; } // skip zero-length (e.g. 2D bbox axis)

            const a = side.offsetAxis;
            const mid = (side.start[a] + side.end[a]) / 2;
            let dir = mid - c[a]; // push away from the box center along the offset axis
            if (dir === 0) { dir = -1; } // degenerate (flush) → push negative

            const off:[number,number,number] = [0,0,0];
            off[a] = Math.sign(dir) * this.DIMENSION_BOX_OFFSET_DEFAULT;

            /*  Link to the Shape being dimensioned BEFORE setting the offset (link()
                recalculates the offset from the linked Shape). Without the link these
                dimensions lived only in the Annotator's global list, so nothing could find
                them from the Shape - and a drawing of a collection holding it (doc view,
                toSVG()) came out without them. */
            dim.link(shape);
            dim.setOffsetVec(new Vector(off[0], off[1], off[2]));
            this.annotations.push(dim);
        }
    }

    getAnnotations():Array<Annotation>
    {
        // TODO: make more generic
        return this.annotations
    }

    /** Remove a specific annotation (e.g. an empty placeholder created by dimensionLine()) */
    _drop(a:Annotation):this
    {
        this.annotations = this.annotations.filter(d => d !== a);
        return this;
    }
    
    getAnnotationsInBbox(bbox:Bbox, margin?:number):Array<Annotation>
    {
        const MAX_DISTANCE = 30;
        const selectionBbox = bbox.enlarged(margin ?? MAX_DISTANCE);
        return this.annotations.filter(a => selectionBbox.contains(a.toShape()));
    }

    addAnnotations(annotations:Array<Annotation>):this
    {
        if(!Array.isArray(annotations)){ return this; }
        const checkedAnnotations = annotations.filter( a => BaseAnnotation.isAnnotation(a));
        this.annotations = this.annotations.concat(checkedAnnotations as Array<DimensionLine>) as Array<DimensionLine>; // NOTE: avoid doubles with Annotator.unique()
    }

    setAnnotations(annotations:Array<Annotation>):this
    {
        if(!Array.isArray(annotations)){ return this; }
        const checkedAnnotations = annotations.filter( a => BaseAnnotation.isAnnotation(a));
        this.annotations = checkedAnnotations;
    }

    /** Get all annotations in one Array. See interfaces like DimensionLineData */
    getAnnotationsData():Array<AnnotationData> // TODO: more types
    {
        // TODO: gather all annotations in one array?
        let annotationsData = [];
        annotationsData = annotationsData.concat(this.annotations.map(d => d.toData()));

        return annotationsData;
    }

    /** Reset annotations */
    reset()
    {
        this.annotations = [];
    }

    //// GENERATE DIMENSIONS ON SHAPES ////

    //@checkInput(['ShapeOrCollection', ['DimensionOptions', null], ['AnnotationAutoDimStrategy', null]], ['ShapeCollection', 'auto','auto'])
    autoDim(shapes:AnyShapeCollection, options?:DimensionOptions|DimensionLevelSettings, strategy?:AnnotationAutoDimStrategy)
    {
        // Settings that carry `levels` name their own strategy — otherwise a 3D Shape/collection
        // handed explicit levels fell through to _getAutoDimStrategy(), which only knows how to
        // pick for flat geometry, and silently produced nothing.
        strategy = strategy
                    || (Array.isArray((options as DimensionLevelSettings)?.levels) ? 'levels' : null)
                    || this._getAutoDimStrategy(shapes);

        switch (strategy)
        {
            case 'part':
                return this.autoDimPart(shapes, options as DimensionOptions);
            case 'levels':
                return this.autoDimLevels(shapes, options as DimensionLevelSettings);
            default:
                console.error(`Annotator::autoDim(shapes,strategy): No automatic strategy found. Please supply one (like 'part' or 'levels') as argument`);
                return null;
        }
        
    }

    /** Try to determine the best auto dimensioning strategy 
     *  These strategies are now available:
     *      - Part: One clear 2D Shape (possible with holes). Dimensioning mostly focused on producing that Shape
     *      - Levels: Complex collection of Shapes. Dimensioning along levels of the collection
    */
    //@checkInput('ShapeOrCollection', 'ShapeCollection')
    _getAutoDimStrategy(shapes:AnyShapeCollection):AnnotationAutoDimStrategy
    {
        if(shapes.length === 1 && shapes.first().is2D()) // TODO: better
        {
            return 'part'
        }
        else if (shapes.bbox().is2D())
        {
            return 'levels'
        }
        else {
            console.warn(`Annotator._getAutoDimStrategy(): cannot pick a strategy for these Shapes. `+
                `'part' needs a single flat 2D Shape, 'levels' a flat collection. Supply a strategy `+
                `(and for 'levels' its { levels: [...] } settings) yourself.`)
            return null;
        }
    }

    /** Generate dimension lines for a 2D Part on XY plane slighly focused on production by cutting
     *      We take an approach of dimension line levels:
     *         1. Outset bbox of Shape: the stock dimensions
     *         2. Dimension the edges on, and parallel to the bbox outside 
     *         3. Add any dimensions of edges that are not yet done. Avoid doubles
     * 
     * @param shapes Shape or ShapeCollection to dimension
     * @returns ShapeCollection
     */
    //@checkInput(['ShapeOrCollection', ['DimensionOptions', null]], ['ShapeCollection', 'auto'])
    autoDimPart(shapes:AnyShapeCollection, options?:DimensionOptions):AnyShapeCollection
    {
        const OFFSET_PER_LEVEL = 30;
        const DIMENSION_MIN_DISTANCE = 1;
        const LEVEL_COORD_ROUND_DECIMALS = 0; // round to full units
        const LEVEL_CHECK_VERTICES_TOLERANCE = 3; // when check
        const SIDE_VERTICES_UNIQUE_TOLERANCE = 1;

        // Take some settings from optional settings
        const dimLevelOffset = options?.offset || OFFSET_PER_LEVEL;

        const dimUnits = options?.units;
        
        const part = shapes.first();
        const newAnnotations = [] as Array<Annotation>;

        // NOTE: check the bbox, not only part.is2D() — a meshup Polygon reports is2D() true by
        // definition (it is planar), even when it sits tilted in space. Part dimensioning needs
        // a part that is actually flat along an axis.
        if(!part.is2D() || !(part as any).bbox()?.is2D())
        {
            throw new Error('Annotator.autoDimPart(): Please make sure you have a 2D part on the XY plane! Use layflat() to lay a tilted part down first.');
        }

        // Level 1: stock size (bbox)
        // NOTE: dimension the bbox side edges through makeDimensionLine() rather than
        // sideEdge.dimension() — a bbox side is a throwaway Shape that carries no modeler
        // (and so no annotator) in the mesh kernel.
        const partBbox = (part as any).bbox(false) as Bbox; // brep takes a 'add to scene' flag, meshup ignores it
        [partBbox.back(), partBbox.left()].forEach(sideEdge =>
        {
            if(typeof (sideEdge as any)?.start !== 'function'){ return; } // 3D/degenerate bbox: no side edge
            const stockDim = this.makeDimensionLine(
                (sideEdge as Curve).start() as any,
                (sideEdge as Curve).end() as any,
                {
                    offset: dimLevelOffset * 3,
                    units: dimUnits,
                    offsetVec: (sideEdge as Curve).center().toVector().subtracted(partBbox.center()).normalize(),
                });
            stockDim.link(part);
            newAnnotations.push(stockDim);
        });


        // Level 2: edges on and parallel to sides of bbox
        const bboxRect = partBbox.rect(); // null when the bbox is not flat (both kernels warn)
        const bboxSideEdges = (bboxRect ? bboxRect.edges().toArray() : []) as Array<Curve>;
        // NOTE: cache the part's edges — both kernels hand out fresh Shape instances per
        // edges() call, and sideEdgesUsed.has() below matches on identity.
        const partEdges = (part as any).edges() as AnyShapeCollection;
        const sideEdgesUsed = new this.classes.ShapeCollection();

        bboxSideEdges.forEach((sideEdge,i) => 
        {
            const sideDir = sideEdge.direction().normalized().round().abs();
            const sideDir90 = sideDir.copy().rotateZ(90).abs();
            
            const sideAlongAxis = (sideDir.equals([1,0,0])) ? 'x' : (sideDir.equals([0,1,0])) ? 'y' : false;
            const sideIsOrtho = !!sideAlongAxis;
            const levelCoordAxis = (sideIsOrtho) ? (sideAlongAxis === 'x') ? 'y' : 'x' : null; // dimension level coord that stays same
            const levelCoordValue = roundTo(sideEdge.center()[levelCoordAxis],LEVEL_COORD_ROUND_DECIMALS);

            // These are the original edges on the sides of the part (this can also be only with one vertex)
            const sideEdges = partEdges
                            .intersecting(sideEdge)
                            .filter(e => {
                                return !(e as Curve).direction().normalize().abs().round().equals(sideDir90) // no perpendicular
                                    && (!e.direction().isOrtho() || (e.direction().isOrtho() && roundTo(e.center()[levelCoordAxis], LEVEL_COORD_ROUND_DECIMALS) === levelCoordValue)) // ortho edges need to be on side, other we allow
                            });

            // We keep track of those, so we don't use them twice
            sideEdgesUsed.addUnique(sideEdges);

            const sideDimOffsetVec = sideEdge.center().toVector().subtracted(part.bbox().center()).normalize();
            /*
            // Not really needed
            if (part.bbox().center().distance(sideEdge.center().copy(false).move(sideDimOffsetVec)) 
                    < part.bbox().center().distance(sideEdge.center().copy(false).move(sideDimOffsetVec.reversed())))
            {
                sideDimOffsetVec.reverse();
            }
            */
            
            // Generate dimension lines along sides
            const dimLevelVertices = (sideEdges
                    .vertices() as any)
                    .add(sideEdge.start(), sideEdge.end())
                    .unique(SIDE_VERTICES_UNIQUE_TOLERANCE) // again: tolerance to be more robust!
                     // make sure we don't include points that are not on level, with tolerance
                    .filter((v) => Math.abs(roundTo(v[levelCoordAxis],LEVEL_COORD_ROUND_DECIMALS) - levelCoordValue) < LEVEL_CHECK_VERTICES_TOLERANCE )
                    .sort((v1,v2) => {
                        // sort x,y ascending. 
                        if(sideAlongAxis === 'x')
                        {
                            // sort on x-axis
                            return v1.x - v2.x;
                        }
                        else {
                            // sort on y-axis
                            return v1.y - v2.y;
                        }
                    })
                    .toArray();

            // Only more than 2 points, otherwise the bbox is sufficient
            if(dimLevelVertices.length > 2)
            {
                dimLevelVertices.forEach((v,i,arr) => 
                {
                    if(i !== 0) // skip first
                    {
                        if(v.distance(arr[i-1]) >= DIMENSION_MIN_DISTANCE)
                        {
                            const dim = this.makeDimensionLine(
                                arr[i-1] as PointLike,
                                v as PointLike, 
                                { 
                                    offsetVec: sideDimOffsetVec, 
                                    offset: dimLevelOffset * 2, 
                                    units: dimUnits,
                                    ortho: sideAlongAxis // always orthogonal
                                });
                            dim.link(part); // link to part as main shape
                            newAnnotations.push(dim)
                        }
                    }
                })
            }
        })

        
        // Level 3 - remaining Edges by direction and length
        // NOTE: skip closed edges (a circle/ellipse). They are loops with no distinct start and
        // end, so they cannot become a single dimension line — fromEdge() would build a
        // zero-length line and throw. Their extent is already covered by the level-1 bbox dims.
        const remainingEdges = partEdges
                                .filter(e => !sideEdgesUsed.has(e) && !DimensionLine.isClosedProfile(e));
                                    //&& bboxSideEdges.every(bboxEdge => !e.intersects(bboxEdge)));

        remainingEdges.forEach((e,i) =>
        {
            const dim = this.makeDimensionLine()
                            .fromEdge(e as Curve, { offset: dimLevelOffset * 1  })
            newAnnotations.push(dim)
        });
        
        // Check all annotations one last time and make sure they are unique
        const uniqueAnnotations = this.unique(newAnnotations);
        part.addAnnotations(uniqueAnnotations);
        this.addAnnotations(uniqueAnnotations); // Add to list 
        this.removeSameAtSmallDistance(dimLevelOffset); // Also remove dimensions lines that are too close too each other

        return shapes;
    }

    /** Make (semi) automatic dimension lines through the Shapes of this collection at levels (in percentage of total size or absolute coords) along MainAxis within bbox
     *    @param options:AutoDimSettings
     *    {
     *       levels: Array< Record<MainAxis,number>
     *       minDistance: number (0-1)
     *    }
     * 
     */
    //@checkInput(['ShapeOrCollection','DimensionLevelSettings'], ['ShapeCollection', 'auto'])
    autoDimLevels(collection:AnyShapeCollection, settings?:DimensionLevelSettings):Array<DimensionLine>
    {
        const BBOX_MARGIN = 10;
        const SECTION_PLANE_DEPTH = 2;
        const DIMENSION_LINE_OFFSET_FROM_BBOX = 30;
        const DEFAULT_MIN_DISTANCE = 0;
        const ADD_BBOX_OUTLINE_TO_LEVEL_SECTION = true;

        if(!settings || !Array.isArray(settings?.levels)){ throw new Error('Annotator.autoDimLevels(options): No autoDim settings given. Please supply levels ({ axis:x|y|z, at:number }]). Level options are minDistance, coordType, and offset')}

        const collectionBbox = collection.bbox(false); // No annotations here!
        const autoDimLines = [];

        // For every level make a section shape, gather intersection points and draw dimension lines
        settings.levels.forEach((lvl,i) => 
        {
            lvl = lvl as DimensionLevel;

            const levelAxis = lvl?.axis // axis of dimension cutting line
            let levelCoord = lvl?.at; // percentage of size along levelAxis
            
            // NOTE: if coordType not given, We take it that if the level is given in 0 < coord > 1.0 it is absolute
            const levelCoordType = !lvl?.coordType && ((levelCoord < 0 || levelCoord > 1 ) ? 'absolute' : 'relative');

            if(levelCoordType === 'relative')
            {
                levelCoord = (levelCoord > 1.0) ? 1.0 : levelCoord; 
                levelCoord = (levelCoord < 0) ? 0.0 : levelCoord;
            }
            
            const bboxSize = collectionBbox.sizeAlongAxis(levelAxis);
            const rangeAxis = (['x','y','z'] as Array<MainAxis>).find((a) => a !== levelAxis && collectionBbox.axisMissingIn2D() !== a); // dimension section line along this axis

            const sectionLineDepthAxis = (['x','y','z'] as Array<MainAxis>).find(a => a !== levelAxis && a !== rangeAxis); // this axis is not really in play
            const sectionLineRangeStart = collectionBbox.min()[rangeAxis] - BBOX_MARGIN;
            const sectionLineRangeEnd = collectionBbox.max()[rangeAxis] + BBOX_MARGIN;
            const sectionLineStart = new this.classes.Point(0,0,0)['set'+rangeAxis.toUpperCase()](sectionLineRangeStart);
            const sectionLineEnd = new this.classes.Point(0,0,0)['set'+rangeAxis.toUpperCase()](sectionLineRangeEnd);
            const sectionLineLevelCoord = (levelCoordType === 'relative') 
                                                ? collectionBbox.minAtAxis(levelAxis) + levelCoord*bboxSize 
                                                : levelCoord;

            const sectionLine = this.classes.Curve.Line(sectionLineStart,sectionLineEnd) // set basic section line
                                            ['move'+levelAxis.toUpperCase()](sectionLineLevelCoord); // move line to level coord

            if(lvl?.showLine){ sectionLine.color('red').addToScene() };


            /*  If we want dimensions from the bbox too, section its outline along with the
                Shapes. Only a flat bbox has an outline — a 3D collection sectioned at levels
                (the main use of this strategy) has none. brep hands back a Face, meshup the
                outline Curve itself. */
            const bboxRect:any = (ADD_BBOX_OUTLINE_TO_LEVEL_SECTION && collectionBbox.is2D()) ? collectionBbox.rect() : null;
            const bboxOutline = (typeof bboxRect?._toWire === 'function') ? bboxRect._toWire() : bboxRect;

            // Coordinates along rangeAxis where the Shapes cross this level - the only thing
            // the dimension lines below are built from.
            let intersectionPointsAlongRangeAxis:Array<number> = [];

            if(typeof (sectionLine as any)._extruded === 'function')
            {
                // BREP: section with a real Face, given some depth to deal with accuracy issues
                const sectionPlaneNormal = new this.classes.Vector(0,0,0)['set'+sectionLineDepthAxis.toUpperCase()](1);
                const sectionPlane = sectionLine._extruded(SECTION_PLANE_DEPTH, sectionPlaneNormal)
                                        ['move'+sectionLineDepthAxis.toUpperCase()](-SECTION_PLANE_DEPTH/2);

                if(bboxOutline){ collection.add(bboxOutline); }
                const intersections = collection._intersections(sectionPlane);
                if(bboxOutline){ collection.pop(); } // remove last added bbox outline

                intersections.forEach((int) => 
                {
                    // NOTE: we can get intersections of Shapes: points, lines, planes
                    // We just check all their points
                    int.vertices().forEach(v => {
                        const coordAlongRangeAxis = v[rangeAxis];
                        if(!intersectionPointsAlongRangeAxis.includes(coordAlongRangeAxis))
                        {
                            intersectionPointsAlongRangeAxis.push(coordAlongRangeAxis)
                        }
                    })
                });
            }
            else {
                // MESH kernel: it has no section-plane extrude, but sectioning here only ever
                // serves to find where the geometry crosses the level - so read those crossings
                // off the geometry directly (see _levelCrossingCoords).
                intersectionPointsAlongRangeAxis = this._levelCrossingCoords(
                        [ ...collection.toArray(), bboxOutline ],
                        levelAxis, sectionLineLevelCoord, rangeAxis);

                bboxOutline?.removeFromScene?.(); // meshup's Bbox.rect() attaches itself to the scene
            }

            if(intersectionPointsAlongRangeAxis.length === 0)
            {
                /*  An absolute level is a WORLD coordinate: moving the drawing after picking
                    the levels (elevation(...).move(...)) leaves them behind, which is by far
                    the most common way this happens - so say where the Shapes actually are. */
                const lvlMin = roundTo(collectionBbox.minAtAxis(levelAxis), 2);
                const lvlMax = roundTo(collectionBbox.minAtAxis(levelAxis) + bboxSize, 2);
                const outside = (sectionLineLevelCoord < lvlMin) || (sectionLineLevelCoord > lvlMax);

                console.warn(`Annotator::autoDimLevels(): level "${levelAxis}=${levelCoord}" [${levelCoordType}] `
                    + `did not cut any Shapes` 
                    + (outside
                        ? `: ${levelAxis}=${roundTo(sectionLineLevelCoord,2)} is OUTSIDE the Shapes, which are at `
                          + `${levelAxis}=[${lvlMin},${lvlMax}]. An absolute level is a world coordinate - if you `
                          + `moved these Shapes (elevation().move(...)) the level did not move with them. Use a `
                          + `relative level (0-1) or set the level after moving.`
                        : `.`))
            }

            intersectionPointsAlongRangeAxis.sort((a,b) => a - b ); // min first
            
            // Now make the dimension lines at a given coord (parallel to section line) 
            // based on align ('min','max,'auto') and offset
            let dimLinesLevelCoord = sectionLineLevelCoord;

            if(lvl?.align === false)
            {
                // user diabled align by setting it to false. Default is auto align (see below)
            }
            else if ( lvl?.align === true || lvl?.align === 'auto' || (lvl?.align ?? true) === true ) // last term checks nullish
            {
                // section line on side of bbox at levelAxis that is closest to given sectionLineLevelCoord
                const minSide = collectionBbox['min'+levelAxis.toUpperCase()]();
                const maxSide = collectionBbox['max'+levelAxis.toUpperCase()]();
                dimLinesLevelCoord = Math.abs(sectionLineLevelCoord - minSide) <  Math.abs(sectionLineLevelCoord - maxSide) ? minSide : maxSide;
            }
            else if(['min','max'].includes(lvl?.align as string))
            {
                dimLinesLevelCoord = collectionBbox[lvl.align+levelAxis.toUpperCase()]() 
            }

            const minDistance = lvl?.minDistance ?? DEFAULT_MIN_DISTANCE;

            /*  Offset Vector for the dimension lines: perpendicular to the section line within
                the XY workplane, then flipped so it always points away from the collection.
                Computed from the direction rather than via Curve.normal(): that is brep
                Edge.normal()'s own definition, but meshup's Curve.normal() is the PLANE normal
                (z for a line in XY), which would push the dimension lines out of the drawing. */
            const sectionDir = sectionLine.direction();
            const sectionDirLength = Math.hypot(sectionDir.x, sectionDir.y, sectionDir.z);
            const dirIsAlongZ = (sectionDirLength > 0) && (Math.abs(sectionDir.z) / sectionDirLength > 1 - 1e-9);
            const workplaneNormal = new this.classes.Vector(0, dirIsAlongZ ? 1 : 0, dirIsAlongZ ? 0 : 1);
            // brep's Vector.crossed() copies; meshup's cross() mutates the (freshly made) receiver
            const offsetVec = (typeof (workplaneNormal as any).crossed === 'function')
                                ? (workplaneNormal as any).crossed(sectionDir).normalize()
                                : (workplaneNormal as any).cross(sectionDir).normalize();

            const collectionCenter = collection.center();
            const sectionCenter = sectionLine.center();
            const outwards = sectionCenter.copy().move([offsetVec.x, offsetVec.y, offsetVec.z]);
            const inwards = sectionCenter.copy().move([-offsetVec.x, -offsetVec.y, -offsetVec.z]);
            if(collectionCenter.distance(outwards) < collectionCenter.distance(inwards))
            {
                offsetVec.reverse();
            }

            intersectionPointsAlongRangeAxis.forEach((v,i,arr) => 
            {
                if(i < arr.length -1 )
                {
                    const lineStartCoord = v;
                    const lineEndCoord = arr[i+1];
                    const distance = lineEndCoord - lineStartCoord;
                    if(roundTo(distance,3) > minDistance) // TODO: Use the dimension value rounding settings to avoid zero values in dim lines
                    {
                        const dimLineStartPoint = new this.classes.Point(0,0,0)
                                                    ['set'+rangeAxis.toUpperCase()](lineStartCoord)
                                                    ['set'+levelAxis.toLocaleUpperCase()](dimLinesLevelCoord);

                        const dimLineEndPoint = new this.classes.Point(0,0,0)
                                                ['set'+rangeAxis.toUpperCase()](lineEndCoord)
                                                ['set'+levelAxis.toLocaleUpperCase()](dimLinesLevelCoord);

                        const dimLine = this.dimensionLine(
                                            dimLineStartPoint,
                                            dimLineEndPoint,
                                            {  
                                                offset: (lvl?.offset ?? DIMENSION_LINE_OFFSET_FROM_BBOX), 
                                                offsetVec: offsetVec,
                                                roundDecimals: 0,
                                            }
                                        ).link(collection);

                        autoDimLines.push(dimLine);
                    }
                }
            })
        })

        return autoDimLines;
    }

    /** Coordinates along `rangeAxis` where Shapes cross the plane `levelAxis = levelCoord`.
     *
     *  The mesh kernel has no section-plane extrude (brep sections with a real Face and
     *  intersects it with the Shapes), but the 'levels' strategy only ever needs the
     *  coordinates at which geometry crosses a level - so read them off the geometry itself:
     *  every edge that spans the level contributes the point where it crosses, and edges
     *  lying IN the level plane contribute both their ends (that is what gives a horizontal
     *  member sectioned along its own face its real extents).
     *
     *  Works for any main axis and for flat drawings (Curves, from elevation()/iso()) as well
     *  as 3D bodies (Meshes) - unlike a WASM slice(), which is tied to the XY plane.
     *
     *  @param shapes - Shapes (nullish entries and nested collections are fine)
     *  @param tolerance - distance from the level plane still counted as lying in it
     */
    _levelCrossingCoords(shapes:Array<any>, levelAxis:MainAxis, levelCoord:number, rangeAxis:MainAxis, tolerance:number=1e-4):Array<number>
    {
        const DEDUPE_DECIMALS = 4; // a level cut hits the same coordinate from many faces/edges
        const coords = new Set<number>();

        const addCoord = (c:number) =>
        {
            if(typeof c !== 'number' || !isFinite(c)){ return }
            coords.add(roundTo(c, DEDUPE_DECIMALS));
        }

        const addSegment = (a:any, b:any) =>
        {
            const da = a[levelAxis] - levelCoord;
            const db = b[levelAxis] - levelCoord;
            const aOnLevel = Math.abs(da) <= tolerance;
            const bOnLevel = Math.abs(db) <= tolerance;

            if(aOnLevel){ addCoord(a[rangeAxis]) }
            if(bOnLevel){ addCoord(b[rangeAxis]) }
            if(aOnLevel || bOnLevel){ return } // touching/lying in the plane: the ends are the crossings
            if((da > 0) === (db > 0)){ return } // both on the same side: no crossing

            const t = da / (da - db);
            addCoord(a[rangeAxis] + t * (b[rangeAxis] - a[rangeAxis]));
        }

        /** Points come in as Point/Vertex (x/y/z) or as raw wasm VertexJs (toArray() only) */
        const asPoint = (v:any):{x:number,y:number,z:number}|null =>
        {
            if(!v){ return null }
            if(typeof v.x === 'number'){ return v }
            if(typeof v.toArray === 'function')
            {
                const [x,y,z] = Array.from(v.toArray() as ArrayLike<number>);
                return { x: x ?? 0, y: y ?? 0, z: z ?? 0 };
            }
            return null;
        }

        const addPolyline = (pnts:Array<any>, closed:boolean) =>
        {
            const p = pnts.map(asPoint).filter(Boolean) as Array<{x:number,y:number,z:number}>;
            for(let i = 0; i < p.length - 1; i++){ addSegment(p[i], p[i+1]) }
            if(closed && p.length > 2){ addSegment(p[p.length-1], p[0]) }
        }

        const addShape = (shape:any) =>
        {
            if(!shape){ return }
            if(typeof shape.isShapeCollection === 'function' && shape.isShapeCollection())
            {
                shape.toArray().forEach(addShape);
            }
            else if(typeof shape.polygons === 'function') // Mesh: every face is a closed loop
            {
                shape.polygons().toArray().forEach((p:any) => addPolyline(p.vertices().toArray(), true));
            }
            else if(typeof shape.tessellate === 'function') // Curve, including compound ones
            {
                addPolyline(shape.tessellate(), false); // a closed Curve tessellates back to its start
                (shape._holes ?? []).forEach(addShape);
            }
            else if(typeof shape.vertices === 'function') // Polygon and other face-like Shapes
            {
                addPolyline(shape.vertices().toArray(), true);
                const holes = shape.inner?.()?.holes?.() ?? []; // interior holes live on the kernel polygon
                holes.forEach((hole:Array<any>) => addPolyline(hole, true));
            }
            else if(typeof shape[levelAxis] === 'number') // Vertex / Point
            {
                if(Math.abs(shape[levelAxis] - levelCoord) <= tolerance){ addCoord(shape[rangeAxis]) }
            }
        }

        shapes.forEach(addShape);

        return Array.from(coords);
    }

    //// MANAGING MULTIPLE ANNOTATIONS 

    /** Filter out the same annotations
     *  See isSame for config flags
     */
    unique(annotations:Array<Annotation>, flags:Record<string,any> = {}):Array<Annotation>
    {
        if(!Array.isArray(annotations))
        {
            console.error(`Annotator::unique(annotations): Please supply annotations in Array!`);
            return annotations;
        }

        const annotationsById = annotations
                                    .filter(a => BaseAnnotation.isAnnotation(a))
                                    .reduce((acc,a) => {
                                        const id = a.sameId(flags);
                                        if(!acc[id]) acc[id] = a; // first only
                                        return acc;
                                    }, {} as Record<string,Annotation>); // NOTE: first ones are keps                                

        const uniqueAnnotations = Object.values(annotationsById);
        console.info(`Annotator::filterOutSame(annotations): Returned ${uniqueAnnotations.length}/${annotations.length} unique annotations!`)

        return uniqueAnnotations;
    }

    /** Remove annotations that have same value and are close to each other */
    removeSameAtSmallDistance(d:number, sameFlags:Record<string,any>={}):this
    {
        // Annotations grouped by same id
        const annotationsGroups = this.getAnnotations()
                                        .reduce((acc,a) => 
                                        {
                                                const sameId = a.sameId({ ...sameFlags, compareWithShape: false }); // exclude shape
                                                (!acc[sameId]) ? acc[sameId] = [a] : acc[sameId].push(a);
                                                return acc;
                                        }, {});

        const selectedAnnotations = [] as Array<Annotation>;
        
        Object.keys(annotationsGroups).forEach( id => 
        {
            const groupedAnnotations = annotationsGroups[id];
            if(groupedAnnotations.length === 1)
            {
                selectedAnnotations.push(groupedAnnotations[0]); // add single - this goes through
            }
            else {
                // consider the same annotations (without shape) and check distance
                const fa = groupedAnnotations[0];
                selectedAnnotations.push(fa); // first goes through
                groupedAnnotations.forEach((a,i) => {
                    if(i > 0)
                    {
                        if(fa.toShape().distance(a.toShape()) > d )
                        {
                            selectedAnnotations.push(a);
                        }
                    }
                })
            }
        })

        console.info(`Annotator::removeSameAtSmallDistance(): Removed ${this.getAnnotations().length - selectedAnnotations.length}/${this.getAnnotations().length} annotations within distance ${d}`);
        
        this.setAnnotations(selectedAnnotations);
        return this;
    }
}
