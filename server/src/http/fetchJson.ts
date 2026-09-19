import type { SourceResult } from '@ops-dash/shared';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

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
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<SourceResult<T>> {
  const { fetchImpl = fetch, timeoutMs = 10_000 } = opts;
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      redirect: 'follow',
    });

    if (!response.ok) {
      return err(fetchedAt, `http_${response.status}`, `${response.status} ${response.statusText}`);
    }

    const body = await response.text();

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
      aborted ? `no response within ${timeoutMs}ms` : String((cause as Error)?.message ?? cause),
    );
  } finally {
    clearTimeout(timer);
  }
}

function err<T>(fetchedAt: string, code: string, message: string): SourceResult<T> {
  // No `data` key at all rather than `data: undefined` —
  // exactOptionalPropertyTypes makes those different types, and a consumer
  // destructuring `data` should get nothing rather than a present-but-empty
  // field it might spread.
  return { fetchedAt, degraded: false, error: { code, message } } as SourceResult<T>;
}
