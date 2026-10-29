//! The committed fixtures still give the solutions they were made with. The same files and hashes are
//! what the core package's tests compare the WebAssembly build with, so native and WebAssembly are
//! held to the same bytes.

use std::fs;
use std::path::Path;

use pack3d_wasm::solve_json;
use serde_json::Value;

/// FNV-1a 64 over the bytes of a string.
fn fnv(text: &str) -> u64
{
    text.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

#[test]
fn every_fixture_gives_the_solution_it_was_committed_with()
{
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let expected: Value = serde_json::from_str(&fs::read_to_string(dir.join("expected.json")).expect("expected.json: run `cargo run --release --example fixtures`")).unwrap();
    let names: Vec<&String> = expected.as_object().unwrap().keys().collect();
    assert!(names.len() >= 12, "{} fixtures", names.len());
    names.iter().for_each(|name| {
        let fixture: Value = serde_json::from_str(&fs::read_to_string(dir.join(format!("{name}.json"))).unwrap()).unwrap();
        let solution = solve_json(&fixture["instance"].to_string(), &fixture["config"].to_string()).unwrap();
        assert_eq!(
            format!("{:016x}", fnv(&solution)),
            expected[name.as_str()]["hash"].as_str().unwrap(),
            "{name}: the solution changed; if that is intended, run `cargo run --release --example fixtures` and commit the new files"
        );
    });
}
