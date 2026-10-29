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

pub use model::{BinLoad, BinType, Config, Error, Instance, ItemRef, ItemType, Placement, Solution, Stats};
pub use solve::solve;
pub use validate::validate;

/// The JSON entry point: an instance and a config (empty for the defaults) in, a solution out.
pub fn solve_json(instance_json: &str, config_json: &str) -> Result<String, String>
{
    let instance: Instance = serde_json::from_str(instance_json).map_err(|e| format!("instance: {e}"))?;
    let config: Config = if config_json.trim().is_empty() { Config::default() } else { serde_json::from_str(config_json).map_err(|e| format!("config: {e}"))? };
    let solution = solve(&instance, &config).map_err(|e| e.to_string())?;
    serde_json::to_string(&solution).map_err(|e| e.to_string())
}
