import type { CheckRun, ServiceId } from '@ops-dash/shared';

/**
 * Our half of a service, folded from its check runs. **One window, one rule,
 * one module.**
 *
 * G5 HIGH 1, and the third time this seam produced two answers to one question.
 * The first two were a shared function nobody used and a caller picking the
 * wrong sibling; this one arrived through the ARGUMENT. `index.ts` folded a
 * 50-row window for the engine, `api/tile.ts` folded a 500-row window for the
 * browser, both correctly implementing "the latest run of each distinct check"
 * — and they disagreed whenever a probe had not reported inside the smaller
 * window.
 *
 * Reproduced: a Zendesk pod retired 200 minutes ago while the other pod keeps
 * passing. The engine saw `1/1` and let amendment 10 infer `operational`; the
 * tile saw `1/2` and rendered `Failing`. One process, one store, one instant.
 * Not hypothetical — this repo has already retired probes for being unpassable,
 * and any rename opens a window of hours where the two halves disagree.
 *
 * Both tests named after that agreement passed, because both ran over ten-row
 * fixtures where the window difference cannot appear. The battery was run in
 * the world where the candidates are identical.
 */

/**
 * How many rows back to look for "the latest run of each check".
 *
 * 500 rather than 50: at one poll a minute with two probes on a service that is
 * about eight hours, which comfortably survives a probe that is slow, retired,
 * or renamed. The number matters less than there being exactly one of it — a
 * second constant is how this defect happened.
 */
export const RUN_WINDOW = 500;

/** The latest run of each distinct check, from rows already in hand.
 *
 *  Callers that need several folds of the same history read the window ONCE and
 *  use this, because a second `runsFor` would let the counts and the sparkline
 *  be computed from two different sets of rows. */
export function latestOf(history: readonly CheckRun[]): CheckRun[] {
  const latest = new Map<string, CheckRun>();
  // Newest first, so the first sighting of a check name is its latest run.
  for (const run of history) {
    if (!latest.has(run.check)) latest.set(run.check, run);
  }
  return [...latest.values()];
}

/** The latest run of each distinct check, read from the store. */
export function latestPerCheck(
  store: { runsFor: (serviceId: ServiceId, limit?: number) => CheckRun[] },
  serviceId: ServiceId,
): CheckRun[] {
  return latestOf(store.runsFor(serviceId, RUN_WINDOW));
}

/**
 * The counts the correlation rule and the tile both read.
 *
 * Latest-per-check, never raw rows: Zendesk is two probes on one tile, so three
 * polls of both pods is six rows, and counting them raw reports `4/6 passing`
 * for a service with one dead pod out of two — a number that drifts with the
 * polling cadence rather than with anything real.
 */
export function oursFor(
  store: { runsFor: (serviceId: ServiceId, limit?: number) => CheckRun[] },
  serviceId: ServiceId,
): { passing: number; total: number } {
  return count(latestPerCheck(store, serviceId));
}

export const count = (runs: readonly CheckRun[]): { passing: number; total: number } => ({
  passing: runs.filter((r) => r.result === 'pass').length,
  total: runs.length,
});
