//! The solver: a portfolio of constructive runs, the best one by the objective, checked by the
//! validator before it is returned.

use crate::balance::report;
use crate::layout::{Fill, Layout, Open, Pick, Strategy, decode, objective};
use crate::model::{BinLoad, Config, Door, Error, Instance, ItemRef, Piece, Placement, Problem, Solution, Stats};
use crate::validate::validate;

/// What the pieces are ordered by, biggest first.
#[derive(Clone, Copy, Debug)]
enum Key
{
    Volume,
    Footprint,
    Longest,
    Height,
    /// Heaviest first, so that heavy things end up at the bottom.
    Weight,
    /// Those that may carry the most first (an item without a limit counts as carrying anything).
    Sturdy,
}

impl Key
{
    fn value(self, piece: &Piece) -> i128
    {
        match self
        {
            Key::Volume => piece.dims.iter().map(|&d| d as i128).product(),
            Key::Footprint => piece.dims[0] as i128 * piece.dims[1] as i128,
            Key::Longest => piece.dims.into_iter().max().unwrap_or(0) as i128,
            Key::Height => piece.dims[2] as i128,
            Key::Weight => piece.weight as i128,
            Key::Sturdy => piece.max_load.map_or(i128::MAX, |max| max as i128),
        }
    }
}

/// The keys the portfolio sorts by: the weight and the sturdiness only count when some item has any.
fn keys(problem: &Problem) -> Vec<Key>
{
    let weighed = problem.pieces.iter().any(|piece| piece.weight > 0);
    [(Key::Volume, true), (Key::Footprint, true), (Key::Longest, true), (Key::Height, true), (Key::Weight, weighed), (Key::Sturdy, problem.stacking)]
        .into_iter()
        .filter_map(|(key, wanted)| wanted.then_some(key))
        .collect()
}

/// The pieces by `key`, biggest first, with the items of the later stops before those of the earlier
/// ones (the load goes in last stop first, and items without a stop come last); equal ones keep
/// their order, so the sequence is the same every time.
fn sequence(problem: &Problem, key: Key) -> Vec<usize>
{
    let volume = |piece: &Piece| Key::Volume.value(piece);
    let mut order: Vec<usize> = (0..problem.pieces.len()).collect();
    order.sort_by(|&a, &b| {
        let (pa, pb) = (&problem.pieces[a], &problem.pieces[b]);
        pb.stop.cmp(&pa.stop).then(key.value(pb).cmp(&key.value(pa))).then(volume(pb).cmp(&volume(pa))).then(a.cmp(&b))
    });
    order
}

/// Every strategy the portfolio tries, in the order that decides ties. Rows only when some bin has its door on y.
fn strategies(problem: &Problem) -> Vec<Strategy>
{
    let rows = problem.kinds.iter().any(|kind| kind.door == Some(Door::PosY));
    // choosing the kind of bin to open only matters when there is a choice
    let opens: &[Open] = if problem.kinds.len() > 1 { &[Open::PerVolume, Open::Cheapest] } else { &[Open::PerVolume] };
    [(Fill::Layers, true), (Fill::Walls, true), (Fill::Rows, rows)]
        .into_iter()
        .filter(|&(_, wanted)| wanted)
        .flat_map(|(fill, _)| [Pick::Lowest, Pick::Contact].map(|pick| (fill, pick)))
        .flat_map(|(fill, pick)| opens.iter().map(move |&open| Strategy { fill, pick, open }))
        .collect()
}

/// Load the items into bins. The same instance and config give the same solution, byte for byte.
///
/// Fails on input that makes no sense (see `Problem::new`), and, as a safety net that should never
/// trigger, when the solution it found breaks a rule.
pub fn solve(instance: &Instance, config: &Config) -> Result<Solution, Error>
{
    let problem = Problem::new(instance, config)?;
    let mut evaluations = 0u64;
    let strategies = strategies(&problem);

    let best = keys(&problem)
        .into_iter()
        .map(|key| sequence(&problem, key))
        .flat_map(|order| strategies.iter().map(move |&strategy| (order.clone(), strategy)).collect::<Vec<_>>())
        .map(|(order, strategy)| decode(&problem, &order, strategy, &mut evaluations))
        .min_by_key(|layout| objective(&problem, layout))
        .expect("the portfolio has at least one run");

    let solution = assemble(&problem, &best, evaluations);
    let broken = validate(instance, config, &solution);
    if broken.is_empty()
    {
        Ok(solution)
    }
    else
    {
        Err(Error(format!("internal error: the plan breaks {} rule(s), first: {}", broken.len(), broken[0])))
    }
}

fn assemble(problem: &Problem, layout: &Layout, evaluations: u64) -> Solution
{
    let reference = |index: usize| {
        let piece = &problem.pieces[index];
        (piece.item, piece.copy)
    };
    let bins: Vec<BinLoad> = layout
        .bins
        .iter()
        .map(|bin| {
            // a bin whose door is at the low end was decoded mirrored: put it back the way round it really is
            let kind = &problem.kinds[bin.kind];
            let balance = report(kind, bin.weight(), bin.real_moment(kind));
            let corner = |placed: &crate::layout::Placed, axis: usize| if kind.flip.get(axis).copied().unwrap_or(false) { kind.dims[axis] - placed.real.max[axis] } else { placed.real.min[axis] };
            BinLoad {
                bin: bin.kind,
                placements: bin
                    .placed
                    .iter()
                    .map(|placed| {
                        let (item, copy) = reference(placed.piece);
                        Placement { item, copy, orientation: placed.orientation, x: corner(placed, 0) as u32, y: corner(placed, 1) as u32, z: placed.real.min[2] as u32 }
                    })
                    .collect(),
                volume: bin.volume() as u64,
                weight: balance.weight,
                cog: balance.cog,
                axle_loads: balance.axle_loads,
                balance_ok: balance.ok,
            }
        })
        .collect();
    let cost: u64 = layout.bins.iter().map(|bin| problem.kinds[bin.kind].cost).sum();
    Solution {
        stats: Stats { evaluations, bins: bins.len(), cost: cost as f64 / 1000.0 },
        unplaced: layout.unplaced.iter().map(|&index| reference(index)).map(|(item, copy)| ItemRef { item, copy }).collect(),
        bins,
    }
}
