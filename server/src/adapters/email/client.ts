import { fetchJson, type FetchLike, type FetchOutcome } from '../../http/fetchJson.js';
import type { HornetConfig } from './config.js';

/**
 * Request shaping for the Hornetsecurity Control Panel API.
 *
 * Everything goes out through `http/fetchJson.ts`, which is the only way out of
 * this process and owns the six failure rules, the 5 MB cap and the SSRF floor.
 * There is no exemption here and there should never be one: `guards.test.ts`
 * fails the build on a bare `fetch(` anywhere in `server/src`, and an adapter
 * with its own error mapping has bypassed every rule the product's honesty
 * rests on.
 *
 * **The auth shape, measured rather than read off the docs.** Three things have
 * to be right together or the API answers with an error that describes a
 * different problem:
 *
 *   `Authorization: Token <t>`   NOT `Bearer`. A `Bearer` prefix returns
 *                                `400 error_id 1004 "Invalid header
 *                                information."`, which reads like a malformed
 *                                request and is actually an unrecognised auth
 *                                scheme.
 *   `APP-ID: <app_id>`           Required on every statistics and search
 *                                endpoint.
 *   `?object_id=<customer>`      Required on every call; it selects the
 *                                customer scope in the vendor's object
 *                                hierarchy.
 *
 * **Why POST for a read.** `/emails/_search/` and `/emails/statistics/…` are
 * POST endpoints that take their filter as a JSON body. Nothing here mutates
 * anything: the vendor's own write surface is `/emails/delete/`,
 * `/emails/deliver/…` and `/emails/mark/…`, and none of them is reachable from
 * this module. The repo's rule is that everything upstream is read-only, and
 * that is about the *effect*, not about the verb.
 */

/** The endpoints this adapter is allowed to call. A closed set, and a literal
 *  one: no part of any path is ever built from a value that came back from the
 *  vendor, from a route parameter, or from anything else outside this file. */
export const ENDPOINTS = Object.freeze({
  statisticsByType: '/emails/statistics/by_type/',
  search: '/emails/_search/',
} as const);

export type Endpoint = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

/**
 * The absolute URL for one call.
 *
 * `objectId` is interpolated through `URLSearchParams`, which encodes it —
 * belt and braces over `loadHornetConfig`'s decimal-only check, because a query
 * parameter assembled by string concatenation is how an injected `&` ends up
 * selecting somebody else's customer scope.
 */
export function hornetUrl(cfg: HornetConfig, path: Endpoint): string {
  const url = new URL(cfg.baseUrl + path);
  url.searchParams.set('object_id', cfg.objectId);
  return url.href;
}

/**
 * One authenticated POST, through the one door.
 *
 * The token is in a header and never in the URL: `fetchJson` puts a refused
 * target's URL into an error message, error messages reach `/api/health`, and a
 * credential in a query string ends up in a log the day this is deployed.
 */
export async function hornetPost<T>(
  cfg: HornetConfig,
  path: Endpoint,
  body: unknown,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<FetchOutcome<T>> {
  return fetchJson<T>(hornetUrl(cfg, path), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      authorization: `Token ${cfg.token}`,
      'app-id': cfg.appId,
      'content-type': 'application/json',
    },
    ...(opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl }),
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });
}

/**
 * The vendor's date format: ISO-8601 UTC with **no fractional seconds**.
 *
 * `2026-09-20T16:18:36Z`. Measured working; the millisecond form that
 * `Date#toISOString` produces was never confirmed accepted, and a validation
 * error from this API arrives as a 400 that `fetchJson` reports as a transport
 * failure — indistinguishable, from the panel, from the vendor being down. So
 * the format is pinned rather than left to the default.
 */
export function vendorTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
