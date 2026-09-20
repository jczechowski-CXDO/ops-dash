import type { SourceResult } from '@ops-dash/shared';
import { refuseTarget } from './safeTarget.js';
import { describeThrown } from './describeThrown.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The body cap, and why a cap exists at all.
 *
 * 5 MB is about fifty times the largest thing we actually fetch — Zendesk's
 * `incidents.json` is the biggest, at 45 KB live. The old code did
 * `await response.text()`, buffering the whole response with no check. Measured
 * against a server streaming 300 MB of JSON: 1.29 GB of RSS in 1.0 second on
 * loopback. The 10s timeout is no defence, because the timeout bounds the
 * REQUEST and a fast server delivers gigabytes inside it.
 *
 * What makes that a real finding rather than a theoretical one is what happens
 * next: the process dies, nothing restarts it, and the dashboard's last state
 * stays on screen looking exactly like a healthy one. A monitoring tool that
 * dies silently is this product's own thesis turned against itself.
 */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** How many redirects to follow before giving up. Three is generous for a
 *  status feed; the real ones use zero or one. */
const MAX_REDIRECTS = 3;

/**
 * The one way this server talks to anything.
 *
 * Returns a `SourceResult<T>` rather than throwing, because "the feed is
 * broken" is **data the UI has to render**, not an exception for the poller to
 * swallow. Every rule the product's honesty depends on lives here, once:
 *
 *   non-2xx                  -> error, code `http_<status>`
 *   2xx carrying non-JSON    -> error, code `non_json_2xx`   (amendment 7)
 *   2xx with no records      -> empty: true, NEVER operational (amendment 4)
 *   transport threw          -> error, code `network` or `timeout`
 *   body over the cap        -> error, code `body_too_large`
 *   target or redirect unsafe-> error, code from `refuseTarget`
 *
 * These are per-transport, not per-vendor, which is why they are not in each
 * adapter. `guards.test.ts` fails the build on a bare `fetch(` anywhere else in
 * `server/src`, because an adapter with its own error mapping has bypassed all
 * four — and the likeliest symptom is the one below.
 *
 * The non-JSON-under-200 rule is not defensive programming. EPC's
 * `/api/1.4/common/groups` returns HTTP 200 with a Zoho sign-in page when the
 * token has expired, so an adapter that trusts the status code reports a
 * successful poll of zero records. Proven on this tenant.
 */

export async function fetchJson<T>(
  url: string,
  opts: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    maxBytes?: number;
    /** POST exists for exactly one caller: the OAuth token endpoint, which is a
     *  form POST. It is here rather than in a second helper so that the four
     *  failure rules, the body cap and the SSRF floor apply to the most
     *  security-sensitive request this process makes. A second way out to the
     *  network, however small, is a second place for them not to apply. */
    method?: 'GET' | 'POST';
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<SourceResult<T>> {
  const { fetchImpl = fetch, timeoutMs = 10_000, maxBytes = MAX_BODY_BYTES, method = 'GET', body: reqBody, headers: extraHeaders } = opts;
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let target = url;
    let response: Response;

    // `redirect: 'manual'` and our own loop, because `follow` validates nothing.
    // The https floor in `vendors.json` checks the URL we TYPED; a `Location`
    // header chooses the URL we actually open, and a vendor who can set one can
    // send this process anywhere reachable from this machine — including
    // 127.0.0.1, over plain http, with the body coming back as a clean
    // un-degraded SourceResult indistinguishable from a good read. Reproduced
    // before this was written.
    for (let hop = 0; ; hop += 1) {
      const refusal = refuseTarget(target);
      if (refusal) {
        return err(fetchedAt, refusal.code, hop === 0 ? refusal.message : `redirect ${hop}: ${refusal.message}`);
      }

      response = await fetchImpl(target, {
        method,
        signal: controller.signal,
        headers: { accept: 'application/json', ...extraHeaders },
        redirect: 'manual',
        // A redirect on a POST is not followed with the body re-sent — the loop
        // below only re-dials, and re-sending a signed assertion to a location
        // a server chose is how a credential ends up somewhere it should not be.
        ...(reqBody === undefined ? {} : { body: reqBody }),
      });

      if (!isRedirect(response.status)) break;

      if (method !== 'GET') {
        // Never replay a non-GET to a redirect target. For the token endpoint
        // that body is a signed client assertion, and a vendor-chosen
        // `Location` must not receive it.
        return err(fetchedAt, 'redirect_on_write', `${response.status} redirect on a ${method}; not followed`);
      }
      if (hop >= MAX_REDIRECTS) {
        return err(fetchedAt, 'too_many_redirects', `more than ${MAX_REDIRECTS} redirects`);
      }
      const location = response.headers.get('location');
      if (!location) {
        return err(fetchedAt, `http_${response.status}`, `${response.status} with no Location header`);
      }
      // Resolved against the current target, so a relative Location works — and
      // is then re-validated like any other, rather than inheriting trust from
      // the URL it was relative to.
      await response.body?.cancel().catch(() => undefined);
      target = new URL(location, target).href;
    }

    if (!response.ok) {
      return err(fetchedAt, `http_${response.status}`, `${response.status} ${response.statusText}`);
    }

    const read = await readCapped(response, maxBytes);
    if (read.tooLarge) {
      return err(fetchedAt, 'body_too_large', `body exceeded the ${maxBytes} byte cap`);
    }
    const body = read.text;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Deliberately does NOT echo the body. A hostile or misrouted feed's
      // payload should travel no further than it has to, and an HTML sign-in
      // page in a log line is noise at best.
      return err(
        fetchedAt,
        'non_json_2xx',
        `${response.status} carried ${body.length} bytes that are not JSON`,
      );
    }

    if (parsed === null || parsed === undefined) {
      return err(fetchedAt, 'null_body', 'a JSON null is not a payload');
    }

    // `empty` is a completed fetch that returned no records. It is NOT an
    // assertion of health, and nothing downstream may infer `operational` from
    // it — that is amendment 4, and Zendesk is the reason it exists.
    const empty = Array.isArray(parsed)
      ? parsed.length === 0
      : typeof parsed === 'object' && Object.keys(parsed as object).length === 0;

    return { data: parsed as T, fetchedAt, degraded: false, ...(empty ? { empty: true } : {}) };
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return err(
      fetchedAt,
      aborted ? 'timeout' : 'network',
      aborted ? `no response within ${timeoutMs}ms` : describeThrown(cause),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** The statuses that carry a `Location`. 304 is deliberately absent: it is a
 *  cache response, not a redirect, and following it is meaningless. */
function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Read a body, refusing to buffer more than `maxBytes`.
 *
 * Streamed and counted rather than `await response.text()` then checking the
 * length — by the time `text()` resolves the memory is already spent, which is
 * the entire failure being prevented. `content-length` is checked first as a
 * cheap reject but never trusted as the only check: a chunked response has none,
 * and a hostile one can lie.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ tooLarge: true } | { tooLarge: false; text: string }> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return { tooLarge: true };
  }

  const stream = response.body;
  // A stubbed Response in a test may have no stream. Falling back to `text()`
  // is safe there for the same reason it is not safe in production: the stub's
  // body is one we wrote.
  if (!stream) return { tooLarge: false, text: await response.text() };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling immediately. Cancelling the stream also tells the peer we
        // are done, so a server streaming forever does not keep a socket warm.
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return { tooLarge: false, text: new TextDecoder().decode(joined) };
}

function err<T>(fetchedAt: string, code: string, message: string): SourceResult<T> {
  // No `data` key at all rather than `data: undefined` —
  // exactOptionalPropertyTypes makes those different types, and a consumer
  // destructuring `data` should get nothing rather than a present-but-empty
  // field it might spread.
  return { fetchedAt, degraded: false, error: { code, message } } as SourceResult<T>;
}
