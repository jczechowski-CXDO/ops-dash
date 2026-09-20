import type { ServiceId } from '@ops-dash/shared';
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
 *   - **same-origin credentials, and nothing else**. This said `omit` until
 *     Milestone 4, and the paragraph explaining why said there was no auth and
 *     that `/api/health` reported `auth: {mode:'none'}`. Both are now false:
 *     `/api/session` is live and issues an `HttpOnly` session cookie. `omit`
 *     was not neutral once that existed — it meant the SPA could never hold a
 *     session the server was issuing, so `auth.authenticated` was permanently
 *     false in the browser and the whole seam could not be exercised end to
 *     end by anybody.
 *
 *     `same-origin` is the narrowest value that works, and it is spelled out
 *     rather than defaulted so the choice is visible: never `include`, which
 *     would attach credentials to a cross-origin request — impossible here
 *     while `ApiPath` stays a union of paths, and the point is that it stays
 *     impossible by two independent mechanisms rather than one. Nothing here
 *     sends an `Authorization` header or reads a secret: the cookie is
 *     `HttpOnly`, so no JavaScript in this app can see it, and the only code
 *     that ever names it is the server's.
 *
 * ## It never throws
 *
 * Same invariant as `fetchJson.ts`, for the same reason: a transport failure is
 * a fact to report, not an exception to handle. A `catch` in a component is a
 * blank panel; a returned error is a panel that says why it is blank. Five
 * failures are folded into one shape here — a throw (server down, DNS, CSP), a
 * non-2xx, a 2xx carrying non-JSON, an empty body, and an abort.
 */

/** The routes that exist. A union, not a string: nothing outside this file can
 *  name a target. */
export type ApiPath = '/api/services' | '/api/incidents' | '/api/entra' | '/api/health';

/**
 * The one route that takes an argument, built here rather than by a caller.
 *
 * A caller passing `/api/checks?service=${id}` would make `ApiPath` a string in
 * practice and this file would stop being the only place that can name a
 * target. So the caller passes a `ServiceId` — already a closed union from the
 * frozen contract — and the path is assembled here, encoded, with no way to
 * express anything else.
 */
export function checksPath(serviceId: ServiceId): string {
  return `/api/checks?service=${encodeURIComponent(serviceId)}`;
}

export type Fetched =
  | { ok: true; json: unknown }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        /**
         * The HTTP status, as a NUMBER, whenever there was a response to have
         * one. Absent for a throw, an abort, or a failure that never reached a
         * status line.
         *
         * ## Why this field exists
         *
         * It used to survive only inside `message`, as the words "answered HTTP
         * 401". That reads fine and is useless: a view's only way to tell "you
         * are not signed in" from "the store is down" was to regex an English
         * sentence — re-deriving a value from its own prose rendering, which is
         * the shape this codebase keeps getting burned by.
         *
         * And the consequence was not cosmetic. Every view funnels errors
         * through `panelStateFor`, which paints `kind: 'error'` — a red "X is
         * unavailable". G3 HIGH-2 ruled on precisely that in `ServiceDetail`: a
         * state that is NOT a source failure must not be painted red, because
         * red for an ordinary condition teaches an operator to distrust red.
         * **Not being signed in is not an outage.** A caller that wants to say
         * so branches on `status === 401`, a number, mechanically.
         */
        status?: number;
      };
    };

const failed = (code: string, message: string): Fetched => ({ ok: false, error: { code, message } });

/**
 * The codes this door issues about the TRANSPORT, which the server may not
 * speak.
 *
 * `DataSource.tsx` drops an `aborted` error without painting anything — an
 * abort means the component unmounted or a newer poll superseded this one, and
 * a red panel because the user navigated is a false alarm. So a response body
 * carrying `{"error":{"code":"aborted"}}` would make a real failure vanish into
 * a blank panel with no explanation anywhere.
 *
 * It is a narrow hole and it is cheap to close: a served code that collides
 * with this door's own vocabulary is not adopted, and the classification falls
 * back to `http_status`. The status number is carried either way, so nothing is
 * lost — the server simply does not get to speak the client's private language.
 */
const RESERVED_CODES = ['aborted', 'unreachable', 'http_status', 'empty_body', 'non_json_2xx'];

/**
 * `{ error: { code, message } }` out of a non-2xx body, or `null`.
 *
 * Every error on this surface already has that shape — `SourceResult.error`,
 * `Fetched['error']`, the API's own envelopes — so an authentication failure
 * answering `401 { error: { code: 'unauthenticated', message } }` lands in the
 * existing vocabulary rather than introducing a second one.
 *
 * Never throws, and adopts nothing it cannot read: a body that is not JSON, not
 * an object, or missing either string is simply not a served error, and the
 * caller falls back to describing the status itself.
 */
function servedError(body: string): { code: string; message: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const error = (parsed as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const { code, message } = error as Record<string, unknown>;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  if (RESERVED_CODES.includes(code)) return null;
  return { code, message };
}

/** The narrow contract the provider depends on, so a test can supply a client
 *  that answers from a literal rather than stubbing a global. */
export type ApiClient = {
  get(path: ApiPath, signal?: AbortSignal): Promise<Fetched>;
  /** Kept separate from `get` so the path union stays a union. */
  checks(serviceId: ServiceId, signal?: AbortSignal): Promise<Fetched>;
};

export const apiClient: ApiClient = {
  get: getJson,
  checks: (serviceId, signal) => request(checksPath(serviceId), signal),
};

export async function getJson(path: ApiPath, signal?: AbortSignal): Promise<Fetched> {
  return request(path, signal);
}

/** The single call. `getJson` and `checks` differ only in how their path is
 *  built; everything about the request itself is decided once, here. */
async function request(path: string, signal?: AbortSignal): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetch(path, {
      // Spelled out rather than defaulted, and `same-origin` rather than
      // `include`: the session cookie must reach our own API and may never
      // reach anything else. `ApiPath` already makes a cross-origin request
      // unexpressible; this makes it harmless if that ever stopped being true.
      credentials: 'same-origin',
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
    // The body is READ on a non-2xx, which it did not used to be. Our own API
    // explains itself in the body — `401 {error:{code:'unauthenticated'}}` —
    // and discarding it left the web with a status buried in prose and the
    // server's own words thrown away. A body we cannot read costs nothing: the
    // status is carried as a number regardless.
    let body = '';
    try {
      body = await response.text();
    } catch {
      // A body that will not read is not a second failure to report. The status
      // line already told us what happened.
    }
    const served = servedError(body);
    return {
      ok: false,
      error: {
        code: served?.code ?? 'http_status',
        message: served?.message ?? `${path} answered HTTP ${response.status}`,
        status: response.status,
      },
    };
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
