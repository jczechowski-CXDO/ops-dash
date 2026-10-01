/**
 * How old is this data? One formatter, published in the Wave 3 Interfaces block,
 * because three independently-written ones already existed by the end of Wave 1.
 *
 * Returns a NON-DIRECTIONAL magnitude — 'less than a minute', '14 minutes',
 * '2 hours', '3 days' — so callers can compose it into whichever sentence they
 * need ('… old', '… ago'). It never says 'in' and never says 'ago' itself.
 *
 * Future timestamps. An earlier version formatted with Intl.RelativeTimeFormat
 * and stripped the literal ' ago', so a fetchedAt ahead of the clock produced
 * 'in 5 minutes', rendering 'data is in 5 minutes old'. Clock skew between us
 * and a vendor API is ordinary, so this is reachable in Milestone 2, not
 * hypothetical. Anything not strictly in the past collapses to
 * 'less than a minute' — the data is, as far as we can tell, current.
 */

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/**
 * Returned when the timestamp cannot be parsed. Deliberately not a plausible
 * age: a bad timestamp must read as a bad timestamp, never as fresh data.
 * Callers that compose a sentence should branch on it — see Panel.tsx.
 */
export const UNKNOWN_AGE = 'an unknown age';

export function ageLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return UNKNOWN_AGE;

  const elapsed = now - then;
  // Covers both "just fetched" and "fetchedAt is ahead of our clock".
  if (elapsed < 60_000) return 'less than a minute';

  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return rtf.format(-minutes, 'minute').replace(' ago', '');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour').replace(' ago', '');
  return rtf.format(-Math.round(hours / 24), 'day').replace(' ago', '');
}
