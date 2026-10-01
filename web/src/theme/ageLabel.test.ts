import { describe, it, expect } from 'vitest';
import { ageLabel, UNKNOWN_AGE } from './ageLabel.js';

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('ageLabel', () => {
  it('reports a non-directional magnitude, never "ago" and never "in"', () => {
    expect(ageLabel(ago(14 * 60_000), NOW)).toBe('14 minutes');
    expect(ageLabel(ago(60 * 60_000), NOW)).toBe('1 hour');
    expect(ageLabel(ago(2 * 60 * 60_000), NOW)).toBe('2 hours');
    expect(ageLabel(ago(3 * 24 * 60 * 60_000), NOW)).toBe('3 days');
  });

  it('never renders a future timestamp as an age', () => {
    // Clock skew between us and a vendor API is ordinary. The previous version
    // formatted with Intl.RelativeTimeFormat and stripped the literal ' ago',
    // so this produced 'in 5 minutes' — rendering 'data is in 5 minutes old'.
    const future = new Date(NOW + 5 * 60_000).toISOString();
    expect(ageLabel(future, NOW)).toBe('less than a minute');
    expect(ageLabel(future, NOW)).not.toContain('in ');
    expect(ageLabel(future, NOW)).not.toContain('ago');
  });

  it('collapses a just-fetched timestamp rather than saying "0 minutes"', () => {
    expect(ageLabel(ago(20_000), NOW)).toBe('less than a minute');
    expect(ageLabel(ago(0), NOW)).toBe('less than a minute');
  });

  it('refuses to invent a plausible age for an unparseable timestamp', () => {
    expect(ageLabel('not a date', NOW)).toBe(UNKNOWN_AGE);
    // The failure must not be mistakable for fresh data.
    expect(ageLabel('not a date', NOW)).not.toBe(ageLabel(ago(20_000), NOW));
  });

  it('defaults to the current clock when no now is supplied', () => {
    expect(ageLabel(new Date(Date.now() - 30 * 60_000).toISOString())).toBe('30 minutes');
  });
});
