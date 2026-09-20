import type { AlertRule, BlastMetric, ServiceId, Severity, StatusLevel, VendorPlatform } from '@ops-dash/shared';

/**
 * The rules, as DATA_CONTRACTS.md section 7 states them.
 *
 * | key        | fires when                                            | sev |
 * |------------|-------------------------------------------------------|-----|
 * | `vendor`   | vendor `degraded` or `outage` AND our check failing    | 1   |
 * | `blackout` | every service on one platform `unknown`, and >1 shares | 2   |
 *
 * Everything in this file is a pure function of the state it is handed. It
 * does not fetch, does not schedule and does not write — which is why the
 * whole rule set can be exercised without a store, and why the tests can put
 * the estate into shapes that would take an hour to produce for real.
 */

/* ------------------------------------------------------------------- input */

/** What one service looks like to the engine at one instant.
 *
 *  Deliberately narrower than `ServiceStatus`: the rules need the vendor's
 *  word, where that word came from, and how many of our probes are passing.
 *  Handing the engine a whole `ServiceStatus` would let a rule reach for
 *  `spark[]` or `uptime30d` and quietly become a function of history. */
export type ServiceSignal = {
  serviceId: ServiceId;
  /** Operator-facing name for titles and summaries. Optional: the id is a
   *  perfectly readable fallback and a caller should not have to invent one. */
  label?: string;
  vendor: {
    level: StatusLevel;
    platform: VendorPlatform;      // amendment 5 — how `blackout` groups
    /** `SourceResult.error.code` from the adapter, when there was one. The
     *  level alone cannot distinguish "the feed failed" from "no adapter
     *  exists yet", and `blackout` needs to. */
    errorCode?: string;
  };
  ours: { passing: number; total: number };
};

/* ------------------------------------------------------- the identity input */

/**
 * What the identity rules see, and **why it is not `EntraSnapshot`**.
 *
 * `EntraSnapshot` is a frozen view-model, shaped for a screen, at the windows
 * the screen wants. Letting a rule read it would make the rule a function of
 * whatever the page happens to display — the same failure `ServiceSignal`'s
 * comment above guards against one domain over.
 *
 * It is not a hypothetical. Measured on the live tenant, three of §7's four
 * identity rules have a near-miss sitting in that snapshot, and **every one of
 * the near-misses errs toward firing forever**:
 *
 *   | rule      | §7 asks for                 | the snapshot offers          | measured                                   |
 *   |-----------|-----------------------------|------------------------------|--------------------------------------------|
 *   | `spray`   | >500 failures in 15 min     | `failedSignIns24h` = 4535    | busiest 15-min bucket in 6h = **68**       |
 *   | `secrets` | expiring within 14 days     | `expiring_credentials` = 20  | 19 of those already EXPIRED; future = **0**|
 *   | `legacy`  | a SUCCESSFUL legacy sign-in | `legacy_auth` = 11 attempts  | successes in 24h = **0**                   |
 *
 * Wired to the near-misses, three permanently-on alarms. Wired to these fields,
 * all three are correctly quiet. The general form is worth more than the three
 * instances: **a standing-backlog signal and an alerting threshold are
 * different quantities**, and the backlog number is always the one already in
 * your hand.
 *
 * Two defences are built into the shape rather than asked for in a comment:
 *
 *   - **the window travels with the number.** `spray` asserts its count covers
 *     fifteen minutes and `secrets` asserts its horizon is fourteen days, so a
 *     caller who hands over a 24-hour count gets a loud, named refusal instead
 *     of a silent permanent Sev2. A comment saying "must be 15 minutes" is the
 *     kind this project has watched fail three times in one night.
 *   - **the field names refuse the near-miss.** `successfulLegacySignIns`, not
 *     `legacyAuth`. A name that cannot be confused with the wrong quantity is a
 *     guard that costs nothing to maintain.
 */
export type IdentitySignal = {
  /** When these were measured. The rules refuse to read a stale one — see
   *  `IDENTITY_MAX_AGE_MS`. */
  observedAt: string;
  /** Failed sign-ins inside `windowMs`. NOT a 24-hour total. */
  failedSignIns: { count: number; windowMs: number };
  /** Credentials whose expiry is in the FUTURE and inside `horizonDays`.
   *  Already-expired credentials are deliberately excluded: they are a standing
   *  backlog, and on this tenant they are 19 of the 20 the dashboard counts. */
  credentialsExpiring: { count: number; horizonDays: number };
  /** Legacy-protocol sign-ins that SUCCEEDED. An attempt that was blocked is
   *  the control working, not an incident. */
  successfulLegacySignIns: number;
  /** Accounts Identity Protection currently holds as confirmed compromised. */
  confirmedCompromised: number;
};

/** §7: "> 500 failures in 15 min". Both halves are pinned, because a threshold
 *  without its window is not a threshold. */
export const SPRAY_WINDOW_MS = 15 * 60 * 1000;
export const SPRAY_THRESHOLD = 500;

/** §7: "within 14 days". */
export const SECRETS_HORIZON_DAYS = 14;

/**
 * How old an `IdentitySignal` may be before the rules stop reading it.
 *
 * Three poll intervals. The Entra source polls every fifteen minutes and
 * correlation runs every sixty seconds, so the signal is *expected* to be up to
 * fifteen minutes old on any given tick and that must be entirely normal. Forty-
 * five minutes tolerates one missed poll and refuses two — past that we are
 * reasoning about an estate we have not looked at in three quarters of an hour,
 * and the honest answer is to stop evaluating rather than to answer from
 * memory.
 *
 * Stopping is safe in both directions only because of `evaluatedRules` in
 * `correlate.ts`: a rule that is not evaluated cannot open an incident AND
 * cannot resolve one. Without that, this staleness rule would silently close
 * every identity incident on the first tick after a missed poll.
 */
export const IDENTITY_MAX_AGE_MS = 45 * 60 * 1000;

/** The service the identity rules attach to. Entra IS the `m365` tile — the
 *  contract names it 'Microsoft 365 / Entra ID' — so these land there rather
 *  than on a synthetic id nothing renders. Unlike `blackout`, the four are
 *  genuinely different conditions, so counting them separately on one tile is
 *  information rather than the over-count `platform:` exists to collapse. */
const IDENTITY_SERVICE: ServiceId = 'm365';

export type RuleKey = 'vendor' | 'ourside' | 'blackout' | 'spray' | 'risky' | 'secrets' | 'legacy';

/** One rule firing, before any identity or persistence is attached. Turning
 *  findings into `Incident`s — ids, windows, resolution — is `correlate.ts`. */
export type Finding = {
  ruleKey: RuleKey;
  /** `ServiceId` for `vendor`; `platform:<name>` for `blackout`, which belongs
   *  to no single tile. `Incident.serviceId` is intentionally wider than
   *  `ServiceId` in the contract for exactly this. */
  serviceId: string;
  severity: Severity;
  title: string;
  summary: string;
  metaParts: string[];
  blastRadius: BlastMetric[];
};

/**
 * The registry, keyed by `RuleKey` so a rule cannot exist in the union and not
 * here.
 *
 * **This is a `Record`, not an array, because the array let the two drift.**
 * `RuleKey` gained four members before `RULES` gained four rows, and both `on()`
 * and `severityOf()` did `RULES.find(...)!` — a non-null assertion over a lookup
 * that had just become able to miss. Nothing crashed, because nothing called
 * `on('spray')` yet; the first identity rule wired up without its row would have
 * been a `TypeError` inside the correlation tick, once a minute, forever.
 *
 * `m4-store` found it and named the half I would not have: `rule_state` is a
 * table of **overrides**, and an absent row means "use the rule's own default",
 * which `on()` resolves from here. A `RuleKey` with no entry therefore has no
 * default to fall back to — so the crash sits on the *fallback* path, which is
 * a fresh database or an override the operator deleted. The path nobody clicks.
 *
 * As a `Record<RuleKey, …>` the shape is unrepresentable: a missing key fails
 * the typecheck instead of the tick. Same treatment as `Column<R>`'s
 * `key: keyof R & string` in Wave 1, one domain over, and for the same reason —
 * the failure it prevents is silent.
 */
const REGISTRY: Record<RuleKey, AlertRule & { severity: Severity }> = {
  vendor: {
    key: 'vendor',
    name: 'Vendor degraded and our check failing',
    detail: 'Vendor reports degraded or outage AND at least one of our probes is failing',
    enabled: true,
    severity: 1,
  },
  ourside: {
    key: 'ourside',
    name: 'Our check failing, uncorroborated',
    detail: 'One of our probes is failing and no vendor advisory confirms it',
    enabled: true,
    severity: 2,
  },
  blackout: {
    key: 'blackout',
    name: 'Platform blackout',
    detail: 'Every service on one vendor platform is unknown, and more than one service shares it',
    enabled: true,
    severity: 2,
  },
  spray: {
    key: 'spray',
    name: 'Failed sign-in spike',
    detail: `More than ${SPRAY_THRESHOLD} failed sign-ins inside ${SPRAY_WINDOW_MS / 60_000} minutes`,
    enabled: true,
    severity: 2,
    threshold: { failures: SPRAY_THRESHOLD, windowMinutes: SPRAY_WINDOW_MS / 60_000 },
  },
  risky: {
    key: 'risky',
    name: 'Risky sign-in confirmed compromised',
    detail: 'Identity Protection holds at least one account as confirmed compromised',
    enabled: true,
    severity: 1,
    threshold: { accounts: 1 },
  },
  secrets: {
    key: 'secrets',
    name: 'Secret or certificate expiring',
    detail: `An application credential expires within ${SECRETS_HORIZON_DAYS} days`,
    enabled: true,
    severity: 3,
    threshold: { days: SECRETS_HORIZON_DAYS },
  },
  legacy: {
    key: 'legacy',
    name: 'Successful legacy protocol sign-in',
    detail: 'A sign-in over a legacy authentication protocol SUCCEEDED',
    enabled: true,
    severity: 2,
    threshold: { signIns: 1 },
  },
};

/**
 * The rules, in declaration order.
 *
 * `Object.values` rather than a second hand-written list: repeating the seven
 * keys here would reintroduce exactly the drift the `Record` above just closed,
 * one line further down. String keys enumerate in insertion order, and
 * `rules.test.ts` pins that order as a literal.
 */
export const RULES: ReadonlyArray<AlertRule & { severity: Severity }> = Object.values(REGISTRY);

/* ------------------------------------------------- the identity rules’ gate */

/** Thrown when a caller hands the engine a number measured over the wrong
 *  window. Named, and its own class, so a test can catch it by name rather than
 *  by matching a message that will be reworded one day. */
export class WrongWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrongWindowError';
  }
}

/**
 * Is this signal recent enough to reason from?
 *
 * `undefined` is not stale, it is absent, and both mean the same thing here:
 * do not evaluate. They are separated anyway because a caller debugging "why is
 * my rule quiet" needs to know which.
 */
export function identityIsFresh(identity: IdentitySignal | undefined, at: string): boolean {
  if (identity === undefined) return false;
  const observed = Date.parse(identity.observedAt);
  const now = Date.parse(at);
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return false;
  // A signal from the future is not fresh, it is wrong — a clock we cannot
  // trust is not evidence. One minute of tolerance for ordinary skew.
  if (observed > now + 60_000) return false;
  return now - observed <= IDENTITY_MAX_AGE_MS;
}

/** The rules whose input was present this tick — what `correlate` needs to tell
 *  "looked and found nothing" from "could not look". The three service rules are
 *  always evaluable because `services` is always supplied. */
export function evaluatedRuleKeys(identity: IdentitySignal | undefined, at: string): Set<RuleKey> {
  const keys: RuleKey[] = ['vendor', 'ourside', 'blackout'];
  if (identityIsFresh(identity, at)) keys.push('spray', 'risky', 'secrets', 'legacy');
  return new Set(keys);
}

const severityOf = (key: RuleKey): Severity => REGISTRY[key].severity;

/* --------------------------------------------------------------- the halves */

/**
 * The vendor half. `degraded` or `outage` ONLY.
 *
 * Amendment 1 is the whole content of this function. `unknown` means we could
 * not read the feed — it is the absence of a vendor claim, not a claim of ill
 * health — and four of the seven services sit behind one Statuspage, so
 * accepting `unknown` here turns a single upstream failure into four false
 * Sev1s in one tick. `maintenance` is announced work, which is not an incident.
 *
 * An exhaustive switch with a `never` default: a sixth `StatusLevel` added to
 * the frozen contract fails the typecheck here rather than falling through to
 * a default that decides, silently, whether it opens a Sev1.
 */
export function vendorHalfSatisfied(level: StatusLevel): boolean {
  switch (level) {
    case 'degraded':
    case 'outage':
      return true;
    case 'operational':
    case 'maintenance':
    case 'unknown':
      return false;
    default: {
      const unreachable: never = level;
      throw new Error(`unhandled StatusLevel: ${String(unreachable)}`);
    }
  }
}

/**
 * Our half. Any probe of the service failing counts — Zendesk's two pods are
 * one tile, and one dead pod is our side failing even though the other answers.
 *
 * `total === 0` is NOT failing. A service with no probe configured (m365 in
 * this milestone) has produced no evidence, and no evidence must not
 * manufacture an incident any more than it may render green.
 */
export function ourCheckFailing(ours: { passing: number; total: number }): boolean {
  return ours.total > 0 && ours.passing < ours.total;
}

/* ----------------------------------------------------------------- ourside */

/**
 * Whether we have simply not read this vendor yet, as opposed to having read it.
 *
 * Shared by `ourside` and `blackout` because they ask the same question for the
 * same reason, and because a second copy of this list is exactly the drift this
 * project keeps paying for. See `NOT_BLINDNESS_YET` below for the codes and for
 * the cold start that put them there.
 */
function haveNotReadVendor(s: ServiceSignal): boolean {
  return s.vendor.errorCode !== undefined && NOT_BLINDNESS_YET.has(s.vendor.errorCode);
}

/**
 * Section 7's other Sev2, which the prose states twice and the engine did not
 * implement: *"our checks failing with no vendor advisory is a Sev2 pointing at
 * our own network or credentials"*, and *"a vendor at `unknown` with our check
 * failing is the Sev2 case"*. Both wordings describe one signal — **our probe is
 * red and the vendor does not corroborate it.**
 *
 * It is the `vendor` rule's ladder one rung down, and the rungs are what give
 * each severity its meaning:
 *
 *   vendor says degraded + our probe red   -> Sev1, confirmed, theirs
 *   vendor does not say so + our probe red -> Sev2, unconfirmed, probably ours
 *   vendor says degraded + our probe green -> nothing. An advisory, not an incident.
 *
 * DELIBERATELY NOT SUPPRESSED under a concurrent `blackout`. The two answer
 * different questions and both answers are true: blackout says "you have lost
 * visibility, from one upstream cause", this says "this service is measurably
 * failing and nobody upstream is confirming it". Collapsing them would hide the
 * second, which is the more actionable of the two. The over-count `blackout`
 * exists to prevent is four *identical* unknowns, not two different facts.
 *
 * The summary hedges on purpose. "Points at our own side until proven otherwise"
 * is what section 7 claims and it is the honest strength: during a platform
 * blackout the same upstream event may well have broken both halves, and a rule
 * that asserted "this is your network" would be wrong exactly when it mattered.
 */
function ourSideSuspect(s: ServiceSignal): boolean {
  // `total === 0` is already excluded by `ourCheckFailing` — no probe is no evidence.
  if (!ourCheckFailing(s.ours)) return false;
  // The vendor corroborating it makes it a Sev1 for the `vendor` rule, not this.
  if (vendorHalfSatisfied(s.vendor.level)) return false;
  // COLD START, and it is the same defect as INC-119d4dc7 one rule over. After a
  // restart the store already holds probe history, so `ours` is populated on the
  // first tick while the vendor snapshot is still null. Without this the rule
  // would open a Sev2 on every boot for every service with a red probe, blaming
  // our network for a feed we had not yet asked.
  if (haveNotReadVendor(s)) return false;
  return true;
}

/* ---------------------------------------------------------------- blackout */

/**
 * Whether a service's `unknown` counts toward a platform blackout.
 *
 * JUDGEMENT, and it was a real fork. `statusio` and `msgraph` answer today with
 * `error.code: 'platform_unsupported'` — there is no adapter yet; Milestone 3
 * writes them. Should that count as blindness?
 *
 * The case FOR counting it: from the operator's chair the effect is identical.
 * We cannot see Proofpoint. Why we cannot see it is our problem, not theirs,
 * and a rule that is picky about the reason is a rule that will one day excuse
 * a real blindness because the error code was unfamiliar.
 *
 * The case AGAINST, which is the one implemented: `blackout` is Sev2 because
 * "we have LOST the ability to tell" — it reports a *change*, something that
 * happened and that nobody has been told about. An unsupported platform is a
 * permanent, known, documented state that was true at boot, is written down in
 * `vendors.json`, and will stay true until M3 ships. A rule that fires on every
 * tick from the day it is deployed, for a fact we already know, teaches the
 * operator to close it without reading — which is the precise failure amendment
 * 1 exists to prevent, one rule over. It would also be a *permanent* Sev2 the
 * moment a second statusio vendor is configured.
 *
 * So: an unsupported platform is excluded from the blackout population, and the
 * "more than one" test is applied to what is left. It is not hidden — the tile
 * is still grey and still says why. The day the adapter exists, the code stops
 * being emitted and these services join the population automatically, with no
 * change here.
 */
/**
 * The codes that mean "we have not read this yet", as opposed to "we read it
 * and the read failed". Neither is a LOSS of sight, so neither counts.
 *
 * `never_polled` was found by running the thing. A cold start opened a real
 * Sev2 — `INC-119d4dc7`, 2026-09-20T05:16:45Z — one second before the process
 * finished booting, naming all four statuspage services and resolving itself
 * sixty seconds later on the first successful poll. Its own summary read "we
 * have LOST the ability to tell", which was false: nothing had been lost,
 * nothing had yet been looked at. Every restart minted one, and each one counts
 * against `incidents90d` for ninety days.
 *
 * It is the argument above, applied to the case the argument did not name. The
 * caller in `index.ts` already says the two codes are one thing — "No adapter,
 * or never polled. Both are 'we have not read this'" — and then hands the rule
 * two codes where the rule excluded one. Two halves, each right on its own, and
 * the defect lived in the join. Same shape as the three M3 found; no test could
 * see it because every test constructs its signals already-polled.
 *
 * This is deliberately NOT a general "ignore unfamiliar codes" escape, which the
 * argument above rejects for good reason. It is a closed set of two, and a feed
 * that polled and then broke carries its transport's code, stays in the
 * population, and still fires.
 */
const NOT_BLINDNESS_YET = new Set(['platform_unsupported', 'never_polled']);

function blackoutPopulation(services: readonly ServiceSignal[]): Map<VendorPlatform, ServiceSignal[]> {
  const byPlatform = new Map<VendorPlatform, ServiceSignal[]>();
  for (const s of services) {
    if (haveNotReadVendor(s)) continue;
    const list = byPlatform.get(s.vendor.platform);
    if (list) list.push(s);
    else byPlatform.set(s.vendor.platform, [s]);
  }
  return byPlatform;
}

/* ---------------------------------------------------------------- evaluate */

const nameOf = (s: ServiceSignal) => s.label ?? s.serviceId;

/**
 * Run every enabled rule over the estate and return what fired.
 *
 * `enabled` mirrors the `rule_state` table. A disabled rule produces no finding
 * at all rather than a suppressed one: M1 shipped a fixture where a disabled
 * rule still had an incident attributed to it (H-3), and an incident that
 * exists but should not is worse than one that does not exist.
 */
export function evaluate(
  services: readonly ServiceSignal[],
  enabled: Readonly<Record<string, boolean>> = {},
  /** The identity half. Absent means the four identity rules are not evaluated
   *  — which is NOT the same as finding nothing, and `correlate` is told the
   *  difference via `evaluatedRuleKeys`. An options object so both existing
   *  call sites keep compiling untouched. */
  options: { identity?: IdentitySignal; at?: string } = {},
): Finding[] {
  // No `!`: `REGISTRY` is total over `RuleKey`, so this cannot miss.
  const on = (key: RuleKey) => enabled[key] ?? REGISTRY[key].enabled;
  const findings: Finding[] = [];

  if (on('vendor')) {
    for (const s of services) {
      if (!vendorHalfSatisfied(s.vendor.level) || !ourCheckFailing(s.ours)) continue;
      const failing = s.ours.total - s.ours.passing;
      findings.push({
        ruleKey: 'vendor',
        serviceId: s.serviceId,
        severity: severityOf('vendor'),
        title: `${nameOf(s)} ${s.vendor.level === 'outage' ? 'outage' : 'degraded'} — confirmed by our own checks`,
        summary:
          `${nameOf(s)} reports ${s.vendor.level} on its ${s.vendor.platform} feed, and ${failing} of ` +
          `${s.ours.total} of our own probes ${failing === 1 ? 'is' : 'are'} failing. Both halves of the ` +
          `rule are satisfied, so this is a confirmed vendor-side incident rather than an advisory or a ` +
          `problem on our side.`,
        metaParts: [`Sev 1`, nameOf(s), `Vendor ${s.vendor.level}`, `${s.ours.passing}/${s.ours.total} probes passing`],
        blastRadius: [
          {
            label: 'Probes failing',
            value: `${failing} of ${s.ours.total}`,
            note: `synthetic checks for ${nameOf(s)}`,
            level: 'error',
          },
          {
            label: 'Vendor status',
            value: s.vendor.level,
            note: `as published on the ${s.vendor.platform} feed`,
            level: s.vendor.level === 'outage' ? 'error' : 'warning',
          },
        ],
      });
    }
  }

  if (on('ourside')) {
    for (const s of services) {
      if (!ourSideSuspect(s)) continue;
      const failing = s.ours.total - s.ours.passing;
      const vendorPhrase =
        s.vendor.level === 'unknown'
          ? `we cannot read ${nameOf(s)}'s ${s.vendor.platform} feed`
          : `${nameOf(s)} reports ${s.vendor.level} on its ${s.vendor.platform} feed`;
      findings.push({
        ruleKey: 'ourside',
        serviceId: s.serviceId,
        severity: severityOf('ourside'),
        title: `${nameOf(s)} — our checks failing, no vendor advisory`,
        summary:
          `${failing} of ${s.ours.total} of our own probes for ${nameOf(s)} ${failing === 1 ? 'is' : 'are'} ` +
          `failing, and ${vendorPhrase}. Nothing upstream corroborates the failure, which points at our own ` +
          `network, DNS or credentials until proven otherwise. It is a Sev2 rather than a Sev1 because only ` +
          `one half of the evidence is in.`,
        metaParts: [
          `Sev 2`,
          nameOf(s),
          s.vendor.level === 'unknown' ? 'Vendor unreadable' : `Vendor ${s.vendor.level}`,
          `${s.ours.passing}/${s.ours.total} probes passing`,
        ],
        blastRadius: [
          {
            label: 'Probes failing',
            value: `${failing} of ${s.ours.total}`,
            note: `synthetic checks for ${nameOf(s)}`,
            level: 'error',
          },
          {
            label: 'Vendor corroboration',
            value: s.vendor.level === 'unknown' ? 'Unreadable' : 'None',
            note: `${s.vendor.platform} reports ${s.vendor.level}`,
            level: 'warning',
          },
        ],
      });
    }
  }

  if (on('blackout')) {
    for (const [platform, group] of blackoutPopulation(services)) {
      // "more than one", per section 7: a lone unknown tile is an unknown tile.
      if (group.length < 2) continue;
      if (!group.every((s) => s.vendor.level === 'unknown')) continue;
      const names = group.map(nameOf).join(', ');
      findings.push({
        ruleKey: 'blackout',
        serviceId: `platform:${platform}`,
        severity: severityOf('blackout'),
        title: `Lost sight of every vendor on ${platform}`,
        summary:
          `All ${group.length} services behind the ${platform} platform (${names}) are reporting unknown at ` +
          `the same time. Nothing is known to be broken — we have lost the ability to tell, which is a ` +
          `single upstream failure rather than ${group.length} independent ones. Their tiles are grey, not green.`,
        metaParts: [`Sev 2`, platform, `${group.length} vendors blind`],
        blastRadius: [
          {
            label: 'Vendors blind',
            value: String(group.length),
            note: `every service on ${platform}: ${names}`,
            level: 'error',
          },
        ],
      });
    }
  }

  /* ------------------------------------------------------ the identity rules */

  // Evaluated only when we have a signal we are willing to reason from. A stale
  // one is not evidence, and answering from a 45-minute-old estate is the same
  // mistake as answering from a 24-hour count.
  const at = options.at;
  const identity = options.identity;
  if (identity !== undefined && at !== undefined && identityIsFresh(identity, at)) {
    const seenAt = identity.observedAt;

    if (on('spray')) {
      // The window assertion, and it THROWS rather than declining. A rule that
      // quietly stops firing when handed the wrong quantity is indistinguishable
      // from a rule that is broken — and the wrong quantity here is the 24-hour
      // count sitting in `EntraSnapshot`, which is 4535 on an ordinary day and
      // would hold this Sev2 open forever. Same precedent as `parseSeverity`:
      // our own bug is thrown, never defaulted.
      if (identity.failedSignIns.windowMs !== SPRAY_WINDOW_MS) {
        throw new WrongWindowError(
          `spray needs failures over ${SPRAY_WINDOW_MS / 60_000} minutes and was given a count over ` +
            `${Math.round(identity.failedSignIns.windowMs / 60_000)}; a 24-hour total answers a different question ` +
            `and would fire permanently`,
        );
      }
      const { count } = identity.failedSignIns;
      if (count > SPRAY_THRESHOLD) {
        findings.push({
          ruleKey: 'spray',
          serviceId: IDENTITY_SERVICE,
          severity: severityOf('spray'),
          title: `Failed sign-in spike — ${count} in ${SPRAY_WINDOW_MS / 60_000} minutes`,
          summary:
            `${count} sign-ins failed in the last ${SPRAY_WINDOW_MS / 60_000} minutes, against a threshold of ` +
            `${SPRAY_THRESHOLD}. A rate this far above normal is a password spray or a credential-stuffing run ` +
            `rather than people mistyping. The count is a real fifteen-minute window, not a daily total divided ` +
            `down, so it reflects what is happening now.`,
          metaParts: [`Sev 2`, 'Entra ID', `${count} failures / ${SPRAY_WINDOW_MS / 60_000} min`],
          blastRadius: [
            { label: 'Failed sign-ins', value: String(count), note: `in the ${SPRAY_WINDOW_MS / 60_000} minutes to ${seenAt}`, level: 'error' },
            { label: 'Threshold', value: `${SPRAY_THRESHOLD}`, note: 'DATA_CONTRACTS section 7', level: 'warning' },
          ],
        });
      }
    }

    if (on('risky') && identity.confirmedCompromised > 0) {
      const n = identity.confirmedCompromised;
      findings.push({
        ruleKey: 'risky',
        serviceId: IDENTITY_SERVICE,
        severity: severityOf('risky'),
        title: `${n} account${n === 1 ? '' : 's'} confirmed compromised`,
        summary:
          `Identity Protection holds ${n} account${n === 1 ? '' : 's'} at riskState confirmedCompromised. That is ` +
          `not a risk score or a suspicion — it is a compromise somebody or something has already confirmed, and ` +
          `it stays true until the account is remediated and the risk state dismissed.`,
        metaParts: [`Sev 1`, 'Entra ID', `${n} confirmed`],
        blastRadius: [
          { label: 'Accounts', value: String(n), note: 'riskState confirmedCompromised', level: 'error' },
        ],
      });
    }

    if (on('secrets')) {
      if (identity.credentialsExpiring.horizonDays !== SECRETS_HORIZON_DAYS) {
        throw new WrongWindowError(
          `secrets needs credentials expiring within ${SECRETS_HORIZON_DAYS} days and was given a ` +
            `${identity.credentialsExpiring.horizonDays}-day horizon; a wider one, or one that counts credentials ` +
            `that have ALREADY expired, would fire permanently`,
        );
      }
      const n = identity.credentialsExpiring.count;
      if (n > 0) {
        findings.push({
          ruleKey: 'secrets',
          serviceId: IDENTITY_SERVICE,
          severity: severityOf('secrets'),
          title: `${n} application credential${n === 1 ? '' : 's'} expire${n === 1 ? 's' : ''} within ${SECRETS_HORIZON_DAYS} days`,
          summary:
            `${n} app registration secret${n === 1 ? ' or certificate' : 's or certificates'} will expire inside ` +
            `${SECRETS_HORIZON_DAYS} days. This counts only credentials still in the future: already-expired ones ` +
            `are a standing backlog rather than something about to break, and folding them in would leave this ` +
            `alert permanently on.`,
          metaParts: [`Sev 3`, 'Entra ID', `${n} expiring`],
          blastRadius: [
            { label: 'Credentials', value: String(n), note: `expiring within ${SECRETS_HORIZON_DAYS} days`, level: 'warning' },
          ],
        });
      }
    }

    if (on('legacy') && identity.successfulLegacySignIns > 0) {
      const n = identity.successfulLegacySignIns;
      findings.push({
        ruleKey: 'legacy',
        serviceId: IDENTITY_SERVICE,
        severity: severityOf('legacy'),
        title: `${n} legacy-protocol sign-in${n === 1 ? '' : 's'} SUCCEEDED`,
        summary:
          `${n} sign-in${n === 1 ? '' : 's'} over a legacy authentication protocol succeeded. Legacy protocols ` +
          `cannot carry multi-factor authentication, so a success is a password alone getting through. Blocked ` +
          `attempts are deliberately NOT counted here — those are the control working, and counting them would ` +
          `make this alert permanent.`,
        metaParts: [`Sev 2`, 'Entra ID', `${n} succeeded`],
        blastRadius: [
          { label: 'Successful sign-ins', value: String(n), note: 'over a legacy protocol, no MFA possible', level: 'error' },
        ],
      });
    }
  }

  return findings;
}
