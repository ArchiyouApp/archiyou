/**
 * routes/client.ts — what a professional's clients reach without an account
 * (plans/PROJECTS.md).
 *
 *   POST /orders                       { versionId, fulfillment, values?, unitSystem?, lang?, contact, message?, thumbnail?, website? }
 *   GET  /d/:token                     the delivery's page: DeliveryView
 *   GET  /d/:token/files/:name         one of its files; ?download=1 to save it
 *   POST /d/:token/respond             { response: accepted | declined | changes, note? }
 *
 * An order of a configurator's product fulfillment becomes a request in its author's
 * Projects. Public and anonymous, so it is rate limited per IP and per configurator,
 * carries a honeypot (`website`, which people never see and bots fill in), and never says
 * more than "received": no project ids, no hint whether an address is known.
 *
 * A delivery is reached by its link alone (a 256-bit token). Opening it and downloading
 * from it are what the professional sees as activity — counted once per visitor and day,
 * never from the professional's own previews. No cookies: a visitor is a daily-salted
 * hash (visitorOf), not an identifier that lasts.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import type { DeliveryView } from '@archiyou/types';

import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';

import { config } from '../config';
import { emailService } from '../services/EmailService';
import { deliveryFileStore, deliveryFileType } from '../services/DeliveryFileStore';
import { projectStore, rowToDelivery, visitorOf, TEXT_MAX } from '../services/ProjectStore';
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

const RespondSchema = Type.Object({
  response: Type.Union([Type.Literal('accepted'), Type.Literal('declined'), Type.Literal('changes')]),
  note: optionalText(TEXT_MAX),
});

type TokenParams = { Params: { token: string } };

/** The caller's handle when a valid token came along, else null. */
async function optionalUser(request: FastifyRequest): Promise<string | null>
{
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

/** A visitor of a delivery page — unless it is the professional who sent it, looking at
 *  their own delivery: that is not activity. */
async function clientVisitor(request: FastifyRequest, professional: string): Promise<string | null>
{
  if ((await optionalUser(request)) === professional) return null;
  return visitorOf(request.ip, String(request.headers['user-agent'] ?? ''));
}

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

  //// DELIVERIES ////

  const viewing = { config: { rateLimit: config.deliveryRateLimit } };

  fastify.get<TokenParams>('/d/:token', viewing, async (request, reply) =>
  {
    const row = await projectStore.deliveryByToken(request.params.token);
    if (!row)
    {
      reply.code(404);
      return { success: false, error: 'This link does not exist' };
    }
    const sender = await userService.findByUsername(row.professional);
    const professional = sender?.name || sender?.username || row.professional;
    if (row.status === 'revoked')
    {
      reply.code(410);
      return { success: false, error: 'This link is no longer available', data: { status: 'revoked', professional } };
    }

    const visitor = await clientVisitor(request, row.professional);
    if (visitor) await projectStore.recordOpen(row, visitor);

    const delivery = rowToDelivery(row);
    const view: DeliveryView = {
      status: 'sent',
      professional,
      title: delivery.title,
      message: delivery.message,
      offer: delivery.offer,
      files: delivery.files,
      recipient: delivery.recipientName?.trim().split(/\s+/)[0] || null,
      sentAt: delivery.sentAt,
      response: delivery.response,
      responseNote: delivery.responseNote,
      responseAt: delivery.responseAt,
      adjustPath: null,
    };
    reply.header('Cache-Control', 'private, no-store');
    return { success: true, data: view };
  });

  fastify.get<{ Params: { token: string; name: string }; Querystring: { download?: string } }>(
    '/d/:token/files/:name',
    viewing,
    async (request, reply) =>
    {
      const { token, name } = request.params;
      const row = await projectStore.deliveryByToken(token);
      const listed = row?.status === 'sent' && row.files.some((f) => f.name === name);
      const type = deliveryFileType(name);
      const file = listed && type ? await deliveryFileStore.read(row.professional, row.id, name) : null;
      if (!row || !file || !type)
      {
        reply.code(row?.status === 'revoked' ? 410 : 404);
        return { success: false, error: 'This file is not available' };
      }

      const download = request.query.download === '1';
      if (download)
      {
        const visitor = await clientVisitor(request, row.professional);
        if (visitor) await projectStore.recordDownload(row, name, visitor);
      }
      // A spreadsheet is always saved, never opened in the browser
      const disposition = download || type.kind === 'sheet' ? 'attachment' : 'inline';
      reply
        .header('Content-Type', type.mime)
        .header('Content-Length', String(file.bytes))
        .header('Content-Disposition', `${disposition}; filename="${name}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        // The editor's page loads the model from the API's origin in development
        .header('Cross-Origin-Resource-Policy', 'cross-origin');
      return reply.send(file.stream);
    },
  );

  fastify.post<TokenParams>('/d/:token/respond', { config: { rateLimit: config.respondRateLimit } }, async (request, reply) =>
  {
    const body = parse(RespondSchema, request.body);
    const row = await projectStore.deliveryByToken(request.params.token);
    if (!row)
    {
      reply.code(404);
      return { success: false, error: 'This link does not exist' };
    }
    if (row.status === 'revoked')
    {
      reply.code(410);
      return { success: false, error: 'This link is no longer available' };
    }
    const answered = await projectStore.respond(row, body.response, body.note ?? null);

    const professional = await userService.findByUsername(row.professional);
    if (professional)
    {
      await emailService.sendClientResponse(professional.email, {
        clientName: answered.recipientName || answered.recipientEmail || 'Your client',
        title: answered.title,
        response: body.response,
        note: answered.responseNote,
        link: `${config.frontendUrl.replace(/\/+$/, '')}/projects/${answered.projectId}`,
      });
    }
    return { success: true, data: { response: answered.response, responseAt: answered.responseAt?.toISOString() ?? null } };
  });
}
