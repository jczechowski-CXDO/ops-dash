import type { SourceStatus } from '../poller/schedule.js';

/**
 * Is this source still answering?
 *
 * The last place in the chain where something broken reads calm. `SourceStatus`
 * records `lastOkAt` and nothing else judges it, so a source whose timer has
 * silently stopped — a `setInterval` cleared by a stray `stop()`, an event loop
 * wedged, a `run()` that never settles — keeps the `lastOkAt` it had when it
 * died and every consumer reads it as healthy forever. `lastOkAt` twenty minutes
 * ago is indistinguishable from twenty seconds ago unless you know the cadence,
 * which is why `intervalMs` was added to `SourceStatus` and why the judgement
 * lives here rather than in a route: it is arithmetic over a value and a clock,
 * with no I/O in it, so it can be tested against every case including the ones
 * that are hard to produce in a live process.
 *
 * Pure. No `Date.now()` inside, no store access. The clock is a parameter.
 */

/**
 * Three intervals, and the argument for three.
 *
 * Two is too tight: one slow poll makes a source stale. A 60-second source whose
 * upstream takes 35 seconds on a bad afternoon has a genuine `lastOkAt` age of
 * ~95 seconds with nothing wrong, and an alarm that fires on a slow afternoon is
 * one the operator learns to ignore — the same failure as a permanently-red
 * tile, which this project has already had once.
 *
 * Four or more is too loose to be worth having on the sources that matter: the
 * vendor feeds poll every 60 seconds, so at 4x a dead poller is calm for four
 * minutes and at 10x for ten, by which point the dashboard has been lying for
 * longer than most incidents take to be noticed by a human.
 *
 * Three means two consecutive polls may be missed or late and the third makes it
 * visible — the smallest number that cannot be reached by one bad poll. It is
 * expressed as a multiple rather than a constant because the sources do not
 * share a cadence: 3x is 3 minutes for a vendor feed and 45 minutes for a
 * 15-minute source, and both of those are the right answer for their source.
 */
export const STALE_INTERVALS = 3;

/**
 * ...with a floor of 90 seconds.
 *
 * A future source on a 10-second interval would be stale at 30 seconds under the
 * multiple alone, and a single 9-second Graph call plus a retry gets there
 * without anything being wrong. The floor is the smallest age at which a stopped
 * timer is worth reporting at all, and below it the multiple is noise. It only
 * ever binds on sources faster than 30 seconds, of which there are currently
 * none — it is here so that adding one is not silently an alarm generator.
 */
export const STALE_FLOOR_MS = 90_000;

export type StaleReason =
  /** Answering inside its cadence. */
  | 'fresh'
  /** Never had a successful poll. Not stale-with-old-data; there is no data.
   *  This is `m365` before consent, and it must never read as fresh. */
  | 'never-succeeded'
  /** Overdue, and the poller is still ticking and finding the previous run in
   *  flight. A run that never settles: the upstream is hung, not the timer. */
  | 'wedged'
  /** Overdue with no sign of the poller at all. The timer stopped, the process
   *  is wedged, or every poll is failing — indistinguishable from here, and all
   *  three mean the same thing to a reader: this number is not being updated. */
  | 'silent';

export type Staleness = {
  stale: boolean;
  reason: StaleReason;
  /** Age of the last SUCCESS in ms, or undefined if there has never been one.
   *  Undefined because "no successful poll" has no age, and zero would be the
   *  freshest possible value for the least fresh possible state. */
  ageMs?: number;
  /** The threshold this judgement used, so a consumer can say "3 minutes"
   *  without recomputing it and arriving somewhere else. */
  thresholdMs: number;
};

/** The age at which a source polled every `intervalMs` is overdue. */
export function staleThresholdMs(intervalMs: number): number {
  // A non-finite or non-positive interval is not a cadence. Falling back to the
  // floor keeps the function total: the alternative is NaN, and every comparison
  // against NaN is false, which would make such a source permanently fresh —
  // precisely the failure this file exists to prevent.
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return STALE_FLOOR_MS;
  return Math.max(intervalMs * STALE_INTERVALS, STALE_FLOOR_MS);
}

/**
 * Judge one source against a clock.
 *
 * Measured from `lastOkAt`, deliberately, and not from `lastRunAt`: `lastRunAt`
 * is stamped at the START of a run, so a run that never settles freezes it at a
 * fixed age and a source hung for an hour looks exactly as stale as it did a
 * minute in. `lastOkAt` is stamped at the finish, so its age keeps growing for
 * as long as nothing succeeds — which is the question a reader is actually
 * asking: how old is the data in front of me?
 *
 * `lastSkipAt` then separates the two ways of being overdue. A wedged source
 * keeps ticking and keeps skipping, so `lastSkipAt` stays recent while
 * `lastOkAt` freezes; a source whose timer stopped updates neither. Both are
 * stale — the distinction changes nothing about whether to trust the number, and
 * that is why it is a `reason` and not a second boolean.
 */
export function sourceStaleness(status: SourceStatus, now: Date | number): Staleness {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const thresholdMs = staleThresholdMs(status.intervalMs);

  if (status.lastOkAt === undefined) {
    return { stale: true, reason: 'never-succeeded', thresholdMs };
  }
  const okMs = Date.parse(status.lastOkAt);
  if (Number.isNaN(okMs)) {
    // A timestamp we cannot read is not evidence of freshness. Treated as
    // silence rather than thrown on: this runs inside a health route, and a
    // corrupt field must not take the route down with it.
    return { stale: true, reason: 'silent', thresholdMs };
  }

  const ageMs = nowMs - okMs;
  if (ageMs <= thresholdMs) return { stale: false, reason: 'fresh', ageMs, thresholdMs };

  const skipMs = status.lastSkipAt === undefined ? NaN : Date.parse(status.lastSkipAt);
  const skippingNow = Number.isFinite(skipMs) && nowMs - skipMs <= thresholdMs;
  return { stale: true, reason: skippingNow ? 'wedged' : 'silent', ageMs, thresholdMs };
}

/** Every stale source, by name. The shape a health route wants: absent means
 *  nothing is stale, and a name present is a source not to be trusted. */
export function staleSources(
  all: Record<string, SourceStatus>,
  now: Date | number,
): Record<string, Staleness> {
  return Object.fromEntries(
    Object.entries(all)
      .map(([name, st]) => [name, sourceStaleness(st, now)] as const)
      .filter(([, s]) => s.stale),
  );
}
