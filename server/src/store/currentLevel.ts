import type { SourceResult, StatusLevel, VendorPlatform } from '@ops-dash/shared';

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

/* ------------------------------------------------------ amendment 10 */

/**
 * Platforms that publish **no health field at all**, only incidents.
 *
 * `zendesk-ssp` alone, and it was verified twice against the live feed — the
 * second time with the account subdomain applied, because pod scoping was the
 * obvious thing that might have changed the answer. It did not: service
 * attributes are `deprecated, description, hasSubservices, name, position,
 * slug` either way, and no `status.json` / `summary.json` / `components.json`
 * endpoint exists.
 *
 * A Set rather than a check inside the function, because the membership is the
 * claim. Adding a platform here says "we have looked, and this one never tells
 * us how it is" — which is a finding about a vendor, not a default.
 */
export const PLATFORMS_WITHOUT_PUBLISHED_HEALTH: ReadonlySet<VendorPlatform> = new Set<VendorPlatform>([
  'zendesk-ssp',
]);

/**
 * The vendor half, with amendment 10 applied.
 *
 * Amendment 4 stopped an absent status field reading as green. It also left
 * Zendesk unable to read anything *but* grey — `unknown` was not a transient
 * state there, it was the only state — and a tile that can never move teaches
 * the operator to ignore it exactly as a permanently-red one does.
 *
 * So for a platform that publishes no health, we may make a statement about
 * **our own evidence**: no open incident on our pod, and every check of ours
 * passing. Four conditions, each load-bearing, each with its own test:
 *
 *   1. the platform publishes no health — one that normally does and said
 *      `unknown` has genuinely failed to tell us something
 *   2. the newest poll SUCCEEDED — a failed read is never inferred over
 *   3. no open incident — otherwise the published level already speaks
 *   4. at least one check of ours, and all of them passing — no evidence is
 *      not evidence, matching `ourCheckFailing`'s treatment of `total === 0`
 *
 * Never downward. `degraded` and `outage` come from published incidents only:
 * inferring an outage from our own failing checks would fold our half into the
 * vendor half, and the Sev1 rule is `vendor degraded/outage AND our check
 * failing`. Both halves must stay independently sourced or the rule confirms
 * itself.
 *
 * Condition 4 is what keeps that true. Inference fires only when our checks all
 * pass, so it can never satisfy the vendor half (`operational` does not), and
 * never suppress one (if our checks were failing there is no inference and the
 * level stays `unknown`, which also does not). The rule is unchanged in both
 * directions — asserted, not asserted-about.
 */
export function vendorLevel(
  snapshot: SourceResult<unknown> | undefined,
  platform: VendorPlatform,
  ours: { passing: number; total: number },
): { level: StatusLevel; inferred?: { basis: string } } {
  const published = currentLevel(snapshot);
  // The vendor spoke. Nothing to infer, in either direction.
  if (published !== 'unknown') return { level: published };
  if (!PLATFORMS_WITHOUT_PUBLISHED_HEALTH.has(platform)) return { level: 'unknown' };
  // Conditions 2 and 3. `currentLevel` already returned `unknown` for a failed
  // read, but it returns `unknown` for several reasons and only one of them is
  // inferable, so this re-checks rather than trusting the shared verdict.
  if (!snapshot || snapshot.error) return { level: 'unknown' };
  if (ours.total === 0 || ours.passing < ours.total) return { level: 'unknown' };

  return {
    level: 'operational',
    inferred: {
      basis: `${ours.passing} of ${ours.total} of our own checks passing, and no open incident published for our pod`,
    },
  };
}
