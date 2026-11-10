/**
 * fulfillmentAccess — whether a configurator visitor may get a fulfillment (its `access`,
 * see FULFILLMENT_ACCESS in core's ScriptSchema). Shared by POST /fulfillments and
 * POST /orders, so a product and a download are gated the same way.
 *
 * The author always gets their own fulfillments when they are signed in (to try them out),
 * except the emailed ones: those need an address like anyone's.
 */

import { accessOf } from '@archiyou/core/src/execution/fulfillment';
import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';

import { accessCodeMatches } from './ScriptStore';
import { projectStore } from './ProjectStore';

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccessRequest
{
  /** The signed-in caller's handle, or null. */
  caller: string | null;
  email?: string | null;
  code?: string | null;
}

/** Who got past the access rule: what the events and the email name them by. */
export interface AccessWho
{
  email?: string;
  user?: string;
  client?: string | null;
}

/** Why not:
 *    email       no valid address given (access email or clients)
 *    sign-in     a signed-in user is needed
 *    not-listed  signed in, but not one of the listed users
 *    code        no code, or the wrong one
 *    not-client  the address is not one of the author's clients */
export type AccessRefusal = 'email' | 'sign-in' | 'not-listed' | 'code' | 'not-client';

export type AccessResult = { ok: true; who: AccessWho } | { ok: false; refusal: AccessRefusal };

export async function checkFulfillmentAccess(
  author: string,
  fulfillment: ScriptPublishedFulfillmentData,
  request: AccessRequest,
): Promise<AccessResult>
{
  const access = accessOf(fulfillment);
  const caller = request.caller?.toLowerCase() ?? null;
  const own = !!caller && caller === author.toLowerCase();
  const email = request.email?.trim().toLowerCase() ?? '';

  switch (access)
  {
    case 'anyone':
      return { ok: true, who: {} };
    case 'email':
      return EMAIL.test(email) ? { ok: true, who: { email } } : { ok: false, refusal: 'email' };
    case 'clients':
    {
      if (!EMAIL.test(email)) return { ok: false, refusal: 'email' };
      const client = await projectStore.listedClient(author.toLowerCase(), email);
      return client ? { ok: true, who: { email, client: client.name } } : { ok: false, refusal: 'not-client' };
    }
    case 'signed-in':
      return caller ? { ok: true, who: { user: caller } } : { ok: false, refusal: 'sign-in' };
    case 'users':
      if (!caller) return { ok: false, refusal: 'sign-in' };
      return own || (fulfillment.users ?? []).some((u) => u.toLowerCase() === caller)
        ? { ok: true, who: { user: caller } }
        : { ok: false, refusal: 'not-listed' };
    case 'code':
      if (own) return { ok: true, who: { user: caller! } };
      return request.code?.trim() && accessCodeMatches(request.code, fulfillment.codeHash)
        ? { ok: true, who: caller ? { user: caller } : {} }
        : { ok: false, refusal: 'code' };
  }
}

/** What a refused visitor reads. Never more than they need: a wrong code is "not the
 *  right code", not whether the fulfillment has one. */
export const REFUSAL_MESSAGES: Record<AccessRefusal, { status: number; error: string }> = {
  'email':      { status: 422, error: 'Please give a valid email address' },
  'sign-in':    { status: 401, error: 'Sign in to get this' },
  'not-listed': { status: 403, error: 'This is not available for your account' },
  'code':       { status: 403, error: 'That is not the right code' },
  'not-client': { status: 403, error: 'This is only available to clients' },
};
