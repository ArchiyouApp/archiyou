/**
 * tests/unit/library.contentCache.test.ts — the result cache of a run that read a Google Sheet
 * (execution/Library.ts). The cache knows the script and its params; the sheet can change under
 * it. So such results are kept with the sheet's version and served while that is current (the
 * worker's content TTL); after that the script runs again, and a new version replaces them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Library } from '../../src/execution/Library';
import { ScriptOutputPath } from '@archiyou/core/src/execution/ScriptOutputPath';

const SCRIPT = { author: 'archiyou', name: 'house', version: '1.0.0', code: 'box(1)', params: {} };
const OUTPUT = 'default/metrics/json';

let root: string;
let library: Library;

const request = () => ({ script: SCRIPT, params: {}, outputs: [OUTPUT] }) as any;
const result = (data: string, used?: Array<{ version: string }>) => ({
    status: 'success',
    request: request(),
    outputs: [{ path: new ScriptOutputPath(OUTPUT).toData(), output: { data } }],
    errors: [],
    ...(used ? { used: used.map(u => ({ kind: 'google-sheet', id: 'core', via: 'public', ...u })) } : {}),
}) as any;
/** The cached output's text (the cache hands files back as base64), or null on a miss. */
const cached = async () =>
{
    const output = (await library.checkRequestInCache(request()))?.cachedResults?.[0]?.output as any;
    return output ? Buffer.from(output.data, 'base64').toString() : null;
};

beforeEach(() =>
{
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-cache-'));
    library = new Library(root);
    library.contentTtlMs = 60_000;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() =>
{
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

describe('the result cache of a run that read a sheet', () =>
{
    it('keeps a result without content as before', async () =>
    {
        await library.writeResultCache(result('plain'));
        expect(await cached()).toBe('plain');
    });

    it('serves the result while the sheet\'s version is current, then runs again', async () =>
    {
        vi.useFakeTimers({ toFake: ['Date'] });
        await library.writeResultCache(result('prices v1', [{ version: 'v1' }]));
        expect(await cached()).toBe('prices v1');

        vi.advanceTimersByTime(60_000);
        expect(await cached()).toBe(null);

        // the run again with the same version: current once more
        await library.writeResultCache(result('prices v1', [{ version: 'v1' }]));
        expect(await cached()).toBe('prices v1');
    });

    it('removes the results of the old version when the sheet changed', async () =>
    {
        await library.writeResultCache(result('prices v1', [{ version: 'v1' }]));
        const variantDir = path.dirname(path.dirname(path.dirname(fs.readdirSync(root, { recursive: true })
            .map(String).find(f => f.endsWith('result.json'))!)));
        const stale = path.join(root, variantDir, 'default', 'tables', 'old');
        fs.mkdirSync(stale, { recursive: true });
        fs.writeFileSync(path.join(stale, 'result.json'), 'old');

        await library.writeResultCache(result('prices v2', [{ version: 'v2' }]));
        expect(await cached()).toBe('prices v2');
        expect(fs.existsSync(stale)).toBe(false);
    });
});
