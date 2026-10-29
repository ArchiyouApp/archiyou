//! What a caller sees: instances in, plans out. Each rule has a test that it holds and a control
//! that shows the test can fail (the same instance with the rule relaxed).

use pack3d_wasm::{Config, Instance, Solution, solve, solve_json, validate};
use serde_json::json;

fn instance(value: serde_json::Value) -> Instance
{
    serde_json::from_value(value).expect("a valid instance")
}

fn solved(value: serde_json::Value, config: Config) -> Solution
{
    let instance = instance(value);
    let solution = solve(&instance, &config).expect("a solution");
    assert_eq!(validate(&instance, &config, &solution), Vec::<String>::new());
    solution
}

fn all_placements(solution: &Solution) -> Vec<(usize, u32, u8, [u32; 3])>
{
    solution.bins.iter().flat_map(|bin| bin.placements.iter().map(|p| (p.item, p.copy, p.orientation, [p.x, p.y, p.z]))).collect()
}

#[test]
fn eight_cubes_fill_a_cube_bin_completely()
{
    let solution = solved(json!({ "items": [{ "dims": [400, 400, 400], "count": 8, "orientations": 1 }], "bins": [{ "dims": [800, 800, 800] }] }), Config::default());
    assert_eq!(solution.bins.len(), 1);
    assert!(solution.unplaced.is_empty());
    assert_eq!(solution.bins[0].volume, 800 * 800 * 800);
}

#[test]
fn a_rod_that_only_fits_turned_is_turned_when_it_may_be_and_left_out_when_it_may_not()
{
    // 1000 x 200 x 200 into a bin 600 long and 1100 wide: it has to lie across
    let bin = json!([{ "dims": [600, 1100, 300] }]);
    let locked = solved(json!({ "items": [{ "dims": [1000, 200, 200], "orientations": 1 }], "bins": bin }), Config::default());
    assert_eq!((locked.bins.len(), locked.unplaced.len()), (0, 1), "locked as modelled, it fits nowhere");

    let upright = solved(json!({ "items": [{ "dims": [1000, 200, 200], "orientations": 3 }], "bins": bin }), Config::default());
    assert_eq!(all_placements(&upright), [(0, 0, 1, [0, 0, 0])], "upright may turn about z, which is orientation 1");
}

#[test]
fn an_item_too_tall_for_the_bin_lies_down_only_if_it_may_tip_over()
{
    // 100 x 100 x 900 into a bin 1000 x 1000 x 500
    let bin = json!([{ "dims": [1000, 1000, 500] }]);
    let upright = solved(json!({ "items": [{ "dims": [100, 100, 900], "orientations": 3 }], "bins": bin }), Config::default());
    assert_eq!(upright.unplaced.len(), 1, "upright keeps its 900 mm height");
    let free = solved(json!({ "items": [{ "dims": [100, 100, 900] }], "bins": bin }), Config::default());
    assert_eq!(free.unplaced.len(), 0, "free to tip over, it lies down");
    let (_, _, orientation, _) = all_placements(&free)[0];
    assert!(orientation == 2 || orientation == 3 || orientation == 4 || orientation == 5, "a tilted orientation, not {orientation}");
}

#[test]
fn stock_limits_the_bins_and_the_rest_is_reported()
{
    // three 400 cubes, one bin of 400 cubed in stock twice
    let two = solved(json!({ "items": [{ "dims": [400, 400, 400], "count": 3, "orientations": 1 }], "bins": [{ "dims": [400, 400, 400], "stock": 2 }] }), Config::default());
    assert_eq!((two.bins.len(), two.unplaced.len()), (2, 1));
    // the control: without a limit three bins are used
    let free = solved(json!({ "items": [{ "dims": [400, 400, 400], "count": 3, "orientations": 1 }], "bins": [{ "dims": [400, 400, 400] }] }), Config::default());
    assert_eq!((free.bins.len(), free.unplaced.len()), (3, 0));
}

#[test]
fn the_gap_costs_room()
{
    let value = json!({ "items": [{ "dims": [500, 500, 500], "count": 2, "orientations": 1 }], "bins": [{ "dims": [1000, 500, 500] }] });
    assert_eq!(solved(value.clone(), Config::default()).bins.len(), 1);
    assert_eq!(solved(value, Config { gap: 5, ..Config::default() }).bins.len(), 2);
}

#[test]
fn support_decides_what_may_hang_over_an_edge()
{
    // two bars across each other, 800 x 400 and 400 x 800, in a bin 800 x 800: they cannot lie side by side, and
    // whichever way round they are stacked, half of the upper one's base rests on the lower one
    let value = json!({ "items": [{ "dims": [800, 400, 100], "orientations": 1 }, { "dims": [400, 800, 100], "orientations": 1 }], "bins": [{ "dims": [800, 800, 1000] }] });
    let strict = solved(value.clone(), Config { support: 0.8, ..Config::default() });
    assert_eq!(strict.bins.len(), 2, "50 % of the base is not 80 %: the second bar gets a bin of its own");
    let loose = solved(value, Config { support: 0.5, ..Config::default() });
    assert_eq!(loose.bins.len(), 1, "the control: with 50 % asked, they are stacked");
}

#[test]
fn a_cheaper_kind_is_preferred_and_a_bigger_one_taken_when_needed()
{
    let value = json!({
        "items": [{ "dims": [300, 300, 300], "count": 2, "orientations": 1 }, { "dims": [900, 300, 300], "orientations": 1 }],
        "bins": [{ "dims": [1000, 1000, 1000], "cost": 5 }, { "dims": [400, 400, 400], "cost": 1 }]
    });
    let solution = solved(value, Config::default());
    // the long item (largest) goes first and needs the big bin; the two cubes then fit into it too, so one bin in all
    assert_eq!(solution.bins.iter().map(|b| b.bin).collect::<Vec<_>>(), [0]);
    assert_eq!(solution.stats.cost, 5.0);
}

#[test]
fn the_same_input_gives_the_same_bytes()
{
    let value = json!({
        "items": [
            { "dims": [400, 300, 250], "count": 12 }, { "dims": [600, 400, 200], "count": 7, "orientations": 3 },
            { "dims": [250, 250, 250], "count": 20 }, { "dims": [1100, 150, 90], "count": 4 }
        ],
        "bins": [{ "dims": [1200, 800, 1500], "cost": 3 }, { "dims": [800, 600, 1000], "cost": 2 }]
    })
    .to_string();
    let first = solve_json(&value, r#"{ "support": 0.9 }"#).expect("solved");
    let second = solve_json(&value, r#"{ "support": 0.9 }"#).expect("solved");
    assert_eq!(first, second);
}

#[test]
fn the_layout_for_a_fixed_instance_never_changes()
{
    // pinned: a change here is a change of behaviour and has to be a decision
    let solution = solved(
        json!({
            "items": [{ "dims": [500, 400, 300], "count": 3 }, { "dims": [300, 300, 300], "count": 4, "orientations": 3 }, { "dims": [700, 200, 100], "count": 2 }],
            "bins": [{ "dims": [1000, 800, 700] }]
        }),
        Config::default(),
    );
    let text: Vec<String> = solution.bins.iter().enumerate().flat_map(|(b, bin)| bin.placements.iter().map(move |p| format!("{b}:{},{},{}#{}.{}o{}", p.x, p.y, p.z, p.item, p.copy, p.orientation))).collect();
    assert_eq!(text.join(" "), GOLDEN_LAYOUT);
}

const GOLDEN_LAYOUT: &str = "0:0,0,0#0.0o0 0:0,400,0#0.1o0 0:500,0,0#0.2o0 0:500,400,0#1.0o0 0:0,0,300#1.1o0 0:0,300,300#1.2o0 0:300,0,300#1.3o0 0:0,600,300#2.0o0 0:300,300,300#2.1o0";

#[test]
fn json_out_uses_camel_case_and_json_in_rejects_typos()
{
    let out = solve_json(r#"{ "items": [{ "dims": [10, 10, 10] }], "bins": [{ "dims": [20, 20, 20] }] }"#, "").expect("solved");
    let value: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert!(value["bins"][0]["placements"][0].get("orientation").is_some());
    assert!(value["stats"].get("evaluations").is_some());
    assert!(value["unplaced"].is_array());

    let typo = solve_json(r#"{ "items": [{ "dims": [10, 10, 10], "cuont": 3 }], "bins": [{ "dims": [20, 20, 20] }] }"#, "");
    assert!(typo.unwrap_err().contains("cuont"));
    let bad_config = solve_json(r#"{ "items": [], "bins": [{ "dims": [20, 20, 20] }] }"#, r#"{ "support": 2 }"#);
    assert!(bad_config.unwrap_err().contains("support"));
}

#[test]
fn nothing_to_load_is_an_empty_plan()
{
    let solution = solved(json!({ "items": [], "bins": [{ "dims": [20, 20, 20] }] }), Config::default());
    assert_eq!((solution.bins.len(), solution.unplaced.len(), solution.stats.cost), (0, 0, 0.0));
}
