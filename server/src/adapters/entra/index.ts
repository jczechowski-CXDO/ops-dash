import type { AuditEvent, EntraSignal, EntraSnapshot, SourceResult } from '@ops-dash/shared';
import type { FetchLike } from '../../http/fetchJson.js';
import type { TokenSource } from '../../http/graphToken.js';
import { readAll, type PagedRead, type Row } from './paged.js';
import {
  APPLICATIONS,
  AUDITS_IN_CATEGORY,
  CONFIRMED_COMPROMISED,
  DAY_MS,
  FAILED_SIGNINS,
  GLOBAL_ADMIN_ROLE,
  GUESTS,
  LEGACY_SIGNINS,
  MFA_REGISTRATION,
  RECENT_AUDITS,
  RISK_DETECTIONS,
  ROLE_ASSIGNMENTS,
  ROLE_MEMBERS,
  asString,
  auditEvent,
  credentialSignal,
  distinctCount,
  isConditionalAccess,
  newestAt,
  signal,
  splitWindows,
} from './queries.js';

/**
 * The Entra security snapshot, read from Microsoft Graph.
 *
 * Shaped after `adapters/vendorstatus/msgraph.ts`: app-only certificate auth
 * through `http/graphToken.ts`, every request out through `http/fetchJson.ts`,
 * failure returned as data rather than thrown. Read-only throughout — every
 * request below is a GET, and the app registration this runs as holds no write
 * scope of any kind.
 *
 * **`stats` is all-or-nothing, and that is the central design decision here.**
 * `EntraSnapshot.stats` is eight required numbers. The contract is frozen and
 * it offers no way to write "we could not look" into one of them, so a partial
 * read would have to put a `0` where a measurement is missing — and a zero on
 * this screen reads as *good news*: no risky sign-ins, no failed sign-ins, no
 * unregistered users. That is precisely the failure this repository exists to
 * not commit, one layer below where anybody would look for it. So if any single
 * constituent read fails, this returns `error` with **no `data` at all**,
 * exactly as `pollMsgraph` does when it cannot authenticate. The panel then
 * says "we could not look", which is true, instead of showing a clean dashboard
 * built out of holes.
 *
 * `signals[]` is different and gets the opposite treatment, because a list CAN
 * express absence: a signal with no evidence behind it is **omitted**, never
 * emitted at zero with the poll time as its `lastSeen`.
 *
 * **The fork, recorded so the next person sees it rather than rediscovers it:**
 * if one flaky read blanking the whole panel turns out to be too brittle in
 * practice, the fix is a contract amendment making `stats`' members nullable —
 * `number | null`, handled by the typechecker at every call site. It is NOT a
 * zero. A nullable field says "we could not look"; a zero says "we looked and
 * there is nothing", and on this screen those are opposite pieces of news.
 *
 * **Cheap reads are kept separable from expensive ones, deliberately.** The
 * sign-in counts are the only figures here that anything will plausibly want at
 * a tighter cadence — DATA_CONTRACTS §7's unimplemented `spray` rule wants
 * failed sign-ins over a 15-minute window, which 1,473 app registrations will
 * never justify polling for. So the split is not built, but it is not fused
 * either: `FAILED_SIGNINS` and `readAll` are both exported and together answer
 * that question with no part of this function involved. `index.test.ts` proves
 * it, so the property survives a refactor that did not know about it.
 *
 * **Sequentially, not in parallel.** Thirteen concurrent Graph requests is the
 * shape that earns a 429, and `fetchJson` has no backoff — a throttle would
 * surface as a failed read and, under the all-or-nothing rule above, cost the
 * whole snapshot. Sequential is slower and this source is polled in minutes.
 */

export type EntraPollOptions = {
  tokens: TokenSource;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Lowered by tests so truncation is reachable with three rows. */
  maxPages?: number;
  /** The 429 backoff's wait, injected so tests do not spend fourteen seconds
   *  proving that this adapter waits. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * The last snapshot this source produced, or `undefined` on a cold start.
   *
   * **A parameter, never a store import, and the width is the point.** This
   * adapter must not develop a private opinion about what "previous" means or
   * where it is kept: the composition root owns storage, this file owns
   * arithmetic, and the seam between them is one argument wide so neither side
   * can drift. Milestone 3's expensive defects were all two halves each
   * individually correct and disagreeing about the join; a seam you can read in
   * a single line is one that cannot be joined two ways.
   *
   * **What it is for.** Seven of the eight contract signals have a `delta24h`
   * derivable from a single poll: five are event counts, so the previous window
   * is just the second half of one 48-hour read; guest arrivals come off
   * `createdDateTime`; and credential expiry is arithmetic on the credentials
   * themselves. MFA registration is none of those. `reports/
   * authenticationMethods/userRegistrationDetails` is point-in-time only —
   * Graph has no record of what that number was yesterday and no query can
   * conjure one. So `mfa_gap`'s delta is `stats.mfaUnregistered` now minus
   * `stats.mfaUnregistered` then, and "then" has to be handed to us.
   *
   * **And on a cold start there is no `then`.** That is the whole reason this is
   * `EntraSnapshot | undefined` rather than a number with a default. `0` would
   * be the "absent is not zero" lie, and a guessed delta is worse because it
   * looks like a measurement. This repo has now been caught by the same shape
   * three times in two days — a phantom Sev2 at boot from `never_polled`, the
   * `ourside` rule that would have opened one on every restart, and this. So:
   * **the `mfa_gap` signal is omitted entirely until a prior snapshot exists.**
   * Omission is expressible in the frozen contract and a wrong number is not.
   * The count is never lost — it is `stats.mfaUnregistered`, which asks for no
   * delta and is present from the first poll.
   */
  previous?: EntraSnapshot;
};

type Failure = { code: string; message: string };

/** Accumulates the first failure and the fact of any truncation across a dozen
 *  reads, so the caller below stays a list of questions rather than a ladder of
 *  early returns. */
class Reader {
  failure: Failure | undefined;
  truncated: string[] = [];

  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike | undefined,
    private readonly maxPages: number | undefined,
    private readonly sleep: ((ms: number) => Promise<void>) | undefined,
  ) {}

  async read(what: string, url: string): Promise<Row[]> {
    if (this.failure) return [];   // already lost; do not keep hammering Graph
    const result: PagedRead = await readAll(url, this.token, this.fetchImpl, {
      ...(this.maxPages === undefined ? {} : { maxPages: this.maxPages }),
      ...(this.sleep === undefined ? {} : { sleep: this.sleep }),
    });
    if (!result.ok) {
      this.failure = { code: result.error.code, message: `${what}: ${result.error.message}` };
      return [];
    }
    if (result.truncated) this.truncated.push(what);
    return result.rows;
  }

  /**
   * The newest rows only, deliberately one page and no more.
   *
   * `$top` does not end a collection, it sizes a page: measured, an audit query
   * with `$top=50` still came back with an `@odata.nextLink`, so the ordinary
   * `read` would have walked the whole audit log to fill a table of eight rows.
   * Truncation here is the intent rather than a budget being hit, so it is NOT
   * recorded as degrading the snapshot — which is why this is a second method
   * and not a flag on the first.
   */
  async readNewest(what: string, url: string): Promise<Row[]> {
    if (this.failure) return [];
    const result = await readAll(url, this.token, this.fetchImpl, {
      maxPages: 1,
      ...(this.sleep === undefined ? {} : { sleep: this.sleep }),
    });
    if (!result.ok) {
      this.failure = { code: result.error.code, message: `${what}: ${result.error.message}` };
      return [];
    }
    return result.rows;
  }

  /** A sign-in question is two disjoint queries — see `signInQueries`. Reading
   *  only one of them is the defect this method exists to make impossible. */
  async readSignIns(what: string, pair: [string, string]): Promise<Row[]> {
    const interactive = await this.read(`${what} (interactive)`, pair[0]);
    const other = await this.read(`${what} (non-interactive)`, pair[1]);
    return [...interactive, ...other];
  }
}

export async function pollEntra(opts: EntraPollOptions): Promise<SourceResult<EntraSnapshot>> {
  const nowDate = (opts.now ?? (() => new Date()))();
  const fetchedAt = nowDate.toISOString();
  const now = nowDate.getTime();
  const since48 = now - 2 * DAY_MS;

  const auth = await opts.tokens.get();
  if ('error' in auth) {
    // A failure to LOOK, not a statement about the directory. No `data`.
    return {
      fetchedAt,
      degraded: false,
      error: {
        code: auth.error.code,
        message: `We could not authenticate to Microsoft Graph (${auth.error.code}), so nothing about Entra was read.`,
      },
    };
  }

  const r = new Reader(auth.token, opts.fetchImpl, opts.maxPages, opts.sleep);

  const failedSignIns = await r.readSignIns('failed sign-ins', FAILED_SIGNINS(since48));
  const legacySignIns = await r.readSignIns('legacy-auth sign-ins', LEGACY_SIGNINS(since48));
  const riskDetections = await r.read('risk detections', RISK_DETECTIONS(since48));
  const compromised = await r.read('confirmed-compromised users', CONFIRMED_COMPROMISED);
  const registration = await r.read('MFA registration report', MFA_REGISTRATION);
  const assignments = await r.read('directory role assignments', ROLE_ASSIGNMENTS);
  const guests = await r.read('guest accounts', GUESTS);
  const applications = await r.read('app registrations', APPLICATIONS);
  const roleAudits = await r.read('role-management audit', AUDITS_IN_CATEGORY('RoleManagement', since48));
  const policyAudits = await r.read('policy audit', AUDITS_IN_CATEGORY('Policy', since48));
  const recentAudits = await r.readNewest('recent directory audit', RECENT_AUDITS);

  // Global admins take two hops: the role's object id is a tenant value we look
  // up rather than a GUID transcribed into source.
  const gaRole = await r.read('Global Administrator role', GLOBAL_ADMIN_ROLE);
  const gaRoleId = gaRole.length === 1 ? asString(gaRole[0]?.['id']) : undefined;
  const globalAdmins = gaRoleId === undefined ? [] : await r.read('Global Administrator members', ROLE_MEMBERS(gaRoleId));
  if (r.failure === undefined && gaRoleId === undefined) {
    r.failure = {
      code: 'entra_shape',
      message: `Global Administrator role: expected exactly one directory role by that name, saw ${gaRole.length}`,
    };
  }

  /**
   * MFA coverage is about MEMBERS, and that is a measurement and not a taste.
   *
   * The registration report covers the whole directory. Measured on this tenant:
   * members 358 registered of 470 = **0.762**; guests **2 of 511**. Rolled
   * together the headline figure is **0.367**, and it would sit on the Entra
   * screen looking like a catastrophic staff-MFA gap that no amount of work
   * could ever close — the permanently-red tile, arrived at from the data side.
   * A B2B guest authenticates against their own home tenant and registers their
   * methods there; their absence from our registration report is not our gap.
   *
   * A row whose `userType` is neither is a shape we do not recognise, and
   * dropping it would shrink the divisor and inflate coverage — the reassuring
   * direction, again.
   */
  const members: Row[] = [];
  if (r.failure === undefined) {
    for (const row of registration) {
      const type = asString(row['userType']);
      if (type === undefined) {
        r.failure = { code: 'entra_shape', message: 'a registration-report row carried no userType' };
        break;
      }
      if (type === 'member') members.push(row);
    }
  }

  // The divisor. Zero rows is not a coverage of zero and it is not a coverage of
  // one; it is a report we could not use.
  if (r.failure === undefined && members.length === 0) {
    r.failure = { code: 'entra_empty', message: 'the MFA registration report returned no member accounts, so coverage cannot be computed' };
  }

  // Privileged accounts means PEOPLE. A role assignment whose principal did not
  // come back typed is a shape we do not recognise, not a principal we may
  // quietly drop — dropping it would shrink the number, and smaller is the
  // reassuring direction.
  const principals = new Set<string>();
  if (r.failure === undefined) {
    for (const row of assignments) {
      const principal = row['principal'];
      const type = typeof principal === 'object' && principal !== null
        ? asString((principal as Row)['@odata.type'])
        : undefined;
      if (type === undefined) {
        r.failure = { code: 'entra_shape', message: 'a role assignment came back with no typed principal' };
        break;
      }
      if (type.endsWith('.user')) {
        const id = asString(row['principalId']);
        if (id !== undefined) principals.add(id);
      }
    }
  }

  if (r.failure !== undefined) {
    return {
      fetchedAt,
      degraded: false,
      error: {
        code: r.failure.code,
        // Named plainly: an operator needs to know WHICH question went
        // unanswered, and a snapshot that is missing is more useful than one
        // that is quietly wrong.
        message: `We could not read Entra (${r.failure.message}). No figures are shown rather than partial ones, because a missing count on this screen reads as good news.`,
      },
    };
  }

  /* -------------------------------------------------------------- windows */

  const failed = splitWindows(failedSignIns, 'createdDateTime', now);
  const legacy = splitWindows(legacySignIns, 'createdDateTime', now);
  const risk = splitWindows(riskDetections, 'detectedDateTime', now);
  const roles = splitWindows(roleAudits, 'activityDateTime', now);
  const ca = splitWindows(policyAudits.filter(isConditionalAccess), 'activityDateTime', now);
  const newGuests = guests.filter((g) => {
    const t = Date.parse(asString(g['createdDateTime']) ?? '');
    return Number.isFinite(t) && t > now - DAY_MS;
  });

  const registered = members.filter((u) => u['isMfaRegistered'] === true).length;
  const mfaUnregistered = members.length - registered;
  const credentials = credentialSignal(applications, now);

  /* -------------------------------------------------------------- signals */

  const signals: (EntraSignal | undefined)[] = [
    signal('risky_signin', risk.current.length, risk.current.length - risk.previous.length,
      newestAt(riskDetections, 'detectedDateTime')),
    signal('failed_spike', failed.current.length, failed.current.length - failed.previous.length,
      newestAt(failedSignIns, 'createdDateTime')),
    signal('legacy_auth', legacy.current.length, legacy.current.length - legacy.previous.length,
      newestAt(legacySignIns, 'createdDateTime')),
    // The cold start, stated where it happens rather than only where it is
    // configured: with no prior snapshot there is no yesterday to subtract, so
    // there is no row. Not a zero, not a guess. See `previous` above.
    opts.previous === undefined
      ? undefined
      : signal('mfa_gap', mfaUnregistered, mfaUnregistered - opts.previous.stats.mfaUnregistered,
        newestAt(members, 'lastUpdatedDateTime')),
    signal('expiring_credentials', credentials.count, credentials.delta24h, credentials.lastEnteredAt),
    signal('role_change', roles.current.length, roles.current.length - roles.previous.length,
      newestAt(roleAudits, 'activityDateTime')),
    // Guests: `delta24h` counts ARRIVALS only. A guest removed yesterday leaves
    // no row behind to count, so this can be too small and never too large —
    // stated rather than left for someone to discover from a number that will
    // not reconcile.
    signal('guest_access', guests.length, newGuests.length, newestAt(guests, 'createdDateTime')),
    signal('ca_change', ca.current.length, ca.current.length - ca.previous.length,
      newestAt(policyAudits.filter(isConditionalAccess), 'activityDateTime')),
  ];

  const audit: AuditEvent[] = [];
  for (const row of recentAudits) {
    const event = auditEvent(row);
    // `$top` on this collection is a request and not a promise — asked for 8 it
    // returned 10 — so the slice is ours.
    if (event !== null && audit.length < 8) audit.push(event);
  }

  const data: EntraSnapshot = {
    stats: {
      riskySignIns24h: risk.current.length,
      riskyConfirmedCompromised: compromised.length,
      failedSignIns24h: failed.current.length,
      failedSignInAccounts: distinctCount(failed.current, 'userId'),
      mfaCoverage: registered / members.length,
      mfaUnregistered,
      privilegedAccounts: principals.size,
      globalAdmins: globalAdmins.length,
    },
    signals: signals.filter((s): s is EntraSignal => s !== undefined),
    audit,
  };

  // Truncation and unreadable timestamps are both "this number is too small".
  // They travel as `degraded` plus a reason, not as a silently short answer —
  // the contract says `data` and `error` are not mutually exclusive, and this is
  // the case it was written for.
  const unparsed = failed.unparsed + legacy.unparsed + risk.unparsed + roles.unparsed + ca.unparsed;
  const reasons: string[] = [];
  if (r.truncated.length > 0) reasons.push(`hit the page budget on: ${r.truncated.join(', ')}`);
  if (unparsed > 0) reasons.push(`${unparsed} row(s) carried a timestamp we could not read`);
  if (reasons.length > 0) {
    return {
      data,
      fetchedAt,
      degraded: true,
      error: {
        code: 'entra_partial',
        message: `These counts are lower bounds: ${reasons.join('; ')}.`,
      },
    };
  }

  return { data, fetchedAt, degraded: false };
}
