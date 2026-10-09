/**
 * secret-manager — the user's keys, and the protected content they unlock.
 *
 * The editor's half of plans/PROTECTED_CONTENT.md. Two rules carry the design:
 *
 *  - Keys never enter the script worker. Scripts run there, our own and other people's
 *    (a published configurator runs in the same worker), and nothing in the worker is
 *    private from the code running in it. So keys live HERE, on the main thread, in
 *    storage a worker cannot reach (Web Storage exists on Window only). A script names
 *    a key at most — `cloudcalc.open(url, { key: 'urbuild' })` — and never sees one.
 *  - Protected content enters a run only when its owner drives the code. A user's key
 *    fetches content for the user's OWN scripts; for anyone else's script it fetches
 *    nothing, however the script asks (resolve(), `own`). The same holds for the one
 *    write a run can ask for, a copy of a sheet (copySheet(), see cloud-copies.ts).
 *
 * A script runs synchronously and cannot wait for the editor mid-run, so content is
 * fetched BEFORE the run and travels with the request (request.content). The worker
 * gets bytes, never a credential. See execution-service.ts for the run loop.
 *
 * What this is not: a vault. A key in localStorage is as exposed to an XSS on this
 * origin as the session token already is (SECURITY.md); the UI says so. The controls
 * that bound the damage are the user's: a dedicated service account shared as Viewer,
 * session-only storage on shared machines, and Replace.
 */
import { signal } from '@lit-labs/signals';

import type { AyContentItem, AyContentNeed, AyGoogleSheetCopy } from '@archiyou/core/src/modules/sdkTypes';

//// KEYS ////

export type KeyKind = 'google-service-account' | 'ai' | 'api-key';

/** AI providers a key can be for, with the one host each may be sent to. */
export const AI_PROVIDERS: Record<string, { label: string; hosts: string[] }> = {
  anthropic: { label: 'Anthropic', hosts: ['api.anthropic.com'] },
  openai: { label: 'OpenAI', hosts: ['api.openai.com'] },
  openrouter: { label: 'OpenRouter', hosts: ['openrouter.ai'] },
  google: { label: 'Google AI', hosts: ['generativelanguage.googleapis.com'] },
};

/** Where a Google service account's key may be sent: Google's token endpoint and APIs. */
const GOOGLE_HOSTS = ['oauth2.googleapis.com', 'www.googleapis.com', 'sheets.googleapis.com'];

/** What the editor knows about a key without reading its value. Safe to show. */
export interface KeyInfo
{
  /** What a script may say: a slug. */
  name: string;
  label: string;
  kind: KeyKind;
  /** For an AI key: which provider. */
  provider?: string;
  /** The only hosts the key is ever sent to. */
  hosts: string[];
  /** Last four characters — or, for a service account, its email (not secret). */
  hint: string;
  /** A service account's `client_email`: the address to share sheets with. */
  account?: string;
  /** The Google key used when a script names none. */
  isDefault?: boolean;
  /** 'session': forgotten when the tab closes. */
  storage: 'local' | 'session';
  createdAt: string;
}

export interface PutKeyInput
{
  name: string;
  label?: string;
  kind: KeyKind;
  value: string;
  provider?: string;
  /** For 'api-key': where it may be sent. */
  hosts?: string[];
  isDefault?: boolean;
  storage?: 'local' | 'session';
}

/** Thrown for anything wrong with a key, with a message meant for the user. */
export class KeyError extends Error
{
  constructor(message: string)
  {
    super(message);
    this.name = 'KeyError';
  }
}

const INDEX = 'archiyou:keys';
const VALUE = (name: string) : string => `archiyou:keys:${name}`;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

interface ServiceAccountKey
{
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
}

//// CONTENT ////

/** Whose script a run is, as the editor knows it (never as the worker claims it). */
export interface RunTrust
{
  /** The signed-in user's own script (or an unsaved draft). Only then are keys used. */
  own: boolean;
}

/** Why a need could not be met — each with a message that says what to do. */
export type ContentProblemCode = 'no_key' | 'unknown_key' | 'not_shared_with_key' | 'foreign_script_refused' | 'failed';

export interface ContentProblem
{
  id: string;
  code: ContentProblemCode;
  message: string;
}

/** One use of the manager — what the Keys menu's activity list shows. Never a value. */
export interface ContentUse
{
  at: string;
  id: string;
  via: 'public' | 'key' | null;
  keyName?: string;
  outcome: 'used' | 'cached' | 'copied' | ContentProblemCode;
}

/** A copy copySheet() made. */
export interface SheetCopy
{
  id: string;
  url: string;
  title: string;
  keyName: string;
  /** The copy exists, but something after it did not work out — what, and what to do. */
  warning?: string;
}

/** Which script made a copy, and with which values: opaque hashes (cloud-copies.ts), kept
 *  on the copy as private app properties — only the key's own project can read them. */
export interface CopyTag
{
  script: string;
  inputs: string;
  /** The Archiyou link (`…/go/<key>`) the script was given for this copy before it existed;
   *  earlier copies answer with it, so a script keeps handing out the same url. */
  link?: string;
}

/** A copy found in Drive, made earlier from the same script and sheet. */
export interface EarlierCopy
{
  id: string;
  url: string;
  title: string;
  createdTime: string;
  /** CopyTag.inputs it was made with. */
  inputs: string;
}

/** An Archiyou link as a copy's tag may carry it. Drive allows 124 bytes per app property. */
const LINK = /^https?:\/\/[^\s/]{1,60}\/go\/[1-9A-HJ-NP-Za-km-z]{10}$/;

interface CachedContent
{
  item: AyContentItem;
  checkedAt: number;
}

/** Public sheets have no cheap "has it changed" check: fetch again after this. */
const PUBLIC_TTL_MS = 60_000;
/** A keyed sheet is checked against Drive's modifiedTime at most this often. */
const KEYED_RECHECK_MS = 15_000;
const ACTIVITY_MAX = 200;

/** Reading is all a run needs. */
const SCOPE_READ = 'https://www.googleapis.com/auth/drive.readonly';
/** A copy writes: asked for only when the user makes one. */
const SCOPE_WRITE = 'https://www.googleapis.com/auth/drive';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';

class ClientSecretManager
{
  /** The keys, metadata only — for the UI. */
  readonly keys = signal<KeyInfo[]>([]);
  /** Recent uses — for the UI. */
  readonly activity = signal<ContentUse[]>([]);

  private readonly _tokens = new Map<string, { token: string; expiresAt: number }>();
  /** Folder ids copies go into, by `<key>|<parent>|<name>` (and `<key>|parent|<sheet>`): for the session. */
  private readonly _folders = new Map<string, Promise<string>>();
  private readonly _content = new Map<string, CachedContent>();

  constructor()
  {
    this.keys.set(this._readIndex());
  }

  //// KEYS — what the menu calls ////

  /** Every key, metadata only. */
  list() : KeyInfo[]
  {
    return this.keys.get();
  }

  /** Add or replace a key. Validates per kind; a service account must also be able to
   *  get a token from Google — a wrong key fails here, not in the middle of a run. */
  async put(input: PutKeyInput) : Promise<KeyInfo>
  {
    const name = input.name.trim();
    if (!NAME_RE.test(name))
    {
      throw new KeyError('A name is lowercase letters, digits, - and _, starting with a letter or digit — it is what a script types.');
    }
    const value = input.value.trim();
    if (!value) throw new KeyError('Paste the key.');

    const base = { name, kind: input.kind, storage: input.storage ?? 'local', createdAt: new Date().toISOString() } as const;
    let info: KeyInfo;
    if (input.kind === 'google-service-account')
    {
      const sa = parseServiceAccount(value);
      info = { ...base, label: input.label?.trim() || 'Google service account', hosts: GOOGLE_HOSTS, hint: sa.client_email, account: sa.client_email };
      await this._exchange(name, sa, SCOPE_READ); // proves the key works; caches the token
    }
    else if (input.kind === 'ai')
    {
      const provider = AI_PROVIDERS[input.provider ?? ''];
      if (!provider) throw new KeyError(`Choose a provider: ${Object.values(AI_PROVIDERS).map((p) => p.label).join(', ')}.`);
      info = { ...base, provider: input.provider, label: input.label?.trim() || provider.label, hosts: provider.hosts, hint: `····${value.slice(-4)}` };
    }
    else
    {
      const hosts = (input.hosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
      if (!hosts.length) throw new KeyError('Say which host this key may be sent to, e.g. api.supplier.example.');
      info = { ...base, label: input.label?.trim() || name, hosts, hint: `····${value.slice(-4)}` };
    }

    // A replaced key keeps its default flag unless told otherwise; the first Google key
    // becomes the default.
    const others = this.list().filter((k) => k.name !== name);
    const previous = this.list().find((k) => k.name === name);
    const firstGoogle = info.kind === 'google-service-account' && !others.some((k) => k.kind === 'google-service-account');
    info.isDefault = input.isDefault ?? previous?.isDefault ?? firstGoogle;
    const next = [...others.map((k) => (info.isDefault && k.kind === info.kind ? { ...k, isDefault: false } : k)), info];

    this._removeValue(name);
    this._store(info.storage).setItem(VALUE(name), value);
    this._writeIndex(next);
    this._content.clear(); // what this key could read may have changed
    return info;
  }

  /** Forget a key, its cached token and the content it fetched. */
  remove(name: string) : void
  {
    this._removeValue(name);
    [...this._tokens.keys()].filter((t) => t.startsWith(`${name} `)).forEach((t) => this._tokens.delete(t));
    [...this._content.entries()].filter(([, c]) => c.item.keyName === name).forEach(([k]) => this._content.delete(k));
    this._writeIndex(this.list().filter((k) => k.name !== name));
  }

  /** Make a Google key the one used when a script names none. */
  setDefault(name: string) : void
  {
    const key = this.list().find((k) => k.name === name);
    if (!key) return;
    this._writeIndex(this.list().map((k) => (k.kind === key.kind ? { ...k, isDefault: k.name === name } : k)));
  }

  /** An AI provider's key, read on demand — for the AI assist (plans/CO_AI.md), never a signal. */
  aiKey(provider: string) : string | null
  {
    const key = this.list().find((k) => k.kind === 'ai' && k.provider === provider);
    return key ? this._value(key) : null;
  }

  //// CONTENT — the only way protected bytes reach a run ////

  /**
   * Fetch what a run needs. Public sheets anonymously, in any run; private ones with
   * one of the user's keys, in the user's own runs only. Never throws: what cannot be
   * fetched comes back as a problem that says what to do about it.
   */
  async resolve(needs: AyContentNeed[], trust: RunTrust) : Promise<{ content: Record<string, AyContentItem>; problems: ContentProblem[] }>
  {
    const unique = [...new Map(needs.filter((n) => n.kind === 'google-sheet').map((n) => [n.id, n])).values()];
    const outcomes = await Promise.all(unique.map((need) => this._resolveSheet(need, trust)));
    const content = Object.fromEntries(outcomes.flatMap((o) => (o.item ? [[`google-sheet:${o.item.id}`, o.item]] : [])));
    const problems = outcomes.flatMap((o) => (o.problem ? [o.problem] : []));
    return { content, problems };
  }

  /** Drop every fetched sheet, so the next run fetches again. */
  forgetContent() : void
  {
    this._content.clear();
  }

  private async _resolveSheet(need: AyContentNeed, trust: RunTrust) : Promise<{ item?: AyContentItem; problem?: ContentProblem }>
  {
    const problem = (code: ContentProblemCode, message: string, keyName?: string) =>
    {
      this._log({ id: need.id, via: null, keyName, outcome: code });
      return { problem: { id: need.id, code, message } };
    };

    try
    {
      // 1. Anonymously: a public sheet is public for everyone, in every run.
      const cachedPublic = this._content.get(`${need.id}|public`);
      if (cachedPublic && Date.now() - cachedPublic.checkedAt < PUBLIC_TTL_MS)
      {
        this._log({ id: need.id, via: 'public', outcome: 'cached' });
        return { item: cachedPublic.item };
      }
      const pub = await this._fetchPublic(need.id);
      if (pub)
      {
        this._content.set(`${need.id}|public`, { item: pub, checkedAt: Date.now() });
        this._log({ id: need.id, via: 'public', outcome: 'used' });
        return { item: pub };
      }

      // 2. Private: only for the user's own script, with one of the user's keys.
      if (!trust.own)
      {
        return problem('foreign_script_refused',
          `The Google Sheet ${need.id} is private, and this script is not yours: your keys are only used for your own scripts.`);
      }
      const key = this._googleKey(need.key);
      if (need.key && !key)
      {
        return problem('unknown_key', `The script asks for the key '${need.key}', and there is no Google service account by that name under Keys.`, need.key);
      }
      if (!key)
      {
        return problem('no_key',
          `The Google Sheet ${need.id} is private. Add a Google service account under Keys (main menu) and share the sheet with it as Viewer — ` +
          `or share the sheet as "Anyone with the link can view".`);
      }
      const item = await this._fetchWithKey(need.id, key);
      if (!item)
      {
        return problem('not_shared_with_key',
          `The key '${key.name}' cannot read the Google Sheet ${need.id}. Share the sheet with ${key.account} as Viewer.`, key.name);
      }
      return { item };
    }
    catch (e)
    {
      return problem('failed', `Could not fetch the Google Sheet ${need.id}: ${(e as Error)?.message ?? e}`);
    }
  }

  /** The public xlsx export, or null when the sheet is not public. */
  private async _fetchPublic(id: string) : Promise<AyContentItem | null>
  {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=xlsx`, { credentials: 'omit' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('spreadsheetml')) return null;
    const bytes = await res.arrayBuffer();
    return { kind: 'google-sheet', id, bytes, version: await digest(bytes), via: 'public' };
  }

  /** The xlsx through the Drive API with a service account, or null when it cannot read it. */
  private async _fetchWithKey(id: string, key: KeyInfo) : Promise<AyContentItem | null>
  {
    const cacheKey = `${id}|key:${key.name}`;
    const cached = this._content.get(cacheKey);
    if (cached && Date.now() - cached.checkedAt < KEYED_RECHECK_MS)
    {
      this._log({ id, via: 'key', keyName: key.name, outcome: 'cached' });
      return cached.item;
    }

    const token = await this._token(key, SCOPE_READ);
    const drive = DRIVE;
    const meta = await this._send(key, `${drive}/${encodeURIComponent(id)}?fields=name,modifiedTime,mimeType&supportsAllDrives=true`, token);
    if (meta.status === 403 || meta.status === 404) return null;
    if (!meta.ok) throw new Error(`Google Drive answered ${meta.status}`);
    const file = await meta.json() as { name?: string; modifiedTime?: string; mimeType?: string };

    if (cached && cached.item.version.startsWith(`${file.modifiedTime}|`))
    {
      this._content.set(cacheKey, { item: cached.item, checkedAt: Date.now() });
      this._log({ id, via: 'key', keyName: key.name, outcome: 'cached' });
      return cached.item;
    }

    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const res = file.mimeType === 'application/vnd.google-apps.spreadsheet'
      ? await this._send(key, `${drive}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(xlsx)}&supportsAllDrives=true`, token)
      : await this._send(key, `${drive}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, token);
    if (!res.ok) throw new Error(`Google Drive answered ${res.status}${res.status === 403 ? ' (an export is limited to 10 MB)' : ''}`);
    const bytes = await res.arrayBuffer();
    const item: AyContentItem = {
      kind: 'google-sheet', id, bytes, via: 'key', keyName: key.name,
      version: `${file.modifiedTime}|${await digest(bytes)}`,
      ...(file.name ? { title: file.name } : {}),
    };
    this._content.set(cacheKey, { item, checkedAt: Date.now() });
    this._log({ id, via: 'key', keyName: key.name, outcome: 'used' });
    return item;
  }

  //// COPIES — the one write a run can ask for (cloudcalc's cloudcopy()) ////

  /**
   * The copies of this sheet the script made before, as Drive has them — found by the tag
   * copySheet() puts on each. A copy that was deleted (trashed) no longer counts. For the
   * user's own script only.
   */
  async earlierCopies(action: AyGoogleSheetCopy, trust: RunTrust, script: string) : Promise<EarlierCopy[]>
  {
    const key = this._copyKey(action, trust);
    checkTag({ script, inputs: script });
    const token = await this._token(key, SCOPE_WRITE);
    const q = [
      `appProperties has { key='archiyouTemplate' and value='${action.id}' }`,
      `appProperties has { key='archiyouScript' and value='${script}' }`,
      'trashed = false',
    ].join(' and ');
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,webViewLink,createdTime,appProperties)',
      orderBy: 'createdTime desc',
      pageSize: '100',
      corpora: 'allDrives',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });
    const res = await this._send(key, `${DRIVE}?${params}`, token);
    if (!res.ok) throw new KeyError(`Could not look for earlier copies in Google Drive: ${await googleMessage(res)}`);
    const body = await res.json() as { files?: Array<{ id: string; name?: string; webViewLink?: string; createdTime?: string; appProperties?: Record<string, string> }> };
    return (body.files ?? []).map((f) => ({
      id: f.id,
      url: (LINK.test(f.appProperties?.archiyouLink ?? '') ? f.appProperties!.archiyouLink! : null)
        ?? f.webViewLink ?? `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
      title: f.name ?? '',
      createdTime: f.createdTime ?? '',
      inputs: f.appProperties?.archiyouInputs ?? '',
    }));
  }

  /**
   * Make the copy a run asked for: copy the sheet in Drive with one of the user's keys,
   * next to it (or into `folder`), tagged (CopyTag). Whether to make it at all is
   * cloud-copies.ts's call. For the user's own script only, like every use of a key.
   *
   * Drive is slow, so this waits for the one call the script needs — files.copy, which
   * gives the copy's id and so its url — and writes the values and shares the copy in the
   * background: `done` resolves when that is over, to what went wrong (or null). It never
   * rejects. Throws a KeyError that says what to do when there is no copy.
   */
  async copySheet(copy: AyGoogleSheetCopy, trust: RunTrust, tag: CopyTag, title: string) : Promise<SheetCopy & { done: Promise<string | null> }>
  {
    const key = this._copyKey(copy, trust);
    checkTag(tag);
    const token = await this._token(key, SCOPE_WRITE);
    const folder = copy.folder ? await this._copyFolder(key, token, copy.id, copy.folder) : undefined;
    // Without parents, Drive puts a copy next to the original: no need to look its folder up.
    const copied = await this._send(key, `${DRIVE}/${encodeURIComponent(copy.id)}/copy?supportsAllDrives=true&fields=id,name,webViewLink`, token, {
      method: 'POST',
      json: {
        name: title,
        ...(folder ? { parents: [folder] } : {}),
        appProperties: { archiyouTemplate: copy.id, archiyouScript: tag.script, archiyouInputs: tag.inputs, ...(tag.link ? { archiyouLink: tag.link } : {}) },
      },
    });
    if (!copied.ok) throw await explainCopyFailure(copied, key, copy);
    const made = await copied.json() as { id: string; name?: string; webViewLink?: string };
    this._log({ id: copy.id, via: 'key', keyName: key.name, outcome: 'copied' });

    const done = (async () : Promise<string | null> =>
    {
      // Values, never formulas: RAW keeps a text that starts with '=' a text.
      if (copy.writes.length)
      {
        const res = await this._send(key, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(made.id)}/values:batchUpdate`, token, {
          method: 'POST',
          json: { valueInputOption: 'RAW', data: copy.writes },
        });
        if (!res.ok) return `The copy was made, but its inputs could not be written: ${await googleMessage(res)}`;
      }
      if (copy.share)
      {
        const res = await this._send(key, `${DRIVE}/${encodeURIComponent(made.id)}/permissions?supportsAllDrives=true`, token, {
          method: 'POST',
          json: { type: 'anyone', role: copy.share },
        });
        if (!res.ok) return `The copy was made, but not shared with anyone who has the link: ${await googleMessage(res)}`;
      }
      return null;
    })().catch((e) => `The copy was made, but finishing it failed: ${(e as Error)?.message ?? e}`);

    return {
      id: made.id,
      url: made.webViewLink ?? `https://docs.google.com/spreadsheets/d/${made.id}/edit`,
      title: made.name ?? title,
      keyName: key.name,
      done,
    };
  }

  /**
   * The id of the folder a copy goes into: from a folder's URL or id as is, or from a path
   * relative to the sheet's folder, looked up (and made when missing) one name at a time.
   * Lookups are kept for the session: Drive is slow, and folders rarely move.
   */
  private async _copyFolder(key: KeyInfo, token: string, sheet: string, folder: string) : Promise<string>
  {
    const direct = folder.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? (/^[A-Za-z0-9_-]{25,}$/.test(folder) ? folder : null);
    if (direct) return direct;

    const cached = (k: string, find: () => Promise<string>) : Promise<string> =>
    {
      const hit = this._folders.get(k);
      if (hit) return hit;
      const found = find();
      this._folders.set(k, found);
      found.catch(() => this._folders.delete(k));
      return found;
    };
    const parentOf = cached(`${key.name}|parent|${sheet}`, async () =>
    {
      const res = await this._send(key, `${DRIVE}/${encodeURIComponent(sheet)}?fields=parents&supportsAllDrives=true`, token);
      if (!res.ok) throw new KeyError(`The key '${key.name}' cannot see the Google Sheet ${sheet}: share it with ${key.account}. (${await googleMessage(res)})`);
      const parent = ((await res.json()) as { parents?: string[] }).parents?.[0];
      if (!parent) throw new KeyError(`The Google Sheet ${sheet} is in no folder ${key.account} can see, so '${folder}' cannot be found next to it. Pass a folder's URL instead.`);
      return parent;
    });

    return folder.split('/').map((p) => p.trim()).reduce((parent, name) => parent.then((id) => cached(`${key.name}|${id}|${name}`, async () =>
    {
      const q = `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${id}' in parents and mimeType = '${FOLDER}' and trashed = false`;
      const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', corpora: 'allDrives', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' });
      const res = await this._send(key, `${DRIVE}?${params}`, token);
      if (!res.ok) throw new KeyError(`Could not look for the folder '${name}' in Google Drive: ${await googleMessage(res)}`);
      const found = ((await res.json()) as { files?: Array<{ id: string }> }).files?.[0]?.id;
      if (found) return found;
      const made = await this._send(key, `${DRIVE}?supportsAllDrives=true&fields=id`, token, { method: 'POST', json: { name, mimeType: FOLDER, parents: [id] } });
      if (!made.ok) throw new KeyError(`Could not make the folder '${name}' in Google Drive: ${await googleMessage(made)}`);
      return ((await made.json()) as { id: string }).id;
    })), parentOf);
  }

  /** Throws the KeyError copySheet() would throw before it asks Drive anything: not the
   *  user's script, or no key to copy with. */
  checkCopy(copy: AyGoogleSheetCopy, trust: RunTrust) : void
  {
    this._copyKey(copy, trust);
  }

  /** The name of the key a copy is made with — a name, never a value — or null when there is none. */
  copyKeyName(copy: AyGoogleSheetCopy) : string | null
  {
    return this._googleKey(copy.key)?.name ?? null;
  }

  //// GOOGLE SERVICE ACCOUNTS ////

  /** The key a copy is made with, after the checks every copy gets. */
  private _copyKey(action: AyGoogleSheetCopy, trust: RunTrust) : KeyInfo
  {
    if (!trust.own)
    {
      throw new KeyError('This copy would be made with your key, and this script is not yours: your keys are only used for your own scripts.');
    }
    checkCopyAction(action);
    const key = this._googleKey(action.key);
    if (!key)
    {
      throw new KeyError(action.key
        ? `The script asks for the key '${action.key}', and there is no Google service account by that name under Keys.`
        : "Can't make a copy without access. Please set a Google service account key (Keys, in the main menu)!");
    }
    return key;
  }

  /** The Google key a script names, or the default one when it names none. */
  private _googleKey(name?: string) : KeyInfo | null
  {
    const google = this.list().filter((k) => k.kind === 'google-service-account');
    if (name) return google.find((k) => k.name === name) ?? null;
    return google.find((k) => k.isDefault) ?? google[0] ?? null;
  }

  /** A cached access token for `scope`, or a fresh one. */
  private async _token(key: KeyInfo, scope: string) : Promise<string>
  {
    const cached = this._tokens.get(`${key.name} ${scope}`);
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
    const value = this._value(key);
    if (!value) throw new KeyError(`The key '${key.name}' is gone from this browser — add it again under Keys.`);
    return this._exchange(key.name, parseServiceAccount(value), scope);
  }

  /**
   * A service account's access token: a JWT signed with its private key (WebCrypto,
   * RS256), exchanged at Google's token endpoint. A self-signed JWT is not accepted by
   * the Drive export, so the exchange is needed (tested 2026-10-08).
   */
  private async _exchange(name: string, sa: ServiceAccountKey, scope: string) : Promise<string>
  {
    const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
    if (new URL(tokenUri).hostname !== 'oauth2.googleapis.com') throw new KeyError('This key names a token endpoint other than Google\'s.');

    const now = Math.floor(Date.now() / 1000);
    const assertion = await signJwt(sa, {
      iss: sa.client_email, sub: sa.client_email, aud: tokenUri,
      scope, iat: now, exp: now + 3600,
    });
    const res = await fetch(tokenUri, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !body.access_token)
    {
      throw new KeyError(`Google did not accept this key: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}. ` +
        `Check that it is a current key of an enabled service account.`);
    }
    this._tokens.set(`${name} ${scope}`, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  /** fetch(), refusing any host the key is not pinned to. */
  private _send(key: KeyInfo, url: string, token: string, init: { method?: 'POST'; json?: unknown } = {}) : Promise<Response>
  {
    const host = new URL(url).hostname;
    if (!key.hosts.includes(host)) throw new KeyError(`The key '${key.name}' may only be sent to ${key.hosts.join(', ')}.`);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      credentials: 'omit',
      method: init.method ?? 'GET',
      headers,
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
  }

  //// STORAGE ////

  private _store(kind: 'local' | 'session') : Storage
  {
    return kind === 'session' ? sessionStorage : localStorage;
  }

  private _value(key: KeyInfo) : string | null
  {
    try { return this._store(key.storage).getItem(VALUE(key.name)); }
    catch { return null; }
  }

  private _removeValue(name: string) : void
  {
    try { localStorage.removeItem(VALUE(name)); sessionStorage.removeItem(VALUE(name)); }
    catch { /* storage unavailable */ }
  }

  private _readIndex() : KeyInfo[]
  {
    const read = (storage: () => Storage) : KeyInfo[] =>
    {
      try { return JSON.parse(storage().getItem(INDEX) ?? '[]') as KeyInfo[]; }
      catch { return []; } // no storage at all (private mode, a non-browser host)
    };
    // A session key's index lives with it, in sessionStorage: both go when the tab does.
    const all = [...read(() => localStorage), ...read(() => sessionStorage)];
    return all.filter((k) => this._value(k) !== null);
  }

  private _writeIndex(keys: KeyInfo[]) : void
  {
    try
    {
      localStorage.setItem(INDEX, JSON.stringify(keys.filter((k) => k.storage === 'local')));
      sessionStorage.setItem(INDEX, JSON.stringify(keys.filter((k) => k.storage === 'session')));
    }
    catch { /* storage unavailable */ }
    this.keys.set(keys);
  }

  private _log(use: Omit<ContentUse, 'at'>) : void
  {
    this.activity.set([{ at: new Date().toISOString(), ...use }, ...this.activity.get()].slice(0, ACTIVITY_MAX));
  }
}

//// HELPERS ////

const DRIVE_ID = /^[A-Za-z0-9_-]{10,80}$/;

/** A copy action comes from the worker: check its shape before a key acts on it. */
function checkCopyAction(a: AyGoogleSheetCopy) : void
{
  const ok = a?.kind === 'google-sheet-copy'
    && DRIVE_ID.test(a.id ?? '')
    && (a.title === undefined || (typeof a.title === 'string' && a.title.length > 0 && a.title.length <= 200))
    && (a.sourceTitle === undefined || (typeof a.sourceTitle === 'string' && a.sourceTitle.length <= 200))
    && (a.folder === undefined || (typeof a.folder === 'string' && a.folder.length > 0 && a.folder.length <= 300))
    && (a.share === undefined || a.share === 'reader' || a.share === 'writer')
    && (a.force === undefined || typeof a.force === 'boolean')
    && Array.isArray(a.writes) && a.writes.length <= 500
    && a.writes.every((w) => typeof w?.range === 'string' && w.range.length <= 200 && Array.isArray(w.values) && w.values.every(Array.isArray));
  if (!ok) throw new KeyError('This copy is not one the editor can make: the module described it wrongly.');
}

/** A tag goes into a Drive query: hashes only. */
function checkTag(tag: CopyTag) : void
{
  if (!/^[0-9a-f]{64}$/.test(tag.script) || !/^[0-9a-f]{64}$/.test(tag.inputs)) throw new KeyError('A copy tag is a pair of SHA-256 hashes.');
  if (tag.link !== undefined && !LINK.test(tag.link)) throw new KeyError(`Not an Archiyou link: ${tag.link}`);
}

/** Google's own words for a failed request. */
async function googleMessage(res: Response) : Promise<string>
{
  const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `HTTP ${res.status}`;
}

/** Why Drive refused a copy, in terms of what the user can change. */
async function explainCopyFailure(res: Response, key: KeyInfo, copy: AyGoogleSheetCopy) : Promise<KeyError>
{
  const body = await res.json().catch(() => null) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null;
  const message = body?.error?.message ?? `HTTP ${res.status}`;
  const reasons = (body?.error?.errors ?? []).map((e) => e.reason);
  const where = copy.folder ? `the folder '${copy.folder}'` : 'the sheet\'s folder';
  if (reasons.includes('storageQuotaExceeded') || /quota/i.test(message))
  {
    return new KeyError(
      `A service account has no Drive storage of its own, so the copy has to go into a shared drive. ` +
      `Keep the sheet in a shared drive ${key.account} is a member of (Content manager): the copy goes next to it. (${message})`);
  }
  if (res.status === 404)
  {
    return new KeyError(`${key.account} cannot see the Google Sheet ${copy.id} or ${where}: share the sheet with it, and add it to the shared drive as Content manager. (${message})`);
  }
  if (res.status === 403)
  {
    return new KeyError(`${key.account} may not add files to ${where}. Make it Content manager of the shared drive. (${message})`);
  }
  return new KeyError(`Google Drive could not make the copy: ${message}`);
}

function parseServiceAccount(value: string) : ServiceAccountKey
{
  let parsed: any;
  try { parsed = JSON.parse(value); }
  catch { throw new KeyError('This is not JSON. Paste the whole key file Google Cloud gave you (it starts with {).'); }
  if (parsed?.type !== 'service_account' || typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string')
  {
    throw new KeyError('This is not a service account key: it needs "type": "service_account", a client_email and a private_key.');
  }
  return parsed as ServiceAccountKey;
}

const b64url = (bytes: Uint8Array) : string =>
  btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function signJwt(sa: ServiceAccountKey, claims: Record<string, unknown>) : Promise<string>
{
  let key: CryptoKey;
  try
  {
    const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
    key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  catch
  {
    throw new KeyError('The private_key in this file is not a valid key. Paste the key file exactly as Google Cloud gave it.');
  }
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

/** A short content hash: the version of a sheet whose bytes are all we have. */
async function digest(bytes: ArrayBuffer) : Promise<string>
{
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export { ClientSecretManager };
export const secretManager = new ClientSecretManager();
