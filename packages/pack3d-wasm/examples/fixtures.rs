//! Writes the fixtures that native and WebAssembly runs are compared on: `tests/fixtures/<name>.json`
//! (an instance and a config) and `tests/fixtures/expected.json` (the FNV-1a 64 hash of the solution
//! JSON that this native build gives, with the number of bins and unplaced items for the reader).
//!
//!     cargo run --release --example fixtures
//!
//! `cargo test` checks that the committed hashes still are what the native build gives, and the
//! core package's tests check that the WebAssembly build gives the same bytes.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use common::{draw, families, instance_value};
use serde_json::{Value, json};

/// FNV-1a 64 over the bytes of a string.
fn fnv(text: &str) -> u64
{
    text.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

fn fixtures() -> Vec<(String, Value, Value)>
{
    let family = |name: &str| {
        let family = families().into_iter().find(|f| f.name == name).expect("a family");
        let types = draw(&family);
        instance_value(&family, &types)
    };
    let mut all: Vec<(String, Value, Value)> = families().iter().map(|f| (f.name.to_string(), family(f.name), json!({}))).collect();
    all.push(("pallet-mix-search".to_string(), family("pallet-mix"), json!({ "support": 1, "iterations": 30, "seed": 3 })));
    all.push((
        "search-job".to_string(),
        json!({"bins":[{"dims":[1000,800,900]}],"items":[{"count":2,"dims":[482,165,323],"orientations":3},{"count":4,"dims":[267,201,257],"orientations":3},{"count":3,"dims":[585,468,308],"orientations":3}]}),
        json!({ "iterations": 200 }),
    ));
    all.push((
        "doors-x".to_string(),
        json!({
            "items": [
                { "dims": [600, 400, 400], "count": 3, "stop": 1, "weight": 20000, "orientations": 3 },
                { "dims": [400, 400, 400], "count": 4, "stop": 2, "weight": 15000, "maxLoad": 40000 },
                { "dims": [800, 300, 300], "count": 2, "stop": 3, "weight": 25000 }
            ],
            "bins": [{ "dims": [3600, 1200, 1000], "door": "-x", "maxWeight": 400000 }]
        }),
        json!({}),
    ));
    all.push((
        "doors-y-balance".to_string(),
        json!({
            "items": [
                { "dims": [500, 500, 500], "count": 6, "stop": 1, "weight": 30000 },
                { "dims": [700, 400, 300], "count": 5, "stop": 2, "weight": 12000, "orientations": 3 }
            ],
            "bins": [{ "dims": [2800, 2000, 1400], "door": "+y", "balance": { "cog": { "x": 0.1, "y": 0.1 }, "axles": [{ "at": 300, "maxLoad": 150000 }, { "at": 2500, "maxLoad": 150000 }] } }]
        }),
        json!({ "support": 0.9 }),
    ));
    all.push((
        "orientations-gap".to_string(),
        json!({
            "items": [
                { "dims": [300, 200, 700], "count": 6, "orientations": 63 },
                { "dims": [500, 500, 100], "count": 4, "orientations": 1 },
                { "dims": [250, 250, 250], "count": 10, "orientations": 3 }
            ],
            "bins": [{ "dims": [1200, 800, 1000] }]
        }),
        json!({ "support": 1, "gap": 5 }),
    ));
    all.push((
        "three-kinds".to_string(),
        json!({
            "items": [{ "dims": [400, 400, 400], "count": 10, "weight": 20000 }, { "dims": [900, 300, 300], "count": 3, "weight": 50000 }],
            "bins": [
                { "dims": [400, 400, 400], "cost": 3, "stock": 4 },
                { "dims": [1200, 800, 400], "cost": 8 },
                { "dims": [2400, 1200, 1200], "cost": 20, "maxWeight": 500000 }
            ]
        }),
        json!({}),
    ));
    all
}

fn main()
{
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    fs::create_dir_all(&dir).expect("the fixtures folder");
    let expected: BTreeMap<String, Value> = fixtures()
        .into_iter()
        .map(|(name, instance, config)| {
            let solution = pack3d_wasm::solve_json(&instance.to_string(), &config.to_string()).unwrap_or_else(|e| panic!("{name}: {e}"));
            let parsed: Value = serde_json::from_str(&solution).unwrap();
            let summary = json!({ "hash": format!("{:016x}", fnv(&solution)), "bins": parsed["bins"].as_array().map_or(0, |b| b.len()), "unplaced": parsed["unplaced"].as_array().map_or(0, |u| u.len()) });
            let file = serde_json::to_string_pretty(&json!({ "name": name, "instance": instance, "config": config })).unwrap();
            fs::write(dir.join(format!("{name}.json")), file + "\n").expect("a fixture file");
            println!("{name:<20} {}", summary);
            (name, summary)
        })
        .collect();
    fs::write(dir.join("expected.json"), serde_json::to_string_pretty(&expected).unwrap() + "\n").expect("expected.json");
}
