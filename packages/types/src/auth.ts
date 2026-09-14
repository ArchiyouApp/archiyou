/**
 * auth.ts — shared auth DTOs (TypeBox schemas + derived TS types).
 *
 * Single source of truth for the request/response shapes exchanged between
 * apps/editor and apps/server. The server validates requests with these
 * schemas (Check/Errors from 'typebox/value'); the editor imports the derived
 * types for its API client.
 */

import { Type, type Static } from 'typebox';

//// REQUESTS ////

export const RegisterRequestSchema = Type.Object({
  email: Type.String({ format: 'email', minLength: 3 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
  name: Type.Optional(Type.String({ maxLength: 200 })),
});
export type RegisterRequest = Static<typeof RegisterRequestSchema>;

export const LoginRequestSchema = Type.Object({
  // Login identifier: an email address OR a username handle. Kept named `email`
  // for backward compatibility with the editor client.
  email: Type.String({ minLength: 3 }),
  password: Type.String({ minLength: 1 }),
});
export type LoginRequest = Static<typeof LoginRequestSchema>;

/** Request a password-reset email. Always answered with 200 (no account enumeration). */
export const ForgotPasswordRequestSchema = Type.Object({
  email: Type.String({ minLength: 3 }),
});
export type ForgotPasswordRequest = Static<typeof ForgotPasswordRequestSchema>;

/** Complete a reset with the emailed token + a new password. Returns an AuthResponse
 *  (the user is signed straight in). */
export const ResetPasswordRequestSchema = Type.Object({
  token: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
});
export type ResetPasswordRequest = Static<typeof ResetPasswordRequestSchema>;

/** Confirm an email address with the token from the verification email. */
export const VerifyEmailRequestSchema = Type.Object({
  token: Type.String({ minLength: 1 }),
});
export type VerifyEmailRequest = Static<typeof VerifyEmailRequestSchema>;

//// RESPONSES ////

/** The safe, client-facing view of a user (never includes passwordHash). */
export const PublicUserSchema = Type.Object({
  id: Type.String(),
  email: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
  emailVerified: Type.Boolean(),
  /** Ids of the gated script modules this account may use (see modules/README.md).
   *  Lets the editor show a module as unlocked; it is never the authority — the
   *  server re-checks the database on every bundle fetch and module call. */
  modules: Type.Array(Type.String()),
  /** Operator account: the editor shows the Admin entry and lets /admin render.
   *  Presentation only — every admin route re-reads the column (routes/admin.ts),
   *  so a stale value here buys nothing. */
  isAdmin: Type.Boolean(),
});
export type PublicUser = Static<typeof PublicUserSchema>;

export const AuthResponseSchema = Type.Object({
  token: Type.String(),
  user: PublicUserSchema,
});
export type AuthResponse = Static<typeof AuthResponseSchema>;

/** JWT payload we sign for our own session tokens. */
export interface AuthTokenClaims {
  sub: string; // user id
  email: string | null;
  name: string | null;
}

/** JWT payload for a password-reset link — a distinct, short-lived token kind.
 *  `pfp` fingerprints the password hash at issue time so the link is single-use. */
export interface ResetTokenClaims {
  sub: string;      // user id
  type: 'reset';
  pfp: string;      // fingerprint of the password hash at issue time
}

/** JWT payload for an email-verification link. `type` keeps it from being usable
 *  as a session or reset token, and `email` binds it to the address that was
 *  confirmed, so a pending link stops working if the address changes. */
export interface VerifyTokenClaims {
  sub: string;      // user id
  type: 'verify';
  email: string;    // address being confirmed
}
