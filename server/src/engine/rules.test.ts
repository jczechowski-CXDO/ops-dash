import { describe, it, expect } from 'vitest';
import type { StatusLevel } from '@ops-dash/shared';
import {
  IDENTITY_MAX_AGE_MS,
  RULES,
  SECRETS_HORIZON_DAYS,
  SPRAY_THRESHOLD,
  SPRAY_WINDOW_MS,
  WrongWindowError,
  type IdentitySignal,
  type RuleKey,
  evaluatedRuleKeys,
  identityIsFresh,
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
  it('declares exactly section 7’s seven rules, at their contract severities', () => {
    // Literals transcribed from DATA_CONTRACTS.md section 7, not read back off
    // the rules — a list derived from RULES could only prove RULES equals
    // itself. `stale` is section 7's eighth row and belongs to the Endpoints
    // adapter, so it is deliberately absent here and this set will change when
    // that lands.
    expect(RULES.map((r) => [r.key, r.severity])).toEqual([
      ['vendor', 1],
      ['ourside', 2],
      ['blackout', 2],
      ['spray', 2],
      ['risky', 1],
      ['secrets', 3],
      ['legacy', 2],
    ]);
  });

  it('pins every constant a rule refuses a mismatched input against', () => {
    // Transcribed from section 7's table: "> 500 failures in 15 min" and
    // "within 14 days". These are asserted as literals because the same numbers
    // are what the rules refuse a mismatched input against — if the constant
    // drifts, the refusal drifts with it and stops refusing the thing it was
    // written for.
    expect(SPRAY_THRESHOLD).toBe(500);
    expect(SPRAY_WINDOW_MS).toBe(900_000);
    expect(SECRETS_HORIZON_DAYS).toBe(14);
    // Three poll intervals of the 15-minute Entra source.
    expect(IDENTITY_MAX_AGE_MS).toBe(2_700_000);
  });

  it('declares a row for EVERY RuleKey, so no lookup can miss', () => {
    // `m4-store`'s catch. `RuleKey` had seven members while `RULES` had three
    // rows, and both lookups used a non-null assertion — so the first identity
    // rule wired up would have thrown inside the correlation tick, once a
    // minute, on the fallback path a fresh database always takes.
    //
    // The Record makes it a typecheck failure instead, and this asserts the
    // runtime consequence: the keys, transcribed as literals, and a count
    // anchored positively so a registry that silently shrank could not pass.
    const keys: RuleKey[] = ['vendor', 'ourside', 'blackout', 'spray', 'risky', 'secrets', 'legacy'];
    expect(RULES).toHaveLength(keys.length);
    expect(RULES.map((r) => r.key)).toEqual(keys);
    for (const r of RULES) expect(typeof r.enabled).toBe('boolean');
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

  it('does not fire at a cold start, when nothing has been polled even once', () => {
    // REGRESSION, and it was real: INC-119d4dc7 opened 2026-09-20T05:16:45Z, one
    // second before the process finished booting, and resolved sixty seconds
    // later on the first poll. Every restart minted one, and each counted
    // against incidents90d for ninety days.
    //
    // No unit test could have caught it, because every other test in this file
    // constructs signals that have already been polled. The whole estate at t=0
    // is a shape the suite had no way to express, which is why it took running
    // the process to find — and is the argument for the soak, not against it.
    const boot = (id: ServiceSignal['serviceId']): ServiceSignal =>
      svc({ serviceId: id, vendor: { level: 'unknown', platform: 'statuspage', errorCode: 'never_polled' } });
    expect(evaluate([boot('jira'), boot('helpjuice'), boot('claude'), boot('openai')])).toEqual([]);
  });

  it('fires the moment a polled feed goes dark, even alongside one never polled', () => {
    // The SURVIVOR, and it carries as much of the meaning as the kill above: the
    // fix must not buy its silence by making the rule harder to trigger. A feed
    // that answered and then broke carries its transport's code, stays in the
    // population, and still fires. A fix that silenced this too would have been
    // firing for the wrong reason and nothing here could have told the difference.
    const findings = evaluate([
      svc({ serviceId: 'jira', vendor: { level: 'unknown', platform: 'statuspage', errorCode: 'http_503' } }),
      svc({ serviceId: 'claude', vendor: { level: 'unknown', platform: 'statuspage', errorCode: 'http_503' } }),
      svc({ serviceId: 'openai', vendor: { level: 'unknown', platform: 'statuspage', errorCode: 'never_polled' } }),
    ]);
    expect(findings.map((f) => f.serviceId)).toEqual(['platform:statuspage']);
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

/* ------------------------------------------------- section 7's identity rules */

const AT = '2026-09-20T12:00:00.000Z';
const ago = (ms: number) => new Date(Date.parse(AT) - ms).toISOString();

/** A signal with nothing wrong in it. Each test moves ONE field, so a failure
 *  names the field rather than the fixture. */
const quiet = (over: Partial<IdentitySignal> = {}): IdentitySignal => ({
  observedAt: ago(60_000),
  failedSignIns: { count: 68, windowMs: SPRAY_WINDOW_MS },       // the measured live busiest bucket
  credentialsExpiring: { count: 0, horizonDays: SECRETS_HORIZON_DAYS },
  successfulLegacySignIns: 0,
  confirmedCompromised: 0,
  ...over,
});

const fired = (identity: IdentitySignal, at = AT) =>
  evaluate([], {}, { identity, at }).map((f) => f.ruleKey).sort();

describe('the identity rules fire on the quantity section 7 NAMES', () => {
  it('is silent on the estate as it actually is today', () => {
    // Every number here was measured on the live tenant. If the rules are right,
    // a normal day is quiet — an alarm that is always on is the failure this
    // project cares most about, and three of these four would have been.
    expect(fired(quiet())).toEqual([]);
  });

  it('spray fires above 500 in FIFTEEN MINUTES, not on a daily total', () => {
    expect(fired(quiet({ failedSignIns: { count: 501, windowMs: SPRAY_WINDOW_MS } }))).toEqual(['spray']);
    expect(fired(quiet({ failedSignIns: { count: 500, windowMs: SPRAY_WINDOW_MS } }))).toEqual([]);  // "> 500"
  });

  it('spray REFUSES a 24-hour count by name instead of firing on it', () => {
    // The world where the naive and correct readings differ, which is the only
    // world that can tell them apart. 4535 is the real 24-hour figure: a rule
    // reading it would hold a Sev2 open every day forever, and a rule reading
    // the same estate over fifteen minutes sees 68 and stays quiet.
    const wrong = quiet({ failedSignIns: { count: 4535, windowMs: 24 * 60 * 60 * 1000 } });
    expect(() => evaluate([], {}, { identity: wrong, at: AT })).toThrow(WrongWindowError);
    expect(() => evaluate([], {}, { identity: wrong, at: AT })).toThrow(/24-hour total/);
  });

  it('risky fires on any confirmed compromise', () => {
    expect(fired(quiet({ confirmedCompromised: 1 }))).toEqual(['risky']);
    expect(evaluate([], {}, { identity: quiet({ confirmedCompromised: 1 }), at: AT })[0]!.severity).toBe(1);
  });

  it('secrets counts only FUTURE expiry, inside 14 days, and refuses another horizon', () => {
    expect(fired(quiet({ credentialsExpiring: { count: 1, horizonDays: SECRETS_HORIZON_DAYS } }))).toEqual(['secrets']);
    // 20 at a 30-day horizon is what the dashboard signal reports, and 19 of
    // those 20 have ALREADY expired on the live tenant. Reading it here would
    // pin a Sev3 on permanently.
    const wrong = quiet({ credentialsExpiring: { count: 20, horizonDays: 30 } });
    expect(() => evaluate([], {}, { identity: wrong, at: AT })).toThrow(WrongWindowError);
    expect(() => evaluate([], {}, { identity: wrong, at: AT })).toThrow(/permanently/);
  });

  it('secrets is the first Sev3 anything in this system emits', () => {
    expect(evaluate([], {}, { identity: quiet({ credentialsExpiring: { count: 2, horizonDays: 14 } }), at: AT })[0]!.severity).toBe(3);
  });

  it('legacy fires on a SUCCESS and never on a blocked attempt', () => {
    // The live tenant: 11 attempts in 24 hours, 0 of them successful. A rule on
    // attempts is a permanent Sev2; a rule on successes is correctly quiet. The
    // shape refuses the confusion — there is no attempts field to read.
    expect(fired(quiet({ successfulLegacySignIns: 1 }))).toEqual(['legacy']);
    expect(fired(quiet({ successfulLegacySignIns: 0 }))).toEqual([]);
    expect(Object.keys(quiet())).not.toContain('legacyAuth');
  });

  it('all four can fire at once, each once, on the tile an operator can reach', () => {
    const loud = quiet({
      failedSignIns: { count: 900, windowMs: SPRAY_WINDOW_MS },
      credentialsExpiring: { count: 3, horizonDays: SECRETS_HORIZON_DAYS },
      successfulLegacySignIns: 2,
      confirmedCompromised: 1,
    });
    const findings = evaluate([], {}, { identity: loud, at: AT });
    expect(findings.map((f) => f.ruleKey).sort()).toEqual(['legacy', 'risky', 'secrets', 'spray']);
    for (const f of findings) expect(f.serviceId).toBe('m365');
  });

  it('honours a disabled identity rule, and a disabled rule cannot throw', () => {
    // A rule that is off must not validate its input either: switching a rule
    // off to stop an alarm should not leave the engine throwing about a window
    // nobody is reading.
    const wrong = quiet({ failedSignIns: { count: 4535, windowMs: 24 * 60 * 60 * 1000 } });
    expect(() => evaluate([], { spray: false }, { identity: wrong, at: AT })).not.toThrow();
    expect(evaluate([], { risky: false }, { identity: quiet({ confirmedCompromised: 5 }), at: AT })).toEqual([]);
  });
});

describe('a stale identity signal is not evidence', () => {
  it('is fresh inside 45 minutes and stale outside it', () => {
    expect(identityIsFresh(quiet({ observedAt: ago(IDENTITY_MAX_AGE_MS - 1000) }), AT)).toBe(true);
    expect(identityIsFresh(quiet({ observedAt: ago(IDENTITY_MAX_AGE_MS + 1000) }), AT)).toBe(false);
    expect(identityIsFresh(undefined, AT)).toBe(false);
    expect(identityIsFresh(quiet({ observedAt: 'not a date' }), AT)).toBe(false);
    // A signal from the future is not fresh, it is a clock we cannot trust.
    expect(identityIsFresh(quiet({ observedAt: new Date(Date.parse(AT) + 10 * 60_000).toISOString() }), AT)).toBe(false);
  });

  it('a stale signal fires NOTHING, however loud its numbers are', () => {
    const loud = quiet({
      observedAt: ago(IDENTITY_MAX_AGE_MS + 1000),
      confirmedCompromised: 9,
      failedSignIns: { count: 5000, windowMs: SPRAY_WINDOW_MS },
    });
    expect(fired(loud)).toEqual([]);
  });

  it('and says so, so correlate can tell "found nothing" from "could not look"', () => {
    // The two are identical in `findings` and must not be identical downstream —
    // one clears an incident and the other must not.
    expect([...evaluatedRuleKeys(quiet(), AT)].sort()).toEqual(
      ['blackout', 'legacy', 'ourside', 'risky', 'secrets', 'spray', 'vendor'],
    );
    expect([...evaluatedRuleKeys(undefined, AT)].sort()).toEqual(['blackout', 'ourside', 'vendor']);
    expect([...evaluatedRuleKeys(quiet({ observedAt: ago(IDENTITY_MAX_AGE_MS + 1000) }), AT)].sort())
      .toEqual(['blackout', 'ourside', 'vendor']);
  });
});
