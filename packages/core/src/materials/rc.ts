/**
 *  materials/rc.ts — the thermal resistance of a build-up, by the combined method of ISO 6946.
 *
 *  A build-up is a set of boxes, each with the λ of its material: the studs, plates, insulation
 *  and boards of a wall, square to the axes. Heat flows along one axis (`axis`, the depth of
 *  the wall). Over the face (the other two axes) a grid of paths is laid; each path meets the
 *  boxes it crosses. Then, as ISO 6946 6.7.2:
 *
 *   - upper limit R'T: the paths in parallel, each with its own layers in series
 *       1/R'T = Σ fj / RT,j
 *   - lower limit R''T: the layers in series, each with the parallel λ of what lies in it
 *       R''T = Rsi + Σ dk / λ''k + Rse,   λ''k = Σ f λ over the face in layer k
 *   - RT = (R'T + R''T) / 2,   Rc = RT - Rsi - Rse
 *
 *  Space a path crosses where no box is counts as an unventilated air layer, at most 0.18 m²K/W
 *  (ISO 6946 table 8 for a few cm and more; thin gaps scale down with their thickness).
 *  Only boxes with a λ count: screws, tape and things without a material are not in it.
 */

export type Vec3 = [number, number, number];

export interface ThermalBox
{
    min: Vec3;
    max: Vec3;
    /** W/(m·K) */
    lambda: number;
}

export interface RcOptions
{
    /** The axis the heat flows along: 0 x, 1 y, 2 z. Default: the thinnest of the whole. */
    axis?: number;
    /** Metres per model unit. Default 0.001 (mm). */
    unit?: number;
    /** Distance between the paths over the face, in model units. Default 10. */
    grid?: number;
    /** Surface resistances, m²K/W. Default 0.13 and 0.04 (heat flowing horizontally, a wall). */
    rsi?: number;
    rse?: number;
}

export interface RcResult
{
    /** m²K/W, without the surface resistances: the value of the Bbl. */
    rc: number;
    /** U = 1 / RT, W/(m²K) */
    u: number;
    /** The upper and lower limit of RT, m²K/W (with the surface resistances). */
    upper: number;
    lower: number;
    /** The layers along the axis: thickness (m) and their parallel λ. */
    layers: Array<{ thickness: number; lambda: number }>;
}

/** The R of an unventilated air layer `d` metres thick. */
const AIR_LAYER_MAX = 0.18;
const airR = (d: number): number => Math.min(AIR_LAYER_MAX, d * AIR_LAYER_MAX / 0.025);   // full from 25 mm on

export function rcOfBoxes(boxes: Array<ThermalBox>, options: RcOptions = {}): RcResult
{
    const solid = boxes.filter(b => b.lambda > 0 && [0, 1, 2].every(i => b.max[i]! > b.min[i]!));
    if (!solid.length) { throw new Error('rcOfBoxes(): no boxes with a λ'); }

    const lo = [0, 1, 2].map(i => Math.min(...solid.map(b => b.min[i]!))) as Vec3;
    const hi = [0, 1, 2].map(i => Math.max(...solid.map(b => b.max[i]!))) as Vec3;
    const axis = options.axis ?? [0, 1, 2].reduce((a, i) => (hi[i]! - lo[i]! < hi[a]! - lo[a]! ? i : a), 0);
    const [u, v] = [0, 1, 2].filter(i => i !== axis) as [number, number];
    const unit = options.unit ?? 0.001;
    const grid = options.grid ?? 10;
    const rsi = options.rsi ?? 0.13;
    const rse = options.rse ?? 0.04;

    // the layers: between every face of a box along the axis
    const cuts = [...new Set(solid.flatMap(b => [b.min[axis]!, b.max[axis]!]))].sort((a, b) => a - b);
    const slabs = cuts.slice(1).map((top, k) => ({ from: cuts[k]!, to: top, mid: (cuts[k]! + top) / 2 }));

    // the paths: the middle of each cell of the grid over the face
    const count = (i: number) => Math.max(1, Math.round((hi[i]! - lo[i]!) / grid));
    const [nu, nv] = [count(u), count(v)];
    const du = (hi[u]! - lo[u]!) / nu, dv = (hi[v]! - lo[v]!) / nv;
    const paths = nu * nv;

    let conductance = 0;                                     // Σ fj / RT,j
    const layerLambda = slabs.map(() => 0);                  // Σ f λ per layer
    for (let i = 0; i < nu; i++)
    {
        const pu = lo[u]! + (i + 0.5) * du;
        const across = solid.filter(b => b.min[u]! <= pu && pu <= b.max[u]!);
        for (let j = 0; j < nv; j++)
        {
            const pv = lo[v]! + (j + 0.5) * dv;
            const here = across.filter(b => b.min[v]! <= pv && pv <= b.max[v]!);
            let r = rsi + rse;
            let gap = 0;
            slabs.forEach((slab, k) =>
            {
                const d = (slab.to - slab.from) * unit;
                const box = here.find(b => b.min[axis]! <= slab.mid && slab.mid <= b.max[axis]!);
                if (box)
                {
                    if (gap) { r += airR(gap); gap = 0; }
                    r += d / box.lambda;
                    layerLambda[k] += box.lambda / paths;
                }
                else
                {
                    gap += d;
                    layerLambda[k] += (d > 0 ? d / airR(d) : 0) / paths;   // the λ an air layer this thick has
                }
            });
            if (gap) { r += airR(gap); }
            conductance += 1 / paths / r;
        }
    }

    const layers = slabs.map((slab, k) => ({ thickness: (slab.to - slab.from) * unit, lambda: layerLambda[k]! }));
    const upper = 1 / conductance;
    const lower = rsi + rse + layers.reduce((sum, l) => sum + (l.thickness > 0 ? l.thickness / l.lambda : 0), 0);
    const rt = (upper + lower) / 2;
    return { rc: rt - rsi - rse, u: 1 / rt, upper, lower, layers };
}
