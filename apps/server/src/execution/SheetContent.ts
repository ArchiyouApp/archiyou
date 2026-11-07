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
 * sheet really changed. The code that names the sheets is untrusted, so memory is bounded: the
 * sheets used least recently go first, and a sheet larger than maxBytes is not kept.
 */

import { createHash } from 'node:crypto';

import type { AyContentItem, AyContentNeed } from '@archiyou/core/src/modules/sdkTypes';

/** The xlsx export's content type: anything else is Google's sign-in page, so not public. */
const XLSX = 'spreadsheetml';
/** How Google answers an anonymous export of a sheet that is not shared (or does not exist). */
const PRIVATE_STATUS = new Set([401, 403, 404]);

export interface SheetContentOptions
{
    /** Injectable for tests. */
    fetch?: typeof fetch;
    /** A fetch that takes longer is given up. Below the job timeout, so a slow Google ends as a problem. */
    fetchTimeoutMs?: number;
    /** The most sheets kept in memory. */
    maxSheets?: number;
    /** A larger sheet is refused. */
    maxBytes?: number;
}

interface Cached
{
    item: AyContentItem;
    fetchedAt: number;
}

export class SheetContent
{
    private readonly _sheets = new Map<string, Cached>();
    private readonly _refreshing = new Map<string, Promise<void>>();

    private readonly fetchImpl: typeof fetch;
    private readonly fetchTimeoutMs: number;
    private readonly maxSheets: number;
    private readonly maxBytes: number;

    /** @param ttlMs - After this a sheet is fetched again, in the background. */
    constructor(private readonly ttlMs: number, options: SheetContentOptions = {})
    {
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        this.fetchTimeoutMs = options.fetchTimeoutMs ?? 15_000;
        this.maxSheets = options.maxSheets ?? 50;
        this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
    }

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
            this._keep(id, cached); // used last
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
            this._keep(id, { item, fetchedAt: Date.now() });
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
                if (item) this._keep(id, { item, fetchedAt: Date.now() });
                else this._sheets.delete(id);
            })
            .catch(() => { /* Google busy or unreachable: keep the one in memory, try again after the next TTL */ })
            .finally(() => this._refreshing.delete(id));
        this._refreshing.set(id, done);
    }

    /** Keep a sheet as the one used last (a Map keeps insertion order), dropping the one
     *  used longest ago when there are too many. */
    private _keep(id: string, cached: Cached): void
    {
        this._sheets.delete(id);
        this._sheets.set(id, cached);
        [...this._sheets.keys()].slice(0, Math.max(0, this._sheets.size - this.maxSheets)).forEach(old => this._sheets.delete(old));
    }

    /** The public xlsx export, or null when the sheet is not public. Throws when Google could
     *  not answer (busy, down, too slow), which says nothing about the sheet. */
    private async _fetch(id: string): Promise<AyContentItem | null>
    {
        const res = await this.fetchImpl(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=xlsx`,
            { signal: AbortSignal.timeout(this.fetchTimeoutMs) });
        if (PRIVATE_STATUS.has(res.status)) return null;
        if (!res.ok) throw new Error(`Google answered ${res.status}`);
        // a 200 that is not a workbook is the sign-in page
        if (!(res.headers.get('content-type') ?? '').includes(XLSX)) return null;
        if (Number(res.headers.get('content-length') ?? 0) > this.maxBytes) throw new Error(`larger than ${this.maxBytes} bytes`);
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength > this.maxBytes) throw new Error(`larger than ${this.maxBytes} bytes`);
        const version = createHash('sha256').update(new Uint8Array(bytes)).digest('hex').slice(0, 16);
        return { kind: 'google-sheet', id, bytes, version, via: 'public' };
    }
}
