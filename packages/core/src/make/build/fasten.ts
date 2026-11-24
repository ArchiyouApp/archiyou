/**
 *  make/build/fasten.ts — where screws go between two sets of parts. Lightweight on purpose.
 *
 *  make.fasten(from, into, options) draws a screw as two curves: a circle on the face it goes
 *  in at (the work face: where you hold the screwdriver) and a line along its full length, so
 *  the length and where the tip ends up can be checked in the model. This file only does the
 *  geometry: find the faces where a part of `from` lies against a part of `into`, and lay the
 *  screws out on each contact by a pattern.
 *
 *  Contacts are found from bounding boxes, so this is for parts that lie square to the axes, as
 *  framing and boards do: two boxes touch when they meet along one axis (within `TOLERANCE`) and
 *  overlap along the other two.
 *
 *  Patterns, on each contact:
 *   - 'row' (default): screws `pitch` apart along the long side of the contact, `edge` from its
 *     ends, on its middle line. A board on a stud, a stud on a plate lying flat.
 *   - 'end': `count` screws spread over the long side of the contact. Two screws through a plate
 *     into the end of a stud.
 *
 *  A screw goes through the part of `from` into the part of `into`, unless it is not longer than
 *  the part of `from` is thick there: then it goes the other way, through the part of `into`
 *  (a header lying with its end against a stud gets its screws through the stud). A pair where it
 *  fits through neither is left out.
 */

/** Two bounding boxes touch when they are this close along one axis (model units). */
export const TOLERANCE = 0.5;

export type Vec3 = [number, number, number];

export interface Box3
{
    min: Vec3;
    max: Vec3;
}

export interface FastenOptions
{
    /** Product id of the screw, as in the products sheet: 'schroef-rvs-6x100'. Its diameter and
     *  length are read from the id ('…6x100') unless given. */
    product?: string;
    /** Diameter of the screw. */
    diameter?: number;
    /** Length of the screw. */
    length?: number;
    /** 'row' (default) or 'end'. */
    pattern?: 'row' | 'end';
    /** Distance between screws in a row. Default 150 mm (in model units: 150 / mm per unit). */
    pitch?: number;
    /** Screws on each contact, for the pattern 'end'. Default 2. */
    count?: number;
    /** Distance from the ends of a contact to the first and last screw. Default 3 × the
     *  diameter, at least 10 mm. */
    edge?: number;
    /** The component of the products sheet the screws belong to ('hsbwand'), so its labour
     *  recipe prices them and complete() knows the model has them. */
    component?: string;
    /** What they fasten, for the product list: 'buitenplaat op het frame'. */
    label?: string;
}

export interface Screw
{
    /** Where it goes in: on the outer face of the part of `from`. */
    head: Vec3;
    /** Its direction, along one axis. */
    direction: Vec3;
    /** Where the tip is: head + length × direction. */
    tip: Vec3;
    /** Thickness of the part it goes through first. */
    through: number;
    /** How far it reaches into the second part. */
    penetration: number;
    /** Thickness of the second part along the screw. */
    into: number;
    /** Index of the part of `from` and of `into`. */
    pair: [number, number];
}

/** Diameter and length from a product id like 'schroef-rvs-4.5x50'. */
export function screwSize(product: string | undefined): { diameter?: number; length?: number }
{
    const match = String(product ?? '').match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?!.*\d+x\d)/);
    return match ? { diameter: Number(match[1]), length: Number(match[2]) } : {};
}

/** Where box `a` lies against box `b`: the axis they meet along, the side of `b`, and the
 *  rectangle they share on the other two axes. Null when they do not touch face to face. */
export function contact(a: Box3, b: Box3): { axis: number; sign: 1 | -1; lo: Vec3; hi: Vec3 } | null
{
    const overlap = [0, 1, 2].map(i => Math.min(a.max[i]!, b.max[i]!) - Math.max(a.min[i]!, b.min[i]!));
    const meets = [0, 1, 2].filter(i => Math.abs(overlap[i]!) <= TOLERANCE);
    if (meets.length !== 1) return null;
    const axis = meets[0]!;
    const others = [0, 1, 2].filter(i => i !== axis);
    if (others.some(i => overlap[i]! <= TOLERANCE)) return null;

    const sign = Math.abs(a.max[axis]! - b.min[axis]!) <= TOLERANCE ? 1 : -1;
    const lo = [0, 1, 2].map(i => Math.max(a.min[i]!, b.min[i]!)) as Vec3;
    const hi = [0, 1, 2].map(i => Math.min(a.max[i]!, b.max[i]!)) as Vec3;
    lo[axis] = hi[axis] = sign > 0 ? a.max[axis]! : a.min[axis]!;
    return { axis, sign, lo, hi };
}

/** Positions along a line from `lo` to `hi`: `count` of them spread with `edge` from the ends,
 *  or one in the middle when the line is too short for that. */
function spread(lo: number, hi: number, count: number, edge: number): number[]
{
    const length = hi - lo;
    if (count <= 1 || length <= 2 * edge) return [(lo + hi) / 2];
    return Array.from({ length: count }, (_, i) => lo + edge + i * (length - 2 * edge) / (count - 1));
}

/** The screws between two sets of boxes. */
export function layOut(from: Box3[], into: Box3[], options: Required<Pick<FastenOptions, 'diameter' | 'length' | 'pattern' | 'pitch' | 'count' | 'edge'>>): Screw[]
{
    const screws: Screw[] = [];
    from.forEach((a, ia) => into.forEach((b, ib) =>
    {
        if (a === b) return;
        const c = contact(a, b);
        if (!c) return;

        const others = [0, 1, 2].filter(i => i !== c.axis);
        // the long side of the contact carries the row; the short side puts it in the middle
        const [along, across] = (c.hi[others[0]!]! - c.lo[others[0]!]!) >= (c.hi[others[1]!]! - c.lo[others[1]!]!)
            ? [others[0]!, others[1]!] : [others[1]!, others[0]!];
        const length = c.hi[along]! - c.lo[along]!;
        const count = options.pattern === 'end'
            ? options.count
            : Math.max(1, Math.ceil(Math.max(0, length - 2 * options.edge) / options.pitch) + 1);

        // through the part it fits through: a screw longer than the first part goes into the
        // second; where it is not (a header against the side of a stud) it goes in from the
        // other side, through the stud into the end of the header
        const thickA = a.max[c.axis]! - a.min[c.axis]!;
        const thickB = b.max[c.axis]! - b.min[c.axis]!;
        const flip = thickA >= options.length && thickB < options.length;
        if (thickA >= options.length && !flip) return;
        const [first, sign] = flip ? [b, -c.sign] : [a, c.sign];
        const through = flip ? thickB : thickA;
        const intoDepth = flip ? thickA : thickB;
        const direction = [0, 0, 0] as Vec3;
        direction[c.axis] = sign;

        spread(c.lo[along]!, c.hi[along]!, count, options.edge).forEach(position =>
        {
            const head = [0, 0, 0] as Vec3;
            head[along] = position;
            head[across] = (c.lo[across]! + c.hi[across]!) / 2;
            head[c.axis] = sign > 0 ? first.min[c.axis]! : first.max[c.axis]!;   // the outer face of the first part
            const tip = head.map((v, i) => v + direction[i]! * options.length) as Vec3;
            screws.push({ head, direction, tip, through, penetration: options.length - through, into: intoDepth, pair: [ia, ib] });
        });
    }));
    return screws;
}
