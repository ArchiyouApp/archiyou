/**
 * routes/proxy.ts — the asset proxy behind editor `$import()`.
 *
 * Browser scripts run in a Web Worker and cannot fetch arbitrary cross-origin
 * assets (CORS). This route fetches the remote URL server-side and streams the
 * bytes back with permissive CORS, so `$import('https://…/logo.svg')` works.
 *
 * It is intentionally OPEN (no auth) but guarded against abuse:
 *   - http/https only; optional hostname allowlist (config.proxy.allowlist).
 *   - SSRF: every hop's host is DNS-resolved and rejected if it maps to a
 *     loopback/private/link-local address (defeats hitting internal services and
 *     most DNS-rebinding). Redirects are followed manually and revalidated.
 *   - Size cap (config.proxy.maxBytes) enforced on Content-Length AND while
 *     streaming (defends against missing/lying Content-Length).
 *   - Per-request timeout (config.proxy.timeoutMs) via AbortController.
 *   - Per-IP fixed-window rate limit (config.proxy.rateLimit / rateWindowMs).
 *   - No client cookies/auth forwarded upstream.
 *
 * The upstream Content-Type is echoed verbatim — the core importer uses it as
 * the primary format signal for extension-less API responses. That means this
 * route can be made to serve attacker-chosen content types from OUR origin, and
 * in the recommended single-host deployment (editor at `/`, API at `/api/*`) that
 * origin is the app's own — where the CSP must allow 'unsafe-inline' for the
 * Runner. A proxied HTML document would therefore execute as first-party script.
 *
 * So the bytes are echoed but declawed on the way out (see RESPONSE_GUARD_HEADERS):
 * `nosniff` stops a mislabelled body being re-interpreted, `CSP: sandbox` denies
 * script execution and same-origin identity if the URL is ever navigated to or
 * framed, and `Content-Disposition: attachment` makes navigation download rather
 * than render. None of the three is visible to `fetch()`, which is how every real
 * consumer reads this route (Importer.fetch, docs/Image.loadImageData), so the
 * format signal survives intact.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { config } from '../config';

/** True for IPs we must never let the proxy reach (loopback, private, link-local, etc.). */
function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP → block
}

function isBlockedIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                         // 0.0.0.0/8 "this host"
  if (a === 127) return true;                       // loopback
  if (a === 10) return true;                        // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;          // private
  if (a === 169 && b === 254) return true;          // link-local
  if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT 100.64/10
  if (a >= 224) return true;                         // multicast + reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;                 // unspecified / loopback
  if (v.startsWith('fe80') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true; // link-local fe80::/10
  if (v.startsWith('fc') || v.startsWith('fd')) return true;  // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

/** Validate a candidate URL and confirm its host resolves only to public IPs.
 *  Returns the parsed URL or throws a ProxyError. */
async function assertFetchable(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProxyError(400, `Invalid url: '${raw}'`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError(400, `Only http(s) URLs are allowed (got '${url.protocol}').`);
  }

  const host = url.hostname.toLowerCase();

  if (config.proxy.allowlist.length > 0 && !config.proxy.allowlist.includes(host)) {
    throw new ProxyError(403, `Host '${host}' is not in the proxy allowlist.`);
  }

  // If the host is a literal IP, check it directly; otherwise resolve every A/AAAA.
  const literal = isIP(host);
  const addresses = literal
    ? [host]
    : (await safeLookup(host)).map((a) => a.address);

  if (addresses.length === 0) {
    throw new ProxyError(502, `Could not resolve host '${host}'.`);
  }
  for (const ip of addresses) {
    if (isBlockedIp(ip)) {
      throw new ProxyError(403, `Host '${host}' resolves to a blocked address.`);
    }
  }

  return url;
}

async function safeLookup(host: string): Promise<Array<{ address: string }>> {
  try {
    return await lookup(host, { all: true });
  } catch {
    throw new ProxyError(502, `Could not resolve host '${host}'.`);
  }
}

/**
 * Sent on every proxy response, success or failure. Static, because a guarantee
 * that depends on correctly classifying the upstream content type is not one.
 */
const RESPONSE_GUARD_HEADERS: Record<string, string> = {
  // Never let a body be re-sniffed into something more dangerous than its label.
  'X-Content-Type-Options': 'nosniff',
  // `sandbox` with no allow-list: no scripts, no plugins, no same-origin identity,
  // no top-level navigation. Mirrors what plugin.ts serves thumbnails with.
  'Content-Security-Policy': "default-src 'none'; sandbox",
  // Navigating here downloads instead of rendering. `fetch()` ignores this.
  'Content-Disposition': 'attachment',
};

class ProxyError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

//// Rate limiting (per-IP fixed window, in-memory) ////

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + config.proxy.rateWindowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > config.proxy.rateLimit;
}

/** Test-only: clear the per-IP rate-limit state between cases. */
export function _resetProxyState(): void {
  rateBuckets.clear();
}

// Opportunistically evict expired buckets so the map does not grow unbounded.
function sweepBuckets(): void {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now >= b.resetAt) rateBuckets.delete(ip);
  }
}

//// Fetch with manual, SSRF-revalidated redirects + size/time caps ////

async function fetchAsset(startUrl: URL): Promise<{ body: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.proxy.timeoutMs);

  try {
    let url = startUrl;
    for (let hop = 0; hop <= config.proxy.maxRedirects; hop++) {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: '*/*', 'User-Agent': 'Archiyou-AssetProxy/1.0' },
      });

      // Manual redirect handling so each hop is revalidated against SSRF rules.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new ProxyError(502, `Redirect with no Location from '${url.href}'.`);
        if (hop === config.proxy.maxRedirects) {
          throw new ProxyError(502, `Too many redirects (>${config.proxy.maxRedirects}).`);
        }
        url = await assertFetchable(new URL(location, url).href);
        continue;
      }

      if (!res.ok) {
        throw new ProxyError(res.status === 404 ? 404 : 502, `Upstream responded ${res.status} for '${url.href}'.`);
      }

      const declared = Number(res.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > config.proxy.maxBytes) {
        throw new ProxyError(413, `Asset exceeds the ${config.proxy.maxBytes}-byte cap (declared ${declared}).`);
      }

      const body = await readCapped(res, config.proxy.maxBytes);
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      return { body, contentType };
    }
    throw new ProxyError(502, `Too many redirects (>${config.proxy.maxRedirects}).`);
  } catch (err) {
    if (err instanceof ProxyError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new ProxyError(504, `Upstream timed out after ${config.proxy.timeoutMs}ms.`);
    }
    throw new ProxyError(502, `Fetch failed: ${(err as Error)?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Read a response body into a Buffer, aborting if it exceeds `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new ProxyError(413, `Asset exceeds the ${max}-byte cap.`);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new ProxyError(413, `Asset exceeds the ${max}-byte cap.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function registerProxyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { url?: string } }>(
    '/proxy',
    async (request: FastifyRequest<{ Querystring: { url?: string } }>, reply: FastifyReply) => {
      const raw = request.query.url;
      if (!raw) {
        return reply.headers(RESPONSE_GUARD_HEADERS)
          .code(400).send({ success: false, error: "Missing 'url' query parameter." });
      }

      sweepBuckets();
      if (rateLimited(request.ip)) {
        return reply.headers(RESPONSE_GUARD_HEADERS)
          .code(429).send({ success: false, error: 'Rate limit exceeded. Slow down.' });
      }

      try {
        const url = await assertFetchable(raw);
        const { body, contentType } = await fetchAsset(url);
        return reply
          .headers(RESPONSE_GUARD_HEADERS)
          .header('Content-Type', contentType)
          .header('Access-Control-Allow-Origin', '*')
          .header('Cache-Control', 'public, max-age=300')
          .header('X-Proxied-From', url.href)
          .send(body);
      } catch (err) {
        reply.headers(RESPONSE_GUARD_HEADERS);
        if (err instanceof ProxyError) {
          return reply.code(err.statusCode).send({ success: false, error: err.message });
        }
        request.log.error(err);
        return reply.code(502).send({ success: false, error: 'Asset proxy failed.' });
      }
    },
  );
}
