/**
 *  contentNeeds.ts — the content a script's code names, to fetch before its run.
 *
 *  A run is synchronous, so the app fetches what a script reads up front and hands it in
 *  request.content (see AyContentItem): the editor in the browser, the execution worker on the
 *  server. What the code does not name, the run asks for (result.needs) and the app runs again.
 */

import type { AyContentNeed } from './sdkTypes';

/** The Google Sheets written into the code: a URL anywhere, or a bare id passed to open(). */
export function scanContentNeeds(code: string): AyContentNeed[]
{
    const urls = [...code.matchAll(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/g)].map((m) => m[1]!);
    const ids = [...code.matchAll(/\.open\(\s*(['"`])([A-Za-z0-9_-]{25,80})\1/g)].map((m) => m[2]!);
    return [...new Set([...urls, ...ids])].map((id) => ({ kind: 'google-sheet', id, reason: 'open' }));
}
