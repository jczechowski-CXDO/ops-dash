import type { SourceResult } from '@ops-dash/shared';
import { describeThrown } from '../http/describeThrown.js';

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
  /** The interval this source is polled at, echoed so a consumer can judge
   *  freshness without a second table of its own.
   *
   *  G2 and the API's owner arrived here from opposite ends: `lastOkAt` twenty
   *  minutes ago is indistinguishable from twenty seconds ago unless you know
   *  the cadence, so a source whose timer has silently stopped reads healthy
   *  forever. `Source` already knows the number; anything else keeping its own
   *  copy would be a second source of truth for it. */
  intervalMs: number;
  /** When the most recent tick was dropped.
   *
   *  G2 MEDIUM 8. `lastRunAt` freezes at the START of a run that never settles,
   *  so a consumer computing staleness from it sees a fixed age rather than a
   *  growing one — a source hung for an hour looks exactly as stale as it did a
   *  minute in. `skipped` climbs, so the skip is not silent, but nothing
   *  recorded WHEN. This does. */
  lastSkipAt?: string;
};

/** The one place a poll is recorded as failed, so the two paths into it — an
 *  errored result and a throw — cannot drift apart. `lastOkAt` is deliberately
 *  left alone: it means "when we last succeeded", and a failure does not change
 *  when that was. It is `lastError` being set that says we are failing now. */
function fail(st: { baseline: boolean; lastError?: string }, why: string): void {
  st.baseline = false;
  st.lastError = why;
}

/** Where the poller talks.
 *
 *  A parameter with a default rather than a bare `console.log`, because a test
 *  that has to silence stdout to stay readable is a test that will one day
 *  silence the thing it was meant to check. The default writes to stderr:
 *  stdout may one day carry structured output, and a log line is not a result. */
export type Logger = (line: string) => void;

const defaultLog: Logger = (line) => process.stderr.write(`[poller] ${line}\n`);

export function createSchedule(sources: Source[], log: Logger = defaultLog) {
  const status = new Map<string, SourceStatus & { inFlight: boolean; hasSucceeded: boolean }>();
  const timers: NodeJS.Timeout[] = [];
  for (const s of sources) {
    status.set(s.name, {
      baseline: false, runs: 0, skipped: 0, intervalMs: s.intervalMs,
      inFlight: false, hasSucceeded: false,
    });
  }

  async function tick(source: Source) {
    const st = status.get(source.name)!;

    // Skip rather than stack. Two concurrent runs of one source race on its
    // store row and the loser silently wins; the next tick reports what it
    // finds, which is honest and costs one cycle.
    if (st.inFlight) {
      st.skipped += 1;
      st.lastSkipAt = new Date().toISOString();
      log(`skip ${source.name} — previous run still in flight (${st.skipped} so far)`);
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
        log(`fail ${source.name} — ${st.lastError}`);
        return;
      }
      st.baseline = !st.hasSucceeded;   // true on the first SUCCESS only
      st.hasSucceeded = true;
      // The FINISH, not `lastRunAt` which is the start. G2 LOW 11. For a source
      // that takes nine seconds, recording the start overstates the freshness of
      // what we hold by nine seconds — and freshness is the number the whole
      // dashboard is about.
      st.lastOkAt = new Date().toISOString();
      delete st.lastError;
      // Global Constraints: a baseline "must say so explicitly in its return
      // value AND its log line". The return value half was done; this is the
      // other half. It matters because the first successful poll is the one
      // moment the operator cannot tell a real all-clear from a cold start.
      if (st.baseline) log(`baseline ${source.name} — first successful poll, nothing to compare against yet`);
    } catch (cause) {
      // Swallowed on purpose, and recorded. An unhandled rejection here would
      // take the process down and with it every other source. Reaching this
      // means an adapter broke its own contract, which is OUR bug, so the
      // message says so rather than reading like a vendor outage.
      fail(st, `threw: ${describeThrown(cause)}`);
      log(`ERROR ${source.name} threw — this is our bug, not the vendor's: ${st.lastError}`);
    } finally {
      st.inFlight = false;
    }
  }

  function statusOf(name: string): SourceStatus | undefined {
    const st = status.get(name);
    if (!st) return undefined;
    const { inFlight: _i, hasSucceeded: _h, ...rest } = st;
    return rest;
  }

  return {
    start() {
      // Idempotent. G2 MEDIUM 5: a second `start()` used to add a second timer
      // per source, doubling every poll rate silently — five calls gave five
      // times the traffic to other people's systems, which is the one failure
      // here with a victim outside this machine.
      if (timers.length > 0) return;
      for (const source of sources) {
        // Immediately, then on the interval. Waiting a full interval would mean
        // fifteen empty minutes after every restart for a 15-minute source.
        // A second floor under the error boundary. `tick` already catches
        // everything, including a value that resists being stringified — but
        // this is called as `void tick(...)`, so if anything ever DID escape it
        // would become an unhandled rejection, and Node 24 kills the process on
        // those. That would take every other source down with it, which is the
        // exact blackout-of-our-own-making this file exists to prevent. Cheap
        // insurance against a future edit to the catch block.
        const guarded = () => {
          tick(source).catch((cause: unknown) => {
            log(`ERROR ${source.name} escaped its own error boundary: ${describeThrown(cause)}`);
          });
        };
        guarded();
        const t = setInterval(guarded, source.intervalMs);
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
    statusOf,
    allStatus(): Record<string, SourceStatus> {
      // `statusOf` by closure, not `this.statusOf`. G2 LOW 10: the object's
      // methods are routinely destructured — `const { allStatus } = schedule` is
      // exactly how a Fastify route would take it — and a `this` reference makes
      // that throw. Nothing here needs an identity.
      return Object.fromEntries([...status.keys()].map((k) => [k, statusOf(k)!]));
    },
  };
}
