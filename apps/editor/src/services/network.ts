/**
 * network — one place where "the request never reached the server" becomes a
 * sentence a user can act on.
 *
 * `fetch()` rejects with a bare `TypeError: Failed to fetch` for every failure
 * that happens before a response exists: the API being down, DNS/offline, a
 * refused connection, or a blocked CORS preflight. The browser deliberately
 * hides which one it was, so the raw message is both meaningless to a user and
 * misleading to a developer (a CORS misconfiguration reads as "no internet").
 * Everything that talks to the API goes through `netFetch` so that case always
 * surfaces as NETWORK_ERROR_MESSAGE instead.
 *
 * Deliberately dependency-free (no api.ts, no core state) so it can sit under
 * auth-service, which is itself at the bottom of the graph.
 */

import { msg } from '@lit/localize';

/** Shown whenever the API could not be reached at all. */
export function networkErrorMessage(): string {
  return msg("Can't reach server. Please check it or your internet connection");
}

/** Marks an error as "never reached the server", for callers that branch on it. */
export class NetworkError extends Error {
  constructor(public override readonly cause?: unknown) {
    super(networkErrorMessage());
    this.name = 'NetworkError';
  }
}

/** `fetch`, with connection failures rethrown as a NetworkError. Response-level
 *  failures (4xx/5xx) are untouched — those are the caller's to interpret. */
export async function netFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    // AbortController cancellations are intentional, not connectivity problems.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError(err);
  }
}
