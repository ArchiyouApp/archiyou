/**
 *  foldoutView.ts
 *    The geometry of make.foldoutView(): where each elevation goes around the plan, and where
 *    the projection lines between them start and end. Plain numbers on the sheet (the XY plane
 *    the drawings lie on), no kernel: Make.foldoutView() does the projecting and the shapes.
 *
 *    A fold-out view is a multiview orthographic projection (the "glass box", unfolded) laid
 *    out around the plan: each elevation is turned so it shares an axis with the plan, and a
 *    feature lies on one line across both (a projection line, or "ligne de rappel").
 */

/** A side of the model an elevation looks from */
export type FoldoutSide = 'front' | 'back' | 'left' | 'right';

/** Where the views go: 'third' angle puts a view on the side it looks at, its top toward the
 *  plan; 'first' angle on the opposite side, its base toward the plan */
export type FoldoutProjection = 'third' | 'first';

export const FOLDOUT_SIDES: ReadonlyArray<FoldoutSide> = Object.freeze(['front', 'back', 'left', 'right']);

/** A point on the sheet */
export type SheetPoint = { x: number, y: number };

/** A straight piece of a drawn line on the sheet */
export type SheetSegment = [SheetPoint, SheetPoint];

/** How an elevation is turned and placed against the plan */
export interface FoldoutPlacement
{
    /** Degrees about Z, turning the elevation as drawn (world up is sheet up) into place */
    rotation: number
    /** The sheet axis the view shares with the plan: features line up along it */
    axis: 'x' | 'y'
    /** The other axis: the view sits next to the plan along it */
    across: 'x' | 'y'
    /** Which way from the plan: -1 below or left of it, 1 above or right of it */
    side: -1 | 1
}

/** Third angle: the front below the plan, the back above, left and right at their sides, each
 *  with its top toward the plan. The rotations keep each elevation a view, never a mirror:
 *  the front is drawn with world x to the right, so it needs no turn; the right one has world y
 *  to the right and turns a quarter left to lay y along the plan's y. */
const THIRD_ANGLE: Record<FoldoutSide, FoldoutPlacement> = {
    front: { rotation: 0, axis: 'x', across: 'y', side: -1 },
    back: { rotation: 180, axis: 'x', across: 'y', side: 1 },
    left: { rotation: -90, axis: 'y', across: 'x', side: -1 },
    right: { rotation: 90, axis: 'y', across: 'x', side: 1 },
};

/** How a side is placed in the given projection. First angle turns the same way and sits on the
 *  other side of the plan, which puts the base of each view toward the plan. */
export function foldoutPlacement(side: FoldoutSide, projection: FoldoutProjection = 'third'): FoldoutPlacement
{
    const third = THIRD_ANGLE[side];
    return (projection === 'first') ? { ...third, side: -third.side as -1 | 1 } : third;
}

/** Turn a sheet point about the origin */
export function rotateSheetPoint(p: SheetPoint, degrees: number): SheetPoint
{
    const a = degrees * Math.PI / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    // round off the noise of a quarter turn, so a coordinate stays exact
    const clean = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v);
    return { x: clean(p.x * c - p.y * s), y: clean(p.x * s + p.y * c) };
}

/** Where along `axis` the line at `coordinate` meets a set of segments: every crossing, and the
 *  ends of segments lying on that line */
export function crossingsAt(segments: Array<SheetSegment>, axis: 'x' | 'y', coordinate: number, tolerance: number): Array<number>
{
    const across = (axis === 'x') ? 'y' : 'x';
    return segments.flatMap(([a, b]) =>
    {
        const [ca, cb] = [a[axis], b[axis]];
        if (Math.abs(ca - cb) <= tolerance)
        {
            return (Math.abs(ca - coordinate) <= tolerance) ? [a[across], b[across]] : [];
        }
        if (coordinate < Math.min(ca, cb) - tolerance || coordinate > Math.max(ca, cb) + tolerance) return [];
        const t = Math.min(1, Math.max(0, (coordinate - ca) / (cb - ca)));
        return [a[across] + t * (b[across] - a[across])];
    });
}

/** The point of a drawing furthest toward `direction` (-1 or 1, along the axis across `axis`)
 *  on the line at `coordinate`: what an onlooker from that side sees first. Null when the line
 *  misses the drawing. */
export function outermostAt(segments: Array<SheetSegment>, axis: 'x' | 'y', coordinate: number, direction: -1 | 1, tolerance: number): number | null
{
    const hits = crossingsAt(segments, axis, coordinate, tolerance);
    if (!hits.length) return null;
    return (direction > 0) ? Math.max(...hits) : Math.min(...hits);
}

/** The corners of a drawing that can be projected to the view on `side` of it: points that are
 *  the outermost toward that side at their own coordinate, so a line from them out to the view
 *  crosses nothing of the drawing. Returned as coordinates along `axis`, once each, in order.
 *
 *  @param corners the candidate points: the corners of the convex hull for the outline, every
 *      vertex for all features
 */
export function projectableCoordinates(
    corners: Array<SheetPoint>,
    segments: Array<SheetSegment>,
    placement: Pick<FoldoutPlacement, 'axis' | 'across' | 'side'>,
    tolerance: number,
): Array<number>
{
    const { axis, across, side } = placement;
    const visible = corners.filter(p =>
    {
        const outer = outermostAt(segments, axis, p[axis], side, tolerance);
        return outer !== null && Math.abs(outer - p[across]) <= tolerance;
    });
    return visible
        .map(p => p[axis])
        .sort((a, b) => a - b)
        .reduce((unique: Array<number>, c) =>
            (unique.length && Math.abs(c - unique[unique.length - 1]) <= tolerance) ? unique : [...unique, c], []);
}

/** The corners of the convex hull of a set of points (Andrew's monotone chain) */
export function convexHull(points: Array<SheetPoint>): Array<SheetPoint>
{
    const sorted = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y));
    if (sorted.length < 3) return sorted;
    const cross = (o: SheetPoint, a: SheetPoint, b: SheetPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    // drop the last corners while they turn the wrong way, then add the point
    const convex = (hull: Array<SheetPoint>, p: SheetPoint): Array<SheetPoint> =>
        (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0)
            ? convex(hull.slice(0, -1), p)
            : hull;
    const chain = (pts: Array<SheetPoint>) => pts.reduce((hull: Array<SheetPoint>, p) => [...convex(hull, p), p], []);
    const lower = chain(sorted);
    const upper = chain([...sorted].reverse());
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** One projection line: from the plan out to the view, with a gap at both ends. Null when the
 *  two are too close to leave a line between the gaps. */
export function projectionLine(
    coordinate: number,
    planEdge: number,
    viewEdge: number,
    placement: Pick<FoldoutPlacement, 'axis' | 'side'>,
    gap: number,
): SheetSegment | null
{
    const { axis, side } = placement;
    const from = planEdge + side * gap;
    const to = viewEdge - side * gap;
    if ((to - from) * side <= 0) return null;
    const at = (across: number): SheetPoint => (axis === 'x') ? { x: coordinate, y: across } : { x: across, y: coordinate };
    return [at(from), at(to)];
}
