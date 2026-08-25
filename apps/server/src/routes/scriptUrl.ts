/**
 * scriptUrl.ts — library URL helpers: parse the segment `{scriptName}:{version?}`
 * and build the public configurator URL. Shared by the library GET routes, the
 * /execute route and the ScriptStore.
 */

import { config } from '../config';

export function parseScriptAndVersion(segment: string): { scriptName: string; version?: string } {
  const match = segment.match(/^([^/:]+)(?::(.+))?$/);
  if (!match) return { scriptName: segment };
  const [, scriptName, version] = match;
  return { scriptName, version: version || undefined };
}

/** Public URL where a published configurator is served, on the CURRENT frontend
 *  origin (FRONTEND_URL). Derived from author/name/version rather than read back
 *  from storage: the stored value is stamped at publish time, so a row published
 *  against another environment (or before FRONTEND_URL was set) would otherwise
 *  hand out a dead `http://localhost:5173/…` link forever. */
export function configuratorUrl(author: string, name: string, version: string): string {
  return `${config.frontendUrl}/configurators/${author}/${name}:${version}`;
}
