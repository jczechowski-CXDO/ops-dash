import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { Incident, Severity } from '@ops-dash/shared';
import type { ServiceSignal } from './rules.js';
import { correlate, serializeSeverity, parseSeverity, toStoreRow, WINDOW_MS } from './correlate.js';

const T0 = '2026-09-19T12:00:00.000Z';
const plus = (ms: number, from = T0) => new Date(Date.parse(from) + ms).toISOString();

const svc = (over: Partial<ServiceSignal> = {}): ServiceSignal => ({
  serviceId: 'jira',
  label: 'Jira',
  vendor: { level: 'operational', platform: 'statuspage' },
  ours: { passing: 1, total: 1 },
  ...over,
});

/** jira: vendor says `level`, our probe is down. The only thing that varies
 *  across the five headline cases is the vendor's word. */
const jiraWith = (level: ServiceSignal['vendor']['level']): ServiceSignal =>
  svc({ vendor: { level, platform: 'statuspage' }, ours: { passing: 0, total: 1 } });

describe('the headline rule: what it does NOT fire on', () => {
  it('vendor unknown + our check failing does NOT open a Sev1', () => {
    // THE case. Amendment 1: `unknown` does not satisfy the vendor half.
    // Four of the seven services sit behind Statuspage, so without this one
    // Statuspage failure becomes four false Sev1s at once — and an operator
    // who has seen a fleet of false Sev1s stops reading Sev1s.
    expect(correlate({ at: T0, services: [jiraWith('unknown')] })).toEqual([]);
  });

  it('vendor maintenance + our check failing does NOT open a Sev1', () => {
    // Announced work is not an incident (amendment 1).
    expect(correlate({ at: T0, services: [jiraWith('maintenance')] })).toEqual([]);
  });

  it('vendor degraded + our check PASSING does NOT open a Sev1', () => {
    // A vendor advisory with our side healthy is informational.
    const services = [svc({ vendor: { level: 'degraded', platform: 'statuspage' }, ours: { passing: 1, total: 1 } })];
    expect(correlate({ at: T0, services })).toEqual([]);
  });

  it('our check failing + vendor operational does NOT open a Sev1', () => {
    // That points at our own network or credentials, not at the vendor.
    const services = [svc({ vendor: { level: 'operational', platform: 'statuspage' }, ours: { passing: 0, total: 2 } })];
    expect(correlate({ at: T0, services })).toEqual([]);
  });
});

describe('the headline rule: what it DOES fire on', () => {
  it('vendor degraded + our check failing opens exactly one Sev1 against the service', () => {
    const [inc, ...rest] = correlate({ at: T0, services: [jiraWith('degraded')] });
    expect(rest).toEqual([]);
    expect(inc).toMatchObject({ ruleKey: 'vendor', serviceId: 'jira', severity: 1, openedAt: T0 });
    expect(inc!.resolvedAt).toBeUndefined();
    expect(inc!.timeline[0]?.kind).toBe('opened');
  });

  it('vendor outage + our check failing opens the same Sev1', () => {
    const [inc] = correlate({ at: T0, services: [jiraWith('outage')] });
    expect(inc).toMatchObject({ ruleKey: 'vendor', severity: 1 });
  });

  it('opens one Sev1 per affected service, not one for the fleet', () => {
    const services = [
      jiraWith('outage'),
      svc({ serviceId: 'claude', label: 'Claude', vendor: { level: 'degraded', platform: 'statuspage' }, ours: { passing: 0, total: 1 } }),
    ];
    expect(correlate({ at: T0, services }).map((i) => i.serviceId)).toEqual(['jira', 'claude']);
  });
});

describe('the blackout rule', () => {
  const dark = (id: ServiceSignal['serviceId']): ServiceSignal =>
    svc({ serviceId: id, vendor: { level: 'unknown', platform: 'statuspage', errorCode: 'http_503' } });

  it('opens one Sev2 when every Statuspage vendor goes unknown together', () => {
    const incidents = correlate({ at: T0, services: [dark('jira'), dark('claude'), dark('openai'), dark('helpjuice')] });
    expect(incidents.map((i) => [i.ruleKey, i.serviceId, i.severity])).toEqual([['blackout', 'platform:statuspage', 2]]);
  });

  it('does not fire when one msgraph service goes unknown alone', () => {
    const lone = svc({ serviceId: 'm365', vendor: { level: 'unknown', platform: 'msgraph', errorCode: 'http_500' } });
    expect(correlate({ at: T0, services: [lone] })).toEqual([]);
  });
});

describe('an incident id survives the next poll', () => {
  it('is the same id when the same condition is correlated twice, with no stored state', () => {
    // Correlated, not read off the id generator: two independent calls.
    const a = correlate({ at: T0, services: [jiraWith('outage')] });
    const b = correlate({ at: plus(60_000), services: [jiraWith('outage')] });
    expect(b[0]!.id).toBe(a[0]!.id);
  });

  it('is the same id days later while the incident is still open, so an ack is not orphaned', () => {
    const first = correlate({ at: T0, services: [jiraWith('outage')] });
    const acked: Incident[] = [{ ...first[0]!, ack: { by: 'oncall@example.com', at: plus(30_000) } }];
    const later = correlate({ at: plus(86_400_000), services: [jiraWith('outage')], open: acked });
    expect(later[0]!.id).toBe(first[0]!.id);
    expect(later[0]!.openedAt).toBe(T0);
    expect(later[0]!.ack).toEqual({ by: 'oncall@example.com', at: plus(30_000) });
  });

  it('is a hash of rule + service + window start, and of nothing else', () => {
    // Re-derived here rather than compared against another correlate() call.
    // A first version of this suite asserted only that two consecutive calls
    // agreed, and an id built from `new Date()` SURVIVED that mutation —
    // both calls landed in the same millisecond, so the ISO strings matched.
    // This one recomputes the formula independently and goes red on any
    // ingredient the id should not have.
    const windowStart = Math.floor(Date.parse(T0) / WINDOW_MS) * WINDOW_MS;
    const expected = `INC-${createHash('sha256').update(`vendor\u0000jira\u0000${windowStart}`).digest('hex').slice(0, 8)}`;
    const [inc] = correlate({ at: T0, services: [jiraWith('outage')] });
    expect(inc!.id).toBe(expected);
  });

  it('gives two different services two different ids', () => {
    const [jira, claude] = correlate({
      at: T0,
      services: [jiraWith('outage'), svc({ serviceId: 'claude', vendor: { level: 'outage', platform: 'statuspage' }, ours: { passing: 0, total: 1 } })],
    });
    expect(claude!.id).not.toBe(jira!.id);
  });
});

describe('resolution, not duplication', () => {
  it('resolves the open incident when the condition clears', () => {
    const open = correlate({ at: T0, services: [jiraWith('outage')] });
    const cleared = correlate({ at: plus(60_000), services: [svc()], open });
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.id).toBe(open[0]!.id);
    expect(cleared[0]!.resolvedAt).toBe(plus(60_000));
    expect(cleared[0]!.timeline[0]!.kind).toBe('resolved');
  });

  it('reopens the same incident when the condition recurs inside the window', () => {
    const open = correlate({ at: T0, services: [jiraWith('outage')] });
    const cleared = correlate({ at: plus(60_000), services: [svc()], open });
    const again = correlate({ at: plus(120_000), services: [jiraWith('outage')], open: cleared });
    expect(again).toHaveLength(1);
    expect(again[0]!.id).toBe(open[0]!.id);
    expect(again[0]!.resolvedAt).toBeUndefined();
    // Identity, not just an id that happens to collide: the reopened incident
    // keeps its original openedAt and its whole history, and says it recurred.
    // Without these three, an implementation that opened a BRAND NEW incident
    // in the same window passed this test — the ids matched because both were
    // derived from the same window start. Found by mutation, not by review.
    expect(again[0]!.openedAt).toBe(T0);
    expect(again[0]!.timeline.map((t) => t.kind)).toEqual(['detected', 'resolved', 'opened']);
  });

  it('carries the id across a window boundary when the recurrence is inside the window', () => {
    // Resolved at 12:29:30 and back at 12:31:00 — one minute apart, but in two
    // different 30-minute buckets. The incident's identity comes from the
    // incident, not from the clock's grid.
    const openedAt = plus(29 * 60_000);
    const open = correlate({ at: openedAt, services: [jiraWith('outage')] });
    const cleared = correlate({ at: plus(29 * 60_000 + 30_000), services: [svc()], open });
    const again = correlate({ at: plus(31 * 60_000), services: [jiraWith('outage')], open: cleared });
    expect(again[0]!.id).toBe(open[0]!.id);
    expect(again[0]!.openedAt).toBe(openedAt);
  });

  it('opens a NEW incident when it recurs after the window has expired', () => {
    // A flap an hour apart is two incidents. Folding them into one would hide
    // the second behind the first's ack.
    const open = correlate({ at: T0, services: [jiraWith('outage')] });
    const cleared = correlate({ at: plus(60_000), services: [svc()], open });
    const again = correlate({ at: plus(WINDOW_MS + 120_000), services: [jiraWith('outage')], open: cleared });
    expect(again).toHaveLength(1);
    expect(again[0]!.id).not.toBe(open[0]!.id);
    expect(again[0]!.openedAt).toBe(plus(WINDOW_MS + 120_000));
  });

  it('emits nothing for an incident that is already resolved and still clear', () => {
    const open = correlate({ at: T0, services: [jiraWith('outage')] });
    const cleared = correlate({ at: plus(60_000), services: [svc()], open });
    expect(correlate({ at: plus(120_000), services: [svc()], open: cleared })).toEqual([]);
  });
});

describe('the engine is pure', () => {
  it('does not mutate the incidents it was given', () => {
    const open = correlate({ at: T0, services: [jiraWith('outage')] });
    const before = JSON.stringify(open);
    correlate({ at: plus(60_000), services: [svc()], open });
    expect(JSON.stringify(open)).toBe(before);
  });

  it('returns the same output for the same input', () => {
    const input = { at: T0, services: [jiraWith('outage')] };
    expect(correlate(input)).toEqual(correlate(input));
  });
});

describe('severity survives the store, whose column is TEXT', () => {
  const ALL: Severity[] = [1, 2, 3, 'info'];

  it('round-trips every Severity member through a real TEXT column', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE incidents (id TEXT PRIMARY KEY, severity TEXT NOT NULL)');
    const ins = db.prepare('INSERT INTO incidents VALUES (?, ?)');
    ALL.forEach((s, i) => ins.run(`INC-${i}`, serializeSeverity(s)));
    const rows = db.prepare('SELECT severity FROM incidents ORDER BY id').all() as Array<{ severity: string }>;
    expect(rows.map((r) => parseSeverity(r.severity))).toEqual(ALL);
    db.close();
  });

  it('reads back the "1.0" node:sqlite produces when a number is bound to a TEXT column', () => {
    // Not hypothetical: node:sqlite binds a JS number as REAL, and TEXT
    // affinity renders it "1.0". Anything that skipped serializeSeverity and
    // passed the number through would store "1.0"; parseSeverity must still
    // answer 1 rather than 'info' or a crash.
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE incidents (id TEXT PRIMARY KEY, severity TEXT NOT NULL)');
    db.prepare('INSERT INTO incidents VALUES (?, ?)').run('INC-x', 1 as unknown as string);
    const row = db.prepare('SELECT severity FROM incidents').get() as { severity: string };
    expect(row.severity).toBe('1.0');          // the defect, pinned as a literal
    expect(parseSeverity(row.severity)).toBe(1);
    db.close();
  });

  it('refuses a severity string it does not recognise rather than guessing', () => {
    expect(() => parseSeverity('critical')).toThrow();
  });
});

describe('the row the store gets', () => {
  it('writes severity as the digit, and an unresolved incident as SQL NULL', () => {
    const [inc] = correlate({ at: T0, services: [jiraWith('outage')] });
    expect(toStoreRow(inc!)).toMatchObject({ severity: '1', resolvedAt: null, ruleKey: 'vendor', serviceId: 'jira' });
  });
});
