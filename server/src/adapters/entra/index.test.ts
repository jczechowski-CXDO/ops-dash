import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntraSnapshot } from '@ops-dash/shared';
import type { FetchLike } from '../../http/fetchJson.js';
import type { TokenSource } from '../../http/graphToken.js';
import { readAll } from './paged.js';
import { FAILED_SIGNINS } from './queries.js';
import { pollEntra } from './index.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(HERE, '__fixtures__', name), 'utf8'));

const PAGE1 = fixture('signins-failed-page1.json');
const PAGE2 = fixture('signins-failed-page2.json');
const APPS = fixture('applications.json');
const AUDITS = fixture('directory-audits.json');

const NOW = new Date('2026-09-20T12:00:00Z');

/** A prior snapshot, as the composition root would hand one back. Only
 *  `stats.mfaUnregistered` is read; the rest is filled so the value is a real
 *  `EntraSnapshot` and not a shape that happens to typecheck. */
const previousSnapshot = (mfaUnregistered: number): EntraSnapshot => ({
  stats: {
    riskySignIns24h: 0, riskyConfirmedCompromised: 0, failedSignIns24h: 0, failedSignInAccounts: 0,
    mfaCoverage: 0.5, mfaUnregistered, privilegedAccounts: 0, globalAdmins: 0,
  },
  signals: [],
  audit: [],
});

const goodToken = (): TokenSource =>
  ({ get: async () => ({ token: 'stub-token' }), reset: () => {} }) as unknown as TokenSource;
const failingToken = (): TokenSource =>
  ({ get: async () => ({ error: { code: 'graph_config', message: 'no credential' } }), reset: () => {} }) as unknown as TokenSource;

/** Collections other than the two-page sign-in fixture, written inline so the
 *  expected figures below can be checked by counting them by eye. */
const RISK = { value: [
  { id: 'DEMO-RISK-0001', detectedDateTime: '2026-09-20T11:00:00Z' },   // current
  { id: 'DEMO-RISK-0002', detectedDateTime: '2026-09-19T01:00:00Z' },   // previous
] };
const COMPROMISED = { value: [{ id: 'DEMO-USER-0007' }, { id: 'DEMO-USER-0008' }] };
const REGISTRATION = { value: [
  { id: 'DEMO-USER-0001', userType: 'member', isMfaRegistered: true, lastUpdatedDateTime: '2026-09-20T06:00:00Z' },
  { id: 'DEMO-USER-0002', userType: 'member', isMfaRegistered: true, lastUpdatedDateTime: '2026-09-19T06:00:00Z' },
  { id: 'DEMO-USER-0003', userType: 'member', isMfaRegistered: true, lastUpdatedDateTime: '2026-09-18T06:00:00Z' },
  { id: 'DEMO-USER-0004', userType: 'member', isMfaRegistered: true, lastUpdatedDateTime: '2026-09-17T06:00:00Z' },
  { id: 'DEMO-USER-0005', userType: 'member', isMfaRegistered: false, lastUpdatedDateTime: '2026-09-16T06:00:00Z' },
  // Guests register their methods in their own home tenant. Four of them here,
  // none registered — enough to drag a naive coverage figure from 0.8 to 0.44.
  { id: 'DEMO-GUEST-0001', userType: 'guest', isMfaRegistered: false, lastUpdatedDateTime: '2026-09-20T07:00:00Z' },
  { id: 'DEMO-GUEST-0002', userType: 'guest', isMfaRegistered: false, lastUpdatedDateTime: '2026-09-20T07:00:00Z' },
  { id: 'DEMO-GUEST-0003', userType: 'guest', isMfaRegistered: false, lastUpdatedDateTime: '2026-09-20T07:00:00Z' },
  { id: 'DEMO-GUEST-0004', userType: 'guest', isMfaRegistered: false, lastUpdatedDateTime: '2026-09-20T07:00:00Z' },
] };
const ASSIGNMENTS = { value: [
  { id: 'DEMO-ASSIGN-0001', principalId: 'DEMO-USER-0001', principal: { '@odata.type': '#microsoft.graph.user' } },
  { id: 'DEMO-ASSIGN-0002', principalId: 'DEMO-USER-0001', principal: { '@odata.type': '#microsoft.graph.user' } },
  { id: 'DEMO-ASSIGN-0003', principalId: 'DEMO-USER-0002', principal: { '@odata.type': '#microsoft.graph.user' } },
  { id: 'DEMO-ASSIGN-0004', principalId: 'DEMO-SPN-0001', principal: { '@odata.type': '#microsoft.graph.servicePrincipal' } },
] };
const GA_ROLE = { value: [{ id: 'DEMO-ROLE-0001', displayName: 'Global Administrator' }] };
const GA_MEMBERS = { value: [{ id: 'DEMO-USER-0001' }, { id: 'DEMO-USER-0002' }, { id: 'DEMO-USER-0003' }] };
const GUESTS = { value: [
  { id: 'DEMO-GUEST-0001', createdDateTime: '2026-09-20T08:00:00Z' },   // inside 24h
  { id: 'DEMO-GUEST-0002', createdDateTime: '2026-06-01T08:00:00Z' },
  { id: 'DEMO-GUEST-0003', createdDateTime: '2026-05-01T08:00:00Z' },
  { id: 'DEMO-GUEST-0004', createdDateTime: '2026-04-01T08:00:00Z' },
] };
const ROLE_AUDITS = { value: [
  { id: 'DEMO-AUDIT-0001', activityDateTime: '2026-09-20T12:04:00Z' },  // current
  { id: 'DEMO-AUDIT-0009', activityDateTime: '2026-09-19T00:00:00Z' },  // previous
] };
const POLICY_AUDITS = { value: [
  { id: 'DEMO-AUDIT-0002', activityDisplayName: 'Update conditional access policy', activityDateTime: '2026-09-20T10:00:00Z' },
  { id: 'DEMO-AUDIT-0010', activityDisplayName: 'Update token lifetime policy', activityDateTime: '2026-09-20T09:00:00Z' },
] };

type Route = [match: (url: string) => boolean, body: unknown];

/** Matched by the distinguishing part of each query rather than by the whole
 *  URL, so a change to `$select` does not silently route a request to 404 and
 *  turn a real assertion into a test of the error path. */
function routes(over: Route[] = []): Route[] {
  const has = (...parts: string[]) => (url: string) => parts.every((p) => url.includes(p));
  const signIn = (what: string, kind: 'interactive' | 'other') => (url: string) =>
    url.includes('/auditLogs/signIns') && url.includes(what) &&
    url.includes('signInEventTypes') === (kind === 'other');
  return [
    ...over,
    [signIn('status/errorCode', 'interactive'), PAGE1],
    [(url) => url.includes('$skiptoken=DEMO-SKIP-0001'), PAGE2],
    [signIn('status/errorCode', 'other'), { value: [] }],
    [signIn('clientAppUsed', 'interactive'), { value: [] }],
    [signIn('clientAppUsed', 'other'), { value: [] }],
    [has('riskDetections'), RISK],
    [has('riskyUsers'), COMPROMISED],
    [has('userRegistrationDetails'), REGISTRATION],
    [has('roleAssignments'), ASSIGNMENTS],
    [has('/directoryRoles?'), GA_ROLE],
    [has('/directoryRoles/DEMO-ROLE-0001/members'), GA_MEMBERS],
    [has("userType eq 'Guest'"), GUESTS],
    [has('/applications'), APPS],
    [has('directoryAudits', "category eq 'RoleManagement'"), ROLE_AUDITS],
    [has('directoryAudits', "category eq 'Policy'"), POLICY_AUDITS],
    [has('directoryAudits', '$orderby'), AUDITS],
  ];
}

function serve(table: Route[]): { impl: FetchLike; misses: string[] } {
  const misses: string[] = [];
  const impl: FetchLike = async (url) => {
    for (const [match, body] of table) {
      if (match(url)) {
        if (body === null) return new Response('upstream said no', { status: 503 });
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    misses.push(url);
    return new Response('{}', { status: 404 });
  };
  return { impl, misses };
}

const poll = (table: Route[], over: Partial<Parameters<typeof pollEntra>[0]> = {}) => {
  const { impl, misses } = serve(table);
  return pollEntra({ tokens: goodToken(), fetchImpl: impl, now: () => NOW, ...over }).then((r) => ({ r, misses }));
};

describe('the Entra snapshot, end to end over a stubbed Graph', () => {
  it('every stat is the hand-counted figure, and no request went unrouted', async () => {
    const { r, misses } = await poll(routes());
    expect(misses).toEqual([]);
    expect(r.data).toBeDefined();
    // Counted by eye off the literals above and the two committed sign-in
    // pages, not computed with anything the adapter uses:
    //   failed sign-ins in the last 24h .. 14:05, 13:55, 22:10(19th), 09:00 = 4
    //   distinct accounts among them ..... 0001, 0002, 0001, 0003           = 3
    //   risk detections since 12:00 on the 19th ......................      = 1
    //   confirmed compromised ........................................      = 2
    //   MFA registered 4 of 5 ........................................      = 0.8
    //   privileged PEOPLE (the service principal does not count) .....      = 2
    //   Global Administrator members .................................      = 3
    expect(r.data?.stats).toEqual({
      riskySignIns24h: 1,
      riskyConfirmedCompromised: 2,
      failedSignIns24h: 4,
      failedSignInAccounts: 3,
      mfaCoverage: 0.8,
      mfaUnregistered: 1,
      privilegedAccounts: 2,
      globalAdmins: 3,
    });
  });

  it('reads BOTH pages of the failed sign-ins — page one alone would say 3', async () => {
    // The whole reason `paged.ts` exists, asserted at the level an operator
    // would see it. Page one holds three rows and three of the four in-window
    // failures; page two holds the fourth. An adapter that stopped at the first
    // page would report `failedSignIns24h: 3` and look entirely plausible.
    const { r } = await poll(routes());
    expect(r.data?.stats.failedSignIns24h).toBe(4);
    const onePage = await poll(routes([[(url) => url.includes('$skiptoken=DEMO-SKIP-0001'), { value: [] }]]));
    expect(onePage.r.data?.stats.failedSignIns24h).toBe(3);
  });

  it('emits only the signals it has evidence for, in contract order', async () => {
    const { r } = await poll(routes());
    // `legacy_auth` is absent because no legacy sign-in was ever seen — not
    // present at zero with the poll time as its `lastSeen`. `mfa_gap` is absent
    // because its delta is unknowable without yesterday's number.
    expect(r.data?.signals.map((s) => s.key)).toEqual([
      'risky_signin', 'failed_spike', 'expiring_credentials', 'role_change', 'guest_access', 'ca_change',
    ]);
  });

  it('every delta is the hand-computed difference between the two windows', async () => {
    const { r } = await poll(routes());
    const by = Object.fromEntries((r.data?.signals ?? []).map((s) => [s.key, s]));
    expect(by['risky_signin']).toMatchObject({ count: 1, delta24h: 0, severity: 1 });     // 1 now, 1 before
    expect(by['failed_spike']).toMatchObject({ count: 4, delta24h: 3, severity: 2 });     // 4 now, 1 before
    expect(by['role_change']).toMatchObject({ count: 1, delta24h: 0, severity: 2 });      // 1 now, 1 before
    expect(by['ca_change']).toMatchObject({ count: 1, delta24h: 1, severity: 'info' });   // only the CA row counts
    expect(by['guest_access']).toMatchObject({ count: 4, delta24h: 1, severity: 'info' });
    // 0, not 1, and the first draft of this line said 1. The Oct 19 credential
    // crosses into the 30-day window at exactly 12:00 on the 19th, which is
    // exactly 24 hours before NOW — so at this instant it was already inside
    // the window yesterday. The boundary is inclusive, the same way
    // `splitWindows` treats its own. `queries.test.ts` pins the moving case at
    // an instant where the two windows genuinely differ.
    expect(by['expiring_credentials']).toMatchObject({ count: 2, delta24h: 0, severity: 3 });
  });

  it('lastSeen is the newest real evidence, pinned instant by instant', async () => {
    // Pinned as literals read off the fixtures above, not asserted as "not the
    // poll time". The negative form was the first draft and a mutation walked
    // through it: stamping an absent `lastSeen` with `new Date()` produces a
    // value that is not NOW either, because this poll is driven by an injected
    // clock. A negative assertion defines correctness as the absence of one
    // wrong value and passes for every other wrong value there is.
    const { r } = await poll(routes());
    expect(Object.fromEntries((r.data?.signals ?? []).map((s) => [s.key, s.lastSeen]))).toEqual({
      risky_signin: '2026-09-20T11:00:00.000Z',        // newest risk detection
      failed_spike: '2026-09-20T14:05:00.000Z',        // newest failed sign-in, page one
      expiring_credentials: '2026-09-19T12:00:00.000Z',// when the Oct 19 credential crossed in
      role_change: '2026-09-20T12:04:00.000Z',         // newest RoleManagement audit
      guest_access: '2026-09-20T08:00:00.000Z',        // newest guest createdDateTime
      ca_change: '2026-09-20T10:00:00.000Z',           // the Conditional Access edit
    });
  });

  it('takes at most eight audit rows and drops the one with no target', async () => {
    const { r } = await poll(routes());
    expect(r.data?.audit).toHaveLength(3);          // the fourth fixture row has targetResources: []
    expect(r.data?.audit[0]).toEqual({
      at: '2026-09-20T12:04:00Z', actor: 'j.hart@example.com',
      action: 'Add member to role', target: 'Helpdesk Administrator', result: 'success',
    });
  });

  it('reads ONE page of the audit log, however many pages it offers', async () => {
    // Measured: `$top=50` on `directoryAudits` still comes back with an
    // `@odata.nextLink`. `$top` sizes a page, it does not end a collection, so
    // the ordinary paging read would walk the entire audit log — 2,500 rows in
    // five pages on this tenant and still going — to fill a table of eight.
    // And the stop must not be reported as degrading the snapshot: it is the
    // intent here, not a budget being hit.
    const withNext = {
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/auditLogs/directoryAudits?$skiptoken=DEMO-SKIP-0005',
      value: (AUDITS as { value: unknown[] }).value,
    };
    const { r, misses } = await poll(routes([
      [(url) => url.includes('directoryAudits') && url.includes('$orderby'), withNext],
      [(url) => url.includes('$skiptoken=DEMO-SKIP-0005'), null],   // a 503 if it is ever asked for
    ]));
    expect(misses).toEqual([]);
    expect(r.data?.audit).toHaveLength(3);
    // The second page 503s, so reaching it would have cost the whole snapshot.
    expect(r.data).toBeDefined();
    expect(r.error?.message ?? '').not.toContain('page budget');
  });

  it('omits mfa_gap on a COLD START, because there is no yesterday to subtract', async () => {
    // The third time this shape has caught this repo in two days: a phantom Sev2
    // at boot from `never_polled`, the `ourside` rule that would have opened one
    // on every restart, and this. With no prior snapshot the delta is unknowable,
    // and the two ways to produce a number anyway — a 0, or a guess — are a lie
    // and a worse lie. There is no row.
    const { r } = await poll(routes());              // no `previous` passed
    expect(r.data?.signals.map((s) => s.key)).not.toContain('mfa_gap');
    // And the count is NOT lost, which is what makes omission honest here
    // rather than merely safe.
    expect(r.data?.stats.mfaUnregistered).toBe(1);
  });

  it('emits mfa_gap the moment a prior snapshot exists — the other half', async () => {
    // Without this, "omit mfa_gap" could be implemented as "never emit mfa_gap"
    // and the cold-start test above would still pass.
    const { r } = await poll(routes(), { previous: previousSnapshot(4) });
    const gap = r.data?.signals.find((s) => s.key === 'mfa_gap');
    expect(gap).toMatchObject({ count: 1, delta24h: -3, severity: 3, label: 'MFA registration gaps' });
  });

  it('every OTHER delta is cold-start safe, and that is asserted rather than assumed', async () => {
    // "Assume every new component has a cold-start case until you have written
    // the test that proves it does not." The other seven deltas come out of a
    // single poll — five are event counts split from one 48-hour read, guests
    // come off `createdDateTime`, credential expiry is arithmetic — so they are
    // present and correct with no prior snapshot at all. These are the same
    // figures the fully-warmed poll produces.
    const cold = await poll(routes());
    const warm = await poll(routes(), { previous: previousSnapshot(4) });
    const deltas = (r: Awaited<ReturnType<typeof poll>>['r']) =>
      Object.fromEntries((r.data?.signals ?? []).filter((s) => s.key !== 'mfa_gap').map((s) => [s.key, s.delta24h]));
    expect(deltas(cold.r)).toEqual({
      risky_signin: 0, failed_spike: 3, expiring_credentials: 0,
      role_change: 0, guest_access: 1, ca_change: 1,
    });
    expect(deltas(cold.r)).toEqual(deltas(warm.r));
  });

  it('the failed-sign-in count is reachable WITHOUT the expensive reads', async () => {
    // DATA_CONTRACTS §7's `spray` rule wants failed sign-ins over a 15-minute
    // window; nothing will ever justify polling 1,473 app registrations that
    // often. The split is not built, but the parts are not fused either — this
    // answers the question with no part of `pollEntra` involved, and fails if a
    // later refactor buries the query inside it.
    const { impl } = serve(routes());
    const [interactive, other] = FAILED_SIGNINS(NOW.getTime() - 15 * 60_000);
    const a = await readAll(interactive, 'stub-token', impl);
    const b = await readAll(other, 'stub-token', impl);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.rows.length + b.rows.length).toBe(6);   // both pages of the fixture
  });
});

describe('a failed read never renders as green', () => {
  it('returns NO data at all when one constituent read fails', async () => {
    // The central ruling. `stats` is eight required numbers and the frozen
    // contract has nowhere to write "we could not look", so a partial read
    // would have to put a 0 where a measurement is missing — and a 0 on this
    // screen reads as good news.
    const { r } = await poll(routes([[(url) => url.includes('riskyUsers'), null]]));
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe('entra_http_503');
    expect(r.error?.message).toContain('confirmed-compromised users');
  });

  it('names which question went unanswered, for each of several', async () => {
    for (const [fragment, named] of [
      ['userRegistrationDetails', 'MFA registration report'],
      ['/applications', 'app registrations'],
      ['roleAssignments', 'directory role assignments'],
    ] as const) {
      const { r } = await poll(routes([[(url) => url.includes(fragment), null]]));
      expect(r.data).toBeUndefined();
      expect(r.error?.message).toContain(named);
    }
  });

  it('an auth failure is a failure to LOOK, and carries no snapshot', async () => {
    const { impl } = serve(routes());
    const r = await pollEntra({ tokens: failingToken(), fetchImpl: impl, now: () => NOW });
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe('graph_config');
    expect(r.error?.message).toContain('nothing about Entra was read');
  });

  it('computes MFA coverage over MEMBERS, not over the whole directory', async () => {
    // Measured on the live tenant: members 358/470 = 0.762, guests 2/511. Rolled
    // together the headline is 0.367 — a staff-MFA figure nobody could ever
    // close, permanently red, and wrong. The fixture reproduces the same shape
    // in miniature: 4 of 5 members registered, 0 of 4 guests.
    const { r } = await poll(routes());
    expect(r.data?.stats.mfaCoverage).toBe(0.8);     // NOT 4/9
    expect(r.data?.stats.mfaUnregistered).toBe(1);   // NOT 5
    // And the signal's evidence comes from the member rows, not the guest rows
    // whose lastUpdatedDateTime is newer.
    const { r: withPrev } = await poll(routes(), { previous: previousSnapshot(4) });
    expect(withPrev.data?.signals.find((s) => s.key === 'mfa_gap')?.lastSeen).toBe('2026-09-20T06:00:00.000Z');
  });

  it('refuses a registration row with no userType rather than dropping it', async () => {
    // Dropping it shrinks the divisor and inflates coverage — the reassuring
    // direction.
    const { r } = await poll(routes([[(url) => url.includes('userRegistrationDetails'),
      { value: [{ id: 'DEMO-USER-0001', isMfaRegistered: true }] }]]));
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe('entra_shape');
  });

  it('refuses to compute coverage from an empty registration report', async () => {
    // 0/0 is NaN and 0 registered of 0 users is not 100% coverage. Either would
    // reach the screen as a number.
    // Including a report that holds guests and nothing else.
    for (const body of [{ value: [] }, { value: [{ id: 'DEMO-GUEST-0001', userType: 'guest', isMfaRegistered: false }] }]) {
      const { r } = await poll(routes([[(url) => url.includes('userRegistrationDetails'), body]]));
      expect(r.data).toBeUndefined();
      expect(r.error?.code).toBe('entra_empty');
    }
  });

  it('refuses a role assignment whose principal came back untyped', async () => {
    // Dropping it would shrink `privilegedAccounts`, and smaller is the
    // reassuring direction.
    const untyped = { value: [{ id: 'DEMO-ASSIGN-0001', principalId: 'DEMO-USER-0001', principal: {} }] };
    const { r } = await poll(routes([[(url) => url.includes('roleAssignments'), untyped]]));
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe('entra_shape');
  });

  it('refuses when the Global Administrator role is not found exactly once', async () => {
    const { r } = await poll(routes([[(url) => url.includes('/directoryRoles?'), { value: [] }]]));
    expect(r.data).toBeUndefined();
    expect(r.error?.message).toContain('Global Administrator role');
  });
});

describe('a lower bound is reported as a lower bound', () => {
  it('marks the snapshot degraded when a timestamp could not be read', async () => {
    // The committed page-two fixture carries one row whose `createdDateTime` is
    // not a date, on purpose. The count is therefore too small, and too small is
    // the direction that looks calm.
    const { r } = await poll(routes());
    expect(r.degraded).toBe(true);
    expect(r.error?.code).toBe('entra_partial');
    expect(r.error?.message).toContain('timestamp we could not read');
    expect(r.data).toBeDefined();   // and the figures still reach the screen
  });

  it('is NOT degraded when every row parses — the other half', async () => {
    // Without this, `degraded: true` could be hard-wired and the test above
    // would still pass.
    const clean = { value: [{ id: 'DEMO-SIGNIN-0004', createdDateTime: '2026-09-20T09:00:00Z', userId: 'DEMO-USER-0003' }] };
    const { r } = await poll(routes([[(url) => url.includes('$skiptoken=DEMO-SKIP-0001'), clean]]));
    expect(r.degraded).toBe(false);
    expect(r.error).toBeUndefined();
  });

  it('marks the snapshot degraded when a read hit the page budget', async () => {
    const { r } = await poll(routes(), { maxPages: 1 });
    expect(r.degraded).toBe(true);
    expect(r.error?.message).toContain('page budget');
    expect(r.error?.message).toContain('failed sign-ins (interactive)');
  });
});
