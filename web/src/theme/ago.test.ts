import { describe, it, expect } from 'vitest';
import { ago, agePhrase, signedDelta } from './ago.js';
import { UNKNOWN_AGE } from './ageLabel.js';

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('ago / agePhrase', () => {
  it('composes a past instant and a held duration from the same magnitude', () => {
    const iso = minutesAgo(14);
    expect(ago(iso, NOW)).toBe('14 minutes ago');
    expect(agePhrase(iso, NOW)).toBe('14 minutes old');
  });

  it('changes SHAPE on an unknown age rather than interpolating the placeholder', () => {
    // The whole reason these live in one place. Interpolating gives
    // "an unknown age ago", which is not a sentence. Asserted via the exported
    // constant, not the literal, so a reword of UNKNOWN_AGE cannot desync this.
    for (const bad of ['', 'not-a-date', '2026-13-45T99:99:99Z']) {
      expect(ago(bad, NOW)).not.toContain(UNKNOWN_AGE);
      expect(agePhrase(bad, NOW)).not.toContain(UNKNOWN_AGE);
      expect(ago(bad, NOW)).toBe('at an unknown time');
      expect(agePhrase(bad, NOW)).toBe('of unknown age');
    }
  });

  it('handles the multi-word magnitude that defeated a regex twice', () => {
    // '\S+ ago' cannot match 'less than a minute ago'. Two agents shipped a
    // negative assertion defeated by exactly this, so it is exercised here
    // rather than assumed to work.
    expect(ago(minutesAgo(0), NOW)).toBe('less than a minute ago');
    expect(agePhrase(minutesAgo(0), NOW)).toBe('less than a minute old');
  });
});

describe('signedDelta', () => {
  it('signs a rise, leaves a fall its own minus, and never writes +0', () => {
    expect(signedDelta(1102)).toBe('+1,102');
    expect(signedDelta(-2)).toBe('-2');
    expect(signedDelta(0)).toBe('0');
  });
});
