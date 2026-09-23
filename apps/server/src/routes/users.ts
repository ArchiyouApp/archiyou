/**
 * routes/users.ts — minimal user directory, used by the "Share only with" picker.
 *
 * Only a search endpoint is exposed, and only to authenticated callers. Results
 * always exclude the caller themselves, and are the DIRECTORY view — no email
 * address, no module entitlements (UserService.toDirectoryUser). Email matches
 * only on a full address, never a substring; see UserService.search for why.
 */

import type { FastifyInstance } from 'fastify';

import { userService } from '../services/UserService';

export async function registerUserRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { q?: string } }>(
    '/users/search',
    { preHandler: fastify.authenticate },
    async (request) => {
      const q = (request.query.q ?? '').trim();
      if (q.length === 0) return { success: true, data: [] };
      return { success: true, data: await userService.search(q, request.user.sub) };
    },
  );
}
