/**
 * The composition root: store + adapters + poller + engine + API, one process,
 * one SQLite file.
 *
 * Everything below this line is wiring. The decisions live in the modules —
 * `fetchJson` owns the four failure rules, `rules.ts` owns what an incident is,
 * `db.ts` owns last-good-vs-last-attempt. What this file owns, and the only
 * thing it owns, is **which facts reach which module**, and that turns out to
 * be where a milestone's worth of careful work can still be quietly undone.
 *
 * Two examples that shaped the file:
 *
 *   - Every source writes its snapshot under `vendorSource(id)`, imported from
 *     the API rather than spelled here. A key spelled two ways reads as
 *     `never_polled`, which is indistinguishable from a source nobody
 *     configured — a silent hole exactly where the dashboard is supposed to be
 *     loudest.
 *   - Two of the seven services have no adapter until Milestone 3. They are
 *     synthesised as `unknown` with `platform_unsupported` rather than left out
 *     of the list, because a service that is absent from `/api/services` is a
 *     service nobody notices is missing.
 */

import type { ServiceId, StatusLevel, VendorPlatform, Incident, CheckRun } from '@ops-dash/shared';
import { openStore, type Store } from './store/db.js';
import { loadVendorFeeds, type Vendor } from './adapters/vendorstatus/common.js';
import { pollVendor } from './adapters/vendorstatus/index.js';
import { runAll, DEFAULT_PROBES } from './adapters/synthetic/runner.js';
import { createSchedule, type Source } from './poller/schedule.js';
import { correlate, toStoreRow, parseSeverity, WINDOW_MS } from './engine/correlate.js';
import type { ServiceSignal } from './engine/rules.js';
import { buildApi, vendorSource, SERVICE_ORDER } from './api/routes.js';
import type { FetchLike } from './http/fetchJson.js';

/**
 * Which platform each service's vendor half comes from.
 *
 * A `Record<ServiceId, …>` rather than a lookup over `vendors.json`, and that
 * is deliberate: this way an eighth `ServiceId` fails the typecheck instead of
 * silently acquiring no platform. `statusio` and `msgraph` have no adapter in
 * this milestone and are listed anyway — `blackout` groups by platform, so a
 * service whose platform were merely absent would group with everything else
 * that had none and could manufacture a blackout out of unrelated services.
 */
export const SERVICE_PLATFORM: Record<ServiceId, VendorPlatform> = {
  proofpoint: 'statusio',   // Milestone 3
  m365: 'msgraph',          // Milestone 3
  jira: 'statuspage',
  helpjuice: 'statuspage',
  claude: 'statuspage',
  openai: 'statuspage',
  zendesk: 'zendesk-ssp',
};

export const VENDOR_INTERVAL_MS = 60_000;
export const PROBE_INTERVAL_MS = 60_000;
export const CORRELATE_INTERVAL_MS = 60_000;

/** The source name the synthetic probes write under. Not a `vendorSource`:
 *  probes are our half, and folding them into a vendor key would make a probe
 *  failure look like a feed failure on `/api/health`. */
export const PROBES_SOURCE = 'probes';
export const CORRELATE_SOURCE = 'correlate';

export type AppOptions = {
  /** `:memory:` in tests. */
  dbPath?: string;
  /** Injected so the integration test can drive the whole chain from committed
   *  payloads without touching the network. Nothing below this line reads the
   *  global. */
  fetchImpl?: FetchLike;
  /** Injected for the same reason `correlate` takes `at`: a chain that reads
   *  the clock cannot be tested for what it does at a particular moment. */
  now?: () => Date;
  probes?: typeof DEFAULT_PROBES;
};

export function createApp(opts: AppOptions = {}) {
  const now = opts.now ?? (() => new Date());
  const store = openStore(opts.dbPath ?? 'ops-dash.sqlite');
  const feeds = loadVendorFeeds();
  const probes = opts.probes ?? DEFAULT_PROBES;

  /* ------------------------------------------------------------- sources */

  const vendorSources: Source[] = feeds.map((feed) => ({
    name: vendorSource(feed.id),
    intervalMs: VENDOR_INTERVAL_MS,
    run: async () => {
      const result = await pollVendor(feed, opts.fetchImpl);
      // Written whether it succeeded or not. `putSnapshot` branches on `error`
      // and keeps the last good payload alongside the new failure — that split
      // is the whole reason the table has four columns, and skipping the write
      // on failure would put the staleness back in a place nobody can see.
      store.putSnapshot(vendorSource(feed.id), result);
      return result;
    },
  }));

  const probeSource: Source = {
    name: PROBES_SOURCE,
    intervalMs: PROBE_INTERVAL_MS,
    run: async () => {
      const runs = await runAll(probes, opts.fetchImpl);
      for (const run of runs) store.addRun(run);
      const fetchedAt = now().toISOString();
      // `runAll` cannot fail as a whole — it is `allSettled`, and a broken probe
      // becomes a `fail` row rather than an exception. So this envelope reports
      // a successful READ every time, which is correct: we did run the probes.
      // Whether they passed is the rows' business, not the poller's, and
      // conflating the two would make `/api/health` red whenever a vendor was.
      return { data: runs, fetchedAt, degraded: false, ...(runs.length === 0 ? { empty: true } : {}) };
    },
  };

  /* ---------------------------------------------------------- correlation */

  /**
   * Read the store back and say what each service currently looks like.
   *
   * Read BACK, rather than threading the poll results through in memory. It
   * costs a query and buys the property that matters: the engine sees exactly
   * what the API serves and what the operator is looking at. An in-memory path
   * would let the correlator act on a fact the dashboard never showed — and
   * after a restart, act on nothing at all while the tiles read fine.
   */
  function signals(): ServiceSignal[] {
    return SERVICE_ORDER.map((id) => {
      const platform = SERVICE_PLATFORM[id];
      const snapshot = store.getSnapshot(vendorSource(id));
      const vendorData = snapshot?.data as Vendor | undefined;

      let level: StatusLevel = 'unknown';
      let errorCode: string | undefined;
      if (!snapshot) {
        // No adapter, or never polled. Both are "we have not read this", and
        // `platform_unsupported` is the code the blackout rule keys off to tell
        // a documented gap from a feed that broke.
        errorCode = feeds.some((f) => f.id === id) ? 'never_polled' : 'platform_unsupported';
      } else {
        // The level comes from the payload; the error comes from the envelope.
        // Amendment 9 — they are not mutually exclusive, and a stale panel is
        // exactly the case where both are present.
        level = vendorData?.level ?? 'unknown';
        if (snapshot.error) {
          errorCode = snapshot.error.code;
          // A failed read never renders as green, one layer below the UI. The
          // stored payload may be an operational one from ten minutes ago; it
          // is not evidence about now.
          level = 'unknown';
        }
      }

      return {
        serviceId: id,
        vendor: { level, platform, ...(errorCode ? { errorCode } : {}) },
        ours: oursFor(store, id),
      };
    });
  }

  function correlateNow(at = now().toISOString()): Incident[] {
    // A full window back, not just the open ones. An incident that resolved ten
    // minutes ago still owns its identity, and if the condition returns it must
    // re-open that incident rather than opening a second one beside it. Handing
    // the engine only `openIncidents()` would have left its recurrence handling
    // unreachable in production while every unit test of it passed — the engine
    // cannot recognise a prior it was never given.
    const since = new Date(Date.parse(at) - WINDOW_MS).toISOString();
    const open = store.incidentsSince(since).map(rowToIncident);
    const incidents = correlate({ at, services: signals(), open, windowMs: WINDOW_MS });
    for (const incident of incidents) store.putIncident(toStoreRow(incident));
    return incidents;
  }

  const correlateSource: Source = {
    name: CORRELATE_SOURCE,
    intervalMs: CORRELATE_INTERVAL_MS,
    run: async () => {
      const at = now().toISOString();
      const incidents = correlateNow(at);
      return { data: incidents, fetchedAt: at, degraded: false };
    },
  };

  /* ------------------------------------------------------------- assembly */

  // Correlation last, so that on the immediate poll at start() the vendor and
  // probe writes have at least been issued before the first correlation reads
  // them. It is not a guarantee — they are all async — and it does not need to
  // be: a correlation that runs a tick early sees `never_polled`, which is
  // true, and the next tick corrects it.
  const sources: Source[] = [...vendorSources, probeSource, correlateSource];
  const schedule = createSchedule(sources);
  const api = buildApi({ store, poller: schedule });

  // `sources` is exported so the integration test can drive one deterministic
  // cycle. Running them through `start()` would make those assertions about
  // timer scheduling — which `schedule.test.ts` already covers — instead of
  // about whether the chain detects anything.
  return { store, schedule, api, signals, correlateNow, feeds, probes, sources };
}

/* -------------------------------------------------------------- helpers */

/**
 * Our half for one service: the latest run of each distinct check.
 *
 * Latest-per-check, not "the last N rows". Zendesk has two probes on one tile,
 * so the last five rows are two or three polls of both pods — counting them
 * raw would report `3/5 passing` for a service with one dead pod out of two,
 * and the number on the tile would drift with the polling cadence rather than
 * with anything real.
 */
export function oursFor(store: Pick<Store, 'runsFor'>, serviceId: ServiceId): { passing: number; total: number } {
  const latest = new Map<string, CheckRun>();
  // Newest first, so the first sighting of a check name is its latest run.
  for (const run of store.runsFor(serviceId, 50)) {
    if (!latest.has(run.check)) latest.set(run.check, run);
  }
  const runs = [...latest.values()];
  return { passing: runs.filter((r) => r.result === 'pass').length, total: runs.length };
}

/**
 * A stored incident row, back into the shape `correlate` carries forward.
 *
 * The presentation fields are rebuilt from the firing rule every tick, so the
 * table does not store them and this fills them empty. They are written out
 * explicitly rather than hidden behind `as Incident`: the cast compiles, and it
 * also means the day `Incident` grows a required field, this silently returns
 * an object without it instead of failing the build. The empties are a
 * statement that the engine does not read them from a prior — if that ever
 * stops being true, the symptom is a blank title, which is visible, rather than
 * a type error nobody ever saw.
 *
 * `ack` and `muted` are absent because the schema has no column for them: they
 * are Milestone 4, and an ack recorded today would not survive a restart. That
 * is a known gap, not an oversight — it is also why incident ids are a hash of
 * the condition rather than a counter, so the ack has a stable row to land on
 * when M4 adds the column.
 */
export function rowToIncident(row: Record<string, unknown>): Incident {
  const resolvedAt = row['resolved_at'] ?? row['resolvedAt'];
  return {
    id: String(row['id']),
    ruleKey: String(row['rule_key'] ?? row['ruleKey']),
    serviceId: String(row['service_id'] ?? row['serviceId']),
    severity: parseSeverity(String(row['severity'])),
    openedAt: String(row['opened_at'] ?? row['openedAt']),
    ...(resolvedAt ? { resolvedAt: String(resolvedAt) } : {}),
    summary: String(row['summary'] ?? ''),
    title: '',
    metaParts: [],
    blastRadius: [],
    timeline: [],
  };
}
