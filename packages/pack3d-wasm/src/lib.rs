//! pack3d: stable 3D load planning, for boxes in pallets, crates and trailers.
//!
//! Every plan it returns is deterministic (the same instance, config and seed give the same bytes
//! on every machine), uses integer arithmetic for every rule, and has been re-checked by an
//! independent validator before it leaves `solve`. See the README for the rules.

pub mod balance;
pub mod geom;
pub mod layout;
pub mod model;
pub mod rng;
pub mod search;
pub mod solve;
pub mod validate;

use wasm_bindgen::prelude::*;

pub use model::{BinLoad, BinType, Config, Error, Instance, ItemRef, ItemType, Placement, Solution, Stats};
pub use solve::solve;
pub use validate::validate;

/// The JSON entry point: an instance and a config (empty for the defaults) in, a solution out.
pub fn solve_json(instance_json: &str, config_json: &str) -> Result<String, String>
{
    let instance: Instance = serde_json::from_str(instance_json).map_err(|e| format!("instance: {e}"))?;
    let config = parse_config(config_json)?;
    let solution = solve(&instance, &config).map_err(|e| e.to_string())?;
    serde_json::to_string(&solution).map_err(|e| e.to_string())
}

fn parse_config(config_json: &str) -> Result<Config, String>
{
    if config_json.trim().is_empty() { Ok(Config::default()) } else { serde_json::from_str(config_json).map_err(|e| format!("config: {e}")) }
}

/// For JavaScript: an instance and a config as JSON in, a solution as JSON out; an error is thrown as a string.
#[wasm_bindgen(js_name = solve)]
pub fn solve_wasm(instance_json: &str, config_json: &str) -> Result<String, JsValue>
{
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
    solve_json(instance_json, config_json).map_err(|message| JsValue::from_str(&message))
}

/// For JavaScript: the rules that a solution breaks for an instance and a config, as a JSON array of
/// sentences; `[]` when it breaks none.
#[wasm_bindgen(js_name = validate)]
pub fn validate_wasm(instance_json: &str, config_json: &str, solution_json: &str) -> Result<String, JsValue>
{
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
    let run = || -> Result<String, String> {
        let instance: Instance = serde_json::from_str(instance_json).map_err(|e| format!("instance: {e}"))?;
        let solution: Solution = serde_json::from_str(solution_json).map_err(|e| format!("solution: {e}"))?;
        serde_json::to_string(&validate(&instance, &parse_config(config_json)?, &solution)).map_err(|e| e.to_string())
    };
    run().map_err(|message| JsValue::from_str(&message))
}
