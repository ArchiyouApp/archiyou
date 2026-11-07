/**
 * SheetContent.ts — the Google Sheets a server-side run reads, fetched by the execution worker.
 *
 * A run is synchronous, so a script cannot fetch a sheet itself: the app hands the bytes in
 * request.content (see AyContentItem). In the editor the browser does that; on the server the
 * worker does, before the run. Only public sheets ("Anyone with the link can view"), anonymously:
 * the server holds no Google key (plans/PROTECTED_CONTENT.md §12.4).
 *
 * In memory, for the life of the worker's Runner. A sheet is served from memory; once it is
 * older than the TTL it is fetched again in the background, while runs go on with the one in
 * memory. Its version is a hash of the bytes, so cloudcalc rebuilds its workbook only when the
 * sheet really changed.
 */

import { createHash } from 'node:crypto';

import type { AyContentItem, AyContentNeed } from '@archiyou/core/src/modules/sdkTypes';

/** The xlsx export's content type: anything else is Google's sign-in page, so not public. */
const XLSX = 'spreadsheetml';

interface Cached
{
    item: AyContentItem;
    fetchedAt: number;
}

export class SheetContent
{
    private readonly _sheets = new Map<string, Cached>();
    private readonly _refreshing = new Map<string, Promise<void>>();

    /**
     * @param ttlMs - After this a sheet is fetched again, in the background.
     * @param fetchImpl - Injectable for tests.
     */
    constructor(
        private readonly ttlMs: number,
        private readonly fetchImpl: typeof fetch = globalThis.fetch,
    ) {}

    /** The sheets of `needs`, by content key. Never throws: what cannot be fetched comes
     *  back as a problem that says what to do about it. */
    async resolve(needs: AyContentNeed[]): Promise<{ content: Record<string, AyContentItem>, problems: string[] }>
    {
        const ids = [...new Set(needs.filter(n => n.kind === 'google-sheet').map(n => n.id))];
        const outcomes = await Promise.all(ids.map(id => this._sheet(id)));
        return {
            content: Object.fromEntries(outcomes.flatMap(o => (o.item ? [[`google-sheet:${o.item.id}`, o.item]] : []))),
            problems: outcomes.flatMap(o => (o.problem ? [o.problem] : [])),
        };
    }

    /** Forget every sheet, so the next run fetches again. */
    clear(): void
    {
        this._sheets.clear();
    }

    private async _sheet(id: string): Promise<{ item?: AyContentItem, problem?: string }>
    {
        const cached = this._sheets.get(id);
        if (cached)
        {
            if (Date.now() - cached.fetchedAt >= this.ttlMs) this._refresh(id);
            return { item: cached.item };
        }
        try
        {
            const item = await this._fetch(id);
            if (!item)
            {
                return { problem: `The Google Sheet ${id} is not public. A server-side run reads only sheets shared as "Anyone with the link can view".` };
            }
            this._sheets.set(id, { item, fetchedAt: Date.now() });
            return { item };
        }
        catch (e)
        {
            return { problem: `Could not fetch the Google Sheet ${id}: ${(e as Error)?.message ?? e}` };
        }
    }

    /** Fetch a sheet again for the next runs. When it is no longer public, the next run says so. */
    private _refresh(id: string): void
    {
        if (this._refreshing.has(id)) return;
        const done = this._fetch(id)
            .then((item) =>
            {
                if (item) this._sheets.set(id, { item, fetchedAt: Date.now() });
                else this._sheets.delete(id);
            })
            .catch(() => { /* keep the one in memory, try again after the next TTL */ })
            .finally(() => this._refreshing.delete(id));
        this._refreshing.set(id, done);
    }

    /** The public xlsx export, or null when the sheet is not public. */
    private async _fetch(id: string): Promise<AyContentItem | null>
    {
        const res = await this.fetchImpl(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=xlsx`);
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes(XLSX)) return null;
        const bytes = await res.arrayBuffer();
        const version = createHash('sha256').update(new Uint8Array(bytes)).digest('hex').slice(0, 16);
        return { kind: 'google-sheet', id, bytes, version, via: 'public' };
    }
}
