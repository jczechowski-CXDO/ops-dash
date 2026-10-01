/**
 * How long the store keeps things, and why those numbers.
 *
 * Security review MEDIUM-2: `check_runs` grows at one row per probe per minute
 * forever — 1,576,800 rows and 263 MB measured over one year at M2 cadence,
 * with nothing deleting and nothing vacuuming. M3 adds probes and services, so
 * the row rate goes up, not down. The time to add retention is before the table
 * is large.
 *
 * The windows are exported and every deletion takes them as a parameter, so a
 * test can pin the arithmetic against a literal rather than re-deriving it the
 * same way the code did.
 */

/**
 * Probe history: 45 days.
 *
 * The floor is set by the contract, not by taste. `ServiceTile.uptime30d` and
 * the p50/p95 pair are computed over a 30-day window, so anything at or under
 * 30 days silently truncates a contract field — an `uptime30d` computed from 28
 * days of rows is not labelled as such anywhere and reads as a real month.
 *
 * The 15 days above that are slack for the three ways a 30-day query can reach
 * further back than you expect: a prune that ran late (or a process that was
 * down for a week, so the first prune after it comes back is deleting a fortnight
 * at once), clock skew between the probe's `at` and the query's `since`, and an
 * operator widening the window by hand while investigating something that
 * started a month ago. Each of those is small; none of them should be able to
 * quietly shorten a published number.
 *
 * The cost of the slack is the only reason not to take 90 days as MEDIUM-2
 * suggested: at the measured 263 MB/year, 45 days is a ~32 MB steady state and
 * 90 days is ~65 MB, and M3's extra probes multiply both. 32 MB of probe history
 * to serve a 30-day window is a proportion I can defend; 65 MB is paying double
 * for headroom nothing asks for.
 */
export const CHECK_RUN_RETENTION_DAYS = 45;

/**
 * Resolved incidents: 180 days.
 *
 * **MEDIUM-2's suggested fix is wrong here and I am not following it.** It says
 * to prune "resolved incidents older than the correlation window" — 30 minutes.
 * `ServiceTile.incidents90d` is a frozen contract field that counts incidents
 * over ninety days, so that prune would empty the table on every run and serve a
 * hard zero on every tile. Nothing in the review's own measurement covers
 * incidents; the finding is about `check_runs`, and the incident clause looks
 * like it was written from the engine's needs alone.
 *
 * 180 days is twice the widest window anything reads, on a table that gains a
 * handful of rows a day rather than one a minute — it is not where the bytes
 * are, so the generous number is free. An incident older than half a year that
 * no screen counts and no rule owns is history, not data.
 */
export const RESOLVED_INCIDENT_RETENTION_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The ISO timestamp at which a row of the given age becomes deletable. Rows
 *  strictly older than this go; a row exactly on the boundary is kept, because
 *  the boundary is inside the window a query may still ask for. */
export function cutoff(now: Date | number, days: number): string {
  const ms = typeof now === 'number' ? now : now.getTime();
  return new Date(ms - days * DAY_MS).toISOString();
}
