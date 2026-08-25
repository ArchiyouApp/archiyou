// Regression test for spade CDT "Conflicting edge encountered" panic.
//
// The slider cabinet script produces mesh faces whose 2D projections can
// contain T-intersections (a vertex lying on a non-adjacent edge) after the
// chain of box-on-box and cylinder subtractions. spade's bulk_load_cdt panics
// on these; with panic="abort" in WASM the instance terminates and the run
// surfaces as a status:'error'. Fix: polygon.rs detects T-intersections
// before calling bulk_load_cdt and returns Vec::new() for those faces.
//
// The failure is non-deterministic (~1 in 4) due to hash-map randomisation in
// csgrs; run 30 iterations to reliably catch regressions.

import fs from 'node:fs';

import { describe, it, expect, beforeAll } from 'vitest';

import type { RunnerScriptExecutionRequest } from '../../src/runner/types';
import { Runner } from '../../src/runner/Runner';

describe('slidercabinet – spade CDT T-intersection panic regression', () => {
    let runner: Runner;

    beforeAll(async () => {
        runner = await new Runner().load();
    });

    it(
        'runs the slider cabinet + layflat script 30 times without panicking',
        async () => {
            const code = fs.readFileSync('./tests/cadscripts/scripts/slidercabinet.js', 'utf8');
            const script = { name: 'slidercabinet', code, params: {} };

            const RUNS = 30;
            for (let run = 0; run < RUNS; run++) {
                const request: RunnerScriptExecutionRequest = {
                    kernel: 'mesh',
                    script,
                    outputs: ['default/model/gltf'],
                };

                const result = await runner.execute(request);

                expect(
                    result.status,
                    `run ${run + 1}/${RUNS} failed – errors: ${JSON.stringify(result.errors ?? [])}`
                ).toBe('success');
            }
        },
        600_000  // 10-minute ceiling for 30 iterations
    );
});
