//! One bin being filled, and the constructive decoder that fills bins from a sequence of items.
//!
//! The candidate positions are the extreme points of the boxes already in the bin (Crainic,
//! Perboli & Tadei, 2008): the corners of every placed box, moved along the other axes until they
//! touch a box or a wall. Each candidate goes through the exact checks: inside the bin, no overlap,
//! standing (see `geom::stands`), the weight limit of the bin, the load limits of the boxes under
//! it, and the unloading order.

use std::cmp::Reverse;

use crate::balance::{allowed_moment, report, shift_into};
use crate::geom::{Cuboid, V3, stands};
use crate::model::{Door, Kind, Piece, Problem};

/// In which order the free positions of a bin are tried.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fill
{
    /// Bottom first, then front to back, then across: a pallet or a crate is built layer by layer.
    Layers,
    /// Front to back first, then bottom up, then across: a trailer is built wall by wall.
    Walls,
    /// The same, with the walls running along y: for a bin with a door on its long side.
    Rows,
}

impl Fill
{
    fn key(self, p: V3) -> (i64, i64, i64)
    {
        match self
        {
            Fill::Layers => (p[2], p[0], p[1]),
            Fill::Walls => (p[0], p[2], p[1]),
            Fill::Rows => (p[1], p[2], p[0]),
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

/// Which kind of bin is opened when a piece fits none of the open ones.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Open
{
    /// The one that costs least per volume: the best for many pieces. The last bins are made cheaper afterwards.
    PerVolume,
    /// The one that costs least: the best for few pieces.
    Cheapest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Strategy
{
    pub fill: Fill,
    pub pick: Pick,
    pub open: Open,
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
    weight: u64,
    max_load: Option<u64>,
    stop: u32,
    /// What it rests on, as (index in the bin's `placed`, contact area) in placement order. Empty on the floor.
    supports: Vec<(usize, i64)>,
    /// The weight that rests on it, directly or through other boxes. Only kept while some item has a load limit.
    load: u64,
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
    weight: u64,
    /// The doubled moment of the load about x = 0 and y = 0, in the frame the decoder works in.
    moment: [i128; 2],
    /// The extent of the load along x and y, in the same frame (empty: `i64::MAX` and `i64::MIN`).
    low: [i64; 2],
    high: [i64; 2],
    max_weight: Option<u64>,
    door: Option<Door>,
}

/// `total` shared over the boxes that carry it, in proportion to their area of contact, each share
/// rounded up to the gram. A box on the floor has no supports and passes its weight on to nobody.
fn shares(total: u64, supports: &[(usize, i64)]) -> Vec<(usize, u64)>
{
    let area: u128 = supports.iter().map(|&(_, a)| a as u128).sum();
    if area == 0
    {
        return Vec::new();
    }
    supports.iter().map(|&(i, a)| (i, (total as u128 * a as u128).div_ceil(area) as u64)).collect()
}

/// Whether `later`, which is unloaded after `earlier`, is in its way: over it, or between it and the door.
fn blocks(door: Option<Door>, later: &Cuboid, earlier: &Cuboid) -> bool
{
    let overlap = |axis: usize| later.min[axis] < earlier.max[axis] && earlier.min[axis] < later.max[axis];
    let above = later.min[2] >= earlier.max[2] && overlap(0) && overlap(1);
    let in_front = door.is_some_and(|door| {
        let (axis, towards_max) = match door
        {
            Door::PosX => (0, true),
            Door::NegX => (0, false),
            Door::PosY => (1, true),
            Door::NegY => (1, false),
        };
        let beyond = if towards_max { later.min[axis] >= earlier.max[axis] } else { later.max[axis] <= earlier.min[axis] };
        beyond && (0..3).filter(|&a| a != axis).all(overlap)
    });
    above || in_front
}

/// The shifts, in the frame the decoder works in, that bring a load into the balance the kind asks for:
/// along x and along y, within the room the load has in the bin.
fn best_shifts(kind: &Kind, weight: u64, moment: [i128; 2], low: [i64; 2], high: [i64; 2]) -> [i64; 2]
{
    let Some(spec) = kind.balance.as_ref()
    else
    {
        return [0, 0];
    };
    let w = weight as i128;
    [0, 1].map(|axis| {
        let real_moment = if kind.flip[axis] { 2 * kind.dims[axis] as i128 * w - moment[axis] } else { moment[axis] };
        // the room is measured in the decoded frame; seen from the real one it is the other way round when mirrored
        let room = (-low[axis], kind.dims[axis] - high[axis]);
        let free = if kind.flip[axis] { (-room.1, -room.0) } else { room };
        let real_shift = shift_into(allowed_moment(spec, kind.dims, w, axis), real_moment, w, free);
        if kind.flip[axis] { -real_shift } else { real_shift }
    })
}

/// Whether a load can be moved into the balance the kind asks for.
fn can_balance(kind: &Kind, weight: u64, moment: [i128; 2], low: [i64; 2], high: [i64; 2]) -> bool
{
    if kind.balance.is_none() || weight == 0
    {
        return true;
    }
    let shifts = best_shifts(kind, weight, moment, low, high);
    let moved = [0, 1].map(|axis| moment[axis] + 2 * shifts[axis] as i128 * weight as i128);
    let real = [0, 1].map(|axis| if kind.flip[axis] { 2 * kind.dims[axis] as i128 * weight as i128 - moved[axis] } else { moved[axis] });
    report(kind, weight, real).ok
}

impl Bin
{
    /// An empty bin of the given kind. The bound is a gap larger along x and y, because every box
    /// carries a gap at its far side.
    pub fn new(index: usize, kind: &Kind, gap: i64, fill: Fill) -> Bin
    {
        Bin {
            kind: index,
            placed: Vec::new(),
            bound: Cuboid { min: [0, 0, 0], max: [kind.dims[0] + gap, kind.dims[1] + gap, kind.dims[2]] },
            points: vec![[0, 0, 0]],
            fill,
            weight: 0,
            moment: [0, 0],
            low: [i64::MAX; 2],
            high: [i64::MIN; 2],
            max_weight: kind.max_weight,
            door: kind.door,
        }
    }

    /// Weight of the load in grams.
    pub fn weight(&self) -> u64
    {
        self.weight
    }

    /// The doubled moment of the load in the real frame, which is the mirror image of the decoded one
    /// along the axes the kind flips.
    pub fn real_moment(&self, kind: &Kind) -> [i128; 2]
    {
        let weight = self.weight as i128;
        [0, 1].map(|axis| if kind.flip[axis] { 2 * kind.dims[axis] as i128 * weight - self.moment[axis] } else { self.moment[axis] })
    }

    /// Whether the balance the kind asks for is met.
    pub fn balanced(&self, kind: &Kind) -> bool
    {
        report(kind, self.weight, self.real_moment(kind)).ok
    }

    /// Whether the load can be moved into the balance the kind asks for.
    fn can_balance(&self, kind: &Kind) -> bool
    {
        can_balance(kind, self.weight, self.moment, self.low, self.high)
    }

    /// Move the whole load along x and y, within the room there is, to where the balance the kind asks
    /// for is met, or as near as it gets. Everything the rules look at is the same afterwards: the
    /// boxes keep their places relative to each other and stay in the bin.
    pub fn recentre(&mut self, kind: &Kind)
    {
        if kind.balance.is_none() || self.placed.is_empty() || self.weight == 0
        {
            return;
        }
        let shifts = best_shifts(kind, self.weight, self.moment, self.low, self.high);
        (0..2).filter(|&axis| shifts[axis] != 0).for_each(|axis| {
            let shift = shifts[axis];
            self.placed.iter_mut().for_each(|p| {
                p.real.min[axis] += shift;
                p.real.max[axis] += shift;
                p.spaced.min[axis] += shift;
                p.spaced.max[axis] += shift;
            });
            self.moment[axis] += 2 * shift as i128 * self.weight as i128;
            self.low[axis] += shift;
            self.high[axis] += shift;
        });
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

    /// The boxes whose top is at the bottom of `real`, with the area they share with it.
    fn supporters(&self, real: &Cuboid) -> Vec<(usize, i64)>
    {
        if real.min[2] == 0
        {
            return Vec::new();
        }
        self.placed
            .iter()
            .enumerate()
            .filter(|(_, other)| other.real.max[2] == real.min[2])
            .map(|(i, other)| (i, other.real.footprint_overlap(real)))
            .filter(|&(_, area)| area > 0)
            .collect()
    }

    /// How much weight each box would carry more if a box of `weight` came to rest on `supports`.
    ///
    /// The weight is shared out over the supports; each of them passes on its own weight, what it
    /// carries and the new share to the boxes under it, and so on to the floor. The boxes are taken
    /// from the top down, so that all that reaches one of them has arrived when it is handled.
    fn spread(&self, weight: u64, supports: &[(usize, i64)]) -> Vec<(usize, u64)>
    {
        fn add(extra: &mut Vec<(usize, u64)>, index: usize, amount: u64)
        {
            match extra.iter_mut().find(|e| e.0 == index)
            {
                Some(entry) => entry.1 += amount,
                None => extra.push((index, amount)),
            }
        }
        let mut extra: Vec<(usize, u64)> = Vec::new();
        shares(weight, supports).into_iter().for_each(|(i, amount)| add(&mut extra, i, amount));
        let mut handled: Vec<usize> = Vec::new();
        while let Some((index, more)) = extra.iter().filter(|e| !handled.contains(&e.0)).max_by_key(|e| (self.placed[e.0].real.min[2], e.0)).copied()
        {
            handled.push(index);
            let node = &self.placed[index];
            let carried = node.weight + node.load;
            let (before, after) = (shares(carried, &node.supports), shares(carried + more, &node.supports));
            after.into_iter().zip(before).for_each(|(a, b)| add(&mut extra, a.0, a.1 - b.1));
        }
        extra
    }

    fn within_limits(&self, extra: &[(usize, u64)]) -> bool
    {
        extra.iter().all(|&(i, more)| self.placed[i].max_load.is_none_or(|max| self.placed[i].load + more <= max))
    }

    /// Whether a box that is already in the bin rests on `real`. Loads are worked out in the order the boxes
    /// are placed, so a box may not be slipped in under one that is already there.
    fn something_rests_on(&self, real: &Cuboid) -> bool
    {
        self.placed.iter().any(|other| other.real.min[2] == real.max[2] && other.real.footprint_overlap(real) > 0)
    }

    /// Whether a box with this `stop` at `real` is in nobody's way, and nobody in its: an item that is
    /// unloaded earlier may not be under or behind one that is unloaded later.
    fn respects_order(&self, real: &Cuboid, stop: u32) -> bool
    {
        stop == 0
            || self.placed.iter().filter(|other| other.stop > 0 && other.stop != stop).all(|other| {
                if stop < other.stop
                {
                    !blocks(self.door, &other.real, real)
                }
                else
                {
                    !blocks(self.door, real, &other.real)
                }
            })
    }

    /// Whether the load could still be balanced after this box joined it.
    fn balanced_with(&self, problem: &Problem, piece: &Piece, real: &Cuboid) -> bool
    {
        let mut moment = self.moment;
        let (mut low, mut high) = (self.low, self.high);
        (0..2).for_each(|axis| {
            moment[axis] += piece.weight as i128 * (real.min[axis] + real.max[axis]) as i128;
            low[axis] = low[axis].min(real.min[axis]);
            high[axis] = high[axis].max(real.max[axis]);
        });
        can_balance(&problem.kinds[self.kind], self.weight + piece.weight, moment, low, high)
    }

    fn accepts(&self, problem: &Problem, piece: &Piece, position: V3, extent: V3, keep_balance: bool) -> bool
    {
        let real = Cuboid::new(position, extent);
        let spaced = Cuboid::new(position, [extent[0] + problem.gap, extent[1] + problem.gap, extent[2]]);
        spaced.within(&self.bound)
            && !self.placed.iter().any(|other| other.spaced.overlaps(&spaced))
            && stands(&real, self.placed.iter().map(|other| &other.real), problem.permille)
            && self.respects_order(&real, piece.stop)
            && (!keep_balance || self.balanced_with(problem, piece, &real))
            && (!problem.stacking || (!self.something_rests_on(&real) && self.within_limits(&self.spread(piece.weight, &self.supporters(&real)))))
    }

    /// The best way to put `piece` in this bin under `strategy`, if there is one: for every orientation
    /// the first free position in the fill order that passes the checks, and of those the best pick.
    ///
    /// With `keep_balance`, a position that would make a balance impossible that is possible now is not taken.
    pub fn find(&self, problem: &Problem, piece: &Piece, strategy: Strategy, keep_balance: bool, evaluations: &mut u64) -> Option<Candidate>
    {
        if self.max_weight.is_some_and(|max| self.weight + piece.weight > max)
        {
            return None;
        }
        let keep_balance = keep_balance && self.can_balance(&problem.kinds[self.kind]);
        piece
            .orientations
            .iter()
            .filter_map(|&(orientation, extent)| {
                self.points
                    .iter()
                    .find(|&&position| {
                        *evaluations += 1;
                        self.accepts(problem, piece, position, extent, keep_balance)
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
    pub fn commit(&mut self, problem: &Problem, index: usize, candidate: &Candidate)
    {
        let piece = &problem.pieces[index];
        let real = Cuboid::new(candidate.position, candidate.extent);
        let spaced = Cuboid::new(candidate.position, [candidate.extent[0] + problem.gap, candidate.extent[1] + problem.gap, candidate.extent[2]]);
        let supports = if problem.stacking { self.supporters(&real) } else { Vec::new() };
        if problem.stacking
        {
            self.spread(piece.weight, &supports).into_iter().for_each(|(i, more)| self.placed[i].load += more);
        }
        self.weight += piece.weight;
        (0..2).for_each(|axis| {
            self.moment[axis] += piece.weight as i128 * (real.min[axis] + real.max[axis]) as i128;
            self.low[axis] = self.low[axis].min(real.min[axis]);
            self.high[axis] = self.high[axis].max(real.max[axis]);
        });
        self.placed.push(Placed { piece: index, orientation: candidate.orientation, real, spaced, weight: piece.weight, max_load: piece.max_load, stop: piece.stop, supports, load: 0 });
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
    let balanced = problem.kinds.iter().any(|kind| kind.balance.is_some());
    let mut layout = sequence.iter().fold(Layout { bins: Vec::new(), unplaced: Vec::new() }, |mut layout, &index| {
        let piece = &problem.pieces[index];
        // into the first open bin that takes it without spoiling a balance that holds, else into a new bin; only when there is
        // no new bin to open is a balance given up for the sake of getting the piece loaded at all
        let first_fit = |layout: &Layout, keep_balance: bool, evaluations: &mut u64| {
            (0..layout.bins.len()).find_map(|b| layout.bins[b].find(problem, piece, strategy, keep_balance, evaluations).map(|candidate| (b, candidate)))
        };
        let mut open = first_fit(&layout, balanced, evaluations);
        if open.is_none() && balanced
        {
            match open_bin(problem, piece, strategy, &mut used, evaluations)
            {
                Some((mut bin, candidate)) =>
                {
                    bin.commit(problem, index, &candidate);
                    layout.bins.push(bin);
                    return layout;
                }
                None => open = first_fit(&layout, false, evaluations),
            }
        }
        match open
        {
            Some((b, candidate)) => layout.bins[b].commit(problem, index, &candidate),
            None => match open_bin(problem, piece, strategy, &mut used, evaluations)
            {
                Some((mut bin, candidate)) =>
                {
                    bin.commit(problem, index, &candidate);
                    layout.bins.push(bin);
                }
                None => layout.unplaced.push(index),
            },
        }
        layout
    });
    right_size(problem, &mut layout, strategy, &mut used, evaluations);
    layout.bins.iter_mut().for_each(|bin| bin.recentre(&problem.kinds[bin.kind]));
    layout
}

/// Try to move the content of every bin into a cheaper kind: the same pieces, in the order they were placed.
fn right_size(problem: &Problem, layout: &mut Layout, strategy: Strategy, used: &mut [u32], evaluations: &mut u64)
{
    if problem.kinds.len() < 2
    {
        return;
    }
    (0..layout.bins.len()).for_each(|b| {
        let current = layout.bins[b].kind;
        let pieces: Vec<usize> = layout.bins[b].placed.iter().map(|placed| placed.piece).collect();
        let mut cheaper: Vec<usize> = (0..problem.kinds.len())
            .filter(|&k| problem.kinds[k].cost < problem.kinds[current].cost)
            .filter(|&k| problem.kinds[k].stock.is_none_or(|stock| used[k] < stock))
            .collect();
        cheaper.sort_by_key(|&k| (problem.kinds[k].cost, problem.kinds[k].volume, k));
        if let Some((k, bin)) = cheaper.into_iter().find_map(|k| refill(problem, k, &pieces, strategy, evaluations).map(|bin| (k, bin)))
        {
            used[current] -= 1;
            used[k] += 1;
            layout.bins[b] = bin;
        }
    });
}

/// The pieces, in this order, into a new bin of kind `k`, if they all go.
fn refill(problem: &Problem, k: usize, pieces: &[usize], strategy: Strategy, evaluations: &mut u64) -> Option<Bin>
{
    let mut bin = Bin::new(k, &problem.kinds[k], problem.gap, strategy.fill);
    pieces
        .iter()
        .all(|&index| match bin.find(problem, &problem.pieces[index], strategy, false, evaluations)
        {
            Some(candidate) =>
            {
                bin.commit(problem, index, &candidate);
                true
            }
            None => false,
        })
        .then_some(bin)
}

/// A new bin for `piece`: of the kinds with stock left that the piece fits in and may be put in by
/// weight, the one that `strategy.open` prefers, together with where the piece goes. The last bins
/// of a plan are made cheaper afterwards, see `right_size`.
fn open_bin(problem: &Problem, piece: &Piece, strategy: Strategy, used: &mut [u32], evaluations: &mut u64) -> Option<(Bin, Candidate)>
{
    let mut kinds: Vec<usize> = (0..problem.kinds.len())
        .filter(|&k| problem.kinds[k].stock.is_none_or(|stock| used[k] < stock))
        .filter(|&k| problem.kinds[k].max_weight.is_none_or(|max| piece.weight <= max))
        .filter(|&k| piece.orientations.iter().any(|&(_, extent)| (0..3).all(|a| extent[a] <= problem.kinds[k].dims[a])))
        .collect();
    kinds.sort_by(|&a, &b| {
        let (ka, kb) = (&problem.kinds[a], &problem.kinds[b]);
        let per_volume = (ka.cost as u128 * kb.volume).cmp(&(kb.cost as u128 * ka.volume));
        match strategy.open
        {
            Open::PerVolume => per_volume.then(ka.cost.cmp(&kb.cost)).then(a.cmp(&b)),
            Open::Cheapest => ka.cost.cmp(&kb.cost).then(per_volume).then(a.cmp(&b)),
        }
    });
    kinds.into_iter().find_map(|k| {
        let bin = Bin::new(k, &problem.kinds[k], problem.gap, strategy.fill);
        bin.find(problem, piece, strategy, false, evaluations).map(|candidate| {
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
    /// Bins whose balance is not met: a plan that is unsafe is worse than a dearer one.
    pub unbalanced: usize,
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
        unbalanced: layout.bins.iter().filter(|bin| !bin.balanced(&problem.kinds[bin.kind])).count(),
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

    const LAYERS: Strategy = Strategy { fill: Fill::Layers, pick: Pick::Lowest, open: Open::PerVolume };

    fn empty_bin(problem: &Problem) -> Bin
    {
        Bin::new(0, &problem.kinds[0], problem.gap, Fill::Layers)
    }

    /// Put a piece at a position without asking whether it may go there, in its `orientation`.
    fn put(bin: &mut Bin, problem: &Problem, piece: usize, at: V3, orientation: u8)
    {
        let extent = problem.pieces[piece].orientations.iter().find(|o| o.0 == orientation).unwrap().1;
        bin.commit(problem, piece, &Candidate { position: at, orientation, extent });
    }

    /// Whether `find` would put the piece exactly at `at`: asked of the one position, by hiding the others.
    fn accepts_at(bin: &Bin, problem: &Problem, piece: usize, at: V3) -> bool
    {
        let extent = problem.pieces[piece].orientations[0].1;
        bin.max_weight.is_none_or(|max| bin.weight + problem.pieces[piece].weight <= max) && bin.accepts(problem, &problem.pieces[piece], at, extent, false)
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
        let walls = decode(&p, &[0, 1, 2], Strategy { fill: Fill::Walls, pick: Pick::Lowest, open: Open::PerVolume }, &mut 0);
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
        let mut bin = empty_bin(&strict);
        put(&mut bin, &strict, 0, [0, 0, 0], 0);
        assert!(bin.find(&strict, &strict.pieces[1], LAYERS, false, &mut 0).is_none(), "64 % of the base is not 80 %");

        // the control: with 50 % asked, the same plate rests on the block
        let loose = problem(json, Config { support: 0.5, ..Config::default() });
        let found = bin.find(&loose, &loose.pieces[1], LAYERS, false, &mut 0).expect("the plate rests on the block");
        assert_eq!(found.position, [0, 0, 400]);
    }

    #[test]
    fn a_piece_whose_centre_is_past_its_support_is_refused_even_when_the_share_is_met()
    {
        // a 1000 x 200 board on a 450 x 200 block at one end: 45 % of its base, but the centre (x = 500) hangs in the air
        let json = r#"{ "items": [{ "dims": [450, 200, 300], "orientations": 1 }, { "dims": [1000, 200, 50], "orientations": 1 }],
                        "bins": [{ "dims": [1000, 200, 1000] }] }"#;
        let p = problem(json, Config { support: 0.4, ..Config::default() });
        let mut bin = empty_bin(&p);
        put(&mut bin, &p, 0, [0, 0, 0], 0);
        // the board cannot go on the floor beside the block (it is as long as the bin), so it has to go on top
        assert!(bin.find(&p, &p.pieces[1], LAYERS, false, &mut 0).is_none(), "45 % passes the share, the centre does not pass the hull");
        // the control: a block under the middle of the board holds it
        let mut middle = empty_bin(&p);
        put(&mut middle, &p, 0, [275, 0, 0], 0);
        assert!(middle.find(&p, &p.pieces[1], LAYERS, false, &mut 0).is_some());
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
    fn kinds_are_opened_by_cost_per_volume_until_their_stock_runs_out()
    {
        let json = r#"{ "items": [{ "dims": [600, 600, 600], "count": 4, "orientations": 1 }],
                        "bins": [{ "dims": [500, 500, 500], "cost": 1 }, { "dims": [1000, 1000, 1000], "cost": 4, "stock": 2 }, { "dims": [700, 700, 700], "cost": 2, "stock": 1 }] }"#;
        let p = problem(json, Config::default());
        let layout = decode(&p, &[0, 1, 2, 3], LAYERS, &mut 0);
        let kinds: Vec<usize> = layout.bins.iter().map(|b| b.kind).collect();
        // the 500 bin is too small for any piece; of the others the 1000 bin costs least per volume (4 for a cubic metre against
        // 2 for 0.34), so the first two pieces take one each (two 600 cubes do not share one), the third the single 700 bin, and
        // for the fourth nothing is left
        assert_eq!(kinds, [1, 1, 2]);
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
        let o = |unplaced, unbalanced, cost, bins, concentration: u128| Objective { unplaced, unbalanced, cost, bins, concentration: Reverse(concentration) };
        assert!(o(0, 9, 9, 9, 0) < o(1, 0, 1, 1, 9));
        assert!(o(0, 0, 9, 9, 0) < o(0, 1, 1, 1, 9), "an unbalanced bin is worse than any cost");
        assert!(o(0, 0, 3, 9, 0) < o(0, 0, 4, 1, 9));
        assert!(o(0, 0, 3, 2, 0) < o(0, 0, 3, 3, 9));
        assert!(o(0, 0, 3, 2, 9) < o(0, 0, 3, 2, 1));
    }

    #[test]
    fn the_weight_limit_of_a_bin_is_kept()
    {
        // 40 kg cubes into a bin that takes 100 kg: two go in, the third needs another bin
        let json = |max: &str| format!(r#"{{ "items": [{{ "dims": [300, 300, 300], "count": 3, "weight": 40000, "orientations": 1 }}], "bins": [{{ "dims": [1000, 1000, 1000], "maxWeight": {max} }}] }}"#);
        let limited = decode(&problem(&json("100000"), Config::default()), &[0, 1, 2], LAYERS, &mut 0);
        assert_eq!(limited.bins.iter().map(|b| b.placed.len()).collect::<Vec<_>>(), [2, 1]);
        // the control: without the limit all three share the bin
        let free = decode(&problem(&json("null"), Config::default()), &[0, 1, 2], LAYERS, &mut 0);
        assert_eq!(free.bins.iter().map(|b| b.placed.len()).collect::<Vec<_>>(), [3]);
    }

    #[test]
    fn a_piece_too_heavy_for_every_bin_is_unplaced()
    {
        let p = problem(r#"{ "items": [{ "dims": [100, 100, 100], "weight": 5000 }], "bins": [{ "dims": [1000, 1000, 1000], "maxWeight": 4999 }] }"#, Config::default());
        assert_eq!(decode(&p, &[0], LAYERS, &mut 0).unplaced, [0]);
    }

    /// Two columns 200 wide under a plate 800 long, each with the given limit; the plate weighs 10 kg.
    fn plate_on_two_columns(limit_left: u64, limit_right: u64) -> (Problem, Bin)
    {
        let json = format!(
            r#"{{ "items": [{{ "dims": [200, 400, 300], "maxLoad": {limit_left}, "orientations": 1 }}, {{ "dims": [200, 400, 300], "maxLoad": {limit_right}, "orientations": 1 }},
                            {{ "dims": [800, 400, 50], "weight": 10000, "orientations": 1 }}], "bins": [{{ "dims": [800, 400, 1000] }}] }}"#
        );
        let p = problem(&json, Config { support: 0.5, ..Config::default() });
        let mut bin = empty_bin(&p);
        put(&mut bin, &p, 0, [0, 0, 0], 0);
        put(&mut bin, &p, 1, [600, 0, 0], 0);
        (p, bin)
    }

    #[test]
    fn a_plate_shares_its_weight_over_the_columns_it_rests_on()
    {
        let (p, bin) = plate_on_two_columns(5000, 5000);
        assert!(accepts_at(&bin, &p, 2, [0, 0, 300]), "5 kg on each column is exactly their limit");
        let (p, bin) = plate_on_two_columns(4999, 5000);
        assert!(!accepts_at(&bin, &p, 2, [0, 0, 300]), "one gram over the limit of the left column");
        let (p, bin) = plate_on_two_columns(5000, 4999);
        assert!(!accepts_at(&bin, &p, 2, [0, 0, 300]), "and over that of the right one");
    }

    #[test]
    fn the_weight_passes_down_through_the_boxes_in_between()
    {
        // 1 kg boxes in a column of three: the bottom one carries what is on the middle one and the top one
        let json = |limit: u64| format!(r#"{{ "items": [{{ "dims": [400, 400, 400], "weight": 1000, "maxLoad": {limit}, "count": 3, "orientations": 1 }}], "bins": [{{ "dims": [400, 400, 1200] }}] }}"#);
        let low = problem(&json(1999), Config::default());
        let mut bin = empty_bin(&low);
        put(&mut bin, &low, 0, [0, 0, 0], 0);
        put(&mut bin, &low, 1, [0, 0, 400], 0);
        assert!(!accepts_at(&bin, &low, 2, [0, 0, 800]), "the bottom box would carry 2000 g and may carry 1999");
        let high = problem(&json(2000), Config::default());
        let mut bin = empty_bin(&high);
        put(&mut bin, &high, 0, [0, 0, 0], 0);
        put(&mut bin, &high, 1, [0, 0, 400], 0);
        assert!(accepts_at(&bin, &high, 2, [0, 0, 800]), "the control: 2000 g is its limit");
    }

    #[test]
    fn a_box_is_not_slipped_in_under_one_that_is_already_there_while_loads_are_tracked()
    {
        // a plate on two pillars, and a box that would fit exactly between the pillars and touch the plate from below
        let json = |limit: &str| format!(
            r#"{{ "items": [{{ "dims": [200, 400, 300], "count": 2, "maxLoad": {limit}, "orientations": 1 }}, {{ "dims": [800, 400, 50], "orientations": 1 }}, {{ "dims": [400, 400, 300], "orientations": 1 }}],
                "bins": [{{ "dims": [800, 400, 1000] }}] }}"#
        );
        let build = |limit: &str| {
            let p = problem(&json(limit), Config { support: 0.5, ..Config::default() });
            let mut bin = empty_bin(&p);
            put(&mut bin, &p, 0, [0, 0, 0], 0);
            put(&mut bin, &p, 1, [600, 0, 0], 0);
            put(&mut bin, &p, 2, [0, 0, 300], 0);
            (p, bin)
        };
        let (p, bin) = build("1000000");
        assert!(!accepts_at(&bin, &p, 3, [200, 0, 0]), "its top would touch the plate: the plate's load is already worked out without it");
        // the control: when no item has a load limit, loads are not tracked and the box may go in
        let (p, bin) = build("null");
        assert!(accepts_at(&bin, &p, 3, [200, 0, 0]));
    }

    fn truck(door: &str, early_stop: u32, late_stop: u32) -> (Problem, Bin)
    {
        let json = format!(
            r#"{{ "items": [{{ "dims": [400, 400, 400], "stop": {early_stop}, "orientations": 1 }}, {{ "dims": [400, 400, 400], "stop": {late_stop}, "orientations": 1 }}],
                "bins": [{{ "dims": [1200, 800, 800], "door": {door} }}] }}"#
        );
        let p = problem(&json, Config::default());
        let mut bin = empty_bin(&p);
        put(&mut bin, &p, 0, [400, 0, 0], 0); // the item of the earlier stop, in the middle of the floor
        (p, bin)
    }

    #[test]
    fn an_item_that_is_unloaded_later_may_not_be_put_between_an_earlier_one_and_the_door()
    {
        let (p, bin) = truck(r#""+x""#, 1, 2);
        assert!(!accepts_at(&bin, &p, 1, [800, 0, 0]), "the later item would stand in front of the earlier one");
        assert!(accepts_at(&bin, &p, 1, [0, 0, 0]), "behind it, deeper in the truck, it is fine");
        assert!(accepts_at(&bin, &p, 1, [800, 400, 0]), "beside it in the path of the door is fine too: the cross-section does not overlap");
        // the controls: the same spot with no door (a bin is decoded with its door at the high end, see `Kind::door`), with equal stops, with no stop
        for ok in [truck("null", 1, 2), truck(r#""+x""#, 2, 2), truck(r#""+x""#, 0, 2), truck(r#""+x""#, 1, 0)]
        {
            assert!(accepts_at(&ok.1, &ok.0, 1, [800, 0, 0]));
        }
    }

    #[test]
    fn an_item_that_is_unloaded_earlier_may_not_be_put_behind_a_later_one_either()
    {
        // now the item in the middle is the one for the later stop; the earlier one must not go deeper than it
        let (p, bin) = truck(r#""+x""#, 2, 1);
        assert!(!accepts_at(&bin, &p, 1, [0, 0, 0]), "the earlier item would be behind the later one");
        assert!(accepts_at(&bin, &p, 1, [800, 0, 0]), "in front of it, it is fine");
    }

    #[test]
    fn an_item_that_is_unloaded_later_may_not_be_over_an_earlier_one()
    {
        let (p, bin) = truck(r#""+x""#, 1, 2);
        assert!(!accepts_at(&bin, &p, 1, [400, 0, 400]), "on top of the earlier item");
        let (p, bin) = truck("null", 1, 2);
        assert!(!accepts_at(&bin, &p, 1, [400, 0, 400]), "also when the load only leaves from the top");
        let (p, bin) = truck("null", 2, 1);
        assert!(accepts_at(&bin, &p, 1, [400, 0, 400]), "the control: the earlier item on top of the later one");
    }

    #[test]
    fn blocking_is_right_for_all_four_doors()
    {
        // the earlier box in the middle of the floor, a later one beyond it on each side: only the side of the door blocks
        let earlier = Cuboid::new([400, 400, 0], [400, 400, 400]);
        let beyond = |at: V3| Cuboid::new(at, [400, 400, 400]);
        let (east, west, north, south) = (beyond([800, 400, 0]), beyond([0, 400, 0]), beyond([400, 800, 0]), beyond([400, 0, 0]));
        let blocked_by = |door| [&east, &west, &north, &south].map(|later| blocks(door, later, &earlier));
        assert_eq!(blocked_by(Some(Door::PosX)), [true, false, false, false]);
        assert_eq!(blocked_by(Some(Door::NegX)), [false, true, false, false]);
        assert_eq!(blocked_by(Some(Door::PosY)), [false, false, true, false]);
        assert_eq!(blocked_by(Some(Door::NegY)), [false, false, false, true]);
        assert_eq!(blocked_by(None), [false, false, false, false], "from the top only, beside is not in the way");
        // a later box that only overlaps the cross-section by an edge does not block; one over the earlier box does
        assert!(!blocks(Some(Door::PosX), &beyond([800, 800, 0]), &earlier), "touching in y is not overlapping");
        assert!(blocks(None, &beyond([400, 400, 400]), &earlier));
    }

    #[test]
    fn a_bin_is_made_cheaper_when_its_content_goes_into_a_cheaper_kind()
    {
        // one small cube: the big bin is cheaper per volume and opened first, but the cube fits the small bin, which costs less
        let json = r#"{ "items": [{ "dims": [300, 300, 300], "orientations": 1 }],
                        "bins": [{ "dims": [1000, 1000, 1000], "cost": 5 }, { "dims": [400, 400, 400], "cost": 2 }] }"#;
        let p = problem(json, Config::default());
        let layout = decode(&p, &[0], LAYERS, &mut 0);
        assert_eq!(layout.bins.iter().map(|b| b.kind).collect::<Vec<_>>(), [1]);
        // the control: a cube that does not fit the small bin stays in the big one
        let big = problem(&json.replace("300, 300, 300", "500, 500, 500"), Config::default());
        assert_eq!(decode(&big, &[0], LAYERS, &mut 0).bins.iter().map(|b| b.kind).collect::<Vec<_>>(), [0]);
        // and the stock of the cheap kind is respected
        let one_small = problem(&json.replace(r#""cost": 2 }"#, r#""cost": 2, "stock": 0 }"#), Config::default());
        assert_eq!(decode(&one_small, &[0], LAYERS, &mut 0).bins.iter().map(|b| b.kind).collect::<Vec<_>>(), [0]);
    }

    /// A bin 10 m long with two supports, one box of 1 t of 1 m, and a tolerance of 10 % (so 1 m) around the middle.
    fn trailer(door: &str) -> (Problem, Bin)
    {
        let json = format!(
            r#"{{ "items": [{{ "dims": [1000, 1000, 1000], "weight": 1000000, "orientations": 1 }}],
                "bins": [{{ "dims": [10000, 2000, 2500], "door": {door},
                           "balance": {{ "cog": {{ "x": 0.1 }}, "axles": [{{ "at": 1000, "maxLoad": 700000 }}, {{ "at": 9000, "maxLoad": 700000 }}] }} }}] }}"#
        );
        let p = problem(&json, Config::default());
        let bin = empty_bin(&p);
        (p, bin)
    }

    #[test]
    fn a_load_is_moved_to_the_middle_of_a_bin_that_asks_for_balance()
    {
        let (p, mut bin) = trailer("null");
        put(&mut bin, &p, 0, [0, 0, 0], 0); // against the front wall: centre of gravity at 500 mm
        assert!(!bin.balanced(&p.kinds[0]), "500 mm is far from the middle");
        bin.recentre(&p.kinds[0]);
        assert!(bin.balanced(&p.kinds[0]));
        // the box was moved the least that works: its centre is 1 m from the middle at most
        assert_eq!(bin.placed[0].real.min[0], 3500, "the centre of gravity has to be at 4000 or more (middle 5000, 10 % of 10 m)");
        assert_eq!(bin.placed[0].real.max[0], 4500);
    }

    #[test]
    fn a_mirrored_bin_is_moved_the_right_way()
    {
        // the door at -x: the load is decoded mirrored, so it starts at the far end of the real bin
        let (p, mut bin) = trailer(r#""-x""#);
        put(&mut bin, &p, 0, [0, 0, 0], 0); // decoded at 0, that is at the REAL x = 9000..10000, centre of gravity at 9500
        assert!(!bin.balanced(&p.kinds[0]));
        bin.recentre(&p.kinds[0]);
        assert!(bin.balanced(&p.kinds[0]));
        // the real centre of gravity may be 6000 at the most (the middle plus 1 m), so the real box ends up at 5500..6500
        let real = (10_000 - bin.placed[0].real.max[0], 10_000 - bin.placed[0].real.min[0]);
        assert_eq!(real, (5500, 6500), "the real box is moved forward by 3500 mm, to a centre of gravity of 6000");
    }

    #[test]
    fn nothing_is_moved_when_the_bin_asks_for_nothing_or_the_load_has_no_weight_or_no_room()
    {
        let json = r#"{ "items": [{ "dims": [10000, 1000, 1000], "weight": 1000, "orientations": 1 }, { "dims": [500, 500, 500], "orientations": 1 }],
                        "bins": [{ "dims": [10000, 2000, 2500] }, { "dims": [10000, 2000, 2500], "balance": { "cog": { "x": 0.1 } } }] }"#;
        let p = problem(json, Config::default());
        let mut free = empty_bin(&p);
        put(&mut free, &p, 1, [0, 0, 0], 0);
        free.recentre(&p.kinds[0]);
        assert_eq!(free.placed[0].real.min, [0, 0, 0], "a bin without a balance is left alone");
        let mut light = Bin::new(1, &p.kinds[1], 0, Fill::Layers);
        put(&mut light, &p, 1, [0, 0, 0], 0);
        light.recentre(&p.kinds[1]);
        assert_eq!(light.placed[0].real.min, [0, 0, 0], "a load without weight has no centre of gravity to move");
        let mut full = Bin::new(1, &p.kinds[1], 0, Fill::Layers);
        put(&mut full, &p, 0, [0, 0, 0], 0);
        full.recentre(&p.kinds[1]);
        assert_eq!(full.placed[0].real.min, [0, 0, 0], "a load as long as the bin has no room to move, and is balanced anyway");
    }
}
