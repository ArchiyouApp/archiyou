/**
 * routes/feedback.ts — visitor feedback from a configurator's "Give feedback" button.
 *
 *   POST /feedback    { message, scriptId?, fileId?, scriptAuthor?, scriptName?, scriptVersion?, url? }
 *
 * Public: visitors of a published configurator are usually anonymous. A token, when
 * present and valid, only records who sent it. Rate limited per IP. Reading and
 * moderating feedback is operator-only, in routes/admin.ts.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { config } from '../config';
import { feedbackStore, FEEDBACK_MAX_LENGTH } from '../services/FeedbackStore';
import { parse } from '../validate';

const optionalText = (maxLength: number) => Type.Optional(Type.Union([Type.String({ maxLength }), Type.Null()]));

const FeedbackSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: FEEDBACK_MAX_LENGTH }),
  scriptId: optionalText(100),
  fileId: optionalText(100),
  scriptAuthor: optionalText(100),
  scriptName: optionalText(200),
  scriptVersion: optionalText(50),
  url: optionalText(2000),
});

/** Resolve the caller's handle if a valid token is present, else null.
 *  Mirrors optionalUser() in routes/library.ts. */
async function optionalUser(request: FastifyRequest): Promise<string | null> {
  try {
    await request.jwtVerify();
    return request.user.sub;
  } catch {
    return null;
  }
}

export async function registerFeedbackRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/feedback', { config: { rateLimit: config.feedbackRateLimit } }, async (request, reply) => {
    const body = parse(FeedbackSchema, request.body);
    if (!body.message.trim()) {
      reply.code(422);
      return { success: false, error: 'Feedback message is empty' };
    }
    const username = await optionalUser(request);
    const stored = await feedbackStore.create({ ...body, username });
    reply.code(201);
    return { success: true, data: { id: stored.id } };
  });
}
