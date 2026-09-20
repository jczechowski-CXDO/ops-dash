import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntraSignal } from '@ops-dash/shared';
import { GRAPH_BETA, GRAPH_V1, type Row } from './paged.js';
import {
  APPLICATIONS,
  AUDITS_IN_CATEGORY,
  CONFIRMED_COMPROMISED,
  DAY_MS,
  FAILED_SIGNINS,
  GLOBAL_ADMIN_ROLE,
  GUESTS,
  LEGACY_CLIENT_APPS,
  LEGACY_SIGNINS,
  MFA_REGISTRATION,
  RECENT_AUDITS,
  RISK_DETECTIONS,
  ROLE_ASSIGNMENTS,
  ROLE_MEMBERS,
  SIGNAL_LABEL,
  SIGNAL_SEVERITY,
  auditEvent,
  credentialSignal,
  distinctCount,
  instant,
  isConditionalAccess,
  newestAt,
  signal,
  splitWindows,
} from './queries.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string): { value: Row[] } =>
  JSON.parse(readFileSync(join(HERE, '__fixtures__', name), 'utf8')) as { value: Row[] };

const AUDITS = fixture('directory-audits.json').value;
const APPS = fixture('applications.json').value;

describe('the sign-in queries, and why they are shaped this way', () => {
  it('is a PAIR, and the second half carries the non-interactive clause', () => {
    // The measured fact this encodes: a Graph sign-in query with no
    // `signInEventTypes` clause silently answers about interactive sign-ins
    // only. On this tenant, over one 24-hour window, that is 153 rows across 44
    // accounts; the non-interactive half was still going after a full 1000-row
    // page. Reading only the first half of this pair is an order-of-magnitude
    // undercount that looks entirely reasonable on screen.
    const [interactive, other] = FAILED_SIGNINS(Date.parse('2026-09-18T00:00:00Z'));
    expect(interactive).not.toContain('signInEventTypes');
    expect(other).toContain("signInEventTypes/any(x: x ne 'interactiveUser')");
    // Same question otherwise: the second is the first plus the clause.
    expect(other.startsWith(interactive)).toBe(true);
  });

  it('asks Graph BETA for sign-ins, and v1.0 for everything else', () => {
    // `signInEventTypes` does not exist on the v1.0 `signIn` entity. Measured:
    //
    //     400 BadRequest — Could not find a property named 'signInEventTypes'
    //                      on type 'microsoft.graph.signIn'
    //
    // so v1.0 cannot answer the question at all. This assertion exists to stop
    // the beta URL being "tidied" to v1.0 by someone who reads it as sloppiness:
    // the tidy version compiles, passes a shape test, and returns a number that
    // is wrong by an order of magnitude in the reassuring direction.
    for (const url of [...FAILED_SIGNINS(0), ...LEGACY_SIGNINS(0)]) {
      expect(url.startsWith(`${GRAPH_BETA}/auditLogs/signIns`)).toBe(true);
    }
    for (const url of [RISK_DETECTIONS(0), CONFIRMED_COMPROMISED, MFA_REGISTRATION, ROLE_ASSIGNMENTS,
      GLOBAL_ADMIN_ROLE, ROLE_MEMBERS('DEMO-ROLE-0001'), GUESTS, APPLICATIONS, RECENT_AUDITS,
      AUDITS_IN_CATEGORY('Policy', 0)]) {
      expect(url.startsWith(GRAPH_V1)).toBe(true);
    }
  });

  it('pins the exact property v1.0 lacks, so the reason survives a tidy-up', () => {
    // The lead's ruling on the beta endpoint rests on one measured sentence, and
    // the property name belongs in an ASSERTION rather than only in a comment —
    // a comment explaining why the URL says `beta` is the kind of accurate
    // comment this project has now watched fail to prevent the thing it
    // described, three times in one night.
    //
    // Measured against v1.0, same filter, same tenant:
    //   400 BadRequest — Could not find a property named 'signInEventTypes'
    //                    on type 'microsoft.graph.signIn'
    //
    // So the choice is a beta surface or a number that is wrong by 29x and reads
    // as a calm day. A beta shape change fails LOUDLY — fetchJson errors, the
    // panel says "we could not look". The v1.0 version fails silently and
    // permanently, which is the direction this repo does not accept.
    const [, nonInteractive] = FAILED_SIGNINS(0);
    expect(nonInteractive).toContain('signInEventTypes');
    for (const url of [...FAILED_SIGNINS(0), ...LEGACY_SIGNINS(0)]) {
      expect(url).not.toContain(`${GRAPH_V1}/auditLogs/signIns`);
    }
  });

  it('honours the per-collection page-size caps that Graph actually enforces', () => {
    // Not stylistic. `identityProtection/riskDetections` answers
    // `400 BadRequest — Invalid page size specified: '999'. Must be between 1
    // and 500 inclusive.` Pinned as literals so a well-meaning "make them all
    // 999" is a red test rather than a runtime 400 on one collection.
    expect(RISK_DETECTIONS(0)).toContain('$top=500');
    expect(CONFIRMED_COMPROMISED).toContain('$top=500');
    expect(AUDITS_IN_CATEGORY('Policy', 0)).toContain('$top=500');
    expect(MFA_REGISTRATION).toContain('$top=999');
    expect(GUESTS).toContain('$top=999');
    expect(APPLICATIONS).toContain('$top=999');
    for (const url of FAILED_SIGNINS(0)) expect(url).toContain('$top=1000');
    // And one collection refuses a page size of ANY value:
    //   400 Bad Request — This resource does not support custom page sizes.
    // Three collections, three different rules. A house style would be wrong on
    // two of them.
    expect(ROLE_MEMBERS('DEMO-ROLE-0001')).not.toContain('$top');
  });

  it('filters the audit log server-side by category, never wholesale', () => {
    // 48 hours of unfiltered `directoryAudits` on this tenant passed 2,500 rows
    // in five pages and had not finished.
    expect(AUDITS_IN_CATEGORY('RoleManagement', 0)).toContain("category eq 'RoleManagement'");
  });

  it('carries no GUID literal — the shape web/src/guards.test.ts refuses', () => {
    // The Global Administrator role is found by display name because its
    // well-known template id is a GUID, and the repo's redaction guard cannot
    // tell Microsoft's constant from this tenant's identifiers.
    const guid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    expect(guid.test(readFileSync(join(HERE, 'queries.ts'), 'utf8'))).toBe(false);
    expect(GLOBAL_ADMIN_ROLE).toContain("displayName eq 'Global Administrator'");
  });

  it('escapes a quote in an interpolated filter value', () => {
    // Every value that reaches a $filter goes through the same quoting. A
    // display name with an apostrophe is the ordinary case, not the hostile one.
    expect(AUDITS_IN_CATEGORY("O'Brien", 0)).toContain("category eq 'O''Brien'");
  });

  it('names the legacy clients explicitly rather than negating the modern ones', () => {
    // A negative definition ("not Browser, not Mobile Apps") makes every value
    // Microsoft adds later legacy by default, and a new modern client reading as
    // legacy auth is an alarm that cries wolf.
    expect([...LEGACY_CLIENT_APPS]).toContain('IMAP4');
    expect([...LEGACY_CLIENT_APPS]).not.toContain('Browser');
    const url = LEGACY_SIGNINS(0)[0];
    for (const app of LEGACY_CLIENT_APPS) expect(url).toContain(`clientAppUsed eq '${app}'`);
  });
});

describe('splitting a 48-hour read into two 24-hour windows', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const at = (iso: string): Row => ({ activityDateTime: iso });

  it('puts each row in exactly one window, by hand-checked instants', () => {
    const rows = [
      at('2026-09-20T11:59:00Z'),   // current
      at('2026-09-19T12:00:01Z'),   // current, one second inside the boundary
      at('2026-09-19T11:59:00Z'),   // previous
      at('2026-09-18T12:00:01Z'),   // previous, one second inside
      at('2026-09-18T11:00:00Z'),   // older than both — neither
    ];
    const split = splitWindows(rows, 'activityDateTime', now);
    expect(split.current).toHaveLength(2);
    expect(split.previous).toHaveLength(2);
    expect(split.unparsed).toBe(0);
  });

  it('counts an unreadable timestamp as unparsed, in NEITHER window', () => {
    // Graph emits variable fractional-second precision; a parser that shrugs
    // turns live rows into absence. `unparsed` is how that absence becomes a
    // number somebody can act on instead of a silent shortfall.
    const split = splitWindows([at('2026-09-20T11:00:00Z'), at('not a date'), { activityDateTime: 42 }],
      'activityDateTime', now);
    expect(split.current).toHaveLength(1);
    expect(split.previous).toHaveLength(0);
    expect(split.unparsed).toBe(2);
  });

  it('instant() returns undefined rather than NaN or now', () => {
    expect(instant('2026-09-20T12:00:00Z')).toBe(now);
    expect(instant('not a date')).toBeUndefined();
    expect(instant(undefined)).toBeUndefined();
    expect(instant(1758369600000)).toBeUndefined();   // a number is not an ISO instant
  });

  it('the boundary is 24 hours and not 24 of something else', () => {
    expect(DAY_MS).toBe(86_400_000);
  });
});

describe('distinct accounts and newest evidence', () => {
  it('counts distinct ids, not rows', () => {
    const rows = [{ userId: 'DEMO-USER-0001' }, { userId: 'DEMO-USER-0001' }, { userId: 'DEMO-USER-0002' }, {}];
    expect(rows).toHaveLength(4);
    expect(distinctCount(rows, 'userId')).toBe(2);
  });

  it('newestAt returns undefined when nothing has a readable instant', () => {
    // The load-bearing case. `undefined` is what makes a signal get OMITTED
    // rather than stamped with the poll time, which would read as "seen now".
    expect(newestAt([], 'activityDateTime')).toBeUndefined();
    expect(newestAt([{ activityDateTime: 'nope' }], 'activityDateTime')).toBeUndefined();
    expect(newestAt(AUDITS, 'activityDateTime')).toBe('2026-09-20T12:04:00.000Z');
  });
});

describe('the signal table', () => {
  const KEYS: EntraSignal['key'][] = [
    'risky_signin', 'failed_spike', 'legacy_auth', 'mfa_gap',
    'expiring_credentials', 'role_change', 'guest_access', 'ca_change',
  ];

  it('covers exactly the contract’s eight keys, transcribed by hand', () => {
    // Transcribed from shared/src/contracts.ts rather than derived from the
    // table under test — a key list read out of SIGNAL_SEVERITY could only ever
    // prove the table equals itself.
    expect(Object.keys(SIGNAL_SEVERITY).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(SIGNAL_LABEL).sort()).toEqual([...KEYS].sort());
  });

  it('classifies the signal and not the day', () => {
    // Pinned literals, matching the fixtures: a risky sign-in is a Sev1 signal
    // whether today's count is seven or one.
    expect(SIGNAL_SEVERITY.risky_signin).toBe(1);
    expect(SIGNAL_SEVERITY.failed_spike).toBe(2);
    expect(SIGNAL_SEVERITY.guest_access).toBe('info');
    expect(SIGNAL_LABEL.expiring_credentials).toBe('Expiring secrets & certs');
  });

  it('declines to build a signal with no evidence behind it', () => {
    expect(signal('ca_change', 0, 0, undefined)).toBeUndefined();
    expect(signal('ca_change', 0, 0, '2026-09-11T00:00:00Z')).toEqual({
      key: 'ca_change', label: 'CA policy changes', count: 0, delta24h: 0,
      severity: 'info', lastSeen: '2026-09-11T00:00:00Z',
    });
  });

  it('a count of zero WITH evidence is still a signal — the other half', () => {
    // "Nothing happened today, and here is when it last did" is information.
    // "We have never seen this" is not the same statement and gets no row.
    expect(signal('role_change', 0, -3, '2026-09-11T00:00:00Z')?.count).toBe(0);
  });
});

describe('expiring credentials', () => {
  // Hand-computed against __fixtures__/applications.json, whose three credential
  // end dates are 2026-10-05, 2026-10-19 and 2027-06-01. With a 30-day horizon
  // they enter the window on 2026-09-05, 2026-09-19 and 2027-05-02.
  it('counts what is inside the horizon at a chosen instant', () => {
    const now = Date.parse('2026-09-20T00:00:00Z');
    const out = credentialSignal(APPS, now);
    expect(out.count).toBe(2);              // the Oct 5 and Oct 19 credentials
    expect(out.lastEnteredAt).toBe('2026-09-19T12:00:00.000Z');
  });

  it('derives delta24h arithmetically — the one state signal that can', () => {
    // A credential enters the window at `endDateTime - 30 days`, a property of
    // the credential itself, so yesterday's count is computable from today's
    // list. On 2026-09-20 one of the two crossed in the previous 24 hours.
    expect(credentialSignal(APPS, Date.parse('2026-09-20T00:00:00Z')).delta24h).toBe(1);
    // A day earlier, before the Oct 19 credential crossed: one in, no movement.
    const earlier = credentialSignal(APPS, Date.parse('2026-09-19T00:00:00Z'));
    expect(earlier.count).toBe(1);
    expect(earlier.delta24h).toBe(0);
  });

  it('keeps counting a credential that has already expired', () => {
    // An expired secret is not a solved problem, it is the problem having
    // happened. Far past the Oct 19 date: both still counted.
    expect(credentialSignal(APPS, Date.parse('2026-12-01T00:00:00Z')).count).toBe(2);
  });

  it('ignores a credential with no readable end date rather than counting it', () => {
    const apps: Row[] = [{ passwordCredentials: [{ endDateTime: 'soon' }, {}], keyCredentials: 'not an array' }];
    expect(credentialSignal(apps, Date.now())).toEqual({ count: 0, delta24h: 0, lastEnteredAt: undefined });
  });
});

describe('directory audit rows', () => {
  it('maps a user-initiated row exactly', () => {
    expect(auditEvent(AUDITS[0]!)).toEqual({
      at: '2026-09-20T12:04:00Z',
      actor: 'j.hart@example.com',
      action: 'Add member to role',
      target: 'Helpdesk Administrator',
      result: 'success',
    });
  });

  it('falls back to the app name, then to System', () => {
    expect(auditEvent(AUDITS[1]!)?.actor).toBe('Stellar-Connector');
    expect(auditEvent(AUDITS[2]!)?.actor).toBe('System');
  });

  it('reports anything that is not an affirmative success as a failure', () => {
    // Graph's vocabulary is success | failure | timeout | unknownFutureValue and
    // the contract has two. `timeout` is not success, and the direction that
    // must never be invented is the reassuring one.
    expect(auditEvent(AUDITS[1]!)?.result).toBe('failure');   // 'failure'
    expect(auditEvent(AUDITS[2]!)?.result).toBe('failure');   // 'timeout'
  });

  it('declines a row with no target rather than rendering an empty line', () => {
    // AUDITS[3] has `targetResources: []`. A table row reading "— — —" looks
    // like data and is not.
    expect(auditEvent(AUDITS[3]!)).toBeNull();
    expect(auditEvent({ activityDisplayName: 'x', targetResources: [{ displayName: 'y' }] })).toBeNull();
  });

  it('picks Conditional Access out of the Policy category by activity name', () => {
    // `category eq 'Policy'` also carries claims-mapping and token-lifetime
    // edits, so the category alone would over-count.
    expect(AUDITS.filter(isConditionalAccess).map((r) => r['id'])).toEqual(['DEMO-AUDIT-0002']);
  });
});
