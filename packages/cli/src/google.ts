/**
 *  Google Sheets with a service account: read a private sheet (its xlsx export, its formulas)
 *  and write to it. The key comes from the environment, never from an argument, and is never
 *  printed: GOOGLE_SERVICE_ACCOUNT, or CLOUDCALC_GOOGLE_CREDENTIALS as the server has it (the
 *  key's JSON, or the path of its file). Share the sheet with the account's e-mail address.
 */

import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'];
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

let cached: { token: string; until: number } | null = null;

/** The service account of the environment, or null when there is none */
export function serviceAccount(): ServiceAccount | null
{
    const raw = (process.env.GOOGLE_SERVICE_ACCOUNT ?? process.env.CLOUDCALC_GOOGLE_CREDENTIALS ?? '').trim().replace(/^'|'$/g, '');
    if (!raw) { return null; }
    const json = raw.startsWith('{') ? raw : (existsSync(raw) ? readFileSync(raw, 'utf8') : '');
    if (!json) { throw new Error('GOOGLE_SERVICE_ACCOUNT: neither the JSON of a key nor the path of its file'); }
    const account = JSON.parse(json);
    if (!account.client_email || !account.private_key) { throw new Error('GOOGLE_SERVICE_ACCOUNT: not a service account key'); }
    return account;
}

async function token(): Promise<string>
{
    if (cached && cached.until > Date.now() + 60_000) { return cached.token; }
    const account = serviceAccount();
    if (!account) { throw new Error('no service account: set GOOGLE_SERVICE_ACCOUNT (the key\'s JSON or its path)'); }
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
        iss: account.client_email, scope: SCOPES.join(' '), aud: account.token_uri ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
    const res = await fetch(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    if (!res.ok) { throw new Error(`Google sign-in of the service account failed: ${res.status}`); }
    const body: any = await res.json();
    cached = { token: body.access_token, until: Date.now() + body.expires_in * 1000 };
    return cached.token;
}

async function call(url: string, init: RequestInit = {}): Promise<any>
{
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await token()}`, 'content-type': 'application/json' } });
    if (!res.ok)
    {
        const text = await res.text();
        throw new Error(`Google Sheets ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.status === 204 ? null : res.json();
}

/** The id of a sheet from its URL (or the id itself) */
export function sheetId(urlOrId: string): string
{
    return urlOrId.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? urlOrId;
}

/** The sheet as xlsx, as the account sees it */
export async function exportXlsx(id: string): Promise<ArrayBuffer>
{
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`,
        { headers: { authorization: `Bearer ${await token()}` } });
    if (!res.ok) { throw new Error(`export of the sheet failed: ${res.status} (is it shared with the service account?)`); }
    return res.arrayBuffer();
}

/** Its tabs and named ranges */
export function spreadsheet(id: string): Promise<any>
{
    return call(`${SHEETS}/${id}?fields=${encodeURIComponent('sheets.properties,namedRanges')}`);
}

/** The cells of a range as entered: formulas as formulas */
export async function formulas(id: string, range: string): Promise<Array<Array<string>>>
{
    const body = await call(`${SHEETS}/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`);
    return (body.values ?? []).map((row: Array<any>) => row.map(v => (v === null || v === undefined) ? '' : String(v)));
}

/** Write cells as a user types them: formulas stay formulas */
export function writeValues(id: string, data: Array<{ range: string; values: Array<Array<string | number>> }>): Promise<any>
{
    return call(`${SHEETS}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
}

export function batchUpdate(id: string, requests: Array<any>): Promise<any>
{
    return requests.length ? call(`${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) }) : Promise.resolve(null);
}
