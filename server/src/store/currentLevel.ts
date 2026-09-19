import type { SourceResult, StatusLevel } from '@ops-dash/shared';

/** The vendor payload shape a snapshot carries, narrowed to the one field this
 *  module reads. Deliberately structural rather than importing `Vendor` from an
 *  adapter: the store does not depend on the adapters. */
type HasLevel = { level?: unknown };

/**
 * The only honest way to read a health level off a stored snapshot.
 *
 * G2 HIGH 4, and the trap is subtle enough that it got past a whole milestone.
 *
 * Amendment 9 makes `data` and `error` non-exclusive, and both adapters rely on
 * it: on a failed read they return `error` **and** `data: unknownVendor(...)`,
 * an explicit `unknown` carrying "this is our failure to look, not a statement
 * of health". But `putSnapshot` branches on `error` alone, so that `unknown`
 * payload is discarded and the last GOOD payload is kept instead. `getSnapshot`
 * then hands back the good payload with `degraded: true` and the error attached.
 *
 * That is the right thing for the store to do — destroying the last good
 * reading on one failed poll was G0 BLOCKER 2, and we are not going back. But it
 * means the `data` in a degraded snapshot is **history, not news**, and its
 * `level` is whatever the vendor was the last time we could see them.
 *
 * So: Jira is green at 10:00, its feed 503s from 10:01, and at 13:00 the stored
 * snapshot still says `data.level: 'operational'`. `statusColor` takes exactly
 * that field. A vendor nobody has been able to read for three hours renders
 * green, which is the one thing this product exists to prevent.
 *
 * The rule, therefore: **`data` answers "what did we last see?" and only
 * `error` answers "do we know that now?".** Anything deciding a colour, firing
 * a rule, or counting toward an all-clear must go through here. Anything
 * rendering "was operational, 3h ago" may read `data.level` directly — that is
 * what it is for.
 */
export function currentLevel(snapshot: SourceResult<unknown> | undefined): StatusLevel {
  // Never polled, or no such source. Not a statement of health.
  if (!snapshot) return 'unknown';
  // The newest attempt failed. Whatever the stored payload says, we do not know
  // the current state — and a stale `degraded` feeding a live rule would open a
  // Sev1 on evidence that is minutes old and possibly already wrong.
  if (snapshot.error) return 'unknown';
  const level = (snapshot.data as HasLevel | undefined)?.level;
  // A successful read whose payload carries no level has made no statement.
  return isStatusLevel(level) ? level : 'unknown';
}

/** Validated rather than cast. The payload came out of `JSON.parse` on a column
 *  we wrote, but a half-written row, a schema change or a future writer can all
 *  put something else there, and a cast would let it straight through into a
 *  colour. */
export function isStatusLevel(value: unknown): value is StatusLevel {
  return (
    value === 'operational' ||
    value === 'degraded' ||
    value === 'outage' ||
    value === 'maintenance' ||
    value === 'unknown'
  );
}
