/**
 * tests/unit/execute.gating.test.ts — access control on server-side execution.
 *
 * POST /scripts/published/execute/:user/:scriptAndVersion reaches the Runner,
 * which compiles script source with `new AsyncFunction` and runs it in-process
 * with full Node capability — there is no sandbox. Two independent ways in stand in
 * front of it, both off by default, and both are asserted here:
 *
 *   1. AUTHOR ALLOWLIST — authentication is mandatory (the route was anonymous
 *      before) and the script's author must be on config.execution.allowedAuthors,
 *      which is empty by default.
 *   2. ADMIN-VALIDATED SCRIPT — config.execution.allowValidated plus
 *      `published.validated` on that one version. The caller may be anonymous here,
 *      because a published configurator's visitor has no account.
 *
 * The ordering property in (1) is load-bearing and asserted below: with the
 * validated path off, a request is refused before ScriptStore is consulted at all
 * (deny before doing any work). Only when it is on must the row be read first —
 * that is where `validated` lives.
 *
 * Registered in isolation with a JWT plugin, a stubbed store and no Redis, so a
 * request that gets *past* both gates surfaces as 503 (no executionManager).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

import type { ScriptData } from '@archiyou/core/src/execution/types';

// Stubbed so the route can be exercised with no SQLite file and no modules directory.
// These three are the only reason importing the route would otherwise open a database.
vi.mock('../../src/services/ScriptStore', () => ({
    scriptStore: { getPublished: vi.fn(() => null) },
}));
vi.mock('../../src/services/UserService', () => ({
    userService: { getModules: vi.fn(() => []) },
}));
vi.mock('../../src/modules/ModuleHost', () => ({
    moduleHost: { catalogFor: vi.fn(() => []) },
}));

import { registerExecuteRoutes } from '../../src/routes/execute';
import { scriptStore } from '../../src/services/ScriptStore';
import { config } from '../../src/config';

const getPublished = vi.mocked(scriptStore.getPublished);

/** A stored published version, as ScriptStore would hand it back. */
function publishedScript(validated: boolean): ScriptData
{
    return {
        id: 'v1', fileId: 'f1', author: 'alice', name: 'mychair', version: '1.0.0',
        code: 'box(10,10,10);',
        published: { public: true, validated, fulfillments: [] },
    } as ScriptData;
}

const SECRET = 'test-secret-for-execute-gating';
const ROUTE = '/scripts/published/execute/alice/mychair:1.0.0';

let app: FastifyInstance;
const savedAuthors = [...config.execution.allowedAuthors];
const savedAllowValidated = config.execution.allowValidated;

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
    config.execution.allowValidated = false;
    getPublished.mockReset();
    getPublished.mockReturnValue(null);
    app = await buildApp();
});

afterEach(async () =>
{
    config.execution.allowedAuthors = savedAuthors;
    config.execution.allowValidated = savedAllowValidated;
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

describe('POST /scripts/published/execute — admin-validated scripts', () =>
{
    it('runs a validated script for an ANONYMOUS caller', async () =>
    {
        // The point of the whole feature: a configurator visitor has no account.
        config.execution.allowValidated = true;
        getPublished.mockReturnValue(publishedScript(true));

        const res = await app.inject({ method: 'POST', url: ROUTE, payload: {} });
        // Past both gates; dies on the absent execution pipeline instead.
        expect(res.statusCode).toBe(503);
    });

    it('refuses an anonymous caller when the version is NOT validated', async () =>
    {
        config.execution.allowValidated = true;
        getPublished.mockReturnValue(publishedScript(false));

        const res = await app.inject({ method: 'POST', url: ROUTE, payload: {} });
        expect(res.statusCode).toBe(401);
    });

    it('treats a published version with no validated key as unvalidated', async () =>
    {
        // Rows predating the feature. ScriptStore normalises this to false on read,
        // but the route must not depend on that having happened.
        config.execution.allowValidated = true;
        getPublished.mockReturnValue({
            id: 'v1', fileId: 'f1', author: 'alice', name: 'mychair', version: '1.0.0',
            code: 'box(10,10,10);',
            published: { public: true, fulfillments: [] },
        } as ScriptData);

        const res = await app.inject({ method: 'POST', url: ROUTE, payload: {} });
        expect(res.statusCode).toBe(401);
    });

    it('ignores `validated` entirely while the master switch is off', async () =>
    {
        // A validated row must not open the door on an instance that never turned the
        // feature on — and the store must not even be consulted.
        config.execution.allowValidated = false;
        config.execution.allowedAuthors = ['trusted'];
        getPublished.mockReturnValue(publishedScript(true));

        const res = await app.inject({ method: 'POST', url: ROUTE, payload: {} });
        expect(res.statusCode).toBe(401);
        expect(getPublished).not.toHaveBeenCalled();
    });

    it('denies before touching the store when the validated path is off', async () =>
    {
        // Regression guard on the ordering: reading the row first for every request
        // would let an anonymous caller drive a DB lookup per request.
        config.execution.allowedAuthors = ['trusted'];
        const res = await app.inject({
            method: 'POST', url: ROUTE, payload: {},
            headers: { authorization: `Bearer ${tokenFor('alice')}` },
        });
        expect(res.statusCode).toBe(403);
        expect(getPublished).not.toHaveBeenCalled();
    });

    it('404s an unknown script on the validated path', async () =>
    {
        config.execution.allowValidated = true;
        getPublished.mockReturnValue(null);

        const res = await app.inject({ method: 'POST', url: ROUTE, payload: {} });
        expect(res.statusCode).toBe(404);
    });

    it('still honours the author allowlist when the validated switch is on', async () =>
    {
        // The two paths are OR'd: an allowlisted author does not need validation.
        config.execution.allowValidated = true;
        config.execution.allowedAuthors = ['alice'];
        getPublished.mockReturnValue(publishedScript(false));

        const res = await app.inject({
            method: 'POST', url: ROUTE, payload: {},
            headers: { authorization: `Bearer ${tokenFor('alice')}` },
        });
        expect(res.statusCode).toBe(503);
    });

    it('reports the feature as disabled only when BOTH switches are off', async () =>
    {
        const res = await app.inject({ method: 'POST', url: ROUTE, payload: {} });
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toMatch(/disabled on this instance/i);
        expect(getPublished).not.toHaveBeenCalled();
    });
});
