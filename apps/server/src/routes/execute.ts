/**
 * routes/execute.ts — server-side execution of a published script.
 *
 *   POST /scripts/published/execute/:user/:scriptAndVersion
 *
 * Loads the published script from the DB (ScriptStore), validates the incoming
 * param values against it, and runs it through the Redis/BullMQ execution
 * pipeline (ExecutionManager, decorated on the Fastify instance by the library
 * plugin).
 *
 * TWO WAYS IN, both off by default (see config.execution):
 *
 *   1. An AUTHENTICATED caller whose script author is in SERVER_EXECUTION_AUTHORS.
 *      The original path — for API/batch/precompute consumers.
 *   2. ANY caller, including an anonymous one, when the script version is marked
 *      `published.validated` by an admin and SERVER_EXECUTION_VALIDATED is on.
 *      This is what lets a published configurator run server-side and skip
 *      downloading the ~24MB CAD kernel. A configurator visitor has no account,
 *      which is why this path takes no token — and why it is rate limited.
 *
 * The Runner has no sandbox, so what is being trusted differs per path: an author
 * on path 1, one immutable (fileId, version) code snapshot on path 2.
 *
 * Body: { params?, preset?, outputs?: string[], cache?: boolean, forceFileResponse?: boolean,
 *         kernel?, unitSystem? }
 * Default output is ['default/model/glb'].
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import semver from 'semver';

import { Script } from '@archiyou/core/src/Script';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';

import { config } from '../config';
import { moduleHost } from '../modules/ModuleHost';
import { scriptStore } from '../services/ScriptStore';
import { userService } from '../services/UserService';
import { isApiExecutionFileResponse } from '../execution/types';
import { parseScriptAndVersion } from './scriptUrl';

interface ExecuteBody {
  params?: Record<string, unknown>;
  preset?: string;
  outputs?: string[];
  cache?: boolean;
  forceFileResponse?: boolean;
  kernel?: string;
  unitSystem?: 'metric' | 'imperial';
}

/** Resolve the caller's handle if a valid token is present, else null.
 *  Mirrors optionalUser() in routes/library.ts and routes/modules.ts. */
async function optionalUser(request: FastifyRequest): Promise<string | null> {
  try {
    await request.jwtVerify();
    return request.user.sub;
  } catch {
    return null;
  }
}

export async function registerExecuteRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { user: string; scriptAndVersion: string }; Body: ExecuteBody }>(
    '/scripts/published/execute/:user/:scriptAndVersion',
    // The only route that runs unsandboxed code for a possibly-anonymous caller, so it is
    // the only one where a bare request loop costs real CPU. Per-route opt-in: rate
    // limiting is registered with global:false in plugin.ts.
    { config: { rateLimit: config.execution.rateLimit } },
    async (request, reply) => {
      const { user, scriptAndVersion } = request.params;
      const { scriptName, version } = parseScriptAndVersion(scriptAndVersion);
      const validVersion = version ? semver.valid(semver.coerce(version)) ?? undefined : undefined;

      const { allowedAuthors, allowValidated } = config.execution;
      if (allowedAuthors.length === 0 && !allowValidated) {
        reply.code(403);
        return {
          success: false,
          error: 'Server-side execution is disabled on this instance. Set SERVER_EXECUTION_VALIDATED=1 to run admin-validated scripts, or SERVER_EXECUTION_AUTHORS to enable it for trusted authors.',
          data: null,
        };
      }

      /** Path 1: authenticated caller whose SCRIPT author is allowlisted. Returns the
       *  refusal to send, or null when the caller is through. The author checked is the
       *  script's, not the caller's — the risk is whose code runs. */
      const allowlistGate = async (): Promise<{ code: number; error: string } | null> => {
        const caller = await optionalUser(request);
        if (!caller) return { code: 401, error: 'Unauthorized' };
        if (!allowedAuthors.includes((user ?? '').toLowerCase())) {
          return {
            code: 403,
            error: `Server-side execution is not enabled for author '${user}'.`,
          };
        }
        return null;
      };

      // With the validated path off, nothing about the script can open the gate — so deny
      // before touching the DB, exactly as this route always has. Only when it is on do we
      // have to read the row first, because that is where `validated` lives.
      let allowlistChecked = false;
      if (!allowValidated) {
        const denied = await allowlistGate();
        if (denied) {
          reply.code(denied.code);
          return { success: false, error: denied.error, data: null };
        }
        allowlistChecked = true;
      }

      const scriptData = await scriptStore.getPublished(user, scriptName, validVersion);
      if (!scriptData) {
        reply.code(404);
        return { success: false, error: `Script ${user}/${scriptName}:${version ?? 'latest'} not found`, data: null };
      }

      // Path 2: an admin-validated version runs for anyone, token or not — a configurator
      // visitor has no account. `validated` is server-owned: ScriptStore.toRow() forces it
      // off on every insert and only ScriptStore.setValidated() (admin) turns it on.
      // Anything not validated falls back to path 1.
      if (!allowlistChecked && scriptData.published?.validated !== true) {
        const denied = await allowlistGate();
        if (denied) {
          reply.code(denied.code);
          return {
            success: false,
            error: denied.code === 403
              ? `${denied.error} The script is not admin-validated and the author is not in SERVER_EXECUTION_AUTHORS.`
              : denied.error,
            data: null,
          };
        }
      }

      if (!fastify.executionManager) {
        reply.code(503);
        return { success: false, error: 'Execution pipeline unavailable (is Redis running?)', data: null };
      }

      const body = request.body || {};
      if (typeof body !== 'object') {
        reply.code(400);
        return { success: false, error: 'Invalid request body. Expected an object.', data: null };
      }

      const script = Script.fromData(scriptData);
      if (!script) {
        reply.code(500);
        return { success: false, error: 'Stored script failed to load', data: null };
      }

      // Validate incoming param values against the script definition. This THROWS
      // (rather than returning !success) when the body names a param the script does
      // not declare, so it has to be caught: the values are caller-controlled, and an
      // unhandled throw here turns a bad request into a 500.
      let checked: ReturnType<Script['checkParamValuesVerbose']>;
      try {
        checked = script.checkParamValuesVerbose(body.params || {});
      } catch (error) {
        reply.code(422);
        return { success: false, error: (error as Error).message, data: null };
      }
      if (!checked.success) {
        reply.code(422);
        return { success: false, error: 'Invalid request parameter values. See data array for details.', data: checked.errors };
      }

      // Execution context the browser client fills in for itself (see
      // apps/editor/src/services/execution-service.ts) and which a server-side run has to be
      // handed explicitly, or `$import()`, `$component('./name')` and gated modules all fail.
      // Module entitlement is the SCRIPT AUTHOR's, not the caller's — the caller may be
      // anonymous, and it is the author's script that declares the dependency.
      const { internalApiUrl } = config.execution;
      const authorModules = scriptData.author ? await userService.getModules(scriptData.author) : [];

      const executionRequest: RunnerScriptExecutionRequest = {
        kernel: (body.kernel as any) || 'mesh', // geometry kernel for the whole run: 'mesh' | 'brep'
        // toData(), NOT the Script instance. This request is JSON-serialized onto the
        // BullMQ queue, and Script keeps its fields private behind getters (`name` reads
        // `_name`) — so a serialized instance arrives at the worker with no `name`, fails
        // isRunnerScriptExecutionRequest(), and comes back as "Unknown task type".
        script: script.toData(),
        params: checked.checkedParamValues,
        preset: body.preset,
        outputs: body.outputs,
        cache: body.cache !== false, // default true
        forceFileResponse: body.forceFileResponse === true,
        // Presentation only, but it silently changes every dimension and doc string if
        // dropped — so it must ride along rather than defaulting to metric.
        unitSystem: body.unitSystem ?? scriptData.units,
        assetProxyUrl: internalApiUrl,
        componentLibraryUrl: internalApiUrl,
        moduleApiUrl: internalApiUrl,
        modules: moduleHost.catalogFor(authorModules),
      };

      try {
        const response = await fastify.executionManager.execute(executionRequest);

        if (isApiExecutionFileResponse(response)) {
          reply.type(response.ext === 'json' ? 'text/plain' : `application/${response.ext}`);
          reply.header('Content-Disposition', `attachment; filename="${scriptName}.${response.ext}"`);
          return reply.send(response.data);
        }
        return response;
      } catch (error) {
        reply.code(500);
        return { success: false, error: `Server error while executing script: ${(error as Error).message}`, data: null };
      }
    },
  );
}
