/**
 * tests/thumbnail-service.test.ts — the scheduling half of services/thumbnails.ts: when a
 * picture is taken, when it is not, and what the backfill does with what comes back.
 *
 * The worker, the API and the signed-in user are stubbed: nothing here needs a kernel, a
 * DOM or a server. What is under test is the choreography — a burst of runs draws once,
 * a newer run supersedes a pending picture, the backfill waits for the foreground and
 * stops re-running scripts that draw nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const worker = vi.hoisted(() => ({
  busy: false,
  lastRunAt: 0,
  runScript: vi.fn<(r: unknown, o?: unknown) => Promise<unknown>>(),
}));

const viewer = vi.hoisted(() => ({
  renderModelThumbnail: vi.fn<(glb: ArrayBuffer) => Promise<ArrayBuffer | null>>(),
}));

const net = vi.hoisted(() => ({
  putBinary: vi.fn<(path: string, body: unknown, type: string) => Promise<{ thumbnail?: string }>>(),
}));

const user = vi.hoisted(() => ({ id: 'mark' as string | null }));

vi.mock('../src/services/execution-service.js', () => ({
  isExecutionBusy: () => worker.busy,
  lastExecutionAt: () => worker.lastRunAt,
  runScript: worker.runScript,
}));

vi.mock('@archiyou/ui/viewer/model-viewer.js', () => ({
  renderModelThumbnail: viewer.renderModelThumbnail,
}));

vi.mock('../src/services/api.js', () => ({
  api: { putBinary: net.putBinary },
  ApiError: class ApiError extends Error { constructor(public readonly status: number, public readonly body: unknown) { super(`API error ${status}`); } },
}));

vi.mock('../src/services/auth-service.js', () => ({
  authService: { getUser: () => (user.id ? { id: user.id } : null) },
}));

const state = vi.hoisted(() => ({
  scripts: [] as Array<{ fileId: string; author?: string; code: string; thumbnail: string | null; toData: () => Record<string, unknown> }>,
  bumps: 0,
  saves: 0,
}));

vi.mock('../src/state/core.js', () => ({
  scripts: { get: () => state.scripts },
  bumpScripts: () => { state.bumps++; },
  saveCollection: () => { state.saves++; },
}));

// Node has no window; the service announces stored pictures on it.
vi.stubGlobal('window', new EventTarget());

// localStorage for the skip list: a tiny in-memory stand-in.
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
});

function script(fileId: string, over: Partial<(typeof state.scripts)[number]> = {}) {
  const s = { fileId, code: 'box(100, 100, 100);', thumbnail: null as string | null, ...over };
  return { ...s, toData: () => ({ fileId: s.fileId, code: s.code, author: s.author, thumbnail: s.thumbnail }) };
}

const PNG = new ArrayBuffer(8);
const GLB = new ArrayBuffer(16);
/** A run result carrying a GLB, as the runner returns it. */
const withGlb = (status = 'success') => ({ status, outputs: [{ path: { requestedPath: 'default/model/glb' }, output: GLB }] });

/** Let every pending promise settle, advancing fake timers along the way. */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  worker.busy = false;
  worker.lastRunAt = 0;
  worker.runScript.mockReset().mockResolvedValue(withGlb());
  viewer.renderModelThumbnail.mockReset().mockResolvedValue(PNG);
  net.putBinary.mockReset().mockImplementation(async (path) => ({ thumbnail: `/thumbnails/mark/${path.split('/')[3]}/x.png` }));
  user.id = 'mark';
  state.scripts = [];
  state.bumps = 0;
  state.saves = 0;
  storage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleWorkingThumbnail — after a run in the editor', () => {
  it('draws once for a burst of runs, after the debounce, and stamps the local script', async () => {
    const { scheduleWorkingThumbnail, WORKING_DEBOUNCE_MS } = await import('../src/services/thumbnails.js');
    const s = script('f1');
    state.scripts = [s];

    scheduleWorkingThumbnail(s as never, GLB);
    await settle(WORKING_DEBOUNCE_MS / 2);
    scheduleWorkingThumbnail(s as never, GLB); // a slider tick — restarts the clock
    await settle(WORKING_DEBOUNCE_MS / 2);
    expect(viewer.renderModelThumbnail).not.toHaveBeenCalled(); // still waiting

    await settle(WORKING_DEBOUNCE_MS);
    expect(viewer.renderModelThumbnail).toHaveBeenCalledTimes(1);
    expect(viewer.renderModelThumbnail.mock.calls[0][0]).toBe(GLB);
    expect(net.putBinary).toHaveBeenCalledTimes(1);
    expect(net.putBinary.mock.calls[0][0]).toBe('/scripts/mark/f1/thumbnail?kind=working');
    expect(net.putBinary.mock.calls[0][2]).toBe('image/png');
    expect(s.thumbnail).toBe('/thumbnails/mark/f1/x.png');
    expect(state.bumps).toBe(1);
    expect(state.saves).toBe(1);
  });

  it('lets a newer run supersede a picture still being taken', async () => {
    const { scheduleWorkingThumbnail, WORKING_DEBOUNCE_MS } = await import('../src/services/thumbnails.js');
    const s = script('f2');
    let finishRender!: (png: ArrayBuffer) => void;
    viewer.renderModelThumbnail.mockReturnValueOnce(new Promise((resolve) => { finishRender = resolve; }));

    scheduleWorkingThumbnail(s as never, GLB);
    await settle(WORKING_DEBOUNCE_MS);
    expect(viewer.renderModelThumbnail).toHaveBeenCalledTimes(1);

    scheduleWorkingThumbnail(s as never, new ArrayBuffer(32)); // the next run, while the first picture is in flight
    finishRender(PNG);
    await settle(0);
    expect(net.putBinary).not.toHaveBeenCalled(); // the stale one is dropped…

    await settle(WORKING_DEBOUNCE_MS);
    expect(viewer.renderModelThumbnail).toHaveBeenCalledTimes(2); // …and the fresh one taken
    expect(net.putBinary).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a script that is not ours, or when signed out, or when nothing was drawn', async () => {
    const { scheduleWorkingThumbnail, WORKING_DEBOUNCE_MS } = await import('../src/services/thumbnails.js');

    scheduleWorkingThumbnail(script('f3', { author: 'someone-else' }) as never, GLB);
    user.id = null;
    scheduleWorkingThumbnail(script('f4') as never, GLB);
    user.id = 'mark';
    viewer.renderModelThumbnail.mockResolvedValueOnce(null);
    scheduleWorkingThumbnail(script('f5') as never, GLB);

    await settle(WORKING_DEBOUNCE_MS * 2);
    expect(viewer.renderModelThumbnail).toHaveBeenCalledTimes(1); // f5 only
    expect(net.putBinary).not.toHaveBeenCalled();
  });
});

describe('enqueueBackfill — the browser page', () => {
  it('runs targets one at a time, only when the foreground is quiet, and delivers each', async () => {
    const { enqueueBackfill, backfillPending, THUMBNAIL_STORED_EVENT } = await import('../src/services/thumbnails.js');
    const s1 = script('b1');
    state.scripts = [s1];
    const stored: Array<unknown> = [];
    window.addEventListener(THUMBNAIL_STORED_EVENT, (e) => stored.push((e as CustomEvent).detail));

    worker.busy = true;
    enqueueBackfill([
      { fileId: 'b1', script: s1.toData() as never },
      { fileId: 'b2', versionId: 'v9', script: { fileId: 'b2', code: 'sphere(10);' } as never },
      { fileId: 'b2', versionId: 'v9', script: { fileId: 'b2', code: 'sphere(10);' } as never }, // duplicate
    ]);
    expect(backfillPending()).toBe(2);

    await settle(5_000);
    expect(worker.runScript).not.toHaveBeenCalled(); // someone is running — wait

    worker.busy = false;
    worker.lastRunAt = Date.now(); // …and they only just finished
    await settle(1_000);
    expect(worker.runScript).not.toHaveBeenCalled();

    await settle(5_000);
    expect(worker.runScript).toHaveBeenCalledTimes(2);
    // The run carries the author, asks for the GLB, and is marked background.
    expect(worker.runScript.mock.calls[0][0]).toMatchObject({
      script: { fileId: 'b1', author: 'mark' }, outputs: ['default/model/glb'], kernel: 'mesh',
    });
    expect(worker.runScript.mock.calls[0][1]).toEqual({ background: true });
    expect(viewer.renderModelThumbnail).toHaveBeenCalledTimes(2);
    expect(net.putBinary.mock.calls.map((c) => c[0])).toEqual([
      '/scripts/mark/b1/thumbnail?kind=backfill',
      '/scripts/mark/b2/versions/v9/thumbnail?kind=backfill',
    ]);
    expect(s1.thumbnail).toBe('/thumbnails/mark/b1/x.png');
    expect(stored).toEqual([
      { fileId: 'b1', url: '/thumbnails/mark/b1/x.png' },
      { fileId: 'b2', versionId: 'v9', url: '/thumbnails/mark/b2/x.png' },
    ]);
    expect(backfillPending()).toBe(0);
  });

  it('remembers scripts that draw nothing or that the server refuses, and never re-runs them', async () => {
    const { enqueueBackfill } = await import('../src/services/thumbnails.js');
    const { ApiError } = await import('../src/services/api.js');
    const nothing = { fileId: 'n1', script: { fileId: 'n1', code: 'const a = 1;' } as never };
    const refused = { fileId: 'n2', versionId: 'v1', script: { fileId: 'n2', code: 'box(1);' } as never };
    const flaky   = { fileId: 'n3', script: { fileId: 'n3', code: 'box(2);' } as never };

    viewer.renderModelThumbnail
      .mockResolvedValueOnce(null)   // n1 draws nothing
      .mockResolvedValue(PNG);
    net.putBinary
      .mockRejectedValueOnce(new ApiError(422, null))                        // n2 refused
      .mockRejectedValueOnce(new Error('network down'));                     // n3 transport

    enqueueBackfill([nothing, refused, flaky]);
    await settle(10_000);
    expect(worker.runScript).toHaveBeenCalledTimes(3);

    // Next visit: n1 and n2 are remembered; n3 gets another go.
    enqueueBackfill([nothing, refused, flaky]);
    await settle(10_000);
    expect(worker.runScript).toHaveBeenCalledTimes(4);
    expect(worker.runScript.mock.calls[3][0]).toMatchObject({ script: { fileId: 'n3' } });

    // …unless the code changed, which makes it a different picture to try for.
    enqueueBackfill([{ ...nothing, script: { fileId: 'n1', code: 'box(50);' } as never }]);
    await settle(10_000);
    expect(worker.runScript).toHaveBeenCalledTimes(5);

    // A run that fails is not rendered and is remembered too.
    worker.runScript.mockResolvedValueOnce(withGlb('error'));
    enqueueBackfill([{ fileId: 'n4', script: { fileId: 'n4', code: 'box(3);' } as never }]);
    await settle(10_000);
    expect(viewer.renderModelThumbnail).toHaveBeenCalledTimes(5);
  });
});
