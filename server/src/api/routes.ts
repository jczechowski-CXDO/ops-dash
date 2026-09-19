import Fastify, { type FastifyInstance, type FastifyPluginAsync, type FastifyServerOptions } from 'fastify';
import type { ServiceId, Severity, SourceResult } from '@ops-dash/shared';
import type { SourceStatus } from '../poller/schedule.js';

/**
 * The read-only API.
 *
 * One rule governs this file: **`SourceResult<T>` is mirrored outward
 * unchanged.** `fetchedAt`, `degraded`, `empty` and `error` reach the client
 * exactly as the store holds them. A route that flattened an errored source
 * into an empty array would have thrown away the only thing separating
 * "nothing is wrong" from "we could not look" — the failure this product
 * exists to prevent, reappearing at the last hop after every layer beneath was
 * built to preserve it.
 *
 * Two consequences worth stating, because both look like bugs to a reader
 * expecting a conventional REST API:
 *
 *  - **A dead source is HTTP 200.** Six good sources and one errored returns
 *    six payloads and one error object. The transport succeeded; the source
 *    did not. Those are different facts and the status code describes the
 *    first one. A 5xx here would blank six healthy panels over one bad feed.
 *  - **Nothing is derived.** The store already returns the last good payload
 *    with the last failure attached; this file re-derives none of it. Branch
 *    on `error` for the stale badge and on `data` for whether there is
 *    anything to draw — never infer one from the other (amendment 9).
 *
 * ## The auth seam, deliberately visible
 *
 * There is **no authentication here**, and this comment is the seam rather
 * than a `TODO` buried in a handler. Milestone 4 fills it, together with the
 * ack/mute/resolve routes that need it. Until then every route is a GET and
 * `routes.test.ts` asserts that over the registered route table — because a
 * mutating route added today would be an unauthenticated write. `/api/health`
 * reports `auth: { mode: 'none' }` so the gap is visible at runtime too, not
 * only to someone reading this file.
 */

/* ----------------------------------------------------------- dependencies */

/** The store, narrowed to what the API reads. Structural, so a test can supply
 *  one whose every read throws — the only honest way to exercise the store
 *  half of `/api/health`. `routes.test.ts` asserts the real `Store` satisfies
 *  this, so a rename in `db.ts` fails there rather than at composition. */
export type ApiStore = {
  getSnapshot(source: string): SourceResult<unknown> | undefined;
  openIncidents(): Array<Record<string, unknown>>;
};

/** The poller, narrowed the same way. Typed from `schedule.ts`'s own
 *  `SourceStatus` rather than a copy of it, so the health payload cannot drift
 *  from what the scheduler actually records. */
export type ApiPoller = {
  allStatus(): Record<string, SourceStatus>;
};

export type ApiDeps = {
  store: ApiStore;
  /** Optional: `index.ts` attaches one, a route test need not. Absent is
   *  reported as `configured: false, ok: false` — a poller that is not running
   *  is not a healthy poller. */
  poller?: ApiPoller;
};

/* ------------------------------------------------------------ source names */

/** The snapshot key for a vendor's stored `SourceResult`. One function so the
 *  writer (the poller) and the reader (this file) cannot spell it differently;
 *  a key spelled two ways reads as a source that has never been polled, which
 *  is indistinguishable from a real one. */
export function vendorSource(id: ServiceId): string {
  return `vendor:${id}`;
}

/** Runtime copy of the frozen `ServiceId` union, typed as an exhaustive
 *  Record: adding an eighth service to the contract without adding it here is
 *  a typecheck failure, not a tile that quietly stops being served. */
const SERVICE_IDS: Record<ServiceId, true> = {
  proofpoint: true,
  jira: true,
  helpjuice: true,
  claude: true,
  openai: true,
  zendesk: true,
  m365: true,
};

/** Response order, fixed by the declaration above. Every service is listed on
 *  every response whether or not it has ever been polled: a tile that vanishes
 *  because its poller died looks like a service nobody monitors. */
export const SERVICE_ORDER = Object.keys(SERVICE_IDS) as ServiceId[];

/* -------------------------------------------------------------- responses */

export type ServiceEntry = {
  id: ServiceId;
  /** The store key this came from, so a reader can tell an unpolled service
   *  from a mis-keyed one without guessing. */
  source: string;
  result: SourceResult<unknown>;
};

export type ServicesResponse = {
  /** When the API answered. Never confuse this with a source's `fetchedAt`,
   *  which is when that source was last read successfully. */
  servedAt: string;
  services: ServiceEntry[];
};

export type ApiIncident = {
  id: string;
  ruleKey: string;
  serviceId: string;
  severity: Severity;
  openedAt: string;
  resolvedAt?: string;
  summary: string;
};

export type IncidentsResponse = {
  servedAt: string;
  result: SourceResult<ApiIncident[]>;
};

export type HealthResponse = {
  servedAt: string;
  /** Store and poller are reported separately because they fail separately: a
   *  single boolean would say the system is unwell without saying which half,
   *  and the two have entirely different remedies. */
  store: { ok: boolean; error?: string };
  poller: {
    ok: boolean;
    configured: boolean;
    /** Sources whose last run threw. That is OUR code failing to run a source,
     *  which is a different fact from a feed being down — a down feed is a
     *  successful run carrying an `error`, and shows up on `/api/services`. */
    stalled: string[];
    sources: Record<string, SourceStatus>;
  };
  auth: { mode: 'none'; note: string };
};

/* ---------------------------------------------------------------- helpers */

const now = () => new Date().toISOString();

const message = (cause: unknown) => String((cause as Error)?.message ?? cause);

/** A source with no row at all. Reported explicitly, because "we have never
 *  looked" must not be served as anything a reader could mistake for health.
 *  `fetchedAt` is the time we looked in the store and found nothing — the
 *  contract requires the field, and the error code says what it means. */
const neverPolled = (at: string): SourceResult<never> => ({
  fetchedAt: at,
  degraded: true,
  error: { code: 'never_polled', message: 'no poll of this source has ever been recorded' },
});

const storeUnavailable = (at: string, cause: unknown): SourceResult<never> => ({
  fetchedAt: at,
  degraded: true,
  error: { code: 'store_unavailable', message: message(cause) },
});

/**
 * The stored severity, decoded to the frozen `Severity` union.
 *
 * SQLite holds it as TEXT, so '1' comes back where the contract says 1. A
 * value we cannot read decodes to **1**, the most severe, and not to 'info':
 * an unreadable severity is a thing we cannot see, and this codebase never
 * renders a thing it cannot see as benign.
 */
export function decodeSeverity(raw: unknown): Severity {
  if (raw === 'info') return 'info';
  const n = typeof raw === 'number' ? raw : Number(raw);
  return n === 1 || n === 2 || n === 3 ? (n as Severity) : 1;
}

function toIncident(row: Record<string, unknown>): ApiIncident {
  const resolvedAt = row['resolved_at'];
  return {
    id: String(row['id']),
    ruleKey: String(row['rule_key']),
    serviceId: String(row['service_id']),
    severity: decodeSeverity(row['severity']),
    openedAt: String(row['opened_at']),
    ...(typeof resolvedAt === 'string' ? { resolvedAt } : {}),
    summary: String(row['summary']),
  };
}

/* ----------------------------------------------------------------- routes */

export const apiRoutes: FastifyPluginAsync<ApiDeps> = async (app, deps) => {
  const { store, poller } = deps;

  app.get('/api/services', async (): Promise<ServicesResponse> => {
    const servedAt = now();
    return {
      servedAt,
      services: SERVICE_ORDER.map((id) => {
        const source = vendorSource(id);
        let result: SourceResult<unknown>;
        try {
          // Mirrored, not rebuilt. getSnapshot already attaches the last
          // failure to the last good payload; re-deriving it here is how the
          // two would come to disagree.
          result = store.getSnapshot(source) ?? neverPolled(servedAt);
        } catch (cause) {
          // One service's read failing must not blank the other six.
          result = storeUnavailable(servedAt, cause);
        }
        return { id, source, result };
      }),
    };
  });

  app.get('/api/incidents', async (): Promise<IncidentsResponse> => {
    const servedAt = now();
    try {
      const rows = store.openIncidents();
      return {
        servedAt,
        result: {
          data: rows.map(toIncident),
          fetchedAt: servedAt,
          degraded: false,
          // amendment 4: the query completed and returned no records. That is
          // not an assertion that nothing is wrong, and nothing downstream may
          // read it as one.
          empty: rows.length === 0,
        },
      };
    } catch (cause) {
      // No `empty` here on purpose: "we found no records" and "we could not
      // look" are different claims, and only the first one is about records.
      return { servedAt, result: storeUnavailable(servedAt, cause) };
    }
  });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    const servedAt = now();

    // An actual read, not a flag someone set at boot: a flag would go on
    // reporting ok long after the database was closed underneath it.
    let storeHealth: HealthResponse['store'];
    try {
      store.getSnapshot('__health__');
      storeHealth = { ok: true };
    } catch (cause) {
      storeHealth = { ok: false, error: message(cause) };
    }

    const sources = poller ? poller.allStatus() : {};
    const stalled = Object.entries(sources)
      .filter(([, s]) => s.lastError !== undefined)
      .map(([name]) => name);

    return {
      servedAt,
      store: storeHealth,
      poller: { ok: poller !== undefined && stalled.length === 0, configured: poller !== undefined, stalled, sources },
      auth: {
        mode: 'none',
        note: 'No authentication. Milestone 4 fills this seam, with the mutating routes that need it.',
      },
    };
  });
};

/**
 * The API instance. The only constructor, so its options are not something a
 * caller can get wrong:
 *
 *  - `exposeHeadRoutes: false` — Fastify would otherwise pair every GET with a
 *    HEAD, and "the router exposes GET and nothing else" is a claim worth being
 *    able to assert literally rather than with an allowlist.
 *  - routes are registered through `register`, so they are booted at `ready()`
 *    and an `onRoute` hook added by a caller still sees every one of them.
 */
export function buildApi(deps: ApiDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, exposeHeadRoutes: false, ...opts });
  void app.register(apiRoutes, deps);
  return app;
}
