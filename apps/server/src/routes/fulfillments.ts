/**
 * routes/fulfillments.ts — a configurator visitor asks for a gated fulfillment.
 *
 *   POST /fulfillments              { versionId, fulfillment, values?, unitSystem?, email?, code?, website? }
 *   POST /fulfillments/downloaded   { versionId, fulfillment }   a free download happened (counted, nothing else)
 *
 * What a fulfillment's `access` asks for (core's FULFILLMENT_ACCESS):
 *
 *   email, clients       202 { queued }: the server makes the files and emails them. Only for a
 *                        version that may run here (services/serverRun: an allowlisted author or
 *                        an admin-validated version), capped per configurator per day, and the
 *                        same address asking for the same configuration within an hour is not
 *                        sent twice. An address that is not one of the author's clients gets the
 *                        same 202 (nothing to learn from probing) and an email saying so.
 *   signed-in, users,    200 { granted }: the visitor's browser makes the files. A convenience
 *   code                 gate only: a published configurator's code is public.
 *   anyone               nothing to ask; the browser reports the download to /downloaded.
 *
 * Public and anonymous, like POST /orders: rate limited per IP, with the honeypot
 * (`website`), and an unknown version or fulfillment is the same 404 whatever the reason.
 * Everything handed over is an event of the configurator (services/EventStore), for its author.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import {
  accessOf, baseName, deliverableOutputs, deliveredFormats, fulfillmentExports, isDownload, isEmailed,
  plainFilesForOutput, sanitize, type FulfillmentFile,
} from '@archiyou/core/src/execution/fulfillment';
import type { ScriptPublishedFulfillmentData } from '@archiyou/core/src/ScriptSchema';
import type { RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';

import { config } from '../config';
import { serverRunAllowed, serverRunRequest } from '../execution/serverRun';
import { byteLength, emailService } from '../services/EmailService';
import { configurationKey, eventStore } from '../services/EventStore';
import { checkFulfillmentAccess, REFUSAL_MESSAGES, type AccessWho } from '../services/fulfillmentAccess';
import { configuratorQuery, visitorOf } from '../services/ProjectStore';
import { scriptStore } from '../services/ScriptStore';
import { userService } from '../services/UserService';
import { parse } from '../validate';

const optionalText = (maxLength: number) => Type.Optional(Type.Union([Type.String({ maxLength }), Type.Null()]));

const RequestSchema = Type.Object({
  versionId: Type.String({ minLength: 1, maxLength: 100 }),
  fulfillment: Type.String({ minLength: 1, maxLength: 200 }),
  values: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  unitSystem: Type.Optional(Type.Union([Type.Literal('metric'), Type.Literal('imperial'), Type.Null()])),
  email: optionalText(254),
  code: optionalText(200),
  /** Honeypot. */
  website: optionalText(500),
});

const DownloadedSchema = Type.Object({
  versionId: Type.String({ minLength: 1, maxLength: 100 }),
  fulfillment: Type.String({ minLength: 1, maxLength: 200 }),
});

type FulfillmentRequest = Static<typeof RequestSchema>;

const NOT_FOUND = { success: false, error: 'This is not available' };

/** Emails being made and sent: a test awaits them with settleFulfillmentJobs(). */
const jobs = new Set<Promise<void>>();

export async function settleFulfillmentJobs(): Promise<void>
{
  await Promise.all([...jobs]);
}

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

/** The download fulfillment a published version offers under this name, or null. Products
 *  are ordered through POST /orders. */
function downloadOf(script: ScriptData | null, name: string): ScriptPublishedFulfillmentData | null
{
  if (!script?.version || !script.published || !script.author) return null;
  return script.published.fulfillments?.find((f) => isDownload(f) && f.name === name) ?? null;
}

/** Where the email's button goes: the configurator, opened on the visitor's design. */
function configuratorLink(script: ScriptData, values: Record<string, unknown>): string
{
  const query = configuratorQuery(script, values);
  return `${script.published?.url ?? config.frontendUrl}${query ? `?${query}` : ''}`;
}

export async function registerFulfillmentRoutes(fastify: FastifyInstance): Promise<void>
{
  fastify.post('/fulfillments', { config: { rateLimit: config.fulfillments.rateLimit } }, async (request, reply) =>
  {
    const body = parse(RequestSchema, request.body);

    // A bot filled in the field people never see: say it is on its way, do nothing
    if (body.website?.trim())
    {
      reply.code(202);
      return { success: true, data: { queued: true } };
    }

    const script = await scriptStore.findAnyVersionById(body.versionId);
    const fulfillment = downloadOf(script, body.fulfillment);
    if (!script || !fulfillment || accessOf(fulfillment) === 'anyone')
    {
      reply.code(404);
      return NOT_FOUND;
    }
    const author = script.author!;
    const caller = await optionalUser(request);
    const access = accessOf(fulfillment);
    const checked = await checkFulfillmentAccess(author, fulfillment, { caller, email: body.email, code: body.code });

    if ('refusal' in checked && checked.refusal !== 'not-client')
    {
      const { status, error } = REFUSAL_MESSAGES[checked.refusal];
      reply.code(status);
      return { success: false, error };
    }

    if (!isEmailed(fulfillment))
    {
      await eventStore.add({
        professional: author.toLowerCase(),
        scriptVersionId: script.id!,
        type: 'fulfillment.unlocked',
        meta: { fulfillment: fulfillment.name, access, ...('who' in checked ? checked.who : {}) },
      });
      return { success: true, data: { granted: true } };
    }

    // By email from here on. The values must fit the script before anything is queued.
    const values = body.values ?? {};
    const parsed = Script.fromData(script);
    let params: Record<string, unknown>;
    try
    {
      const result = parsed?.checkParamValuesVerbose(values);
      if (!result?.success) throw new Error(result?.errors?.join('; ') || 'Invalid values');
      params = result.checkedParamValues;
    }
    catch
    {
      reply.code(422);
      return { success: false, error: 'This configuration cannot be made' };
    }

    const email = body.email!.trim().toLowerCase();
    const key = configurationKey(values, body.unitSystem);
    if (await eventStore.emailedRecently(script.id!, fulfillment.name, email, key))
    {
      reply.code(202);
      return { success: true, data: { queued: true } };
    }
    if (await eventStore.emailsToday(script.id!) >= config.fulfillments.emailsPerConfiguratorPerDay)
    {
      reply.code(429);
      return { success: false, error: 'This configurator sent all it can for today. Please try again tomorrow.' };
    }

    const job = deliverByEmail(fastify, {
      script, fulfillment, params, values, unitSystem: body.unitSystem ?? null, email, key,
      who: 'who' in checked ? checked.who : { email },
      notClient: 'refusal' in checked,
    }).catch((err) => console.error(`fulfillments: emailing "${fulfillment.name}" failed:`, err));
    jobs.add(job);
    void job.finally(() => jobs.delete(job));

    reply.code(202);
    return { success: true, data: { queued: true } };
  });

  // A free download happened in a visitor's browser: counted once per visitor and day,
  // never the author's own. Answers 204 whatever happens: there is nothing to tell.
  fastify.post('/fulfillments/downloaded', { config: { rateLimit: config.fulfillments.downloadRateLimit } }, async (request, reply) =>
  {
    const body = parse(DownloadedSchema, request.body);
    const script = await scriptStore.findAnyVersionById(body.versionId);
    const fulfillment = downloadOf(script, body.fulfillment);
    const caller = await optionalUser(request);
    if (script && fulfillment && accessOf(fulfillment) === 'anyone' && caller?.toLowerCase() !== script.author!.toLowerCase())
    {
      const visitor = visitorOf(request.ip, String(request.headers['user-agent'] ?? ''));
      if (!await eventStore.downloadedToday(script.id!, fulfillment.name, visitor))
      {
        await eventStore.add({
          professional: script.author!.toLowerCase(),
          scriptVersionId: script.id!,
          type: 'fulfillment.downloaded',
          meta: { fulfillment: fulfillment.name },
          visitor,
        });
      }
    }
    reply.code(204);
  });
}

interface EmailJob
{
  script: ScriptData;
  fulfillment: ScriptPublishedFulfillmentData;
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  unitSystem: 'metric' | 'imperial' | null;
  email: string;
  /** configurationKey() of the values, to recognise a repeat. */
  key: string;
  who: AccessWho;
  /** Access 'clients' and the address is not one of them: tell them, send nothing. */
  notClient: boolean;
}

/** Make the fulfillment's files on the server and email them; or tell the visitor why not.
 *  Either way an event for the author. */
async function deliverByEmail(fastify: FastifyInstance, job: EmailJob): Promise<void>
{
  const { script, fulfillment, email } = job;
  const configurator = `${script.published?.title || script.name}`;
  const link = configuratorLink(script, job.values);
  const event = { fulfillment: fulfillment.name, access: accessOf(fulfillment), key: job.key, ...job.who, email };

  const fail = async (reason: 'not a client' | 'no server run' | 'too large' | 'failed') =>
  {
    await eventStore.add({ professional: script.author!.toLowerCase(), scriptVersionId: script.id!, type: 'fulfillment.failed', meta: { ...event, reason } });
    await emailService.sendFulfillmentFailed(email, { fulfillment: fulfillment.name, configurator, reason, link });
  };

  if (job.notClient) return fail('not a client');
  if (!serverRunAllowed(script) || !fastify.executionManager) return fail('no server run');

  const files = await makeFiles(fastify, job).catch((err) =>
  {
    console.error(`fulfillments: making "${fulfillment.name}" of ${script.author}/${script.name}:${script.version} failed:`, err);
    return null;
  });
  if (!files?.length) return fail('failed');

  const attachments = files.length === 1
    ? files
    : [await zipped(fastify, files, `${baseName(script.name, script.version)}_${sanitize(fulfillment.name)}.zip`)];
  if (attachments.reduce((sum, f) => sum + byteLength(f.data), 0) > config.fulfillments.maxEmailBytes) return fail('too large');

  const author = await userService.findByUsername(script.author!);
  await emailService.sendFulfillment(email, {
    fulfillment: fulfillment.name,
    configurator,
    authorName: author?.name || author?.username || script.author!,
    // Replies go to Archiyou, not the author: anyone can have this sent to them
    authorEmail: null,
    link,
    files: attachments,
  });
  await eventStore.add({
    professional: script.author!.toLowerCase(),
    scriptVersionId: script.id!,
    type: 'fulfillment.emailed',
    meta: { ...event, files: attachments.map((f) => f.name) },
  });
}

/** Run the script for the fulfillment's exports and name the files, the way the browser's
 *  download does (core's execution/fulfillment), but with PDFs made by the runner. */
async function makeFiles(fastify: FastifyInstance, job: EmailJob): Promise<FulfillmentFile[]>
{
  const { script, fulfillment } = job;
  const exports = fulfillmentExports(fulfillment, { pdfFromPages: false });
  const outputs = exports.map((e) => e.path).filter((p, i, all) => all.indexOf(p) === i);
  if (outputs.length === 0) return [];

  const request = await serverRunRequest(script, `${script.author}/${script.name}:${script.version}`, {
    params: job.params,
    outputs,
    unitSystem: job.unitSystem ?? undefined,
  });
  const response = await fastify.executionManager!.execute(request) as { success?: boolean; error?: string; data?: RunnerScriptExecutionResult } | null;
  if (!response?.success || !response.data) throw new Error(response?.error ?? 'no result');

  const base = baseName(script.name, script.version);
  const used = new Set<string>();
  return deliverableOutputs(response.data.outputs ?? []).flatMap((output) =>
    deliveredFormats(output, exports).flatMap((format) => plainFilesForOutput(output, format, base, used)));
}

async function zipped(fastify: FastifyInstance, files: FulfillmentFile[], name: string): Promise<FulfillmentFile>
{
  const zip = await fastify.executionManager!.zipRawDataToBuffer(
    files.map((f) => ({ name: f.name, data: typeof f.data === 'string' ? f.data : Buffer.from(f.data) })));
  return { name, data: new Uint8Array(zip), mime: 'application/zip' };
}
