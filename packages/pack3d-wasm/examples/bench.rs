//! The benchmark families: bins, fill, time and the weakest support of the plans the solver gives.
//!
//!     cargo run --release --example bench [family]
//!
//! The instances are generated, not stored: a small LCG (state = state * 6364136223846793005 +
//! 1442695040888963407, next = state >> 33, range(lo, hi) = lo + next % (hi - lo + 1)); for every
//! item type the draws are x, z, y, count, class by class. The hash is FNV-1a 64 over x, z, y, count
//! of every type, so a change of generator shows up as another hash. The numbers of the
//! `bin-packing` crate on the same instances are in documentation/nlnet/ai/records/2026-10-29-pack3d.md.

use std::time::Instant;

use pack3d_wasm::geom::{Cuboid, PERMS, contact};
use pack3d_wasm::{Config, Instance, Solution, solve};
use serde_json::json;

struct Lcg(u64);

impl Lcg
{
    fn next(&mut self) -> u64
    {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }

    fn range(&mut self, lo: u32, hi: u32) -> u32
    {
        lo + (self.next() % (hi - lo + 1) as u64) as u32
    }
}

struct Class
{
    types: u32,
    count: (u32, u32),
    x: (u32, u32),
    y: (u32, u32),
    z: (u32, u32),
}

/// Load rules laid over a family: weights from the volume, limits on what rests on an item, stops, a door.
struct Rules
{
    /// Weight in grams = volume in mm3 / divisor (4000 is 250 kg per m3).
    divisor: u64,
    max_weight: u64,
    /// The load an item may carry in grams, from the index of its type and its class; None for no limit.
    max_load: fn(usize, usize) -> Option<u64>,
    /// The stop of the items of a class.
    stop: fn(usize) -> u32,
    door: Option<&'static str>,
}

struct Family
{
    name: &'static str,
    seed: u64,
    classes: Vec<Class>,
    bin: [u32; 3],
    orientations: u8,
    rules: Option<Rules>,
}

fn class(types: u32, count: (u32, u32), x: (u32, u32), y: (u32, u32), z: (u32, u32)) -> Class
{
    Class { types, count, x, y, z }
}

fn families() -> Vec<Family>
{
    vec![
        Family {
            name: "crate-kit",
            seed: 11,
            classes: vec![class(8, (1, 4), (400, 1100), (200, 600), (18, 36)), class(4, (2, 8), (600, 2200), (40, 80), (40, 80)), class(3, (1, 3), (200, 400), (150, 300), (80, 200))],
            bin: [2400, 800, 600],
            orientations: 63,
            rules: None,
        },
        Family { name: "pallet-mix", seed: 77, classes: vec![class(40, (1, 8), (120, 520), (120, 520), (80, 420))], bin: [1200, 800, 1800], orientations: 3, rules: None },
        Family { name: "pallet-same", seed: 5, classes: vec![class(6, (10, 40), (200, 500), (150, 400), (100, 350))], bin: [1200, 800, 1800], orientations: 3, rules: None },
        Family {
            name: "trailer",
            seed: 9,
            classes: vec![class(6, (1, 4), (2400, 3000), (200, 300), (2400, 2700)), class(4, (1, 3), (3000, 6000), (1200, 2400), (200, 300)), class(4, (1, 3), (3000, 5000), (1200, 2400), (250, 350))],
            bin: [13600, 2450, 2700],
            orientations: 63,
            rules: None,
        },
        // the pallet job with weights (250 kg per m3), a 600 kg pallet, every fifth type fragile and every fifth+2 able to carry 30 kg
        Family {
            name: "pallet-rules",
            seed: 77,
            classes: vec![class(40, (1, 8), (120, 520), (120, 520), (80, 420))],
            bin: [1200, 800, 1800],
            orientations: 3,
            rules: Some(Rules {
                divisor: 4000,
                max_weight: 600_000,
                max_load: |index, _| match index % 5
                {
                    0 => Some(0),
                    2 => Some(30_000),
                    _ => None,
                },
                stop: |_| 0,
                door: None,
            }),
        },
        // the trailer with weights (500 kg per m3), a 24 t limit, a door at the rear, the walls for stop 2 and the floors and roofs for stop 1
        Family {
            name: "trailer-stops",
            seed: 9,
            classes: vec![class(6, (1, 4), (2400, 3000), (200, 300), (2400, 2700)), class(4, (1, 3), (3000, 6000), (1200, 2400), (200, 300)), class(4, (1, 3), (3000, 5000), (1200, 2400), (250, 350))],
            bin: [13600, 2450, 2700],
            orientations: 63,
            rules: Some(Rules {
                divisor: 2000,
                max_weight: 24_000_000,
                max_load: |_, class| if class == 0 { None } else { Some(3_000_000) },
                stop: |class| if class == 0 { 2 } else { 1 },
                door: Some("+x"),
            }),
        },
    ]
}

/// Item types as (class, [x, y, z, count]), drawn in the order x, z, y, count.
fn draw(family: &Family) -> Vec<(usize, [u32; 4])>
{
    let mut r = Lcg(family.seed);
    family
        .classes
        .iter()
        .enumerate()
        .flat_map(|(class, c)| {
            (0..c.types)
                .map(|_| {
                    let x = r.range(c.x.0, c.x.1);
                    let z = r.range(c.z.0, c.z.1);
                    let y = r.range(c.y.0, c.y.1);
                    let count = r.range(c.count.0, c.count.1);
                    (class, [x, y, z, count])
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn hash(types: &[(usize, [u32; 4])]) -> u64
{
    types.iter().flat_map(|(_, t)| [t[0], t[2], t[1], t[3]]).fold(0xcbf29ce484222325u64, |h, v| (h ^ v as u64).wrapping_mul(0x100000001b3))
}

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
    println!("{:<13} {:>5} {:>17} {:>8} {:>5} {:>7} {:>9} {:>9} {:>9} {:>12}", "family", "boxes", "hash", "support", "bins", "fill %", "ms", "weakest %", "heaviest", "evaluations");
    families().iter().filter(|f| only.as_ref().is_none_or(|name| name == f.name)).for_each(|family| {
        let types = draw(family);
        let total: u32 = types.iter().map(|(_, t)| t[3]).sum();
        let volume: u128 = types.iter().map(|(_, t)| t[0] as u128 * t[1] as u128 * t[2] as u128 * t[3] as u128).sum();
        let bin_volume: u128 = family.bin.iter().map(|&d| d as u128).product();
        let items: Vec<_> = types
            .iter()
            .enumerate()
            .map(|(index, (class, t))| match &family.rules
            {
                None => json!({ "dims": [t[0], t[1], t[2]], "count": t[3], "orientations": family.orientations }),
                Some(rules) => json!({
                    "dims": [t[0], t[1], t[2]], "count": t[3], "orientations": family.orientations,
                    "weight": t[0] as u64 * t[1] as u64 * t[2] as u64 / rules.divisor,
                    "maxLoad": (rules.max_load)(index, *class),
                    "stop": (rules.stop)(*class),
                }),
            })
            .collect();
        let bin = match &family.rules
        {
            None => json!({ "dims": family.bin }),
            Some(rules) => json!({ "dims": family.bin, "maxWeight": rules.max_weight, "door": rules.door }),
        };
        let instance: Instance = serde_json::from_value(json!({ "name": family.name, "items": items, "bins": [bin] })).unwrap();

        [0.8, 1.0].iter().for_each(|&support| {
            let config = Config { support, ..Config::default() };
            let started = Instant::now();
            let solution = solve(&instance, &config).expect("a solution");
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            let fill = 100.0 * volume as f64 / (solution.bins.len().max(1) as f64 * bin_volume as f64);
            let unplaced = if solution.unplaced.is_empty() { String::new() } else { format!("  ({} unplaced)", solution.unplaced.len()) };
            let heaviest = solution.bins.iter().map(|bin| bin.placements.iter().map(|p| instance.items[p.item].weight).sum::<u64>()).max().unwrap_or(0);
            println!(
                "{:<13} {:>5} {:>17x} {:>8} {:>5} {:>7.1} {:>9.1} {:>9.1} {:>9} {:>12}{}",
                family.name,
                total,
                hash(&types),
                support,
                solution.bins.len(),
                fill,
                ms,
                weakest_support(&instance, &solution),
                if heaviest == 0 { "-".to_string() } else { format!("{} kg", heaviest / 1000) },
                solution.stats.evaluations,
                unplaced
            );
        });
    });
}
