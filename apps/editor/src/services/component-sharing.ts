/**
 * component-sharing — make a script's $component() dependencies readable to the
 * visitors of a published configurator.
 *
 * A published configurator ships only the parent script's own code. Its
 * `$component('./timberwall')` references resolve, in the editor, against the
 * author's workspace (Runner.linkComponentScripts) — but a visitor has no copy of
 * that workspace, so without help those components simply cannot be found and the
 * configurator renders nothing.
 *
 * The fix is to SHARE each referenced component at publish time. Sharing grants
 * read access through `/scripts/shared/{author}/{name}`, which is exactly what
 * Runner._getSharedComponentScript() fetches — and, unlike publishing, it does not
 * turn a component into a configurator of its own or list it among the author's
 * configurators.
 *
 * Deliberate choices:
 *   - Components are shared WITHOUT an `onlyUsers` restriction. A restricted share
 *     is 403 for anonymous callers, which would break the very configurator this
 *     exists to support.
 *   - An unchanged component is not re-shared. Sharing appends a version, so
 *     re-publishing a parent five times must not leave five identical versions.
 *     Sameness is compared on `code` — the only part a component contributes.
 *   - The whole dependency tree is walked, not just direct references: a component
 *     may use components of its own, and the visitor's Runner recurses too.
 */

import { Script } from '@archiyou/core/src/Script';
import { collectComponentDependencies } from '@archiyou/core/src/runner/componentRefs';
import type { CCLicence } from '@archiyou/core/src/ScriptSchema';

import { scripts, bumpScripts } from '../state/core.js';
import { fetchSharedScript, shareScript } from './sharing.js';
import { fetchFileVersions } from './scripts-sync.js';

/** What happened to one referenced component.
 *   shared        — a new shared version was appended just now
 *   already-shared— an identical version was already readable; nothing was added
 *   not-found     — the name matches no script in the workspace (a broken reference)
 *   failed        — the share request itself failed; the configurator will be broken */
export type ComponentShareAction = 'shared' | 'already-shared' | 'not-found' | 'failed';

export interface ComponentShareResult
{
  name: string;
  action: ComponentShareAction;
  version?: string;
  error?: string;
}

/** Parse "X.Y…" → [major, minor]; defaults to [0, 0] when unparseable. */
function parseMajorMinor(v: string | null | undefined): [number, number]
{
  const m = /^(\d+)\.(\d+)/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** The lowest "X.Y" above every version the file already used. Versions are unique
 *  per (fileId, version) server-side across BOTH libraries, so published versions
 *  count as taken too — `used` is expected to be the full list from the server. */
function nextFreeVersion(used: string[]): string
{
  if (!used.length) return '0.1';
  const [maj, min] = used
    .map(parseMajorMinor)
    .reduce((hi, v) => (v[0] > hi[0] || (v[0] === hi[0] && v[1] > hi[1]) ? v : hi), [0, 0] as [number, number]);
  return `${maj}.${min + 1}`;
}

/** Share every component the script depends on, so a published configurator can read
 *  them. Returns one result per referenced component, including the ones that were
 *  already shared and the ones that could not be resolved — the publish menu reports
 *  all of it to the author.
 *
 *  Never throws: a component that fails to share is reported as 'failed' rather than
 *  aborting the rest, so one bad dependency does not block the others. */
export async function shareReferencedComponents(
  root: Script,
  licence?: CCLicence,
): Promise<ComponentShareResult[]>
{
  const { found, missing } = collectComponentDependencies(root, scripts.get());

  const results: ComponentShareResult[] = missing.map(name => ({ name, action: 'not-found' as const }));

  for (const component of found)
  {
    results.push(await shareOne(component, licence));
  }

  // Newly shared components now carry a version + shared metadata; the script manager
  // renders that, so let it re-read.
  if (results.some(r => r.action === 'shared')) bumpScripts();

  return results;
}

/** Share one component if it is not already readable at its current code. */
async function shareOne(component: Script, licence?: CCLicence): Promise<ComponentShareResult>
{
  const name = component.name ?? '(unnamed)';
  // The share metadata is composed onto the live workspace Script (that is what
  // shareScript sends). Remember the previous state so a failed request does not leave
  // the author's script looking shared when it is not.
  const prevShared  = component.shared;
  const prevVersion = component.version;
  try
  {
    const author = component.author ?? undefined;

    // Already shared with exactly this code? Then the configurator can read it as-is
    // and appending another identical version would only add noise.
    if (author && component.name)
    {
      const latest = await fetchSharedScript(author, component.name);
      if (latest && latest.code === component.code && !latest.shared?.onlyUsers?.length)
      {
        return { name, action: 'already-shared', version: latest.version ?? undefined };
      }
    }

    const used = component.fileId ? await fetchFileVersions(component.fileId) : [];
    const version = nextFreeVersion(used);

    component.version = version;
    component.shared = {
      created:     new Date().toISOString(),
      description: component.description?.trim() || undefined,
      // No `onlyUsers`: a restricted share is 403 for the anonymous visitors of the
      // configurator this component exists to serve.
      licence:     licence ?? component.shared?.licence,
    };

    const stored = await shareScript(component);
    component.shared  = stored.shared ?? component.shared;
    component.version = stored.version ?? component.version;

    return { name, action: 'shared', version: stored.version ?? version };
  }
  catch (err)
  {
    component.shared  = prevShared;
    component.version = prevVersion;
    return { name, action: 'failed', error: (err as Error)?.message ?? String(err) };
  }
}
