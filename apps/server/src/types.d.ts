/**
 * Fastify JWT payload/user typing. The `user` on a request is our decoded
 * session token; `payload` is what we sign.
 */
import '@fastify/jwt';
import type { AuthTokenClaims, ResetTokenClaims, VerifyTokenClaims } from '@archiyou/types';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // Three kinds of token are signed with the same secret, each distinguished by
    // a `type` claim that its consumer checks (see routes/auth.ts):
    //   AuthTokenClaims    session token   (no `type`; `sub` is the handle)
    //   ResetTokenClaims   password reset  (type: 'reset',  single-use via `pfp`)
    //   VerifyTokenClaims  email confirm   (type: 'verify', bound to the address)
    // Keep this union in step with what auth.ts signs, or signing a new kind of
    // token fails to typecheck.
    payload: AuthTokenClaims | ResetTokenClaims | VerifyTokenClaims;
    user: AuthTokenClaims;
  }
}
