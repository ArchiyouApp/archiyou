/**
 * Central API handler.
 *
 * - Auto-injects Bearer token from authService
 * - Base URL from SERVER_API_BASE_URL env var (set to the backend origin, e.g.
 *   http://localhost:4100 in dev — see apps/editor/.env). Defaults to '' (same origin).
 * - Throws ApiError on non-2xx responses
 */

import { authService } from './auth-service.js';
import { netFetch } from './network.js';

const BASE_URL = (import.meta.env.SERVER_API_BASE_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await authService.getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // netFetch: a server that is down / unreachable (or a refused CORS preflight)
  // throws a NetworkError carrying a readable message, instead of `TypeError:
  // Failed to fetch` reaching the UI.
  const response = await netFetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorBody: unknown;
    try { errorBody = await response.json(); } catch { errorBody = null; }
    throw new ApiError(response.status, errorBody);
  }

  // 204 No Content
  if (response.status === 204) return undefined as unknown as T;

  // A 2xx that isn't JSON means the request didn't reach the API (e.g. the dev
  // proxy fell through and Vite served index.html). Surface it instead of
  // letting `response.json()` throw an opaque SyntaxError downstream.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(
      response.status,
      `Expected JSON from ${path} but received "${contentType || 'unknown'}". ` +
      `The request likely did not reach the API server.`,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Absolute URL for an asset the API serves as a static file (script thumbnails —
 * see apps/server ThumbnailStore).
 *
 * Those URLs are stored root-relative ("/thumbnails/…"), which only resolves when
 * the frontend and the API share an origin. In dev they do not (editor :5173, API
 * :4100), so an `<img src="/thumbnails/…">` fetches the SPA's index.html instead,
 * the image errors, and the thumbnail silently disappears. Same for any split-host
 * deployment. Already-absolute and data: URLs pass through untouched.
 */
export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>('GET', path);
  },
  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>('POST', path, body);
  },
  put<T>(path: string, body: unknown): Promise<T> {
    return request<T>('PUT', path, body);
  },
  delete<T>(path: string): Promise<T> {
    return request<T>('DELETE', path);
  },
};
