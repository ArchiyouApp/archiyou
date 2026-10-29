//! The instance and the solution as they cross the JSON boundary, and the problem the solver
//! works on once the input has been checked.
//!
//! Lengths are whole millimetres. Axes: x is the length of a bin, y its width, z its height (up).

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::geom::{ALL_ORIENTATIONS, V3, distinct_orientations, extents};

/// Largest side of an item or a bin, in millimetres (a kilometre). It keeps every area in an i64.
pub const MAX_DIMENSION: u32 = 1_000_000;

/// Most physical items in one call.
pub const MAX_PIECES: u64 = 20_000;

fn one() -> u32
{
    1
}

fn one_f64() -> f64
{
    1.0
}

fn all_orientations() -> u8
{
    ALL_ORIENTATIONS
}

fn default_support() -> f64
{
    0.8
}

fn default_max_evaluations() -> u64
{
    40_000_000
}

/// The side of a bin that the load leaves by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Door
{
    #[serde(rename = "+x")]
    PosX,
    #[serde(rename = "-x")]
    NegX,
    #[serde(rename = "+y")]
    PosY,
    #[serde(rename = "-y")]
    NegY,
}

/// How far the centre of gravity of the load may be from the centre of the floor, as a fraction of
/// the length (x) and of the width (y) of the bin. Left out, an axis is free.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CogTolerance
{
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

/// A support the load rests on along the length of a bin (the kingpin or an axle group of a trailer).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Axle
{
    /// Where it is, in millimetres from the front wall of the bin (x = 0). It may be outside the bin.
    pub at: i64,
    /// The most it may carry, in grams.
    pub max_load: u64,
}

/// The balance a load has to have. Unlike the other rules it is best effort: the solver moves the
/// load to meet it and prefers plans that do, but a plan that cannot is returned and says so.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Balance
{
    #[serde(default)]
    pub cog: Option<CogTolerance>,
    /// Exactly two supports: the load is shared between them by the lever rule, and neither may be
    /// lifted (carry less than nothing) or overloaded.
    #[serde(default)]
    pub axles: Option<Vec<Axle>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Instance
{
    #[serde(default)]
    pub name: String,
    pub items: Vec<ItemType>,
    pub bins: Vec<BinType>,
}

/// A kind of item; `count` identical ones are loaded.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemType
{
    /// Extents as modelled: x, y, z with z up.
    pub dims: [u32; 3],
    #[serde(default = "one")]
    pub count: u32,
    /// Which of the six orientations (see `geom::PERMS`) the item may be loaded in, one bit each.
    #[serde(default = "all_orientations")]
    pub orientations: u8,
    /// Weight in grams.
    #[serde(default)]
    pub weight: u64,
    /// The weight in grams that may rest on this item, directly or through others; absent means
    /// no limit, 0 means nothing may be put on it.
    #[serde(default)]
    pub max_load: Option<u64>,
    /// At which stop this item is unloaded; lower stops are unloaded first, 0 means no order.
    #[serde(default)]
    pub stop: u32,
}

/// A kind of bin: pallet, crate, trailer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BinType
{
    /// Inner extents: length x, width y, height z.
    pub dims: [u32; 3],
    #[serde(default = "one_f64")]
    pub cost: f64,
    /// How many of this kind there are; absent means as many as needed.
    #[serde(default)]
    pub stock: Option<u32>,
    /// The most the load may weigh, in grams; absent means no limit.
    #[serde(default)]
    pub max_weight: Option<u64>,
    /// The side the load leaves by; absent means from the top only.
    #[serde(default)]
    pub door: Option<Door>,
    #[serde(default)]
    pub balance: Option<Balance>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config
{
    /// Which of the solver's equally good choices to take. The same instance, config and seed give
    /// the same bytes on every machine.
    #[serde(default)]
    pub seed: u64,
    /// The share of an item's base that has to rest on the floor or on the tops of other items. The
    /// item's centre also has to be over the contact, whatever the share.
    #[serde(default = "default_support")]
    pub support: f64,
    /// Clearance kept between items along x and y, in millimetres.
    #[serde(default)]
    pub gap: u32,
    /// Steps of the search that tries to improve the plan of the constructive runs; 0 returns that plan.
    #[serde(default)]
    pub iterations: u32,
    /// A limit on the work, counted in placements tried: no new constructive run or search step is
    /// started once it is reached, so a big instance ends with a valid plan that is less tight rather
    /// than late. It is a count and not a time, so the plan does not depend on the machine.
    #[serde(default = "default_max_evaluations")]
    pub max_evaluations: u64,
}

impl Default for Config
{
    fn default() -> Self
    {
        Config { seed: 0, support: default_support(), gap: 0, iterations: 0, max_evaluations: default_max_evaluations() }
    }
}

/// One item in its place: `item` is the index of the item type, `copy` which of its `count`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Placement
{
    pub item: usize,
    pub copy: u32,
    pub orientation: u8,
    /// The corner of the item with the smallest x, y and z.
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ItemRef
{
    pub item: usize,
    pub copy: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BinLoad
{
    /// Index of the bin type.
    pub bin: usize,
    /// In the order they were put in.
    pub placements: Vec<Placement>,
    /// Volume of the items in cubic millimetres.
    pub volume: u64,
    /// Weight of the items in grams.
    pub weight: u64,
    /// The centre of gravity in millimetres (x, y), when the load has weight.
    pub cog: Option<[f64; 2]>,
    /// What the supports carry, in grams, when the bin has them.
    pub axle_loads: Vec<u64>,
    /// Whether the balance the bin asks for is met (true when it asks for none).
    pub balance_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stats
{
    /// Placements the solver tried.
    pub evaluations: u64,
    /// Steps of the search that were taken.
    pub iterations: u32,
    pub bins: usize,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Solution
{
    pub bins: Vec<BinLoad>,
    pub unplaced: Vec<ItemRef>,
    pub stats: Stats,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(pub String);

impl fmt::Display for Error
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result
    {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

fn error<T>(message: String) -> Result<T, Error>
{
    Err(Error(message))
}

/// One physical item.
#[derive(Debug, Clone)]
pub struct Piece
{
    pub item: usize,
    pub copy: u32,
    pub dims: V3,
    /// The orientations to try, each with its extents; equal extents appear once.
    pub orientations: Vec<(u8, V3)>,
    pub weight: u64,
    pub max_load: Option<u64>,
    pub stop: u32,
}

#[derive(Debug, Clone)]
pub struct Kind
{
    pub dims: V3,
    /// In thousandths of the cost unit, so that sums and comparisons are exact.
    pub cost: u64,
    pub stock: Option<u32>,
    pub max_weight: Option<u64>,
    /// The door as the decoder sees it: always at the high end of an axis (`+x`, `+y`) or none. A bin
    /// whose door is at the low end is decoded mirrored along that axis and flipped back afterwards,
    /// so that the load is built from the far wall towards the door whichever side it is.
    pub door: Option<Door>,
    /// Whether the decoded layout has to be mirrored along x and along y to get the real one.
    pub flip: [bool; 2],
    pub balance: Option<BalanceSpec>,
    /// Volume of the bin in cubic millimetres.
    pub volume: u128,
}

/// The balance of a kind as integers: the tolerance of the centre of gravity in millionths of the
/// length and of the width, and the supports sorted by position.
#[derive(Debug, Clone)]
pub struct BalanceSpec
{
    pub cog_ppm: [Option<u64>; 2],
    pub axles: Option<[(i64, u64); 2]>,
}

/// The input after the checks: what the decoder and the validator's callers work with.
#[derive(Debug, Clone)]
pub struct Problem
{
    pub pieces: Vec<Piece>,
    pub kinds: Vec<Kind>,
    pub gap: i64,
    /// Required share of the base on its support, in thousandths.
    pub permille: i64,
    /// Whether any item has a limit on the load it carries: only then is the load tracked.
    pub stacking: bool,
}

/// What is wrong with a balance, in words, if anything.
fn balance_problem(balance: &Balance) -> Option<String>
{
    let fractions = balance.cog.iter().flat_map(|cog| [cog.x, cog.y]).flatten();
    if let Some(bad) = fractions.into_iter().find(|f| !(0.0..=0.5).contains(f))
    {
        return Some(format!("a centre of gravity tolerance is a fraction between 0 and 0.5, got {bad}"));
    }
    match balance.axles.as_deref()
    {
        None => None,
        Some([a, b]) if a.at != b.at => None,
        Some([_, _]) => Some("the two supports have to be at different places".to_string()),
        Some(other) => Some(format!("exactly two supports are needed, got {}", other.len())),
    }
}

fn balance_spec(balance: &Balance) -> BalanceSpec
{
    let ppm = |fraction: Option<f64>| fraction.map(|f| (f * 1_000_000.0).round() as u64);
    let cog = balance.cog.as_ref();
    BalanceSpec {
        cog_ppm: [ppm(cog.and_then(|c| c.x)), ppm(cog.and_then(|c| c.y))],
        axles: balance.axles.as_deref().and_then(|axles| match axles
        {
            [a, b] => Some(if a.at < b.at { [(a.at, a.max_load), (b.at, b.max_load)] } else { [(b.at, b.max_load), (a.at, a.max_load)] }),
            _ => None,
        }),
    }
}

impl Problem
{
    pub fn new(instance: &Instance, config: &Config) -> Result<Problem, Error>
    {
        if instance.bins.is_empty()
        {
            return error("at least one bin type is needed".to_string());
        }
        if !(0.0..=1.0).contains(&config.support)
        {
            return error(format!("support must be between 0 and 1, got {}", config.support));
        }
        let too_big = |dims: &[u32; 3]| dims.iter().any(|&d| d == 0 || d > MAX_DIMENSION);

        if let Some(i) = instance.items.iter().position(|item| too_big(&item.dims))
        {
            return error(format!("item {i}: every side must be between 1 and {MAX_DIMENSION} mm, got {:?}", instance.items[i].dims));
        }
        if let Some(i) = instance.items.iter().position(|item| item.orientations & ALL_ORIENTATIONS == 0 || item.orientations & !ALL_ORIENTATIONS != 0)
        {
            return error(format!("item {i}: orientations must be a non-empty mask of 6 bits, got {}", instance.items[i].orientations));
        }
        if let Some(i) = instance.bins.iter().position(|bin| too_big(&bin.dims))
        {
            return error(format!("bin {i}: every side must be between 1 and {MAX_DIMENSION} mm, got {:?}", instance.bins[i].dims));
        }
        if let Some(i) = instance.bins.iter().position(|bin| !bin.cost.is_finite() || bin.cost < 0.0)
        {
            return error(format!("bin {i}: cost must be a number of at least 0, got {}", instance.bins[i].cost));
        }
        if let Some(i) = instance.bins.iter().position(|bin| bin.balance.as_ref().is_some_and(|balance| balance_problem(balance).is_some()))
        {
            let problem = instance.bins[i].balance.as_ref().and_then(balance_problem).unwrap_or_default();
            return error(format!("bin {i}: balance: {problem}"));
        }
        let total: u64 = instance.items.iter().map(|item| item.count as u64).sum();
        if total > MAX_PIECES
        {
            return error(format!("{total} items is more than the {MAX_PIECES} one call takes"));
        }

        let pieces = instance
            .items
            .iter()
            .enumerate()
            .flat_map(|(item, kind)| {
                let dims = kind.dims.map(|d| d as i64);
                let orientations: Vec<(u8, V3)> = distinct_orientations(dims, kind.orientations).into_iter().map(|o| (o, extents(dims, o))).collect();
                (0..kind.count).map(move |copy| Piece { item, copy, dims, orientations: orientations.clone(), weight: kind.weight, max_load: kind.max_load, stop: kind.stop })
            })
            .collect();
        let kinds = instance
            .bins
            .iter()
            .map(|bin| {
                let (door, flip) = match bin.door
                {
                    Some(Door::NegX) => (Some(Door::PosX), [true, false]),
                    Some(Door::NegY) => (Some(Door::PosY), [false, true]),
                    other => (other, [false, false]),
                };
                let dims = bin.dims.map(|d| d as i64);
                Kind {
                    dims,
                    cost: (bin.cost * 1000.0).round() as u64,
                    stock: bin.stock,
                    max_weight: bin.max_weight,
                    door,
                    flip,
                    balance: bin.balance.as_ref().map(balance_spec),
                    volume: dims.iter().map(|&d| d as u128).product(),
                }
            })
            .collect();
        let stacking = instance.items.iter().any(|item| item.max_load.is_some());
        Ok(Problem { pieces, kinds, gap: config.gap as i64, permille: (config.support * 1000.0).round() as i64, stacking })
    }
}

#[cfg(test)]
mod tests
{
    use super::*;

    fn instance(json: &str) -> Instance
    {
        serde_json::from_str(json).expect("a valid instance")
    }

    #[test]
    fn defaults_are_one_piece_all_orientations_and_one_cost_unit()
    {
        let i = instance(r#"{ "items": [{ "dims": [10, 20, 30] }], "bins": [{ "dims": [100, 100, 100] }] }"#);
        assert_eq!(i.items[0].count, 1);
        assert_eq!(i.items[0].orientations, ALL_ORIENTATIONS);
        assert_eq!(i.bins[0].cost, 1.0);
        assert_eq!(i.bins[0].stock, None);
        let c: Config = serde_json::from_str("{}").unwrap();
        assert_eq!((c.seed, c.support, c.gap, c.iterations, c.max_evaluations), (0, 0.8, 0, 0, 40_000_000));
    }

    #[test]
    fn an_unknown_field_is_an_error_not_a_silent_default()
    {
        let bad = serde_json::from_str::<Instance>(r#"{ "items": [{ "dims": [1, 1, 1], "wieght": 5 }], "bins": [] }"#);
        assert!(bad.is_err());
        assert!(serde_json::from_str::<Config>(r#"{ "suport": 1 }"#).is_err());
    }

    #[test]
    fn pieces_are_numbered_per_item_and_squares_turn_once()
    {
        let i = instance(r#"{ "items": [{ "dims": [10, 10, 30], "count": 2 }, { "dims": [5, 6, 7], "count": 1, "orientations": 3 }], "bins": [{ "dims": [100, 100, 100] }] }"#);
        let problem = Problem::new(&i, &Config::default()).unwrap();
        let ids: Vec<(usize, u32)> = problem.pieces.iter().map(|p| (p.item, p.copy)).collect();
        assert_eq!(ids, [(0, 0), (0, 1), (1, 0)]);
        // 10 x 10 x 30: turning about z gives the same box, so three orientations remain
        assert_eq!(problem.pieces[0].orientations.iter().map(|o| o.0).collect::<Vec<_>>(), [0, 2, 3]);
        assert_eq!(problem.pieces[2].orientations.iter().map(|o| o.0).collect::<Vec<_>>(), [0, 1]);
    }

    #[test]
    fn bad_input_is_named()
    {
        let check = |json: &str, config: Config| Problem::new(&instance(json), &config).unwrap_err().0;
        assert!(check(r#"{ "items": [], "bins": [] }"#, Config::default()).contains("at least one bin"));
        assert!(check(r#"{ "items": [{ "dims": [0, 1, 1] }], "bins": [{ "dims": [1, 1, 1] }] }"#, Config::default()).contains("item 0"));
        assert!(check(r#"{ "items": [{ "dims": [1, 1, 1] }], "bins": [{ "dims": [1, 1, 2000000] }] }"#, Config::default()).contains("bin 0"));
        assert!(check(r#"{ "items": [{ "dims": [1, 1, 1], "orientations": 0 }], "bins": [{ "dims": [1, 1, 1] }] }"#, Config::default()).contains("orientations"));
        assert!(check(r#"{ "items": [{ "dims": [1, 1, 1], "orientations": 64 }], "bins": [{ "dims": [1, 1, 1] }] }"#, Config::default()).contains("orientations"));
        assert!(check(r#"{ "items": [{ "dims": [1, 1, 1] }], "bins": [{ "dims": [1, 1, 1], "cost": -1 }] }"#, Config::default()).contains("cost"));
        assert!(check(r#"{ "items": [{ "dims": [1, 1, 1] }], "bins": [{ "dims": [1, 1, 1] }] }"#, Config { support: 1.5, ..Config::default() }).contains("support"));
        assert!(check(r#"{ "items": [{ "dims": [1, 1, 1], "count": 20001 }], "bins": [{ "dims": [1, 1, 1] }] }"#, Config::default()).contains("20001"));
    }

    #[test]
    fn a_door_at_the_low_end_is_decoded_mirrored()
    {
        let door = |d: &str| format!(r#"{{ "items": [{{ "dims": [1, 1, 1] }}], "bins": [{{ "dims": [9, 9, 9], "door": {d} }}] }}"#);
        let kind = |d: &str| Problem::new(&instance(&door(d)), &Config::default()).unwrap().kinds.remove(0);
        let seen = |d: &str| {
            let k = kind(d);
            (k.door, k.flip)
        };
        assert_eq!(seen(r#""+x""#), (Some(Door::PosX), [false, false]));
        assert_eq!(seen(r#""-x""#), (Some(Door::PosX), [true, false]));
        assert_eq!(seen(r#""+y""#), (Some(Door::PosY), [false, false]));
        assert_eq!(seen(r#""-y""#), (Some(Door::PosY), [false, true]));
        assert_eq!(seen("null"), (None, [false, false]));
    }

    #[test]
    fn cost_and_support_become_integers()
    {
        let i = instance(r#"{ "items": [{ "dims": [1, 1, 1] }], "bins": [{ "dims": [1, 1, 1], "cost": 12.5 }] }"#);
        let problem = Problem::new(&i, &Config { support: 0.8, gap: 5, ..Config::default() }).unwrap();
        assert_eq!(problem.kinds[0].cost, 12500);
        assert_eq!((problem.permille, problem.gap), (800, 5));
    }
}
