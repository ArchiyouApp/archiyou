/**
 * make-db-content — the snapshots of the product sheet a run reckons with (make.db()).
 *
 * The server keeps them (apps/server: services/MakeDbStore.ts, GET /makedb/:version), made from
 * the sheet with `archiyou makedb` and added by an admin; the browser fetches the one a script
 * needs before its run, as it fetches a Google Sheet. Signed in only: a snapshot holds purchase
 * prices. A version never changes, so it is kept for the session; 'latest' is asked again after
 * LATEST_TTL_MS, so a new snapshot reaches the next runs.
 */
import type { AyContentItem, AyContentNeed } from '@archiyou/core/src/modules/sdkTypes';

import { authService } from './auth-service.js';

const API_BASE = (import.meta.env.SERVER_API_BASE_URL as string | undefined) ?? '';
const LATEST_TTL_MS = 5 * 60_000;

const kept = new Map<string, { item: AyContentItem; at: number }>();

/** The snapshots of `needs` by content key; what cannot be had comes back as a problem message. */
export async function resolveMakeDb(needs: AyContentNeed[]): Promise<{ content: Record<string, AyContentItem>; problems: string[] }>
{
  const ids = [...new Set(needs.filter((n) => n.kind === 'make-db').map((n) => n.id))];
  const outcomes = await Promise.all(ids.map(async (id) =>
  {
    const cached = kept.get(id);
    if (cached && (id !== 'latest' || Date.now() - cached.at < LATEST_TTL_MS)) return { item: cached.item };
    const token = await authService.getToken();
    if (!token) return { problem: 'make.db(): sign in to reckon with the product sheet (its snapshot holds purchase prices)' };
    try
    {
      const res = await fetch(`${API_BASE}/makedb/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { problem: res.status === 404 ? `make.db(${id === 'latest' ? '' : `'${id}'`}): the server keeps no such snapshot of the product sheet` : `make.db(): the server answered ${res.status}` };
      const bytes = await res.arrayBuffer();
      const version = res.headers.get('X-Make-Db-Version') ?? id;
      const item: AyContentItem = { kind: 'make-db', id, bytes, version, via: 'public' };
      kept.set(id, { item, at: Date.now() });
      return { item };
    }
    catch (e)
    {
      return { problem: `make.db(): could not fetch the snapshot (${(e as Error).message})` };
    }
  }));
  return {
    content: Object.fromEntries(outcomes.flatMap((o) => ('item' in o && o.item ? [[`make-db:${o.item.id}`, o.item]] : []))),
    problems: outcomes.flatMap((o) => ('problem' in o && o.problem ? [o.problem] : [])),
  };
}
