/**
 * cloud-copies.test.ts — a script copies a sheet once (cloudcalc's cloudcopy()), and gets
 * the answer back as content for its next run.
 *
 * The secret manager (Drive) is a stub; the rules are real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const earlierCopies = vi.fn();
const copySheet = vi.fn();
const copyKeyName = vi.fn(() => 'urbuild');

vi.mock('../src/services/secret-manager', () => ({ secretManager: { earlierCopies, copySheet, copyKeyName } }));
vi.mock('../src/services/auth-service', () => ({ currentUser: { get: () => null } }));

const SHEET = 'OFFERTEMPLATE'.padEnd(44, 'x');
const OWN = { own: true };
/** An unsaved draft of the user's: their own. */
const DRAFT = { name: 'offer', code: '' };

/** The need a run stops with when it asks for a copy of SHEET with these values. */
function need(writes: unknown[][], options: Record<string, unknown> = {}, hash = writes.flat().join('').padStart(4, '0'))
{
  return {
    kind: 'google-sheet-copy' as const,
    id: `${SHEET}:${Number(hash).toString(16)}${options.force ? 'f' : ''}`,
    copy: { kind: 'google-sheet-copy' as const, id: SHEET, title: 'Offer', writes: [{ range: "'Sheet1'!A1", values: writes }], ...options },
  };
}

let copies = 0;
const cc = () => import('../src/services/cloud-copies');
beforeEach(async () =>
{
  (await cc()).forgetMadeCopies();
  earlierCopies.mockReset().mockResolvedValue([]);
  copySheet.mockReset().mockImplementation(async (_copy: any, _trust: any, _tag: any, title: string) =>
  {
    copies++;
    return { id: `COPY${copies}`, url: `https://docs.google.com/spreadsheets/d/COPY${copies}/edit`, title, keyName: 'urbuild', done: Promise.resolve(null) };
  });
});

/** The answer the next run gets for one need. */
const answer = async (n: ReturnType<typeof need>, script: Record<string, unknown> = DRAFT, trust = OWN) =>
  (await (await cc()).resolveCopies([n], script, trust))[`google-sheet-copy:${n.id}`]!;

describe('cloudcopy() in the editor', () =>
{
  it('makes the first copy, tagged with the script and inputs, and answers with its url', async () =>
  {
    const item = await answer(need([[120]]));
    expect(copySheet).toHaveBeenCalledTimes(1);
    const [copy, trust, tag] = copySheet.mock.calls[0]!;
    expect(copy).toMatchObject({ id: SHEET, title: 'Offer' });
    expect(trust).toEqual(OWN);
    expect(tag.script).toMatch(/^[0-9a-f]{64}$/);
    expect(tag.inputs).toMatch(/^[0-9a-f]{64}$/);
    expect(item).toMatchObject({ kind: 'google-sheet-copy', via: 'key', keyName: 'urbuild', bytes: expect.any(ArrayBuffer) });
    expect(item.copy).toMatchObject({ status: 'copied', url: expect.stringMatching(/COPY\d+\/edit/), messages: [expect.stringMatching(/copied to 'Offer'/)] });
  });

  it('hands the answer to the script\'s later runs: the copy, as existing, without saying it again', async () =>
  {
    const n = need([[120]]);
    await answer(n);
    const later = (await cc()).knownCopies(DRAFT)[`google-sheet-copy:${n.id}`]!;
    expect(later.copy).toMatchObject({ status: 'existing', url: expect.stringMatching(/COPY\d+\/edit/), messages: [] });
    expect((await cc()).knownCopies({ name: 'other script', code: '' })).toEqual({});
  });

  it('answers with the earlier copy for the same inputs, and makes none', async () =>
  {
    const first = await answer(need([[120]]));
    const item = await answer(need([[120]]));
    expect(copySheet).toHaveBeenCalledTimes(1);
    expect(item.copy).toMatchObject({ status: 'existing', url: first.copy!.url, messages: [] });
  });

  it('makes nothing for other inputs, and says how to get a copy anyway', async () =>
  {
    const first = await answer(need([[120]]));
    const item = await answer(need([[130]]));
    expect(copySheet).toHaveBeenCalledTimes(1);
    expect(item.copy).toMatchObject({ status: 'blocked', url: first.copy!.url, messages: [expect.stringMatching(/no copy made.*other inputs.*force: true.*delete the earlier copy/s)] });
  });

  it('finds earlier copies in Drive, and searches it once every few minutes per script and sheet', async () =>
  {
    earlierCopies.mockResolvedValue([{ id: 'C0', url: 'u', title: 'Offer', createdTime: '2026-10-09T08:00:00Z', inputs: 'other' }]);
    expect((await answer(need([[120]]))).copy).toMatchObject({ status: 'blocked', url: 'u' });
    expect((await answer(need([[130]]))).copy).toMatchObject({ status: 'blocked', url: 'u' });
    expect(earlierCopies).toHaveBeenCalledTimes(1);
  });

  it('names a copy the script did not name after the sheet, with the date and time', async () =>
  {
    const n = need([[120]]);
    delete (n.copy as any).title;
    (n.copy as any).sourceTitle = 'Offerte';
    const item = await answer(n);
    expect(copySheet.mock.calls[0]![3]).toMatch(/^Offerte_COPY_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
    expect(item.copy!.title).toBe(copySheet.mock.calls[0]![3]);
    expect((await cc()).defaultTitle('Offerte', new Date(2026, 9, 9, 11, 42, 5))).toBe('Offerte_COPY_2026-10-09_11-42-05');
  });

  it('answers once the copy exists, and says on the next run what went wrong after', async () =>
  {
    let finish!: (problem: string | null) => void;
    copySheet.mockImplementationOnce(async (_c: any, _t: any, _g: any, title: string) =>
      ({ id: 'COPY', url: 'https://docs.google.com/spreadsheets/d/COPY/edit', title, keyName: 'urbuild', done: new Promise((r) => { finish = r; }) }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const n = need([[120]]);
    expect((await answer(n)).copy!.status).toBe('copied');          // not waiting for the values to be written

    finish('The copy was made, but its inputs could not be written: no access');
    await new Promise((r) => setTimeout(r, 0));
    const next = (await cc()).knownCopies(DRAFT)[`google-sheet-copy:${n.id}`]!;
    expect(next.copy!.messages).toEqual(['workbook.cloudcopy(): The copy was made, but its inputs could not be written: no access']);
    expect((await cc()).knownCopies(DRAFT)[`google-sheet-copy:${n.id}`]!.copy!.messages).toEqual([]);   // said once
    warn.mockRestore();
  });

  it('copies other inputs with force — but the same inputs still only once', async () =>
  {
    await answer(need([[120]]));
    expect((await answer(need([[130]], { force: true }))).copy!.status).toBe('copied');
    expect((await answer(need([[130]], { force: true }))).copy!.status).toBe('existing');
    expect(copySheet).toHaveBeenCalledTimes(2);
  });

  it('copies once in a burst of runs, before Drive\'s search has caught up', async () =>
  {
    await Promise.all([answer(need([[120]])), answer(need([[120]])), answer(need([[130]]))]);
    expect(copySheet).toHaveBeenCalledTimes(1);
  });

  it('counts copies per script: another script copies the same sheet for itself', async () =>
  {
    await answer(need([[120]]));
    await answer(need([[130]]), { name: 'other offer', code: '' });
    expect(copySheet).toHaveBeenCalledTimes(2);
    expect(copySheet.mock.calls[0]![2].script).not.toBe(copySheet.mock.calls[1]![2].script);
  });

  it('answers someone else\'s script with why not, and hands that on to no later run', async () =>
  {
    earlierCopies.mockRejectedValue(new Error('your keys are only used for your own scripts.'));
    const theirs = { name: 'theirs', code: '', author: 'someone-else' };
    const item = await answer(need([[120]]), theirs, { own: false });
    expect(earlierCopies.mock.calls[0]![1]).toEqual({ own: false });
    expect(copySheet).not.toHaveBeenCalled();
    expect(item).toMatchObject({ via: 'public', copy: { status: 'failed', url: null, messages: [expect.stringMatching(/^workbook\.cloudcopy\(\): ERROR: .*your own scripts/)] } });
    expect((await cc()).knownCopies(theirs)).toEqual({});
  });

  it('tries again on the next run after a copy failed', async () =>
  {
    copySheet.mockRejectedValueOnce(new Error('no room'));
    expect((await answer(need([[120]]))).copy!.status).toBe('failed');
    expect((await answer(need([[120]]))).copy!.status).toBe('copied');
    expect(copySheet).toHaveBeenCalledTimes(2);
  });

  it('ignores what is not a copy need cloudcalc could have made', async () =>
  {
    const bad = { ...need([[1]]), id: 'not an id' };
    expect(await (await cc()).resolveCopies([bad, { kind: 'google-sheet', id: SHEET }], DRAFT, OWN)).toEqual({});
    expect(earlierCopies).not.toHaveBeenCalled();
  });
});
