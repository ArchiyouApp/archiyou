/**
 * secret-manager.test.ts — the user's keys, and the protected content they unlock.
 *
 * Google is a fetch stub here; everything else is real, including the WebCrypto
 * signing of the service account's JWT (with a key pair made for the test).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/** Web Storage for a Node test: what a browser has on window. */
class MemoryStorage implements Storage
{
  private readonly _m = new Map<string, string>();
  get length() { return this._m.size; }
  clear() { this._m.clear(); }
  getItem(k: string) { return this._m.has(k) ? this._m.get(k)! : null; }
  key(i: number) { return [...this._m.keys()][i] ?? null; }
  removeItem(k: string) { this._m.delete(k); }
  setItem(k: string, v: string) { this._m.set(k, String(v)); }
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PUBLIC = 'PUBLICSHEET'.padEnd(44, 'x');
const PRIVATE = 'PRIVATESHEET'.padEnd(44, 'x');
const NOT_SHARED = 'NOTSHARED'.padEnd(44, 'x');
const EMAIL = 'sheets@example-project.iam.gserviceaccount.com';

let serviceAccountJson: string;
const calls: string[] = [];
/** Bodies POSTed, by URL. */
const posted: Record<string, any> = {};
/** How the copy endpoint answers: like Drive does, or refusing for lack of storage. */
let copyAnswer: 'ok' | 'quota' = 'ok';
const COPY = 'THECOPY'.padEnd(44, 'x');
const FOLDER = 'TEMPLATEFOLDER'.padEnd(33, 'x');
const TAG = { script: 'a'.repeat(64), inputs: 'b'.repeat(64) };
/** What a Drive search for earlier copies finds. */
let earlierFiles: unknown[] = [];
/** Folders Drive has, by `<parent>/<name>`. */
let folders: Record<string, string> = {};

/** Google, as far as the manager talks to it. */
async function google(input: string | URL, init?: RequestInit) : Promise<Response>
{
  const url = String(input);
  calls.push(url);
  if (init?.method === 'POST' && init.body && !url.includes('oauth2')) posted[url] = JSON.parse(String(init.body));
  const bytes = (s: string) => new TextEncoder().encode(s);
  if (url.startsWith(`https://docs.google.com/spreadsheets/d/${PUBLIC}/export`))
  {
    return new Response(bytes('public-xlsx'), { status: 200, headers: { 'content-type': XLSX_TYPE } });
  }
  if (url.startsWith('https://docs.google.com/spreadsheets/d/'))
  {
    return new Response('<html>sign in</html>', { status: 401, headers: { 'content-type': 'text/html' } });
  }
  if (url === 'https://oauth2.googleapis.com/token')
  {
    const assertion = new URLSearchParams(String(init?.body)).get('assertion') ?? '';
    const claims = JSON.parse(atob(assertion.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims).toMatchObject({ iss: EMAIL });
    // The read token is all a run gets; the write token only exists for a copy.
    const write = claims.scope === 'https://www.googleapis.com/auth/drive';
    expect([write, claims.scope === 'https://www.googleapis.com/auth/drive.readonly']).toContain(true);
    return Response.json({ access_token: write ? 'tok-write' : 'tok-1', expires_in: 3599 });
  }
  if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${PRIVATE}?`))
  {
    expect(new Headers(init?.headers).get('authorization')).toMatch(/^Bearer tok-/);
    return Response.json({ name: 'Prices', modifiedTime: '2026-10-08T10:00:00Z', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [FOLDER] });
  }
  if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${PRIVATE}/copy?`))
  {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok-write');
    if (copyAnswer === 'quota')
    {
      return Response.json({ error: { code: 403, message: 'The user\'s Drive storage quota has been exceeded.', errors: [{ reason: 'storageQuotaExceeded' }] } }, { status: 403 });
    }
    return Response.json({ id: COPY, name: posted[url].name, webViewLink: `https://docs.google.com/spreadsheets/d/${COPY}/edit?usp=drivesdk` });
  }
  if (url === `https://sheets.googleapis.com/v4/spreadsheets/${COPY}/values:batchUpdate`)
  {
    return Response.json({ totalUpdatedCells: 4 });
  }
  if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${COPY}/permissions?`))
  {
    return Response.json({ id: 'anyoneWithLink' });
  }
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && init?.method === 'POST')
  {
    const { name, parents, mimeType } = posted[url];
    expect(mimeType).toBe('application/vnd.google-apps.folder');
    folders[`${parents[0]}/${name}`] = `MADE_${name}`;
    return Response.json({ id: `MADE_${name}` });
  }
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?'))
  {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok-write');
    const q = new URL(url).searchParams.get('q') ?? '';
    const folder = q.match(/^name = '(.+)' and '(.+)' in parents and mimeType = 'application\/vnd\.google-apps\.folder'/);
    if (folder) return Response.json({ files: folders[`${folder[2]}/${folder[1]}`] ? [{ id: folders[`${folder[2]}/${folder[1]}`] }] : [] });
    return Response.json({ files: earlierFiles });
  }
  if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${PRIVATE}/export`))
  {
    return new Response(bytes('private-xlsx'), { status: 200, headers: { 'content-type': XLSX_TYPE } });
  }
  if (url.startsWith('https://www.googleapis.com/drive/v3/files/'))
  {
    return Response.json({ error: { code: 404 } }, { status: 404 });
  }
  throw new Error(`unexpected request to ${url}`);
}

beforeAll(async () =>
{
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`;
  serviceAccountJson = JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: pem, private_key_id: 'k1', token_uri: 'https://oauth2.googleapis.com/token' });
});

beforeEach(() =>
{
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('fetch', vi.fn(google));
  calls.length = 0;
  Object.keys(posted).forEach((k) => delete posted[k]);
  copyAnswer = 'ok';
  earlierFiles = [];
  folders = {};
});

const fresh = async () => new (await import('../src/services/secret-manager')).ClientSecretManager();
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

describe('keys', () =>
{
  it('stores a service account after Google accepted it, and never shows its value again', async () =>
  {
    const sm = await fresh();
    const info = await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });

    expect(calls).toContain('https://oauth2.googleapis.com/token');
    expect(info).toMatchObject({ name: 'urbuild', account: EMAIL, hint: EMAIL, isDefault: true, storage: 'local' });
    expect(localStorage.getItem('archiyou:keys:urbuild')).toBe(serviceAccountJson);
    expect(JSON.stringify(sm.list())).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(sm.keys.get())).not.toContain('PRIVATE KEY');
    expect(localStorage.getItem('archiyou:keys')).not.toContain('PRIVATE KEY');
  });

  it('refuses what is not a service account key, with a message that says what is', async () =>
  {
    const sm = await fresh();
    await expect(sm.put({ name: 'x', kind: 'google-service-account', value: 'not json' })).rejects.toThrow(/not JSON/);
    await expect(sm.put({ name: 'x', kind: 'google-service-account', value: '{"type":"user"}' })).rejects.toThrow(/not a service account key/);
    await expect(sm.put({ name: 'Bad Name', kind: 'ai', provider: 'anthropic', value: 'sk-1' })).rejects.toThrow(/lowercase/);
    expect(sm.list()).toEqual([]);
  });

  it('keeps a session key in sessionStorage only, and forgets a removed one', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'claude', kind: 'ai', provider: 'anthropic', value: 'sk-ant-1234', storage: 'session' });
    expect(sessionStorage.getItem('archiyou:keys:claude')).toBe('sk-ant-1234');
    expect(localStorage.getItem('archiyou:keys:claude')).toBeNull();
    expect(sm.aiKey('anthropic')).toBe('sk-ant-1234');
    expect(sm.list()[0]).toMatchObject({ hint: '····1234', hosts: ['api.anthropic.com'] });

    sm.remove('claude');
    expect(sm.aiKey('anthropic')).toBeNull();
    expect(sessionStorage.getItem('archiyou:keys:claude')).toBeNull();
  });

  it('has one default per kind', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'a', kind: 'google-service-account', value: serviceAccountJson });
    await sm.put({ name: 'b', kind: 'google-service-account', value: serviceAccountJson });
    expect(sm.list().filter((k) => k.isDefault).map((k) => k.name)).toEqual(['a']);
    sm.setDefault('b');
    expect(sm.list().filter((k) => k.isDefault).map((k) => k.name)).toEqual(['b']);
  });
});

describe('content', () =>
{
  it('fetches a public sheet anonymously, in any run — no key, no token', async () =>
  {
    const sm = await fresh();
    const { content, problems } = await sm.resolve([{ kind: 'google-sheet', id: PUBLIC }], { own: false });
    expect(problems).toEqual([]);
    expect(content[`google-sheet:${PUBLIC}`]).toMatchObject({ via: 'public', id: PUBLIC });
    expect(text(content[`google-sheet:${PUBLIC}`]!.bytes)).toBe('public-xlsx');
    expect(calls.some((c) => c.includes('oauth2'))).toBe(false);
  });

  it('fetches a private sheet with the default key, for the user\'s own script', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    const { content, problems } = await sm.resolve([{ kind: 'google-sheet', id: PRIVATE }], { own: true });
    expect(problems).toEqual([]);
    const item = content[`google-sheet:${PRIVATE}`]!;
    expect(item).toMatchObject({ via: 'key', keyName: 'urbuild', title: 'Prices' });
    expect(item.version).toMatch(/^2026-10-08T10:00:00Z\|/);
    expect(text(item.bytes)).toBe('private-xlsx');
  });

  it('never uses the user\'s keys for someone else\'s script', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    calls.length = 0;
    const { content, problems } = await sm.resolve([{ kind: 'google-sheet', id: PRIVATE }], { own: false });
    expect(content).toEqual({});
    expect(problems[0]).toMatchObject({ code: 'foreign_script_refused' });
    expect(calls.some((c) => c.includes('googleapis.com'))).toBe(false);
  });

  it('says what to do when there is no key, an unknown key, or the sheet is not shared with it', async () =>
  {
    const sm = await fresh();
    const none = await sm.resolve([{ kind: 'google-sheet', id: PRIVATE }], { own: true });
    expect(none.problems[0]).toMatchObject({ code: 'no_key' });
    expect(none.problems[0]!.message).toMatch(/Add a Google service account under Keys/);

    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    const unknown = await sm.resolve([{ kind: 'google-sheet', id: PRIVATE, key: 'other' }], { own: true });
    expect(unknown.problems[0]).toMatchObject({ code: 'unknown_key' });

    const notShared = await sm.resolve([{ kind: 'google-sheet', id: NOT_SHARED }], { own: true });
    expect(notShared.problems[0]).toMatchObject({ code: 'not_shared_with_key' });
    expect(notShared.problems[0]!.message).toContain(EMAIL);
  });

  it('serves a public sheet from memory within a minute', async () =>
  {
    const sm = await fresh();
    await sm.resolve([{ kind: 'google-sheet', id: PUBLIC }], { own: true });
    await sm.resolve([{ kind: 'google-sheet', id: PUBLIC }], { own: true });
    expect(calls.filter((c) => c.includes(PUBLIC))).toHaveLength(1);
    expect(sm.activity.get().map((u) => u.outcome)).toEqual(['cached', 'used']);
  });
});

describe('a broken key file', () =>
{
  it('says the private key is not valid, not what the browser thought of it', async () =>
  {
    const sm = await fresh();
    const broken = JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: 'dummy' });
    await expect(sm.put({ name: 'x', kind: 'google-service-account', value: broken })).rejects.toThrow(/private_key in this file is not a valid key/);
  });
});

describe('copies', () =>
{
  const offer = (over: Record<string, unknown> = {}) => ({
    kind: 'google-sheet-copy' as const,
    id: PRIVATE,
    title: 'Offer 42',
    writes: [{ range: "'Sheet1'!A1", values: [[120]] }, { range: "'Sheet1'!A2:A3", values: [['=IMPORTXML(1)'], [2]] }],
    ...over,
  });

  it('copies next to the sheet with a write token, tags the copy, and writes the values as values — after it answered', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    calls.length = 0;
    const copy = await sm.copySheet(offer(), { own: true }, TAG, 'Offer 42');

    expect(copy).toMatchObject({ id: COPY, url: `https://docs.google.com/spreadsheets/d/${COPY}/edit?usp=drivesdk`, title: 'Offer 42', keyName: 'urbuild' });
    // Next to the sheet is Drive's own default for a copy: no parents, no lookup of the sheet's folder.
    expect(posted[`https://www.googleapis.com/drive/v3/files/${PRIVATE}/copy?supportsAllDrives=true&fields=id,name,webViewLink`]).toEqual({
      name: 'Offer 42',
      appProperties: { archiyouTemplate: PRIVATE, archiyouScript: TAG.script, archiyouInputs: TAG.inputs },
    });
    expect(calls.some((c) => c.startsWith(`https://www.googleapis.com/drive/v3/files/${PRIVATE}?`))).toBe(false);
    expect(await copy.done).toBeNull();
    expect(posted[`https://sheets.googleapis.com/v4/spreadsheets/${COPY}/values:batchUpdate`])
      .toEqual({ valueInputOption: 'RAW', data: offer().writes });
    // Not shared unless the script asked.
    expect(calls.some((c) => c.includes('/permissions'))).toBe(false);
    expect(sm.activity.get()[0]).toMatchObject({ id: PRIVATE, keyName: 'urbuild', outcome: 'copied' });
  });

  it('shares a copy with anyone who has the link only when asked', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    await (await sm.copySheet(offer({ share: 'reader' }), { own: true }, TAG, 'Offer 42')).done;
    expect(posted[`https://www.googleapis.com/drive/v3/files/${COPY}/permissions?supportsAllDrives=true`]).toEqual({ type: 'anyone', role: 'reader' });
  });

  it('copies into a folder given by URL as is, and finds a relative one once per session — making what is missing', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    const copyUrl = `https://www.googleapis.com/drive/v3/files/${PRIVATE}/copy?supportsAllDrives=true&fields=id,name,webViewLink`;

    calls.length = 0;
    await sm.copySheet(offer({ folder: 'https://drive.google.com/drive/folders/OFFERSFOLDERxxxxxxxxxxxxxx' }), { own: true }, TAG, 'Offer 42');
    expect(posted[copyUrl].parents).toEqual(['OFFERSFOLDERxxxxxxxxxxxxxx']);
    expect(calls.filter((c) => c.startsWith('https://www.googleapis.com/drive/v3/files?'))).toHaveLength(0);

    folders[`${FOLDER}/Offers`] = 'OFFERS';
    calls.length = 0;
    await sm.copySheet(offer({ folder: 'Offers/2026' }), { own: true }, TAG, 'Offer 42');
    expect(posted[copyUrl].parents).toEqual(['MADE_2026']);
    expect(folders['OFFERS/2026']).toBe('MADE_2026');
    const lookups = calls.filter((c) => !c.includes('/copy?') && !c.includes('sheets.googleapis') && !c.includes('oauth2'));
    expect(lookups).toHaveLength(4);   // the sheet's folder, 'Offers', '2026', and making '2026'

    calls.length = 0;
    await sm.copySheet(offer({ folder: 'Offers/2026' }), { own: true }, TAG, 'Offer 43');
    expect(calls.filter((c) => !c.includes('/copy?') && !c.includes('sheets.googleapis') && !c.includes('oauth2'))).toHaveLength(0);
  });

  it('finds the earlier copies of a sheet by their tag, deleted ones left out', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    earlierFiles = [{ id: 'C1', name: 'Offer 41', webViewLink: 'https://docs.google.com/spreadsheets/d/C1/edit', createdTime: '2026-10-09T08:00:00Z', appProperties: { archiyouInputs: TAG.inputs } }];
    expect(await sm.earlierCopies(offer(), { own: true }, TAG.script)).toEqual([
      { id: 'C1', url: 'https://docs.google.com/spreadsheets/d/C1/edit', title: 'Offer 41', createdTime: '2026-10-09T08:00:00Z', inputs: TAG.inputs },
    ]);
    const search = new URL(calls.find((c) => c.startsWith('https://www.googleapis.com/drive/v3/files?'))!);
    expect(search.searchParams.get('q')).toBe(
      `appProperties has { key='archiyouTemplate' and value='${PRIVATE}' } and appProperties has { key='archiyouScript' and value='${TAG.script}' } and trashed = false`);
    expect(search.searchParams.get('corpora')).toBe('allDrives');
  });

  it('never copies for someone else\'s script, and never acts on a malformed offer', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    calls.length = 0;
    await expect(sm.copySheet(offer(), { own: false }, TAG)).rejects.toThrow(/not yours/);
    await expect(sm.earlierCopies(offer(), { own: false }, TAG.script)).rejects.toThrow(/not yours/);
    await expect(sm.copySheet(offer({ id: '../../evil' }), { own: true }, TAG)).rejects.toThrow(/described it wrongly/);
    await expect(sm.copySheet(offer({ share: 'anyone' }), { own: true }, TAG)).rejects.toThrow(/described it wrongly/);
    await expect(sm.copySheet(offer({ force: 'yes' }), { own: true }, TAG)).rejects.toThrow(/described it wrongly/);
    await expect(sm.earlierCopies(offer(), { own: true }, "x' or name contains '")).rejects.toThrow(/SHA-256/);
    expect(calls).toEqual([]);
  });

  it('says what to do when Drive has no room for a service account\'s copy', async () =>
  {
    const sm = await fresh();
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    copyAnswer = 'quota';
    await expect(sm.copySheet(offer(), { own: true }, TAG, 'Offer 42')).rejects.toThrow(new RegExp(`shared drive ${EMAIL} is a member of`));
  });

  it('asks for a key when there is none', async () =>
  {
    const sm = await fresh();
    await expect(sm.copySheet(offer(), { own: true }, TAG, 'Offer 42')).rejects.toThrow(/Can't make a copy without access\. Please set a Google service account key/);
    await sm.put({ name: 'urbuild', kind: 'google-service-account', value: serviceAccountJson });
    await expect(sm.copySheet(offer({ key: 'other' }), { own: true }, TAG)).rejects.toThrow(/no Google service account by that name/);
  });
});
