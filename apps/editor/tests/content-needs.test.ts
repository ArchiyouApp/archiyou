/**
 * content-needs.test.ts — which content a run needs, and whose script it is.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

class MemoryStorage
{
  private readonly _m = new Map<string, string>();
  getItem(k: string) { return this._m.has(k) ? this._m.get(k)! : null; }
  setItem(k: string, v: string) { this._m.set(k, String(v)); }
  removeItem(k: string) { this._m.delete(k); }
}

const ID = '1ZsDDzaanHUHVjc11_0yiaPpNezblnamEDMDr3KEzrNo';
const OTHER = '1tjYfGffEl46hx-0vt6LWizDjPIjUaVoOm23ZYgdiKWI';

beforeEach(() =>
{
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('scanContentNeeds', () =>
{
  it('finds sheet URLs anywhere and bare ids passed to open()', async () =>
  {
    const { scanContentNeeds } = await import('../src/services/content-needs');
    const code = `
      wb = cloudcalc.open('https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0')
      cc = $module('cloudcalc'); other = cc.open("${OTHER}", { key: 'urbuild' })
      again = cloudcalc.open('${ID}')
      wb.open('short')`;
    expect(scanContentNeeds(code).map((n) => n.id)).toEqual([ID, OTHER]);
  });
});

describe('isOwnScript', () =>
{
  it('is the signed-in author\'s script, or an unsaved draft nobody shared or published', async () =>
  {
    const { isOwnScript } = await import('../src/services/content-needs');
    const { currentUser } = await import('../src/services/auth-service');

    currentUser.set(null);
    expect(isOwnScript({})).toBe(true);
    expect(isOwnScript({ author: 'u1' })).toBe(false);
    expect(isOwnScript({ shared: { by: 'x' } as any })).toBe(false);

    currentUser.set({ id: 'u1' } as any);
    expect(isOwnScript({ author: 'u1' })).toBe(true);
    expect(isOwnScript({ author: 'u2' })).toBe(false);
    expect(isOwnScript({ published: { public: true } as any })).toBe(false);
  });
});

describe('knownNeeds / rememberNeeds', () =>
{
  it('remembers what a script needed, with the key it named, for its next run', async () =>
  {
    const { knownNeeds, rememberNeeds } = await import('../src/services/content-needs');
    const script = { fileId: 'f1', code: `cloudcalc.open('${ID}')` };

    expect(knownNeeds(script)).toEqual([{ kind: 'google-sheet', id: ID, reason: 'open' }]);
    rememberNeeds(script, [{ kind: 'google-sheet', id: ID, key: 'urbuild', reason: 'open' }, { kind: 'google-sheet', id: OTHER, reason: 'import' }]);
    expect(knownNeeds(script)).toEqual([
      { kind: 'google-sheet', id: ID, key: 'urbuild' },
      { kind: 'google-sheet', id: OTHER },
    ]);
    expect(knownNeeds({ fileId: 'f2', code: '' })).toEqual([]);
  });
});
