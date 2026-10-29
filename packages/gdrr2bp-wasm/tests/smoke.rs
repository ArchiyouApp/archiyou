// Native smoke test for the solver. `solve()` is platform-agnostic apart from
// the wasm-only console binding, so we can exercise it on the host target.

use std::collections::BTreeSet;

use serde_json::{Value, json};

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

// ───────────────── reproducibility and the Archiyou options ─────────────────
//
// These runs are bounded by iterations and never by a clock, so a run is a pure function of
// (instance, config, seed), which is what the tests below check.

/// Config with an iteration budget and a seed; `extra` adds or overrides options.
fn config(iterations: usize, seed: u64, extra: Value) -> String
{
    let mut config = json!({
        "maxRRIterations": iterations,
        "seed": seed,
        "nThreads": 1,
        "rotationAllowed": true,
        "avgNodesRemoved": 5,
        "blinkRate": 0.01,
        "leftoverValuationPower": 2,
        "historyLength": 500,
        "sheetValuationMode": "area",
    });
    config.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    config.to_string()
}

fn sheet(length: u64, height: u64) -> Value
{
    json!({ "Length": length, "Height": height, "Stock": null, "Cost": 1 })
}

fn part(length: u64, height: u64, demand: usize) -> Value
{
    json!({ "Length": length, "Height": height, "Demand": demand, "Value": 1 })
}

fn solve_with(sheets: &[Value], parts: &[Value], config: &str) -> Value
{
    let instance = json!({ "Name": "test", "Objects": sheets, "Items": parts }).to_string();
    let out = gdrr2bp_wasm::solve(&instance, config).expect("solve returned an error");
    serde_json::from_str(&out).expect("output is not valid JSON")
}

/// One placed part: (sheet in output order, x, y, length, height, part index).
type Placed = (usize, u64, u64, u64, u64, u64);

fn collect(node: &Value, x: u64, y: u64, sheet: usize, out: &mut Vec<Placed>)
{
    let length = node["Length"].as_u64().unwrap();
    let height = node["Height"].as_u64().unwrap();
    match node["Type"].as_str().unwrap()
    {
        "Item" => out.push((sheet, x, y, length, height, node["Item"].as_u64().unwrap())),
        "Structure" =>
        {
            // a V node lays its children side by side along x, an H node stacks them along y
            let vertical = node["Orientation"].as_str() == Some("V");
            node["Children"].as_array().unwrap().iter().fold((x, y), |(cx, cy), child| {
                collect(child, cx, cy, sheet, out);
                if vertical
                {
                    (cx + child["Length"].as_u64().unwrap(), cy)
                }
                else
                {
                    (cx, cy + child["Height"].as_u64().unwrap())
                }
            });
        }
        _ => {}
    }
}

fn placements(solution: &Value) -> Vec<Placed>
{
    let mut out = Vec::new();
    solution["CuttingPatterns"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .for_each(|(sheet, pattern)| collect(&pattern["Root"], 0, 0, sheet, &mut out));
    out
}

/// The layout as one line. packages/core/tests/unit/make/pack.test.ts asserts the same text
/// through the WASM build, which is what keeps native and wasm in step.
fn layout(solution: &Value) -> String
{
    placements(solution)
        .iter()
        .map(|(s, x, y, l, h, p)| format!("{s}:{x},{y},{l}x{h}#{p}"))
        .collect::<Vec<String>>()
        .join(" ")
}

fn cut_depth(node: &Value) -> usize
{
    match node["Type"].as_str().unwrap()
    {
        "Structure" => 1 + node["Children"].as_array().unwrap().iter().map(cut_depth).max().unwrap_or(0),
        _ => 0,
    }
}

fn golden_parts() -> Vec<Value>
{
    vec![part(400, 300, 2), part(300, 200, 3), part(250, 250, 2), part(600, 100, 2), part(150, 450, 2), part(350, 150, 2)]
}

#[test]
fn the_same_seed_gives_the_same_layout()
{
    let sheets = [sheet(1000, 500)];
    let parts = golden_parts();
    let run = |seed: u64| layout(&solve_with(&sheets, &parts, &config(300, seed, json!({})))) ;
    assert_eq!(run(7), run(7));
    assert_eq!(run(0), run(0));
}

#[test]
fn without_a_seed_the_default_seed_is_used()
{
    let sheets = [sheet(1000, 500)];
    let parts = golden_parts();
    let mut unseeded = serde_json::from_str::<Value>(&config(300, 0, json!({}))).unwrap();
    unseeded.as_object_mut().unwrap().remove("seed");
    let unseeded = unseeded.to_string();
    let default_seed = gdrr2bp_wasm::DEFAULT_SEED;

    assert_eq!(
        layout(&solve_with(&sheets, &parts, &unseeded)),
        layout(&solve_with(&sheets, &parts, &config(300, default_seed, json!({})))),
    );
    // and it is stable from one call to the next, unlike the OS-seeded runs this replaced
    assert_eq!(layout(&solve_with(&sheets, &parts, &unseeded)), layout(&solve_with(&sheets, &parts, &unseeded)));
}

#[test]
fn another_seed_explores_another_layout()
{
    let sheets = [sheet(1000, 500)];
    let parts = golden_parts();
    let layouts: BTreeSet<String> = (0..12u64)
        .map(|seed| layout(&solve_with(&sheets, &parts, &config(300, seed, json!({})))))
        .collect();
    assert!(layouts.len() > 1, "twelve seeds all gave the same layout");
}

/// Sheet 0 then sheet 1, each part as `sheet:x,y,LxH#part`; a 300x200 part (#1) comes out turned.
const GOLDEN_LAYOUT: &str = "0:0,0,600x100#3 0:0,100,600x100#3 0:0,200,400x300#0 0:400,200,200x300#1 0:600,0,350x150#5 0:600,150,200x300#1 0:800,150,200x300#1 1:0,0,250x250#2 1:0,250,250x250#2 1:250,0,150x450#4 1:400,0,150x450#4 1:550,0,400x300#0 1:550,300,350x150#5";

#[test]
fn the_layout_for_a_fixed_instance_and_seed_never_changes()
{
    let found = layout(&solve_with(&[sheet(1000, 500)], &golden_parts(), &config(300, 1, json!({}))));
    assert_eq!(found, GOLDEN_LAYOUT);
}

#[test]
fn a_locked_part_is_never_turned()
{
    // 500x200 is the locked one; 200x500 and 300x300 are free
    let sheets = [sheet(1200, 600)];
    let locked = [
        json!({ "Length": 500, "Height": 200, "Demand": 6, "Value": 1, "CanRotate": false }),
        part(200, 500, 6),
        part(300, 300, 4),
    ];
    let free = [part(500, 200, 6), part(200, 500, 6), part(300, 300, 4)];

    // how often part 0 comes out as 200x500, i.e. turned
    let turned = |parts: &[Value], seed: u64| {
        placements(&solve_with(&sheets, parts, &config(200, seed, json!({}))))
            .iter()
            .filter(|(_, _, _, l, h, p)| *p == 0 && (*l, *h) == (200, 500))
            .count()
    };

    // the control: left free, the part does get turned on some seed, so this test can fail
    assert!((0..10).any(|seed| turned(&free, seed) > 0), "the control never turned the part");
    assert!((0..10).all(|seed| turned(&locked, seed) == 0), "a locked part was turned");
}

#[test]
fn the_first_cut_can_be_fixed_per_sheet()
{
    let roots = |first_cut: Option<&str>| -> BTreeSet<String> {
        (0..10u64)
            .flat_map(|seed| {
                let mut s = sheet(1000, 500);
                if let Some(direction) = first_cut
                {
                    s["FirstCut"] = json!(direction);
                }
                let solution = solve_with(&[s], &golden_parts(), &config(200, seed, json!({})));
                solution["CuttingPatterns"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(|pattern| pattern["Root"]["Orientation"].as_str().map(String::from))
                    .collect::<Vec<String>>()
            })
            .collect()
    };

    let both = BTreeSet::from(["H".to_string(), "V".to_string()]);
    assert_eq!(roots(None), both, "the control should start with either direction");
    assert_eq!(roots(Some("V")), BTreeSet::from(["V".to_string()]));
    assert_eq!(roots(Some("H")), BTreeSet::from(["H".to_string()]));
}

#[test]
fn max_stages_limits_the_cut_depth()
{
    let parts = [
        part(130, 210, 3),
        part(270, 90, 3),
        part(310, 160, 2),
        part(180, 340, 2),
        part(420, 120, 2),
        part(90, 90, 5),
        part(230, 230, 2),
        part(360, 260, 1),
    ];
    let deepest = |extra: Value| -> usize {
        (0..6u64)
            .flat_map(|seed| {
                let solution = solve_with(&[sheet(1000, 1000)], &parts, &config(300, seed, extra.clone()));
                solution["CuttingPatterns"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|pattern| cut_depth(&pattern["Root"]))
                    .collect::<Vec<usize>>()
            })
            .max()
            .unwrap()
    };

    assert!(deepest(json!({})) >= 3, "the control should need three stages or more");
    assert!(deepest(json!({ "maxStages": 2 })) <= 2, "two stages must stay two levels deep");
}
