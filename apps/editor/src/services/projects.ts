/**
 * projects.ts — the professional's projects, clients and configurations
 * (apps/server/src/routes/projects.ts; plans/PROJECTS.md).
 *
 * A configuration is a snapshot of a script plus its parameter values. Adding one takes
 * whatever script is on screen (the editor's, or a configurator's), the values as they
 * are now, and a picture of the model when there is one.
 */

import type {
  ClientData, ClientInput, ConfigurationData, ProjectData, ProjectList, ProjectStatus,
} from '@archiyou/types';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import { Script } from '@archiyou/core/src/Script';

import { configuratorUrl } from '@archiyou/ui/editor/publish-constants.js';

import { api } from './api.js';
import { editorPathFor } from './script-links.js';
import { renderThumbnailPng, glbOf, scenegraphOf } from './thumbnails.js';
import {
  executionResult, scripts, openScript, importScriptFromData, bumpScript, saveCore, encodeParamValues, userState,
} from '../state/workspace';

interface Envelope<T>
{
  success: boolean;
  data: T;
}

/** What gets added: the script, its values and how they were looked at. */
export interface ConfigurationInput
{
  script: ScriptData;
  values: Record<string, unknown>;
  unitSystem?: 'metric' | 'imperial' | null;
  lang?: string | null;
  label?: string | null;
  sourceVersionId?: string | null;
}

//// PROJECTS ////

export async function listProjects(filter: { status?: ProjectStatus; archived?: boolean; q?: string } = {}): Promise<ProjectList>
{
  const query = new URLSearchParams({ limit: '200' });
  if (filter.status) query.set('status', filter.status);
  if (filter.archived) query.set('archived', 'true');
  if (filter.q) query.set('q', filter.q);
  return api.get<ProjectList>(`/projects?${query}`);
}

export async function fetchProject(id: string): Promise<ProjectData>
{
  return (await api.get<Envelope<ProjectData>>(`/projects/${encodeURIComponent(id)}`)).data;
}

/** A new project; with `configuration` it starts with that as v1 (one request, so a failed
 *  configuration never leaves an empty project behind). */
export async function createProject(input: {
  title?: string | null;
  clientId?: string | null;
  client?: ClientInput | null;
  configuration?: ConfigurationInput | null;
} = {}): Promise<ProjectData>
{
  return (await api.post<Envelope<ProjectData>>('/projects', input)).data;
}

export async function updateProject(
  id: string,
  patch: { title?: string; status?: ProjectStatus; note?: string | null; archived?: boolean; clientId?: string | null },
): Promise<ProjectData>
{
  return (await api.put<Envelope<ProjectData>>(`/projects/${encodeURIComponent(id)}`, patch)).data;
}

export async function deleteProject(id: string): Promise<void>
{
  await api.delete(`/projects/${encodeURIComponent(id)}`);
}

//// CONFIGURATIONS ////

export async function addConfiguration(projectId: string, input: ConfigurationInput): Promise<ConfigurationData>
{
  return (await api.post<Envelope<ConfigurationData>>(`/projects/${encodeURIComponent(projectId)}/configurations`, input)).data;
}

/** One configuration with its script snapshot. */
export async function fetchConfiguration(projectId: string, id: string): Promise<ConfigurationData>
{
  return (await api.get<Envelope<ConfigurationData>>(
    `/projects/${encodeURIComponent(projectId)}/configurations/${encodeURIComponent(id)}`,
  )).data;
}

export async function setConfigurationLabel(projectId: string, id: string, label: string | null): Promise<ConfigurationData>
{
  return (await api.put<Envelope<ConfigurationData>>(
    `/projects/${encodeURIComponent(projectId)}/configurations/${encodeURIComponent(id)}`,
    { label },
  )).data;
}

/**
 * Give a configuration the picture of the model on screen (the last run's GLB). Best
 * effort: a configuration without a picture is still a configuration.
 */
export async function uploadConfigurationThumbnail(projectId: string, id: string): Promise<string | null>
{
  const result = executionResult.get();
  const png = await renderThumbnailPng(glbOf(result), scenegraphOf(result));
  if (!png) return null;
  try
  {
    const res = await api.putBinary<{ thumbnail?: string }>(
      `/projects/${encodeURIComponent(projectId)}/configurations/${encodeURIComponent(id)}/thumbnail`,
      png,
      'image/png',
    );
    return res.thumbnail ?? null;
  }
  catch (err)
  {
    console.warn('projects: thumbnail upload failed:', err);
    return null;
  }
}

/** A script's current parameter values: the value set in the editor, else the default. */
export function currentValues(script: ScriptData): Record<string, unknown>
{
  return Object.fromEntries(Object.entries(script.params ?? {})
    .map(([name, p]) => [name, p._value !== undefined ? p._value : p.default]));
}

//// OPENING A CONFIGURATION ////

/** The configurator a configuration came from, at its values — or null when it was no
 *  published configurator. A path on this origin, for Router.go(). */
export async function configuratorPathFor(projectId: string, configuration: ConfigurationData): Promise<string | null>
{
  const source = configuration.configurator;
  if (!source) return null;
  const full = await fetchConfiguration(projectId, configuration.id);
  const script = Script.fromData(full.script as Record<string, unknown>);
  const query = script ? encodeParamValues('', Object.values(script.params), full.values) : '';
  const { pathname } = new URL(configuratorUrl(source.author, source.name, source.version), window.location.origin);
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * How a configuration opens in the editor, without leaving copies behind:
 *   'source'  the professional's own script is still in My Scripts — open that file
 *   'changed' …but its code is no longer the snapshot's: the caller asks which one
 *   'copy'    the source is gone (or someone else's): only a copy can be opened
 */
export async function editorOpening(projectId: string, configuration: ConfigurationData):
  Promise<{ kind: 'source' | 'changed' | 'copy'; snapshot: ConfigurationData }>
{
  const snapshot = await fetchConfiguration(projectId, configuration.id);
  const me = userState.get().id;
  const own = scripts.get().find(s => s.fileId === configuration.sourceFileId && (!s.author || s.author === me));
  if (!own) return { kind: 'copy', snapshot };
  return { kind: own.code === (snapshot.script as { code?: string } | undefined)?.code ? 'source' : 'changed', snapshot };
}

/** Open the source file with the configuration's values in its parameters. Returns the
 *  editor path, or null when the file is not in My Scripts any more. */
export function openSourceWithValues(snapshot: ConfigurationData): string | null
{
  const script = snapshot.sourceFileId ? openScript(snapshot.sourceFileId) : null;
  if (!script) return null;
  Object.entries(snapshot.values).forEach(([name, value]) =>
  {
    if (script.params[name]) script.params[name]._value = value;
  });
  bumpScript();
  saveCore();
  return editorPathFor(script);
}

/** Open the snapshot itself as a new script of the professional's, at its values. */
export function openSnapshotCopy(snapshot: ConfigurationData): string | null
{
  const data = snapshot.script as Record<string, any> | undefined;
  if (!data) return null;
  const params = Object.fromEntries(Object.entries(data.params ?? {})
    .map(([name, p]) => [name, { ...(p as object), _value: snapshot.values[name] }]));
  const copy = importScriptFromData({ ...data, params, published: null, shared: null, version: null });
  return copy ? editorPathFor(copy) : null;
}

//// ORDERS ////

/** A visitor's order of a configurator's product (POST /orders, public). */
export interface OrderInput
{
  versionId: string;
  fulfillment: string;
  values: Record<string, unknown>;
  unitSystem?: 'metric' | 'imperial' | null;
  lang?: string | null;
  contact: { email: string; name?: string | null; phone?: string | null };
  message?: string | null;
  /** Honeypot: people never see it, so it stays empty. */
  website?: string;
  /** Changes to a delivered design ("Adjust this design"): they go to that delivery's project. */
  deliveryToken?: string;
}

/** Send an order, with a picture of the configured model when there is one. */
export async function sendOrder(input: OrderInput): Promise<void>
{
  const result = executionResult.get();
  const png = await renderThumbnailPng(glbOf(result), scenegraphOf(result)).catch(() => null);
  await api.post('/orders', { ...input, thumbnail: png ? toBase64(png) : null });
}

function toBase64(buffer: ArrayBuffer): string
{
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  const parts = Array.from({ length: Math.ceil(bytes.length / CHUNK) },
    (_, i) => String.fromCharCode(...bytes.subarray(i * CHUNK, (i + 1) * CHUNK)));
  return btoa(parts.join(''));
}

//// CLIENTS ////

export async function listClients(q?: string): Promise<ClientData[]>
{
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  return (await api.get<Envelope<ClientData[]>>(`/clients${query}`)).data;
}

export async function createClient(input: ClientInput): Promise<ClientData>
{
  return (await api.post<Envelope<ClientData>>('/clients', input)).data;
}

export async function updateClient(id: string, input: ClientInput): Promise<ClientData>
{
  return (await api.put<Envelope<ClientData>>(`/clients/${encodeURIComponent(id)}`, input)).data;
}
