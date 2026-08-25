/**
 * routes/execute.ts — server-side execution of a published script.
 *
 *   POST /scripts/published/execute/:user/:scriptAndVersion
 *
 * Loads the published script from the DB (ScriptStore), validates the incoming
 * param values against it, and runs it through the Redis/BullMQ execution
 * pipeline (ExecutionManager, decorated on the Fastify instance by the library
 * plugin). Interactive apps execute locally via RunnerWorker; this endpoint is
 * for API/server-side consumers (batch, precompute, integrations).
 *
 * Body: { params?, preset?, outputs?: string[], cache?: boolean, forceFileResponse?: boolean, kernel? }
 * Default output is ['default/model/glb'].
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import semver from 'semver';

import { Script } from '@archiyou/core/src/Script';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';

import { config } from '../config';
import { scriptStore } from '../services/ScriptStore';
import { isApiExecutionFileResponse } from '../execution/types';
import { parseScriptAndVersion } from './scriptUrl';

interface ExecuteBody {
  params?: Record<string, unknown>;
  preset?: string;
  outputs?: string[];
  cache?: boolean;
  forceFileResponse?: boolean;
  kernel?: string;
}

export async function registerExecuteRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { user: string; scriptAndVersion: string }; Body: ExecuteBody }>(
    '/scripts/published/execute/:user/:scriptAndVersion',
    // Authentication is mandatory: the Runner has no sandbox, so reaching this
    // route means running arbitrary JS in the worker's Node process.
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { user, scriptAndVersion } = request.params;
      const { scriptName, version } = parseScriptAndVersion(scriptAndVersion);
      const validVersion = version ? semver.valid(semver.coerce(version)) ?? undefined : undefined;

      // Only scripts by explicitly trusted authors may run server-side. Empty
      // allowlist (the default) disables the feature outright. This is the
      // author of the *script*, not the caller: the risk is whose code runs.
      const { allowedAuthors } = config.execution;
      if (allowedAuthors.length === 0) {
        reply.code(403);
        return {
          success: false,
          error: 'Server-side execution is disabled on this instance. Set SERVER_EXECUTION_AUTHORS to enable it for trusted authors.',
          data: null,
        };
      }
      if (!allowedAuthors.includes((user ?? '').toLowerCase())) {
        reply.code(403);
        return { success: false, error: `Server-side execution is not enabled for author '${user}'.`, data: null };
      }

      const scriptData = scriptStore.getPublished(user, scriptName, validVersion);
      if (!scriptData) {
        reply.code(404);
        return { success: false, error: `Script ${user}/${scriptName}:${version ?? 'latest'} not found`, data: null };
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

      // Validate incoming param values against the script definition.
      const { success, errors, checkedParamValues } = script.checkParamValuesVerbose(body.params || {});
      if (!success) {
        reply.code(422);
        return { success: false, error: 'Invalid request parameter values. See data array for details.', data: errors };
      }

      const executionRequest: RunnerScriptExecutionRequest = {
        kernel: (body.kernel as any) || 'mesh', // geometry kernel for the whole run: 'mesh' | 'brep'
        script,
        params: checkedParamValues,
        preset: body.preset,
        outputs: body.outputs,
        cache: body.cache !== false, // default true
        forceFileResponse: body.forceFileResponse === true,
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
