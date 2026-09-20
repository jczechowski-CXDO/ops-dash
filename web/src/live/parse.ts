import type { BlastMetric, Severity, StatusLevel } from '@ops-dash/shared';
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
