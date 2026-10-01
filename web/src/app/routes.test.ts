import { describe, it, expect } from 'vitest';
import { NAV, navHref, isNavCurrent } from './routes.js';
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

describe('isNavCurrent (G3½ MEDIUM — two entries were current at once)', () => {
  const overview = NAV.find((n) => n.id === 'overview')!;
  const incident = NAV.find((n) => n.id === 'incident')!;
  const service = NAV.find((n) => n.id === 'service')!;

  it('does not mark the Incident entry current just because its href fell back to /', () => {
    // The bug: with nothing open, navHref returns '/', which is also the
    // Overview's path — so both rendered aria-current="page" on the same page.
    const href = navHref(incident, fixtures.quiet.incidents);
    expect(href).toBe('/');
    expect(isNavCurrent(incident, '/', href)).toBe(false);
    expect(isNavCurrent(overview, '/', navHref(overview, fixtures.quiet.incidents))).toBe(true);
  });

  it('marks exactly one entry current on every route, in both worlds', () => {
    // The relationship rather than the two interesting cases: whatever the
    // routing does, a nav can never have two current entries or none.
    for (const mode of ['quiet', 'sev1'] as const) {
      const incidents = fixtures[mode].incidents;
      const routes = ['/', '/services/m365', '/entra', '/endpoints', '/email', '/settings'];
      if (incidents[0]) routes.push(`/incidents/${incidents[0].id}`);
      for (const pathname of routes) {
        const current = NAV.filter((i) => isNavCurrent(i, pathname, navHref(i, incidents)));
        expect(current.map((i) => i.id), `${mode} ${pathname}`).toHaveLength(1);
      }
    }
  });

  it('marks a detail entry current for ANY record of its kind, not just its href', () => {
    // The converse half: the Incident href resolves to the first OPEN incident,
    // so on any other incident's page the entry was not current on its own page.
    const href = navHref(incident, fixtures.sev1.incidents);
    expect(href).not.toBe('/incidents/INC-2286');
    expect(isNavCurrent(incident, '/incidents/INC-2286', href)).toBe(true);
    expect(isNavCurrent(service, '/services/zendesk', navHref(service, []))).toBe(true);
  });
});
