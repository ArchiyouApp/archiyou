/**
 * tests/unit/execution.worker.test.ts — the two things that silently broke
 * server-side execution end to end. Both were found by actually running the worker,
 * not by reading the code, and neither produced an error message that pointed at the
 * cause — hence these.
 */
import { describe, it, expect } from 'vitest';

import { validateGlb, toBytes } from '../../src/execution/ExecutionWorker';
import { isRunnerScriptExecutionRequest } from '@archiyou/core/src/runner/typeguards';
import { Script } from '@archiyou/core/src/Script';

/** A minimal well-formed GLB header: magic "glTF", version 2, total length. */
function glb(totalLength: number, { magic = 0x46546c67, version = 2 } = {}): Uint8Array
{
    const bytes = new Uint8Array(totalLength);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, magic, true);
    view.setUint32(4, version, true);
    view.setUint32(8, totalLength, true);
    return bytes;
}

describe('validateGlb — the worker health check', () => {
    it('accepts a small but valid GLB', () => {
        // THE REGRESSION. The old check was `size < 5000`, commented "a box is around
        // 8000 bytes". The mesh kernel exports box(10,10,10) in 2804 bytes, so the
        // health check failed on every run and process.exit(1)'d the worker — which,
        // with `restart: unless-stopped`, restart-looped forever and drained no jobs.
        const verdict = validateGlb(glb(2804));
        expect(verdict.ok).toBe(true);
        expect(verdict.size).toBe(2804);
    });

    it('accepts the base64 wrapper the queue path produces', () => {
        const raw = glb(2804);
        const wrapped = { encoding: 'base64', data: Buffer.from(raw).toString('base64') };
        expect(validateGlb(wrapped).ok).toBe(true);
    });

    it('rejects bytes that are not glTF', () => {
        const verdict = validateGlb(glb(2804, { magic: 0xdeadbeef }));
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/not glTF/);
    });

    it('rejects a truncated GLB', () => {
        const bytes = glb(4096).subarray(0, 2048); // header still claims 4096
        const verdict = validateGlb(bytes);
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/truncated/);
    });

    it('rejects an unexpected GLB version', () => {
        expect(validateGlb(glb(2804, { version: 1 })).reason).toMatch(/version 1/);
    });

    it('rejects output that is not binary at all', () => {
        expect(validateGlb(null).ok).toBe(false);
        expect(validateGlb({ some: 'object' }).ok).toBe(false);
        expect(toBytes('not binary')).toBeNull();
    });
});

describe('execution request — surviving the queue', () => {
    it('a Script INSTANCE loses its name when serialized', () => {
        // Why routes/execute.ts sends script.toData() and not the Script. Script keeps
        // its fields private behind getters (`name` reads `_name`), and JSON.stringify
        // only takes own enumerable properties — so the instance arrives at the worker
        // with no `name`, fails isRunnerScriptExecutionRequest, and the caller gets
        // "Unknown task type" with nothing pointing at serialization.
        const script = Script.fromData({ name: 'chair', code: 'box(10,10,10);' })!;
        const overTheWire = JSON.parse(JSON.stringify({ script, params: {}, outputs: ['default/model/glb'] }));

        expect(overTheWire.script.name).toBeUndefined();
        expect(isRunnerScriptExecutionRequest(overTheWire)).toBe(false);
    });

    it('script.toData() survives the round trip', () => {
        const script = Script.fromData({ name: 'chair', code: 'box(10,10,10);' })!;
        const overTheWire = JSON.parse(JSON.stringify({
            script: script.toData(), params: {}, outputs: ['default/model/glb'],
        }));

        expect(overTheWire.script.name).toBe('chair');
        expect(overTheWire.script.code).toBe('box(10,10,10);');
        expect(isRunnerScriptExecutionRequest(overTheWire)).toBe(true);
    });
});
