/**
 * MakeDbStore — the snapshots of the product sheet the server keeps for make.db().
 *
 * Checked before they are kept, never replaced under their version, given to runs as content by
 * version or as the latest; what is not kept is a problem that says what to do.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { snapshotFromTables } from '@archiyou/core/src/make/db/index';

import { MakeDbStore } from '../../src/services/MakeDbStore';

function snapshot(version: string): Buffer
{
    const s = snapshotFromTables({
        version,
        source: { sheet: '1o0_OGFKAh9f3Sh6FlVx7JYNoDmSopAzd9U0akVJHGzw', title: 'URBUILD_DATABASE_CORE' },
        tables: {
            materialen: [['materiaal_id', 'naam', 'toepassing', 'dichtheid (kg/m3)', 'warmtegeleidingscoëfficiënt λ (W/(m·K))'], ['naaldhout', 'Naaldhout', 'constructiehout', 450, 0.13]],
            producten: [['product_id', 'productgroep', 'vorm', 'materiaal'], ['sls-38x235', 'SLS', 'balk', 'naaldhout']],
            bewerkingen: [['naam', 'fase', 'werkeenheid', 'tijd (seconden)', 'kosten (EUR per werkeenheid)'], ['afkorten', 'voorbewerking', 'st', 90, 1.5]],
            componenten: [['component', 'fase', 'product', 'bewerking', 'per', 'factor'], ['hsbwand', 'materiaal', 'sls-38x235', '', '', '']],
        },
        settings: { 'settings.rate_labor': 40, 'outputs.marges.materiaal': 10, 'outputs.marges.arbeid': 10, 'outputs.marges.algemeen': 0 },
    });
    return Buffer.from(JSON.stringify(s));
}

describe('MakeDbStore', () =>
{
    const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'makedb-'));

    it('keeps checked snapshots by version, the latest by number, and gives them to a run', () =>
    {
        const store = new MakeDbStore(dir());
        expect(store.versions()).toEqual([]);
        expect(store.add(snapshot('2026-11-24.2'))).toEqual({ version: '2026-11-24.2', warnings: 0 });
        store.add(snapshot('2026-11-24.10'));
        store.add(snapshot('2026-11-23.1'));
        expect(store.versions()).toEqual(['2026-11-23.1', '2026-11-24.2', '2026-11-24.10']);
        expect(store.latest()).toBe('2026-11-24.10');

        const { content, problems } = store.resolve([
            { kind: 'make-db', id: 'latest' }, { kind: 'make-db', id: '2026-11-23.1' }, { kind: 'google-sheet', id: 'abc' }]);
        expect(problems).toEqual([]);
        expect(Object.keys(content)).toEqual(['make-db:latest', 'make-db:2026-11-23.1']);
        expect(content['make-db:latest']).toMatchObject({ kind: 'make-db', id: 'latest', version: '2026-11-24.10', via: 'public' });
        expect(JSON.parse(new TextDecoder().decode(content['make-db:2026-11-23.1']!.bytes)).version).toBe('2026-11-23.1');
    });

    it('refuses what is not usable, and a version it keeps already unless told to replace it', () =>
    {
        const store = new MakeDbStore(dir());
        expect(() => store.add(Buffer.from('{"format": 1}'))).toThrow(/not usable/);
        store.add(snapshot('2026-11-24.1'));
        expect(() => store.add(snapshot('2026-11-24.1'))).toThrow(/kept already/);
        expect(store.add(snapshot('2026-11-24.1'), { replace: true }).version).toBe('2026-11-24.1');
        expect(store.versions()).toEqual(['2026-11-24.1']);
    });

    it('says what to do when it has none, or not the one a script pins', () =>
    {
        const store = new MakeDbStore(dir());
        expect(store.resolve([{ kind: 'make-db', id: 'latest' }]).problems[0]).toMatch(/keeps no snapshot .*\(pnpm admin:makedb add/);
        store.add(snapshot('2026-11-24.1'));
        expect(store.resolve([{ kind: 'make-db', id: '2026-11-20.1' }]).problems).toEqual(["make.db('2026-11-20.1'): this server does not keep that snapshot; it has 2026-11-24.1"]);
        // a version is only ever a version, never a path
        expect(store.get('../../etc/passwd')).toBeNull();
    });
});
