import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDemoMode } from '../app/DemoModeProvider.js';
import type { FixtureBundle, HistoryRow } from '../fixtures/index.js';
import { apiClient, type ApiClient, type ApiPath } from './client.js';
import { parseIncidents, parseServices, type Parsed } from './parse.js';
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
  client: ApiClient,
  path: ApiPath,
  parse: (json: unknown) => Parsed<{ servedAt: string; value: T; error?: { code: string; message: string } }>,
  intervalMs: number,
): Load<T> {
  const [load, setLoad] = useState<Load<T>>({});
  // `parse` is a module-level function in every real caller, but a test may
  // pass an inline one; a ref keeps the effect from restarting the poll on
  // every render and hammering the API.
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const tick = async () => {
      const got = await client.get(path, controller.signal);
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
  }, [client, path, intervalMs]);

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

export function LiveDataProvider({
  children,
  client = apiClient,
  intervalMs = REFRESH_MS,
}: {
  children: ReactNode;
  client?: ApiClient;
  intervalMs?: number;
}) {
  const services = useEndpoint(client, '/api/services', parseServicesFor, intervalMs);
  const incidents = useEndpoint(client, '/api/incidents', parseIncidentsFor, intervalMs);

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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
