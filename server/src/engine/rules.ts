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

export type RuleKey = 'vendor' | 'ourside' | 'blackout';

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

export const RULES: ReadonlyArray<AlertRule & { severity: Severity }> = [
  {
    key: 'vendor',
    name: 'Vendor degraded and our check failing',
    detail: 'Vendor reports degraded or outage AND at least one of our probes is failing',
    enabled: true,
    severity: 1,
  },
  {
    key: 'ourside',
    name: 'Our check failing, uncorroborated',
    detail: 'One of our probes is failing and no vendor advisory confirms it',
    enabled: true,
    severity: 2,
  },
  {
    key: 'blackout',
    name: 'Platform blackout',
    detail: 'Every service on one vendor platform is unknown, and more than one service shares it',
    enabled: true,
    severity: 2,
  },
];

const severityOf = (key: RuleKey): Severity => RULES.find((r) => r.key === key)!.severity;

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
): Finding[] {
  const on = (key: RuleKey) => enabled[key] ?? RULES.find((r) => r.key === key)!.enabled;
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

  return findings;
}
