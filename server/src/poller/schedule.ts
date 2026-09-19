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
  /** Must not be assumed to return — it is wrapped, and a throw is expected. */
  run: () => Promise<unknown>;
};

export type SourceStatus = {
  /** True only for a SUCCESSFUL first poll: we now know the starting state and
   *  have nothing to compare it against, so a change report would be a lie.
   *  A failed first poll knows nothing and is deliberately not a baseline —
   *  marking it one would suppress the report on the first poll that works. */
  baseline: boolean;
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: string;
  runs: number;
  /** Ticks dropped because the previous run was still going. Surfaced rather
   *  than hidden: a source skipping steadily is one whose interval is too short
   *  for its upstream, and nobody would otherwise find out. */
  skipped: number;
};

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
      await source.run();
      st.baseline = !st.hasSucceeded;   // true on the first SUCCESS only
      st.hasSucceeded = true;
      st.lastOkAt = st.lastRunAt;
      delete st.lastError;
    } catch (cause) {
      // Swallowed on purpose, and recorded. An unhandled rejection here would
      // take the process down and with it every other source.
      st.baseline = false;
      st.lastError = String((cause as Error)?.message ?? cause);
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
