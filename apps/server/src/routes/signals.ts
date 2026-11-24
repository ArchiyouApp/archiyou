/**
 * routes/signals.ts — what browsers report: a configurator's failed run, an output that could
 * not be made, a crash of the app (apps/editor/src/services/signals.ts).
 *
 *   POST /signals    { signals: ClientSignal[] }   (at most SIGNAL_LIMITS.batch)
 *
 * Public: visitors of a configurator are usually anonymous. Rate limited per IP. Only the
 * CLIENT_SIGNAL_TYPES are taken. `user` is never read from the body: a valid token, when one
 * is sent, says who it was. The body may come as text/plain (navigator.sendBeacon).
 * Always 204 on a valid body: there is nothing to tell the page.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { CLIENT_SIGNAL_TYPES, SIGNAL_LIMITS } from '@archiyou/types';

import { config } from '../config';
import { signal } from '../signals/bus';
import { parse } from '../validate';

// Generous ceilings: longer values are cut by the bus, not refused; these only keep a body
// from being absurd.
const text = (maxLength: number) => Type.Optional(Type.String({ maxLength }));

const ClientSignalSchema = Type.Object({
  type: Type.Union(CLIENT_SIGNAL_TYPES.map((t) => Type.Literal(t))),
  source: Type.Union([Type.Literal('configurator'), Type.Literal('editor')]),
  message: text(2000),
  script: text(SIGNAL_LIMITS.script),
  scriptVersionId: text(100),
  line: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
  query: text(2000),
  url: text(2000),
  appVersion: text(40),
  data: Type.Optional(Type.Record(Type.String({ maxLength: 40 }), Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean()]))),
});

const SignalsSchema = Type.Object({
  signals: Type.Array(ClientSignalSchema, { minItems: 1, maxItems: SIGNAL_LIMITS.batch }),
});

/** Resolve the caller's handle if a valid token is present, else null (as routes/feedback.ts). */
async function optionalUser(request: FastifyRequest): Promise<string | null>
{
  if (!request.headers.authorization) return null;
  try
  {
    await request.jwtVerify();
    return request.user.sub;
  }
  catch
  {
    return null;
  }
}

export async function registerSignalRoutes(fastify: FastifyInstance): Promise<void>
{
  // sendBeacon posts a Blob; without a JSON type it arrives as text/plain. Only in this
  // plugin's own context: everywhere else text/plain stays a string.
  fastify.removeContentTypeParser('text/plain');
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body, done) =>
  {
    try
    {
      done(null, JSON.parse(body as string));
    }
    catch
    {
      done(null, body);
    }
  });

  fastify.post('/signals', { config: { rateLimit: config.signals.rateLimit } }, async (request, reply) =>
  {
    const body = parse(SignalsSchema, request.body);
    const user = await optionalUser(request);
    const context = { userAgent: String(request.headers['user-agent'] ?? '').slice(0, 500), ip: request.ip };
    // `parse` passes on properties the schema does not name, `user` among them: what reaches
    // the bus is built field by field.
    body.signals.forEach((s) => signal({
      type: s.type,
      source: s.source,
      message: s.message,
      script: s.script,
      scriptVersionId: s.scriptVersionId,
      line: s.line,
      query: s.query,
      url: s.url,
      appVersion: s.appVersion,
      data: s.data,
      user: user ?? undefined,
    }, context));
    reply.code(204);
  });
}
