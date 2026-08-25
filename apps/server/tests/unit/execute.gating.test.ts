/**
 * tests/unit/execute.gating.test.ts — access control on server-side execution.
 *
 * POST /scripts/published/execute/:user/:scriptAndVersion reaches the Runner,
 * which compiles script source with `new AsyncFunction` and runs it in-process
 * with full Node capability — there is no sandbox. Two gates therefore stand in
 * front of it and both are asserted here:
 *
 *   1. authentication is mandatory (the route was anonymous before)
 *   2. the script's author must be on config.execution.allowedAuthors, which is
 *      empty by default so the feature is off unless deliberately enabled
 *
 * Registered in isolation with a JWT plugin but no Redis/DB: every case below is
 * rejected before `fastify.executionManager` or ScriptStore would be consulted,
 * which is exactly the property we want (deny before doing any work).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

import { registerExecuteRoutes } from '../../src/routes/execute';
import { config } from '../../src/config';

const SECRET = 'test-secret-for-execute-gating';
const ROUTE = '/scripts/published/execute/alice/mychair:1.0.0';

let app: FastifyInstance;
const savedAuthors = [...config.execution.allowedAuthors];

async function buildApp(): Promise<FastifyInstance>
{
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: SECRET });
    instance.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) =>
    {
        try { await request.jwtVerify(); }
        catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
    });
    await instance.register(registerExecuteRoutes);
    await instance.ready();
    return instance;
}

/** A valid session token for `sub`, signed with the same secret the app uses. */
function tokenFor(sub: string): string
{
    return app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub });
}

beforeEach(async () =>
{
    config.execution.allowedAuthors = [];
    app = await buildApp();
});

afterEach(async () =>
{
    config.execution.allowedAuthors = savedAuthors;
    await app.close();
});

describe('POST /scripts/published/execute — authentication', () =>
{
    it('rejects an anonymous request with 401', async () =>
    {
        // Regression guard: this route shipped with no preHandler at all, making
        // unsandboxed execution reachable without any credentials.
        config.execution.allowedAuthors = ['alice'];
        const res = await app.inject({ method: 'POST', url: ROUTE, payload: {} });
        expect(res.statusCode).toBe(401);
    });

    it('rejects a malformed bearer token with 401', async () =>
    {
        config.execution.allowedAuthors = ['alice'];
        const res = await app.inject({
            method: 'POST', url: ROUTE, payload: {},
            headers: { authorization: 'Bearer not-a-real-jwt' },
        });
        expect(res.statusCode).toBe(401);
    });

    it('rejects a token signed with the wrong secret with 401', async () =>
    {
        config.execution.allowedAuthors = ['alice'];
        const other = Fastify();
        await other.register(import('@fastify/jwt'), { secret: 'a-different-secret' });
        await other.ready();
        const forged = other.jwt.sign({ sub: 'alice' });
        await other.close();

        const res = await app.inject({
            method: 'POST', url: ROUTE, payload: {},
            headers: { authorization: `Bearer ${forged}` },
        });
        expect(res.statusCode).toBe(401);
    });
});

describe('POST /scripts/published/execute — author allowlist', () =>
{
    it('is disabled by default: an authenticated caller still gets 403', async () =>
    {
        // The shipped default (empty allowlist) must be closed, so that a
        // self-hosted instance is not exploitable out of the box.
        expect(savedAuthors).toEqual([]);
        const res = await app.inject({
            method: 'POST', url: ROUTE, payload: {},
            headers: { authorization: `Bearer ${tokenFor('alice')}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toMatch(/disabled on this instance/i);
    });

    it('403s when the script author is not on the allowlist', async () =>
    {
        config.execution.allowedAuthors = ['trusted'];
        const res = await app.inject({
            method: 'POST', url: ROUTE, payload: {},
            headers: { authorization: `Bearer ${tokenFor('alice')}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toMatch(/not enabled for author 'alice'/i);
    });

    it('gates on the script author, not the caller', async () =>
    {
        // `bob` is allowlisted and is the caller, but the script belongs to
        // `alice` — whose code would run. That must still be refused.
        config.execution.allowedAuthors = ['bob'];
        const res = await app.inject({
            method: 'POST', url: ROUTE, payload: {},
            headers: { authorization: `Bearer ${tokenFor('bob')}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toMatch(/not enabled for author 'alice'/i);
    });

    it('matches the allowlist case-insensitively', async () =>
    {
        config.execution.allowedAuthors = ['alice'];
        const res = await app.inject({
            method: 'POST', url: '/scripts/published/execute/ALICE/mychair:1.0.0', payload: {},
            headers: { authorization: `Bearer ${tokenFor('alice')}` },
        });
        // Past the gates, so it fails later — on the missing script or the absent
        // execution pipeline — but crucially NOT with 401/403.
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
    });
});
