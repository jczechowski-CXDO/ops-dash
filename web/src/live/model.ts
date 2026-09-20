import type { Incident, ServiceStatus, StatusLevel } from '@ops-dash/shared';
import type { PanelState } from '../components/Panel.js';
import { ago } from '../theme/ago.js';

/**
 * The web's envelope, and it is deliberately the same shape as the server's
 * `SourceResult`: **`data` and `error` are not mutually exclusive.**
 *
 * Amendment 9 is the whole product. A panel holding data from twelve minutes
 * ago AND the reason we cannot refresh it is the state this dashboard exists
 * for, and it is neither "loading" nor "failed". Collapsing the two fields into
 * one `status` enum is how that state disappears — first from the type, then
 * from the screen.
 *
 *   `data` answers  "what did we last see?"
 *   `error` answers "do we know that now?"
 *
 * `store/currentLevel.ts` argues that rule at length on the server. This is the
 * same rule one hop later, and `loadKind` below is the only place that reads
 * the two fields together.
 */
export type Load<T> = {
  /** The last good payload, if we have ever had one. Kept across a failure. */
  data?: T;
  /** When that payload was served to us. The age a stale badge reports. */
  servedAt?: string;
  /** Why the NEWEST attempt failed. Present alongside `data` means stale. */
  error?: { code: string; message: string };
};

export type LoadKind = 'loading' | 'failed' | 'stale' | 'ready';

/**
 * The four states, from the two fields, in one place.
 *
 * Every panel branches on this and none of them branches on `error` or `data`
 * alone — a view that tested `if (error) return <Failed/>` would throw away the
 * last-good numbers the store went to such trouble to keep.
 */
export function loadKind(load: Load<unknown>): LoadKind {
  if (load.error) return load.data === undefined ? 'failed' : 'stale';
  return load.data === undefined ? 'loading' : 'ready';
}

/** A `Load` for data we already hold and cannot fail to hold: the fixtures. */
export function ready<T>(data: T, servedAt?: string): Load<T> {
  return { data, ...(servedAt === undefined ? {} : { servedAt }) };
}

/**
 * `Load` → `PanelState`, so the four states render the same way on every
 * screen rather than four ways on three screens.
 *
 * `empty` is checked LAST and only on a ready load: an empty list we fetched
 * successfully is a designed state, while an empty list we never fetched is
 * loading and an empty list behind a failure is a failure. Getting that order
 * wrong renders "nothing is wrong" over a dead API, which is the one outcome
 * this file exists to prevent.
 */
export function panelStateFor<T>(
  load: Load<T>,
  source: string,
  empty?: { when: (data: T) => boolean; message: string },
): PanelState {
  switch (loadKind(load)) {
    case 'loading':
      return { kind: 'loading' };
    case 'failed':
      return {
        kind: 'error',
        source,
        message: load.error?.message ?? 'unknown failure',
        ...(load.servedAt === undefined ? {} : { fetchedAt: load.servedAt }),
      };
    case 'stale':
      // Children still render: the last good data is the best answer we have.
      //
      // The reason travels WITH the age now — `PanelState.stale.reason`, which
      // `Panel` renders inside the same `role="alert"` as the age. Three views
      // used to compose it as the panel's first child, where a screen reader
      // heard "Services data is 14 minutes old" and never heard why. An age
      // with no cause tells an operator to refresh; the cause tells them where
      // to go, and only one of those is useful when the feed is 503ing.
      //
      // Spread conditionally rather than set to `undefined`:
      // `exactOptionalPropertyTypes` makes those different types, and absent is
      // the shape that renders byte-identically to before.
      return {
        kind: 'stale',
        source,
        fetchedAt: load.servedAt ?? '',
        ...(load.error === undefined ? {} : { reason: load.error.message }),
      };
    case 'ready': {
      const data = load.data as T;
      return empty && empty.when(data) ? { kind: 'empty', message: empty.message } : { kind: 'ready' };
    }
  }
}

/**
 * The sentence a stale panel owes the operator: WHY it is stale.
 *
 * `null` in every other state, including `failed` — there the Panel's own error
 * alert already carries the message, and printing it twice trains the eye to
 * skip it.
 */
export function staleReason(load: Load<unknown>): string | null {
  return loadKind(load) === 'stale' ? (load.error?.message ?? null) : null;
}

/* ------------------------------------------------------------ service view */

/**
 * One service, as the three screens need it — the frozen `ServiceStatus` with
 * every measurement widened to admit "we have no number".
 *
 * This is not a second contract. It is `ServiceStatus` minus the assumption
 * that a measurement exists, which the fixtures could make and a live store
 * cannot: five of the seven services have no probe of their own today, so
 * `null` is the COMMON case. The widening is one-way — every fixture
 * `ServiceStatus` is a valid `ServiceView` (`serviceViewOf` is a total
 * function with no fallbacks in it) — so the demo path renders byte for byte
 * what it rendered before.
 *
 * Absent is never zero, and each field says so in its own shape:
 *
 *   - `latencyMs: null`    the newest probe did not answer
 *   - `p50Ms/p95Ms: null`  no percentile window to compute over
 *   - `spark: null`        no samples at all (NOT a flat line at zero)
 *   - a `null` IN `spark`  that one probe did not answer
 *   - `uptime30d: null`    no runs in the window (NOT 100%, NOT 0%)
 *   - `incidents90d: null` the incident log could not be read (0 is a real count)
 *   - `lastStateChange: null` we have not watched it flip
 */
export type ServiceView = {
  /** `string`, not `ServiceId`, and only here: this is the id the API SERVED.
   *  The seven are a closed set in the contract and the API builds its response
   *  from that same union, but a response is input, and narrowing it to the
   *  union on the way in would mean either a cast or dropping a tile we could
   *  not name. It is used to link and to look up, never to index a Record
   *  without `Object.hasOwn`. */
  id: string;
  short: string;
  name: string;
  /**
   * The vendor half. `level` is ALWAYS the safe reading — the API's
   * `currentLevel`, which is `unknown` whenever the newest poll failed — and
   * never the stored payload's own `level`, which is history. What we last saw
   * is carried separately, on `feed.data`, where it can be rendered as the past
   * tense it is.
   */
  vendor: {
    level: StatusLevel;
    label: string;
    note: string;
    /** Present when some poll has succeeded. `ServiceDetail` branches on
     *  exactly this to tell "answered, told us nothing" from "never
     *  authenticated". */
    lastSuccessfulPoll?: string;
    /** amendment 10 — the level was derived from OUR evidence, not published
     *  by the vendor, and the screen must say so. */
    inferred?: { basis: string };
  };
  ours: ServiceStatus['ours'];
  latencyMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  spark: Array<number | null> | null;
  uptime30d: number | null;
  /** The coverage behind `uptime30d`: when the oldest run in the window was,
   *  and how many there were. A true 100% over forty minutes is still true —
   *  it is the "30 days" caption that would be the lie. */
  uptimeFrom: string | null;
  uptimeSamples: number;
  incidents90d: number | null;
  lastStateChange: string | null;
  /** OUR STORE failed to answer, so every `null` above is ignorance rather
   *  than measurement. Distinct from `feed.error`, which is the vendor's feed. */
  metricsError?: { code: string; message: string };
  /**
   * This service's own vendor feed, as a `Load`. Per-service, because one
   * vendor's feed failing must not stale the other six tiles — the failure
   * this product exists to make visible happens one source at a time.
   *
   * `data` is what the vendor last SAID, for the "was Operational, 3h ago"
   * line. Nothing may colour anything with it.
   */
  feed: Load<{ level: StatusLevel; label: string }>;
};

/** Coverage for the fixture world: a full window, comfortably sampled. The
 *  exact numbers do not matter, only that they clear the "is this figure
 *  qualified?" test, so the demo screens read as they did in Milestone 1. */
const FIXTURE_UPTIME_FROM = new Date(Date.now() - 30 * 86_400_000).toISOString();
const FIXTURE_UPTIME_SAMPLES = 43_200;

/** A fixture service, unchanged, as a view. No measurement is absent in a
 *  fixture and no fixture feed has ever failed, so this is pure widening and
 *  the demo screens render exactly as they did in Milestone 1. */
export function serviceViewOf(s: ServiceStatus): ServiceView {
  return {
    id: s.id,
    short: s.short,
    name: s.name,
    vendor: s.vendor,
    ours: s.ours,
    latencyMs: s.latencyMs,
    p50Ms: s.p50Ms,
    p95Ms: s.p95Ms,
    spark: s.spark,
    uptime30d: s.uptime30d,
    // A fixture is a mature install by construction — the prototype's numbers
    // are a month of history — so its uptime covers the whole window and the
    // tile prints the plain "rolling 30 days" caption. Synthesised here rather
    // than added to the frozen contract: the coverage is a property of a real
    // store's history, and a fixture has none.
    uptimeFrom: FIXTURE_UPTIME_FROM,
    uptimeSamples: FIXTURE_UPTIME_SAMPLES,
    incidents90d: s.incidents90d,
    lastStateChange: s.lastStateChange,
    feed: ready(
      { level: s.vendor.level, label: s.vendor.label },
      s.vendor.lastSuccessfulPoll,
    ),
  };
}

/**
 * The short marker a TILE carries when its own vendor feed is not current.
 *
 * `null` while the feed is fresh or has not answered yet, so the demo tiles —
 * where no feed has ever failed — render exactly what they rendered in
 * Milestone 1 and no baseline moves.
 *
 * Short on purpose: a tile is 190px wide and the vendor's failure message can
 * be a sentence. The tile says THAT it is stale and how old the numbers are;
 * Service detail says WHY, in the feed's own words. The level beside it is
 * already `unknown` and already grey — the API's `currentLevel` saw to that —
 * so this line explains a colour rather than being the only thing carrying it.
 */
export function feedMarker(feed: ServiceView['feed'], now?: number): string | null {
  switch (loadKind(feed)) {
    case 'stale':
      return `Vendor feed unreadable · last read ${feed.servedAt === undefined ? 'at an unknown time' : ago(feed.servedAt, now)}`;
    case 'failed':
      return 'Vendor feed unreadable · never read successfully';
    case 'loading':
    case 'ready':
      return null;
  }
}

/**
 * What the vendor last SAID, in the past tense, for the detail page.
 *
 * This is the one sanctioned reader of `feed.data.level` — the field
 * `store/currentLevel.ts` spends forty lines explaining nobody may colour
 * anything with. Rendering it as history is what it is for; the sentence is
 * written so that it cannot be read as current, and the level beside it is the
 * safe one.
 */
export function lastSeenLine(feed: ServiceView['feed'], now?: number): string | null {
  if (loadKind(feed) !== 'stale' || feed.data === undefined) return null;
  const when = feed.servedAt === undefined ? 'at an unknown time' : ago(feed.servedAt, now);
  return `Last time we could read this feed, ${when}, the vendor said ${feed.data.label}.`;
}

/* ------------------------------------------------------------- the metrics */

/** The one string an absent measurement renders as, everywhere. An em dash,
 *  never `0`, never `—%`, never a blank cell that reads as a rendering bug. */
export const NO_VALUE = '—';

/** `n ms`, or the em dash. A zero is a real measurement and prints as `0 ms`. */
export function latencyText(ms: number | null): string {
  return ms === null ? NO_VALUE : `${ms} ms`;
}

/** `99.96%`, or the em dash. `0` prints as `0.00%` — a total outage is a
 *  reading, and the one thing that must never happen is no-data printing as
 *  100%. */
export function uptimeText(fraction: number | null): string {
  return fraction === null ? NO_VALUE : `${(fraction * 100).toFixed(2)}%`;
}

/** `p50 112 ms · p95 220 ms`, with either half absent. Both or neither is what
 *  the API promises, but the text is written so that one alone still reads. */
export function percentileText(p50: number | null, p95: number | null): string {
  return `p50 ${latencyText(p50)} · p95 ${latencyText(p95)}`;
}

/** A count we read, or the em dash for a count we could not read. `0` is a
 *  fact about a complete log and prints as `0`. */
export function countText(n: number | null): string {
  return n === null ? NO_VALUE : String(n);
}

/**
 * The samples a sparkline can actually draw, and how many were holes.
 *
 * `Sparkline` now takes `Array<number | null>` and breaks the line at a gap, so
 * the holes are DRAWN as holes and this function no longer decides what the
 * chart sees — the raw series goes straight to it. What is left here is the
 * count, which the views render as a sentence beside the chart.
 *
 * Both survive on purpose: a broken line and "2 of 28 probes did not answer"
 * answer different questions, and the count is what survives a glance at a 26px
 * strip on a 190px tile. `values` is still returned because the views branch on
 * whether anything answered at all — which is two different sentences, not a
 * chart state (`spark === null` is "no probe has ever run"; an all-null series
 * is "every recent probe failed to answer").
 */
export function sparkSamples(spark: Array<number | null> | null): { values: number[]; missing: number } {
  if (spark === null) return { values: [], missing: 0 };
  const values = spark.filter((v): v is number => v !== null);
  return { values, missing: spark.length - values.length };
}

/**
 * "6 of 17 probes did not answer" — the count beside a broken line, on both
 * screens, from one definition.
 *
 * The line shows an operator THAT there are gaps. It cannot say how many, or
 * out of how many, and that is the whole of what this sentence adds — read on
 * screen by the lead against real store data, where the detail page's longer
 * version ("and the line breaks where each of them should be") turned out to
 * describe what the reader was already looking at.
 *
 * One helper rather than one literal per view: two screens stating the same
 * fact in two sentences is how the tile and the detail page end up disagreeing
 * about what a hole is called.
 */
export function holesPhrase(missing: number, answered: number): string {
  return `${missing} of ${answered + missing} probes did not answer`;
}

/* ------------------------------------------------------------ incident view */

/** Live incidents are the frozen `Incident`, assembled from what the API
 *  actually serves; the fixtures already are one. One type, so neither screen
 *  has a live branch and a demo branch. */
export type IncidentView = Incident;

/**
 * The first sentence of a served summary, for a row title.
 *
 * `/api/incidents` carries no `title`: the engine computes one and the
 * `incidents` table has no column for it (id, rule_key, service_id, severity,
 * opened_at, resolved_at, summary — that is all of it). So a live row's title
 * is TRUNCATED served text rather than a phrase this file invented; the whole
 * summary is on the detail page underneath it, so nothing is lost, and no
 * clause here is a guess about what happened.
 *
 * A summary with no sentence break comes back whole. It is a title that is too
 * long, which is a layout problem; cutting it at a character count would be a
 * sentence that stops mid-word, which is a lying one.
 */
export function firstSentence(summary: string): string {
  const stop = summary.indexOf('. ');
  return stop === -1 ? summary : summary.slice(0, stop + 1);
}
