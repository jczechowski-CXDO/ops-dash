import type { AuditEvent, EntraSignal, Severity } from '@ops-dash/shared';
import { GRAPH_BETA, GRAPH_V1, type Row } from './paged.js';

/**
 * Every Graph question this adapter asks, and the one scope each of them needs.
 *
 * The scope column is the point of this file. `CXDO-GraphExport` holds around
 * eighty application roles on this tenant — every one of them a `*.Read*`, so
 * the read-only premise holds mechanically rather than by anyone's care, but
 * eighty is far more than an Entra tile needs. "The toolbox app can do it" is
 * how a read-only premise erodes into a read-everything one, so each builder
 * below names the single scope that authorises it. If a call here ever needs a
 * scope not on this list, that is a decision someone has to make out loud.
 *
 *   /auditLogs/signIns                      AuditLog.Read.All
 *   /auditLogs/directoryAudits              AuditLog.Read.All
 *   /identityProtection/riskDetections      IdentityRiskEvent.Read.All
 *   /identityProtection/riskyUsers          IdentityRiskyUser.Read.All
 *   /reports/authenticationMethods/…        AuditLog.Read.All + Reports.Read.All
 *   /roleManagement/directory/…             RoleManagement.Read.Directory
 *   /directoryRoles, /directoryRoles/…/members   Directory.Read.All
 *   /users                                  User.Read.All
 *   /applications                           Application.Read.All
 *
 * **Page sizes are per-collection and they are not advisory.** Measured:
 * `auditLogs/signIns` accepts 1000; `users`, `applications` and the
 * registration report accept 999; `identityProtection/riskDetections` answers
 * `400 BadRequest — Invalid page size specified: '999'. Must be between 1 and
 * 500 inclusive.` And `directoryAudits` **ignores a small `$top`**: asked for 8
 * it returned 10, so any "newest N" is sliced here rather than trusted to the
 * server.
 *
 * **`$count` is not available.** `$count=true` with `ConsistencyLevel: eventual`
 * against `auditLogs/signIns` returns a body with no `@odata.count` at all, so
 * every count below is reached by walking pages. That is the reason `paged.ts`
 * exists and the reason this source wants a poll interval measured in minutes.
 */

/** Twenty-four hours, in ms. The window every `24h` figure in the contract means. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead a credential counts as "expiring".
 *
 * Thirty days because that is the notice period a person can act inside. It is
 * also what makes `expiring_credentials`' `delta24h` computable at all — see
 * `credentialSignal`.
 */
export const EXPIRY_HORIZON_DAYS = 30;

const iso = (t: number): string => new Date(t).toISOString();

/* --------------------------------------------------------------- sign-ins */

/**
 * The legacy authentication clients, as Entra names them in `clientAppUsed`.
 *
 * Spelled out rather than inferred from "not Browser and not Mobile Apps",
 * because a value Microsoft adds later would join the legacy set by default
 * under the negative form, and a new modern client reading as legacy auth is an
 * alarm that cries wolf. Measured: this filter is accepted and returned zero
 * rows over 48 hours on this tenant, which is what a tenant with legacy auth
 * blocked should look like.
 */
export const LEGACY_CLIENT_APPS = [
  'Authenticated SMTP',
  'AutoDiscover',
  'Exchange ActiveSync',
  'Exchange Online PowerShell',
  'Exchange Web Services',
  'IMAP4',
  'MAPI Over HTTP',
  'Offline Address Book',
  'Other clients',
  'POP3',
  'Reporting Web Services',
] as const;

const quoted = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/**
 * The two halves of one sign-in question.
 *
 * A Graph sign-in query with no `signInEventTypes` clause silently answers
 * about interactive sign-ins ONLY, and says nothing about having done so. The
 * clause that reaches the rest is `signInEventTypes/any(x: x ne
 * 'interactiveUser')`, and `signInEventTypes` does not exist on the v1.0
 * entity — hence `GRAPH_BETA`, argued in `paged.ts`.
 *
 * So one question is two requests whose results are disjoint and summed. The
 * alternative — a single clause matching both — was tried and Graph answered
 * `400 Unsupported Query` on the second page, which is the worst possible
 * shape: correct-looking page one, failure only once the estate is large
 * enough to need a second page. Two attested queries beat one clever one.
 *
 * Returned as a pair so no caller can use half of it and get a number that is
 * an order of magnitude small while looking entirely reasonable.
 */
export function signInQueries(filter: string, since: number, select: string[]): [string, string] {
  const base =
    `${GRAPH_BETA}/auditLogs/signIns?$top=1000` +
    `&$select=${select.join(',')}` +
    `&$filter=createdDateTime ge ${iso(since)} and ${filter}`;
  return [base, `${base} and signInEventTypes/any(x: x ne 'interactiveUser')`];
}

/** Failed sign-ins. `status/errorCode ne 0` is Entra's own definition of a
 *  sign-in that did not succeed, including the ones that were interrupted. */
export const FAILED_SIGNINS = (since: number): [string, string] =>
  signInQueries('status/errorCode ne 0', since, ['id', 'createdDateTime', 'userId']);

/** Legacy-protocol sign-ins, successful or not: the attempt is the signal. */
export const LEGACY_SIGNINS = (since: number): [string, string] =>
  signInQueries(
    `(${LEGACY_CLIENT_APPS.map((a) => `clientAppUsed eq ${quoted(a)}`).join(' or ')})`,
    since,
    ['id', 'createdDateTime'],
  );

/**
 * Legacy-protocol sign-ins that SUCCEEDED.
 *
 * §7's `legacy` rule is about a success, not an attempt — a blocked IMAP login
 * is the control working. `LEGACY_SIGNINS` above counts attempts because that
 * is what the dashboard signal means; this counts the subset that got through,
 * and the two differ by the whole of the estate's blocked traffic. Measured on
 * the live tenant over 24 hours: **11 attempts, 0 successes.** A rule wired to
 * the attempts figure is a permanent Sev2; wired to this one it is correctly
 * silent.
 *
 * `status/errorCode eq 0` is Entra's own definition of a sign-in that worked.
 */
export const SUCCESSFUL_LEGACY_SIGNINS = (since: number): [string, string] =>
  signInQueries(
    `(${LEGACY_CLIENT_APPS.map((a) => `clientAppUsed eq ${quoted(a)}`).join(' or ')}) and status/errorCode eq 0`,
    since,
    ['id', 'createdDateTime'],
  );

/**
 * Risky sign-ins come from `riskDetections`, NOT from the sign-in log.
 *
 * `riskLevelDuringSignIn` is a property on the sign-in entity and it is not
 * filterable on this tenant: `$filter=... riskLevelDuringSignIn eq 'high'`
 * answers `400 Unsupported Query` on v1.0 and on beta, single-valued or
 * OR-joined. Identity Protection surfaces the same events through
 * `riskDetections`, which filters on `detectedDateTime` and works.
 *
 * Stated plainly because the contract's field is called `riskySignIns24h` and
 * this is a detection count, which is a near-synonym and not a synonym: one
 * sign-in can raise more than one detection. It is the honest available
 * reading, and the name is frozen.
 */
export const RISK_DETECTIONS = (since: number): string =>
  `${GRAPH_V1}/identityProtection/riskDetections?$top=500&$select=id,detectedDateTime,riskLevel` +
  `&$filter=detectedDateTime ge ${iso(since)}`;

/** Users Identity Protection currently holds as confirmed compromised. A
 *  standing state, not a 24-hour count — the contract's field has no window in
 *  its name and this one genuinely has none. */
export const CONFIRMED_COMPROMISED =
  `${GRAPH_V1}/identityProtection/riskyUsers?$top=500&$select=id` +
  `&$filter=riskState eq 'confirmedCompromised'`;

/* ------------------------------------------------------------- directory */

/**
 * The authentication-methods registration report.
 *
 * It contains **enabled users only**, which is the right population and worth
 * saying: an account missing from it is usually disabled rather than
 * unprotected, and counting absences as gaps would inflate the number with
 * accounts nobody can sign in to.
 */
export const MFA_REGISTRATION =
  `${GRAPH_V1}/reports/authenticationMethods/userRegistrationDetails?$top=999` +
  `&$select=id,isMfaRegistered,userType,lastUpdatedDateTime`;

/**
 * Active directory role assignments, with the principal expanded.
 *
 * Expanded because "privileged accounts" on a security tile means people. The
 * assignment row alone carries a `principalId` and no type, so counting
 * distinct ids would silently fold service principals in beside humans —
 * measured here as 145 assignments over 57 distinct principals, and the two
 * populations want different responses from an operator.
 */
export const ROLE_ASSIGNMENTS =
  `${GRAPH_V1}/roleManagement/directory/roleAssignments?$top=999&$select=id,principalId&$expand=principal`;

/**
 * The Global Administrator role, found by display name rather than by its
 * well-known template id.
 *
 * The template id is a published Microsoft constant and not a secret, but it is
 * a GUID, and `web/src/guards.test.ts` refuses a GUID literal anywhere in this
 * repo's source. That guard is right and should not learn an exception: it
 * cannot distinguish Microsoft's constant from this tenant's id, and the day it
 * tries is the day it gets that judgement wrong in the other direction.
 */
export const GLOBAL_ADMIN_ROLE =
  `${GRAPH_V1}/directoryRoles?$select=id,displayName&$filter=displayName eq 'Global Administrator'`;

/**
 * The members of one directory role. **No `$top`** — measured:
 *
 *     400 Bad Request — This resource does not support custom page sizes.
 *                       Please retry without a page size argument.
 *
 * Third page-size rule on three collections, all different: 1000 on sign-ins,
 * 500 on risk detections, and here a `$top` of any size is a 400. `$select` is
 * accepted. This is why `queries.test.ts` pins each one as a literal rather
 * than trusting a house style.
 */
export const ROLE_MEMBERS = (roleId: string): string =>
  `${GRAPH_V1}/directoryRoles/${encodeURIComponent(roleId)}/members?$select=id`;

export const GUESTS = `${GRAPH_V1}/users?$top=999&$select=id,createdDateTime&$filter=userType eq 'Guest'`;

/** App registrations, for credential expiry. Two pages on this tenant. */
export const APPLICATIONS =
  `${GRAPH_V1}/applications?$top=999&$select=id,displayName,passwordCredentials,keyCredentials`;

/**
 * Directory audits, filtered server-side by category.
 *
 * Wholesale is not an option: 48 hours of unfiltered `directoryAudits` on this
 * tenant passed 2,500 rows in five pages and had not finished.
 */
export const AUDITS_IN_CATEGORY = (category: string, since: number): string =>
  `${GRAPH_V1}/auditLogs/directoryAudits?$top=500` +
  `&$select=id,category,activityDisplayName,activityDateTime,result,initiatedBy,targetResources` +
  `&$filter=activityDateTime ge ${iso(since)} and category eq ${quoted(category)}`;

/** The newest entries for the audit table. `$top` is a request, not a promise —
 *  asked for 8 this collection returned 10 — so the slice happens here. */
export const RECENT_AUDITS =
  `${GRAPH_V1}/auditLogs/directoryAudits?$top=50&$orderby=activityDateTime desc` +
  `&$select=id,activityDisplayName,activityDateTime,result,initiatedBy,targetResources`;

/* ---------------------------------------------------------- pure readings */

export const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const asRecord = (v: unknown): Row | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row) : null;

/** Milliseconds for an ISO instant, or `undefined` — never `NaN` and never
 *  today. A parser that returns the current time for an unreadable date turns a
 *  malformed payload into fresh evidence. */
export function instant(v: unknown): number | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Split rows into the last 24 hours and the 24 hours before that.
 *
 * Both windows come out of ONE 48-hour read, so `count` and the baseline
 * `delta24h` is measured against cannot disagree about which rows exist — two
 * separate requests a second apart would put the boundary in two places.
 *
 * A row whose timestamp will not parse is counted in NEITHER window and
 * returned in `unparsed`, so "we could not read these dates" is a number the
 * caller can act on rather than a silent shortfall. Graph emits variable
 * fractional-second precision and a parser that shrugs turns live rows into
 * absence.
 */
export function splitWindows(rows: Row[], key: string, now: number): {
  current: Row[];
  previous: Row[];
  unparsed: number;
} {
  const current: Row[] = [];
  const previous: Row[] = [];
  let unparsed = 0;
  for (const row of rows) {
    const t = instant(row[key]);
    if (t === undefined) { unparsed += 1; continue; }
    if (t > now - DAY_MS) current.push(row);
    else if (t > now - 2 * DAY_MS) previous.push(row);
  }
  return { current, previous, unparsed };
}

export function distinctCount(rows: Row[], key: string): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = asString(row[key]);
    if (v !== undefined) seen.add(v);
  }
  return seen.size;
}

/** The newest instant among rows, as ISO, or `undefined` when there is none.
 *  `undefined` is the whole point: a signal with no evidence has no `lastSeen`,
 *  and stamping it with the poll time would read as "seen just now". */
export function newestAt(rows: Row[], key: string): string | undefined {
  let best: number | undefined;
  for (const row of rows) {
    const t = instant(row[key]);
    if (t !== undefined && (best === undefined || t > best)) best = t;
  }
  return best === undefined ? undefined : iso(best);
}

/**
 * The severity ladder, one entry per contract key.
 *
 * `severity` classifies the SIGNAL, not the day: a risky sign-in is a Sev1
 * signal whether today's count is seven or one. That is the fixtures' own
 * ruling and the counts are what move, so this is a constant table and not a
 * function of the numbers.
 */
export const SIGNAL_SEVERITY: Record<EntraSignal['key'], Severity> = {
  risky_signin: 1,
  failed_spike: 2,
  legacy_auth: 2,
  mfa_gap: 3,
  expiring_credentials: 3,
  role_change: 2,
  guest_access: 'info',
  ca_change: 'info',
};

/** The operator-facing label for each key. Pinned here so the live page and the
 *  fixtures read identically — a screen whose wording changes when the data
 *  becomes real is one the operator has to learn twice. */
export const SIGNAL_LABEL: Record<EntraSignal['key'], string> = {
  risky_signin: 'Risky sign-ins',
  failed_spike: 'Failed sign-in spike',
  legacy_auth: 'Legacy auth attempts',
  mfa_gap: 'MFA registration gaps',
  expiring_credentials: 'Expiring secrets & certs',
  role_change: 'Privileged role changes',
  guest_access: 'Guest / external access',
  ca_change: 'CA policy changes',
};

/**
 * Build a signal, or decline to.
 *
 * `undefined` when there is no `lastSeen` — no evidence of this signal ever
 * having happened. The alternative is a row claiming it was last seen at the
 * moment we looked, which is the same class of lie as a zero standing in for an
 * absent measurement. An omitted row is expressible in the frozen contract;
 * an unknown instant is not.
 */
export function signal(
  key: EntraSignal['key'],
  count: number,
  delta24h: number,
  lastSeen: string | undefined,
): EntraSignal | undefined {
  if (lastSeen === undefined) return undefined;
  return { key, label: SIGNAL_LABEL[key], count, delta24h, severity: SIGNAL_SEVERITY[key], lastSeen };
}

/**
 * Credentials expiring inside the horizon, and how that count moved in a day.
 *
 * This is the one state-shaped signal whose `delta24h` is honestly derivable
 * from a single read, and the reason is arithmetic rather than luck: a
 * credential enters the "expires within 30 days" window at exactly
 * `endDateTime - 30 days`, which is a property of the credential itself. So
 * yesterday's count is computable from today's list, with one stated
 * assumption — that no credential was added or removed in the last 24 hours.
 * A credential created yesterday and expiring inside the horizon would make the
 * delta one too small. That is a real limit, it is bounded, and it errs toward
 * under-reporting a change rather than inventing one.
 *
 * `lastEnteredAt` is the most recent moment a credential crossed into the
 * window — a real instant, not the poll time.
 */
export function credentialSignal(apps: Row[], now: number, horizonDays = EXPIRY_HORIZON_DAYS): {
  count: number;
  delta24h: number;
  lastEnteredAt: string | undefined;
} {
  const horizon = horizonDays * DAY_MS;
  const entries: number[] = [];
  for (const app of apps) {
    for (const field of ['passwordCredentials', 'keyCredentials'] as const) {
      const list = app[field];
      if (!Array.isArray(list)) continue;
      for (const cred of list) {
        const rec = asRecord(cred);
        const end = instant(rec?.['endDateTime']);
        if (end !== undefined) entries.push(end - horizon);
      }
    }
  }
  // Already expired credentials stay counted: an expired secret is not a solved
  // problem, it is the problem having happened.
  const count = entries.filter((e) => e <= now).length;
  const before = entries.filter((e) => e <= now - DAY_MS).length;
  const crossed = entries.filter((e) => e <= now);
  const lastEnteredAt = crossed.length === 0 ? undefined : iso(Math.max(...crossed));
  return { count, delta24h: count - before, lastEnteredAt };
}

/**
 * Credentials whose expiry is in the FUTURE and inside the horizon.
 *
 * **A different computation from `credentialSignal`, not a different parameter,
 * and the distinction is the whole reason this function exists.**
 * `credentialSignal` counts a credential from the moment it enters the window
 * and keeps counting it forever after it expires — deliberately, because an
 * expired secret is not a solved problem, it is the problem having happened,
 * and a dashboard figure should say so. That makes it a **standing backlog**.
 *
 * §7's `secrets` rule needs the opposite: what is about to break. Measured on
 * the live tenant, the two disagree by twenty on an ordinary day —
 * `credentialSignal` reports **20**, of which **19 have already expired**, and
 * this reports **0**. Feeding the backlog figure to the rule at any horizon
 * pins a Sev3 on permanently, which no horizon value can fix.
 *
 * So the two numbers are both right and they answer different questions. The
 * first person to see 20 on the Entra screen and 0 in the rule will assume one
 * is broken; this comment and the one on `credentialSignal` are the answer.
 */
export function credentialsExpiringSoon(apps: Row[], now: number, horizonDays: number): number {
  const until = now + horizonDays * DAY_MS;
  let count = 0;
  for (const app of apps) {
    for (const field of ['passwordCredentials', 'keyCredentials'] as const) {
      const list = app[field];
      if (!Array.isArray(list)) continue;
      for (const cred of list) {
        const rec = asRecord(cred);
        const end = instant(rec?.['endDateTime']);
        // Strictly in the future, and inside the horizon. An already-expired
        // credential is excluded here and counted by `credentialSignal`.
        if (end !== undefined && end > now && end <= until) count += 1;
      }
    }
  }
  return count;
}

/** Is a directory-audit row about Conditional Access? The category is `Policy`,
 *  which also carries claims-mapping, token-lifetime and every other policy
 *  edit, so the activity name is what narrows it. Matched case-insensitively
 *  because Entra's activity names are prose and their casing is not a contract. */
export const isConditionalAccess = (row: Row): boolean =>
  /conditional access/i.test(asString(row['activityDisplayName']) ?? '');

/**
 * A directory-audit row as the contract's `AuditEvent`, or `null`.
 *
 * `null` rather than a row with empty strings: a table line reading
 * `— — —` looks like data and is not. The actor falls back to the literal
 * `System`, which is the contract's own stated convention for an event no user
 * initiated, and only when Graph genuinely reports no user.
 */
export function auditEvent(row: Row): AuditEvent | null {
  const at = asString(row['activityDateTime']);
  const action = asString(row['activityDisplayName']);
  if (at === undefined || instant(at) === undefined || action === undefined) return null;

  const initiated = asRecord(row['initiatedBy']);
  const user = asRecord(initiated?.['user']);
  const app = asRecord(initiated?.['app']);
  const actor =
    asString(user?.['userPrincipalName']) ??
    asString(app?.['displayName']) ??
    'System';

  const targets = row['targetResources'];
  const first = Array.isArray(targets) ? asRecord(targets[0]) : null;
  const target = asString(first?.['displayName']) ?? asString(first?.['userPrincipalName']) ?? '';
  if (target === '') return null;

  // Graph's audit `result` vocabulary is success | failure | timeout |
  // unknownFutureValue; the contract has two. Anything that is not an
  // affirmative success is reported as a failure, because the direction that
  // must never be invented is the reassuring one.
  const result = asString(row['result']) === 'success' ? 'success' : 'failure';
  return { at, actor, action, target, result };
}
