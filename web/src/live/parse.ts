import type { AuditEvent, BlastMetric, CheckRun, EndpointIssue, EndpointSnapshot, EntraSignal, EntraSnapshot, ServiceId, Severity, StatusLevel } from '@ops-dash/shared';
import { SERVICE_NAMES, serviceLabel } from '../lib/serviceNames.js';
import { firstSentence, type IncidentView, type Load, type ServiceView } from './model.js';

/**
 * Everything arriving from `/api/*` is parsed, never cast.
 *
 * It is our own API on our own box, which is exactly the argument that talked
 * previous versions of this repo into `as` — and `store/currentLevel.ts`
 * refuses it one layer down for the same reason it is refused here: a
 * half-written row, an older build, a schema change or a field that has moved
 * all arrive as a perfectly well-formed HTTP 200. A cast lets `level: "ok"`
 * through to `statusColor`, which does a lookup, gets `undefined`, and paints
 * nothing — an unknown state rendered as no state at all.
 *
 * Two rules, applied field by field:
 *
 *   1. **Unreadable is `unknown`, never green.** An absent or unrecognised
 *      level is `unknown`; there is no default that affirms health.
 *   2. **Unreadable is `null`, never zero.** An absent or non-numeric
 *      measurement is absent. A number that IS zero is kept, because 0 ms and
 *      0% are real readings.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

const bad = (message: string): Parsed<never> => ({ ok: false, error: { code: 'bad_payload', message } });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Finite numbers only. `NaN` and `Infinity` survive `typeof === 'number'` and
 *  would render as "NaN ms", which reads as a bug rather than as no data. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The frozen union, validated rather than asserted. Mirrors
 *  `server/src/store/currentLevel.ts`'s `isStatusLevel` — a separate workspace,
 *  so a shared import is not available; `parse.test.ts` pins every member. */
export function isStatusLevel(v: unknown): v is StatusLevel {
  return (
    v === 'operational' || v === 'degraded' || v === 'outage' || v === 'maintenance' || v === 'unknown'
  );
}

/** Anything we cannot read is `unknown`. There is no path here that returns
 *  `operational` for a value we did not recognise. */
const level = (v: unknown): StatusLevel => (isStatusLevel(v) ? v : 'unknown');

/** The display word for a level. The server has `labelFor`; this is the web's
 *  copy because the two workspaces share only the contract, and the contract
 *  states the five words in a comment rather than in code. Pinned literally in
 *  `parse.test.ts` against all five members. */
const LEVEL_LABEL: Record<StatusLevel, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
  maintenance: 'Maintenance',
  unknown: 'Unknown',
};

export function levelLabel(l: StatusLevel): string {
  return LEVEL_LABEL[l];
}

function errorOf(v: unknown): { code: string; message: string } | null {
  if (!isRecord(v)) return null;
  const code = str(v['code']);
  const message = str(v['message']);
  return code === null && message === null
    ? null
    : { code: code ?? 'unknown', message: message ?? 'no reason given' };
}

/* ------------------------------------------------------------- /api/services */

/**
 * One entry.
 *
 * The colour-bearing field is `currentLevel` and ONLY `currentLevel`.
 * `result.data.level` is the level the vendor published the last time we could
 * read them, which on a degraded snapshot is hours old — the server computes
 * `currentLevel` precisely so this side does not have to remember that, and
 * reading `data.level` here would undo the whole of `store/currentLevel.ts`.
 * It IS read, once, into `feed.data` — the past tense, rendered as the past
 * tense.
 */
export function serviceEntryView(raw: unknown): ServiceView | null {
  if (!isRecord(raw)) return null;
  const id = str(raw['id']);
  if (id === null) return null;

  const result = isRecord(raw['result']) ? raw['result'] : {};
  const data = isRecord(result['data']) ? result['data'] : null;
  const feedError = errorOf(result['error']);
  const fetchedAt = str(result['fetchedAt']);

  // The safe reading. Absent `currentLevel` is `unknown`: an API that did not
  // say must not be read as one that said "fine".
  const current = level(raw['currentLevel']);

  const feed: Load<{ level: StatusLevel; label: string }> = {
    ...(data === null ? {} : { data: { level: level(data['level']), label: LEVEL_LABEL[level(data['level'])] } }),
    ...(fetchedAt === null ? {} : { servedAt: fetchedAt }),
    ...(feedError === null ? {} : { error: feedError }),
  };

  const ours = isRecord(raw['ours']) ? raw['ours'] : {};
  const oursLevel = level(ours['level']);
  const known = Object.hasOwn(SERVICE_NAMES, id);

  // `lastSuccessfulPoll` is the vendor half's provenance line, and the honest
  // definition of it on the wire is: the snapshot carries a payload, so some
  // poll succeeded, and `fetchedAt` is when. A snapshot with no payload has
  // never succeeded and the field stays absent — which is exactly the
  // distinction ServiceDetail's `vendorProvenance` branches on.
  const lastSuccessfulPoll = data === null ? null : fetchedAt;
  const inferredBasis = isRecord(raw['inferred']) ? str(raw['inferred']['basis']) : null;

  return {
    id,
    short: known ? SERVICE_NAMES[id as keyof typeof SERVICE_NAMES].short : id,
    name: known ? SERVICE_NAMES[id as keyof typeof SERVICE_NAMES].name : serviceLabel(id),
    vendor: {
      level: current,
      label: LEVEL_LABEL[current],
      // The vendor's own prose where we have it; the failure's message where we
      // do not. Never a sentence composed here about health.
      note:
        str(data?.['note']) ??
        feedError?.message ??
        'No poll of this vendor has been recorded.',
      ...(lastSuccessfulPoll === null ? {} : { lastSuccessfulPoll }),
      // Amendment 10. When the level was derived from OUR checks rather than
      // published by the vendor, the screen has to say so: a green the operator
      // believes the vendor affirmed, when it was really our two probes, is a
      // worse lie than the grey it replaced.
      ...(inferredBasis === null ? {} : { inferred: { basis: inferredBasis } }),
    },
    ours: {
      level: oursLevel,
      label: str(ours['label']) ?? LEVEL_LABEL[oursLevel],
      note: str(ours['note']) ?? 'Our probe history could not be read.',
      passing: num(ours['passing']) ?? 0,
      total: num(ours['total']) ?? 0,
    },
    latencyMs: num(raw['latencyMs']),
    p50Ms: num(raw['p50Ms']),
    p95Ms: num(raw['p95Ms']),
    spark: Array.isArray(raw['spark']) ? raw['spark'].map(num) : null,
    uptime30d: num(raw['uptime30d']),
    uptimeFrom: str(raw['uptimeFrom']),
    uptimeSamples: num(raw['uptimeSamples']) ?? 0,
    incidents90d: num(raw['incidents90d']),
    lastStateChange: str(raw['lastStateChange']),
    ...(errorOf(raw['metricsError']) === null
      ? {}
      : { metricsError: errorOf(raw['metricsError']) as { code: string; message: string } }),
    feed,
  };
}

export function parseServices(json: unknown): Parsed<{ servedAt: string; services: ServiceView[] }> {
  if (!isRecord(json)) return bad('the response was not an object');
  const servedAt = str(json['servedAt']);
  const list = json['services'];
  if (servedAt === null) return bad('the response carried no servedAt');
  if (!Array.isArray(list)) return bad('the response carried no services array');
  const services: ServiceView[] = [];
  for (const entry of list) {
    const view = serviceEntryView(entry);
    // An entry with no id cannot be labelled, linked or looked up. Refusing the
    // whole response is louder than serving six of seven tiles and letting the
    // seventh vanish, which looks exactly like a service nobody monitors.
    if (view === null) return bad('a service entry could not be read');
    services.push(view);
  }
  return { ok: true, value: { servedAt, services } };
}

/* ------------------------------------------------------------ /api/incidents */

const SEVERITY_META: Record<Severity, string> = { 1: 'Sev 1', 2: 'Sev 2', 3: 'Sev 3', info: 'Info' };

/** Severity is `1 | 2 | 3 | 'info'` and arrives as JSON, so a string '2' is
 *  possible. Anything unreadable becomes **1**, matching the server's own
 *  `decodeSeverity`: this codebase never renders a thing it cannot see as
 *  benign. */
export function decodeSeverity(v: unknown): Severity {
  if (v === 'info') return 'info';
  const n = typeof v === 'number' ? v : Number(v);
  return n === 1 || n === 2 || n === 3 ? (n as Severity) : 1;
}

/**
 * An `ApiIncident` as the `Incident` the two screens render.
 *
 * Four of the frozen contract's fields are NOT served, because the `incidents`
 * table has no column for them — the engine computes `title`, `metaParts`,
 * `blastRadius` and `timeline` and the store keeps only the summary. So:
 *
 *   - `title` is the summary's first sentence, truncated served text
 *   - `metaParts` is assembled from fields that ARE served, each one a fact
 *     off the wire rather than prose
 *   - `blastRadius` and `timeline` are EMPTY, and both screens have a designed
 *     empty state that says so. An empty timeline is not "nothing happened".
 */
/**
 * The operator's own actions, hydrated onto an incident by `/api/incidents`.
 *
 * **These were being dropped silently.** `Overview.tsx` dims an acknowledged
 * row, credits it to `incident.ack.by`, and disables its Acknowledge button;
 * `IncidentDetail.tsx` reads `incident.ack` for the same reason. None of that
 * could ever fire on the live path, because this parser built an `Incident`
 * without the two fields — so an incident somebody had acknowledged rendered as
 * untouched, with the button still inviting them to do it again.
 *
 * It was not a defect when this file was written: nothing served the fields.
 * It became one the moment `/api/incidents` started hydrating them, which is
 * the shape `RESUME.md` describes as two correct halves diverging when a
 * premise moves underneath one of them.
 *
 * Both are refused rather than half-built: an `ack` with no `by` cannot be
 * credited to anybody, and inventing a name for it would put a person's name
 * on an action they may not have taken. An absent field is absent, never an
 * empty object — `{...incident}` has to keep working.
 */
function ackOf(v: unknown): { by: string; at: string } | null {
  if (!isRecord(v)) return null;
  const by = str(v['by']);
  const at = str(v['at']);
  return by === null || at === null ? null : { by, at };
}

/**
 * `until` is `string | null` in the contract and **`null` is load-bearing**: it
 * means muted indefinitely, which is a different fact from a mute that expires
 * at a time we could not read. So an absent key and an explicit `null` both
 * become `null` — the server normalises to `null` for indefinite and the
 * contract has no third state — while a non-string, non-null value refuses the
 * whole flag rather than silently becoming "forever".
 */
function mutedOf(v: unknown): { by: string; until: string | null } | null {
  if (!isRecord(v)) return null;
  const by = str(v['by']);
  if (by === null) return null;
  const raw = v['until'];
  if (raw === undefined || raw === null) return { by, until: null };
  const until = str(raw);
  return until === null ? null : { by, until };
}

export function incidentView(raw: unknown): IncidentView | null {
  if (!isRecord(raw)) return null;
  const id = str(raw['id']);
  const summary = str(raw['summary']);
  const openedAt = str(raw['openedAt']);
  const serviceId = str(raw['serviceId']);
  if (id === null || summary === null || openedAt === null || serviceId === null) return null;
  const severity = decodeSeverity(raw['severity']);
  const ruleKey = str(raw['ruleKey']) ?? 'unknown';
  const resolvedAt = str(raw['resolvedAt']);
  const severityRaw = str(raw['severityRaw']);
  const blastRadius: BlastMetric[] = [];
  const ack = ackOf(raw['ack']);
  const muted = mutedOf(raw['muted']);

  return {
    id,
    severity,
    title: firstSentence(summary),
    serviceId,
    openedAt,
    ...(resolvedAt === null ? {} : { resolvedAt }),
    summary,
    metaParts: [
      SEVERITY_META[severity],
      serviceLabel(serviceId),
      `Rule ${ruleKey}`,
      // The server sets `severityRaw` only when it could not decode the stored
      // severity and the value above is a fallback. Invisible, it is a guess
      // with better manners — so it is said out loud.
      ...(severityRaw === null ? [] : [`severity unreadable (${severityRaw}), shown as Sev 1`]),
    ],
    ruleKey,
    blastRadius,
    timeline: [],
    ...(ack === null ? {} : { ack }),
    ...(muted === null ? {} : { muted }),
  };
}

/**
 * The incidents list, and the envelope's own failure ALONGSIDE it.
 *
 * Amendment 9 one last time, and this is the place it is easiest to get wrong:
 * `/api/incidents` can return a list AND an error, and the obvious code — fail
 * on `error`, succeed otherwise — throws away a perfectly good last-known list
 * on the first bad tick. So a parsed list and a parsed error are returned
 * together and the caller renders stale-with-data. Only a payload that is not
 * a list at all is a parse failure.
 */
export function parseIncidents(
  json: unknown,
): Parsed<{ servedAt: string; incidents: IncidentView[]; error?: { code: string; message: string } }> {
  if (!isRecord(json)) return bad('the response was not an object');
  const servedAt = str(json['servedAt']);
  if (servedAt === null) return bad('the response carried no servedAt');
  const result = isRecord(json['result']) ? json['result'] : null;
  if (result === null) return bad('the response carried no result envelope');
  const resultError = errorOf(result['error']);
  const list = result['data'];
  if (!Array.isArray(list)) {
    // No list and no explanation is a malformed response; no list WITH an
    // explanation is the store failing, reported in its own words.
    return resultError === null ? bad('the result carried no data array') : { ok: false, error: resultError };
  }
  const incidents: IncidentView[] = [];
  for (const entry of list) {
    const view = incidentView(entry);
    if (view === null) return bad('an incident could not be read');
    incidents.push(view);
  }
  return { ok: true, value: { servedAt, incidents, ...(resultError === null ? {} : { error: resultError }) } };
}

/* --------------------------------------------------------------- /api/checks */

/**
 * The individual runs behind a service's counts.
 *
 * `/api/checks?service=<id>` is the one route that answers with a bare
 * `SourceResult` — no `{ servedAt, … }` wrapper — so `fetchedAt` is the age a
 * stale badge reports and it is required: a table of numbers with no idea how
 * old they are is the panel this milestone exists to remove.
 *
 * The three answers the route can give stay three answers here:
 *
 *   `data` (possibly `[]`, with `empty: true`)  we looked; here is what there is
 *   `error` with no `data`                      we could NOT look
 *   both                                        the last good rows, stale
 *
 * The second and third are the reason this is not `runs ?? []`. Five of the
 * seven services genuinely have no probe today, so an empty table is the COMMON
 * reading and must not be painted as a failure — and a store that could not be
 * read must not be painted as "there are none".
 */

/** A `Record` over the union rather than an array of three strings, for the
 *  reason `SERVICE_NAMES` is one: a fourth result in the frozen contract stops
 *  this compiling, where an array would go on quietly refusing the new member
 *  as unreadable. */
const RESULTS: Record<CheckRun['result'], true> = { pass: true, fail: true, timeout: true };

function isRunResult(v: unknown): v is CheckRun['result'] {
  return typeof v === 'string' && Object.hasOwn(RESULTS, v);
}

/**
 * One row, validated field by field.
 *
 * `result` is the field that decides a colour, so an unrecognised value is
 * refused rather than defaulted: `pass` would paint a run we cannot read green,
 * and `fail` would invent a failure the store never recorded. Refusing the read
 * is the only answer that is not a claim about the probe.
 *
 * `latencyMs` is `null` for anything non-numeric, which is what a timeout
 * serves. Never 0 — a zero renders as the fastest probe ever recorded.
 */
export function checkRunView(raw: unknown, serviceId: ServiceId): CheckRun | null {
  if (!isRecord(raw)) return null;
  const rowService = str(raw['serviceId']);
  // A row belonging to another service would be another service's probe on this
  // page, attributed to this one. The query is bound to one id; a response
  // carrying a different one is a defect somewhere and not a table to render.
  if (rowService === null || rowService !== serviceId) return null;
  const at = str(raw['at']);
  const check = str(raw['check']);
  const region = str(raw['region']);
  const result = raw['result'];
  if (at === null || check === null || region === null || !isRunResult(result)) return null;
  // `serviceId` is the id we ASKED for — already a member of the frozen union
  // — carried across having checked that the row agrees with it. The
  // alternative is a cast on a string that arrived over the wire.
  return { serviceId, at, check, region, result, latencyMs: num(raw['latencyMs']) };
}

export function parseChecks(
  json: unknown,
  serviceId: ServiceId,
): Parsed<{ servedAt: string; value: CheckRun[]; error?: { code: string; message: string } }> {
  if (!isRecord(json)) return bad('the response was not an object');
  const servedAt = str(json['fetchedAt']);
  if (servedAt === null) return bad('the response carried no fetchedAt');
  const resultError = errorOf(json['error']);
  const list = json['data'];
  if (!Array.isArray(list)) {
    // Amendment 9 again, and the distinction the whole route was added for: no
    // rows WITH a reason is the store failing, in its own words; no rows and no
    // reason is a malformed response. Neither is "there are none".
    return resultError === null ? bad('the result carried no data array') : { ok: false, error: resultError };
  }
  const runs: CheckRun[] = [];
  for (const entry of list) {
    const view = checkRunView(entry, serviceId);
    // Louder than dropping the row: a table quietly one row short looks exactly
    // like a probe that did not run, which is a fact about the estate rather
    // than about our parsing.
    if (view === null) return bad('a check run could not be read');
    runs.push(view);
  }
  return { ok: true, value: { servedAt, value: runs, ...(resultError === null ? {} : { error: resultError }) } };
}

/* ---------------------------------------------------------------- /api/entra */

/**
 * The Entra snapshot, validated field by field, with **`stats` all-or-nothing**.
 *
 * The adapter already refuses to serve a partial `stats` — `EntraSnapshot.stats`
 * is eight required numbers, the contract is frozen, and there is nowhere in it
 * to write "we could not look" into one of them, so a failed constituent read
 * comes back as an error with no `data` at all. This side keeps that property
 * rather than re-deciding it: a payload whose `stats` we cannot read whole is
 * refused, because the only alternative is a `0`, and on this screen a zero
 * reads as *good news* — no risky sign-ins, no failed sign-ins, nobody
 * unregistered. `num()` returning `null` here would put exactly that lie on the
 * page through the other door.
 *
 * `signals[]` gets the opposite treatment for the opposite reason: a list CAN
 * express absence. `mfa_gap` is omitted entirely on a cold start, because its
 * `delta24h` is the one figure Graph cannot answer retrospectively — and an
 * omitted signal is not a signal at zero. Nothing here invents a row for it;
 * the count it would have carried is `stats.mfaUnregistered`, which is present
 * from the first poll.
 */

/** The frozen union as a `Record`, for the reason `RESULTS` is one: a ninth
 *  signal key in the contract stops this compiling, where an array of eight
 *  strings would go on quietly refusing the new member as unreadable. */
const SIGNAL_KEYS: Record<EntraSignal['key'], true> = {
  risky_signin: true,
  failed_spike: true,
  legacy_auth: true,
  mfa_gap: true,
  expiring_credentials: true,
  role_change: true,
  guest_access: true,
  ca_change: true,
};

function isSignalKey(v: unknown): v is EntraSignal['key'] {
  return typeof v === 'string' && Object.hasOwn(SIGNAL_KEYS, v);
}

const AUDIT_RESULTS: Record<AuditEvent['result'], true> = { success: true, failure: true };

function isAuditResult(v: unknown): v is AuditEvent['result'] {
  return typeof v === 'string' && Object.hasOwn(AUDIT_RESULTS, v);
}

/**
 * One signal row.
 *
 * `key` is refused rather than defaulted — it is the row's identity and its
 * React key, and a ninth key we do not recognise is a row we cannot label. The
 * counts are refused rather than zeroed for the same reason `stats` is
 * all-or-nothing. `severity` goes through the shared `decodeSeverity`, so an
 * unreadable one shows as Sev 1 and not as the mildest thing on the page.
 */
export function entraSignalView(raw: unknown): EntraSignal | null {
  if (!isRecord(raw)) return null;
  const key = raw['key'];
  const label = str(raw['label']);
  const count = num(raw['count']);
  const delta24h = num(raw['delta24h']);
  const lastSeen = str(raw['lastSeen']);
  if (!isSignalKey(key) || label === null || count === null || delta24h === null || lastSeen === null) {
    return null;
  }
  return { key, label, count, delta24h, severity: decodeSeverity(raw['severity']), lastSeen };
}

/**
 * One audit row.
 *
 * `result` is refused rather than defaulted, and that is the load-bearing line:
 * defaulting to `success` renders a failed directory change identically to one
 * that went through, and defaulting to `failure` invents an alarm the tenant
 * never recorded. Neither is a reading.
 */
export function auditEventView(raw: unknown): AuditEvent | null {
  if (!isRecord(raw)) return null;
  const at = str(raw['at']);
  const actor = str(raw['actor']);
  const action = str(raw['action']);
  const target = str(raw['target']);
  const result = raw['result'];
  if (at === null || actor === null || action === null || target === null || !isAuditResult(result)) {
    return null;
  }
  return { at, actor, action, target, result };
}

/** The eight stats, whole or not at all. Returns `null` if any one of them is
 *  absent or non-numeric; `0` is a real reading and is kept. */
export function entraStats(raw: unknown): EntraSnapshot['stats'] | null {
  if (!isRecord(raw)) return null;
  const riskySignIns24h = num(raw['riskySignIns24h']);
  const riskyConfirmedCompromised = num(raw['riskyConfirmedCompromised']);
  const failedSignIns24h = num(raw['failedSignIns24h']);
  const failedSignInAccounts = num(raw['failedSignInAccounts']);
  const mfaCoverage = num(raw['mfaCoverage']);
  const mfaUnregistered = num(raw['mfaUnregistered']);
  const privilegedAccounts = num(raw['privilegedAccounts']);
  const globalAdmins = num(raw['globalAdmins']);
  if (
    riskySignIns24h === null ||
    riskyConfirmedCompromised === null ||
    failedSignIns24h === null ||
    failedSignInAccounts === null ||
    mfaCoverage === null ||
    mfaUnregistered === null ||
    privilegedAccounts === null ||
    globalAdmins === null
  ) {
    return null;
  }
  return {
    riskySignIns24h,
    riskyConfirmedCompromised,
    failedSignIns24h,
    failedSignInAccounts,
    mfaCoverage,
    mfaUnregistered,
    privilegedAccounts,
    globalAdmins,
  };
}

/**
 * `{ servedAt, result }`, the same envelope `/api/incidents` serves.
 *
 * Amendment 9 applies here as it does there: a snapshot AND an error is
 * stale-with-last-good — or, on this source, the adapter's `entra_partial`,
 * where the counts are lower bounds and it says so — and both travel on to the
 * caller together. Only a payload with no readable snapshot is a failure, and
 * then the error is reported in its own words.
 */
export function parseEntra(
  json: unknown,
): Parsed<{ servedAt: string; value: EntraSnapshot; error?: { code: string; message: string } }> {
  if (!isRecord(json)) return bad('the response was not an object');
  const servedAt = str(json['servedAt']);
  if (servedAt === null) return bad('the response carried no servedAt');
  const result = isRecord(json['result']) ? json['result'] : null;
  if (result === null) return bad('the response carried no result envelope');
  const resultError = errorOf(result['error']);
  const data = isRecord(result['data']) ? result['data'] : null;
  if (data === null) {
    // "We could not look" arrives here, and it is the COMMON failure on this
    // source: one failed Graph read costs the whole snapshot by design. The
    // reason is the server's, verbatim, because it names which question went
    // unanswered.
    return resultError === null ? bad('the result carried no Entra snapshot') : { ok: false, error: resultError };
  }
  const stats = entraStats(data['stats']);
  if (stats === null) return bad('the Entra statistics could not be read');
  const rawSignals = data['signals'];
  const rawAudit = data['audit'];
  if (!Array.isArray(rawSignals)) return bad('the snapshot carried no signals array');
  if (!Array.isArray(rawAudit)) return bad('the snapshot carried no audit array');

  const signals: EntraSignal[] = [];
  for (const entry of rawSignals) {
    const view = entraSignalView(entry);
    // Louder than dropping the row: a signals table quietly one row short looks
    // exactly like a signal with no evidence behind it, which is a fact about
    // the tenant rather than about our parsing — and this source expresses that
    // fact by omission, so the two would be indistinguishable.
    if (view === null) return bad('a signal could not be read');
    signals.push(view);
  }
  const audit: AuditEvent[] = [];
  for (const entry of rawAudit) {
    const view = auditEventView(entry);
    if (view === null) return bad('an audit event could not be read');
    audit.push(view);
  }

  return {
    ok: true,
    value: {
      servedAt,
      value: { stats, signals, audit },
      ...(resultError === null ? {} : { error: resultError }),
    },
  };
}


/* ------------------------------------------------------------ /api/endpoints */

/**
 * The Endpoint Central snapshot. Same envelope and same rules as `/api/entra`.
 *
 * `stats` is five required numbers and is all-or-nothing for the reason the
 * Entra stats are: the contract has nowhere to write "we could not look" into
 * one of them, and a `0` under "Critical patches missing" reads as good news.
 */
const ISSUE_KINDS: Record<EndpointIssue['issueKind'], true> = {
  stale_agent: true,
  missing_patches: true,
  no_bitlocker: true,
  eol_build: true,
};

function isIssueKind(v: unknown): v is EndpointIssue['issueKind'] {
  return typeof v === 'string' && Object.hasOwn(ISSUE_KINDS, v);
}

/**
 * One attention row.
 *
 * `issueKind` is refused rather than defaulted even though **no column renders
 * it**. There is no honest default: `stale_agent` would mislabel a BitLocker
 * finding and `no_bitlocker` would invent an encryption problem, and an
 * invisible wrong value is worse than a visible one because nothing on screen
 * can contradict it. The contract is frozen, so a fifth kind arrives with an
 * amendment that updates both sides at once — the same argument that makes
 * `SIGNAL_KEYS` a Record over the union rather than a list of strings.
 */
export function endpointIssueView(raw: unknown): EndpointIssue | null {
  if (!isRecord(raw)) return null;
  const computer = str(raw['computer']);
  const assignedTo = str(raw['assignedTo']);
  const os = str(raw['os']);
  const issue = str(raw['issue']);
  const lastCheckIn = str(raw['lastCheckIn']);
  const issueKind = raw['issueKind'];
  if (
    computer === null || assignedTo === null || os === null ||
    issue === null || lastCheckIn === null || !isIssueKind(issueKind)
  ) {
    return null;
  }
  return { computer, assignedTo, os, issue, issueKind, lastCheckIn };
}

/** The five stats, whole or not at all. `0` is a real reading and is kept. */
export function endpointStats(raw: unknown): EndpointSnapshot['stats'] | null {
  if (!isRecord(raw)) return null;
  const total = num(raw['total']);
  const patchCompliance = num(raw['patchCompliance']);
  const checkedIn7d = num(raw['checkedIn7d']);
  const bitlockerEncrypted = num(raw['bitlockerEncrypted']);
  const criticalPatchesMissing = num(raw['criticalPatchesMissing']);
  if (
    total === null || patchCompliance === null || checkedIn7d === null ||
    bitlockerEncrypted === null || criticalPatchesMissing === null
  ) {
    return null;
  }
  return { total, patchCompliance, checkedIn7d, bitlockerEncrypted, criticalPatchesMissing };
}

export function parseEndpoints(
  json: unknown,
): Parsed<{ servedAt: string; value: EndpointSnapshot; error?: { code: string; message: string } }> {
  if (!isRecord(json)) return bad('the response was not an object');
  const servedAt = str(json['servedAt']);
  if (servedAt === null) return bad('the response carried no servedAt');
  const result = isRecord(json['result']) ? json['result'] : null;
  if (result === null) return bad('the response carried no result envelope');
  const resultError = errorOf(result['error']);
  const data = isRecord(result['data']) ? result['data'] : null;
  if (data === null) {
    return resultError === null ? bad('the result carried no Endpoints snapshot') : { ok: false, error: resultError };
  }
  const stats = endpointStats(data['stats']);
  if (stats === null) return bad('the Endpoints statistics could not be read');
  const rawAttention = data['attention'];
  if (!Array.isArray(rawAttention)) return bad('the snapshot carried no attention array');
  const attention: EndpointIssue[] = [];
  for (const entry of rawAttention) {
    const view = endpointIssueView(entry);
    if (view === null) return bad('an endpoint issue could not be read');
    attention.push(view);
  }
  return {
    ok: true,
    value: { servedAt, value: { stats, attention }, ...(resultError === null ? {} : { error: resultError }) },
  };
}


/* -------------------------------------------- POST /api/incidents/:id/<action> */

/**
 * What a write answered, so the screen can render what is now TRUE rather than
 * refetching and racing its own write.
 *
 * The reply carries the resulting flags on purpose (`m4-auth`'s design), and
 * this reads them with the same two helpers `incidentView` uses — one
 * definition, so a flag cannot mean one thing when polled and another when
 * written. That is the exact divergence this seam produced once already.
 *
 * `id` is validated and returned so a caller can refuse a reply about a
 * different incident. Nothing here defaults a flag: an unreadable `ack` comes
 * back absent, which renders as "not acknowledged" — the honest reading of a
 * record we could not read, and visibly different from a name we invented.
 */
export function parseIncidentAction(
  json: unknown,
): Parsed<{ id: string; ack?: { by: string; at: string }; muted?: { by: string; until: string | null } }> {
  if (!isRecord(json)) return bad('the response was not an object');
  const id = str(json['id']);
  if (id === null) return bad('the write answered without naming the incident');
  const flags = isRecord(json['flags']) ? json['flags'] : {};
  const ack = ackOf(flags['ack']);
  const muted = mutedOf(flags['muted']);
  return {
    ok: true,
    value: { id, ...(ack === null ? {} : { ack }), ...(muted === null ? {} : { muted }) },
  };
}
