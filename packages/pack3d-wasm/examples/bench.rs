//! The benchmark families: bins, fill, time and the weakest support of the plans the solver gives.
//!
//!     cargo run --release --example bench [family]
//!
//! The families and how they are generated are in `common/mod.rs`.

mod common;

use std::time::Instant;

use common::{draw, families, hash, instance_value};
use pack3d_wasm::geom::{Cuboid, PERMS, contact};
use pack3d_wasm::{Config, Instance, Solution, solve};

/// The smallest share of any item's base that rests on something, as a percentage.
fn weakest_support(instance: &Instance, solution: &Solution) -> f64
{
    solution
        .bins
        .iter()
        .flat_map(|bin| {
            let boxes: Vec<Cuboid> = bin
                .placements
                .iter()
                .map(|p| {
                    let perm = PERMS[p.orientation as usize];
                    let d = instance.items[p.item].dims;
                    Cuboid::new([p.x as i64, p.y as i64, p.z as i64], [d[perm[0]] as i64, d[perm[1]] as i64, d[perm[2]] as i64])
                })
                .collect();
            (0..boxes.len())
                .map(|i| {
                    if boxes[i].min[2] == 0
                    {
                        100.0
                    }
                    else
                    {
                        let others = boxes.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, b)| b);
                        100.0 * contact(&boxes[i], others).area as f64 / boxes[i].footprint_area() as f64
                    }
                })
                .collect::<Vec<f64>>()
        })
        .fold(100.0, f64::min)
}

fn main()
{
    let only = std::env::args().nth(1);
    println!("{:<13} {:>5} {:>17} {:>8} {:>5} {:>5} {:>7} {:>9} {:>9} {:>9} {:>12}", "family", "boxes", "hash", "support", "steps", "bins", "fill %", "ms", "weakest %", "heaviest", "evaluations");
    families().iter().filter(|f| only.as_ref().is_none_or(|name| name == f.name)).for_each(|family| {
        let types = draw(family);
        let total: u32 = types.iter().map(|(_, t)| t[3]).sum();
        let volume: u128 = types.iter().map(|(_, t)| t[0] as u128 * t[1] as u128 * t[2] as u128 * t[3] as u128).sum();
        let bin_volume: u128 = family.bin.iter().map(|&d| d as u128).product();
        let instance: Instance = serde_json::from_value(instance_value(family, &types)).unwrap();

        [(0.8, 0), (1.0, 0), (0.8, 100), (0.8, 300), (1.0, 300)].iter().for_each(|&(support, iterations)| {
            let config = Config { support, iterations, ..Config::default() };
            let started = Instant::now();
            let solution = solve(&instance, &config).expect("a solution");
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            let fill = 100.0 * volume as f64 / (solution.bins.len().max(1) as f64 * bin_volume as f64);
            let unplaced = if solution.unplaced.is_empty() { String::new() } else { format!("  ({} unplaced)", solution.unplaced.len()) };
            let unbalanced = solution.bins.iter().filter(|bin| !bin.balance_ok).count();
            let note = format!("{}{}", unplaced, if unbalanced > 0 { format!("  ({unbalanced} bins unbalanced)") } else { String::new() });
            let heaviest = solution.bins.iter().map(|bin| bin.placements.iter().map(|p| instance.items[p.item].weight).sum::<u64>()).max().unwrap_or(0);
            println!(
                "{:<13} {:>5} {:>17x} {:>8} {:>5} {:>5} {:>7.1} {:>9.1} {:>9.1} {:>9} {:>12}{}",
                family.name,
                total,
                hash(&types),
                support,
                iterations,
                solution.bins.len(),
                fill,
                ms,
                weakest_support(&instance, &solution),
                if heaviest == 0 { "-".to_string() } else { format!("{} kg", heaviest / 1000) },
                solution.stats.evaluations,
                note
            );
        });
    });
}
