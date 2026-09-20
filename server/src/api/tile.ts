import type { CheckRun, ServiceId, StatusLevel } from '@ops-dash/shared';
// The engine's reading of our own counts, imported rather than restated. The
// tile's `ours.level` and the rule that opens a Sev1 must not be able to
// disagree about whether our half is failing — and `total === 0` is the case
// where two hand-written versions of "is it failing" diverge first.
import { ourCheckFailing } from '../engine/rules.js';

/**
 * One service's half of a tile: our own probe evidence, as numbers.
 *
 * ## The rule this whole file exists for
 *
 * **Every field here has a value that means "we have no idea", and each one is
 * a different shape. None of them is zero.**
 *
 * `db.uptime()` already returns `undefined` rather than 1 when there is nothing
 * to measure, deliberately, and this is the layer that carries that decision
 * out to the wire. Five of the seven services have no probe at all today, so
 * the no-data path is the COMMON path, not an edge case: whatever it renders as
 * is what most of the dashboard is.
 *
 *   - no probe data is NOT 100% uptime          → `uptime30d: null`
 *   - an empty spark is NOT a flat line at zero → `spark: null`
 *   - a probe that did not answer has no latency → a `null` IN the series
 *   - `ours.total === 0` is NOT passing          → `level: 'unknown'`
 *   - a service with no percentile data has no p95, not a p95 of 0
 *
 * ## Why `null` and not an omitted key
 *
 * The repo's habit is optional fields, and the deciding argument against it
 * here is the consumer: an omitted key survives `{ ...fixtureDefaults,
 * ...entry }` in the web layer and silently restores a fixture number, while an
 * explicit `null` overrides it and makes TypeScript demand the handling. The
 * frozen contract already carries the precedent — `CheckRun.latencyMs` is
 * `number | null` for exactly this reason, a run that produced no measurement.
 *
 * A zero renders as a real measurement. That is the failure mode of this
 * milestone, and this file is the door it would come in through.
 */
export type ServiceTile = {
  ours: OurHalf;
  /** The NEWEST run's latency. `null` if that run did not answer — the last
   *  good number from two minutes ago is not the latency of a probe that has
   *  just timed out, and putting it on a failing tile is the whole problem. */
  latencyMs: number | null;
  /** Both or neither, over `PERCENTILE_WINDOW_DAYS`. */
  p50Ms: number | null;
  p95Ms: number | null;
  /** Up to `SPARK_SAMPLES` recent runs, **oldest first**, in milliseconds.
   *
   *  `null` means we hold no runs at all. A `null` ENTRY means that run
   *  produced no latency: the probe failed or timed out. Holes are carried
   *  rather than dropped because a dropped failure leaves a shorter, healthy
   *  looking line, and a zero leaves a line that dives to instantaneous — an
   *  outage drawn as good news, twice over.
   *
   *  A service with several probes (Zendesk has two pods) interleaves them:
   *  this is "our recent probe latencies", not one check's time series. */
  spark: Array<number | null> | null;
  /** 0-1 over `UPTIME_WINDOW_DAYS`, or `null` when the window holds no runs. */
  uptime30d: number | null;
  /** Incidents WE recorded, opened within `INCIDENT_WINDOW_DAYS`, for this
   *  service alone.
   *
   *  The one field that is 0 rather than null when empty, and the asymmetry is
   *  the point: uptime is a ratio over evidence we do not have, while this
   *  counts rows in a log we write ourselves and prune only at 180 days
   *  (`store/retention.ts`), so "none" is a fact about a complete record.
   *
   *  The bound on that claim: a database younger than ninety days cannot have
   *  ninety days of incidents, and nothing here can see the database's age.
   *  `null` is reserved for the read failing. */
  incidents90d: number | null;
  /** When our half last flipped, if we WATCHED it flip inside the retained run
   *  history; `null` otherwise.
   *
   *  It is not "the oldest row we still hold". `check_runs` is pruned at 45
   *  days and the retained window here is smaller still, so the oldest row is
   *  wherever the pruner and the row budget happened to cut — reporting it
   *  would make "last state change" move every time retention runs, which is a
   *  number that changes for reasons that are not about the service.
   *
   *  KNOWN GAP: nothing in the schema records a transition, so this only ever
   *  sees our own half and only within `RUN_WINDOW` rows. A real one needs a
   *  stored column. */
  lastStateChange: string | null;
  /** Present ONLY when a read failed and the nulls above are ignorance rather
   *  than measurement. Same rule as `severityRaw` on `/api/incidents`: degrade
   *  loudly on the read path, and make the fallback visible — a fallback nobody
   *  can see is just a guess with better manners. */
  error?: { code: string; message: string };
};

export type OurHalf = {
  level: StatusLevel;
  label: string;
  note: string;
  passing: number;
  total: number;
};

/**
 * The four labels our half can carry.
 *
 * The frozen contract's comment says `'Passing' | 'Slow' | 'Failing'`. Nothing
 * in this repo computes 'Slow' — there is no latency budget to be slow against
 * — and none of the three is honest for the five services that have no probe,
 * nor for a store we could not read. Those last two are different facts and get
 * different words: 'No checks' means we looked, 'Unknown' means we could not.
 *
 * (A comment-level deviation from the contract, on a `string` field, not a type
 * change. It is a DATA_CONTRACTS amendment candidate.)
 */
export const OUR_LABEL = {
  passing: 'Passing',
  failing: 'Failing',
  none: 'No checks',
  unreadable: 'Unknown',
} as const;

export const SPARK_SAMPLES = 28;
export const UPTIME_WINDOW_DAYS = 30;
export const PERCENTILE_WINDOW_DAYS = 30;
export const INCIDENT_WINDOW_DAYS = 90;

/**
 * How many recent runs one tile reads.
 *
 * Bounded on purpose: `check_runs` grows at 263 MB a year (security review
 * MEDIUM-2) and an unbounded read is a route that gets slower every day it
 * runs. 500 rows is ~4 hours of history at M3 cadence for the busiest service
 * — comfortably more than the 28 the sparkline needs, and enough replay for
 * `lastStateChange` to have seen a recent flip.
 */
export const RUN_WINDOW = 500;

const DAY_MS = 86_400_000;
const since = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
const message = (cause: unknown) => String((cause as Error)?.message ?? cause);

/** The store, narrowed to what a tile reads. Structural, so a test can supply
 *  one whose reads throw. `tile.test.ts` asserts the real `Store` satisfies it,
 *  so a rename in `db.ts` fails there rather than at composition. */
export type TileStore = {
  runsFor(serviceId: ServiceId, limit?: number): CheckRun[];
  percentiles(serviceId: ServiceId, since: string): { p50: number; p95: number } | undefined;
  uptime(serviceId: ServiceId, since: string): number | undefined;
  incidentsSince(since: string): Array<Record<string, unknown>>;
};

/**
 * The latest run of each distinct check, newest check-run first.
 *
 * Latest-per-check, not "the last N rows". Zendesk has two probes on one tile,
 * so the last five rows are two or three polls of both pods — counting them raw
 * would report `3/5 passing` for a service with one dead pod out of two, and
 * the number on the tile would drift with the polling cadence rather than with
 * anything real.
 *
 * `index.ts`'s `oursFor` is the fold of this into `{ passing, total }`, and is
 * a second implementation of the same rule only until it can be pointed here —
 * `index.ts` is not this agent's file. `tile.test.ts` runs both over one store
 * and asserts they agree, so the day they diverge is a red test rather than two
 * different numbers for the same tile.
 */
export function latestPerCheck(store: Pick<TileStore, 'runsFor'>, serviceId: ServiceId): CheckRun[] {
  return latestOf(store.runsFor(serviceId, RUN_WINDOW));
}

/** The same rule over runs already in hand. `buildTile` reads the window ONCE
 *  and folds it several ways, so it uses this: a second `runsFor` would let the
 *  counts and the sparkline be computed from two different sets of rows. */
export function latestOf(history: readonly CheckRun[]): CheckRun[] {
  const latest = new Map<string, CheckRun>();
  // Newest first, so the first sighting of a check name is its latest run.
  for (const run of history) {
    if (!latest.has(run.check)) latest.set(run.check, run);
  }
  return [...latest.values()];
}

/** Our half's level from counts. `ourCheckFailing` decides whether it is
 *  failing; this only names the two outcomes and the no-evidence case. There is
 *  no third level: calling a partial pass 'degraded' would be a second opinion
 *  the rule that opens incidents does not share. */
function ourLevel(counts: { passing: number; total: number }): StatusLevel {
  if (counts.total === 0) return 'unknown';
  return ourCheckFailing(counts) ? 'outage' : 'operational';
}

const count = (runs: readonly CheckRun[]) => ({
  passing: runs.filter((r) => r.result === 'pass').length,
  total: runs.length,
});

function ourNote(latest: readonly CheckRun[], history: readonly CheckRun[]): string {
  const { passing, total } = count(latest);
  if (total === 0) return 'No probe of ours has ever run for this service.';
  const head = `${passing} of ${total} checks passing.`;
  if (passing === total) return `${head} Newest run ${history[0]?.at ?? latest[0]!.at}.`;
  const failing = latest.filter((r) => r.result !== 'pass').map((r) => `${r.check} (${r.region})`);
  // `history` is newest first, so the first pass in it is the most recent one.
  const lastSuccess = history.find((r) => r.result === 'pass');
  return (
    `${head} Failing: ${failing.join(', ')}. ` +
    (lastSuccess ? `Last success ${lastSuccess.at}.` : 'No successful run in the retained history.')
  );
}

/**
 * When our half last flipped, by replaying the retained runs forward.
 *
 * The walk maintains the same latest-per-check map `latestPerCheck` builds, and
 * records the timestamp of each run that changed the level it implies. Two
 * things it deliberately does not count as a change:
 *
 *   - the FIRST level in the window. Arriving at a state is not changing to it,
 *     and the window's start is an artefact of retention, not an event.
 *   - a new check appearing. 1/1 becoming 2/2 is the fleet changing, not the
 *     service.
 *
 * The walk ends in exactly the state the tile reports — `buildTile` serves
 * `count(latestPerCheck(...))` and this replays to the same map — which is the
 * property that makes the timestamp trustworthy, and it has its own test.
 */
function lastStateChange(history: readonly CheckRun[]): string | null {
  const seen = new Map<string, CheckRun>();
  let previous: StatusLevel | undefined;
  let changedAt: string | null = null;
  // `history` is newest first; replay is oldest first.
  for (const run of [...history].reverse()) {
    seen.set(run.check, run);
    const level = ourLevel(count([...seen.values()]));
    if (previous !== undefined && level !== previous) changedAt = run.at;
    previous = level;
  }
  return changedAt;
}

function incidentCount(store: TileStore, serviceId: ServiceId, now: Date): number {
  const from = since(now, INCIDENT_WINDOW_DAYS);
  // `incidentsSince` returns everything still open plus everything resolved
  // since the cutoff; this counts the ones OPENED inside the window, so an
  // incident that opened four months ago and resolved yesterday is not counted
  // as a new one. Resolved incidents survive 180 days (store/retention.ts), so
  // the ninety-day window is not truncated by pruning.
  return store.incidentsSince(from).filter((row) => row['service_id'] === serviceId && String(row['opened_at']) >= from)
    .length;
}

/**
 * Everything the tile needs that is ours rather than the vendor's.
 *
 * `now` is injected for the same reason `correlate` takes `at`: code that reads
 * the clock cannot be tested for what it does at a particular moment.
 *
 * The two halves — probe history and incident log — fail independently and are
 * caught independently, so a missing `incidents` table does not also erase a
 * perfectly good latency. Neither failure throws: a throw here would turn one
 * unreadable service into a 500 that blanks the other six, which is the
 * flattening `routes.ts` exists to refuse arriving through a different door.
 */
export function buildTile(store: TileStore, serviceId: ServiceId, now: Date): ServiceTile {
  const failures: string[] = [];

  let ours: OurHalf = {
    level: 'unknown',
    label: OUR_LABEL.unreadable,
    note: 'Our probe history could not be read.',
    passing: 0,
    total: 0,
  };
  let latencyMs: number | null = null;
  let p50Ms: number | null = null;
  let p95Ms: number | null = null;
  let spark: Array<number | null> | null = null;
  let uptime30d: number | null = null;
  let changedAt: string | null = null;

  try {
    // One bounded read, and everything below is derived from it, so the
    // sparkline, the counts and the replay cannot disagree about which runs
    // exist.
    const history = store.runsFor(serviceId, RUN_WINDOW);
    const latest = latestOf(history);
    const counts = count(latest);
    const level = ourLevel(counts);
    ours = {
      level,
      label:
        counts.total === 0 ? OUR_LABEL.none : level === 'operational' ? OUR_LABEL.passing : OUR_LABEL.failing,
      note: ourNote(latest, history),
      ...counts,
    };
    // The newest run's own latency, `null` and not a fallback if it failed.
    latencyMs = history[0]?.latencyMs ?? null;
    spark = history.length === 0 ? null : history.slice(0, SPARK_SAMPLES).reverse().map((r) => r.latencyMs);
    changedAt = lastStateChange(history);

    const percentiles = store.percentiles(serviceId, since(now, PERCENTILE_WINDOW_DAYS));
    p50Ms = percentiles?.p50 ?? null;
    p95Ms = percentiles?.p95 ?? null;
    // `?? null`, never `?? 1` and never `?? 0`: `db.uptime` returns undefined
    // precisely to refuse both, and this is where that refusal leaves the
    // process.
    uptime30d = store.uptime(serviceId, since(now, UPTIME_WINDOW_DAYS)) ?? null;
  } catch (cause) {
    failures.push(`probe history: ${message(cause)}`);
  }

  let incidents90d: number | null = null;
  try {
    incidents90d = incidentCount(store, serviceId, now);
  } catch (cause) {
    failures.push(`incidents: ${message(cause)}`);
  }

  return {
    ours,
    latencyMs,
    p50Ms,
    p95Ms,
    spark,
    uptime30d,
    incidents90d,
    lastStateChange: changedAt,
    ...(failures.length > 0
      ? { error: { code: 'store_unavailable', message: failures.join('; ') } }
      : {}),
  };
}
