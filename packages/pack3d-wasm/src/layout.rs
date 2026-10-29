//! One bin being filled, and the constructive decoder that fills bins from a sequence of items.
//!
//! The candidate positions are the extreme points of the boxes already in the bin (Crainic,
//! Perboli & Tadei, 2008): the corners of every placed box, moved along the other axes until they
//! touch a box or a wall. Each candidate goes through the exact checks: inside the bin, no overlap,
//! and standing (see `geom::stands`).

use std::cmp::Reverse;

use crate::geom::{Cuboid, V3, stands};
use crate::model::{Piece, Problem};

/// In which order the free positions of a bin are tried.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fill
{
    /// Bottom first, then front to back, then across: a pallet or a crate is built layer by layer.
    Layers,
    /// Front to back first, then bottom up, then across: a trailer is built wall by wall.
    Walls,
}

impl Fill
{
    fn key(self, p: V3) -> (i64, i64, i64)
    {
        match self
        {
            Fill::Layers => (p[2], p[0], p[1]),
            Fill::Walls => (p[0], p[2], p[1]),
        }
    }
}

/// How the best of the feasible positions is chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pick
{
    /// The one that ends lowest, then the first in the fill order.
    Lowest,
    /// The one that touches the most walls and boxes, then the lowest.
    Contact,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Strategy
{
    pub fill: Fill,
    pub pick: Pick,
}

/// A box in a bin. `spaced` is `real` grown by the gap along x and y: boxes may not overlap in
/// that sense, but their support is measured on the real ones.
#[derive(Clone, Debug)]
pub struct Placed
{
    pub piece: usize,
    pub orientation: u8,
    pub real: Cuboid,
    pub spaced: Cuboid,
}

/// A way to put one piece into a bin.
#[derive(Clone, Debug)]
pub struct Candidate
{
    pub position: V3,
    pub orientation: u8,
    pub extent: V3,
}

#[derive(Clone, Debug)]
pub struct Bin
{
    pub kind: usize,
    pub placed: Vec<Placed>,
    bound: Cuboid,
    points: Vec<V3>,
    fill: Fill,
}

impl Bin
{
    /// An empty bin with the inner size `dims`. The bound is a gap larger along x and y, because
    /// every box carries a gap at its far side.
    pub fn new(kind: usize, dims: V3, gap: i64, fill: Fill) -> Bin
    {
        Bin { kind, placed: Vec::new(), bound: Cuboid { min: [0, 0, 0], max: [dims[0] + gap, dims[1] + gap, dims[2]] }, points: vec![[0, 0, 0]], fill }
    }

    /// Volume of the boxes in the bin.
    pub fn volume(&self) -> u128
    {
        self.placed.iter().map(|p| p.real.volume() as u128).sum()
    }

    /// Volume of the bin itself, without the gap.
    pub fn capacity(&self, gap: i64) -> u128
    {
        Cuboid { min: self.bound.min, max: [self.bound.max[0] - gap, self.bound.max[1] - gap, self.bound.max[2]] }.volume() as u128
    }

    fn accepts(&self, position: V3, extent: V3, gap: i64, permille: i64) -> bool
    {
        let spaced = Cuboid::new(position, [extent[0] + gap, extent[1] + gap, extent[2]]);
        spaced.within(&self.bound) && !self.placed.iter().any(|other| other.spaced.overlaps(&spaced)) && stands(&Cuboid::new(position, extent), self.placed.iter().map(|other| &other.real), permille)
    }

    /// The best way to put `piece` in this bin under `strategy`, if there is one: for every orientation
    /// the first free position in the fill order that passes the checks, and of those the best pick.
    pub fn find(&self, problem: &Problem, piece: &Piece, strategy: Strategy, evaluations: &mut u64) -> Option<Candidate>
    {
        piece
            .orientations
            .iter()
            .filter_map(|&(orientation, extent)| {
                self.points
                    .iter()
                    .find(|&&position| {
                        *evaluations += 1;
                        self.accepts(position, extent, problem.gap, problem.permille)
                    })
                    .map(|&position| Candidate { position, orientation, extent })
            })
            .min_by_key(|candidate| self.score(candidate, strategy, problem.gap))
    }

    /// Smaller is better. The orientation is the last tie-break so that equal scores resolve the same way every time.
    fn score(&self, candidate: &Candidate, strategy: Strategy, gap: i64) -> (i64, i64, (i64, i64, i64), u8)
    {
        let top = candidate.position[2] + candidate.extent[2];
        let key = strategy.fill.key(candidate.position);
        match strategy.pick
        {
            Pick::Lowest => (top, 0, key, candidate.orientation),
            Pick::Contact => (-self.contact_area(candidate, gap), top, key, candidate.orientation),
        }
    }

    /// Area of the faces of the candidate that touch a wall of the bin or a box in it.
    fn contact_area(&self, candidate: &Candidate, gap: i64) -> i64
    {
        let spaced = Cuboid::new(candidate.position, [candidate.extent[0] + gap, candidate.extent[1] + gap, candidate.extent[2]]);
        let face = |other: &Cuboid, axis: usize| -> i64 {
            if spaced.min[axis] == other.max[axis] || spaced.max[axis] == other.min[axis]
            {
                let overlap = |a: usize| (spaced.max[a].min(other.max[a]) - spaced.min[a].max(other.min[a])).max(0);
                (0..3).filter(|&a| a != axis).map(overlap).product()
            }
            else
            {
                0
            }
        };
        let walls: i64 = (0..3)
            .map(|axis| {
                let other: Vec<usize> = (0..3).filter(|&a| a != axis).collect();
                let area = (spaced.max[other[0]] - spaced.min[other[0]]) * (spaced.max[other[1]] - spaced.min[other[1]]);
                (spaced.min[axis] == self.bound.min[axis]) as i64 * area + (spaced.max[axis] == self.bound.max[axis]) as i64 * area
            })
            .sum();
        walls + self.placed.iter().map(|other| (0..3).map(|axis| face(&other.spaced, axis)).sum::<i64>()).sum::<i64>()
    }

    /// Put the piece in place and work out where the next ones can go.
    pub fn commit(&mut self, piece: usize, candidate: &Candidate, gap: i64)
    {
        let real = Cuboid::new(candidate.position, candidate.extent);
        let spaced = Cuboid::new(candidate.position, [candidate.extent[0] + gap, candidate.extent[1] + gap, candidate.extent[2]]);
        self.placed.push(Placed { piece, orientation: candidate.orientation, real, spaced });
        self.update_points(&spaced);
    }

    fn update_points(&mut self, placed: &Cuboid)
    {
        self.points.retain(|&p| !placed.contains_point(p));
        // the three corners next to the new box, each moved back along the two axes that are not its own
        let (lo, hi) = (placed.min, placed.max);
        let corners = [([hi[0], lo[1], lo[2]], [1, 2]), ([lo[0], hi[1], lo[2]], [0, 2]), ([lo[0], lo[1], hi[2]], [0, 1])];
        let fresh: Vec<V3> = corners.iter().flat_map(|&(corner, axes)| axes.map(|axis| self.project(corner, axis))).collect();
        let free: Vec<V3> = fresh.into_iter().filter(|&p| self.is_free(p)).collect();
        free.into_iter().for_each(|p| {
            if !self.points.contains(&p)
            {
                self.points.push(p);
            }
        });
        let fill = self.fill;
        self.points.sort_unstable_by_key(|&p| fill.key(p));
    }

    /// Move `p` back along `axis` until it touches a box (or the wall).
    fn project(&self, p: V3, axis: usize) -> V3
    {
        let (a, b) = match axis
        {
            0 => (1, 2),
            1 => (0, 2),
            _ => (0, 1),
        };
        let stop = self
            .placed
            .iter()
            .filter(|q| q.spaced.min[a] <= p[a] && p[a] < q.spaced.max[a] && q.spaced.min[b] <= p[b] && p[b] < q.spaced.max[b] && q.spaced.max[axis] <= p[axis])
            .map(|q| q.spaced.max[axis])
            .max()
            .unwrap_or(0);
        let mut moved = p;
        moved[axis] = stop;
        moved
    }

    /// Whether anything could start at `p`: it is inside the bin and not inside a box.
    fn is_free(&self, p: V3) -> bool
    {
        (0..3).all(|a| p[a] < self.bound.max[a]) && !self.placed.iter().any(|q| q.spaced.contains_point(p))
    }
}

/// The bins a sequence of pieces ended up in, and the pieces that went nowhere.
#[derive(Clone, Debug)]
pub struct Layout
{
    pub bins: Vec<Bin>,
    pub unplaced: Vec<usize>,
}

/// Put the pieces in `sequence` into bins, one after the other: into the first open bin that takes
/// the piece, else into a new bin of the cheapest kind that can hold it and has stock left.
pub fn decode(problem: &Problem, sequence: &[usize], strategy: Strategy, evaluations: &mut u64) -> Layout
{
    let mut used = vec![0u32; problem.kinds.len()];
    sequence.iter().fold(Layout { bins: Vec::new(), unplaced: Vec::new() }, |mut layout, &index| {
        let piece = &problem.pieces[index];
        let open = (0..layout.bins.len()).find_map(|b| layout.bins[b].find(problem, piece, strategy, evaluations).map(|candidate| (b, candidate)));
        match open
        {
            Some((b, candidate)) => layout.bins[b].commit(index, &candidate, problem.gap),
            None => match open_bin(problem, piece, strategy, &mut used, evaluations)
            {
                Some((mut bin, candidate)) =>
                {
                    bin.commit(index, &candidate, problem.gap);
                    layout.bins.push(bin);
                }
                None => layout.unplaced.push(index),
            },
        }
        layout
    })
}

/// A new bin for `piece`: the cheapest kind with stock left that the piece fits in (smaller volume,
/// then lower index, on equal cost), together with where the piece goes in it.
fn open_bin(problem: &Problem, piece: &Piece, strategy: Strategy, used: &mut [u32], evaluations: &mut u64) -> Option<(Bin, Candidate)>
{
    let mut kinds: Vec<usize> = (0..problem.kinds.len())
        .filter(|&k| problem.kinds[k].stock.is_none_or(|stock| used[k] < stock))
        .filter(|&k| piece.orientations.iter().any(|&(_, extent)| (0..3).all(|a| extent[a] <= problem.kinds[k].dims[a])))
        .collect();
    kinds.sort_by_key(|&k| (problem.kinds[k].cost, problem.kinds[k].dims.iter().map(|&d| d as i128).product::<i128>(), k));
    kinds.into_iter().find_map(|k| {
        let bin = Bin::new(k, problem.kinds[k].dims, problem.gap, strategy.fill);
        bin.find(problem, piece, strategy, evaluations).map(|candidate| {
            used[k] += 1;
            (bin, candidate)
        })
    })
}

/// What a layout is judged by, most important first; derived `Ord` makes smaller better.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Objective
{
    pub unplaced: usize,
    pub cost: u64,
    pub bins: usize,
    /// The sum of the squared fills (in millionths): a few full bins beat many half-full ones.
    pub concentration: Reverse<u128>,
}

pub fn objective(problem: &Problem, layout: &Layout) -> Objective
{
    let fill_ppm = |bin: &Bin| bin.volume() * 1_000_000 / bin.capacity(problem.gap).max(1);
    Objective {
        unplaced: layout.unplaced.len(),
        cost: layout.bins.iter().map(|bin| problem.kinds[bin.kind].cost).sum(),
        bins: layout.bins.len(),
        concentration: Reverse(layout.bins.iter().map(|bin| fill_ppm(bin) * fill_ppm(bin)).sum()),
    }
}

#[cfg(test)]
mod tests
{
    use super::*;
    use crate::model::{Config, Instance};

    fn problem(json: &str, config: Config) -> Problem
    {
        Problem::new(&serde_json::from_str::<Instance>(json).unwrap(), &config).unwrap()
    }

    const LAYERS: Strategy = Strategy { fill: Fill::Layers, pick: Pick::Lowest };

    fn put(bin: &mut Bin, problem: &Problem, piece: usize, at: V3, orientation: u8)
    {
        let extent = problem.pieces[piece].orientations.iter().find(|o| o.0 == orientation).unwrap().1;
        bin.commit(piece, &Candidate { position: at, orientation, extent }, problem.gap);
    }

    #[test]
    fn the_first_piece_goes_to_the_corner_and_the_next_one_beside_it_across_the_width()
    {
        let p = problem(r#"{ "items": [{ "dims": [400, 400, 400], "count": 2, "orientations": 1 }], "bins": [{ "dims": [1000, 1000, 1000] }] }"#, Config::default());
        let layout = decode(&p, &[0, 1], LAYERS, &mut 0);
        assert!(layout.unplaced.is_empty());
        let positions: Vec<V3> = layout.bins[0].placed.iter().map(|b| b.real.min).collect();
        assert_eq!(positions, [[0, 0, 0], [0, 400, 0]]);
    }

    #[test]
    fn the_walls_order_builds_across_the_width_before_it_goes_deeper()
    {
        let p = problem(r#"{ "items": [{ "dims": [400, 400, 400], "count": 3, "orientations": 1 }], "bins": [{ "dims": [1000, 1000, 1000] }] }"#, Config::default());
        let walls = decode(&p, &[0, 1, 2], Strategy { fill: Fill::Walls, pick: Pick::Lowest }, &mut 0);
        let positions: Vec<V3> = walls.bins[0].placed.iter().map(|b| b.real.min).collect();
        assert_eq!(positions, [[0, 0, 0], [0, 400, 0], [0, 0, 400]], "second beside the first across y, third on top of the first");
        let layers = decode(&p, &[0, 1, 2], LAYERS, &mut 0);
        let positions: Vec<V3> = layers.bins[0].placed.iter().map(|b| b.real.min).collect();
        assert_eq!(positions, [[0, 0, 0], [0, 400, 0], [400, 0, 0]], "layers fill the floor before they stack");
    }

    #[test]
    fn a_plate_is_not_put_on_a_pillar_that_carries_too_little_of_it()
    {
        // piece 0 is a 400 x 400 x 400 block in the corner of a 600 x 500 bin, piece 1 a 500 x 500 plate: the plate
        // does not fit beside the block, so the top of the block is its only place (64 % of its base rests on it)
        let json = r#"{ "items": [{ "dims": [400, 400, 400], "orientations": 1 }, { "dims": [500, 500, 50], "orientations": 1 }],
                        "bins": [{ "dims": [600, 500, 1000] }] }"#;
        let strict = problem(json, Config { support: 0.8, ..Config::default() });
        let mut bin = Bin::new(0, [600, 500, 1000], 0, Fill::Layers);
        put(&mut bin, &strict, 0, [0, 0, 0], 0);
        assert!(bin.find(&strict, &strict.pieces[1], LAYERS, &mut 0).is_none(), "64 % of the base is not 80 %");

        // the control: with 50 % asked, the same plate rests on the block
        let loose = problem(json, Config { support: 0.5, ..Config::default() });
        let found = bin.find(&loose, &loose.pieces[1], LAYERS, &mut 0).expect("the plate rests on the block");
        assert_eq!(found.position, [0, 0, 400]);
    }

    #[test]
    fn a_piece_whose_centre_is_past_its_support_is_refused_even_when_the_share_is_met()
    {
        // a 1000 x 200 board on a 450 x 200 block at one end: 45 % of its base, but the centre (x = 500) hangs in the air
        let json = r#"{ "items": [{ "dims": [450, 200, 300], "orientations": 1 }, { "dims": [1000, 200, 50], "orientations": 1 }],
                        "bins": [{ "dims": [1000, 200, 1000] }] }"#;
        let p = problem(json, Config { support: 0.4, ..Config::default() });
        let mut bin = Bin::new(0, [1000, 200, 1000], 0, Fill::Layers);
        put(&mut bin, &p, 0, [0, 0, 0], 0);
        // the board cannot go on the floor beside the block (it is as long as the bin), so it has to go on top
        assert!(bin.find(&p, &p.pieces[1], LAYERS, &mut 0).is_none(), "45 % passes the share, the centre does not pass the hull");
        // the control: a block under the middle of the board holds it
        let mut middle = Bin::new(0, [1000, 200, 1000], 0, Fill::Layers);
        put(&mut middle, &p, 0, [275, 0, 0], 0);
        assert!(middle.find(&p, &p.pieces[1], LAYERS, &mut 0).is_some());
    }

    #[test]
    fn the_gap_is_kept_between_pieces()
    {
        let json = r#"{ "items": [{ "dims": [500, 500, 500], "count": 2, "orientations": 1 }], "bins": [{ "dims": [1000, 500, 500] }] }"#;
        let tight = decode(&problem(json, Config::default()), &[0, 1], LAYERS, &mut 0);
        assert_eq!(tight.bins.len(), 1, "two fit side by side without a gap");
        let spaced_problem = problem(json, Config { gap: 10, ..Config::default() });
        let spaced = decode(&spaced_problem, &[0, 1], LAYERS, &mut 0);
        assert_eq!(spaced.bins.len(), 2, "with 10 mm between them they no longer do");
    }

    #[test]
    fn the_cheapest_kind_that_holds_the_piece_is_opened_until_its_stock_runs_out()
    {
        let json = r#"{ "items": [{ "dims": [600, 600, 600], "count": 4, "orientations": 1 }],
                        "bins": [{ "dims": [500, 500, 500], "cost": 1 }, { "dims": [1000, 1000, 1000], "cost": 4, "stock": 2 }, { "dims": [700, 700, 700], "cost": 2, "stock": 1 }] }"#;
        let p = problem(json, Config::default());
        let layout = decode(&p, &[0, 1, 2, 3], LAYERS, &mut 0);
        let kinds: Vec<usize> = layout.bins.iter().map(|b| b.kind).collect();
        // the 500 bin is too small for any piece; the first piece takes the cheaper of the others (700, cost 2, one in stock),
        // the next two need a 1000 bin each (two 600 cubes do not share one), and for the fourth nothing is left
        assert_eq!(kinds, [2, 1, 1]);
        assert_eq!(layout.unplaced, [3]);
    }

    #[test]
    fn a_piece_that_fits_no_bin_is_unplaced_not_an_error()
    {
        let p = problem(r#"{ "items": [{ "dims": [2000, 10, 10], "orientations": 63 }], "bins": [{ "dims": [1000, 1000, 1000] }] }"#, Config::default());
        let layout = decode(&p, &[0], LAYERS, &mut 0);
        assert_eq!((layout.bins.len(), layout.unplaced.clone()), (0, vec![0]));
    }

    #[test]
    fn the_objective_prefers_fewer_unplaced_then_cheaper_then_fuller()
    {
        let o = |unplaced, cost, bins, concentration: u128| Objective { unplaced, cost, bins, concentration: Reverse(concentration) };
        assert!(o(0, 9, 9, 0) < o(1, 1, 1, 9));
        assert!(o(0, 3, 9, 0) < o(0, 4, 1, 9));
        assert!(o(0, 3, 2, 0) < o(0, 3, 3, 9));
        assert!(o(0, 3, 2, 9) < o(0, 3, 2, 1));
    }
}
