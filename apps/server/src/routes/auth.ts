/**
 * routes/auth.ts — email/password registration + login over the users table.
 *
 * The JWT `sub` is the user's handle (== script `author`), so script routes
 * scope ownership by it. Google OAuth is not wired in this build; the button
 * bounces back to /login with an error rather than hitting a dead route.
 */

import type { FastifyInstance } from 'fastify';

import {
  RegisterRequestSchema,
  LoginRequestSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  VerifyEmailRequestSchema,
  type AuthResponse,
  type AuthTokenClaims,
  type ResetTokenClaims,
  type VerifyTokenClaims,
} from '@archiyou/types';

import { config } from '../config';
import { parse } from '../validate';
import { userService, toPublicUser, UserError } from '../services/UserService';
import { emailService } from '../services/EmailService';
import type { UserRow } from '../db/schema';

/**
 * Session token lifetime. Shortened from 30 days: these are stateless JWTs with
 * no revocation list, so a stolen token is valid for its full TTL and there is no
 * way to invalidate it. 7 days keeps the "stay signed in" feel while cutting the
 * exposure window fourfold. Proper refresh + revocation is tracked as follow-up.
 */
const TOKEN_TTL = '7d';
/** Password-reset token: short-lived, purpose-scoped, and tied to the current
 *  password hash (`pfp`) so it can't be reused once the password changes. */
const RESET_TOKEN_TTL = '1h';
/** Email-verification token: purpose-scoped and bound to the address. Longer
 *  than a reset because the user may not read mail immediately. */
const VERIFY_TOKEN_TTL = '24h';

/** Last 10 chars of the bcrypt hash — a stable per-password fingerprint. */
function pwFingerprint(passwordHash: string): string {
  return passwordHash.slice(-10);
}

function issue(fastify: FastifyInstance, user: UserRow): AuthResponse {
  const claims: AuthTokenClaims = { sub: user.username, email: user.email, name: user.name };
  const token = fastify.jwt.sign(claims, { expiresIn: TOKEN_TTL });
  return { token, user: toPublicUser(user) };
}

/** Mint a verification link and email it. Failures inside the EmailService are
 *  swallowed there, so this never breaks the surrounding request. */
async function sendVerification(fastify: FastifyInstance, user: UserRow): Promise<void> {
  const claims: VerifyTokenClaims = { sub: user.id, type: 'verify', email: user.email };
  const token = fastify.jwt.sign(claims, { expiresIn: VERIFY_TOKEN_TTL });
  const link = `${config.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await emailService.sendEmailVerification(user.email, link);
}

export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Per-IP throttle for the credential endpoints. @fastify/rate-limit is
   * registered with `global: false` (see plugin.ts), so only routes carrying this
   * opt in. Guards password brute-force on /auth/login and mail-bombing via the
   * forgot-password and resend-verification routes.
   */
  const throttled = { config: { rateLimit: config.authRateLimit } };

  fastify.post('/auth/register', throttled, async (request) => {
    const { email, password, name } = parse(RegisterRequestSchema, request.body);
    const user = await userService.register(email, password, name);
    // Sign the user straight in (unchanged UX) but send the confirmation mail.
    // The account works immediately; only publish/share need a verified address.
    await sendVerification(fastify, user);
    return issue(fastify, user);
  });

  fastify.post('/auth/login', throttled, async (request) => {
    // `email` is the login identifier — an email address OR a username handle.
    const { email, password } = parse(LoginRequestSchema, request.body);
    const user = await userService.login(email, password);
    return issue(fastify, user);
  });

  // Request a reset email. Always answers 200 with the same body so it never
  // reveals whether an account exists for the address.
  fastify.post('/auth/forgot-password', throttled, async (request) => {
    const { email } = parse(ForgotPasswordRequestSchema, request.body);
    const user = await userService.findByEmail(email);
    if (user) {
      const token = fastify.jwt.sign(
        { sub: user.id, type: 'reset', pfp: pwFingerprint(user.passwordHash) },
        { expiresIn: RESET_TOKEN_TTL },
      );
      const link = `${config.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
      await emailService.sendPasswordReset(user.email, link);
    }
    return { success: true };
  });

  // Complete a reset with the emailed token + a new password, then sign the user in.
  fastify.post('/auth/reset-password', throttled, async (request) => {
    const { token, password } = parse(ResetPasswordRequestSchema, request.body);

    let claims: ResetTokenClaims;
    try {
      claims = fastify.jwt.verify(token) as ResetTokenClaims;
    } catch {
      throw new UserError('invalid_token', 'This reset link is invalid or has expired');
    }

    const user = claims.type === 'reset' ? await userService.findById(claims.sub) : undefined;
    // pfp mismatch ⇒ the link was already used or superseded by a newer password.
    if (!user || claims.pfp !== pwFingerprint(user.passwordHash)) {
      throw new UserError('invalid_token', 'This reset link is invalid or has expired');
    }

    await userService.setPassword(user.id, password);
    return issue(fastify, user);
  });

  // Confirm an email address with the emailed token. Idempotent, and answers 200
  // when the address is already verified so a double-clicked link is not an error.
  fastify.post('/auth/verify-email', throttled, async (request) => {
    const { token } = parse(VerifyEmailRequestSchema, request.body);

    let claims: VerifyTokenClaims;
    try {
      claims = fastify.jwt.verify(token) as VerifyTokenClaims;
    } catch {
      throw new UserError('invalid_token', 'This verification link is invalid or has expired');
    }

    // `type` is what stops a session or reset token being replayed here.
    const user = claims.type === 'verify' ? await userService.findById(claims.sub) : undefined;
    // Bound to the address: if the account's email changed after the link was
    // issued, the stale link must not confirm the new address.
    if (!user || claims.email !== user.email) {
      throw new UserError('invalid_token', 'This verification link is invalid or has expired');
    }

    await userService.markEmailVerified(user.id);
    const updated = (await userService.findById(user.id)) ?? user;
    // Return a fresh session token so the client picks up emailVerified: true.
    return issue(fastify, updated);
  });

  // Re-send the confirmation mail to the signed-in user's address. Authenticated
  // (so it cannot be used to mail arbitrary addresses) and throttled (so it
  // cannot be used to flood the owner's inbox).
  fastify.post(
    '/auth/resend-verification',
    { preHandler: fastify.authenticate, config: { rateLimit: config.authRateLimit } },
    async (request, reply) => {
      const user = await userService.findByUsername(request.user.sub);
      if (!user) return reply.code(404).send({ success: false, error: 'User not found' });
      if (user.emailVerifiedAt !== null) return { success: true, alreadyVerified: true };
      await sendVerification(fastify, user);
      return { success: true, alreadyVerified: false };
    },
  );

  // Stateless JWT — logout is client-side (drop the token). Endpoint for symmetry.
  fastify.post('/auth/logout', async () => ({ success: true }));

  fastify.get('/auth/me', { preHandler: fastify.authenticate }, async (request, reply) => {
    const user = await userService.findByUsername(request.user.sub);
    if (!user) return reply.code(404).send({ success: false, error: 'User not found' });
    return toPublicUser(user);
  });

  // Google OAuth is not configured in this build. Bounce gracefully so the
  // client's "Continue with Google" button doesn't hit a dead route.
  fastify.get('/auth/google', async (_request, reply) => {
    return reply.redirect(`${config.frontendUrl}/callback#error=google_not_configured`);
  });
}
