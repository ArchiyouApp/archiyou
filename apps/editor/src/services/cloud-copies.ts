/**
 * cloud-copies — the copies a run asks for (cloudcalc's `wb.cloudcopy()`), made once.
 *
 * A script cannot write to the user's Drive: its worker holds no keys, and it cannot wait
 * for a network call. So the run stops at cloudcopy() with a need for the copy (kind
 * 'google-sheet-copy', see execution-service.ts); the editor makes it with the user's key
 * (secretManager.copySheet()) and runs the script again with the answer — the copy's url,
 * or why there is none. Every later run of the script is handed the answers so far, so the
 * same copy asked again needs no extra run.
 *
 * The editor runs a script on every edit and every parameter change, so a copy per run
 * would fill the Drive. A script therefore copies a sheet once:
 *
 *   - the same inputs as an earlier copy → that copy ('existing');
 *   - other inputs → no copy, and a message that says how to get one anyway ('blocked');
 *   - other inputs with `{ force: true }` → a copy. The same inputs are never copied twice.
 *
 * "Earlier copies" are the ones in Drive: each copy carries a private tag (the script, the
 * sheet, a hash of the inputs; see CopyTag), so the check holds in any browser, and a
 * copy the user deletes stops counting. Drive's search lags a few seconds behind a new
 * file, so the copies made here in the last minute count too. Copies of one script and
 * sheet are decided one after the other, so a burst of runs cannot race to make two.
 *
 * Drive is slow, so a run waits for as little as possible: Drive is searched once per
 * script and sheet every few minutes (the copies made here are added meanwhile), and the
 * run gets the copy's url as soon as it exists — its values are written and it is shared
 * in the background (secretManager.copySheet()). What goes wrong there is said on the
 * script's next run.
 */
import type { AyContentItem, AyContentNeed, AyGoogleSheetCopy, AyGoogleSheetCopyResult } from '@archiyou/core/src/modules/sdkTypes';
import type { ScriptData } from '@archiyou/core/src/ScriptSchema';

import { secretManager, type EarlierCopy, type RunTrust } from './secret-manager.js';
import { scriptKey } from './content-needs.js';

/** How long a copy made here counts without Drive's search finding it. */
const SEARCH_LAG_MS = 60_000;
/** How long a 'blocked' answer is handed out again: a deleted earlier copy unblocks after it. */
const BLOCKED_TTL_MS = 60_000;
/** How long Drive's list of a script's earlier copies is used before searching again. */
const SEARCHED_TTL_MS = 5 * 60_000;
/** Need ids as cloudcalc makes them: the spreadsheet id and a hash. */
const NEED_ID = /^[A-Za-z0-9_-]{10,80}:[0-9a-f]{1,16}$/;

/** Copies made in this session, by `<script>|<sheet>`: the cover for Drive's search lag. */
const made = new Map<string, EarlierCopy[]>();
/** The decision going on per `<script>|<sheet>`: the next waits for it. */
const deciding = new Map<string, Promise<unknown>>();
/** Drive's earlier copies, by `<script>|<sheet>`, as last searched. */
const searched = new Map<string, { at: number; copies: EarlierCopy[] }>();
/** The answers so far, per script and need id, handed to every later run of the script.
 *  `later`: what went wrong after the run got its answer, to say on the next run. */
const answers = new Map<string, Map<string, { result: AyGoogleSheetCopyResult; keyName?: string; at: number; later: string[] }>>();

/** The answers this script got before, as run content. A copy made then is 'existing' now,
 *  without its messages: they were said when it was made. */
export function knownCopies(d: Partial<ScriptData>): Record<string, AyContentItem>
{
  const now = Date.now();
  return Object.fromEntries([...(answers.get(scriptKey(d))?.entries() ?? [])]
    .filter(([, a]) => a.result.status !== 'blocked' || now - a.at < BLOCKED_TTL_MS)
    .map(([id, a]) =>
    {
      const said = a.result.status === 'copied' ? { ...a.result, status: 'existing' as const, messages: [] } : a.result;
      const result = { ...said, messages: [...said.messages, ...a.later] };
      a.later = [];
      return [`google-sheet-copy:${id}`, item(id, result, a.keyName)];
    }));
}

/**
 * Answer the copies a run stopped for: make each as far as the rules above allow, and
 * return the answers as content for the next run. Never throws: what went wrong is a
 * 'failed' answer whose message says what to do.
 */
export async function resolveCopies(needs: AyContentNeed[], d: Partial<ScriptData>, trust: RunTrust): Promise<Record<string, AyContentItem>>
{
  const asked = needs.filter((n) => n.kind === 'google-sheet-copy' && NEED_ID.test(n.id) && n.copy);
  if (!asked.length) return {};

  const script = await sha256(scriptKey(d));
  const known = answers.get(scriptKey(d)) ?? new Map();
  answers.set(scriptKey(d), known);
  const resolved = await Promise.all(asked.map(async (need) =>
  {
    const { result, keyName, done } = await decideInTurn(`${script}|${need.copy!.id}`, () => decide(need.copy!, trust, script));
    if (result.status !== 'failed')
    {
      const entry = { result, keyName, at: Date.now(), later: [] as string[] };
      known.set(need.id, entry);
      void done?.then((problem) =>
      {
        if (!problem) return;
        console.warn(`cloudcopy(): ${problem}`);
        entry.later.push(`workbook.cloudcopy(): ${problem}`);
      });
    }
    return [`google-sheet-copy:${need.id}`, item(need.id, result, keyName)] as const;
  }));
  return Object.fromEntries(resolved);
}

/** For tests: forget the copies made and the answers given in this session. */
export function forgetMadeCopies(): void
{
  made.clear();
  searched.clear();
  answers.clear();
}

function item(id: string, copy: AyGoogleSheetCopyResult, keyName?: string): AyContentItem
{
  return { kind: 'google-sheet-copy', id, bytes: new ArrayBuffer(0), version: copy.status, via: keyName ? 'key' : 'public', ...(keyName ? { keyName } : {}), copy };
}

async function decideInTurn<T>(key: string, fn: () => Promise<T>): Promise<T>
{
  const before = deciding.get(key) ?? Promise.resolve();
  const turn = before.then(fn, fn);
  deciding.set(key, turn);
  try
  {
    return await turn;
  }
  finally
  {
    if (deciding.get(key) === turn) deciding.delete(key);
  }
}

/** `<sheet title>_COPY_<local date and time>`, for a copy the script did not name. */
export function defaultTitle(sourceTitle: string | undefined, at: Date = new Date()): string
{
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}_${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
  return `${(sourceTitle || 'Sheet').slice(0, 170)}_COPY_${stamp}`;
}

async function decide(copy: AyGoogleSheetCopy, trust: RunTrust, script: string): Promise<{ result: AyGoogleSheetCopyResult; keyName?: string; done?: Promise<string | null> }>
{
  try
  {
    const inputs = await sha256(JSON.stringify(copy.writes));
    const key = `${script}|${copy.id}`;
    const recent = (made.get(key) ?? []).filter((c) => Date.now() - Date.parse(c.createdTime) < Math.max(SEARCH_LAG_MS, SEARCHED_TTL_MS));
    const last = searched.get(key);
    const searching = performance.now();
    const fresh = !(last && Date.now() - last.at < SEARCHED_TTL_MS);
    const found = fresh ? await secretManager.earlierCopies(copy, trust, script) : last!.copies;
    const search = fresh ? `searched Drive ${Math.round(performance.now() - searching)} ms` : 'search cached';
    if (found !== last?.copies) searched.set(key, { at: Date.now(), copies: found });
    const keyName = secretManager.copyKeyName(copy) ?? undefined;
    const earlier = [...new Map([...recent, ...found].map((c) => [c.id, c])).values()]
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime));

    const same = earlier.find((c) => c.inputs === inputs);
    if (same) return { result: { status: 'existing', url: same.url, title: same.title, messages: [] }, keyName };
    if (earlier.length && !copy.force)
    {
      return { result: { status: 'blocked', url: earlier[0]!.url, title: earlier[0]!.title, messages: [blocked(earlier[0]!)] }, keyName };
    }

    const copying = performance.now();
    const copied = await secretManager.copySheet(copy, trust, { script, inputs }, copy.title ?? defaultTitle(copy.sourceTitle));
    console.info(`cloudcopy(): ${search}, files.copy ${Math.round(performance.now() - copying)} ms`);
    void copied.done.then(() => console.info(`cloudcopy(): values written${copy.share ? ' and shared' : ''} ${Math.round(performance.now() - copying)} ms after the copy started`));
    made.set(key, [...recent, { id: copied.id, url: copied.url, title: copied.title, createdTime: new Date().toISOString(), inputs }]);
    return {
      result: {
        status: 'copied',
        url: copied.url,
        title: copied.title,
        messages: [`workbook.cloudcopy(): copied to '${copied.title}', next to the sheet in Google Drive — ${copied.url}`, ...(copied.warning ? [`workbook.cloudcopy(): ${copied.warning}`] : [])],
      },
      keyName: copied.keyName,
      done: copied.done,
    };
  }
  catch (e)
  {
    return { result: { status: 'failed', url: null, title: copy.title ?? copy.sourceTitle ?? '', messages: [`workbook.cloudcopy(): ERROR: ${(e as Error)?.message ?? e}`] } };
  }
}

function blocked(last: EarlierCopy): string
{
  const when = last.createdTime ? ` on ${new Date(last.createdTime).toLocaleString()}` : '';
  return `workbook.cloudcopy(): no copy made — this script copied the sheet before with other inputs: '${last.title}'${when}, ${last.url}. ` +
    `A script copies a sheet once, so runs do not fill your Drive. To copy with these inputs as well, ` +
    `pass { force: true } to cloudcopy(), or delete the earlier copy.`;
}

async function sha256(text: string): Promise<string>
{
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
