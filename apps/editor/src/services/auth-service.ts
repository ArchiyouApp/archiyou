/**
 * auth-service — JWT session client for the Archiyou server (apps/server).
 *
 * Replaces the previous oidc-client-ts scaffold: our server is the identity
 * provider. Email/password + Google OAuth all resolve to one of our JWTs,
 * which we persist in localStorage and send as `Authorization: Bearer` (see
 * api.ts). `currentUser` is a signal so the UI reacts to sign-in/out.
 *
 * This module deliberately imports neither core state nor api.ts, so it sits
 * at the bottom of the dependency graph (api.ts and core derive from it).
 */

import { signal } from '@lit-labs/signals';
import type { AuthResponse, PublicUser } from '@archiyou/types';

import { netFetch } from './network.js';

const API_BASE = (import.meta.env.SERVER_API_BASE_URL as string | undefined) ?? '';
const TOKEN_KEY = 'archiyou:auth:token';

let _token: string | null = null;
try { _token = localStorage.getItem(TOKEN_KEY); } catch { /* storage unavailable */ }

/** The signed-in user, or null when anonymous. */
export const currentUser = signal<PublicUser | null>(null);

function setToken(t: string | null): void {
  _token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

async function post(path: string, body: unknown): Promise<AuthResponse> {
  const res = await netFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<AuthResponse>;
}

export const authService = {
  /** Email/password sign-in. */
  async login(email: string, password: string): Promise<PublicUser> {
    const { token, user } = await post('/auth/login', { email, password });
    setToken(token);
    currentUser.set(user);
    return user;
  },

  /** Email/password registration. */
  async register(email: string, password: string, name?: string): Promise<PublicUser> {
    const { token, user } = await post('/auth/register', { email, password, name });
    setToken(token);
    currentUser.set(user);
    return user;
  },

  /** Request a password-reset email. The server always answers 200 (it never
   *  reveals whether the account exists), so this resolves for any valid input. */
  async forgotPassword(email: string): Promise<void> {
    const res = await netFetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
      throw new Error(message);
    }
  },

  /** Complete a password reset with the emailed token; signs the user straight in. */
  async resetPassword(token: string, password: string): Promise<PublicUser> {
    const { token: jwt, user } = await post('/auth/reset-password', { token, password });
    setToken(jwt);
    currentUser.set(user);
    return user;
  },

  /** Confirm an email address with the token from the verification email. The
   *  server returns a fresh session token so `currentUser.emailVerified` flips
   *  without needing a re-login. */
  async verifyEmail(token: string): Promise<PublicUser> {
    const { token: jwt, user } = await post('/auth/verify-email', { token });
    setToken(jwt);
    currentUser.set(user);
    return user;
  },

  /** Ask the server to re-send the confirmation email to the signed-in user's
   *  address. Resolves true when the address was already verified. */
  async resendVerification(): Promise<boolean> {
    const res = await netFetch(`${API_BASE}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(_token ? { Authorization: `Bearer ${_token}` } : {}) },
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
      throw new Error(message);
    }
    const body = await res.json().catch(() => ({}));
    return body?.alreadyVerified === true;
  },

  /** Redirect to the server's Google OAuth entry point. */
  loginWithGoogle(): void {
    window.location.href = `${API_BASE}/auth/google`;
  },

  /** Handle the OAuth redirect back to /callback (token or error in the hash). */
  async callback(): Promise<PublicUser> {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const err = params.get('error');
    if (err) throw new Error(err);
    const token = params.get('token');
    if (!token) throw new Error('missing_token');
    setToken(token);
    const user = await this.refresh();
    if (!user) throw new Error('token_rejected');
    return user;
  },

  /** Validate the stored token against /auth/me and refresh currentUser. */
  async refresh(): Promise<PublicUser | null> {
    if (!_token) { currentUser.set(null); return null; }
    try {
      const res = await netFetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${_token}` } });
      if (!res.ok) { setToken(null); currentUser.set(null); return null; }
      const user = (await res.json()) as PublicUser;
      currentUser.set(user);
      return user;
    } catch {
      // Network/server down — keep the token but stay anonymous for now.
      currentUser.set(null);
      return null;
    }
  },

  logout(): void {
    setToken(null);
    currentUser.set(null);
  },

  getToken(): Promise<string | null> {
    return Promise.resolve(_token);
  },

  getUser(): PublicUser | null {
    return currentUser.get();
  },

  isAuthenticated(): boolean {
    return !!_token;
  },
};

// Restore the session on load (validates the persisted token in the background).
// Exposed as a promise so callers that need the handle (e.g. resolving a script
// deep link on a cold load) can await the restore instead of racing it.
export const authReady: Promise<PublicUser | null> = authService.refresh();
