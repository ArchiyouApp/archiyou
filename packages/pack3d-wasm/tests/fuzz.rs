//! Random instances against the validator: whatever the solver returns must break no rule, must be
//! the same twice, and must leave an item unplaced only when it cannot go anywhere.

use pack3d_wasm::geom::distinct_orientations;
use pack3d_wasm::{Config, Instance, solve, validate};
use serde_json::json;

struct Lcg(u64);

impl Lcg
{
    fn next(&mut self) -> u64
    {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }

    fn range(&mut self, lo: u64, hi: u64) -> u64
    {
        lo + self.next() % (hi - lo + 1)
    }

    fn pick<T: Clone>(&mut self, options: &[T]) -> T
    {
        options[self.range(0, options.len() as u64 - 1) as usize].clone()
    }
}

fn random_case(seed: u64) -> (Instance, Config)
{
    let mut r = Lcg(seed);
    let items: Vec<_> = (0..r.range(1, 6))
        .map(|_| {
            let any_mask = r.range(1, 63);
            let orientations = r.pick(&[1u64, 3, 63, 63, 12, 48, any_mask]);
            let weight = r.pick(&[0u64, 0, 500, 5000, 40000]);
            let max_load = r.pick(&[json!(null), json!(null), json!(0), json!(10000), json!(60000)]);
            let stop = r.pick(&[0u64, 0, 1, 2, 3]);
            json!({
                "dims": [r.range(20, 500), r.range(20, 500), r.range(20, 500)],
                "count": r.range(1, 5),
                "orientations": orientations,
                "weight": weight,
                "maxLoad": max_load,
                "stop": stop,
            })
        })
        .collect();
    let limited = r.range(0, 2) == 0;
    let bins: Vec<_> = (0..r.range(1, 3))
        .map(|_| {
            let stock = if limited { json!(r.range(1, 3)) } else { json!(null) };
            let max_weight = r.pick(&[json!(null), json!(null), json!(80000), json!(300000)]);
            let door = r.pick(&[json!(null), json!("+x"), json!("-x"), json!("+y"), json!("-y")]);
            let balance = r.pick(&[
                json!(null),
                json!(null),
                json!({ "cog": { "x": 0.1, "y": 0.1 } }),
                json!({ "cog": { "x": 0.25 } }),
                json!({ "axles": [{ "at": 100, "maxLoad": 100000 }, { "at": 900, "maxLoad": 100000 }] }),
                json!({ "cog": { "y": 0.05 }, "axles": [{ "at": 900, "maxLoad": 60000 }, { "at": 100, "maxLoad": 60000 }] }),
            ]);
            json!({ "dims": [r.range(300, 1200), r.range(300, 1200), r.range(300, 1200)], "cost": r.range(1, 5), "stock": stock, "maxWeight": max_weight, "door": door, "balance": balance })
        })
        .collect();
    let config = json!({ "support": r.pick(&[0.0, 0.5, 0.8, 1.0]), "gap": r.pick(&[0u64, 0, 5, 10]), "iterations": r.pick(&[0u64, 0, 0, 12]), "seed": r.range(0, 9) });
    (serde_json::from_value(json!({ "items": items, "bins": bins })).unwrap(), serde_json::from_value(config).unwrap())
}

/// Whether the item can go in an empty bin of some kind at all: it fits in one orientation and is not too heavy.
fn fits_some_bin(instance: &Instance, item: usize) -> bool
{
    let dims = instance.items[item].dims.map(|d| d as i64);
    let weight = instance.items[item].weight;
    distinct_orientations(dims, instance.items[item].orientations).into_iter().any(|o| {
        instance.bins.iter().any(|bin| bin.max_weight.is_none_or(|max| weight <= max) && (0..3).all(|a| pack3d_wasm::geom::extents(dims, o)[a] <= bin.dims[a] as i64))
    })
}

fn check(seed: u64)
{
    let (instance, config) = random_case(seed);
    let solution = solve(&instance, &config).unwrap_or_else(|e| panic!("seed {seed}: {e}"));
    assert_eq!(validate(&instance, &config, &solution), Vec::<String>::new(), "seed {seed}");
    assert_eq!(solve(&instance, &config).unwrap(), solution, "seed {seed}: not the same twice");
    if instance.bins.iter().all(|bin| bin.stock.is_none())
    {
        solution.unplaced.iter().for_each(|u| assert!(!fits_some_bin(&instance, u.item), "seed {seed}: item {} fits a bin but was left out", u.item));
    }
}

#[test]
fn two_hundred_random_instances_break_no_rule()
{
    (0..200).for_each(check);
}

/// The big one: `cargo test --release -- --ignored`.
#[test]
#[ignore]
fn five_thousand_random_instances_break_no_rule()
{
    (1000..6000).for_each(check);
}
