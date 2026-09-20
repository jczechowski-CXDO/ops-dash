import type { SourceResult } from '@ops-dash/shared';
import { refuseTarget } from './safeTarget.js';
import { describeThrown } from './describeThrown.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * What this helper returns: a `SourceResult`, plus one fact the contract has no
 * room for.
 *
 * **`shared/src/contracts.ts` is NOT amended and does not need to be.** This is
 * a subtype: `{ code, message, retryAfterMs? }` is assignable to
 * `{ code, message }`, so every existing caller typed on `SourceResult<T>`
 * compiles untouched and sees exactly the two fields the contract promises. The
 * extra one is visible only to a caller that goes looking for it. That is the
 * difference between widening what one module hands back and changing what the
 * contract means, and only the second needs John.
 *
 * **Why it is on `error` rather than at the top level.** A retry hint exists
 * only when something went wrong, so hanging it off `error` makes it
 * unreachable in the success case by construction rather than by discipline.
 * It also keeps the shape of a successful result byte-identical to what it was
 * before, which matters because `store/db.ts` persists these.
 *
 * **One behaviour change, stated rather than buried:** `db.ts` stores a failed
 * read as `JSON.stringify(result.error)`, so a 429 or 503 that carried the
 * header now persists `retryAfterMs` alongside the code and the message. That
 * is a gain — "the vendor told us to wait sixty seconds" is exactly the kind of
 * fact this project would rather have on the record than swallow — but it is a
 * change to what lands in the store and it should be seen, not discovered.
 */
export type FetchOutcome<T> = Omit<SourceResult<T>, 'error'> & {
  error?: {
    code: string;
    message: string;
    /**
     * What the server's `Retry-After` header asked for, in milliseconds.
     *
     * **Absent when there was no header, or one we could not read** — never
     * `0`, because a caller reading `0` would retry immediately, which is the
     * opposite of what a missing instruction means. `0` IS emitted for an
     * HTTP-date already in the past, because that is a real instruction
     * meaning "now" rather than an absence. Those two cases look identical in
     * a number and are not the same fact.
     *
     * Reported, not obeyed. This module says what the server said; how long a
     * caller is actually willing to wait is the caller's policy.
     */
    retryAfterMs?: number;
  };
};

/**
 * `Retry-After`, in milliseconds, or `undefined`.
 *
 * Both RFC 9110 forms are handled, and **`Date.parse` is the hazard in both
 * directions**, which is why this is two guarded branches and not one clever
 * one. Measured in this V8, not assumed:
 *
 *   Date.parse('60')   -> 1960-01-01, i.e. -315594000000
 *   Date.parse('1.5')  -> 2001-01-05, a perfectly valid date in the past
 *
 * So the order matters: delta-seconds is tested first, because otherwise the
 * single commonest header value there is — `60` — comes back as sixty-six years
 * ago. And the date branch has to be FENCED as well as second, because a
 * malformed delta-seconds like `1.5` falls through to it, parses cleanly as a
 * date already past, and returns **`0`** — which this field defines as "retry
 * immediately". That is the absent-becomes-zero failure this whole type exists
 * to prevent, reintroduced inside the parser meant to prevent it. Caught by the
 * test below on the first run, not by review.
 *
 * The fence: an HTTP-date always contains a month name and a weekday, so a
 * value with no letter in it is never one. Exported for its own test, because a
 * parser is the one kind of code whose wrong answer is a plausible number
 * rather than a crash.
 */
export function parseRetryAfter(header: string | null | undefined, now: number): number | undefined {
  if (header === null || header === undefined) return undefined;
  const value = header.trim();
  if (value === '') return undefined;

  // delta-seconds: RFC 9110 says a non-negative integer and nothing else. A
  // negative number, a decimal or `60s` is a header we cannot read, which is
  // `undefined` — not `0`. Guessing at a malformed instruction is how a
  // misparse becomes a hot loop against a server already asking for quiet.
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds * 1000 : undefined;
  }

  // The fence. Without it `1.5`, `1e3` and every other malformed delta-seconds
  // that V8 will accept as a date arrives here and comes back as 0.
  if (!/[A-Za-z]/.test(value)) return undefined;

  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  // A date in the past is "you may retry now", which is a measurement of zero
  // rather than an absence of one. See `retryAfterMs`.
  return Math.max(0, at - now);
}

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
 * A non-2xx additionally carries `error.retryAfterMs` when the response said
 * `Retry-After` and we could read it — reported, never obeyed here. See
 * `FetchOutcome`.
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
): Promise<FetchOutcome<T>> {
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
        return err(
          fetchedAt,
          `http_${response.status}`,
          `${response.status} with no Location header`,
          parseRetryAfter(response.headers.get('retry-after'), Date.now()),
        );
      }
      // Resolved against the current target, so a relative Location works — and
      // is then re-validated like any other, rather than inheriting trust from
      // the URL it was relative to.
      await response.body?.cancel().catch(() => undefined);
      target = new URL(location, target).href;
    }

    if (!response.ok) {
      // The one place a server gets to tell us how long to stay away. Captured
      // for every non-2xx rather than only for 429: a 503 carrying the header
      // is making the same statement, and this module's job is to report what
      // was said and not to decide which statuses are allowed to say it.
      return err(
        fetchedAt,
        `http_${response.status}`,
        `${response.status} ${response.statusText}`,
        parseRetryAfter(response.headers.get('retry-after'), Date.now()),
      );
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

function err<T>(
  fetchedAt: string,
  code: string,
  message: string,
  retryAfterMs?: number,
): FetchOutcome<T> {
  // No `data` key at all rather than `data: undefined` —
  // exactOptionalPropertyTypes makes those different types, and a consumer
  // destructuring `data` should get nothing rather than a present-but-empty
  // field it might spread. The same rule governs `retryAfterMs`: absent when
  // there was no usable header, never present-and-zero.
  return {
    fetchedAt,
    degraded: false,
    error: { code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
  } as FetchOutcome<T>;
}
