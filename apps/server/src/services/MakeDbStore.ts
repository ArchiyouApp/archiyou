/**
 * MakeDbStore — the snapshots of the product sheet the server keeps for make.db().
 *
 * A snapshot (core's make/db/snapshot.ts) is made from the sheet by `archiyou makedb`, on a
 * machine that holds the Google key: the server holds none (plans/PROTECTED_CONTENT.md §12.4).
 * It is handed to the server with `pnpm admin:makedb add <file>`, checked with core's schema and
 * kept as makedb-<version>.json in config.makedb.path. Runs get one as content ('make-db', by
 * version or 'latest'): the worker for runs on the server, GET /makedb/:version for the editor.
 *
 * Not in git: the repository is public and a snapshot holds purchase prices. Keep `path` on a
 * persistent volume in production.
 */

import fs from 'node:fs';
import path from 'node:path';

// the make/db code only: plain TypeScript, so the API process need not load the whole core
import { MakeDb, compareVersions } from '@archiyou/core/src/make/db/index';
import type { AyContentItem, AyContentNeed } from '@archiyou/core/src/modules/sdkTypes';

import { config } from '../config';

const FILE = /^makedb-(\d{4}-\d{2}-\d{2}\.\d+)\.json$/;

export class MakeDbStore
{
    /** Read once per file: a snapshot never changes under its version */
    private readonly _items = new Map<string, AyContentItem>();

    constructor(private readonly dir: string = config.makedb.path) {}

    /** The versions kept, oldest first */
    versions(): Array<string>
    {
        if (!fs.existsSync(this.dir)) { return []; }
        return fs.readdirSync(this.dir).map(f => f.match(FILE)?.[1]).filter((v): v is string => !!v).sort(compareVersions);
    }

    latest(): string | null
    {
        return this.versions().at(-1) ?? null;
    }

    /** A snapshot's bytes by version or 'latest', or null when there is none */
    get(version: string): { version: string; bytes: Buffer } | null
    {
        const v = version === 'latest' ? this.latest() : version;
        if (!v || !FILE.test(`makedb-${v}.json`)) { return null; }
        const file = path.join(this.dir, `makedb-${v}.json`);
        return fs.existsSync(file) ? { version: v, bytes: fs.readFileSync(file) } : null;
    }

    /**
     * Keep a snapshot. Checked first (core's schema: errors refuse it); a version kept before is
     * not replaced, unless `replace`. Returns its version and its warnings.
     */
    add(bytes: Buffer, options: { replace?: boolean } = {}): { version: string; warnings: number }
    {
        const db = MakeDb.fromBytes(bytes);
        const file = path.join(this.dir, `makedb-${db.version}.json`);
        if (fs.existsSync(file) && !options.replace)
        {
            throw new Error(`make-db ${db.version} is kept already; a snapshot does not change under its version (replace it with --replace)`);
        }
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(file, bytes);
        this._items.clear();
        return { version: db.version, warnings: db.issues.length };
    }

    /** The snapshots of `needs` as a run's content, by content key. Never throws: what is not
     *  kept comes back as a problem. */
    resolve(needs: Array<AyContentNeed>): { content: Record<string, AyContentItem>; problems: Array<string> }
    {
        const ids = [...new Set(needs.filter(n => n.kind === 'make-db').map(n => n.id))];
        const content: Record<string, AyContentItem> = {};
        const problems: Array<string> = [];
        ids.forEach(id =>
        {
            const found = this.get(id);
            if (!found)
            {
                problems.push(id === 'latest'
                    ? 'make.db(): this server keeps no snapshot of the product sheet yet (pnpm admin:makedb add <file>)'
                    : `make.db('${id}'): this server does not keep that snapshot; it has ${this.versions().join(', ') || 'none'}`);
                return;
            }
            const key = `${id}|${found.version}`;
            if (!this._items.has(key))
            {
                const bytes = found.bytes.buffer.slice(found.bytes.byteOffset, found.bytes.byteOffset + found.bytes.byteLength) as ArrayBuffer;
                this._items.set(key, { kind: 'make-db', id, bytes, version: found.version, via: 'public' });
            }
            content[`make-db:${id}`] = this._items.get(key)!;
        });
        return { content, problems };
    }
}

export const makeDbStore = new MakeDbStore();
