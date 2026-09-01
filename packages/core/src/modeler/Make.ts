/**
 *  Make.ts
 *    Submodule of Modeler.
 *    Contains static methods that make it easier:
 *      - to create more complex things (like a wall)
 *      - create things from the scene (like part lists)
 *
 */

import { ArchiyouModules } from '../types';
import type { Modeler } from './Modeler';
import { ShapeCollection } from '@archiyou/meshup';
import type * as meshup from '@archiyou/meshup';
import type { Polygon } from '@archiyou/meshup';
import type { Mesh } from '@archiyou/meshup';
import { Table } from '../calc/Table';

import { BinPacker } from '@archiyou/gdrr2bp-wasm';
import { collectParts } from './parts';
import type { CuttingNode, Instance, Part } from '@archiyou/gdrr2bp-wasm';

import { Static } from 'typebox';
import { PackOptionsSchema } from './schemas';

/** Shared BinPacker WASM instance across all Make instances.
 *  The WASM module is loaded only once for the whole process: every run creates a
 *  fresh Make, so without this cache each run would re-instantiate the WASM and race
 *  the (synchronous) pack() call against an unresolved init(). */
let _sharedBinPacker: BinPacker | null = null;
let _sharedBinPackerReady: Promise<BinPacker> | null = null;

function loadSharedBinPacker(): Promise<BinPacker>
{
    if (!_sharedBinPackerReady)
    {
        _sharedBinPackerReady = new BinPacker().init().then(bp =>
        {
            _sharedBinPacker = bp;
            return bp;
        });
    }
    return _sharedBinPackerReady;
}

export type PackOptions = Static<typeof PackOptionsSchema>;

/** An opening (window/door) in a wall built by wall() */
export interface WallOpening
{
    left: number
    sill: number
    width: number
    height: number
}

/** Corner a 2D layout starts filling from */
export type Alignment2D = 'topleft' | 'topright' | 'bottomleft' | 'bottomright'

/** Statistics on the last make operation, with the important metrics and the shapes behind
 *  them. Read them after the operation at `make.stats` — this avoids complex return values. */
export interface MakeStats
{
    efficiency: number | null       // [0-100]: how much of the stock used ends up in the layout
    wastedArea: number | null
    numStock: number                // total number of stock sheets/boards needed
    full: ShapeCollection           // elements that use a full stock piece
    cut: ShapeCollection            // elements that need to be cut from stock
    fitted: ShapeCollection         // the cut elements nested onto stock sheets
    waste: ShapeCollection          // areas that could not be filled
}

/** Options for a 2D layout of stock elements (boards, sheets) over a rectangular area */
export interface Layout2DOptions
{
    width: number                              // total width of the layout, in model units
    height: number                             // total height of the layout, in model units
    stockWidth?: number                        // size of the stock elements to fill it with
    stockHeight?: number
    start?: Alignment2D                        // corner to start filling from (default bottomleft)
    direction?: 'horizontal' | 'vertical'      // direction elements are laid in sequence
    grid?: number                              // snap element ends to a grid along the main axis
    gridOffset?: number                        // offset of that grid along the main axis
    leftover?: boolean                         // continue the next row with the cut-off remainder
    cutMargin?: number                         // margin between parts when nesting cut elements
    stats?: boolean                            // gather stats afterwards (default true)
}

/** The Modeler as Make uses it: each primitive narrowed to the concrete meshup class its
 *  mesh branch actually returns. See the `modeler` getter for why this exists. */
type MeshModeler = Omit<Modeler,
        'box'|'cube'|'boxBetween'|'sphere'|'cylinder'|'rect'|'rectBetween'|'circle'
        |'line'|'arc'|'spline'|'polyline'|'plane'|'planeBetween'|'polygon'|'vertex'
        |'point'|'vector'>
    & {
        point(...args: Parameters<Modeler['point']>): meshup.Point
        vector(...args: Parameters<Modeler['vector']>): meshup.Vector
        box(...args: Parameters<Modeler['box']>): meshup.Mesh
        cube(...args: Parameters<Modeler['cube']>): meshup.Mesh
        boxBetween(...args: Parameters<Modeler['boxBetween']>): meshup.Mesh
        sphere(...args: Parameters<Modeler['sphere']>): meshup.Mesh
        cylinder(...args: Parameters<Modeler['cylinder']>): meshup.Mesh
        rect(...args: Parameters<Modeler['rect']>): meshup.Curve
        rectBetween(...args: Parameters<Modeler['rectBetween']>): meshup.Curve
        circle(...args: Parameters<Modeler['circle']>): meshup.Curve
        line(...args: Parameters<Modeler['line']>): meshup.Curve
        arc(...args: Parameters<Modeler['arc']>): meshup.Curve
        spline(...args: Parameters<Modeler['spline']>): meshup.Curve
        polyline(...args: Parameters<Modeler['polyline']>): meshup.Curve
        plane(...args: Parameters<Modeler['plane']>): meshup.Polygon
        planeBetween(...args: Parameters<Modeler['planeBetween']>): meshup.Polygon
        polygon(...args: Parameters<Modeler['polygon']>): meshup.Polygon
        vertex(...args: Parameters<Modeler['vertex']>): meshup.Vertex
    }

/** Options for {@link Make.partList}. */
export interface PartListOptions
{
    /** Add a `label` column (A, B, C …) as the first column. Default false — scripts read
     *  these rows positionally, so the shift is opt-in. */
    labels?: boolean
}

export class Make
{
    //// SETTINGS ////
    LAYOUT2D_BOX_DEFAULT_FITTING_MARGIN_SIZE = 5;

    declare private _modeler: Modeler;
    declare private _modules: ArchiyouModules;

    /** Stats on the last operation that gathers them (boarding). See MakeStats. */
    declare stats: MakeStats;

    constructor(modeler: Modeler)
    {
        this._modeler = modeler;
    }

    setArchiyou(modules: ArchiyouModules)
    {
        this._modules = modules;
        // Kick off the shared BinPacker WASM load (cached across all Make instances)
        loadSharedBinPacker();
    }

    /** Shared BinPacker WASM instance, or null until loaded. */
    private get _binPacker(): BinPacker | null
    {
        return _sharedBinPacker;
    }

    /** Make it easier / readable to use the archiyou modules */
    get archiyou(): ArchiyouModules
    {
        if (!this._modules)
            throw new Error(
                'Make: Archiyou modules not set. This should have been set by Modeler during initialization.'
            );
        return this._modules;
    }

    /**
     *  Get the Modeler module.
     *
     *  Typed as MeshModeler, not Modeler: Make only ever builds MESH geometry (walls, studs,
     *  sheet packing), while the Modeler's primitives are now typed for both kernels and hand
     *  back a mesh-or-brep union. Narrowing here — rather than at ~40 call sites — keeps this
     *  module type-checking against the concrete meshup classes it actually works with.
     *  Running Make in brep mode is not supported.
     */
    get modeler(): MeshModeler
    {
        const m = this._modules ? this._modules.modeler : this._modeler;
        if (!m)
            throw new Error(
                'Make: Modeler module not set. Use constructor(modeler) or setArchiyou() to set it.'
            );
        return m as unknown as MeshModeler;
    }

    /** Resolves once the BinPacker WASM module is loaded and `pack()` can be called. */
    packReady(): Promise<void>
    {
        return loadSharedBinPacker().then(() => undefined);
    }

    //// MAIN METHODS ////

    /** Make simple rectangular frame of width, height, depth and thickness at origin position
     *  prio sets what members have priority (default: horizontal)
     *  Frame is parallel to the front side
     */
    public frame(width: number, height: number, depth: number, thickness: number, prio: 'horizontal' | 'vertical' = 'horizontal'): ShapeCollection
    {
        // very basic input tests
        if (
            typeof width !== 'number' ||
            typeof height !== 'number' ||
            typeof depth !== 'number' ||
            typeof thickness !== 'number'
        )
        {
            throw new Error(
                `Make.frame(w,h,d,t,p): Please supply numbers for width, height, depth and thickness!`
            );
        }

        if (typeof prio !== 'string')
        {
            prio = 'horizontal';
        }

        const horMemOffset = (prio === 'horizontal') ? [[0, 0, 0], [0, 0, 0]] : [[thickness, 0, 0], [-thickness, 0, 0]]; // [start,end], [start,end]
        const vertMemOffset = (prio === 'horizontal') ? [[0, 0, thickness], [0, 0, -thickness]] : [[0, 0, 0], [0, 0, 0]];

        const bottomMem = this.modeler.boxBetween(
                                    this.modeler.point(0, 0, 0).move(horMemOffset[0]),
                                    this.modeler.point(0, 0, 0).move(width, depth, thickness).move(horMemOffset[1]))
                                    .name('frameBottom');

        const topMem = bottomMem.copy().move(0, 0, height - thickness).name('frameTop');
        const leftMem = this.modeler.boxBetween(
                            this.modeler.point(0, 0, 0).move(vertMemOffset[0]),
                            this.modeler.point(0, 0, 0).move(thickness, depth, height).move(vertMemOffset[1])
                        ).name('frameLeft');

        const rightMem = leftMem.copy().move(width - thickness, 0, 0).name('frameRight');

        // group(): a frame is handed back as one unit, so it gets its own layer in the scene
        return this.modeler.group(bottomMem, topMem, leftMem, rightMem).name('Frame');
    }

    /** Make an advanced wood frame for a wall
     *  starting from origin with centerline along x-axis
     *  returns ShapeCollection and puts messages inside console
     *
     *  NOTE: Added sloped roof with optional ridge height and centerline [0-1]:
     *    this will add a triangular top to the wall
     */
    public wall(width: number, height: number, depth?: number, studThickness?: number, grid?: number, openings: Array<WallOpening> = [], ridge?: { height: number; center: number }): ShapeCollection
    {
        // SETTINGS
        const DEFAULT_GRID_DISTANCE = 610;
        const DEFAULT_STUD_THICKNESS = 38;
        const ENDING_STUDS_INSIDE = true;
        const OPENING_WIDTH_MIN = 100;
        const OPENING_HEIGHT_MIN = 100;
        const RIDGE_CENTER_MIN = 0.15; // max = 1 - RIDGE_CENTER_MIN
        // if ridge.center is outside will default to 0 or 1

        grid = grid || DEFAULT_GRID_DISTANCE;
        studThickness = studThickness || DEFAULT_STUD_THICKNESS;

        // start wall collection. group(): the wall is the scene unit - its addGroup() calls
        // below nest studs/plates/... as sub-layers under it. The intermediate collections it
        // gathers stay plain collection()s: they are bags, and grouping them here would only
        // move their shapes twice and leave empty layers behind.
        const wall = this.modeler.group().name('wall');

        const OPENING_SNAP_POSITION_WITHIN_DISTANCE = studThickness * 2; // kingstud + frame
        const MIN_OPENING_GAP = studThickness * 2; // minimum gap between openings for two king studs

        // check if roof ridge is defined and valid
        if (ridge)
        {
            if(ridge.height <= 0)
            {
                console.warn(`Invalid ridge height: ${ridge.height}. No ridge.`);
                ridge = undefined;
            }
            else if (typeof ridge.height !== 'number' || typeof ridge.center !== 'number')
            {
                console.warn(`Invalid ridge definition: ${JSON.stringify(ridge)}. Ignored.`);
                ridge = undefined;
            }
            else if (ridge.center < RIDGE_CENTER_MIN)
            {
                console.user(`wall(): ridge.center snapped to 0`);
                ridge.center = 0;
            }
            else if (ridge.center > (1 - RIDGE_CENTER_MIN))
            {
                console.user(`wall(): ridge.center snapped to 1`);
                ridge.center = 1;
            }
        }

        // Make diagram of wall, basically a plane or one with a triangle
        const wallDiagram = (
            (ridge)
                ? this.modeler.polygon([
                        [0, 0, 0], // counterclockwise
                        [width, 0, 0], 
                        [width, 0, height],
                        [width * (ridge.center), 0, height + ridge.height],
                        [0, 0, height]
                    ])
                : this.modeler.planeBetween([0, 0, 0], [width, 0, height])
        ).name('wallDiagram');

        // Check, sort and merge openings that are too close to leave room for king studs between them
        openings = [...openings].sort((a, b) => a.left - b.left);
        const mergedOpenings: Array<WallOpening> = [];
        for (const o of openings)
        {
            const prev = mergedOpenings[mergedOpenings.length - 1];
            if (prev && o.left - (prev.left + prev.width) < MIN_OPENING_GAP)
            {
                const mergedRight = Math.max(prev.left + prev.width, o.left + o.width);
                const mergedSill = Math.min(prev.sill, o.sill);
                const mergedTop = Math.max(prev.sill + prev.height, o.sill + o.height);
                prev.width = mergedRight - prev.left;
                prev.sill = mergedSill;
                prev.height = mergedTop - mergedSill;
                console.log(
                    `Openings too close (gap < ${MIN_OPENING_GAP}mm): merged into one`
                );
            }
            else
            {
                mergedOpenings.push({ ...o });
            }
        }
        openings = mergedOpenings;

        const openingDiagrams = this.modeler.collection().name('openingDiagrams');
        const openingFlags = []; // flags per opening - register a snap of opening to wall frame (leaving out the window frame)

        // Further tests
        openings.forEach((o, i) =>
        {
            const curOpeningFlags = {
                snapTop: false,
                snapBottom: false,
                snapLeft: false,
                snapRight: false
            };
            openingFlags.push(curOpeningFlags);

            if (
                typeof o.left === 'number' &&
                o.left >= 0 &&
                typeof o.sill === 'number' &&
                typeof o.height === 'number' &&
                o.height >= OPENING_HEIGHT_MIN &&
                typeof o.width === 'number' &&
                o.width >= OPENING_WIDTH_MIN
            )
            {
                // Basic horizontal tests
                if (o.left < studThickness)
                {
                    console.user(
                        `Opening #${i} snapped left to start stud at ${studThickness}`
                    );
                    // NOTE: keep width the same
                    o.left = studThickness;
                    curOpeningFlags.snapLeft = true;
                }
                // total width
                if (o.left + o.width > width - 2 * studThickness)
                {
                    // First try to decrease left
                    o.left = width - studThickness - o.width;
                    curOpeningFlags.snapRight = true;
                    if (o.left < studThickness)
                    {
                        o.left = studThickness;
                        curOpeningFlags.snapLeft = true;
                        o.width = width - 2 * studThickness;
                        console.user(
                            `Opening #${i} width decreased to ${o.width} to fit inside wall`
                        );
                    }
                    else
                    {
                        console.user(
                            `Opening #${i} left decreased to ${o.left} to fit width of ${o.width} inside wall`
                        );
                    }
                }

                // Basic vertical tests
                if (o.sill < studThickness)
                {
                    o.sill = studThickness;
                    console.log(
                        `Opening #${i} Snapped sill to minimum of ${studThickness}`
                    );
                    curOpeningFlags.snapBottom = true;
                }
                // Vertical checks: combined height and sill - try to keep height over sill
                if (o.sill + o.height > height - 2 * studThickness)
                {
                    let newSill = height - studThickness - o.height; // first lower sill if possible
                    curOpeningFlags.snapTop = true;
                    if (newSill < studThickness)
                    {
                        curOpeningFlags.snapBottom = true;
                        let newHeight = o.height - newSill + studThickness;
                        if (newHeight > height - studThickness)
                        {
                            newHeight = height - studThickness; // height starting from sill
                            console.log(
                                `Opening #${i} Snapped height to minimum of ${height - 2 * studThickness}`
                            );
                        }
                        o.height = newHeight;
                        newSill = studThickness;
                    }

                    o.sill = newSill;
                    console.log(
                        `Opening #${i} Snapped sill to ${newSill} to fit opening in height`
                    );
                }

                // Now make diagram Shape for opening - this includes a roof part (if ridge is set)
                openingDiagrams.add(
                    this.modeler.planeBetween(
                        [o.left, 0, o.sill],
                        [o.left + o.width, 0, o.sill + o.height]
                    )
                );
            }
            else
            {
                console.log(
                    `Opening #${i} (width=${o.width} height=${o.height} left=${o.left} sill=${o.sill}) is not well defined! Skipped.`
                );
            }
        });

        // vertical grid
        const gridLines = this.modeler.collection().name('gridlines');
        const numGridLines = Math.floor(width / grid) + 1;
        const remainingWallWidth = width - (numGridLines - 1) * grid;
        const skipEndStud = remainingWallWidth < studThickness ? true : false;

        new Array(numGridLines).fill(null).map((e, i) =>
            gridLines.add(
                this.modeler
                    .line([0, 0, 0], [0, 0, height + (ridge?.height || 0)])
                    .move(grid * i)
                    .name(`gridline${i}`)
            )
        );

        // total maximum stud height (this includes ridge)
        let studHeight = height - studThickness * 2; 
        if (ridge)
        {
            studHeight += ridge.height; // TODO: correction for angle
        }

        // top and bottom-plates
        const bottomPlate = this.modeler
            .boxBetween([0, 0, 0], [width, depth, studThickness])
            .moveY(-depth / 2)
            .name('bottomplate');

        // Top plates are more complex if ridge is defined
        const topPlates = new ShapeCollection();
        let roofLine; 
        let roofLineInside; // used to cut of studs and insulation if ridge

        // normal straight wall
        if (!ridge)
        {
            topPlates.add(
                bottomPlate
                    .copy()
                    .move(0, 0, studHeight + studThickness)
                    .name('topplate')
            );
        }
        else
        {
            if(ridge.center === 0 || ridge.center === 1)
            {
                roofLine = (ridge.center === 0) 
                  ? this.modeler.line([0, 0, height + ridge.height],[width, 0, height ]) // ridge is left
                  : this.modeler.line( [0, 0, height],[width, 0, height+ridge.height]); // ridge is right

                const roofAngleRad = Math.atan(ridge.height / width);
                const ridgeThicknessHeight = studThickness / Math.cos(roofAngleRad);

                const topPlate = roofLine.copy()
                                  .extrude(ridgeThicknessHeight, [0, 0, -1])
                                  .extrude(depth, [0,-1,0])
                                  .moveY(depth / 2)
                                  .name('topplate');
                topPlates.add(topPlate);
                
                roofLineInside = roofLine.copy().moveZ(-ridgeThicknessHeight);
            }
            // two rooflines
            else {
                roofLine = this.modeler.polyline(
                  [0, 0, height],
                  [width * ridge.center, 0, height + ridge.height],
                  [width, 0, height]
                ); /*.removeFromScene();*/

                roofLineInside = roofLine
                          .copy()
                          .offset(-studThickness)
                          .extendTo(this.modeler.line([0,0,0],[0,0,height+ridge.height]).tmp())
                          .extendTo(this.modeler.line([width,0,0],[width,0,height+ridge.height]).tmp())
                          .name('roofLineInside')
                          .tmp(); // no in scene
                          
                
                const topPlateLeft = roofLine
                                      .segments().first()
                                      .copy()
                                      .connect(roofLineInside.segments().first())
                                      .extrude(depth).moveY(-depth/2)
                                      .name('topPlateLeft')

                const topPlateRight = roofLine.segments().last()
                                      .connect(roofLineInside.segments().last())
                                      .extrude(depth).moveY(-depth/2)
                                      .name('topPlateRight');
                topPlates.add(topPlateLeft, topPlateRight);
            }
        }
        
        const plates = this.modeler.collection(bottomPlate, topPlates);

        // primary studs
        const primaryStuds = this.modeler.collection();

        const stud = this.modeler
            .box(studThickness, depth, studHeight)
            .moveZ(studHeight/2 + studThickness)
            .removeFromScene() as Mesh; // this one is not to be shown

        gridLines.forEach((l, i, arr) =>
        {
            const newStud = stud
                .copy()
                .align(l.start(), 'bottom', 'center')
                .moveZ(studThickness)
                .name('stud' + i);

            if (ENDING_STUDS_INSIDE)
            {
                if (i === 0)
                {
                    newStud.move(studThickness / 2);
                }
            }
            primaryStuds.add(newStud);
        });

        

        // Ending stud (see: skipEndStud above)
        if (!skipEndStud)
        {
            // Don't add end stud if there is no space between width and last grid line
            // Meaning the wall needs a filler stud
            const endStud = stud.copy().move(width, 0);
            ENDING_STUDS_INSIDE ? endStud.move(-studThickness / 2) : endStud;
            primaryStuds.add(endStud.name('endstud'));
        }

        // Insulation
        let insulation = this.modeler.collection();
        primaryStuds.forEach((stud, i) =>
        {
            if (i < primaryStuds.length - 1)
            {
                const nextStud = primaryStuds.at(i + 1);
                insulation.add(
                    this.modeler
                        .boxBetween(stud.bbox().max(), nextStud.bbox().min())
                        .name('insulation' + i)
                );
            }
        });

        // If ridge, cut studs and insulation
        let wallRidgeContour; // keep for later to check if openings are within
        let wallRidgeContourSolid;
        if(ridge)
        {
            // make intersection volume
            wallRidgeContour = roofLineInside.copy().connect(
                  this.modeler.line([0,0,0],[width,0,0]).removeFromScene());

            wallRidgeContourSolid = wallRidgeContour.copy().toPolygon()
                .extrude(depth*2).moveY(-depth) // make solid 2x bigger
                .removeFromScene();

            // do this in place, instead of Collection.intersections(...)
            // TODO: fix
            primaryStuds.forEach((shape) => 
                shape.intersection(wallRidgeContourSolid));
            insulation.forEach((shape) => 
                shape.intersection(wallRidgeContourSolid));
          
        }

        // Openings: Validate openings and give feedback for user when needed
        const checkedOpenings = this.modeler.collection().hide();
        const removedStuds = this.modeler.collection().hide(); // primary studs that were removed
        const crippleStudsTop = this.modeler.collection(); // cut studs
        const crippleStudsBottom = this.modeler.collection();
        const openingFramesHorizontals = this.modeler.collection(); // add resulting frames here
        let openingFramesVerticals = this.modeler.collection(); // add resulting frames here
        const openingKingStuds = this.modeler.collection();
        const openingJackStuds = this.modeler.collection();

        // First check if openings are within ridge contour (if ridge is defined)
        if(ridge)
        {
          // TODO
        }

        openingDiagrams.forEach((o, i) =>
        {
            // some flags in openingFlags[i]
            const curOpeningFlags = openingFlags[i];
            const openingStart = o.bbox().min();

            // Modify openingDiagrams (flat faces) in place if needed
            let checkedOpening = o as Polygon;

            // continue if opening is valid
            if (checkedOpening)
            {
                // Horizontal checks: check position versus studs
                // snap start position to match with nearest stud
                if (curOpeningFlags.snapLeft)
                {
                    // no left frame for opening - keep it like this
                }
                else
                {
                    const nearestStartGridLine = gridLines.nearest(openingStart);
                    const d1 = nearestStartGridLine.distance(openingStart);
                    const snapTestWithinDistance =
                        nearestStartGridLine === gridLines.first()
                            ? OPENING_SNAP_POSITION_WITHIN_DISTANCE + studThickness
                            : OPENING_SNAP_POSITION_WITHIN_DISTANCE;
                    if (
                        d1 < snapTestWithinDistance
                    ) // If within distance snap to given offset aligned to primary stud centerline
                    {
                        const xOffset =
                            nearestStartGridLine === gridLines.first() ? 2 : 1.5;
                        const moveToX =
                            nearestStartGridLine.center().x + studThickness * xOffset;
                        const openingW = checkedOpening.bbox().width();
                        checkedOpening = this.modeler.planeBetween(
                            checkedOpening.bbox().min().setX(moveToX),
                            checkedOpening
                                .bbox()
                                .max()
                                .setX(moveToX + openingW)
                        ) as any;
                        console.log(
                            `Snapped Opening #${i} on a stud at centerline ${nearestStartGridLine.center().x} at distance ${d1}`
                        );
                        // Check if the opening still fits
                        if (checkedOpening.bbox().maxX() > width - studThickness)
                        {
                            // Make it smaller to have it fit and snap to end of wall
                            checkedOpening = this.modeler.planeBetween(
                                checkedOpening.bbox().min(),
                                checkedOpening
                                    .bbox()
                                    .max()
                                    .setX(width - studThickness)
                            );
                            curOpeningFlags.snapRight = true;
                            console.log(
                                `Opening #${i} was decreased in width to ${checkedOpening.bbox().width()} to fit the end of the wall!`
                            );
                        }
                    }
                }
                // Snapping the width of an opening to maintain grid and avoid weird positioning
                // But width of opening can not change from specified by parameters
                const nextGridLine = gridLines.find(
                    s => checkedOpening.bbox().max().x < s.center().x
                );

                if (nextGridLine)
                {
                    if (curOpeningFlags.snapRight)
                    {
                        // snapped to right of wall. Do nothing
                    }
                    else
                    {
                        // opening is too close to next primary stud to fit in king stud
                        // (but is not at same position for king stud to overlap primary one)
                        // we enlarge the opening to have king stud at position of primary stud

                        const distanceToNextStud =
                            checkedOpening.distance(nextGridLine) - 0.5 * studThickness;
                        const checkDistance =
                            gridLines.last() === nextGridLine
                                ? 2.5 * studThickness
                                : 2 * studThickness;
                        if (
                            distanceToNextStud > studThickness &&
                            distanceToNextStud < checkDistance
                        )
                        {
                            const newOpeningMax = checkedOpening
                                .bbox()
                                .max()
                                .move(distanceToNextStud - studThickness);
                            if (
                                newOpeningMax.x >
                                width - 2 * studThickness
                            ) // enlarge is limited to right side of wall
                            {
                                newOpeningMax.x = width - 2 * studThickness;
                                curOpeningFlags.snapRight = true; // right snap mode drops frame
                                console.log(`Enlarged opening #${i} to fit to end of wall`);
                            }
                            else
                            {
                                console.log(
                                    `Enlarged opening #${i} by ${distanceToNextStud - studThickness} units to fit to grid studs!`
                                );
                            }
                            checkedOpening = this.modeler.planeBetween(
                                checkedOpening.bbox().min(),
                                checkedOpening
                                    .bbox()
                                    .max()
                                    .move(distanceToNextStud - studThickness)
                            );
                        }
                        // opening is too close to next primary stud to fit jack and king stud in
                        // enlarge opening so jack studs align to grid line of next primary stud
                        // king stud of opening is then placed off-grid
                        else if (
                            distanceToNextStud > 0 &&
                            distanceToNextStud < studThickness
                        )
                        {
                            checkedOpening = this.modeler.planeBetween(
                                checkedOpening.bbox().min(),
                                checkedOpening.bbox().max().move(distanceToNextStud)
                            );
                            console.log(
                                `Enlarged opening #${i} by ${distanceToNextStud}mm. Now end jack stud aligns to grid`
                            );
                        }
                        else
                        {
                            // when opening is overlapping with primary stud (so no space for jack stud)
                            // enlarge opening so last cripple can be fitted in and aligns with grid
                            const closeGridLine = gridLines.find(
                                l =>
                                    Math.abs(l.center().x - checkedOpening.bbox().max().x) <
                                    studThickness * 0.5
                            );
                            //closeGridLine.copy(false).move(0,0,100).color('red')
                            if (closeGridLine)
                            {
                                const dx = Math.abs(
                                    closeGridLine.center().x +
                                        studThickness * 0.5 -
                                        checkedOpening.bbox().max().x
                                );
                                checkedOpening = this.modeler.planeBetween(
                                    checkedOpening.bbox().min(),
                                    checkedOpening.bbox().max().move(dx)
                                );
                                console.log(
                                    `Enlarged opening #${i} by ${dx} units. Now last cripple aligns with grid`
                                );
                            }
                        }
                    }
                }

                checkedOpenings.add(checkedOpening.name('opening' + i)); // keep track of final openings

                // make opening surrounding frame
                const openingTestBuffer = checkedOpening
                    .copy()
                    .offset(studThickness - 1) // a bit smaller to avoid accuracy problems
                    .extrude(depth * 2)
                    .moveY(depth)
                    .removeFromScene(); // not part of scene

                primaryStuds.forEach((stud, studIndex) =>
                {
                    // evaluate overlapping studs to make cripples top and bottom
                    // don't cut first or last stud
                    if (
                        studIndex !== 0 &&
                        studIndex !== primaryStuds.length - 1 &&
                        stud.overlapPerc(openingTestBuffer) > 0.02
                    ) // use overlapPerc for robustness
                    {
                        const splitStuds = this.modeler.collection(
                            stud.copy().split(openingTestBuffer)
                        ); // force ShapeCollection

                        if (splitStuds.length >= 1)
                        {
                            // check if cripples top and bottom are made
                            const bottomPieces = splitStuds.filter(
                                s => s.center().z < checkedOpening.center().z
                            );
                            const topPieces = splitStuds.filter(
                                s => s.center().z > checkedOpening.center().z
                            );
                            if (bottomPieces.length > 0)
                                crippleStudsBottom.add(
                                    bottomPieces.first().name('crippleBottom')
                                );
                            if (topPieces.length > 0)
                                crippleStudsTop.add(topPieces.first().name('crippleTop'));

                            removedStuds.add(stud);
                        }
                        else
                        {
                            // remove primary stud that touches (but is not entirely cut to become cripples)
                            removedStuds.add(stud);
                        }
                    }
                });

                // make frame around opening
                const openingBufferBbox = openingTestBuffer.bbox();
                let openingFrame = this.frame(
                    openingBufferBbox.width(),
                    openingBufferBbox.height(),
                    depth,
                    studThickness,
                    'horizontal'
                ).moveTo(openingTestBuffer.center());

                // Don't add frame left, top and bottom or right if opening was snapped
                const includeFrameParts = [];
                for (const [flag, val] of Object.entries(curOpeningFlags))
                {
                    const FLAG_FALSE_TO_PART = {
                        snapLeft: 'frameLeft',
                        snapRight: 'frameRight',
                        snapBottom: 'frameBottom',
                        snapTop: 'frameTop'
                    };
                    if (FLAG_FALSE_TO_PART[flag] && val === false)
                    {
                        includeFrameParts.push(FLAG_FALSE_TO_PART[flag]);
                    }
                }

                openingFrame = this.modeler
                    .collection(
                        openingFrame.filter(s => includeFrameParts.includes(s.name()))
                    )
                    .removeFromScene();

                openingFramesHorizontals.add(
                    openingFrame.filter(
                        s => s.name() === 'frameTop' || s.name() === 'frameBottom'
                    )
                );
                // subtract plates only from this opening's vertical frames before accumulating
                // (doing it on the whole collection would re-subtract for frames from previous openings)
                const curVerticals = openingFrame.filter(
                    s => s.name() === 'frameLeft' || s.name() === 'frameRight'
                );
                openingFramesVerticals.add(curVerticals.subtract(plates));

                // make king and jack studs for current opening
                const openingFrameBbox = openingFrame.bbox(); // avoid recalculating
                const leftSnapOffset = curOpeningFlags.snapLeft ? studThickness : 0;
                const rightSnapOffset = curOpeningFlags.snapRight ? studThickness : 0;

                // bottom left and right jack studs
                if (!curOpeningFlags.snapBottom)
                {
                    const openingJackLeftBottom = this.modeler
                        .boxBetween(openingFrameBbox.min(), [
                            openingFrameBbox.min().x + studThickness,
                            depth / 2,
                            studThickness
                        ])
                        .moveX(leftSnapOffset)
                        .name('openingJackLeftBottom');

                    const openingJackRightBottom = openingJackLeftBottom
                        .copy()
                        .move(
                            openingBufferBbox.width() -
                                studThickness -
                                leftSnapOffset -
                                rightSnapOffset
                        )
                        .name('openingJackRightBottom');

                    openingJackStuds.add(openingJackLeftBottom, openingJackRightBottom);
                }

                // top left and right jack studs
                if (!curOpeningFlags.snapTop)
                {
                    const openingJackLeftTop = this.modeler
                        .boxBetween(
                            openingFrameBbox.min().moveZ(openingFrameBbox.height()),
                            [
                                openingFrameBbox.min().x + studThickness,
                                depth / 2,
                                (ridge) ? studHeight : height - studThickness
                            ]
                        )
                        .moveX(leftSnapOffset)
                        .name('openingJackLeftTop');

                    const openingJackRightTop = openingJackLeftTop
                        .copy()
                        .move(
                            openingBufferBbox.width() -
                                studThickness -
                                leftSnapOffset -
                                rightSnapOffset
                        )
                        .name('openingJackRightTop');

                    openingJackStuds.add(openingJackLeftTop, openingJackRightTop);
                }

                // King stud left
                if (!curOpeningFlags.snapLeft)
                {
                    const openingKingStudLeft = stud
                        .copy()
                        .align(
                            this.modeler.vertex(openingFrameBbox.minX(), 0, studThickness),
                            'bottomrightcenter',
                            'center'
                        );
                    // remove primary stud that overlaps king stud (when snapping is on this is cleanup automatically)
                    const overlappingPrimaryStud = primaryStuds.filter(
                        s => s.overlapPerc(openingKingStudLeft) > 0.02
                    );
                    if (overlappingPrimaryStud)
                    {
                        removedStuds.add(overlappingPrimaryStud);
                    }
                    openingKingStudLeft.name('openingKingStudLeft');
                    openingKingStuds.add(openingKingStudLeft);
                }
                else
                {
                    // subtract horizontals with primary left stud
                    openingFramesHorizontals.forEach(s =>
                        s.subtract(primaryStuds.first())
                    );
                }

                // King stud right
                if (!curOpeningFlags.snapRight)
                {
                    let openingKingStudRight = stud
                        .copy()
                        .align(
                            this.modeler.vertex(openingFrameBbox.maxX(), 0, studThickness),
                            'bottomleftcenter',
                            'center'
                        );
                    const overlappingPrimaryStudRight = primaryStuds.filter(
                        s => s.overlapPerc(openingKingStudRight) > 0.02
                    );
                    if (overlappingPrimaryStudRight)
                    {
                        removedStuds.add(overlappingPrimaryStudRight);
                    }

                    openingKingStudRight.name('openingKingStudRight');
                    openingKingStuds.add(openingKingStudRight);
                }
                else
                {
                    // subtract horizontals with primary right stud
                    openingFramesHorizontals.forEach(s =>
                        s.subtract(primaryStuds.last())
                    );
                }

                openingFramesHorizontals.forEach(s => s.name('openingHorizontal')); // correct name after subtract
                openingFramesVerticals.forEach(s => s.name('openingVertical')); // correct name after subtract

                // Clean insulation around frame
                insulation = insulation.subtract(openingTestBuffer);
                const leftSnapOffsetInsulation = curOpeningFlags.snapLeft
                    ? studThickness
                    : 0;
                const rightSnapOffsetInsulation = curOpeningFlags.snapRight
                    ? -studThickness
                    : 0;

                insulation
                    .subtract(
                        // king/jack studs combination: left
                        this.modeler
                            .boxBetween(
                                [checkedOpening.bbox().min().x, (depth / 2) * 1.1, 0], // make it bigger along wall frame (there is no insulation there anyway)
                                [
                                    checkedOpening.bbox().min().x - 2 * studThickness,
                                    (-depth / 2) * 1.1,
                                    height
                                ]
                            )
                            .moveX(leftSnapOffsetInsulation)
                            .removeFromScene()
                    )
                    .subtract(
                        // right
                        this.modeler
                            .boxBetween(
                                [checkedOpening.bbox().max().x, (depth / 2) * 1.1, 0],
                                [
                                    checkedOpening.bbox().max().x + 2 * studThickness,
                                    (-depth / 2) * 1.1,
                                    height
                                ]
                            )
                            .moveX(rightSnapOffsetInsulation)
                            .removeFromScene()
                    );
            }
        });

        // cut off studs around openings and clean insulation
        if(ridge)
        {
            openingKingStuds.add(
                openingKingStuds.forEach((s) => s.intersection(wallRidgeContourSolid)));
            openingJackStuds.add(
                openingJackStuds.forEach((s) => s.intersection(wallRidgeContourSolid)));
            /*
            insulation.forEach((s) => {
                s.subtract(openingKingStuds);
                s.subtract(openingJackStuds);}
            );
            */
           insulation.subtract(openingKingStuds).subtract(openingJackStuds);
        }

        // organize and output
        removedStuds.removeFromScene();
        primaryStuds.remove(removedStuds);

        return wall
            .addGroup('diagram', wallDiagram.hide())
            .addGroup('gridlines', gridLines.color('blue').dashed())
            .addGroup('studs', primaryStuds.color('green'))
            .addGroup('plates', plates.color('green'))
            .addGroup('cripplesTop', crippleStudsTop.color('green'))
            .addGroup('cripplesBottom', crippleStudsBottom.color('green'))
            .addGroup(
                'openingFramesHorizontals',
                openingFramesHorizontals.color('red')
            )
            .addGroup('openingFramesVerticals', openingFramesVerticals.color('red'))
            .addGroup('openingKingStuds', openingKingStuds.color('brown'))
            .addGroup('openingJackStuds', openingJackStuds.color('brown'))
            .addGroup('openingDiagrams', checkedOpenings.color('grey').hide())
            .addGroup('insulation', insulation.color('#222'));
    }

    //// 2D LAYOUTS ////

    /** Reset (and return) the stats of the last stats-gathering operation */
    resetStats(): MakeStats
    {
        this.stats = {
            efficiency: null,
            wastedArea: null,
            numStock: 0,
            full: this.modeler.collection(),
            cut: this.modeler.collection(),
            fitted: this.modeler.collection(),
            waste: this.modeler.collection(),
        };

        return this.stats;
    }

    /** The corner of a width x height layout that `start` names, as a point on the XY plane */
    private _alignment2DToPoint(a: Alignment2D, width: number, height: number): meshup.Point
    {
        return this.modeler.point(
            a.includes('right') ? width : 0,
            a.includes('top') ? height : 0,
            0,
        );
    }

    /** Fill in the defaults of a Layout2DOptions */
    private _checkLayoutOptions(o: Layout2DOptions): Required<Layout2DOptions>
    {
        return {
            width:       o?.width || 1000,
            height:      o?.height || 1000,
            stockWidth:  o?.stockWidth || 100,
            stockHeight: o?.stockHeight || 100,
            start:       o?.start || 'bottomleft',
            direction:   o?.direction || 'horizontal',
            grid:        o?.grid ?? null as unknown as number,
            gridOffset:  o?.gridOffset || 0,
            leftover:    o?.leftover || false,
            cutMargin:   o?.cutMargin ?? this.LAYOUT2D_BOX_DEFAULT_FITTING_MARGIN_SIZE,
            stats:       o?.stats ?? true,
        };
    }

    /** Next stock element at `cursor`, cut back where it would run past the layout edges and
     *  snapped to the grid along the main axis. Returns null when nothing fits any more. */
    private _layout2DBoxesNewBox(cursor: meshup.Point, o: Required<Layout2DOptions>, leftOverSize?: number | null): Polygon | null
    {
        const mainAxis = (o.direction === 'horizontal') ? 'x' : 'y'; // axis elements are laid along
        const secAxis  = (o.direction === 'horizontal') ? 'y' : 'x';

        const mainLimit = (o.direction === 'horizontal') ? o.width : o.height;
        const secLimit  = (o.direction === 'horizontal') ? o.height : o.width;

        const origBoxSize = { x: o.stockWidth, y: o.stockHeight };
        const boxSize = { ...origBoxSize };

        if (leftOverSize) // continue with what was left of the previous element
        {
            boxSize[mainAxis] = leftOverSize;
        }

        // cut back where the element would run past the layout in the secondary direction
        if (cursor[secAxis] + boxSize[secAxis] > secLimit)
        {
            boxSize[secAxis] = secLimit - cursor[secAxis];
        }

        // ... and in the main direction
        let boxLimitedPrim = false;
        if (cursor[mainAxis] + boxSize[mainAxis] > mainLimit)
        {
            boxSize[mainAxis] = mainLimit - cursor[mainAxis];
            boxLimitedPrim = true;
        }

        // if it still fits in the main direction, snap its end to the grid
        if (!boxLimitedPrim && o.grid)
        {
            const startGridOffset = (cursor[mainAxis] < o.gridOffset) ? o.gridOffset : 0;
            const sizeAlongGrid = Math.floor((boxSize[mainAxis] - startGridOffset) / o.grid) * o.grid + startGridOffset;

            if (sizeAlongGrid < 0)
            {
                // can't fit an element to the grid here: register the gap as waste
                this.stats.waste.add(this._layout2DRect(cursor, boxSize));
            }

            boxSize[mainAxis] = (sizeAlongGrid > 0)
                ? sizeAlongGrid
                : (cursor[mainAxis] + origBoxSize[mainAxis] > mainLimit)
                    ? mainLimit - cursor[mainAxis]
                    : Math.floor((origBoxSize[mainAxis] - startGridOffset) / o.grid) * o.grid + startGridOffset;
        }

        if (boxSize.x <= 0 || boxSize.y <= 0) { return null; } // nothing left to place

        return this._layout2DRect(cursor, boxSize);
    }

    /** A layout element: a flat rectangle on the XY plane from `cursor`, `size` big */
    private _layout2DRect(cursor: meshup.Point, size: { x: number, y: number }): Polygon
    {
        return this.modeler.planeBetween(
            [cursor.x, cursor.y, 0],
            [cursor.x + size.x, cursor.y + size.y, 0],
        );
    }

    /** Lay out stock elements over a rectangular area on the XY plane, cutting them to the
     *  layout edges and (optionally) to a grid. Shared engine behind boarding(). */
    private _layout2DBoxes(options?: Layout2DOptions): ShapeCollection
    {
        this.resetStats();

        if (!options?.width || !options?.height)
        {
            console.warn(`Make::_layout2DBoxes(): Zero or nullish width and height given: returned an empty ShapeCollection`);
            return this.modeler.collection();
        }

        const o = this._checkLayoutOptions(options);

        if ((o.direction === 'horizontal' && o.grid > o.stockWidth) ||
            (o.direction === 'vertical' && o.grid > o.stockHeight))
        {
            throw new Error(`Make::_layout2DBoxes(): Make sure the stock size (stockWidth or stockHeight, depending on direction) is bigger than the grid!`);
        }

        const createdElems = this.modeler.group(); // returned as one unit: give it a layer
        createdElems.name('boards'); // name() is a getter/setter, so keep it off the chain
        let cursor = this._alignment2DToPoint(o.start, o.width, o.height);

        const mainAxis = (o.direction === 'horizontal') ? 'x' : 'y';
        const mainLimit = (o.direction === 'horizontal') ? o.width : o.height;
        const secLimit = (o.direction === 'horizontal') ? o.height : o.width;

        let leftOverBoxSize: number | null = null; // remainder of the previous element, along the main axis

        // Hard stop: every iteration must place an element, so this can only be hit if the
        // cursor stops advancing — cheaper to bound than to prove it never happens.
        const MAX_ELEMENTS = 10000;

        for (let i = 0; i < MAX_ELEMENTS; i++)
        {
            const newBox = this._layout2DBoxesNewBox(cursor, o, leftOverBoxSize);
            if (!newBox) { break; } // nothing fits any more

            leftOverBoxSize = null;
            createdElems.add(newBox);

            const boxWidth = newBox.bbox().width();
            const boxDepth = newBox.bbox().depth();

            // full stock element, or one that had to be cut?
            if (Math.round(boxWidth) !== o.stockWidth || Math.round(boxDepth) !== o.stockHeight)
            {
                this.stats.cut.add(newBox);
            }
            else
            {
                this.stats.full.add(newBox);
            }

            // advance the cursor along the main axis
            cursor = (o.direction === 'horizontal')
                ? this.modeler.point(cursor.x + boxWidth, cursor.y, 0)
                : this.modeler.point(cursor.x, cursor.y + boxDepth, 0);

            // main direction filled up: start the next row
            if (cursor[mainAxis] >= mainLimit)
            {
                cursor = (o.direction === 'horizontal')
                    ? this.modeler.point(0, cursor.y + boxDepth, 0)
                    : this.modeler.point(cursor.x + boxWidth, 0, 0);

                leftOverBoxSize = (o.leftover)
                    ? ((o.direction === 'horizontal') ? o.stockWidth - boxWidth : o.stockHeight - boxDepth)
                    : null;
                if (leftOverBoxSize !== null && leftOverBoxSize <= 0) { leftOverBoxSize = null; }
            }

            // secondary direction filled up: done
            if ((o.direction === 'horizontal' && cursor.y >= secLimit) ||
                (o.direction === 'vertical' && cursor.x >= secLimit))
            {
                break;
            }
        }

        if (o.stats) { this._layout2DBoxesStats(o); }

        return createdElems;
    }

    /** Work out how much stock a finished layout needs, by nesting its cut elements */
    private _layout2DBoxesStats(o: Required<Layout2DOptions>): MakeStats
    {
        this.stats.numStock = this.stats.full.length;
        this.stats.efficiency = 100;

        if (this.stats.cut.length === 0) { return this.stats; }

        if (!this._binPacker)
        {
            // pack() is synchronous but its WASM is not: skip the nesting rather than throw,
            // the layout itself is already complete.
            console.warn(`Make::boarding(): the bin packer is not loaded yet, so cut elements were not nested — stats.efficiency and stats.wastedArea are left unset.`);
            this.stats.efficiency = null;
            return this.stats;
        }

        this.stats.fitted = this.pack(this.stats.cut, {
            width: o.stockWidth,
            height: o.stockHeight,
            kerf: o.cutMargin,
            rotation: false,
        });

        // pack() groups its results per sheet (sheet1, sheet2, …): one sheet = one stock piece
        let sheets = 0;
        this.stats.fitted.forEachGroup(() => { sheets++; });
        this.stats.numStock += sheets;

        const stockUsedArea = this.stats.numStock * o.stockWidth * o.stockHeight;
        const cutPartsArea = this.stats.cut.reduce((sum, shape) => sum + ((shape as any).area?.() ?? 0), 0);
        const fullPartsArea = this.stats.full.reduce((sum, shape) => sum + ((shape as any).area?.() ?? 0), 0);

        this.stats.efficiency = (stockUsedArea > 0)
            ? Math.round((fullPartsArea + cutPartsArea) / stockUsedArea * 100)
            : null;
        this.stats.wastedArea = stockUsedArea - fullPartsArea - cutPartsArea;

        return this.stats;
    }

    /**
     * Board up a rectangular area on the XY plane with stock elements (boards, sheets).
     *
     * Elements are laid in sequence along `direction`, cut back at the layout edges and — when
     * a `grid` is given — snapped so their ends land on that grid (how boarding meets the studs
     * behind it). With `leftover: true` the off-cut of a row starts the next one.
     *
     * Statistics on cuts, stock count and waste land on `make.stats` afterwards.
     */
    boarding(options?: Layout2DOptions): ShapeCollection
    {
        return this._layout2DBoxes(options);
    }

    //// SPECIALS WITH STRUTS AND FRAMEWORKS ////

    /**
     * Find the 2D strut of a given width that exactly fits diagonally into a rectangular space,
     * as a flat Polygon on the XY plane (extrude it to get a solid).
     *
     * NOTE: it's easiest to see how this works by considering the special cases
     * width = spaceWidth, width = spaceHeight and angle(spaceWidth, spaceHeight) = 45 deg.
     *
     * @param width      Width of the strut.
     * @param space      [width, height] of the space it has to fit into.
     * @param withSpace  Also return the space itself as a blue outline (for debugging a fit).
     */
    fitRectStrut(width: number, space: Array<number>, withSpace: boolean = false): Polygon | ShapeCollection
    {
        if (typeof width !== 'number' || !Array.isArray(space) || space.length < 2)
        {
            throw new Error(`Make::fitRectStrut(width, space): Please supply a strut width and a space as [width, height]!`);
        }

        const spaceAngle = Math.atan((space[1] - width) / (space[0] - width));
        const diagAlignHeight = Math.cos(spaceAngle) * width;
        const diagAlignWidth = Math.sin(spaceAngle) * width;

        const baseLine = this.modeler.line(
            [diagAlignWidth, 0, 0],
            [space[0], space[1] - diagAlignHeight, 0],
        );

        // Sweep the base line sideways *within* the XY plane. A straight line has no unique
        // normal, so Curve.extrude()'s own default would fall back to +Z and stand the strut
        // upright; z x direction is the in-plane perpendicular (what brep's Edge.normal() used).
        const sideways = this.modeler.vector(0, 0, 1).cross(baseLine.direction()).normalize();
        const strut = baseLine.extrude(width, sideways) as Polygon;

        if (!withSpace) { return strut; }

        return this.modeler.group( // returned as one unit: strut + its space diagram
            strut,
            this.modeler.rectBetween([0, 0, 0], [space[0], space[1], 0]).color('blue'),
        );
    }

    /**
     * Pack a collection of shapes onto rectangular sheets using guillotine bin-packing.
     *
     * Each shape is copied, laid flat on the XY plane via its OBBox principal-axis
     * alignment, and measured. The solver then assigns every copy to a sheet position
     * (optionally rotating 90°). Shapes are translated to their solution coordinates
     * and returned as a new collection.
     *
     * @param shapes  Shapes to pack — typically Meshes, Polygons or Curves.
     * @param options Sheet dimensions, kerf and solver budget.
     * @returns A collection of the placed copies, one per successfully packed shape.
     */
    public pack(shapes: ShapeCollection, options: PackOptions): ShapeCollection
    {
        const DEFAULT_PACK_OPTIONS: Required<PackOptions> = {
            width: 2440,
            height: 1220,
            kerf: 0,
            // Bound search by iterations, not wall-clock: the GDRR solver finds the
            // optimal layout for small jobs almost instantly but would otherwise burn
            // the full maxTime budget. 200 iterations is instant for a handful of
            // parts and still explores meaningfully for larger nestings. maxTime is
            // left opt-in (null) as a hard cap for very large jobs.
            maxTime: null,
            maxIterations: 200,
            rotation: true
        };

        const opts = { ...DEFAULT_PACK_OPTIONS, ...options };

        type ItemPlacement = {
            partIndex: number;
            x: number;
            y: number;
            length: number;
            height: number;
        };

        function extractPlacements(node: CuttingNode, x: number, y: number, out: ItemPlacement[]): void
        {
            if (node.kind === 'item' && node.item !== undefined)
            {
                out.push({
                    partIndex: node.item,
                    x,
                    y,
                    length: node.length,
                    height: node.height
                });
                return;
            }
            if (node.kind === 'structure')
            {
                let cx = x,
                    cy = y;
                for (const child of node.children)
                {
                    extractPlacements(child, cx, cy, out);
                    if (node.orientation === 'V') cx += child.length;
                    else cy += child.height;
                }
            }
        }

        if (!this._binPacker)
            throw new Error(
                'Make.pack(): BinPacker WASM not ready yet — call setArchiyou() and wait for the module to initialise before using pack().'
            );
        const bp = this._binPacker;
        const kerf = opts.kerf;

        // Copy each shape, lay flat, record 2D footprint
        type PreparedShape = { shape: any; fw: number; fh: number };
        const prepared: PreparedShape[] = [];

        shapes.forEach(s =>
        {
            const copy: any = (s as any).copy();
            if (typeof copy.layflat === 'function') copy.layflat();
            const bb = copy.bbox?.();
            if (!bb) return;
            prepared.push({
                shape: copy,
                fw: bb.width() as number,
                fh: bb.depth() as number
            });
        });

        if (prepared.length === 0) return this.modeler.collection();

        // Group shapes with identical footprints so the solver can treat them as
        // interchangeable (demand > 1), giving it more freedom to find a tighter layout.
        type DimGroup = { fw: number; fh: number; indices: number[] };
        const dimMap = new Map<string, DimGroup>();
        prepared.forEach(({ fw, fh }, i) =>
        {
            const key = `${Math.round(fw + kerf)}x${Math.round(fh + kerf)}`;
            if (!dimMap.has(key)) dimMap.set(key, { fw, fh, indices: [] });
            dimMap.get(key)!.indices.push(i);
        });
        const groups = Array.from(dimMap.values());
        // Per-group cursor: tracks which prepared index to hand out next for each group.
        const groupCursors = groups.map(() => 0);

        const parts: Part[] = groups.map((g, gi) => ({
            length: Math.round(g.fw + kerf),
            height: Math.round(g.fh + kerf),
            demand: g.indices.length,
            value: 1,
            reference: gi
        }));

        const instance: Instance = {
            name: 'pack',
            sheets: [
                {
                    length: Math.round(opts.width),
                    height: Math.round(opts.height),
                    cost: 1,
                    stock: null
                }
            ],
            parts
        };

        const solution = bp.solve(instance, {
            rotationAllowed: opts.rotation,
            maxRunTime: opts.maxTime,
            maxRRIterations: opts.maxIterations
        });

        const SHEET_MARGIN = 100;
        const placedIndices = new Set<number>();
        const result = this.modeler.group().name('packed'); // sheets become sub-layers below

        for (let pi = 0; pi < solution.patterns.length; pi++)
        {
            const pattern = solution.patterns[pi];
            const sheet = solution.sheets[pattern.sheet];
            const offsetX = pi * (sheet.length + SHEET_MARGIN);
            const groupShapes: any[] = [];

            // Sheet outline
            const sheetRect = this.modeler.rect(sheet.length, sheet.height, [
                sheet.length / 2,
                sheet.height / 2,
                0
            ]);
            sheetRect.translate(offsetX, 0, 0);
            groupShapes.push(sheetRect);

            // Placed parts for this sheet
            const placements: ItemPlacement[] = [];
            extractPlacements(pattern.root, 0, 0, placements);

            const halfKerf = kerf / 2;
            const tol = Math.max(1, kerf);

            for (const pl of placements)
            {
                const gi = solution.parts[pl.partIndex].reference;
                if (gi === null || gi === undefined) continue;
                const idx = groups[gi as number].indices[groupCursors[gi as number]++];
                const { shape, fw, fh } = prepared[idx];

                // Determine whether the solver rotated this part (length/height swapped)
                const fitsNormal =
                    Math.abs(pl.length - (fw + kerf)) < tol &&
                    Math.abs(pl.height - (fh + kerf)) < tol;
                const fitsRotated =
                    Math.abs(pl.length - (fh + kerf)) < tol &&
                    Math.abs(pl.height - (fw + kerf)) < tol;
                if (!fitsNormal && fitsRotated) shape.rotateZ(90);

                const bb = shape.bbox?.();
                if (!bb) continue;

                shape.translate(
                    pl.x + halfKerf - bb.minX() + offsetX,
                    pl.y + halfKerf - bb.minY(),
                    0
                );

                placedIndices.add(idx);
                groupShapes.push(shape);
            }

            result.addGroup(`sheet${pi + 1}`, groupShapes);
        }

        // Remove copies that the solver could not place (sheet too small)
        prepared.forEach(({ shape }, i) =>
        {
            if (!placedIndices.has(i)) shape.removeFromScene?.();
        });

        this.modeler.stats = { ...solution.stats };

        return result;
    }

    //// DATA GATHERING /////

    /** Generate a part list Calc table from a ShapeCollection of cuboid parts
     *  (beam-like and plate-like solids).
     *
     *  Each shape is classified and measured inline from its oriented bounding box (OBB).
     *  With dims sorted ascending → [thickness, width, length]:
     *   - beam : length dominates the larger section dim   (length / width     >= BEAM_RATIO)
     *   - plate: thin relative to its in-plane size        (width  / thickness >= PLATE_RATIO)
     *  Cube-ish blocks (neither) and non-solids are skipped.
     *
     *  For optimal information gathering:
     *   - organize shapes into groups (group name → part name)
     *   - name individual shapes (shape name → subpart name)
     */
    partList(shapes: ShapeCollection, name?: string, options?: PartListOptions): Table
    {
        const withLabels = options?.labels === true;

        /*  `label` is opt-in and goes FIRST when it is on. Off by default because scripts read
            these rows positionally (see the cadscripts) and silently shifting every column
            would break them. `docs.instruct` always asks for it. */
        const COLUMNS = [
            ...(withLabels ? ['label'] : []),
            'part',
            'subpart',
            'type',
            'section',
            'length',
            'quantity'
        ]; // TODO: materials

        if (
            !ShapeCollection.isShapeCollection(shapes) ||
            shapes.length === 0
        )
        {
            throw new Error(
                `Make::partList: Please supply a valid ShapeCollection of beam-like or plate-like shapes to generate a partlist!`
            );
        }

        console.info(
            `Make::partList(shapes, name): Got ${shapes.length} shape(s) to make a part list with. Naming and grouping shapes improves the result.`
        );

        /*  A cut list is beams and plates. A block — measurable, solid, but neither long nor
            thin — is not something you cut to length, so it is left out, as it always has
            been. docs.instruct asks collectParts() for all three kinds instead, because a
            manual step cannot point at a part that has no name. */
        const parts = collectParts(shapes, {
            kinds: ['beam', 'plate'],
            order: 'scene',
            labels: withLabels ? 'alpha' : false,
        });

        const groupedRows = parts.map(part => ([
            ...(withLabels ? [part.label] : []),
            part.group,
            part.name,
            part.measure.kind,
            part.section,
            part.length,
            part.quantity,
        ]));

        // Make Calc table
        const tableName =
            name ||
            ((shapes as any)._name && (shapes as any)._name !== 'collection'
                ? (shapes as any)._name
                : 'parts');

        const table = this.archiyou.calc.table(
            tableName,
            groupedRows,
            COLUMNS
        ) as Table;

        // Footer: total length (L x Q) per type + section, as grouped subtotal rows
        table.footer(
            {
                subpart: 'total per section',
                length: (_vals, rows) =>
                    rows.reduce(
                        (sum, r) =>
                            sum + (Number(r.length) || 0) * (Number(r.quantity) || 0),
                        0
                    )
            },
            { groupBy: ['type', 'section'] } // type & section columns auto-filled per subtotal row
        );

        return table;
    }
}
