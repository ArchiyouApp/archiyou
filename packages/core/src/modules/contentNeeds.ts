/**
 *  contentNeeds.ts — the content a script's code names, to fetch before its run.
 *
 *  A run is synchronous, so the app fetches what a script reads up front and hands it in
 *  request.content (see AyContentItem): the editor in the browser, the execution worker on the
 *  server. What the code does not name, the run asks for (result.needs) and the app runs again.
 */

import type { AyContentNeed } from './sdkTypes';

/** The content written into the code: the Google Sheets (a URL anywhere, or a bare id passed
 *  to open()), and the make database (make/db) where the code reckons with it: make.db() with
 *  the version it pins, else the latest, also for .product(), .component() and make.takeoff(). */
export function scanContentNeeds(code: string): AyContentNeed[]
{
    const urls = [...code.matchAll(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/g)].map((m) => m[1]!);
    const ids = [...code.matchAll(/\.open\(\s*(['"`])([A-Za-z0-9_-]{25,80})\1/g)].map((m) => m[2]!);
    const sheets: AyContentNeed[] = [...new Set([...urls, ...ids])].map((id) => ({ kind: 'google-sheet', id, reason: 'open' }));
    return [...sheets, ...makeDbNeeds(code)];
}

/** The make database a script reckons with: each version make.db('…') pins, and the latest
 *  where it calls make.db() without one or uses what reads it. */
export function makeDbNeeds(code: string): AyContentNeed[]
{
    const pinned = [...code.matchAll(/\bmake\.db\(\s*(['"`])([0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+|latest)\1\s*\)/g)].map((m) => m[2]!);
    const latest = /\bmake\.db\(\s*\)|\bmake\.takeoff\(|\.product\(\s*['"`]|\.component\(\s*['"`]/.test(code) ? ['latest'] : [];
    return [...new Set([...pinned, ...latest])].map((id) => ({ kind: 'make-db', id, reason: 'make.db' }));
}
