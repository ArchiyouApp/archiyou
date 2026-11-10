/**
 * configurator-events.ts — what happened around one of the signed-in author's published
 * configurators: orders, adjustments and fulfillments handed over
 * (GET /scripts/configurators/:versionId/events, apps/server/src/services/EventStore.ts).
 * Shown in <configurator-events>, only to the author.
 */

import type { ConfiguratorEventFilter, ConfiguratorEventList } from '@archiyou/types';

import { api } from './api.js';

type Envelope<T> = { success: boolean; data: T; error?: string };

export interface ConfiguratorEventQuery
{
  /** This version only, or every version of the configurator. */
  scope?: 'version' | 'file';
  filter?: ConfiguratorEventFilter;
  /** The `next` of the previous page. */
  before?: string | null;
  limit?: number;
}

export async function listConfiguratorEvents(versionId: string, query: ConfiguratorEventQuery = {}): Promise<ConfiguratorEventList>
{
  const params = new URLSearchParams();
  if (query.scope) params.set('scope', query.scope);
  if (query.filter) params.set('filter', query.filter);
  if (query.before) params.set('before', query.before);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  const res = await api.get<Envelope<ConfiguratorEventList>>(`/scripts/configurators/${encodeURIComponent(versionId)}/events${qs ? `?${qs}` : ''}`);
  return res.data;
}
