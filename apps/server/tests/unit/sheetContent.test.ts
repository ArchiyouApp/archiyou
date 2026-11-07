/**
 * SheetContent — the Google Sheets a server-side run reads, fetched by the worker.
 *
 * Public sheets only, kept in memory: served from memory, fetched again in the background after
 * the TTL, versioned by their bytes. A private sheet answers with Google's sign-in page (HTML),
 * which must come back as a problem that says what to do.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { SheetContent } from '../../src/execution/SheetContent';

const ID = '1WC2p-zd0MNBiI1MFs4dAdfk3pBupXHaC9NsgSpIEkQo';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A fetch that answers with the bytes in `sheets` by id, or Google's sign-in page. */
function google(sheets: Record<string, string>)
{
    return vi.fn(async (url: string | URL | Request) =>
    {
        const id = String(url).match(/\/d\/([^/]+)\//)![1]!;
        return id in sheets
            ? new Response(new TextEncoder().encode(sheets[id]), { headers: { 'content-type': XLSX } })
            : new Response('<html>sign in</html>', { status: 401, headers: { 'content-type': 'text/html' } });
    });
}

const need = (id: string) => ({ kind: 'google-sheet' as const, id, reason: 'open' as const });

afterEach(() => vi.useRealTimers());

describe('SheetContent', () =>
{
    it('fetches a public sheet once and serves it from memory', async () =>
    {
        const fetch = google({ [ID]: 'v1' });
        const sheets = new SheetContent(60_000, fetch as any);
        const first = await sheets.resolve([need(ID), need(ID)]);
        const item = first.content[`google-sheet:${ID}`]!;
        expect(item).toMatchObject({ kind: 'google-sheet', id: ID, via: 'public' });
        expect(new TextDecoder().decode(item.bytes)).toBe('v1');
        expect(first.problems).toEqual([]);

        expect((await sheets.resolve([need(ID)])).content[`google-sheet:${ID}`]).toBe(item);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('after the TTL fetches again in the background; the version changes with the bytes only', async () =>
    {
        vi.useFakeTimers();
        const sheets_ = { [ID]: 'v1' };
        const fetch = google(sheets_);
        const sheets = new SheetContent(60_000, fetch as any);
        const v1 = (await sheets.resolve([need(ID)])).content[`google-sheet:${ID}`]!;

        vi.advanceTimersByTime(60_000);
        sheets_[ID] = 'v2';
        // this run still gets the one in memory, the next the new one
        expect((await sheets.resolve([need(ID)])).content[`google-sheet:${ID}`]).toBe(v1);
        const current = async () => (await sheets.resolve([need(ID)])).content[`google-sheet:${ID}`]!;
        await vi.waitFor(async () => expect((await current()).version).not.toBe(v1.version));
        const v2 = await current();
        expect(fetch).toHaveBeenCalledTimes(2);

        // the same bytes again: the same version, so cloudcalc keeps its workbook
        vi.advanceTimersByTime(60_000);
        await current();
        await vi.waitFor(async () => expect(await current()).not.toBe(v2));
        expect(fetch).toHaveBeenCalledTimes(3);
        expect((await current()).version).toBe(v2.version);
    });

    it('says a private sheet is not public, and fetches nothing else', async () =>
    {
        const sheets = new SheetContent(60_000, google({}) as any);
        const { content, problems } = await sheets.resolve([need(ID), { kind: 'google-sheet-copy', id: 'x', reason: 'open' } as any]);
        expect(content).toEqual({});
        expect(problems).toEqual([expect.stringMatching(/1WC2p.* is not public.*Anyone with the link can view/)]);
    });

    it('says when Google cannot be reached', async () =>
    {
        const sheets = new SheetContent(60_000, (async () => { throw new Error('offline'); }) as any);
        expect((await sheets.resolve([need(ID)])).problems).toEqual([expect.stringMatching(/Could not fetch .*: offline/)]);
    });
});
