import { describe, it, expect } from 'vitest';
import { ago, agePhrase, signedDelta, clockStamp } from './ago.js';
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

describe('clockStamp', () => {
  const at = (iso: string) => clockStamp(iso, NOW);

  it('is a bare clock for today and day-qualified for anything older', () => {
    expect(at(minutesAgo(90))).toMatch(/^\d\d:\d\d$/);
    // Two days back: the case that read as today on the incident hero.
    expect(at(minutesAgo(2 * 24 * 60))).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/);
  });

  it('never lets an older instant pass as a bare time', () => {
    // The relationship, not the two samples: any instant on a different
    // calendar day must carry its day, at every offset.
    for (const days of [1, 2, 3, 7, 30]) {
      expect(at(minutesAgo(days * 24 * 60)), `${days}d`).not.toMatch(/^\d\d:\d\d$/);
    }
  });

  it('degrades to prose on an unparseable instant rather than printing NaN:NaN', () => {
    expect(at('not-a-date')).toBe('unknown time');
  });
});
