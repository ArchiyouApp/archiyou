// Native smoke test for the solver. `solve()` is platform-agnostic apart from
// the wasm-only console binding, so we can exercise it on the host target.

use serde_json::Value;

#[test]
fn solves_small_example() {
    let input = include_str!("../examples/small_example_input.json");
    // Tiny time budget so the test stays fast; nThreads is ignored on this build.
    let config = r#"{
        "maxRunTime": 2,
        "nThreads": 1,
        "rotationAllowed": true,
        "avgNodesRemoved": 6,
        "blinkRate": 0.01,
        "leftoverValuationPower": 2,
        "historyLength": 500,
        "sheetValuationMode": "area"
    }"#;

    let out = gdrr2bp_wasm::solve(input, config).expect("solve returned an error");
    let sol: Value = serde_json::from_str(&out).expect("output is not valid JSON");

    assert!(sol.get("CuttingPatterns").is_some(), "missing CuttingPatterns");
    assert!(sol.get("Statistics").is_some(), "missing Statistics");
    let patterns = sol["CuttingPatterns"].as_array().unwrap();
    assert!(!patterns.is_empty(), "expected at least one cutting pattern");
    println!("usage_pct = {}", sol["Statistics"]["UsagePct"]);
}
