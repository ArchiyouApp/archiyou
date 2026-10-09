/**
 * routes/links.ts — links that exist before what they point at (plans/LINKS.md).
 *
 *   POST /links       { kind, title? }        → 201 { key, url }   signed in: reserve a link, pending
 *   PUT  /links/:key  { target } | { error }  → 204                the owner: ready, or failed
 *   GET  /go/:key                                                  anyone: the redirect
 *
 * A script that asks for a copy of a Google Sheet (cloudcalc's cloudcopy()) gets a link at
 * once instead of waiting seconds for Drive; the editor makes the copy in the background and
 * then sets the link's target. Until then the link shows a page that refreshes itself.
 *
 * Keys are 10 random base58 characters (no 0 O I l), about 58 bits: links cannot be guessed
 * or listed. A target must start with one of config.links.targets, so a link is never an
 * open redirect. Caddy sends /go/* on the app's own domain here.
 */

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { Type } from 'typebox';

import { config } from '../config';
import { db } from '../db/client';
import { links } from '../db/schema';
import { parse } from '../validate';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const KEY_LENGTH = 10;
const KEY = /^[1-9A-HJ-NP-Za-km-z]{10}$/;

const ReserveSchema = Type.Object({
  kind: Type.Literal('google-sheet-copy'),
  title: Type.Optional(Type.String({ maxLength: 300 })),
});

const SetSchema = Type.Union([
  Type.Object({ target: Type.String({ minLength: 1, maxLength: 2000 }) }, { additionalProperties: false }),
  Type.Object({ error: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
]);

export async function registerLinkRoutes(fastify: FastifyInstance): Promise<void>
{
  fastify.post('/links', { preHandler: [fastify.authenticate], config: { rateLimit: config.links.writeRateLimit } }, async (request, reply) =>
  {
    const body = parse(ReserveSchema, request.body);
    const key = await reserve(request.user.sub, body.kind, body.title?.trim() || null);
    reply.code(201);
    return { success: true, data: { key, url: `${baseUrl(request)}/go/${key}` } };
  });

  fastify.put<{ Params: { key: string } }>('/links/:key', { preHandler: [fastify.authenticate], config: { rateLimit: config.links.writeRateLimit } }, async (request, reply) =>
  {
    const body = parse(SetSchema, request.body);
    const target = 'target' in body ? body.target : null;
    if (target !== null && !allowedTarget(target))
    {
      reply.code(422);
      return { success: false, error: `A link can only point at ${config.links.targets.join(' or ')}` };
    }
    const changed = await db.update(links)
      .set(target !== null
        ? { status: 'ready', target, message: null, updated: new Date() }
        : { status: 'failed', message: 'error' in body ? body.error : null, updated: new Date() })
      .where(and(eq(links.key, request.params.key), eq(links.owner, request.user.sub)))
      .returning({ key: links.key });
    // Someone else's link answers as one that does not exist
    if (!changed.length)
    {
      reply.code(404);
      return { success: false, error: 'No such link' };
    }
    reply.code(204);
    return null;
  });

  fastify.get<{ Params: { key: string } }>('/go/:key', { config: { rateLimit: config.links.readRateLimit } }, async (request, reply) =>
  {
    noStore(reply);
    const row = KEY.test(request.params.key)
      ? (await db.select().from(links).where(eq(links.key, request.params.key)).limit(1))[0]
      : undefined;
    if (!row)
    {
      return page(reply, 404, 'No such link', 'This link does not exist.');
    }
    if (row.status === 'ready' && row.target && allowedTarget(row.target))
    {
      // 302, not 301: browsers keep a 301 forever, and a target may still change
      return reply.redirect(row.target, 302);
    }
    if (row.status === 'pending' && Date.now() - row.created.getTime() < config.links.pendingMs)
    {
      return page(reply, 200, 'Almost ready', 'This link is almost ready: the spreadsheet is being made. This page opens it when it is.', row.title, true);
    }
    const why = row.status === 'failed' ? (row.message ?? 'It could not be made.') : 'It was never finished: the editor that was making it was closed.';
    return page(reply, 404, 'Not available', `What this link points at is not there. ${why}`, row.title);
  });
}

/** A new pending link: its key. A clash of two random keys is not impossible, so try again. */
async function reserve(owner: string, kind: string, title: string | null): Promise<string>
{
  const attempt = async (left: number): Promise<string> =>
  {
    const key = newKey();
    const made = await db.insert(links).values({ key, owner, kind, title, status: 'pending', created: new Date(), updated: new Date() })
      .onConflictDoNothing()
      .returning({ key: links.key });
    if (made.length) return key;
    if (left <= 0) throw new Error('Could not reserve a link');
    return attempt(left - 1);
  };
  return attempt(3);
}

/** 10 base58 characters. Bytes of 232 and up are skipped so every character is as likely. */
export function newKey(): string
{
  const usable = [...randomBytes(KEY_LENGTH * 2)].filter((b) => b < 232);
  return usable.length >= KEY_LENGTH
    ? usable.slice(0, KEY_LENGTH).map((b) => BASE58[b % 58]).join('')
    : newKey();
}

function allowedTarget(target: string): boolean
{
  return config.links.targets.some((prefix) => target.startsWith(prefix));
}

function baseUrl(request: FastifyRequest): string
{
  return (config.links.baseUrl ?? `${request.protocol}://${request.hostname}`).replace(/\/+$/, '');
}

function noStore(reply: FastifyReply): void
{
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Robots-Tag', 'noindex');
  reply.header('Referrer-Policy', 'no-referrer');
}

/** A small page of its own: no app, no script. `refresh` reloads it every 3 s. */
function page(reply: FastifyReply, status: number, heading: string, text: string, title?: string | null, refresh = false): FastifyReply
{
  const name = title ? `<p class="title">${escapeHtml(title)}</p>` : '';
  return reply.code(status).type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="3">' : ''}
<title>${escapeHtml(heading)} · Archiyou</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; color: #1f2933; background: #f5f7fa; }
  main { max-width: 28rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  .title { font-weight: 600; margin: 0 0 1rem; word-break: break-word; }
  p { margin: 0 0 0.75rem; }
  small { color: #616e7c; }
  @media (prefers-color-scheme: dark) { body { color: #e4e7eb; background: #1f2933; } small { color: #9aa5b1; } }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
${name}
<p>${escapeHtml(text)}</p>
<small>Archiyou</small>
</main>
</body>
</html>
`);
}

function escapeHtml(text: string): string
{
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
