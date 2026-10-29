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

/// Where the items of a plan are, by item and copy.
fn position_of(solution: &Solution, item: usize, copy: u32) -> [u32; 3]
{
    all_placements(solution).into_iter().find(|p| p.0 == item && p.1 == copy).expect("the item is placed").3
}

#[test]
fn a_bin_takes_no_more_than_its_weight_limit()
{
    let value = |max: serde_json::Value| json!({ "items": [{ "dims": [300, 300, 300], "count": 3, "weight": 40000, "orientations": 1 }], "bins": [{ "dims": [1000, 1000, 1000], "maxWeight": max }] });
    assert_eq!(solved(value(json!(100000)), Config::default()).bins.len(), 2, "two 40 kg boxes make 80 kg, three 120 kg");
    assert_eq!(solved(value(json!(null)), Config::default()).bins.len(), 1, "the control: without a limit they share a bin");
}

#[test]
fn an_item_that_carries_nothing_ends_up_on_top()
{
    // one fragile box and two sturdy ones in a bin that takes a column of three
    let value = |fragile_limit: serde_json::Value| {
        json!({
            "items": [
                { "dims": [400, 400, 400], "weight": 5000, "maxLoad": fragile_limit, "orientations": 1 },
                { "dims": [400, 400, 400], "weight": 10000, "count": 2, "orientations": 1 }
            ],
            "bins": [{ "dims": [400, 400, 1200] }]
        })
    };
    let solution = solved(value(json!(0)), Config::default());
    assert_eq!(solution.bins.len(), 1);
    assert_eq!(position_of(&solution, 0, 0)[2], 800, "the fragile box is the top of the column");
    // the control: when every box is fragile nothing can be stacked, so each gets a bin
    let all_fragile = json!({ "items": [{ "dims": [400, 400, 400], "weight": 5000, "maxLoad": 0, "count": 3, "orientations": 1 }], "bins": [{ "dims": [400, 400, 1200] }] });
    assert_eq!(solved(all_fragile, Config::default()).bins.len(), 3);
}

#[test]
fn a_stack_limit_in_grams_caps_how_high_a_column_goes()
{
    // 10 kg boxes that may carry 25 kg: a column of three (the bottom box carries 20 kg), not four (30 kg)
    let value = |limit: serde_json::Value| json!({ "items": [{ "dims": [400, 400, 400], "weight": 10000, "maxLoad": limit, "count": 4, "orientations": 1 }], "bins": [{ "dims": [400, 400, 1600] }] });
    assert_eq!(solved(value(json!(25000)), Config::default()).bins.iter().map(|b| b.placements.len()).collect::<Vec<_>>(), [3, 1]);
    assert_eq!(solved(value(json!(30000)), Config::default()).bins.len(), 1, "the control: 30 kg is enough for all four");
}

#[test]
fn the_last_stop_is_loaded_first_and_ends_up_deepest()
{
    // three cubes along a trailer that opens at +x; item 0 is unloaded first, item 2 last
    let value = |door: serde_json::Value, stops: [u32; 3]| {
        json!({
            "items": [
                { "dims": [400, 400, 400], "stop": stops[0], "orientations": 1 }, { "dims": [400, 400, 400], "stop": stops[1], "orientations": 1 }, { "dims": [400, 400, 400], "stop": stops[2], "orientations": 1 }
            ],
            "bins": [{ "dims": [1200, 400, 400], "door": door }]
        })
    };
    let at_x = |solution: &Solution| [0, 1, 2].map(|item| position_of(solution, item, 0)[0]);
    assert_eq!(at_x(&solved(value(json!("+x"), [1, 2, 3]), Config::default())), [800, 400, 0], "the first stop is next to the door");
    assert_eq!(at_x(&solved(value(json!("-x"), [1, 2, 3]), Config::default())), [0, 400, 800], "with the door at -x it is the other way round");
    assert_eq!(at_x(&solved(value(json!("+x"), [0, 0, 0]), Config::default())), [0, 400, 800], "the control: without stops the order is the order of the list");
}

#[test]
fn items_for_the_earlier_stop_never_sit_under_the_later_ones()
{
    // a pallet that is only unloaded from the top: the stop 2 boxes go first, the stop 1 boxes on top of them
    let value = json!({
        "items": [{ "dims": [400, 400, 400], "stop": 1, "count": 2, "orientations": 1 }, { "dims": [400, 400, 400], "stop": 2, "count": 2, "orientations": 1 }],
        "bins": [{ "dims": [400, 400, 1600] }]
    });
    let solution = solved(value, Config::default());
    let height = |item: usize, copy: u32| position_of(&solution, item, copy)[2];
    assert!(height(1, 0) < height(0, 0) && height(1, 1) < height(0, 0), "both stop 2 boxes are under both stop 1 boxes");
}

#[test]
fn the_load_is_moved_along_the_bin_to_meet_the_balance()
{
    // three 1 t boxes along a 10 m trailer, the centre of gravity within 10 % of the middle
    let value = |balance: serde_json::Value| {
        json!({
            "items": [{ "dims": [1000, 1000, 1000], "weight": 1000000, "count": 3, "orientations": 1 }],
            "bins": [{ "dims": [10000, 2000, 2500], "door": "+x", "balance": balance }]
        })
    };
    let balanced = solved(value(json!({ "cog": { "x": 0.1 } })), Config::default());
    let bin = &balanced.bins[0];
    assert!(bin.balance_ok);
    let cog = bin.cog.expect("a load with weight has a centre of gravity");
    assert!((4000.0..=6000.0).contains(&cog[0]), "the centre of gravity is {} mm from the front", cog[0]);
    // the control: asking for nothing leaves the load where it was built, against the far wall
    let plain = solved(value(json!(null)), Config::default());
    assert_eq!(plain.bins[0].placements.iter().map(|p| p.x).min(), Some(0));
    assert!(balanced.bins[0].placements.iter().map(|p| p.x).min() > Some(0));
}

#[test]
fn what_the_supports_carry_is_kept_within_their_limits_by_moving_the_load()
{
    // 3 t on a trailer with supports at 1 m and 9 m that carry 2.5 t each: the centre of gravity has to be within 2.5 .. 7.5 m
    let value = json!({
        "items": [{ "dims": [1000, 1000, 1000], "weight": 1000000, "count": 3, "orientations": 1 }],
        "bins": [{ "dims": [10000, 2000, 2500], "balance": { "axles": [{ "at": 1000, "maxLoad": 2500000 }, { "at": 9000, "maxLoad": 2500000 }] } }]
    });
    let solution = solved(value, Config::default());
    let bin = &solution.bins[0];
    assert!(bin.balance_ok);
    assert!(bin.axle_loads.iter().all(|&load| load <= 2_500_000), "{:?}", bin.axle_loads);
    assert_eq!(bin.axle_loads.iter().sum::<u64>(), 3_000_000, "the supports carry the whole load");
}

#[test]
fn a_balance_that_one_bin_cannot_meet_is_met_by_using_two()
{
    // 8 t and 1 t boxes of 800 mm in a 2 m bin with a centre of gravity within 5 % of the middle: together they fill 1.6 m of the
    // length and cannot be moved enough, one at a time they can
    let value = |balance: serde_json::Value| {
        json!({
            "items": [{ "dims": [800, 1000, 1000], "weight": 8000000, "orientations": 1 }, { "dims": [800, 1000, 1000], "weight": 1000000, "orientations": 1 }],
            "bins": [{ "dims": [2000, 1000, 1000], "balance": balance }]
        })
    };
    let strict = solved(value(json!({ "cog": { "x": 0.05 } })), Config::default());
    assert_eq!(strict.bins.len(), 2, "one bin each");
    assert!(strict.bins.iter().all(|bin| bin.balance_ok));
    // the control: without the balance they share a bin
    assert_eq!(solved(value(json!(null)), Config::default()).bins.len(), 1);
}

#[test]
fn a_balance_that_cannot_be_met_at_all_is_reported_and_the_plan_is_still_returned()
{
    // a single 9 t box that is as long as the bin cannot be moved; the supports cannot take it
    let value = json!({
        "items": [{ "dims": [2000, 1000, 1000], "weight": 9000000, "orientations": 1 }],
        "bins": [{ "dims": [2000, 1000, 1000], "balance": { "axles": [{ "at": 0, "maxLoad": 1000000 }, { "at": 2000, "maxLoad": 1000000 }] } }]
    });
    let solution = solved(value, Config::default());
    assert_eq!((solution.bins.len(), solution.unplaced.len()), (1, 0), "the box is loaded");
    assert!(!solution.bins[0].balance_ok, "and the plan says that the supports are overloaded: {:?}", solution.bins[0].axle_loads);
    assert_eq!(solution.bins[0].axle_loads, [4_500_000, 4_500_000]);
}

#[test]
fn bins_are_opened_by_cost_per_volume_and_the_last_one_is_made_cheaper()
{
    // ten 400 cubes; the big bin (six at a time, 8) is cheaper per cube than the small one (one at a time, 3)
    let value = json!({
        "items": [{ "dims": [400, 400, 400], "count": 10, "orientations": 1 }],
        "bins": [{ "dims": [400, 400, 400], "cost": 3 }, { "dims": [1200, 800, 400], "cost": 8 }]
    });
    let solution = solved(value, Config::default());
    assert_eq!(solution.bins.iter().map(|b| (b.bin, b.placements.len())).collect::<Vec<_>>(), [(1, 6), (1, 4)], "six and four in the big bin");
    assert_eq!(solution.stats.cost, 16.0, "2 x 8, against 30 for ten small bins");
    // and four cubes alone are cheaper in four small bins than in a big one only if 4 x 3 < 8: not here, so the last bin stays big
    let few = solved(json!({ "items": [{ "dims": [400, 400, 400], "count": 2, "orientations": 1 }], "bins": [{ "dims": [400, 400, 400], "cost": 3 }, { "dims": [1200, 800, 400], "cost": 8 }] }), Config::default());
    assert_eq!(few.stats.cost, 6.0, "two cubes: two small bins (6) rather than one big (8)");
}
