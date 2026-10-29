//! The benchmark families, shared by the `bench` and `fixtures` examples.
//!
//! The instances are generated, not stored: a small LCG (state = state * 6364136223846793005 +
//! 1442695040888963407, next = state >> 33, range(lo, hi) = lo + next % (hi - lo + 1)); for every
//! item type the draws are x, z, y, count, class by class. The hash is FNV-1a 64 over x, z, y, count
//! of every type, so a change of generator shows up as another hash. The numbers of the
//! `bin-packing` crate on the same instances are in documentation/nlnet/ai/records/2026-10-29-pack3d.md.

#![allow(dead_code)]

use serde_json::{Value, json};

pub struct Lcg(pub u64);

impl Lcg
{
    pub fn next(&mut self) -> u64
    {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }

    pub fn range(&mut self, lo: u32, hi: u32) -> u32
    {
        lo + (self.next() % (hi - lo + 1) as u64) as u32
    }
}

pub struct Class
{
    pub types: u32,
    pub count: (u32, u32),
    pub x: (u32, u32),
    pub y: (u32, u32),
    pub z: (u32, u32),
}

/// Load rules laid over a family: weights from the volume, limits on what rests on an item, stops, a door.
pub struct Rules
{
    /// Weight in grams = volume in mm3 / divisor (4000 is 250 kg per m3).
    pub divisor: u64,
    pub max_weight: u64,
    /// The load an item may carry in grams, from the index of its type and its class; None for no limit.
    pub max_load: fn(usize, usize) -> Option<u64>,
    /// The stop of the items of a class.
    pub stop: fn(usize) -> u32,
    pub door: Option<&'static str>,
    /// Whether the bin asks for a balance: the centre of gravity within 15 % of the middle along the length and
    /// 5 % across, and two supports at 1.8 m and 11.6 m that carry 9 t and 20 t.
    pub balance: bool,
}

pub struct Family
{
    pub name: &'static str,
    pub seed: u64,
    pub classes: Vec<Class>,
    pub bin: [u32; 3],
    pub orientations: u8,
    pub rules: Option<Rules>,
}

pub fn class(types: u32, count: (u32, u32), x: (u32, u32), y: (u32, u32), z: (u32, u32)) -> Class
{
    Class { types, count, x, y, z }
}

pub fn families() -> Vec<Family>
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
                balance: false,
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
                balance: false,
            }),
        },
        // the same trailer asked to be balanced
        Family {
            name: "trailer-balance",
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
                balance: true,
            }),
        },
    ]
}

/// Item types as (class, [x, y, z, count]), drawn in the order x, z, y, count.
pub fn draw(family: &Family) -> Vec<(usize, [u32; 4])>
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

pub fn hash(types: &[(usize, [u32; 4])]) -> u64
{
    types.iter().flat_map(|(_, t)| [t[0], t[2], t[1], t[3]]).fold(0xcbf29ce484222325u64, |h, v| (h ^ v as u64).wrapping_mul(0x100000001b3))
}

/// The instance of a family as JSON: its item types (with the rules, if it has any) and its one bin.
pub fn instance_value(family: &Family, types: &[(usize, [u32; 4])]) -> Value
{
    let items: Vec<Value> = types
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
        Some(rules) =>
        {
            let balance = rules.balance.then(|| json!({ "cog": { "x": 0.15, "y": 0.05 }, "axles": [{ "at": 1800, "maxLoad": 9_000_000 }, { "at": 11600, "maxLoad": 20_000_000 }] }));
            json!({ "dims": family.bin, "maxWeight": rules.max_weight, "door": rules.door, "balance": balance })
        }
    };
    json!({ "name": family.name, "items": items, "bins": [bin] })
}
