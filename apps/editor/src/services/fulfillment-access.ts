/**
 * fulfillment-access.ts — a configurator visitor asks the server for a gated fulfillment
 * (POST /fulfillments, apps/server/src/routes/fulfillments.ts), and reports a free download
 * so the configurator's author sees it among its events.
 *
 * What a fulfillment asks for is its `access` (core's FULFILLMENT_ACCESS, read with
 * accessOf()): an address (email, clients: the server emails the files), a signed-in user
 * (signed-in, users) or a code (code). The last two only unlock the download; the browser
 * then makes the files as it does for anyone (services/fulfillment).
 */

import type { FulfillmentGrant } from '@archiyou/types';

import { api, ApiError } from './api.js';
import { buildConfiguratorRequest } from '../state/configurator.js';

type Envelope<T> = { success: boolean; data: T; error?: string };

export interface FulfillmentAsk
{
  email?: string | null;
  code?: string | null;
  /** The honeypot field people never see. */
  website?: string;
}

/** Ask for the fulfillment `name` of the configurator version `versionId`, with the values
 *  set in it now. Rejects with the server's message for the visitor (a wrong code, sign in
 *  first …). */
export async function requestFulfillment(versionId: string, name: string, ask: FulfillmentAsk = {}): Promise<FulfillmentGrant>
{
  const request = buildConfiguratorRequest([]);
  try
  {
    const res = await api.post<Envelope<FulfillmentGrant>>('/fulfillments', {
      versionId,
      fulfillment: name,
      values: request.params ?? {},
      unitSystem: request.unitSystem ?? null,
      email: ask.email ?? null,
      code: ask.code ?? null,
      website: ask.website ?? '',
    });
    return res.data;
  }
  catch (err)
  {
    throw new Error(refusalMessage(err));
  }
}

/** A free download happened. Fire and forget: counting it must never get in the way. */
export function reportDownload(versionId: string, name: string): void
{
  api.post<void>('/fulfillments/downloaded', { versionId, fulfillment: name }).catch(() => {});
}

function refusalMessage(err: unknown): string
{
  const body = (err as ApiError)?.body as { error?: string } | null;
  if (body?.error) return body.error;
  return (err as ApiError)?.status === 429 ? 'Too many requests. Please try again later.' : 'That did not work. Please try again.';
}
