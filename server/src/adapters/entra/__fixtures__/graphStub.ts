import type { EntraSnapshot } from '@ops-dash/shared';
import type { FetchLike } from '../../../http/fetchJson.js';
import type { TokenSource } from '../../../http/graphToken.js';

/**
 * A stubbed Microsoft Graph, shared by the adapter's own tests and by the
 * composition root's.
 *
 * **Why this is a module and not an export from `index.test.ts`.** Importing one
 * test file from another makes vitest register the imported file's `describe`
 * blocks inside the importing suite too — the same tests counted twice, under a
 * name that says otherwise. A plain module has no `describe` to leak.
 *
 * **Why it is shared at all.** `pollEntra` and the source that registers it are
 * on opposite sides of one seam: the adapter is a function of (Graph responses,
 * previous snapshot), and the composition root decides what "previous" is. Two
 * stubs would let the two sides drift about what Graph answers, which is the
 * shape of every expensive Milestone 3 defect. One stub means a round-trip test
 * — poll, store, poll again — is reading the same world at both ends.
 *
 * Everything here is redacted: `@example.com`, `DEMO-*`, and no GUIDs. The
 * repository guards enforce that over this file like any other.
 */

/**
 * The committed payloads this stub serves, by the one name each of them has.
 *
 * **This module deliberately does not open any file**, and that is a guard's
 * finding rather than a preference. `assets.test.ts` walks every `.ts` under
 * `server/src` that is not a `.test.ts` and requires any non-TypeScript file it
 * opens to be in the build manifest — because such a file IS production source
 * by that definition, is compiled into `server/dist`, and would throw on import
 * there if its data had not been copied alongside. A first draft of this module
 * loaded these four itself and the guard caught it on the first run. Adding test
 * fixtures to the production asset manifest to silence it would have been the
 * wrong fix: it would ship them.
 *
 * Note the guard reads PROSE as well as code — it greps the file's text, so a
 * comment naming the loader function trips it exactly as the call would. That is
 * the same ruling `docs/RESUME.md` records for the dark-palette guard: when a
 * guard fires on a comment, reword the comment, never weaken the guard. Hence
 * the careful wording here.
 *
 * So the caller loads, and passes them in. The filenames live here, once, so the
 * two sides cannot disagree about WHICH payloads make up the world — the part
 * that could actually drift. The three lines of loading at each call site
 * cannot.
 */
export const FIXTURE_FILES = {
  failedSignInsPage1: 'signins-failed-page1.json',
  failedSignInsPage2: 'signins-failed-page2.json',
  applications: 'applications.json',
  directoryAudits: 'directory-audits.json',
} as const;

export type GraphFixtures = { [K in keyof typeof FIXTURE_FILES]: unknown };

/** Assemble them from a reader the caller supplies, which is where the three
 *  lines of disk access live. See `index.test.ts` for the call site to copy. */
export function loadFixtures(read: (name: string) => unknown): GraphFixtures {
  return {
    failedSignInsPage1: read(FIXTURE_FILES.failedSignInsPage1),
    failedSignInsPage2: read(FIXTURE_FILES.failedSignInsPage2),
    applications: read(FIXTURE_FILES.applications),
    directoryAudits: read(FIXTURE_FILES.directoryAudits),
  };
}

export const NOW = new Date('2026-09-20T12:00:00Z');

/** A prior snapshot, as the composition root would hand one back. Only
 *  `stats.mfaUnregistered` is read; the rest is filled so the value is a real
 *  `EntraSnapshot` and not a shape that happens to typecheck. */
export const previousSnapshot = (mfaUnregistered: number): EntraSnapshot => ({
  stats: {
    riskySignIns24h: 0, riskyConfirmedCompromised: 0, failedSignIns24h: 0, failedSignInAccounts: 0,
    mfaCoverage: 0.5, mfaUnregistered, privilegedAccounts: 0, globalAdmins: 0,
  },
  signals: [],
  audit: [],
});

export const goodToken = (): TokenSource =>
  ({ get: async () => ({ token: 'stub-token' }), reset: () => {} }) as unknown as TokenSource;
export const failingToken = (): TokenSource =>
  ({ get: async () => ({ error: { code: 'graph_config', message: 'no credential' } }), reset: () => {} }) as unknown as TokenSource;

/** Collections other than the two-page sign-in fixture, written inline so the
 *  expected figures below can be checked by counting them by eye. */
export const RISK = { value: [
  { id: 'DEMO-RISK-0001', detectedDateTime: '2026-09-20T11:00:00Z' },   // current
  { id: 'DEMO-RISK-0002', detectedDateTime: '2026-09-19T01:00:00Z' },   // previous
] };
export const COMPROMISED = { value: [{ id: 'DEMO-USER-0007' }, { id: 'DEMO-USER-0008' }] };
export const REGISTRATION = { value: [
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
export const ASSIGNMENTS = { value: [
  { id: 'DEMO-ASSIGN-0001', principalId: 'DEMO-USER-0001', principal: { '@odata.type': '#microsoft.graph.user' } },
  { id: 'DEMO-ASSIGN-0002', principalId: 'DEMO-USER-0001', principal: { '@odata.type': '#microsoft.graph.user' } },
  { id: 'DEMO-ASSIGN-0003', principalId: 'DEMO-USER-0002', principal: { '@odata.type': '#microsoft.graph.user' } },
  { id: 'DEMO-ASSIGN-0004', principalId: 'DEMO-SPN-0001', principal: { '@odata.type': '#microsoft.graph.servicePrincipal' } },
] };
export const GA_ROLE = { value: [{ id: 'DEMO-ROLE-0001', displayName: 'Global Administrator' }] };
export const GA_MEMBERS = { value: [{ id: 'DEMO-USER-0001' }, { id: 'DEMO-USER-0002' }, { id: 'DEMO-USER-0003' }] };
export const GUESTS = { value: [
  { id: 'DEMO-GUEST-0001', createdDateTime: '2026-09-20T08:00:00Z' },   // inside 24h
  { id: 'DEMO-GUEST-0002', createdDateTime: '2026-06-01T08:00:00Z' },
  { id: 'DEMO-GUEST-0003', createdDateTime: '2026-05-01T08:00:00Z' },
  { id: 'DEMO-GUEST-0004', createdDateTime: '2026-04-01T08:00:00Z' },
] };
export const ROLE_AUDITS = { value: [
  { id: 'DEMO-AUDIT-0001', activityDateTime: '2026-09-20T12:04:00Z' },  // current
  { id: 'DEMO-AUDIT-0009', activityDateTime: '2026-09-19T00:00:00Z' },  // previous
] };
export const POLICY_AUDITS = { value: [
  { id: 'DEMO-AUDIT-0002', activityDisplayName: 'Update conditional access policy', activityDateTime: '2026-09-20T10:00:00Z' },
  { id: 'DEMO-AUDIT-0010', activityDisplayName: 'Update token lifetime policy', activityDateTime: '2026-09-20T09:00:00Z' },
] };

export type Route = [match: (url: string) => boolean, body: unknown];

/** Matched by the distinguishing part of each query rather than by the whole
 *  URL, so a change to `$select` does not silently route a request to 404 and
 *  turn a real assertion into a test of the error path. */
export function routes(f: GraphFixtures, over: Route[] = []): Route[] {
  const has = (...parts: string[]) => (url: string) => parts.every((p) => url.includes(p));
  const signIn = (what: string, kind: 'interactive' | 'other') => (url: string) =>
    url.includes('/auditLogs/signIns') && url.includes(what) &&
    url.includes('signInEventTypes') === (kind === 'other');
  return [
    ...over,
    [signIn('status/errorCode', 'interactive'), f.failedSignInsPage1],
    [(url) => url.includes('$skiptoken=DEMO-SKIP-0001'), f.failedSignInsPage2],
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
    [has('/applications'), f.applications],
    [has('directoryAudits', "category eq 'RoleManagement'"), ROLE_AUDITS],
    [has('directoryAudits', "category eq 'Policy'"), POLICY_AUDITS],
    [has('directoryAudits', '$orderby'), f.directoryAudits],
  ];
}

export function serve(table: Route[]): { impl: FetchLike; misses: string[] } {
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

