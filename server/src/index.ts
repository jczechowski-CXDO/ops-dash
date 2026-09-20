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

import type { ServiceId, Incident, CheckRun } from '@ops-dash/shared';
import { openStore, type Store } from './store/db.js';
import { vendorLevel } from './store/currentLevel.js';
import { SERVICE_PLATFORM } from './services.js';
import { loadVendorFeeds } from './adapters/vendorstatus/common.js';
import { pollVendor } from './adapters/vendorstatus/index.js';
import type { TokenSource } from './http/graphToken.js';
import { runAll, DEFAULT_PROBES } from './adapters/synthetic/runner.js';
import { createSchedule, type Source } from './poller/schedule.js';
import { correlate, toStoreRow, parseSeverity, WINDOW_MS } from './engine/correlate.js';
import type { ServiceSignal } from './engine/rules.js';
import { buildApi, vendorSource, SERVICE_ORDER } from './api/routes.js';
import type { FetchLike } from './http/fetchJson.js';


export const VENDOR_INTERVAL_MS = 60_000;
/** Retention runs hourly, not per poll. The windows are 45 and 180 DAYS, so a
 *  prune a minute late costs nothing and a prune every minute is 1,440 pointless
 *  transactions a day against a table the poller is writing to. */
export const PRUNE_INTERVAL_MS = 60 * 60_000;
export const PROBE_INTERVAL_MS = 60_000;
export const CORRELATE_INTERVAL_MS = 60_000;

/** The source name the synthetic probes write under. Not a `vendorSource`:
 *  probes are our half, and folding them into a vendor key would make a probe
 *  failure look like a feed failure on `/api/health`. */
export const PROBES_SOURCE = 'probes';
export const CORRELATE_SOURCE = 'correlate';
export const PRUNE_SOURCE = 'prune';

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
  /**
   * The Graph credential, for `m365` alone.
   *
   * Constructed HERE and nowhere else, and absent by default. A test that does
   * not pass one gets an adapter reporting `graph_unconfigured`, which is both
   * honest and impossible to confuse with a real credential — no test in this
   * repo can reach the real one by forgetting to stub something.
   */
  tokens?: TokenSource;
  /**
   * Reads the Graph certificate, so `/api/health` can report how long it has
   * left. A FUNCTION, and called per request rather than once: this is the one
   * credential whose entire purpose is to be replaced before it expires, and a
   * value captured at boot would keep reporting the old expiry until someone
   * restarted the process — which is exactly when nobody is looking.
   *
   * The composition root supplies it because the composition root is the only
   * place that knows where the credential lives. `api/` never learns the path.
   */
  graphCert?: () => string | undefined;
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
      const result = await pollVendor(feed, opts.fetchImpl, opts.tokens);
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

      // `vendorLevel`, never `data.level`. A degraded snapshot's payload is
      // history: the last reading we could actually take, and feeding it to a
      // live rule would open a Sev1 on minutes-old evidence. `vendorLevel` also
      // applies amendment 10 — see store/currentLevel.ts for why it needs both
      // halves and why it can only ever move a level upward.
      const ours = oursFor(store, id);
      const { level } = vendorLevel(snapshot, platform, ours);
      let errorCode: string | undefined;
      if (!snapshot) {
        // No adapter, or never polled. Both are "we have not read this", and
        // `platform_unsupported` is the code the blackout rule keys off to tell
        // a documented gap from a feed that broke.
        errorCode = feeds.some((f) => f.id === id) ? 'never_polled' : 'platform_unsupported';
      } else if (snapshot.error) {
        errorCode = snapshot.error.code;
      }

      return {
        serviceId: id,
        vendor: { level, platform, ...(errorCode ? { errorCode } : {}) },
        ours,
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
    // The operator's overrides, read fresh every tick rather than at boot: a
    // rule muted from the Settings screen has to take effect on the next poll,
    // not on the next restart. An absent key is "no override" and `evaluate`
    // falls back to the rule's own default — see `store.ruleState`.
    const enabledRules = store.ruleState();
    const incidents = correlate({ at, services: signals(), open, enabledRules, windowMs: WINDOW_MS });
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
  /**
   * Retention, as a source like any other.
   *
   * Not a `setInterval` of its own: a source gets the poller's error boundary,
   * its in-flight guard and its place in `/api/health` for free, and a prune
   * that started failing in its own timer would be invisible until the disk
   * filled. It returns the counts it deleted so a silent no-op prune — the
   * classic version of this bug — shows up as data rather than as nothing.
   */
  const pruneSource: Source = {
    name: PRUNE_SOURCE,
    intervalMs: PRUNE_INTERVAL_MS,
    run: async () => {
      const at = now();
      const counts = store.prune(at);
      return { data: counts, fetchedAt: at.toISOString(), degraded: false };
    },
  };

  const sources: Source[] = [...vendorSources, probeSource, correlateSource, pruneSource];
  const schedule = createSchedule(sources);
  const api = buildApi({
    store,
    poller: schedule,
    now: () => now(),
    ...(opts.graphCert ? { graphCert: opts.graphCert } : {}),
  });

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
