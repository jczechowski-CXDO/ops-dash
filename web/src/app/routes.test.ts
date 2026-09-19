import { describe, it, expect } from 'vitest';
import { NAV, navHref } from './routes.js';
import { fixtures } from '../fixtures/index.js';

describe('navHref (G3 HIGH-2)', () => {
  const incident = NAV.find((n) => n.id === 'incident')!;

  it('no nav path hard-codes an incident id', () => {
    // The original table hard-coded INC-2291, which does not exist in quiet, so
    // the nav was one click from a red error over a healthy system. Asserted
    // against the table rather than the one entry, so a second offender fails too.
    for (const item of NAV) expect(item.path).not.toMatch(/INC-\d+/);
  });

  it('points at the first open incident, which is the one the list sorts first', () => {
    const first = fixtures.sev1.incidents[0]!;
    expect(navHref(incident, fixtures.sev1.incidents)).toBe(`/incidents/${first.id}`);
  });

  it('falls back to the Overview when nothing is open', () => {
    expect(navHref(incident, fixtures.quiet.incidents)).toBe('/');
    expect(fixtures.quiet.incidents).toHaveLength(0);   // precondition, not decoration
  });

  it('leaves every other nav entry alone', () => {
    for (const item of NAV.filter((n) => n.id !== 'incident')) {
      expect(navHref(item, fixtures.sev1.incidents)).toBe(item.path);
      expect(navHref(item, fixtures.quiet.incidents)).toBe(item.path);
    }
  });
});

describe('navHref skips resolved incidents (G3 M-2)', () => {
  const incident = NAV.find((n) => n.id === 'incident')!;

  it('points at the first OPEN incident, not merely the first', () => {
    // The fixtures cannot express this: none carries resolvedAt, so incidents[0]
    // and the first open one are the same row and the bug was unobservable.
    const list = [
      { id: 'INC-9001', resolvedAt: '2026-09-19T10:00:00.000Z' },
      { id: 'INC-9002' },
    ];
    expect(navHref(incident, list)).toBe('/incidents/INC-9002');
  });

  it('falls back to the Overview when every incident is resolved', () => {
    expect(navHref(incident, [{ id: 'INC-9001', resolvedAt: '2026-09-19T10:00:00.000Z' }])).toBe('/');
  });
});
