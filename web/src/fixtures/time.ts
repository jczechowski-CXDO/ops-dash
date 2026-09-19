/** Fixture clock.
 *
 *  Task 5 Step 4 writes the Sev1 timeline as literal wall-clock times on today's
 *  date ('…T09:12:00'); Step 6 says to compute every timestamp relative to module
 *  load so the age labels stay sensible whenever the app is opened. Those two
 *  cannot both hold — a fixed 09:12 is in the future at 08:00 and renders a
 *  negative age — so Step 6 wins and the wall-clock strings in the copy are
 *  derived from the same anchors with `clock()`. The prototype's intervals are
 *  preserved exactly; only the anchor moves.
 *
 *  Frozen once, at module load, so every module in the bundle shares one `now`
 *  and the Playwright baselines (which freeze Date before the app loads) stay
 *  deterministic.
 */
export const NOW = Date.now();

const iso = (ms: number): string => new Date(ms).toISOString();

export const secondsAgo = (n: number): string => iso(NOW - n * 1_000);
export const minutesAgo = (n: number): string => iso(NOW - n * 60_000);
export const hoursAgo = (n: number): string => minutesAgo(n * 60);
export const daysAgo = (n: number): string => minutesAgo(n * 24 * 60);

/** Local HH:MM, n minutes before now — the prototype's clock format. */
export function clock(minutesBefore: number): string {
  const d = new Date(NOW - minutesBefore * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Local HH:MM on the calendar day `days` before today — 'yesterday 17:20'. */
export function dayAgoAt(days: number, hour: number, minute: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
