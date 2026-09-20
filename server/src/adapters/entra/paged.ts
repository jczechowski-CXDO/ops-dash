import { fetchJson, type FetchLike } from '../../http/fetchJson.js';

/**
 * Reading a whole Graph collection, one page at a time.
 *
 * This exists because of a number rather than a principle. Measured on this
 * tenant on 2026-09-20, shapes and counts only: **1,658** users (two pages at
 * `$top=999`), **1,473** app registrations (two pages), **981** rows in the
 * authentication-methods registration report, and **more than 1,000** failed
 * sign-ins in a single 24-hour window. The M4 plan says "~512 users"; that is
 * the licensed-staff count, not the directory. An adapter that read page one
 * and called it the estate would be wrong by a factor of three on its first
 * run, and wrong in the direction that reads as good news.
 *
 * Three properties this helper has that a `while (nextLink)` loop does not:
 *
 * **1. The bearer token never leaves Microsoft's origin.** `@odata.nextLink` is
 * a URL chosen by the response body, and every hop carries an `Authorization`
 * header holding an app-only Graph token for the whole tenant. `safeTarget`
 * refuses http, IP literals, private suffixes and embedded credentials — it
 * does NOT refuse `https://somewhere-else.example.com/`, because for a public
 * status feed it has no reason to. Here it must: a nextLink whose origin is not
 * the origin we dialled is refused before the request is made, so a payload
 * cannot redirect our credential to a host of its choosing. `fetchJson`'s
 * redirect handling covers the `Location` header; this covers the body.
 *
 * **2. A page budget, and truncation is reported rather than hidden.** An
 * unbounded loop over `auditLogs/directoryAudits` on this tenant pulled 2,500
 * rows in five pages and was still going. `truncated` travels back to the
 * caller so the snapshot can be marked `degraded` — a number built from a
 * truncated read is a number that is too small, and too small is the direction
 * that looks calm.
 *
 * **3. A page that is not a page is a failure, not an empty list.** Graph
 * answers a bad `$filter` with HTTP 400 and a JSON body that has no `value`
 * array at all. `[]` and "we could not ask the question" must not arrive at the
 * caller in the same shape; that is the whole of this repo's "a failed read
 * never renders as green".
 */

export const GRAPH_V1 = 'https://graph.microsoft.com/v1.0';

/**
 * The beta endpoint, used for sign-in logs and nothing else.
 *
 * Not a preference. `$filter=... signInEventTypes/any(...)` against
 * `/v1.0/auditLogs/signIns` answers, measured:
 *
 *     400 BadRequest — Could not find a property named 'signInEventTypes'
 *                      on type 'microsoft.graph.signIn'
 *
 * The property is beta-only, so a v1.0 sign-in query silently scopes itself to
 * interactive sign-ins and says nothing about it. Measured over one identical
 * 24-hour window on this tenant: **153** failed sign-ins across 44 distinct
 * accounts on v1.0, against a **full 1,000-row first page** and more to come on
 * beta. A password spray is mostly non-interactive; the v1.0 number is not a
 * conservative estimate of it, it is a different question with a plausible
 * answer. `queries.test.ts` pins the 400 so this cannot be quietly "tidied"
 * back to v1.0 by someone who reads the beta URL as sloppiness.
 */
export const GRAPH_BETA = 'https://graph.microsoft.com/beta';

/**
 * Pages to follow before giving up, per collection.
 *
 * Twenty pages is 20,000 sign-ins or 10,000 audit rows — comfortably past any
 * day this tenant has had, and bounded so one bad window cannot turn a poll
 * into a download. The budget is a constructor argument as well, because the
 * integration test needs to reach truncation with three rows rather than
 * twenty thousand.
 */
export const MAX_PAGES = 20;

/**
 * How many times to wait out a 429, and how long the first wait is.
 *
 * Found by running this adapter against the live tenant rather than by
 * reasoning: the second request of the very first real poll came back
 * `429 Too Many Requests` from `auditLogs/signIns`, and under this adapter's
 * all-or-nothing rule that one status cost the entire snapshot. Graph throttles
 * the sign-in log hard and a 1000-row page is an expensive question to ask it.
 *
 * **`Retry-After` is not readable from here.** `fetchJson` returns a code and a
 * message and no headers, deliberately — it is the one door and it narrows what
 * comes back through it. So this is a fixed exponential backoff rather than the
 * interval Microsoft actually asked for, which is the conservative substitute
 * and not the correct one. Widening `fetchJson`'s return to carry `Retry-After`
 * is a change to a file this adapter does not own; it is reported rather than
 * made.
 *
 * **The numbers are measured, not guessed.** A first attempt at 2s/4s/8s was
 * still too short: the live 429 survived all fourteen seconds. Polling the
 * offending query alone afterwards, it answered `429` immediately and `200`
 * thirty seconds later, so this tenant's sign-in throttle clears somewhere
 * between fifteen and sixty seconds. 5s/10s/20s/40s spans that with room, and
 * costs seventy-five seconds in the worst case against a source polled in
 * minutes. A 429 that survives all four is reported as a 429, because "we are
 * being throttled" is a fact the operator should see rather than something this
 * hides by trying forever.
 */
export const MAX_RETRIES = 4;
export const RETRY_BASE_MS = 5_000;

export type Row = Record<string, unknown>;

export type PagedRead =
  | { ok: true; rows: Row[]; pages: number; truncated: boolean }
  | { ok: false; error: { code: string; message: string } };

const asRecord = (v: unknown): Row | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row) : null;

/**
 * Follow `@odata.nextLink` from `url`, collecting every row.
 *
 * `token` is passed per call rather than captured, so nothing in this module
 * holds a credential across requests and nothing here can log one.
 */
export async function readAll(
  url: string,
  token: string,
  fetchImpl: FetchLike | undefined,
  opts: { maxPages?: number; maxRetries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PagedRead> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  // Injected so the retry tests cost milliseconds rather than fourteen seconds,
  // and so a test can COUNT the waits instead of inferring them from a clock.
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((done) => { setTimeout(done, ms); }));
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { ok: false, error: { code: 'entra_bad_url', message: 'the query URL is not parseable' } };
  }

  const rows: Row[] = [];
  let next: string | undefined = url;
  let pages = 0;

  while (next !== undefined) {
    if (pages >= maxPages) return { ok: true, rows, pages, truncated: true };

    // The body chose this URL from page two onward. Pin it to the origin we
    // dialled BEFORE handing it to fetchJson, because the request carries a
    // tenant-wide Graph token and fetchJson has no way to know that.
    if (pages > 0) {
      let hopOrigin: string;
      try {
        hopOrigin = new URL(next).origin;
      } catch {
        return { ok: false, error: { code: 'entra_bad_next_link', message: 'a nextLink was not a parseable URL' } };
      }
      if (hopOrigin !== origin) {
        return {
          ok: false,
          error: {
            code: 'entra_foreign_next_link',
            // The offending origin is named: this is a security event and an
            // operator who cannot see which host asked for the token learns
            // nothing from the alert.
            message: `a nextLink pointed at ${hopOrigin}, which is not the origin we asked; refused rather than sending the token there`,
          },
        };
      }
    }

    let result = await fetchJson<unknown>(next, {
      headers: { authorization: `Bearer ${token}` },
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    // Only 429 is retried. A 503 or a timeout is retried by the poller on its
    // next tick, which is the right granularity for them; a 429 is Microsoft
    // telling us the pace is wrong, and coming back in fifteen minutes to ask
    // the identical question is not an answer to that.
    for (let attempt = 0; attempt < maxRetries && result.error?.code === 'http_429'; attempt += 1) {
      await sleep(RETRY_BASE_MS * 2 ** attempt);
      result = await fetchJson<unknown>(next, {
        headers: { authorization: `Bearer ${token}` },
        ...(fetchImpl ? { fetchImpl } : {}),
      });
    }
    if (result.error !== undefined) {
      return { ok: false, error: { code: `entra_${result.error.code}`, message: result.error.message } };
    }

    const body = asRecord(result.data);
    const value = body?.['value'];
    if (!Array.isArray(value)) {
      // Not "no rows". Graph returns a body with no `value` for a rejected
      // filter, and treating that as an empty collection is how a broken query
      // becomes a confident zero.
      return { ok: false, error: { code: 'entra_shape', message: 'the response carried no `value` array' } };
    }
    for (const entry of value) {
      const row = asRecord(entry);
      if (row === null) {
        return { ok: false, error: { code: 'entra_shape', message: 'a row in `value` was not an object' } };
      }
      rows.push(row);
    }
    pages += 1;

    const link = body?.['@odata.nextLink'];
    next = typeof link === 'string' && link.length > 0 ? link : undefined;
  }

  return { ok: true, rows, pages, truncated: false };
}
