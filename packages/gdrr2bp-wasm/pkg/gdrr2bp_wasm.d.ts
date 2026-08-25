/* tslint:disable */
/* eslint-disable */

/**
 * Solve a 2D bin-packing instance.
 *
 * * `input_json`  — instance in the OR-Datasets format (see `JsonInstance`).
 * * `config_json` — algorithm configuration (see `Config`). `nThreads` is
 *   ignored: the wasm build always runs single-threaded. Bound the run with
 *   `maxRunTime` (seconds) and/or `maxRRIterations`.
 *
 * Returns the solution as a JSON string (`JsonSolution`), or rejects with an
 * error message if the input is invalid or no solution could be produced.
 */
export function solve(input_json: string, config_json: string): string;
