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
use crate::model::{Balance, Config, Door, Instance, Solution};

/// A placement as the validator reads it.
struct Boxed
{
    name: String,
    item: usize,
    real: Cuboid,
    spaced: Cuboid,
}

/// The weight that rests on each box, directly or through others.
///
/// Worked out from the finished plan, from the top down: a box passes on its own weight and what
/// rests on it to the boxes under it, each getting a share in proportion to the area of contact,
/// rounded up to the gram. Nothing is carried over from how the plan was built.
fn carried_loads(instance: &Instance, boxes: &[Boxed]) -> Vec<u64>
{
    let mut load = vec![0u64; boxes.len()];
    let mut top_down: Vec<usize> = (0..boxes.len()).collect();
    top_down.sort_by(|&a, &b| boxes[b].real.min[2].cmp(&boxes[a].real.min[2]).then(a.cmp(&b)));
    top_down.iter().for_each(|&j| {
        let under: Vec<(usize, i64)> = (0..boxes.len())
            .filter(|&q| q != j && boxes[q].real.max[2] == boxes[j].real.min[2])
            .map(|q| (q, boxes[j].real.footprint_overlap(&boxes[q].real)))
            .filter(|&(_, area)| area > 0)
            .collect();
        let area: u128 = under.iter().map(|&(_, a)| a as u128).sum();
        let passed = (instance.items[boxes[j].item].weight + load[j]) as u128;
        under.iter().for_each(|&(q, a)| load[q] += ((passed * a as u128).div_ceil(area)) as u64);
    });
    load
}

/// Whether `late`, which is unloaded after `early`, is in the way of it: over it, or between it and the door.
fn blocks(door: Option<Door>, late: &Cuboid, early: &Cuboid) -> bool
{
    let overlap = |axis: usize| late.min[axis] < early.max[axis] && early.min[axis] < late.max[axis];
    let above = late.min[2] >= early.max[2] && overlap(0) && overlap(1);
    let in_front = match door
    {
        Some(Door::PosX) => late.min[0] >= early.max[0] && overlap(1) && overlap(2),
        Some(Door::NegX) => late.max[0] <= early.min[0] && overlap(1) && overlap(2),
        Some(Door::PosY) => late.min[1] >= early.max[1] && overlap(0) && overlap(2),
        Some(Door::NegY) => late.max[1] <= early.min[1] && overlap(0) && overlap(2),
        None => false,
    };
    above || in_front
}

/// Whether a load of `weight` grams with doubled moments `mx` and `my` about the front and side wall
/// has the balance asked for. Written out directly as the centre-of-gravity bands and the lever rule
/// on the two supports, not as the intervals that the solver moves the load by.
fn balance_met(balance: &Balance, dims: [u32; 3], weight: i128, mx: i128, my: i128) -> bool
{
    if weight == 0
    {
        return true;
    }
    let within = |moment: i128, length: u32, fraction: Option<f64>| {
        fraction.is_none_or(|f| {
            let ppm = (f * 1_000_000.0).round() as i128;
            (moment - weight * length as i128).abs() * 1_000_000 <= 2 * ppm * length as i128 * weight
        })
    };
    let cog = balance.cog.as_ref();
    let supports = match balance.axles.as_deref()
    {
        Some([a, b]) =>
        {
            let (front, rear) = if a.at < b.at { (a, b) } else { (b, a) };
            let span2 = 2 * (rear.at - front.at) as i128;
            let on_rear = mx - 2 * weight * front.at as i128;
            let on_front = 2 * weight * rear.at as i128 - mx;
            on_rear >= 0 && on_front >= 0 && on_rear <= span2 * rear.max_load as i128 && on_front <= span2 * front.max_load as i128
        }
        _ => true,
    };
    supports && within(mx, dims[0], cog.and_then(|c| c.x)) && within(my, dims[1], cog.and_then(|c| c.y))
}

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

        // the boxes of the placements that name an existing item and orientation
        let boxes: Vec<Boxed> = load
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
                Some(Boxed { name, item: p.item, real, spaced })
            })
            .collect();

        boxes.iter().for_each(|boxed| {
            if !boxed.spaced.within(&bound)
            {
                problems.push(format!("{}: sticks out of the bin (or leaves less than the gap at its far side)", boxed.name));
            }
        });
        boxes.iter().enumerate().for_each(|(i, a)| {
            boxes[i + 1..].iter().filter(|c| a.spaced.overlaps(&c.spaced)).for_each(|c| {
                problems.push(format!("{} overlaps (or is closer than the gap to) {}", a.name, c.name));
            });
        });
        boxes.iter().enumerate().for_each(|(i, boxed)| {
            let others = boxes.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, other)| &other.real);
            if !stands(&boxed.real, others, permille)
            {
                problems.push(format!("{}: does not stand (needs {permille}/1000 of its base on the floor or on box tops, with its centre over them)", boxed.name));
            }
        });

        let volume: u128 = boxes.iter().map(|boxed| boxed.real.volume() as u128).sum();
        if volume != load.volume as u128
        {
            problems.push(format!("bin {b}: reports a volume of {}, the items add up to {volume}", load.volume));
        }

        // weight
        let weight: u64 = boxes.iter().map(|boxed| instance.items[boxed.item].weight).sum();
        if let Some(max) = bin.max_weight.filter(|&max| weight > max)
        {
            problems.push(format!("bin {b}: carries {weight} g, the most is {max} g"));
        }

        // the balance the plan reports for the bin is the balance it has
        let moment = |axis: usize| boxes.iter().map(|boxed| instance.items[boxed.item].weight as i128 * (boxed.real.min[axis] + boxed.real.max[axis]) as i128).sum::<i128>();
        let (mx, my) = (moment(0), moment(1));
        if load.weight != weight
        {
            problems.push(format!("bin {b}: reports a weight of {} g, the items add up to {weight} g", load.weight));
        }
        let met = bin.balance.as_ref().is_none_or(|balance| balance_met(balance, bin.dims, weight as i128, mx, my));
        if load.balance_ok != met
        {
            problems.push(format!("bin {b}: reports that its balance is {}met, it is {}", if load.balance_ok { "" } else { "not " }, if met { "met" } else { "not met" }));
        }
        let cog = (weight > 0).then(|| [mx as f64 / (2.0 * weight as f64), my as f64 / (2.0 * weight as f64)]);
        if load.cog != cog
        {
            problems.push(format!("bin {b}: reports the centre of gravity {:?}, it is {cog:?}", load.cog));
        }
        let axles = bin.balance.as_ref().and_then(|balance| balance.axles.as_deref()).filter(|axles| axles.len() == 2);
        let axle_loads: Vec<u64> = axles
            .map(|axles| {
                let (front, rear) = if axles[0].at < axles[1].at { (&axles[0], &axles[1]) } else { (&axles[1], &axles[0]) };
                let span2 = 2 * (rear.at - front.at) as u128;
                let on_front = (2 * weight as i128 * rear.at as i128 - mx).max(0) as u128;
                let on_rear = (mx - 2 * weight as i128 * front.at as i128).max(0) as u128;
                vec![on_front.div_ceil(span2) as u64, on_rear.div_ceil(span2) as u64]
            })
            .unwrap_or_default();
        if load.axle_loads != axle_loads
        {
            problems.push(format!("bin {b}: reports the support loads {:?} g, they are {axle_loads:?} g", load.axle_loads));
        }

        // what rests on what
        if instance.items.iter().any(|item| item.max_load.is_some())
        {
            let loads = carried_loads(instance, &boxes);
            boxes.iter().zip(&loads).for_each(|(boxed, &carried)| {
                if let Some(max) = instance.items[boxed.item].max_load.filter(|&max| carried > max)
                {
                    problems.push(format!("{}: carries {carried} g, the most it may carry is {max} g", boxed.name));
                }
            });
        }

        // unloading order: nothing that is unloaded later may be over an item or between it and the door
        boxes.iter().for_each(|early| {
            boxes
                .iter()
                .filter(|late| {
                    let (s_early, s_late) = (instance.items[early.item].stop, instance.items[late.item].stop);
                    s_early > 0 && s_late > s_early
                })
                .filter(|late| blocks(bin.door, &late.real, &early.real))
                .for_each(|late| {
                    problems.push(format!("{} is unloaded before {} but {} is in the way", early.name, late.name, late.name));
                });
        });
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
        Solution { bins: vec![BinLoad { bin: 0, placements, volume, weight: 0, cog: None, axle_loads: vec![], balance_ok: true }], unplaced, stats: Stats { evaluations: 0, bins: 1, cost: 1.0 } }
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
        s.bins.push(BinLoad { bin: 0, placements: vec![], volume: 0, weight: 0, cog: None, axle_loads: vec![], balance_ok: true });
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

    /// A plan for any instance: the placements as (item, copy, orientation, x, y, z), nothing unplaced.
    fn plan(instance: &Instance, placements: &[(usize, u32, u8, u32, u32, u32)]) -> Solution
    {
        let placements: Vec<Placement> = placements.iter().map(|&(item, copy, orientation, x, y, z)| Placement { item, copy, orientation, x, y, z }).collect();
        let volume = placements
            .iter()
            .map(|p| {
                let perm = PERMS[p.orientation as usize];
                (0..3).map(|k| instance.items[p.item].dims[perm[k]] as u64).product::<u64>()
            })
            .sum();
        // the report is filled in as the solver would: weight, centre of gravity, supports, and the verdict on the balance
        let weight: u64 = placements.iter().map(|p| instance.items[p.item].weight).sum();
        let moment = |axis: usize| -> i128 {
            placements
                .iter()
                .map(|p| {
                    let perm = PERMS[p.orientation as usize];
                    let at = [p.x, p.y, p.z][axis] as i128;
                    instance.items[p.item].weight as i128 * (2 * at + instance.items[p.item].dims[perm[axis]] as i128)
                })
                .sum()
        };
        let cog = (weight > 0).then(|| [moment(0) as f64 / (2.0 * weight as f64), moment(1) as f64 / (2.0 * weight as f64)]);
        let bin = &instance.bins[0];
        let balance_ok = bin.balance.as_ref().is_none_or(|balance| balance_met(balance, bin.dims, weight as i128, moment(0), moment(1)));
        let axle_loads = bin
            .balance
            .as_ref()
            .and_then(|balance| balance.axles.as_deref())
            .map(|axles| {
                let (front, rear) = if axles[0].at < axles[1].at { (&axles[0], &axles[1]) } else { (&axles[1], &axles[0]) };
                let span2 = 2 * (rear.at - front.at) as u128;
                vec![((2 * weight as i128 * rear.at as i128 - moment(0)).max(0) as u128).div_ceil(span2) as u64, ((moment(0) - 2 * weight as i128 * front.at as i128).max(0) as u128).div_ceil(span2) as u64]
            })
            .unwrap_or_default();
        Solution { bins: vec![BinLoad { bin: 0, placements, volume, weight, cog, axle_loads, balance_ok }], unplaced: vec![], stats: Stats { evaluations: 0, bins: 1, cost: 1.0 } }
    }

    fn from_json(json: &str) -> Instance
    {
        serde_json::from_str(json).unwrap()
    }

    fn found(instance: &Instance, config: &Config, solution: &Solution, word: &str) -> bool
    {
        validate(instance, config, solution).iter().any(|p| p.contains(word))
    }

    #[test]
    fn a_bin_over_its_weight_limit_is_found()
    {
        let json = |max: u64| format!(r#"{{ "items": [{{ "dims": [400, 400, 400], "count": 3, "weight": 20000 }}], "bins": [{{ "dims": [1200, 400, 400], "maxWeight": {max} }}] }}"#);
        let placements = [(0, 0, 0, 0, 0, 0), (0, 1, 0, 400, 0, 0), (0, 2, 0, 800, 0, 0)];
        let (heavy, fine) = (from_json(&json(50000)), from_json(&json(60000)));
        assert!(found(&heavy, &Config::default(), &plan(&heavy, &placements), "carries 60000 g, the most is 50000 g"));
        assert!(!found(&fine, &Config::default(), &plan(&fine, &placements), "carries"), "the control: 60000 g is allowed up to 60000");
    }

    #[test]
    fn an_item_under_more_than_it_may_carry_is_found()
    {
        let json = |top_weight: u64| format!(r#"{{ "items": [{{ "dims": [400, 400, 400], "weight": 10000, "maxLoad": 5000 }}, {{ "dims": [400, 400, 400], "weight": {top_weight} }}], "bins": [{{ "dims": [400, 400, 800] }}] }}"#);
        let placements = [(0, 0, 0, 0, 0, 0), (1, 0, 0, 0, 0, 400)];
        let (too_heavy, ok) = (from_json(&json(8000)), from_json(&json(4000)));
        assert!(found(&too_heavy, &Config::default(), &plan(&too_heavy, &placements), "carries 8000 g, the most it may carry is 5000 g"));
        assert!(!found(&ok, &Config::default(), &plan(&ok, &placements), "may carry"), "the control: 4000 g is under the limit");
    }

    #[test]
    fn nothing_may_rest_on_an_item_that_carries_nothing()
    {
        let json = |max_load: &str| format!(r#"{{ "items": [{{ "dims": [400, 400, 400], "weight": 1000, "maxLoad": {max_load} }}, {{ "dims": [400, 400, 400], "weight": 1 }}], "bins": [{{ "dims": [400, 400, 800] }}] }}"#);
        let placements = [(0, 0, 0, 0, 0, 0), (1, 0, 0, 0, 0, 400)];
        let (fragile, sturdy) = (from_json(&json("0")), from_json(&json("null")));
        assert!(found(&fragile, &Config::default(), &plan(&fragile, &placements), "the most it may carry is 0 g"));
        assert!(!found(&sturdy, &Config::default(), &plan(&sturdy, &placements), "may carry"), "the control: no limit");
    }

    #[test]
    fn a_plate_on_two_columns_puts_half_of_its_weight_on_each()
    {
        // 10 kg plate on two equal columns: 5 kg on each, so a limit of 5000 g holds and 4999 g does not
        let json = |limit: u64| format!(r#"{{ "items": [{{ "dims": [200, 400, 300], "count": 2, "maxLoad": {limit} }}, {{ "dims": [800, 400, 50], "weight": 10000 }}], "bins": [{{ "dims": [800, 400, 400] }}] }}"#);
        let placements = [(0, 0, 0, 0, 0, 0), (0, 1, 0, 600, 0, 0), (1, 0, 0, 0, 0, 300)];
        let half = Config { support: 0.5, ..Config::default() };
        let (exact, short) = (from_json(&json(5000)), from_json(&json(4999)));
        assert_eq!(validate(&exact, &half, &plan(&exact, &placements)), Vec::<String>::new());
        assert!(found(&short, &half, &plan(&short, &placements), "carries 5000 g"));
    }

    #[test]
    fn the_load_passes_down_through_the_boxes_in_between()
    {
        // three boxes of 1000 g in a column: the bottom one carries 2000 g
        let json = |limit: u64| format!(r#"{{ "items": [{{ "dims": [400, 400, 400], "weight": 1000, "maxLoad": {limit}, "count": 3 }}], "bins": [{{ "dims": [400, 400, 1200] }}] }}"#);
        let placements = [(0, 0, 0, 0, 0, 0), (0, 1, 0, 0, 0, 400), (0, 2, 0, 0, 0, 800)];
        let (low, high) = (from_json(&json(1500)), from_json(&json(2000)));
        assert!(found(&low, &Config::default(), &plan(&low, &placements), "carries 2000 g"));
        assert_eq!(validate(&high, &Config::default(), &plan(&high, &placements)), Vec::<String>::new());
    }

    #[test]
    fn an_item_with_a_later_stop_in_front_of_the_door_is_found()
    {
        let json = |door: &str, early_stop: u32, late_stop: u32| {
            format!(r#"{{ "items": [{{ "dims": [400, 400, 400], "stop": {early_stop} }}, {{ "dims": [400, 400, 400], "stop": {late_stop} }}], "bins": [{{ "dims": [800, 400, 400], "door": {door} }}] }}"#)
        };
        // item 0 (early) at the front of the bin, item 1 (late) between it and the door at +x
        let placements = [(0, 0, 0, 0, 0, 0), (1, 0, 0, 400, 0, 0)];
        let blocked = from_json(&json(r#""+x""#, 1, 2));
        assert!(found(&blocked, &Config::default(), &plan(&blocked, &placements), "is unloaded before"));
        // the controls: the door on the other side, no door (top only), the same stop, no stop
        for ok in [json(r#""-x""#, 1, 2), json("null", 1, 2), json(r#""+x""#, 2, 2), json(r#""+x""#, 0, 2), json(r#""+x""#, 1, 0)]
        {
            let instance = from_json(&ok);
            assert!(!found(&instance, &Config::default(), &plan(&instance, &placements), "is unloaded before"), "{ok}");
        }
        // and the late item the other way round (deeper than the early one) is fine at +x
        let fine = from_json(&json(r#""+x""#, 2, 1));
        assert!(!found(&fine, &Config::default(), &plan(&fine, &placements), "is unloaded before"));
    }

    #[test]
    fn an_item_with_a_later_stop_on_top_is_found_with_or_without_a_door()
    {
        let json = |door: &str| format!(r#"{{ "items": [{{ "dims": [400, 400, 400], "stop": 1 }}, {{ "dims": [400, 400, 400], "stop": 2 }}], "bins": [{{ "dims": [400, 400, 800], "door": {door} }}] }}"#);
        let early_below = [(0, 0, 0, 0, 0, 0), (1, 0, 0, 0, 0, 400)];
        let late_below = [(1, 0, 0, 0, 0, 0), (0, 0, 0, 0, 0, 400)];
        for door in ["null", r#""+y""#]
        {
            let instance = from_json(&json(door));
            assert!(found(&instance, &Config::default(), &plan(&instance, &early_below), "is unloaded before"), "{door}");
            assert!(!found(&instance, &Config::default(), &plan(&instance, &late_below), "is unloaded before"), "the control, {door}");
        }
    }

    /// A 1000 mm bin with supports at 100 and 900 (800 g each at most) and a 10 % tolerance, and a 1 kg cube of 400.
    fn balanced_bin() -> Instance
    {
        from_json(r#"{ "items": [{ "dims": [400, 400, 400], "weight": 1000 }], "bins": [{ "dims": [1000, 400, 400], "balance": { "cog": { "x": 0.1 }, "axles": [{ "at": 100, "maxLoad": 800 }, { "at": 900, "maxLoad": 800 }] } }] }"#)
    }

    #[test]
    fn a_balance_that_is_not_met_is_reported_and_is_not_a_violation()
    {
        let instance = balanced_bin();
        let off = plan(&instance, &[(0, 0, 0, 0, 0, 0)]); // the centre of gravity at 200: far from the middle, and the front support carries 875 g
        assert!(!off.bins[0].balance_ok);
        assert_eq!(off.bins[0].axle_loads, [875, 125]);
        assert_eq!(validate(&instance, &Config::default(), &off), Vec::<String>::new(), "best effort: a plan that says so is valid");
        let middle = plan(&instance, &[(0, 0, 0, 300, 0, 0)]);
        assert!(middle.bins[0].balance_ok, "the control: the same cube in the middle");
        assert_eq!((middle.bins[0].axle_loads.clone(), middle.bins[0].cog), (vec![500, 500], Some([500.0, 200.0])));
        assert_eq!(validate(&instance, &Config::default(), &middle), Vec::<String>::new());
    }

    #[test]
    fn a_report_that_says_otherwise_is_found()
    {
        let instance = balanced_bin();
        let lie = |change: &dyn Fn(&mut BinLoad), word: &str| {
            let mut plan = plan(&instance, &[(0, 0, 0, 0, 0, 0)]);
            change(&mut plan.bins[0]);
            assert!(found(&instance, &Config::default(), &plan, word), "{word}");
        };
        lie(&|bin| bin.balance_ok = true, "reports that its balance is met");
        lie(&|bin| bin.weight += 1, "reports a weight");
        lie(&|bin| bin.cog = Some([500.0, 200.0]), "reports the centre of gravity");
        lie(&|bin| bin.axle_loads = vec![500, 500], "reports the support loads");
    }
}
