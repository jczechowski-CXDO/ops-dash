/**
 * The ONE door out of `web/src`, and the only file in it that names a network
 * client.
 *
 * ## Why this file exists at all, and what changed to allow it
 *
 * Through Milestones 1 and 2 the web made no network call whatsoever, and
 * `guards.test.ts` enforced that by grepping every file under `web/src` for
 * `fetch(`. Milestone 3 is the milestone where the dashboard is finally allowed
 * to read our own API, so the guard could not stay as it was. It was NOT
 * deleted: it became the web's version of the rule the server already lives
 * under — `server/src/http/fetchJson.ts` is the only place the server may call
 * `fetch`, and this is the only place the web may. The regexes are the server
 * guard's own, so `const f = fetch`, `globalThis.fetch` and a default parameter
 * still fail everywhere else.
 *
 * Two extra conditions the server's helper does not need, both of them
 * guarded:
 *
 *   - **every target is a same-origin path**, spelled as a literal in the
 *     `ApiPath` union below. No caller can pass a URL, so no value from outside
 *     our own source can decide where this process connects. The CSP in
 *     `index.html` says `connect-src 'self'` and this is the code-side half of
 *     that same claim.
 *   - **no credentials**. `fetch` defaults to `same-origin` credentials; there
 *     is no auth in Milestone 3 (`/api/health` reports `auth: {mode:'none'}`)
 *     and nothing here sends a header, a cookie by choice, or reads a secret.
 *
 * ## It never throws
 *
 * Same invariant as `fetchJson.ts`, for the same reason: a transport failure is
 * a fact to report, not an exception to handle. A `catch` in a component is a
 * blank panel; a returned error is a panel that says why it is blank. Five
 * failures are folded into one shape here — a throw (server down, DNS, CSP), a
 * non-2xx, a 2xx carrying non-JSON, an empty body, and an abort.
 */

/** The three routes that exist. A union, not a string: nothing outside this
 *  file can name a target. */
export type ApiPath = '/api/services' | '/api/incidents' | '/api/health';

export type Fetched = { ok: true; json: unknown } | { ok: false; error: { code: string; message: string } };

const failed = (code: string, message: string): Fetched => ({ ok: false, error: { code, message } });

/** The narrow contract the provider depends on, so a test can supply a client
 *  that answers from a literal rather than stubbing a global. */
export type ApiClient = { get(path: ApiPath, signal?: AbortSignal): Promise<Fetched> };

export const apiClient: ApiClient = { get: getJson };

export async function getJson(path: ApiPath, signal?: AbortSignal): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetch(path, {
      // Spelled out rather than defaulted. `omit` is not the default, and a
      // dashboard that quietly starts sending cookies the day something sets
      // one is a dashboard that has acquired an auth surface nobody designed.
      credentials: 'omit',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // An aborted request is not a failure to report: the component unmounted or
    // a newer poll superseded this one. It is still an error VALUE, with its
    // own code, so a caller can tell the two apart — and the provider drops it
    // rather than painting a panel red on a route change.
    const aborted = signal?.aborted === true;
    return failed(aborted ? 'aborted' : 'unreachable', message(cause));
  }

  if (!response.ok) {
    return failed('http_status', `${path} answered HTTP ${response.status}`);
  }

  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    return failed('unreachable', message(cause));
  }

  if (body.trim() === '') {
    // A 200 with nothing in it is a failure, not an empty dataset. The server
    // makes the same distinction in `fetchJson.ts`, and it is the difference
    // between "no incidents" and "no answer".
    return failed('empty_body', `${path} answered 200 with an empty body`);
  }

  try {
    return { ok: true, json: JSON.parse(body) as unknown };
  } catch {
    // A 2xx carrying HTML is what a dev-server fallback, a proxy error page or
    // an expired login serves. Amendment 7 on the server side; the same rule
    // here, because the same thing happens.
    return failed('non_json_2xx', `${path} answered 200 with a body that is not JSON`);
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
