/**
 * thumbnails — a script's preview, made and delivered in the background.
 *
 * A preview is a render of the model: the GLB a run produced anyway, drawn off screen by
 * the viewer with a fixed camera and style (model-viewer's renderModelThumbnail) — a few
 * hundred milliseconds on the main thread however dense the model, spent off the run
 * path. Three things ask for one, and none of them ever waits:
 *
 *   working   the editor, after every successful run (`scheduleWorkingThumbnail`): debounced
 *             so a slider drag renders once, superseded by the next run, uploaded for the
 *             file's working copy. This is what the browser page's Home tab shows.
 *   version   the share/publish dialogs, for the version they just stored: they render the
 *             picture from their own run and call `uploadVersionThumbnail` afterwards.
 *   backfill  the browser page, for the signed-in user's own scripts that have no preview
 *             (`enqueueBackfill`): one at a time, only while nothing in the foreground is
 *             using the worker, each a run for its GLB plus the render.
 *
 * Every failure is swallowed and logged once: a script without a picture is a perfectly
 * good script. What became of the bytes server-side is in the server's thumbnail log.
 * Scripts that draw nothing (or that the server refuses) are remembered in localStorage so
 * the backfill does not re-run them on every visit.
 */

import type { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';
import type { SceneNodeData } from '@archiyou/core/src/modeler/types';
import { hash } from '@archiyou/core/src/utils';
import { getOutput } from '@archiyou/core/src/runner/worker/output';

import { api, ApiError } from './api.js';
import { authService } from './auth-service.js';
import { isExecutionBusy, lastExecutionAt, runScript } from './execution-service.js';
import { scripts, bumpScripts, saveCollection } from '../state/core.js';

/** Fired on `window` whenever a picture lands, so a page showing the script can update. */
export const THUMBNAIL_STORED_EVENT = 'ay-thumbnail-stored';
export interface ThumbnailStoredDetail { fileId: string; versionId?: string; url: string }

/** How long after the last run the working copy's picture is taken. Long enough that a
 *  slider drag or a burst of auto-runs draws once, short enough to feel like "after". */
export const WORKING_DEBOUNCE_MS = 2000;
/** The backfill stays out of the way of anyone actually working: no job starts within this
 *  long of a foreground run, or while one is in flight. */
const FOREGROUND_QUIET_MS = 3000;
const BACKFILL_GAP_MS = 300;
const IDLE_POLL_MS = 250;
const SKIP_KEY = 'ay.thumbnail.skip';
const SKIP_MAX = 500;

type UploadKind = 'working' | 'version' | 'backfill';

/** The output a thumbnail is rendered from. */
const GLB_OUTPUT = 'default/model/glb';

//// RENDER ////

/**
 * The PNG for a model GLB, or null when there is nothing to show or rendering is not
 * possible here. The run's scenegraph says which shapes the script hid — the GLB does not
 * carry that. The viewer module is loaded on demand: the editor page has it anyway, the
 * browser page only pays for three.js once it actually has a picture to make.
 */
export async function renderThumbnailPng(glb: ArrayBuffer | null | undefined, scenegraph?: SceneNodeData | null): Promise<ArrayBuffer | null>
{
  if (!glb || glb.byteLength === 0) return null;
  try
  {
    const { renderModelThumbnail } = await import('@archiyou/ui/viewer/model-viewer.js');
    return await renderModelThumbnail(glb, { scenegraph });
  }
  catch (err)
  {
    console.warn('thumbnails: render failed:', err);
    return null;
  }
}

/** The GLB of a run result, when it produced one. */
export function glbOf(result: { outputs?: unknown } | null | undefined): ArrayBuffer | null
{
  const glb = result ? getOutput(result as never, GLB_OUTPUT) : undefined;
  return glb instanceof ArrayBuffer ? glb : null;
}

/** The scenegraph of a run result — what the script declared hidden lives there. */
export function scenegraphOf(result: Pick<RunnerScriptExecutionResult, 'state'> | null | undefined): SceneNodeData | null
{
  return result?.state?.scenegraph ?? null;
}

//// UPLOAD ////

interface UploadOutcome
{
  url: string | null;
  /** The server looked at the bytes and said no (422), or will not take them from this
   *  account (403). Sending the same picture again would change nothing. */
  refused: boolean;
}

async function send(path: string, png: ArrayBuffer, kind: UploadKind): Promise<UploadOutcome>
{
  try
  {
    const res = await api.putBinary<{ success?: boolean; thumbnail?: string }>(`${path}?kind=${kind}`, png, 'image/png');
    return { url: res?.thumbnail ?? null, refused: false };
  }
  catch (err)
  {
    const status = err instanceof ApiError ? err.status : 0;
    console.warn(`thumbnails: upload (${kind}) did not land:`, (err as Error)?.message ?? err);
    return { url: null, refused: status === 422 || status === 403 };
  }
}

function versionPath(user: string, fileId: string, versionId: string): string
{
  return `/scripts/${user}/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/thumbnail`;
}

function workingPath(user: string, fileId: string): string
{
  return `/scripts/${user}/${encodeURIComponent(fileId)}/thumbnail`;
}

/** Attach a picture to a stored (shared/published) version. Resolves to the stored URL,
 *  or null when it did not land. Never rejects. */
export async function uploadVersionThumbnail(fileId: string, versionId: string, png: ArrayBuffer | null): Promise<string | null>
{
  const user = authService.getUser()?.id;
  if (!user || !fileId || !versionId || !png) return null;
  const { url } = await send(versionPath(user, fileId, versionId), png, 'version');
  if (url) emit({ fileId, versionId, url });
  return url;
}

/** Attach a picture to a file's working copy (its latest row, whichever that is by now).
 *  Resolves to the stored URL, or null when it did not land. Never rejects. */
export async function uploadWorkingThumbnail(fileId: string, png: ArrayBuffer | null): Promise<string | null>
{
  const user = authService.getUser()?.id;
  if (!user || !fileId || !png) return null;
  const { url } = await send(workingPath(user, fileId), png, 'working');
  if (url) adoptWorking(fileId, url);
  return url;
}

/** Put a working copy's new URL on the local Script, so lists show it without a re-fetch
 *  and the next save carries it (the server carries it forward regardless). */
function adoptWorking(fileId: string, url: string): void
{
  const script = scripts.get().find(s => s.fileId === fileId);
  if (script && script.thumbnail !== url)
  {
    script.thumbnail = url;
    bumpScripts();
    saveCollection();
  }
  emit({ fileId, url });
}

function emit(detail: ThumbnailStoredDetail): void
{
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ThumbnailStoredDetail>(THUMBNAIL_STORED_EVENT, { detail }));
}

//// WORKING COPY — after a run in the editor ////

let workingToken = 0;
let workingTimer: ReturnType<typeof setTimeout> | null = null;
let workingJob: Promise<void> | null = null;

/** Is a working-copy picture pending or being made? The backfill keeps out of its way. */
function workingPending(): boolean
{
  return workingTimer !== null || workingJob !== null;
}

/**
 * Take the working copy's picture from this run's GLB a little later, unless another run
 * comes first.
 *
 * Called after every successful run; the debounce and the token between them make a burst
 * of runs cost one render, of the last model. A script that is not the signed-in user's
 * own (a shared script opened read-only) is left alone: it is not ours to stamp.
 */
export function scheduleWorkingThumbnail(script: Script, glb: ArrayBuffer, scenegraph?: SceneNodeData | null): void
{
  const me = authService.getUser()?.id;
  if (!me || !script.fileId || !glb?.byteLength) return;
  if (script.author && script.author !== me) return;

  const token = ++workingToken;
  if (workingTimer) clearTimeout(workingTimer);
  workingTimer = setTimeout(() =>
  {
    workingTimer = null;
    workingJob = takeWorkingPicture(script, glb, scenegraph ?? null, token).finally(() => { workingJob = null; });
  }, WORKING_DEBOUNCE_MS);
}

async function takeWorkingPicture(script: Script, glb: ArrayBuffer, scenegraph: SceneNodeData | null, token: number): Promise<void>
{
  const fileId = script.fileId;
  try
  {
    const png = await renderThumbnailPng(glb, scenegraph);
    // A newer run happened meanwhile: its own job follows with a fresher model.
    if (token !== workingToken) return;
    if (!png) return; // nothing to show — an empty model; already logged
    await uploadWorkingThumbnail(fileId, png);
  }
  catch (err)
  {
    console.warn('thumbnails: working-copy picture failed:', err);
  }
}

//// BACKFILL — the browser page's scripts without a picture ////

export interface BackfillTarget
{
  fileId: string;
  /** A stored (shared/published) version's row id; absent for the working copy. */
  versionId?: string;
  /** The script to run, as stored. */
  script: ScriptData;
}

const queue: Array<BackfillTarget> = [];
const queued = new Set<string>();
let draining = false;

function keyOf(t: BackfillTarget): string
{
  return `${t.fileId}:${t.versionId ?? 'working'}`;
}

/**
 * Queue pictures for scripts that have none. Deduplicated, and quietly dropped for a
 * script this browser already found to draw nothing. Returns at once; the work happens
 * when the worker is idle.
 */
export function enqueueBackfill(targets: Array<BackfillTarget>): void
{
  if (!authService.getUser()?.id) return;
  for (const t of targets)
  {
    if (!t.fileId || !t.script?.code) continue;
    const key = keyOf(t);
    if (queued.has(key) || isSkipped(t)) continue;
    queued.add(key);
    queue.push(t);
  }
  if (!draining && queue.length) void drain();
}

/** How many pictures are still to be taken (for tests and diagnostics). */
export function backfillPending(): number
{
  return queue.length;
}

async function drain(): Promise<void>
{
  draining = true;
  try
  {
    while (queue.length)
    {
      if (!authService.getUser()?.id) { queue.length = 0; queued.clear(); return; }
      await whenIdle();
      const target = queue.shift()!;
      queued.delete(keyOf(target));
      await backfillOne(target);
      await sleep(BACKFILL_GAP_MS);
    }
  }
  finally
  {
    draining = false;
  }
}

async function whenIdle(): Promise<void>
{
  while (isExecutionBusy() || workingPending() || Date.now() - lastExecutionAt() < FOREGROUND_QUIET_MS)
  {
    await sleep(IDLE_POLL_MS);
  }
}

async function backfillOne(t: BackfillTarget): Promise<void>
{
  const me = authService.getUser()?.id;
  if (!me) return;
  try
  {
    const data: ScriptData = { ...t.script };
    // The runner needs to know whose '@author/name:dev' is the own one.
    if (!data.author) data.author = me;
    const result = await runScript({
      kernel:     'mesh',
      script:     data,
      outputs:    [GLB_OUTPUT],
      messages:   ['error'],
      unitSystem: data.units ?? 'metric',
      // As the editor does: local scripts resolve $component('./name').
      componentScripts: scripts.get().filter(s => s.fileId !== t.fileId).map(s => s.toData()),
    } as RunnerScriptExecutionRequest, { background: true });

    const png = result?.status === 'error' ? null : await renderThumbnailPng(glbOf(result), scenegraphOf(result));
    if (!png) { markSkipped(t); return; } // drew nothing, or failed — not worth another run

    const outcome = t.versionId
      ? await send(versionPath(me, t.fileId, t.versionId), png, 'backfill')
      : await send(workingPath(me, t.fileId), png, 'backfill');
    if (outcome.refused) { markSkipped(t); return; }
    if (!outcome.url) return; // transport trouble: another visit will try again

    if (t.versionId) emit({ fileId: t.fileId, versionId: t.versionId, url: outcome.url });
    else adoptWorking(t.fileId, outcome.url);
  }
  catch (err)
  {
    console.warn('thumbnails: backfill failed for', t.fileId, err);
  }
}

//// SKIP LIST ////

function skipKey(t: BackfillTarget): string
{
  return `${keyOf(t)}:${hash(t.script.code ?? '').slice(0, 16)}`;
}

function readSkips(): Array<string>
{
  try
  {
    const raw = localStorage.getItem(SKIP_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
  }
  catch { return []; }
}

function isSkipped(t: BackfillTarget): boolean
{
  return readSkips().includes(skipKey(t));
}

function markSkipped(t: BackfillTarget): void
{
  try
  {
    const list = readSkips().filter(k => k !== skipKey(t));
    list.push(skipKey(t));
    localStorage.setItem(SKIP_KEY, JSON.stringify(list.slice(-SKIP_MAX)));
  }
  catch { /* storage unavailable — we will simply try again next time */ }
}

function sleep(ms: number): Promise<void>
{
  return new Promise(resolve => setTimeout(resolve, ms));
}
