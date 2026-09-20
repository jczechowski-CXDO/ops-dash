import { createHash } from 'node:crypto';
import type { Incident, Severity, TimelineEntry } from '@ops-dash/shared';
import { evaluate, type Finding, type ServiceSignal } from './rules.js';

/**
 * Findings -> `Incident[]`, with identity and resolution.
 *
 * The engine is **pure**: it takes state and returns incidents. It does not
 * fetch, does not schedule and does not write. The caller reads the store,
 * calls this, and upserts what comes back — which is what lets every rule and
 * every lifecycle transition be tested without a database or a clock.
 *
 * `at` is a parameter for the same reason: a `Date.now()` in here would make
 * every window test depend on when it ran.
 */

/** How long a cleared incident keeps its identity.
 *
 *  Inside it, a recurrence REOPENS the same incident — a vendor flapping every
 *  90 seconds must not manufacture forty incidents in an hour, each one needing
 *  its own ack. Outside it, a recurrence is genuinely a new incident, and
 *  folding it into the old one would hide it behind the old one's ack. */
export const WINDOW_MS = 30 * 60 * 1000;

export type CorrelateInput = {
  /** The instant being correlated, ISO 8601. Injected, never read from the clock. */
  at: string;
  services: readonly ServiceSignal[];
  /** Incidents already in the store for these rules — open ones, and recently
   *  resolved ones still inside their window. Anything older can be left out;
   *  it cannot affect the result. */
  open?: readonly Incident[];
  /** The `rule_state` table. Absent keys fall back to the rule's own default. */
  enabledRules?: Readonly<Record<string, boolean>>;
  windowMs?: number;
  /**
   * The rules whose input was actually present this tick.
   *
   * **Not the rules that FIRED.** The rules we were able to look at. A rule that
   * ran and found nothing is in this set; a rule whose input was stale or
   * missing is not. The distinction is the whole reason the field exists and it
   * is the one a reader will get wrong, so the name says `evaluated` rather than
   * anything that could be read as `firing`.
   *
   * **Why it has to exist.** The resolution loop below closes any open incident
   * that is not firing — which is right when a rule looked and found the
   * condition gone, and a lie when the rule could not look at all. Those two are
   * indistinguishable from `findings` alone, because both produce no finding.
   *
   * It is the same defect as the phantom cold-start Sev2 and the `never_polled`
   * blackout, arriving from the opposite side: there, absent data manufactured
   * an incident; here, absent data destroys one. This direction is worse,
   * because resolving writes a timeline entry that says *the condition cleared*
   * in so many words. It did not. We stopped looking. An operator reading that
   * entry has been told something false by name.
   *
   * Absent means everything was evaluated, so every existing caller keeps
   * today's behaviour exactly.
   *
   * One consequence, decided rather than stumbled into: if a caller passes a set
   * that omits a rule which has been **retired**, that rule's open incidents are
   * carried forever, because nothing can ever fire them again and nothing here
   * will close them. That is deliberate — an incident outliving its rule wants a
   * human, not an automatic claim that it cleared — and `correlate.test.ts` pins
   * it so the next person meets a test rather than a mystery.
   */
  evaluatedRules?: ReadonlySet<string>;
};

const identity = (ruleKey: string, serviceId: string) => `${ruleKey}\u0000${serviceId}`;

/**
 * The incident id: a hash of rule + service + window start, and **nothing
 * else**.
 *
 * No timestamp of the current poll, no counter, no random. The id has to be
 * reproducible from the condition alone, because an ack is recorded against an
 * id and the next tick sixty seconds later must land on the same row. An id
 * that carried `at` would orphan every ack the moment it was recorded.
 */
function incidentId(ruleKey: string, serviceId: string, windowStart: number): string {
  const digest = createHash('sha256').update(`${ruleKey}\u0000${serviceId}\u0000${windowStart}`).digest('hex');
  return `INC-${digest.slice(0, 8)}`;
}

/** Window starts are bucketed, so two correlations of the same condition a
 *  minute apart agree on the id even when the caller has NO stored state —
 *  after a restart, say, before the first read of the incidents table. */
const bucketStart = (at: string, windowMs: number) => Math.floor(Date.parse(at) / windowMs) * windowMs;

const entry = (kind: TimelineEntry['kind'], at: string, title: string, body: string): TimelineEntry => ({
  at,
  kind,
  title,
  body,
});

/** Does `prior` still own this condition's identity at `at`? */
function stillOwns(prior: Incident, at: string, windowMs: number): boolean {
  // An OPEN incident keeps its id for as long as it is open, however long that
  // is. Bucketing alone would hand a two-hour outage a new id halfway through
  // and orphan the ack recorded in its first minute.
  if (!prior.resolvedAt) return true;
  return Date.parse(at) - Date.parse(prior.resolvedAt) <= windowMs;
}

export function correlate(input: CorrelateInput): Incident[] {
  const { at, services, open = [], enabledRules, windowMs = WINDOW_MS, evaluatedRules } = input;
  const findings = evaluate(services, enabledRules);

  // Most recent prior per rule+service. A store that somehow holds two is not
  // a reason to open a third.
  const priors = new Map<string, Incident>();
  for (const prior of open) {
    const k = identity(prior.ruleKey, prior.serviceId);
    const seen = priors.get(k);
    if (!seen || seen.openedAt < prior.openedAt) priors.set(k, prior);
  }

  const out: Incident[] = [];
  const firing = new Set<string>();

  for (const finding of findings) {
    const k = identity(finding.ruleKey, finding.serviceId);
    firing.add(k);
    const prior = priors.get(k);
    out.push(prior && stillOwns(prior, at, windowMs) ? carryForward(prior, finding, at) : openNew(finding, at, windowMs));
  }

  for (const [k, prior] of priors) {
    if (firing.has(k)) continue;
    // Already resolved and still clear: nothing changed, so nothing to write.
    if (prior.resolvedAt) continue;
    // We could not look. Carry it untouched rather than claiming it cleared —
    // see `evaluatedRules`. Not firing closes an incident; not looking must not.
    if (evaluatedRules !== undefined && !evaluatedRules.has(prior.ruleKey)) continue;
    out.push(resolved(prior, at));
  }

  return out;
}

function openNew(finding: Finding, at: string, windowMs: number): Incident {
  return {
    id: incidentId(finding.ruleKey, finding.serviceId, bucketStart(at, windowMs)),
    severity: finding.severity,
    title: finding.title,
    serviceId: finding.serviceId,
    openedAt: at,
    summary: finding.summary,
    metaParts: finding.metaParts,
    ruleKey: finding.ruleKey,
    blastRadius: finding.blastRadius,
    timeline: [entry('opened', at, 'Correlation rule fired', finding.summary)],
  };
}

/**
 * The condition is still true and we already had an incident for it.
 *
 * Identity, `openedAt`, ack and mute are carried across untouched — that is the
 * entire point. The *description* is refreshed, because a vendor can move from
 * degraded to outage while the incident stays the same incident. No timeline
 * entry is appended on an unchanged tick: sixty ticks an hour of "still true"
 * would bury the three entries that mean something.
 */
function carryForward(prior: Incident, finding: Finding, at: string): Incident {
  const { resolvedAt, ...rest } = prior;
  const recurred = resolvedAt !== undefined;
  return {
    ...rest,
    severity: finding.severity,
    title: finding.title,
    summary: finding.summary,
    metaParts: finding.metaParts,
    blastRadius: finding.blastRadius,
    timeline: recurred
      ? [
          entry(
            'detected',
            at,
            'Condition recurred',
            `The same condition returned within ${Math.round(WINDOW_MS / 60000)} minutes of resolving, so this ` +
              `incident was reopened rather than a second one raised.`,
          ),
          ...prior.timeline,
        ]
      : prior.timeline,
  };
}

function resolved(prior: Incident, at: string): Incident {
  return {
    ...prior,
    resolvedAt: at,
    timeline: [
      entry('resolved', at, 'Condition cleared', 'The rule that opened this incident no longer fires.'),
      ...prior.timeline,
    ],
  };
}

/* ------------------------------------------------------------ severity <-> TEXT */

/**
 * `Severity` is `1 | 2 | 3 | 'info'` and the store's column is TEXT, so it has
 * to be written as a string — and it must be written through here.
 *
 * Measured on Node v24.21.0: `node:sqlite` binds a JS number as REAL, and TEXT
 * affinity renders that `"1.0"`, not `"1"`. A severity handed straight to the
 * store comes back as a string that matches nothing and parses as a float. So
 * the engine and the store agree on exactly one representation: the decimal
 * digit, or the word. `parseSeverity` still accepts `"1.0"`, because rows
 * written before anyone noticed are already out there.
 */
export function serializeSeverity(severity: Severity): string {
  return String(severity);
}

export function parseSeverity(raw: string): Severity {
  const value = raw.trim();
  if (value === 'info') return 'info';
  const n = Number(value);
  if (value !== '' && Number.isInteger(n)) {
    if (n === 1) return 1;
    if (n === 2) return 2;
    if (n === 3) return 3;
  }
  // Throws rather than defaulting. A severity we cannot read is not 'info' and
  // is certainly not 3 — guessing here would silently downgrade a Sev1.
  throw new Error(`not a Severity: ${JSON.stringify(raw)}`);
}

/** The row shape `store.putIncident` takes. Here rather than at the call site
 *  so that severity cannot reach the database without passing the codec, and
 *  so an absent `resolvedAt` becomes SQL NULL rather than the string
 *  "undefined". */
export function toStoreRow(incident: Incident): {
  id: string;
  ruleKey: string;
  serviceId: string;
  severity: string;
  openedAt: string;
  resolvedAt: string | null;
  summary: string;
} {
  return {
    id: incident.id,
    ruleKey: incident.ruleKey,
    serviceId: incident.serviceId,
    severity: serializeSeverity(incident.severity),
    openedAt: incident.openedAt,
    resolvedAt: incident.resolvedAt ?? null,
    summary: incident.summary,
  };
}
