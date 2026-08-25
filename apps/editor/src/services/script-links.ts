/**
 * script-links — shareable editor URLs for scripts.
 *
 *   /editor/{name}                    my own script, latest (the working copy)
 *   /editor/{name}:latest             same
 *   /editor/{name}:0.4                my own script, released version 0.4
 *   /editor/{author}/{name}           someone else's script, latest release
 *   /editor/{author}/{name}:0.4       …a specific release
 *
 * Every segment is URI-encoded; the `{name}:{version}` form mirrors the segment
 * grammar the backend already uses for `/scripts/{kind}/{user}/{name}:{version}`
 * (see apps/server/src/routes/scriptUrl.ts), so links read the same everywhere.
 *
 * Resolution order:
 *   - own script, latest  → the local collection (the editable working copy);
 *     on a miss, pull the user's scripts once and retry, then fall back to the
 *     library (another browser may hold the only working copy).
 *   - anything versioned or foreign → the shared library first, then the
 *     published one. Both are gated server-side: a share restricted with
 *     `onlyUsers` answers 403 for everyone else, which surfaces as 'forbidden'.
 *
 * Opening a foreign script goes through openSharedScript(), so it lands
 * read-only with the usual Fork affordance (see state/core.ts editorMode).
 */

import type { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';

import { api, ApiError } from './api.js';
import { authService, authReady } from './auth-service.js';
import { pullUserScripts } from './scripts-sync.js';
import { scripts, openScript, openSharedScript } from '../state/core.js';

/** A parsed `{name}[:{version}]` URL segment. `version` is undefined for "latest". */
export interface ScriptRef {
  name: string;
  version?: string;
}

export type ScriptLinkResult =
  | { ok: true; script: Script }
  | { ok: false; reason: 'invalid' | 'not-found' | 'forbidden' | 'error'; message: string };

/** Parse a `{name}[:{version}]` segment (already URI-decoded by the router).
 *  ":latest" is normalized away — no version means latest. */
export function parseScriptAndVersion(segment: string): ScriptRef | null {
  const match = /^([^/:]+)(?::(.+))?$/.exec((segment ?? '').trim());
  if (!match) return null;
  const version = match[2]?.trim();
  return {
    name: match[1].trim().toLowerCase(),
    version: !version || version.toLowerCase() === 'latest' ? undefined : version,
  };
}

/** Build the `{name}[:{version}]` segment of a link. */
function scriptSegment(name: string, version?: string | null): string {
  return version
    ? `${encodeURIComponent(name)}:${encodeURIComponent(version)}`
    : encodeURIComponent(name);
}

/** The canonical editor URL for a script, or '/editor' when it has no name.
 *  Own scripts link to their working copy (no version); a foreign script keeps
 *  the author + the exact version being viewed. */
export function editorPathFor(script: Script | null): string {
  const name = script?.name;
  if (!script || !name) return '/editor';

  const me = authService.getUser()?.id ?? null;
  const author = script.author ?? null;
  // Anyone but me (including "me" being nobody — anonymous) keeps the author in
  // the URL, so the link still resolves when it is passed on.
  const foreign = !!author && author !== me;

  return foreign
    ? `/editor/${encodeURIComponent(author)}/${scriptSegment(name, script.version)}`
    : `/editor/${scriptSegment(name)}`;
}

/** The newest local script with this name (names are unique per collection in
 *  practice, but "untitled" duplicates happen — newest `updated` wins). */
function findLocal(name: string): Script | null {
  const matches = scripts.get().filter(s => (s.name ?? '').toLowerCase() === name);
  if (matches.length === 0) return null;
  return matches.reduce((newest, s) => (s.updated.getTime() > newest.updated.getTime() ? s : newest));
}

type LibraryKind = 'shared' | 'published';
type LibraryFetch =
  | { ok: true; data: ScriptData }
  | { ok: false; status: number };

/** GET one script from a library. Status codes are kept: 404 = no such script,
 *  403 = shared but not with this caller. */
async function fetchFromLibrary(kind: LibraryKind, author: string, ref: ScriptRef): Promise<LibraryFetch> {
  const path = `/scripts/${kind}/${encodeURIComponent(author)}/${scriptSegment(ref.name, ref.version)}`;
  try {
    const res = await api.get<{ success: boolean; data?: ScriptData }>(path);
    return res.data ? { ok: true, data: res.data } : { ok: false, status: 404 };
  } catch (err) {
    return { ok: false, status: err instanceof ApiError ? err.status : 0 };
  }
}

/** Human-readable "author/name:version" for messages. */
function describe(author: string | null, ref: ScriptRef): string {
  const named = ref.version ? `${ref.name}:${ref.version}` : ref.name;
  return author ? `${author}/${named}` : named;
}

/** Try the shared library, then the published one. `label` is how the script is
 *  named back to the user (own scripts are addressed without an author). */
async function openFromLibrary(author: string, ref: ScriptRef, label: string): Promise<ScriptLinkResult> {
  const shared = await fetchFromLibrary('shared', author, ref);
  const sharedStatus = shared.ok ? null : shared.status;
  const found = shared.ok ? shared : await fetchFromLibrary('published', author, ref);

  if (!found.ok) {
    // A 403 from the shared library is the more informative answer: the script
    // exists but this caller is not on its `onlyUsers` list.
    const status = sharedStatus === 403 ? 403 : found.status;
    if (status === 403) {
      return {
        ok: false,
        reason: 'forbidden',
        message: `“${label}” is shared with specific people only — ask ${author} for access, or sign in with the account it was shared with.`,
      };
    }
    if (status === 404) {
      return {
        ok: false,
        reason: 'not-found',
        message: `“${label}” was not found in the shared or published library.`,
      };
    }
    return {
      ok: false,
      reason: 'error',
      message: `Could not load “${label}” — the server did not respond.`,
    };
  }

  const script = openSharedScript(found.data as unknown as Record<string, any>);
  return script
    ? { ok: true, script }
    : { ok: false, reason: 'error', message: `“${label}” could not be loaded (invalid script data).` };
}

/**
 * Resolve an editor deep link and make the script active.
 *
 * @param author            the `{author}` segment, or null for one of my own scripts
 * @param scriptAndVersion  the `{name}[:{version}]` segment
 */
export async function resolveScriptLink(author: string | null, scriptAndVersion: string): Promise<ScriptLinkResult> {
  const ref = parseScriptAndVersion(scriptAndVersion);
  if (!ref) {
    return { ok: false, reason: 'invalid', message: `“${scriptAndVersion}” is not a valid script link.` };
  }

  // The handle is needed to address my own scripts in the library; on a cold
  // load the session restore may still be in flight.
  await authReady.catch(() => null);
  const me = authService.getUser()?.id ?? null;

  if (author) return openFromLibrary(author.toLowerCase(), ref, describe(author, ref));

  // ── My own script ──
  if (!ref.version) {
    const local = findLocal(ref.name);
    if (local) {
      const opened = openScript(local.fileId);
      if (opened) return { ok: true, script: opened };
    }
    // Not in this browser yet — the server may have it (signed in on another device).
    if (me) {
      await pullUserScripts();
      const pulled = findLocal(ref.name);
      if (pulled) {
        const opened = openScript(pulled.fileId);
        if (opened) return { ok: true, script: opened };
      }
    }
  }

  if (!me) {
    return {
      ok: false,
      reason: 'not-found',
      message: `No script named “${describe(null, ref)}” in this browser. Sign in to open your own scripts, or use /editor/{author}/${scriptAndVersion} for someone else's.`,
    };
  }

  return openFromLibrary(me, ref, describe(null, ref));
}
