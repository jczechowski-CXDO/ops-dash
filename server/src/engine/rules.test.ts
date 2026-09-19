import { describe, it, expect } from 'vitest';
import type { StatusLevel } from '@ops-dash/shared';
import {
  RULES,
  ourCheckFailing,
  vendorHalfSatisfied,
  evaluate,
  type ServiceSignal,
} from './rules.js';

/* The five StatusLevel members, written out as literals rather than derived
 * from the implementation. Practice 2: an assertion may not reach the value
 * under test by the same path the code did. If the contract gains a sixth
 * level this list is stale, and the `never` default in vendorHalfSatisfied is
 * what makes that a typecheck failure rather than a silent pass. */
const ALL_LEVELS: StatusLevel[] = ['operational', 'degraded', 'outage', 'maintenance', 'unknown'];

const svc = (over: Partial<ServiceSignal> = {}): ServiceSignal => ({
  serviceId: 'jira',
  label: 'Jira',
  vendor: { level: 'operational', platform: 'statuspage' },
  ours: { passing: 1, total: 1 },
  ...over,
});

describe('the vendor half of the headline rule', () => {
  it('is satisfied by degraded and outage, and by nothing else', () => {
    // Pinned literals, one per contract member. A table, so a new vocabulary
    // word fails loudly rather than falling through to a default.
    const expected: Record<StatusLevel, boolean> = {
      operational: false,
      degraded: true,
      outage: true,
      maintenance: false,   // amendment 1 — announced work is not an incident
      unknown: false,       // amendment 1 — we could not look; that is not a vendor claim
    };
    for (const level of ALL_LEVELS) {
      expect(vendorHalfSatisfied(level), level).toBe(expected[level]);
    }
  });
});

describe('our half of the headline rule', () => {
  it('is failing when any probe of the service is failing', () => {
    expect(ourCheckFailing({ passing: 1, total: 2 })).toBe(true);
    expect(ourCheckFailing({ passing: 0, total: 2 })).toBe(true);
  });

  it('is not failing when every probe passes', () => {
    expect(ourCheckFailing({ passing: 2, total: 2 })).toBe(false);
  });

  it('is not failing when no probe ran at all', () => {
    // No evidence is not evidence of failure. The mirror of "a failed fetch
    // never renders green": an absent probe must not manufacture an incident
    // either. m365 has no probe in Milestone 2 and must not open a Sev1.
    expect(ourCheckFailing({ passing: 0, total: 0 })).toBe(false);
  });
});

describe('the rule registry', () => {
  it('declares exactly the two rules this milestone implements, at their contract severities', () => {
    // Literals from DATA_CONTRACTS.md section 7, not read back off the rules.
    expect(RULES.map((r) => [r.key, r.severity])).toEqual([
      ['vendor', 1],
      ['blackout', 2],
    ]);
  });

  it('honours a disabled rule by producing no finding at all', () => {
    const services = [svc({ vendor: { level: 'outage', platform: 'statuspage' }, ours: { passing: 0, total: 1 } })];
    expect(evaluate(services, { vendor: true }).map((f) => f.ruleKey)).toEqual(['vendor']);
    expect(evaluate(services, { vendor: false })).toEqual([]);
  });
});

describe('blackout groups by vendor.platform (amendment 5)', () => {
  const dark = (id: ServiceSignal['serviceId'], platform: ServiceSignal['vendor']['platform']): ServiceSignal =>
    svc({ serviceId: id, vendor: { level: 'unknown', platform }, ours: { passing: 1, total: 1 } });

  it('fires once for the platform, not once per service, when every service on it is unknown', () => {
    const findings = evaluate([dark('jira', 'statuspage'), dark('claude', 'statuspage'), dark('openai', 'statuspage'), dark('helpjuice', 'statuspage')]);
    expect(findings.map((f) => [f.ruleKey, f.serviceId, f.severity])).toEqual([['blackout', 'platform:statuspage', 2]]);
  });

  it('does not fire when one service on the platform is still readable', () => {
    const findings = evaluate([dark('jira', 'statuspage'), svc({ serviceId: 'claude' })]);
    expect(findings).toEqual([]);
  });

  it('does not fire for a platform with only one service', () => {
    // A single msgraph tile going unknown is an ordinary unknown, not a
    // platform blackout. Section 7: "more than one".
    expect(evaluate([dark('m365', 'msgraph')])).toEqual([]);
  });

  it('ignores services whose platform has no adapter yet, and does not fire on them alone', () => {
    // JUDGEMENT, see the comment on UNREADABLE_BY_US in rules.ts. A vendor we
    // have never been able to poll is not a platform we have LOST sight of.
    const unsupported = (id: ServiceSignal['serviceId']): ServiceSignal =>
      svc({ serviceId: id, vendor: { level: 'unknown', platform: 'statusio', errorCode: 'platform_unsupported' } });
    expect(evaluate([unsupported('proofpoint'), unsupported('m365')])).toEqual([]);
  });

  it('still fires when a real feed failure joins an unsupported one, counting only the real failures', () => {
    // Two statuspage vendors genuinely dark => blackout. The unsupported
    // statusio row alongside them changes nothing.
    const findings = evaluate([
      svc({ serviceId: 'proofpoint', vendor: { level: 'unknown', platform: 'statusio', errorCode: 'platform_unsupported' } }),
      svc({ serviceId: 'jira', vendor: { level: 'unknown', platform: 'statuspage', errorCode: 'http_503' } }),
      svc({ serviceId: 'claude', vendor: { level: 'unknown', platform: 'statuspage', errorCode: 'http_503' } }),
    ]);
    expect(findings.map((f) => f.serviceId)).toEqual(['platform:statuspage']);
  });
});
