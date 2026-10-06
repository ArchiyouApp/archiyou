/**
 * routes/projects.ts — a professional's projects, clients and configurations
 * (plans/PROJECTS.md). Deliveries are added to the same prefix in phase 3.
 *
 *   GET    /projects?status&q&archived&limit&offset
 *   POST   /projects                                   { title?, clientId?, client?, configuration? }
 *   GET    /projects/:id
 *   PUT    /projects/:id                               { title?, status?, note?, archived?, clientId? }
 *   DELETE /projects/:id
 *   POST   /projects/:id/configurations                { script, values, unitSystem?, lang?, label?, sourceVersionId? }
 *   GET    /projects/:id/configurations/:cid           with the script snapshot
 *   PUT    /projects/:id/configurations/:cid           { label }
 *   PUT    /projects/:id/configurations/:cid/thumbnail image/png
 *   GET    /clients?q · GET /clients/:id · POST /clients · PUT /clients/:id · DELETE /clients/:id
 *
 * Every route needs a signed-in user with a verified email (the professional is
 * `request.user.sub`); every store call is scoped to them, so another professional's id
 * is a 404.
 */

import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { PROJECT_STATUSES, type ProjectStatus } from '@archiyou/types';

import { projectStore, snapshotOf, TEXT_MAX, TITLE_MAX } from '../services/ProjectStore';
import { thumbnailStore } from '../services/ThumbnailStore';
import { parse } from '../validate';

const optionalText = (maxLength: number) => Type.Optional(Type.Union([Type.String({ maxLength }), Type.Null()]));

const ClientSchema = Type.Object({
  email: optionalText(254),
  name: optionalText(200),
  company: optionalText(200),
  phone: optionalText(50),
  address: optionalText(500),
  note: optionalText(TEXT_MAX),
});

const ConfigurationSchema = Type.Object({
  // The script itself is validated by the core Script model in the store
  script: Type.Record(Type.String(), Type.Unknown()),
  values: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  unitSystem: Type.Optional(Type.Union([Type.Literal('metric'), Type.Literal('imperial'), Type.Null()])),
  lang: optionalText(10),
  label: optionalText(TITLE_MAX),
  sourceVersionId: optionalText(100),
});

const NewProjectSchema = Type.Object({
  title: optionalText(TITLE_MAX),
  clientId: optionalText(100),
  client: Type.Optional(Type.Union([ClientSchema, Type.Null()])),
  note: optionalText(TEXT_MAX),
  configuration: Type.Optional(Type.Union([ConfigurationSchema, Type.Null()])),
});

const ProjectPatchSchema = Type.Object({
  title: Type.Optional(Type.String({ maxLength: TITLE_MAX })),
  status: Type.Optional(Type.Union(PROJECT_STATUSES.map((s) => Type.Literal(s)))),
  note: optionalText(TEXT_MAX),
  archived: Type.Optional(Type.Boolean()),
  clientId: optionalText(100),
});

const LabelSchema = Type.Object({ label: optionalText(TITLE_MAX) });

type IdParams = { Params: { id: string } };
type ConfigurationParams = { Params: { id: string; cid: string } };

export async function registerProjectRoutes(fastify: FastifyInstance): Promise<void>
{
  const verified = { preHandler: [fastify.authenticate, fastify.requireVerified] };

  //// PROJECTS ////

  fastify.get<{ Querystring: { status?: string; q?: string; archived?: string; limit?: string; offset?: string } }>(
    '/projects',
    verified,
    async (request) =>
    {
      const { status, q, archived } = request.query;
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(request.query.offset) || 0, 0);
      const { items, total, counts } = await projectStore.listProjects(request.user.sub, {
        status: PROJECT_STATUSES.includes(status as ProjectStatus) ? status as ProjectStatus : undefined,
        q: q?.trim() || undefined,
        archived: archived === 'true',
        limit,
        offset,
      });
      return { success: true, data: items, total, limit, offset, counts };
    },
  );

  // A new project, optionally with its client and a first configuration (Add to project
  // → New project): one request, so a failed configuration cannot leave an empty project.
  fastify.post('/projects', verified, async (request, reply) =>
  {
    const body = parse(NewProjectSchema, request.body);
    const professional = request.user.sub;
    // Validate the configuration before creating anything
    if (body.configuration) snapshotOf(body.configuration.script, body.configuration.values);
    const project = await projectStore.createProject(professional, body);
    if (body.configuration) await projectStore.addConfiguration(professional, project.id, body.configuration);
    reply.code(201);
    return { success: true, data: await projectStore.getProject(professional, project.id) };
  });

  fastify.get<IdParams>('/projects/:id', verified, async (request) =>
  {
    return { success: true, data: await projectStore.getProject(request.user.sub, request.params.id, { markSeen: true }) };
  });

  fastify.put<IdParams>('/projects/:id', verified, async (request) =>
  {
    const patch = parse(ProjectPatchSchema, request.body);
    return { success: true, data: await projectStore.updateProject(request.user.sub, request.params.id, patch) };
  });

  fastify.delete<IdParams>('/projects/:id', verified, async (request, reply) =>
  {
    await projectStore.deleteProject(request.user.sub, request.params.id);
    // Configuration thumbnails live under the project's id (see the thumbnail route)
    await thumbnailStore.remove(request.user.sub, request.params.id);
    reply.code(204);
  });

  //// CONFIGURATIONS ////

  fastify.post<IdParams>('/projects/:id/configurations', verified, async (request, reply) =>
  {
    const body = parse(ConfigurationSchema, request.body);
    const configuration = await projectStore.addConfiguration(request.user.sub, request.params.id, body);
    reply.code(201);
    return { success: true, data: configuration };
  });

  fastify.get<ConfigurationParams>('/projects/:id/configurations/:cid', verified, async (request) =>
  {
    const { id, cid } = request.params;
    return { success: true, data: await projectStore.getConfiguration(request.user.sub, id, cid, true) };
  });

  fastify.put<ConfigurationParams>('/projects/:id/configurations/:cid', verified, async (request) =>
  {
    const { id, cid } = request.params;
    const { label } = parse(LabelSchema, request.body);
    return { success: true, data: await projectStore.setConfigurationLabel(request.user.sub, id, cid, label ?? null) };
  });

  // The configuration's picture: a PNG the browser rendered, stored like a script
  // thumbnail with the project in the file's place — {professional}/{projectId}/{cid}.
  fastify.put<ConfigurationParams & { Body: Buffer }>(
    '/projects/:id/configurations/:cid/thumbnail',
    verified,
    async (request, reply) =>
    {
      const { id, cid } = request.params;
      await projectStore.configurationRow(request.user.sub, id, cid);
      const url = await thumbnailStore.write(request.user.sub, id, cid, request.body, 'configuration');
      if (!url)
      {
        reply.code(422);
        return { success: false, error: 'Thumbnail was not accepted' };
      }
      await projectStore.setConfigurationThumbnail(request.user.sub, id, cid, url);
      return { success: true, thumbnail: url };
    },
  );

  //// CLIENTS ////

  fastify.get<{ Querystring: { q?: string } }>('/clients', verified, async (request) =>
  {
    return { success: true, data: await projectStore.listClients(request.user.sub, request.query.q?.trim() || undefined) };
  });

  fastify.get<IdParams>('/clients/:id', verified, async (request) =>
  {
    return { success: true, data: await projectStore.getClient(request.user.sub, request.params.id) };
  });

  fastify.post('/clients', verified, async (request, reply) =>
  {
    const body = parse(ClientSchema, request.body);
    reply.code(201);
    return { success: true, data: await projectStore.createClient(request.user.sub, body) };
  });

  fastify.put<IdParams>('/clients/:id', verified, async (request) =>
  {
    const body = parse(ClientSchema, request.body);
    return { success: true, data: await projectStore.updateClient(request.user.sub, request.params.id, body) };
  });

  fastify.delete<IdParams>('/clients/:id', verified, async (request, reply) =>
  {
    await projectStore.deleteClient(request.user.sub, request.params.id);
    reply.code(204);
  });
}
