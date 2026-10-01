import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { Incident, Severity } from '@ops-dash/shared';
import type { IdentitySignal, ServiceSignal } from './rules.js';
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
  /** Sev of the single incident these cases produce, or `none`. Reaching for the
   *  severity rather than the emptiness is the whole correction here: three of
   *  these tests were named "does NOT open a Sev1" and asserted `[]`, which is a
   *  strictly stronger claim than their names made — and the wrong one. Section 7
   *  promises a Sev2 for exactly these shapes, so for two milestones they pinned
   *  the absence of a rule the contract of record requires. One of them even
   *  carried section 7's own words in its comment. */
  const sevOf = (services: ServiceSignal[]): Severity | 'none' => {
    const found = correlate({ at: T0, services });
    if (found.length === 0) return 'none';
    expect(found).toHaveLength(1);
    return found[0]!.severity;
  };

  it('vendor unknown + our check failing is a Sev2, never a Sev1', () => {
    // Amendment 1: `unknown` does not satisfy the vendor half. Four of the seven
    // services sit behind Statuspage, so accepting it would turn one Statuspage
    // failure into four false Sev1s — and an operator who has seen a fleet of
    // false Sev1s stops reading Sev1s. But it is not nothing: we have lost sight
    // of the vendor AND something here is measurably broken.
    expect(sevOf([jiraWith('unknown')])).toBe(2);
  });

  it('vendor maintenance + our check failing is a Sev2, never a Sev1', () => {
    // Announced work is not an incident (amendment 1) — so it does not corroborate
    // our failing probe, which leaves the failure uncorroborated rather than absent.
    expect(sevOf([jiraWith('maintenance')])).toBe(2);
  });

  it('vendor degraded + our check PASSING opens nothing at all', () => {
    // The one genuinely empty case of the four, and the reason `sevOf` returns
    // 'none' rather than this suite asserting `[]` everywhere: an advisory with our
    // side healthy is informational. Both other halves need evidence from us.
    const services = [svc({ vendor: { level: 'degraded', platform: 'statuspage' }, ours: { passing: 1, total: 1 } })];
    expect(sevOf(services)).toBe('none');
  });

  it('our check failing + vendor operational is a Sev2 pointing at our own side', () => {
    // Section 7, verbatim: "our checks failing with no vendor advisory is a Sev2
    // pointing at our own network or credentials".
    const services = [svc({ vendor: { level: 'operational', platform: 'statuspage' }, ours: { passing: 0, total: 2 } })];
    expect(sevOf(services)).toBe(2);
  });

  it('no probe configured is not a failing probe, however dark the vendor', () => {
    // SURVIVOR. `total === 0` is no evidence, and no evidence may not manufacture
    // an incident any more than it may render green. This is what stops `ourside`
    // firing for the four services that have no synthetic probe at all.
    const services = [svc({ vendor: { level: 'unknown', platform: 'statuspage' }, ours: { passing: 0, total: 0 } })];
    expect(sevOf(services)).toBe('none');
  });

  it('a vendor we have not read yet is not an uncorroborated failure', () => {
    // COLD START, the same defect as INC-119d4dc7 one rule over. After a restart
    // the store already holds probe history, so `ours` is populated on the first
    // tick while the vendor snapshot is still null. Without the exclusion this
    // opens a Sev2 on every boot, blaming our network for a feed we had not asked.
    const services = [
      svc({
        vendor: { level: 'unknown', platform: 'statuspage', errorCode: 'never_polled' },
        ours: { passing: 0, total: 1 },
      }),
    ];
    expect(sevOf(services)).toBe('none');
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

describe('not firing clears an incident; not LOOKING must not', () => {
  // The same defect as the phantom cold-start Sev2, arriving from the opposite
  // side: there, absent data manufactured an incident; here, absent data
  // destroys one. This direction is worse, because resolving writes a timeline
  // entry saying *the condition cleared* — a sentence that is false and that an
  // operator will read as true.
  const openOne = () => correlate({ at: T0, services: [jiraWith('outage')] });

  it('carries the incident untouched when its rule could not be evaluated', () => {
    const open = openOne();
    const blind = correlate({
      at: plus(60_000),
      services: [svc()],                       // condition gone from the services
      open,
      evaluatedRules: new Set(['blackout']),   // ...but `vendor` was not looked at
    });
    // Nothing written at all: not a resolution, and not a second incident.
    expect(blind).toHaveLength(0);
    // And the prior is still open — read from the input we handed in, since
    // correlate returns only what CHANGED.
    expect(open[0]!.resolvedAt).toBeUndefined();
  });

  it('resolves it when the rule WAS evaluated and found nothing — the other half', () => {
    // Without this, "carry when blind" could be implemented as "never resolve"
    // and the test above would still pass.
    const open = openOne();
    const looked = correlate({
      at: plus(60_000),
      services: [svc()],
      open,
      evaluatedRules: new Set(['vendor', 'ourside', 'blackout']),
    });
    expect(looked).toHaveLength(1);
    expect(looked[0]!.resolvedAt).toBe(plus(60_000));
    expect(looked[0]!.timeline[0]!.kind).toBe('resolved');
  });

  it('omitting the field keeps today’s behaviour exactly, for every existing caller', () => {
    // The additive claim, asserted rather than assumed. `index.ts` passes no
    // such set and must be unaffected.
    const open = openOne();
    const withoutField = correlate({ at: plus(60_000), services: [svc()], open });
    const withAllRules = correlate({
      at: plus(60_000), services: [svc()], open,
      evaluatedRules: new Set(['vendor', 'ourside', 'blackout']),
    });
    expect(withoutField).toEqual(withAllRules);
    expect(withoutField[0]!.resolvedAt).toBe(plus(60_000));
  });

  it('blindness does not stop a rule that CAN see from resolving its own', () => {
    // Per-rule, not global. One stale input must not freeze the whole estate.
    const vendorOpen = correlate({ at: T0, services: [jiraWith('outage')] });
    const out = correlate({
      at: plus(60_000),
      services: [svc()],
      open: vendorOpen,
      evaluatedRules: new Set(['vendor']),     // vendor could see; others could not
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.ruleKey).toBe('vendor');
    expect(out[0]!.resolvedAt).toBe(plus(60_000));
  });

  it('an incident whose rule no longer exists is carried, not silently cleared', () => {
    // Decided, not stumbled into. A caller that passes a set omitting a RETIRED
    // rule keeps that rule's incidents forever, because nothing can fire them
    // again and nothing here closes them. An incident outliving its rule wants a
    // human, not an automatic claim that it cleared. Pinned so the next person
    // meets a test rather than a mystery.
    const stranded = {
      ...correlate({ at: T0, services: [jiraWith('outage')] })[0]!,
      ruleKey: 'a_rule_that_was_removed',
    };
    const out = correlate({
      at: plus(60_000), services: [svc()], open: [stranded],
      evaluatedRules: new Set(['vendor', 'ourside', 'blackout']),
    });
    expect(out).toEqual([]);
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

describe('the identity rules through correlate, including the stale tick', () => {
  const ident = (over: Partial<IdentitySignal> = {}): IdentitySignal => ({
    observedAt: T0,
    failedSignIns: { count: 68, windowMs: 15 * 60 * 1000 },
    credentialsExpiring: { count: 0, horizonDays: 14 },
    successfulLegacySignIns: 0,
    confirmedCompromised: 0,
    ...over,
  });

  it('opens a Sev1 on a confirmed compromise and gives it a stable id', () => {
    const first = correlate({ at: T0, services: [], identity: ident({ confirmedCompromised: 1 }) });
    expect(first).toHaveLength(1);
    expect(first[0]!.severity).toBe(1);
    expect(first[0]!.ruleKey).toBe('risky');
    const again = correlate({
      at: plus(60_000), services: [], identity: ident({ observedAt: plus(60_000), confirmedCompromised: 1 }), open: first,
    });
    expect(again[0]?.id ?? first[0]!.id).toBe(first[0]!.id);
  });

  it('does NOT resolve it on the fourteen ticks where the snapshot is merely old', () => {
    // The whole reason both halves of this work had to land together. The Entra
    // source polls every fifteen minutes and correlation runs every sixty
    // seconds, so a signal that is minutes old is the NORMAL case — and before
    // `evaluatedRules` the rule produced no finding and the incident was
    // resolved, with a timeline entry announcing a recovery that never happened.
    const open = correlate({ at: T0, services: [], identity: ident({ confirmedCompromised: 1 }) });
    // Ten minutes later: still inside the 45-minute window, so it is evaluated
    // and still firing.
    const warm = correlate({
      at: plus(600_000), services: [], open, identity: ident({ confirmedCompromised: 1 }),
    });
    expect(warm.every((i) => i.resolvedAt === undefined)).toBe(true);
    // An hour later with NO fresh signal: not evaluated, so carried untouched.
    const blind = correlate({ at: plus(3_600_000), services: [], open, identity: ident({ confirmedCompromised: 1 }) });
    expect(blind).toEqual([]);
    // And with no identity at all — the cold start, or a dead source.
    expect(correlate({ at: plus(3_600_000), services: [], open })).toEqual([]);
  });

  it('DOES resolve it when a fresh signal says the compromise is gone', () => {
    // The other half. Without it, "carry when stale" could be implemented as
    // "never resolve an identity incident" and the test above would still pass.
    const open = correlate({ at: T0, services: [], identity: ident({ confirmedCompromised: 1 }) });
    const cleared = correlate({
      at: plus(600_000), services: [], open,
      identity: ident({ observedAt: plus(600_000), confirmedCompromised: 0 }),
    });
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.resolvedAt).toBe(plus(600_000));
    expect(cleared[0]!.timeline[0]!.kind).toBe('resolved');
  });

  it('a service incident still resolves normally while identity is blind', () => {
    // Per-rule, end to end: one stale input must not freeze the estate.
    const open = correlate({ at: T0, services: [jiraWith('outage')] });
    const out = correlate({ at: plus(60_000), services: [svc()], open });   // no identity at all
    expect(out).toHaveLength(1);
    expect(out[0]!.ruleKey).toBe('vendor');
    expect(out[0]!.resolvedAt).toBe(plus(60_000));
  });
});
