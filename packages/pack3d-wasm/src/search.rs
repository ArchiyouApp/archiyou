//! Improvement of a plan by search: late acceptance hill climbing (Burke & Bykov, 2008) over the
//! sequence in which the pieces are put in.
//!
//! The decoder turns a sequence into a plan, so a move is a change of the sequence: two pieces
//! swapped, one moved, or one of the pieces of the emptiest bin moved forward so that it takes a
//! place in a bin before that. Pieces only move within the run of pieces with the same stop, so the
//! items of the later stops stay first. A candidate is accepted when it is no worse than the current
//! plan or than the plan `HISTORY` steps ago, which lets the search leave a local optimum without
//! ever being random about what it keeps: the only randomness is `PortableRng`, seeded by the config.

use crate::layout::{Layout, Objective, Strategy, decode, objective};
use crate::model::Problem;
use crate::rng::PortableRng;

/// How many steps back a candidate may be compared with.
const HISTORY: usize = 40;

/// Where the search starts.
pub struct Start
{
    pub order: Vec<usize>,
    /// Index in the strategies.
    pub strategy: usize,
    pub layout: Layout,
    pub objective: Objective,
}

/// What the search ends with.
pub struct Found
{
    pub layout: Layout,
    pub objective: Objective,
    pub steps: u32,
}

/// The runs of positions in `order` whose pieces have the same stop, as (first, one past the last).
fn runs(problem: &Problem, order: &[usize]) -> Vec<(usize, usize)>
{
    let stop = |position: usize| problem.pieces[order[position]].stop;
    (0..order.len()).fold(Vec::new(), |mut runs: Vec<(usize, usize)>, position| {
        match runs.last_mut()
        {
            Some(last) if stop(last.0) == stop(position) => last.1 = position + 1,
            _ => runs.push((position, position + 1)),
        }
        runs
    })
}

/// The run that holds `position`.
fn run_of(runs: &[(usize, usize)], position: usize) -> (usize, usize)
{
    runs[runs.partition_point(|run| run.1 <= position)]
}

/// A neighbour of `order`: the same pieces, one or two of them in another place of their run.
fn neighbour(problem: &Problem, order: &[usize], runs: &[(usize, usize)], layout: &Layout, rng: &mut PortableRng) -> Vec<usize>
{
    let mut next = order.to_vec();
    let at = rng.below(order.len() as u64) as usize;
    let (start, end) = run_of(runs, at);
    if end - start < 2
    {
        return next;
    }
    let other = |rng: &mut PortableRng, not: usize| {
        let candidate = start + rng.below((end - start - 1) as u64) as usize;
        if candidate >= not { candidate + 1 } else { candidate }
    };
    match rng.below(100)
    {
        0..=44 =>
        {
            // swap two pieces
            let to = other(rng, at);
            next.swap(at, to);
        }
        45..=79 =>
        {
            // move one piece to another place
            let to = other(rng, at);
            let piece = next.remove(at);
            next.insert(to, piece);
        }
        _ =>
        {
            // take a piece of the emptiest bin and put it earlier in its run, where it may fit into a bin that has room
            let fill = |bin: &crate::layout::Bin| bin.volume() * 1_000_000 / bin.capacity(problem.gap).max(1);
            if let Some(emptiest) = layout.bins.iter().min_by_key(|bin| fill(bin))
            {
                let piece = emptiest.placed[rng.below(emptiest.placed.len() as u64) as usize].piece;
                if let Some(from) = order.iter().position(|&p| p == piece)
                {
                    let (first, _) = run_of(runs, from);
                    let to = first + rng.below((from - first + 1) as u64) as usize;
                    let moved = next.remove(from);
                    next.insert(to, moved);
                }
            }
        }
    }
    next
}

/// Improve the plan `start` for `steps` steps, or until `evaluations` reaches `limit`. The result is
/// never worse than the start.
pub fn improve(problem: &Problem, strategies: &[Strategy], start: Start, steps: u32, limit: u64, seed: u64, evaluations: &mut u64) -> Found
{
    let mut rng = PortableRng::seed_from_u64(seed);
    let runs = runs(problem, &start.order);
    let mut current = (start.order, start.strategy, start.layout, start.objective);
    let mut history = vec![current.3.clone(); HISTORY];
    let mut best = (current.2.clone(), current.3.clone());
    let mut done = 0;
    while done < steps && *evaluations < limit && !problem.pieces.is_empty()
    {
        let order = neighbour(problem, &current.0, &runs, &current.2, &mut rng);
        // once in a while another way of choosing the places
        let strategy = if strategies.len() > 1 && rng.below(20) == 0 { rng.below(strategies.len() as u64) as usize } else { current.1 };
        let layout = decode(problem, &order, strategies[strategy], evaluations);
        let candidate = objective(problem, &layout);
        let slot = done as usize % HISTORY;
        if candidate <= current.3 || candidate <= history[slot]
        {
            current = (order, strategy, layout, candidate);
        }
        history[slot] = current.3.clone();
        if current.3 < best.1
        {
            best = (current.2.clone(), current.3.clone());
        }
        done += 1;
    }
    Found { layout: best.0, objective: best.1, steps: done }
}

#[cfg(test)]
mod tests
{
    use super::*;
    use crate::layout::{Fill, Open, Pick};
    use crate::model::{Config, Instance};

    const STRATEGY: Strategy = Strategy { fill: Fill::Layers, pick: Pick::Lowest, open: Open::PerVolume };

    fn problem(json: &str) -> Problem
    {
        Problem::new(&serde_json::from_str::<Instance>(json).unwrap(), &Config::default()).unwrap()
    }

    #[test]
    fn runs_group_the_positions_with_the_same_stop()
    {
        let p = problem(r#"{ "items": [{ "dims": [10, 10, 10], "stop": 2, "count": 2 }, { "dims": [10, 10, 10], "stop": 1, "count": 3 }, { "dims": [10, 10, 10], "count": 1 }], "bins": [{ "dims": [100, 100, 100] }] }"#);
        let order: Vec<usize> = (0..6).collect();
        assert_eq!(runs(&p, &order), [(0, 2), (2, 5), (5, 6)]);
        assert_eq!(run_of(&runs(&p, &order), 3), (2, 5));
        assert_eq!(run_of(&runs(&p, &order), 5), (5, 6));
    }

    #[test]
    fn a_neighbour_keeps_the_pieces_and_stays_inside_the_runs()
    {
        let p = problem(r#"{ "items": [{ "dims": [10, 10, 10], "stop": 2, "count": 4 }, { "dims": [10, 10, 10], "stop": 1, "count": 6 }], "bins": [{ "dims": [20, 20, 20] }] }"#);
        let order: Vec<usize> = (0..10).collect();
        let layout = decode(&p, &order, STRATEGY, &mut 0);
        let runs = runs(&p, &order);
        let mut rng = PortableRng::seed_from_u64(1);
        (0..500).for_each(|_| {
            let next = neighbour(&p, &order, &runs, &layout, &mut rng);
            let mut sorted = next.clone();
            sorted.sort_unstable();
            assert_eq!(sorted, order, "the same pieces");
            assert!(next[..4].iter().all(|&piece| piece < 4) && next[4..].iter().all(|&piece| piece >= 4), "the stop 2 pieces stay first: {next:?}");
        });
    }

    #[test]
    fn the_search_never_ends_worse_than_it_starts_and_is_the_same_for_a_seed()
    {
        let p = problem(
            r#"{ "items": [{ "dims": [500, 400, 300], "count": 6 }, { "dims": [300, 300, 300], "count": 8 }, { "dims": [700, 200, 100], "count": 5 }, { "dims": [250, 250, 250], "count": 9 }],
                 "bins": [{ "dims": [1000, 800, 700] }] }"#,
        );
        let order: Vec<usize> = (0..p.pieces.len()).collect();
        let layout = decode(&p, &order, STRATEGY, &mut 0);
        let start = || Start { order: order.clone(), strategy: 0, layout: layout.clone(), objective: objective(&p, &layout) };
        let first = improve(&p, &[STRATEGY], start(), 60, u64::MAX, 7, &mut 0);
        assert!(first.objective <= objective(&p, &layout));
        let second = improve(&p, &[STRATEGY], start(), 60, u64::MAX, 7, &mut 0);
        assert_eq!((first.objective.clone(), first.steps), (second.objective.clone(), second.steps));
        let key = |l: &Layout| l.bins.iter().map(|b| b.placed.iter().map(|p| (p.piece, p.real.min)).collect::<Vec<_>>()).collect::<Vec<_>>();
        assert_eq!(key(&first.layout), key(&second.layout), "same seed, same plan");
    }

    #[test]
    fn the_work_limit_ends_the_search()
    {
        let p = problem(r#"{ "items": [{ "dims": [300, 300, 300], "count": 12 }], "bins": [{ "dims": [900, 600, 600] }] }"#);
        let order: Vec<usize> = (0..12).collect();
        let layout = decode(&p, &order, STRATEGY, &mut 0);
        let start = Start { order, strategy: 0, objective: objective(&p, &layout), layout };
        let mut evaluations = 0;
        let found = improve(&p, &[STRATEGY], start, 1_000_000, 500, 1, &mut evaluations);
        assert!(found.steps < 1_000_000, "stopped by the limit after {} steps", found.steps);
        assert!((500..5_000).contains(&evaluations), "{evaluations}");
    }
}
