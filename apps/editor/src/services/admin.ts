/**
 * admin — client for the operator surface (/admin/*, server: routes/admin.ts).
 *
 * Every call here 403s for a non-operator; `userState.isAdmin` only decides whether
 * the UI bothers offering them. The server re-reads users.is_admin on every request,
 * so a revoked grant takes effect immediately.
 *
 * The one power on offer is `validated`, which clears a published version to run
 * server-side, unsandboxed — so the list carries each version's `code` and
 * fetchConfigurator() exists for reading it before you flip the switch.
 */

import type { ScriptData } from '@archiyou/core/src/execution/types';

import { api } from './api.js';

interface Envelope<T> { success: boolean; error?: string; data?: T }
interface ListEnvelope extends Envelope<AdminConfigurator[]> { total: number; limit: number; offset: number }

/** One published configurator with its published versions (server: ScriptStore.PublishedConfigurator). */
export interface AdminConfigurator
{
  fileId: string;
  author: string;
  /** The name of the newest version. */
  name: string;
  /** ISO time of the most recently updated version. */
  updated: string;
  /** Newest version first. */
  versions: ScriptData[];
}

export interface AdminConfiguratorFilter
{
  author?: string;
  /** undefined ⇒ both. */
  validated?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AdminConfiguratorPage
{
  configurators: AdminConfigurator[];
  total: number;
  limit: number;
  offset: number;
}

/** Every published configurator across all authors, most recently updated first, paged by
 *  configurator. Versions without a version number are left out. */
export async function fetchAdminConfigurators(filter: AdminConfiguratorFilter = {}): Promise<AdminConfiguratorPage>
{
  const query = new URLSearchParams();
  if (filter.author) query.set('author', filter.author);
  // Deliberately only sent when set: absent means "either", and sending
  // `validated=undefined` would reach the server as the string "undefined" and 400.
  if (filter.validated !== undefined) query.set('validated', String(filter.validated));
  if (filter.q) query.set('q', filter.q);
  if (filter.limit !== undefined) query.set('limit', String(filter.limit));
  if (filter.offset !== undefined) query.set('offset', String(filter.offset));

  const qs = query.toString();
  const res = await api.get<ListEnvelope>(`/admin/configurators${qs ? `?${qs}` : ''}`);
  return { configurators: res.data ?? [], total: res.total ?? 0, limit: res.limit ?? 0, offset: res.offset ?? 0 };
}

/** One published version in full, code included — what you read before validating. */
export async function fetchAdminConfigurator(versionId: string): Promise<ScriptData | null>
{
  const res = await api.get<Envelope<ScriptData>>(`/admin/configurators/${encodeURIComponent(versionId)}`);
  return res.data ?? null;
}

/** Turn server-side execution on or off for one published version. */
export async function setConfiguratorValidated(versionId: string, validated: boolean): Promise<ScriptData>
{
  const res = await api.put<Envelope<ScriptData>>(
    `/admin/configurators/${encodeURIComponent(versionId)}/validated`,
    { validated },
  );
  if (!res.data) throw new Error('The server did not return the updated configurator.');
  return res.data;
}

//// FEEDBACK ////

/** Visitor feedback from a configurator (server: FeedbackStore.FeedbackData). */
export interface AdminFeedback
{
  id: string;
  message: string;
  scriptId: string | null;
  fileId: string | null;
  scriptAuthor: string | null;
  scriptName: string | null;
  scriptVersion: string | null;
  /** The configurator page it was sent from, params included. */
  url: string | null;
  /** Handle of the sender when they were signed in. */
  username: string | null;
  starred: boolean;
  created: string;
}

export type AdminFeedbackSort = 'newest' | 'oldest' | 'starred' | 'script';

export interface AdminFeedbackFilter
{
  q?: string;
  /** undefined ⇒ both. */
  starred?: boolean;
  sort?: AdminFeedbackSort;
  limit?: number;
  offset?: number;
}

export async function fetchAdminFeedback(filter: AdminFeedbackFilter = {}): Promise<{ items: AdminFeedback[]; total: number }>
{
  const query = new URLSearchParams();
  if (filter.q) query.set('q', filter.q);
  if (filter.starred !== undefined) query.set('starred', String(filter.starred));
  if (filter.sort) query.set('sort', filter.sort);
  if (filter.limit !== undefined) query.set('limit', String(filter.limit));
  if (filter.offset !== undefined) query.set('offset', String(filter.offset));

  const qs = query.toString();
  const res = await api.get<Envelope<AdminFeedback[]> & { total: number }>(`/admin/feedback${qs ? `?${qs}` : ''}`);
  return { items: res.data ?? [], total: res.total ?? 0 };
}

export async function setFeedbackStarred(id: string, starred: boolean): Promise<AdminFeedback>
{
  const res = await api.put<Envelope<AdminFeedback>>(`/admin/feedback/${encodeURIComponent(id)}/starred`, { starred });
  if (!res.data) throw new Error('The server did not return the updated feedback.');
  return res.data;
}

export async function deleteFeedback(id: string): Promise<void>
{
  await api.delete(`/admin/feedback/${encodeURIComponent(id)}`);
}
