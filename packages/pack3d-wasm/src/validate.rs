//! The independent check of a solution against every hard rule of the instance.
//!
//! The decoder builds its layouts incrementally, with bookkeeping that could drift from the rules.
//! This module does not use any of it: it re-reads the instance and checks the finished solution
//! from scratch, pair by pair. `solve` runs it on every result and turns a violation into an error,
//! so a plan that breaks a rule is never returned, and the tests use it as their oracle.
//!
//! It shares only `Cuboid`, `PERMS` and the contact/hull primitives with the decoder; those have
//! their own tests in `geom.rs`, one of them against a brute-force implementation.

use crate::geom::{Cuboid, PERMS, V3, stands};
use crate::model::{Config, Instance, Solution};

/// Every rule that the solution breaks, in words. Empty when the solution is valid.
pub fn validate(instance: &Instance, config: &Config, solution: &Solution) -> Vec<String>
{
    let gap = config.gap as i64;
    let permille = (config.support * 1000.0).round() as i64;
    let mut problems: Vec<String> = Vec::new();

    // every copy of every item is placed or reported as unplaced, exactly once
    let mut seen: Vec<Vec<u32>> = instance.items.iter().map(|item| vec![0; item.count as usize]).collect();
    let placed = solution.bins.iter().flat_map(|load| load.placements.iter().map(|p| (p.item, p.copy)));
    let unplaced = solution.unplaced.iter().map(|u| (u.item, u.copy));
    placed.chain(unplaced).for_each(|(item, copy)| match seen.get_mut(item).and_then(|copies| copies.get_mut(copy as usize))
    {
        Some(times) => *times += 1,
        None => problems.push(format!("item {item} copy {copy} does not exist")),
    });
    seen.iter().enumerate().for_each(|(item, copies)| {
        copies.iter().enumerate().filter(|(_, times)| **times != 1).for_each(|(copy, times)| {
            problems.push(format!("item {item} copy {copy} appears {times} times"));
        });
    });

    // the bins that are used stay within their stock
    instance.bins.iter().enumerate().for_each(|(kind, bin)| {
        let used = solution.bins.iter().filter(|load| load.bin == kind).count();
        if let Some(stock) = bin.stock.filter(|&stock| used > stock as usize)
        {
            problems.push(format!("bin type {kind}: {used} used, stock is {stock}"));
        }
    });
    if solution.stats.bins != solution.bins.len()
    {
        problems.push(format!("stats say {} bins, the solution has {}", solution.stats.bins, solution.bins.len()));
    }

    solution.bins.iter().enumerate().for_each(|(b, load)| {
        let Some(bin) = instance.bins.get(load.bin)
        else
        {
            problems.push(format!("bin {b}: bin type {} does not exist", load.bin));
            return;
        };
        let bound = Cuboid { min: [0, 0, 0], max: [bin.dims[0] as i64 + gap, bin.dims[1] as i64 + gap, bin.dims[2] as i64] };

        // the boxes of the placements that name an existing item and orientation, with who they are
        let boxes: Vec<(String, Cuboid, Cuboid)> = load
            .placements
            .iter()
            .filter_map(|p| {
                let name = format!("bin {b}: item {} copy {}", p.item, p.copy);
                let Some(item) = instance.items.get(p.item)
                else
                {
                    problems.push(format!("{name}: no such item"));
                    return None;
                };
                if p.orientation >= 6
                {
                    problems.push(format!("{name}: orientation {} does not exist", p.orientation));
                    return None;
                }
                if item.orientations & (1 << p.orientation) == 0
                {
                    problems.push(format!("{name}: orientation {} is not allowed for it", p.orientation));
                }
                let perm = PERMS[p.orientation as usize];
                let extent: V3 = [item.dims[perm[0]] as i64, item.dims[perm[1]] as i64, item.dims[perm[2]] as i64];
                let real = Cuboid::new([p.x as i64, p.y as i64, p.z as i64], extent);
                let spaced = Cuboid::new(real.min, [extent[0] + gap, extent[1] + gap, extent[2]]);
                Some((name, real, spaced))
            })
            .collect();

        boxes.iter().for_each(|(name, _, spaced)| {
            if !spaced.within(&bound)
            {
                problems.push(format!("{name}: sticks out of the bin (or leaves less than the gap at its far side)"));
            }
        });
        boxes.iter().enumerate().for_each(|(i, (a, _, spaced_a))| {
            boxes[i + 1..].iter().filter(|(_, _, spaced_b)| spaced_a.overlaps(spaced_b)).for_each(|(c, _, _)| {
                problems.push(format!("{a} overlaps (or is closer than the gap to) {c}"));
            });
        });
        boxes.iter().enumerate().for_each(|(i, (name, real, _))| {
            let others = boxes.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, (_, other, _))| other);
            if !stands(real, others, permille)
            {
                problems.push(format!("{name}: does not stand (needs {permille}/1000 of its base on the floor or on box tops, with its centre over them)"));
            }
        });

        let volume: u128 = boxes.iter().map(|(_, real, _)| real.volume() as u128).sum();
        if volume != load.volume as u128
        {
            problems.push(format!("bin {b}: reports a volume of {}, the items add up to {volume}", load.volume));
        }
    });

    problems
}

#[cfg(test)]
mod tests
{
    use super::*;
    use crate::model::{BinLoad, ItemRef, Placement, Stats};

    fn instance() -> Instance
    {
        serde_json::from_str(
            r#"{ "items": [
                    { "dims": [400, 400, 400], "count": 2 },
                    { "dims": [900, 400, 200], "orientations": 1 }
                ],
                "bins": [{ "dims": [1000, 800, 800], "stock": 1 }] }"#,
        )
        .unwrap()
    }

    fn place(item: usize, copy: u32, orientation: u8, x: u32, y: u32, z: u32) -> Placement
    {
        Placement { item, copy, orientation, x, y, z }
    }

    fn solution(placements: Vec<Placement>, unplaced: Vec<ItemRef>) -> Solution
    {
        let items = instance().items;
        let volume = placements
            .iter()
            .map(|p| {
                let perm = PERMS[p.orientation as usize];
                (0..3).map(|k| items[p.item].dims[perm[k]] as u64).product::<u64>()
            })
            .sum();
        Solution { bins: vec![BinLoad { bin: 0, placements, volume }], unplaced, stats: Stats { evaluations: 0, bins: 1, cost: 1.0 } }
    }

    /// Two cubes side by side on the floor and the long board across them.
    fn valid() -> Solution
    {
        solution(vec![place(0, 0, 0, 0, 0, 0), place(0, 1, 0, 400, 0, 0), place(1, 0, 0, 0, 0, 400)], vec![])
    }

    fn problems(solution: &Solution, config: &Config) -> Vec<String>
    {
        validate(&instance(), config, solution)
    }

    #[test]
    fn a_valid_solution_has_no_problems()
    {
        assert_eq!(problems(&valid(), &Config::default()), Vec::<String>::new());
    }

    #[test]
    fn an_item_outside_the_bin_is_found()
    {
        let s = solution(vec![place(0, 0, 0, 700, 0, 0), place(0, 1, 0, 0, 0, 0)], vec![ItemRef { item: 1, copy: 0 }]);
        assert!(problems(&s, &Config::default()).iter().any(|p| p.contains("sticks out")));
    }

    #[test]
    fn overlapping_items_are_found()
    {
        let s = solution(vec![place(0, 0, 0, 0, 0, 0), place(0, 1, 0, 300, 0, 0)], vec![ItemRef { item: 1, copy: 0 }]);
        assert!(problems(&s, &Config::default()).iter().any(|p| p.contains("overlaps")));
    }

    #[test]
    fn an_item_in_the_air_is_found()
    {
        let s = solution(vec![place(0, 0, 0, 0, 0, 100), place(0, 1, 0, 400, 0, 0)], vec![ItemRef { item: 1, copy: 0 }]);
        assert!(problems(&s, &Config::default()).iter().any(|p| p.contains("does not stand")));
    }

    #[test]
    fn a_board_with_its_centre_over_nothing_is_found_but_passes_with_the_support_under_its_centre()
    {
        // the 900 x 400 board rests only on the left cube: 44 % of its base, its centre (x = 450) is past the cube (x < 400)
        let hanging = solution(vec![place(0, 0, 0, 0, 0, 0), place(1, 0, 0, 0, 0, 400), place(0, 1, 0, 0, 400, 0)], vec![]);
        let loose = Config { support: 0.4, ..Config::default() };
        assert!(problems(&hanging, &loose).iter().any(|p| p.contains("item 1 copy 0: does not stand")), "{:?}", problems(&hanging, &loose));
        // with the cube under the middle of the board (x 250 to 650), the same 44 % is fine
        let middle = solution(vec![place(0, 0, 0, 200, 0, 0), place(1, 0, 0, 0, 0, 400), place(0, 1, 0, 0, 400, 0)], vec![]);
        assert!(!problems(&middle, &loose).iter().any(|p| p.contains("does not stand")), "{:?}", problems(&middle, &loose));
    }

    #[test]
    fn a_locked_item_in_another_orientation_is_found()
    {
        let s = solution(vec![place(0, 0, 0, 0, 0, 0), place(0, 1, 0, 400, 0, 0), place(1, 0, 1, 0, 0, 400)], vec![]);
        assert!(problems(&s, &Config::default()).iter().any(|p| p.contains("not allowed")));
    }

    #[test]
    fn a_copy_that_is_missing_twice_or_unknown_is_found()
    {
        let missing = solution(vec![place(0, 0, 0, 0, 0, 0), place(0, 1, 0, 400, 0, 0)], vec![]);
        assert!(problems(&missing, &Config::default()).iter().any(|p| p.contains("item 1 copy 0 appears 0 times")));
        let twice = solution(vec![place(0, 0, 0, 0, 0, 0), place(0, 0, 0, 400, 0, 0), place(1, 0, 0, 0, 0, 400)], vec![]);
        assert!(problems(&twice, &Config::default()).iter().any(|p| p.contains("item 0 copy 0 appears 2 times")));
        let unknown = solution(vec![place(0, 0, 0, 0, 0, 0), place(0, 1, 0, 400, 0, 0), place(1, 0, 0, 0, 0, 400), place(0, 5, 0, 0, 400, 0)], vec![]);
        assert!(problems(&unknown, &Config::default()).iter().any(|p| p.contains("copy 5 does not exist")));
    }

    #[test]
    fn using_more_bins_than_the_stock_is_found()
    {
        let mut s = valid();
        s.bins.push(BinLoad { bin: 0, placements: vec![], volume: 0 });
        s.stats.bins = 2;
        assert!(problems(&s, &Config::default()).iter().any(|p| p.contains("stock is 1")));
    }

    #[test]
    fn the_gap_is_kept_between_items_and_at_the_far_walls()
    {
        // 400 + 400 fits 800 with no gap; with a gap of 5 the second cube leaves 5 mm too little
        let config = Config { gap: 5, ..Config::default() };
        assert!(problems(&valid(), &config).iter().any(|p| p.contains("sticks out") || p.contains("overlaps")));
    }

    #[test]
    fn a_wrong_volume_is_found()
    {
        let mut s = valid();
        s.bins[0].volume += 1;
        assert!(problems(&s, &Config::default()).iter().any(|p| p.contains("volume")));
    }
}
