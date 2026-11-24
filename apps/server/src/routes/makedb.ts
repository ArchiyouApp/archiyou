/**
 * routes/makedb.ts — the snapshots of the product sheet, for runs in the editor.
 *
 *   GET /makedb             { versions: [...], latest }
 *   GET /makedb/:version    the snapshot as JSON ('latest' for the newest)
 *
 * Signed in only: a snapshot holds purchase prices. Runs on the server get theirs from the
 * worker (execution/ExecutionWorker.ts), not through here. See services/MakeDbStore.ts.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { makeDbStore } from '../services/MakeDbStore';

export async function registerMakeDbRoutes(fastify: FastifyInstance): Promise<void>
{
  fastify.get('/makedb', { preHandler: fastify.authenticate }, async () =>
  {
    const versions = makeDbStore.versions();
    return { versions, latest: versions.at(-1) ?? null };
  });

  fastify.get(
    '/makedb/:version',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest<{ Params: { version: string } }>, reply: FastifyReply) =>
    {
      const found = makeDbStore.get(request.params.version);
      if (!found) { return reply.code(404).send({ success: false, error: `No make-db ${request.params.version} on this server` }); }
      // a version never changes; 'latest' does
      reply.header('Cache-Control', request.params.version === 'latest' ? 'private, no-cache' : 'private, max-age=31536000, immutable');
      reply.header('X-Make-Db-Version', found.version);
      return reply.type('application/json').send(found.bytes);
    },
  );
}
