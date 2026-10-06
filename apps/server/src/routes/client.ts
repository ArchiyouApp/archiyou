/**
 * routes/client.ts — what a professional's clients reach without an account
 * (plans/PROJECTS.md).
 *
 *   POST /orders    { versionId, fulfillment, values?, unitSystem?, lang?, contact, message?, thumbnail?, website? }
 *
 * An order of a configurator's product fulfillment becomes a request in its author's
 * Projects. Public and anonymous, so it is rate limited per IP and per configurator,
 * carries a honeypot (`website`, which people never see and bots fill in), and never says
 * more than "received": no project ids, no hint whether an address is known.
 */

import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';

import { config } from '../config';
import { emailService } from '../services/EmailService';
import { projectStore, TEXT_MAX } from '../services/ProjectStore';
import { scriptStore } from '../services/ScriptStore';
import { thumbnailStore } from '../services/ThumbnailStore';
import { userService } from '../services/UserService';
import { parse } from '../validate';

const optionalText = (maxLength: number) => Type.Optional(Type.Union([Type.String({ maxLength }), Type.Null()]));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OrderSchema = Type.Object({
  versionId: Type.String({ minLength: 1, maxLength: 100 }),
  fulfillment: Type.String({ minLength: 1, maxLength: 200 }),
  values: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  unitSystem: Type.Optional(Type.Union([Type.Literal('metric'), Type.Literal('imperial'), Type.Null()])),
  lang: optionalText(10),
  contact: Type.Object({
    email: Type.String({ minLength: 3, maxLength: 254 }),
    name: optionalText(200),
    phone: optionalText(50),
    company: optionalText(200),
  }),
  message: optionalText(TEXT_MAX),
  /** A PNG of the configured model, base64. */
  thumbnail: optionalText(Math.ceil(config.thumbnails.maxBytes * 4 / 3) + 4),
  /** Honeypot. */
  website: optionalText(500),
});

/** The product fulfillment a published version offers under this name, or null. */
function productOf(published: { fulfillments?: ScriptPublishedFulfillmentData[] } | null | undefined, name: string)
{
  return published?.fulfillments?.find((f) => f.category === 'product' && f.name === name) ?? null;
}

export async function registerClientRoutes(fastify: FastifyInstance): Promise<void>
{
  fastify.post('/orders', { config: { rateLimit: config.orderRateLimit } }, async (request, reply) =>
  {
    const body = parse(OrderSchema, request.body);
    const accepted = { success: true, data: { received: true } };

    // A bot filled in the field people never see: say thanks, keep nothing
    if (body.website?.trim())
    {
      reply.code(201);
      return accepted;
    }
    if (!EMAIL.test(body.contact.email.trim()))
    {
      reply.code(422);
      return { success: false, error: 'Please give a valid email address' };
    }

    // Only a published version that offers this product, whose author has a confirmed
    // address. Anything else is the same 404, so nothing can be learned from probing.
    const script = await scriptStore.findAnyVersionById(body.versionId);
    const product = script?.version ? productOf(script.published, body.fulfillment) : null;
    const author = product && script?.author ? await userService.findByUsername(script.author) : undefined;
    if (!script || !product || !author || author.emailVerifiedAt === null)
    {
      reply.code(404);
      return { success: false, error: 'This configurator does not take orders' };
    }

    const { project, configuration, duplicate } = await projectStore.receiveOrder({
      script,
      fulfillment: product.name,
      values: body.values,
      unitSystem: body.unitSystem,
      lang: body.lang,
      contact: { ...body.contact, email: body.contact.email.trim() },
      message: body.message,
    }, config.ordersPerConfiguratorPerDay);

    if (!duplicate)
    {
      if (body.thumbnail)
      {
        const png = Buffer.from(body.thumbnail, 'base64');
        const url = await thumbnailStore.write(author.username, project.id, configuration.id, png, 'order');
        if (url) await projectStore.setConfigurationThumbnail(author.username, project.id, configuration.id, url);
      }
      await emailService.sendOrderReceived(author.email, {
        product: product.name,
        configurator: `${script.name}:${script.version}`,
        clientName: body.contact.name?.trim() || null,
        clientEmail: body.contact.email.trim(),
        clientPhone: body.contact.phone?.trim() || null,
        message: body.message?.trim() || null,
        link: `${config.frontendUrl.replace(/\/+$/, '')}/projects/${project.id}`,
      });
    }

    reply.code(201);
    return accepted;
  });
}
