//! gdrr2bp-wasm
//!
//! WebAssembly wrapper around JeroenGar/gdrr-2bp — a goal-driven ruin & recreate
//! heuristic for the 2D guillotine bin-packing / nesting problem.
//!
//! Upstream is a multi-threaded CLI binary. For wasm we keep the algorithm and
//! IO modules verbatim (apart from small portability patches) and replace the
//! threaded driver + file IO with a single in-process `solve()` that takes the
//! instance and config as JSON strings and returns the solution JSON string.
//!
//! Patches applied to the vendored source (all marked `// wasm port:`):
//!   - `std::time::Instant` -> `web_time::Instant` (panics on wasm otherwise)
//!   - `mimalloc` global allocator and `ctrlc` handler removed (no wasm support)
//!   - the per-thread monitor is bypassed; `lahc` enforces `maxRunTime` itself
//!   - logging macros route to `console.log` instead of stdout

use std::cmp::Ordering;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::channel;

use once_cell::sync::Lazy;
use wasm_bindgen::prelude::*;
use web_time::Instant;

use crate::core::cost::Cost;
use crate::io::json_format::JsonInstance;
use crate::io::parser;
use crate::optimization::config::Config;
use crate::optimization::gdrr::GDRR;
use crate::optimization::sol_collectors::local_sol_collector::LocalSolCollector;
use crate::optimization::solutions::sendable_solution::SendableSolution;
use crate::optimization::solutions::solution::Solution;
use crate::util::messages::{SolutionReportMessage, SyncMessage};

pub mod util;
pub mod io;
pub mod optimization;
pub mod core;

pub static EPOCH: Lazy<Instant> = Lazy::new(Instant::now);

pub const COST_COMPARATOR: fn(&Cost, &Cost) -> Ordering = |a: &Cost, b: &Cost| {
    match a.part_area_excluded.cmp(&b.part_area_excluded) {
        Ordering::Equal => a.leftover_value.partial_cmp(&b.leftover_value).unwrap().reverse(),
        other => other,
    }
};

/// Fixes the RNG seed when true (reproducible runs). Kept false to match upstream.
pub const DETERMINISTIC_MODE: bool = false;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

/// Progress/diagnostic sink used by the `timed_println!` / `timed_thread_println!`
/// macros. Prefixes an `[hh:mm:ss]` timestamp relative to [`EPOCH`].
pub fn log_line(msg: String) {
    let secs = EPOCH.elapsed().as_secs();
    let line = format!("[{:02}:{:02}:{:02}] {}", secs / 3600, (secs / 60) % 60, secs % 60, msg);
    #[cfg(target_arch = "wasm32")]
    log(&line);
    #[cfg(not(target_arch = "wasm32"))]
    println!("{}", line);
}

/// Solve a 2D bin-packing instance.
///
/// * `input_json`  — instance in the OR-Datasets format (see `JsonInstance`).
/// * `config_json` — algorithm configuration (see `Config`). `nThreads` is
///   ignored: the wasm build always runs single-threaded. Bound the run with
///   `maxRunTime` (seconds) and/or `maxRRIterations`.
///
/// Returns the solution as a JSON string (`JsonSolution`), or rejects with an
/// error message if the input is invalid or no solution could be produced.
#[wasm_bindgen]
pub fn solve(input_json: &str, config_json: &str) -> Result<String, JsValue> {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    let mut json_instance: JsonInstance = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("invalid input JSON: {e}")))?;
    let config: Config = serde_json::from_str(config_json)
        .map_err(|e| JsValue::from_str(&format!("invalid config JSON: {e}")))?;

    let instance = Arc::new(parser::generate_instance(&mut json_instance, &config));

    // Single-threaded driver: one GDRR worker. The sync/report channels exist
    // only so the unmodified LocalSolCollector keeps working; the worker's best
    // solutions are recovered by draining the report channel afterwards.
    let (_tx_sync, rx_sync) = channel::<SyncMessage>();
    let (tx_report, rx_report) = channel::<SolutionReportMessage>();

    {
        let local = LocalSolCollector::new(instance.clone(), rx_sync, tx_report, COST_COMPARATOR);
        let mut gdrr = GDRR::new(&instance, &config, local);
        gdrr.lahc();
    } // gdrr (and the report Sender it owns) dropped here, closing the channel

    let mut best_complete: Option<SendableSolution> = None;
    let mut best_incomplete: Option<SendableSolution> = None;
    while let Ok(msg) = rx_report.try_recv() {
        match msg {
            SolutionReportMessage::NewCompleteSolution(_, sol) => {
                let better = best_complete
                    .as_ref()
                    .map_or(true, |b| sol.cost().material_cost < b.cost().material_cost);
                if better {
                    best_complete = Some(sol);
                }
            }
            SolutionReportMessage::NewIncompleteSolution(_, sol) => {
                let better = best_incomplete
                    .as_ref()
                    .map_or(true, |b| (COST_COMPARATOR)(&sol.cost(), &b.cost()) == Ordering::Less);
                if better {
                    best_incomplete = Some(sol);
                }
            }
            // Stats-only reports carry no full layout, nothing to reconstruct.
            SolutionReportMessage::NewIncompleteStats(_, _) => {}
        }
    }

    match best_complete.as_ref().or(best_incomplete.as_ref()) {
        Some(sol) => {
            let json_solution =
                parser::generate_json_solution(&json_instance, sol, &PathBuf::from("wasm"));
            serde_json::to_string(&json_solution)
                .map_err(|e| JsValue::from_str(&format!("failed to serialize solution: {e}")))
        }
        None => Err(JsValue::from_str(
            "no solution found — try increasing maxRunTime or maxRRIterations",
        )),
    }
}
