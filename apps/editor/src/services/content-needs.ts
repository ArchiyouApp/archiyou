/**
 * content-needs — which content a script's run needs, and whether it is the user's own.
 *
 * Used by execution-service.ts to fetch content before a run (plans/PROTECTED_CONTENT.md):
 * what the code names, plus what earlier runs reported needing. Kept apart from the
 * service so the rules can be tested without a worker.
 */
import type { AyContentNeed } from '@archiyou/core/src/modules/sdkTypes';
import type { ScriptData } from '@archiyou/core/src/ScriptSchema';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';

import { currentUser } from './auth-service.js';

/** The script a request carries, as plain data. */
export function scriptDataOf(request: RunnerScriptExecutionRequest): Partial<ScriptData>
{
  const s = request.script as any;
  return (s && typeof s.toData === 'function') ? s.toData() : (s ?? {});
}

/**
 * The user's own script: one they authored, or an unsaved draft that was not opened
 * from someone's shared or published link. Stricter than state/core's _scriptIsForeign
 * on purpose — this decides whether the user's keys are used.
 */
export function isOwnScript(d: Partial<ScriptData>): boolean
{
  const me = currentUser.get()?.id ?? null;
  if (!d.author) return !d.shared && !d.published;
  return !!me && d.author === me;
}

const CONTENT_REFS = 'archiyou:content-refs';
const CONTENT_REFS_MAX_SCRIPTS = 200;

/** Google Sheets written into the code: a URL anywhere, or a bare id passed to open(). */
export function scanContentNeeds(code: string): AyContentNeed[]
{
  const urls = [...code.matchAll(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/g)].map((m) => m[1]!);
  const ids = [...code.matchAll(/\.open\(\s*(['"`])([A-Za-z0-9_-]{25,80})\1/g)].map((m) => m[2]!);
  return [...new Set([...urls, ...ids])].map((id) => ({ kind: 'google-sheet', id, reason: 'open' }));
}

export function scriptKey(d: Partial<ScriptData>): string
{
  return d.fileId ?? d.id ?? `name:${d.name ?? ''}`;
}

function readRememberedNeeds(): Record<string, AyContentNeed[]>
{
  try { return JSON.parse(localStorage.getItem(CONTENT_REFS) ?? '{}'); }
  catch { return {}; }
}

/** Remember what a script turned out to need (sheet ids and key names — nothing secret),
 *  so its next run is fetched up front instead of stopping first. */
export function rememberNeeds(d: Partial<ScriptData>, needs: AyContentNeed[]): void
{
  const all = readRememberedNeeds();
  const key = scriptKey(d);
  const merged = [...new Map([...(all[key] ?? []), ...needs].map((n) => [n.id, { kind: n.kind, id: n.id, ...(n.key ? { key: n.key } : {}) }])).values()];
  const next = Object.fromEntries([...Object.entries(all).filter(([k]) => k !== key), [key, merged]].slice(-CONTENT_REFS_MAX_SCRIPTS));
  try { localStorage.setItem(CONTENT_REFS, JSON.stringify(next)); }
  catch { /* storage unavailable */ }
}

/** What a script is known to need: what its code names, plus what earlier runs reported.
 *  A remembered need wins over a scanned one, because it carries the key the script named. */
export function knownNeeds(d: Partial<ScriptData>): AyContentNeed[]
{
  const remembered = readRememberedNeeds()[scriptKey(d)] ?? [];
  const scanned = typeof d.code === 'string' ? scanContentNeeds(d.code) : [];
  return [...new Map([...scanned, ...remembered].map((n) => [n.id, n])).values()];
}
