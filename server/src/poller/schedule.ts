import type { SourceResult } from '@ops-dash/shared';

/**
 * One interval per source, isolated failures.
 *
 * The design decision worth naming: there is no single loop over all sources.
 * A sequential loop is simpler and wrong — a nine-second Graph call would make
 * the sixty-second vendor feeds drift by nine seconds every cycle, and one
 * adapter throwing would stop every other source. Each source gets its own
 * timer and its own error boundary, so a vendor's outage cannot become a
 * blackout of our own making.
 */

export type Source = {
  name: string;
  intervalMs: number;
  /**
   * Must return a `SourceResult`, and the return type is the whole point.
   *
   * G2 BLOCKER 1. This was `Promise<unknown>`, and a poll counted as
   * successful if the promise resolved. But **nothing in this repo throws**:
   * `fetchJson` and both adapters turn a broken feed into *data* — an errored
   * `SourceResult` — deliberately, because a transport failure is a fact to
   * report and not an exception to handle. So the only failure the poller could
   * see was the one that never happens, and a source whose feed answered 503
   * every minute for an hour reported `lastOkAt` seconds old and, on its first
   * tick, `baseline: true`.
   *
   * That is not a missing feature, it is the product's central promise
   * inverted: a failed fetch rendering as green, one layer below the UI where
   * every guard was pointed. `/api/health` already serves `allStatus()`, so it
   * was a served green for a source never once read.
   *
   * It is still wrapped and a throw is still caught — an adapter CAN throw by
   * mistake, and that must not take the other sources down. A throw is simply
   * no longer the only way to fail.
   */
  run: () => Promise<SourceResult<unknown>>;
};

export type SourceStatus = {
  /** True only for a SUCCESSFUL first poll: we now know the starting state and
   *  have nothing to compare it against, so a change report would be a lie.
   *  A failed first poll knows nothing and is deliberately not a baseline —
   *  marking it one would suppress the report on the first poll that works. */
  baseline: boolean;
  lastRunAt?: string;
  lastOkAt?: string;
  /** Why the last poll failed, whether it threw or returned an errored
   *  result. Cleared on a success, so its presence means "failing now". */
  lastError?: string;
  runs: number;
  /** Ticks dropped because the previous run was still going. Surfaced rather
   *  than hidden: a source skipping steadily is one whose interval is too short
   *  for its upstream, and nobody would otherwise find out. */
  skipped: number;
};

/** The one place a poll is recorded as failed, so the two paths into it — an
 *  errored result and a throw — cannot drift apart. `lastOkAt` is deliberately
 *  left alone: it means "when we last succeeded", and a failure does not change
 *  when that was. It is `lastError` being set that says we are failing now. */
function fail(st: { baseline: boolean; lastError?: string }, why: string): void {
  st.baseline = false;
  st.lastError = why;
}

/** Stringify a thrown value that may be actively hostile to being stringified.
 *
 *  G2 HIGH 3. `String((cause as Error)?.message ?? cause)` throws on a
 *  null-prototype object and on anything with a throwing `toString` — and it
 *  throws INSIDE the catch, so it escapes `tick`, which is called as
 *  `void tick(source)` from a timer. That is an unhandled rejection: the exact
 *  process death the catch exists to prevent, reachable through the catch
 *  itself. */
function describe(cause: unknown): string {
  try {
    if (cause instanceof Error && typeof cause.message === 'string') return cause.message;
    const message = (cause as { message?: unknown } | null | undefined)?.message;
    if (typeof message === 'string') return message;
    return String(cause);
  } catch {
    // Nothing about the value can be trusted, including its type tag.
    return 'unstringifiable thrown value';
  }
}

export function createSchedule(sources: Source[]) {
  const status = new Map<string, SourceStatus & { inFlight: boolean; hasSucceeded: boolean }>();
  const timers: NodeJS.Timeout[] = [];
  for (const s of sources) {
    status.set(s.name, { baseline: false, runs: 0, skipped: 0, inFlight: false, hasSucceeded: false });
  }

  async function tick(source: Source) {
    const st = status.get(source.name)!;

    // Skip rather than stack. Two concurrent runs of one source race on its
    // store row and the loser silently wins; the next tick reports what it
    // finds, which is honest and costs one cycle.
    if (st.inFlight) {
      st.skipped += 1;
      return;
    }

    st.inFlight = true;
    st.runs += 1;
    st.lastRunAt = new Date().toISOString();
    try {
      const result = await source.run();
      // The BLOCKER-1 line. A resolved promise is not a successful poll: the
      // adapters report failure IN the envelope. `error` is the only signal
      // that means "we did not read this" — `empty` and `degraded` are both
      // completed reads. An empty feed has told us something true (amendment
      // 4); a degraded one told us most of it. Neither is a failure to look.
      if (result.error) {
        fail(st, `${result.error.code}: ${result.error.message}`);
        return;
      }
      st.baseline = !st.hasSucceeded;   // true on the first SUCCESS only
      st.hasSucceeded = true;
      st.lastOkAt = st.lastRunAt;
      delete st.lastError;
    } catch (cause) {
      // Swallowed on purpose, and recorded. An unhandled rejection here would
      // take the process down and with it every other source. Reaching this
      // means an adapter broke its own contract, which is OUR bug, so the
      // message says so rather than reading like a vendor outage.
      fail(st, `threw: ${describe(cause)}`);
    } finally {
      st.inFlight = false;
    }
  }

  return {
    start() {
      for (const source of sources) {
        // Immediately, then on the interval. Waiting a full interval would mean
        // fifteen empty minutes after every restart for a 15-minute source.
        void tick(source);
        const t = setInterval(() => void tick(source), source.intervalMs);
        // Do not hold the process open for a timer; the server's listener does
        // that, and a poller that outlives it is a leak in tests.
        t.unref?.();
        timers.push(t);
      }
    },
    stop() {
      // splice() rather than iterating: a second stop() then has nothing to do.
      //
      // Mutation note: replacing this with a plain `for (const t of timers)` is
      // an EQUIVALENT mutant and no assertion can kill it — clearInterval on an
      // already-cleared id is a documented no-op, so the two forms are
      // indistinguishable from outside. Recorded as survived-and-equivalent
      // rather than papered over with a test that appears to cover it. splice
      // is still the better form: it is the version that stays correct if
      // start() is ever made re-entrant.
      for (const t of timers.splice(0)) clearInterval(t);
    },
    statusOf(name: string): SourceStatus | undefined {
      const st = status.get(name);
      if (!st) return undefined;
      const { inFlight: _i, hasSucceeded: _h, ...rest } = st;
      return rest;
    },
    allStatus(): Record<string, SourceStatus> {
      return Object.fromEntries([...status.keys()].map((k) => [k, this.statusOf(k)!]));
    },
  };
}
