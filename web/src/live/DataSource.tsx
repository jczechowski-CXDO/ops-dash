import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDemoMode } from '../app/DemoModeProvider.js';
import type { FixtureBundle, HistoryRow } from '../fixtures/index.js';
import type { CheckRun } from '@ops-dash/shared';
import { isServiceId } from '../lib/serviceNames.js';
import { apiClient, type ApiClient, type ApiPath, type Fetched } from './client.js';
import { parseChecks, parseIncidents, parseServices, type Parsed } from './parse.js';
import { ready, serviceViewOf, type IncidentView, type Load, type ServiceView } from './model.js';

/**
 * Where the three screens get their data, and the ONE place that decides
 * whether that is the API or the fixtures.
 *
 * ## The rule that protects 152 baselines
 *
 * The fixture path is not a fallback and it is not a mode flag threaded through
 * the views: it is **the absence of this provider**. `useDashboard` reads the
 * context, and with no provider above it returns the demo bundle. So:
 *
 *   - `main.tsx` mounts `<LiveDataProvider>` only when the URL carries no
 *     `?demo=`, so a served build with `?demo=quiet` renders Milestone 1's
 *     screens through Milestone 1's code path, byte for byte. Every one of the
 *     152 visual baselines goes through `urlFor()` in `e2e/support.ts`, which
 *     always appends `?demo=`.
 *   - Every existing unit test renders views or `<App/>` with no provider and
 *     therefore keeps its fixtures with no change to the test.
 *   - The live path is reached by mounting the provider explicitly, which is
 *     what the live tests do. Nothing about it is implicit or environmental.
 *
 * Live data is an ADDITION to a dashboard that already works offline.
 */

export type Dashboard = {
  services: Load<ServiceView[]>;
  incidents: Load<IncidentView[]>;
  /**
   * Closed-incident history for the quiet Overview, or `null` for a source
   * that does not serve any. `null` is not an empty list: "nothing closed in
   * the last 30 days" and "we do not keep this" are different sentences and
   * the empty state says which one it is.
   */
  history: HistoryRow[] | null;
  /** Whether this data came off the wire. Views use it for copy that is only
   *  true of one source, never to decide a colour or a number. */
  live: boolean;
};

const Ctx = createContext<Dashboard | null>(null);

/** How often the live poll runs. The header's pill says "Auto-refresh · 30s"
 *  and has since Milestone 1; a data layer refreshing on some other cadence
 *  would make that pill the third thing on this dashboard that states a number
 *  nothing produces. */
export const REFRESH_MS = 30_000;

/** The fixture bundle as a `Dashboard`. Total, no failures, no absent
 *  measurements — which is exactly why the demo screens are unchanged. */
export function fixtureDashboard(bundle: FixtureBundle): Dashboard {
  return {
    services: ready(bundle.services.map(serviceViewOf)),
    incidents: ready(bundle.incidents),
    history: bundle.recentHistory,
    live: false,
  };
}

export function useDashboard(): Dashboard {
  const live = useContext(Ctx);
  // Called unconditionally: the demo provider is above both paths, and a hook
  // behind an `if` is the bug that outlives the refactor that introduced it.
  const { bundle } = useDemoMode();
  const fixture = useMemo(() => fixtureDashboard(bundle), [bundle]);
  return live ?? fixture;
}

/* --------------------------------------------------------------- the poller */

/**
 * One endpoint, polled, holding its last good payload across a failure.
 *
 * The whole of state 3 lives in the two `setLoad` calls below:
 *
 *   success → `{ data, servedAt }`, the error CLEARED. A recovered source stops
 *             being stale the moment it answers.
 *   failure → `{ ...previous, error }`, the data KEPT. This is the line that
 *             makes a stale panel possible; replacing the state with an error
 *             would throw away the last numbers anyone has, and a spinner over
 *             a working service is a worse answer than a twelve-minute-old one.
 *
 * An aborted request sets nothing at all. Abort happens when the component
 * unmounts or a newer poll supersedes this one, and painting a panel red
 * because the user navigated is a false alarm — the same "a failed read must
 * never be reported as something it is not" rule, pointed the other way.
 */
function useEndpoint<T>(
  /** `null` means "there is nothing to poll" — no provider above us, or a route
   *  param that is not one of the seven services. The effect does not run and
   *  the load stays `{}`; it is not a failure and must not render as one. */
  client: ApiClient | null,
  /** What identifies this poll, for the effect's dependencies. A path for the
   *  two collection routes, and `checks:<id>` for the one that takes an
   *  argument — so navigating between two service pages restarts the poll
   *  rather than showing the previous service's runs. */
  key: string,
  /**
   * How to ask. The client is a parameter rather than a closed-over value so
   * that the request is not itself a dependency: it is held in a ref like
   * `parse` below, while `key` and `client` are what decide that this is a
   * DIFFERENT poll.
   */
  request: (client: ApiClient, signal: AbortSignal) => Promise<Fetched>,
  parse: (json: unknown) => Parsed<{ servedAt: string; value: T; error?: { code: string; message: string } }>,
  intervalMs: number,
): Load<T> {
  const [load, setLoad] = useState<Load<T>>({});
  // `parse` is a module-level function in every real caller, but a test may
  // pass an inline one; a ref keeps the effect from restarting the poll on
  // every render and hammering the API.
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (client === null) return;
    let cancelled = false;
    const controller = new AbortController();
    // A NEW poll starts with no data, and that matters for the one route that
    // takes an argument: navigating from /services/jira to /services/claude
    // would otherwise leave Jira's check runs on Claude's page until the first
    // answer arrived — the previous service's probes, attributed to this one.
    setLoad({});

    const tick = async () => {
      const got = await requestRef.current(client, controller.signal);
      if (cancelled) return;
      if (!got.ok) {
        if (got.error.code === 'aborted') return;
        const { error } = got;
        setLoad((prev) => ({ ...prev, error }));
        return;
      }
      const parsed = parseRef.current(got.json);
      if (!parsed.ok) {
        const { error } = parsed;
        setLoad((prev) => ({ ...prev, error }));
        return;
      }
      const { servedAt, value, error } = parsed.value;
      // An envelope that carries data AND an error is stale-with-last-good, and
      // it arrives that way from the server rather than being inferred here.
      setLoad(error === undefined ? { data: value, servedAt } : { data: value, servedAt, error });
    };

    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [client, key, intervalMs]);

  return load;
}

const parseServicesFor = (json: unknown): Parsed<{ servedAt: string; value: ServiceView[] }> => {
  const parsed = parseServices(json);
  return parsed.ok ? { ok: true, value: { servedAt: parsed.value.servedAt, value: parsed.value.services } } : parsed;
};

const parseIncidentsFor = (
  json: unknown,
): Parsed<{ servedAt: string; value: IncidentView[]; error?: { code: string; message: string } }> => {
  const parsed = parseIncidents(json);
  return parsed.ok
    ? {
        ok: true,
        value: {
          servedAt: parsed.value.servedAt,
          value: parsed.value.incidents,
          ...(parsed.value.error === undefined ? {} : { error: parsed.value.error }),
        },
      }
    : parsed;
};

/** The two collection routes ask the same way; only the literal differs. The
 *  path is still a member of `ApiPath`, so nothing here widens the union the
 *  one door is built on. */
const get = (path: ApiPath) => (client: ApiClient, signal: AbortSignal): Promise<Fetched> =>
  client.get(path, signal);

/* ----------------------------------------------------- the per-service route */

/**
 * The client, published separately from the data.
 *
 * `Dashboard` is the three screens' payload and is the same shape in both
 * worlds. Check runs are not part of it: they belong to ONE service, the page
 * that wants them knows which, and putting a seven-entry map of runs into a
 * context every view reads would poll six services nobody is looking at.
 *
 * So the provider publishes how to ask, and `useChecks` below is the only
 * consumer. Its absence is the fixture path, exactly as `Ctx`'s absence is.
 */
type Source = { client: ApiClient; intervalMs: number };

const SourceCtx = createContext<Source | null>(null);

/**
 * The check runs for one service, or `null` for "this page owns its own data".
 *
 * `null` is not an empty load and not a failure: it means no live provider is
 * mounted, so `ServiceDetail` reads the fixtures exactly as it did in
 * Milestone 1. Every one of the 152 baselines renders through that branch.
 *
 * It is also `null` for a route param that is not one of the seven. `/api/checks`
 * answers an unknown id with HTTP 400 — correctly — and asking it anyway would
 * paint a red panel on a page that already says "that is not a monitored
 * service", which is the navigation-as-outage false alarm this layer refuses
 * everywhere else.
 */
export function useChecks(serviceId: string | undefined): Load<CheckRun[]> | null {
  const source = useContext(SourceCtx);
  const id = serviceId !== undefined && isServiceId(serviceId) ? serviceId : null;
  // Both nulls collapse into one: nothing to poll.
  const client = source === null || id === null ? null : source.client;
  const load = useEndpoint<CheckRun[]>(
    client,
    `checks:${id ?? ''}`,
    // `id` is captured from the render that built this closure, and the closure
    // is only ever called with a non-null client — which this file only
    // produces when `id` is non-null. The guard is here so the narrowing is the
    // typechecker's rather than a comment's, and there is no cast.
    (c, signal) => (id === null ? NEVER : c.checks(id, signal)),
    (json) => (id === null ? NOT_ASKED : parseChecks(json, id)),
    source?.intervalMs ?? REFRESH_MS,
  );
  return client === null ? null : load;
}

/** Unreachable by construction — see `useChecks`. Values rather than throws:
 *  a hook that throws on a branch nobody can take is a crash waiting for the
 *  day somebody can. */
const NEVER: Promise<Fetched> = Promise.resolve({
  ok: false,
  error: { code: 'aborted', message: 'no service to ask about' },
});
const NOT_ASKED: Parsed<never> = {
  ok: false,
  error: { code: 'bad_payload', message: 'no service to ask about' },
};

export function LiveDataProvider({
  children,
  client = apiClient,
  intervalMs = REFRESH_MS,
}: {
  children: ReactNode;
  client?: ApiClient;
  intervalMs?: number;
}) {
  const services = useEndpoint(client, '/api/services', get('/api/services'), parseServicesFor, intervalMs);
  const incidents = useEndpoint(client, '/api/incidents', get('/api/incidents'), parseIncidentsFor, intervalMs);
  const source = useMemo<Source>(() => ({ client, intervalMs }), [client, intervalMs]);

  const value = useMemo<Dashboard>(
    () => ({
      services,
      incidents,
      // The API serves open incidents only; there is no closed-incident history
      // route, and inventing one out of the open list would put today's
      // incidents in a panel headed "Recent history".
      history: null,
      live: true,
    }),
    [services, incidents],
  );

  return (
    <Ctx.Provider value={value}>
      <SourceCtx.Provider value={source}>{children}</SourceCtx.Provider>
    </Ctx.Provider>
  );
}
