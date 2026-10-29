//! The solver: a portfolio of constructive runs, the best one by the objective, checked by the
//! validator before it is returned.

use crate::layout::{Fill, Layout, Pick, Strategy, decode, objective};
use crate::model::{BinLoad, Config, Error, Instance, ItemRef, Placement, Problem, Solution, Stats};
use crate::validate::validate;

/// What the pieces are ordered by, biggest first.
#[derive(Clone, Copy, Debug)]
enum Key
{
    Volume,
    Footprint,
    Longest,
    Height,
}

const KEYS: [Key; 4] = [Key::Volume, Key::Footprint, Key::Longest, Key::Height];

impl Key
{
    fn value(self, dims: [i64; 3]) -> i128
    {
        match self
        {
            Key::Volume => dims.iter().map(|&d| d as i128).product(),
            Key::Footprint => dims[0] as i128 * dims[1] as i128,
            Key::Longest => dims.into_iter().max().unwrap_or(0) as i128,
            Key::Height => dims[2] as i128,
        }
    }
}

/// The pieces by `key`, biggest first; equal ones keep their order, so the sequence is the same every time.
fn sequence(problem: &Problem, key: Key) -> Vec<usize>
{
    let mut order: Vec<usize> = (0..problem.pieces.len()).collect();
    order.sort_by(|&a, &b| key.value(problem.pieces[b].dims).cmp(&key.value(problem.pieces[a].dims)).then(a.cmp(&b)));
    order
}

/// Every strategy the portfolio tries, in the order that decides ties.
fn strategies() -> Vec<Strategy>
{
    [Fill::Layers, Fill::Walls].into_iter().flat_map(|fill| [Pick::Lowest, Pick::Contact].map(|pick| Strategy { fill, pick })).collect()
}

/// Load the items into bins. The same instance and config give the same solution, byte for byte.
///
/// Fails on input that makes no sense (see `Problem::new`), and, as a safety net that should never
/// trigger, when the solution it found breaks a rule.
pub fn solve(instance: &Instance, config: &Config) -> Result<Solution, Error>
{
    let problem = Problem::new(instance, config)?;
    let mut evaluations = 0u64;
    let strategies = strategies();

    let best = KEYS
        .iter()
        .map(|&key| sequence(&problem, key))
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
        .map(|bin| BinLoad {
            bin: bin.kind,
            placements: bin
                .placed
                .iter()
                .map(|placed| {
                    let (item, copy) = reference(placed.piece);
                    Placement { item, copy, orientation: placed.orientation, x: placed.real.min[0] as u32, y: placed.real.min[1] as u32, z: placed.real.min[2] as u32 }
                })
                .collect(),
            volume: bin.volume() as u64,
        })
        .collect();
    let cost: u64 = layout.bins.iter().map(|bin| problem.kinds[bin.kind].cost).sum();
    Solution {
        stats: Stats { evaluations, bins: bins.len(), cost: cost as f64 / 1000.0 },
        unplaced: layout.unplaced.iter().map(|&index| reference(index)).map(|(item, copy)| ItemRef { item, copy }).collect(),
        bins,
    }
}
