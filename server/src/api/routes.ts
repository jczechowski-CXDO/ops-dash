import Fastify, { type FastifyInstance, type FastifyPluginAsync, type FastifyServerOptions } from 'fastify';
import type { CheckRun, ServiceId, Severity, SourceResult, StatusLevel, VendorPlatform } from '@ops-dash/shared';
import type { SourceStatus } from '../poller/schedule.js';
// The ONE definition of "what is this service now", shared with `index.ts` and
// the engine. Imported rather than reimplemented: a second copy of this rule
// would be a second place for a stale `operational` to leak out, and the two
// would agree right up until the day they did not.
import { vendorLevel } from '../store/currentLevel.js';
import { buildTile, type ServiceTile, type TileStore } from './tile.js';
import { SERVICE_PLATFORM } from '../services.js';
import { sourceStaleness, type Staleness } from '../store/staleness.js';
import { certExpiry, certNeedsAttention, type CertExpiry } from '../store/certExpiry.js';
// Type-only. The route never constructs one and never reads a file: the PEM
// arrives as a parameter, and `store/certExpiry.ts` says why that is absolute.
import type { X509Certificate } from 'node:crypto';
// The ONE answer to "who is calling, and may they". This file may DECLARE a
// policy per route and may read the resulting principal; it may not verify a
// cookie, read a header or check a password, and `server/src/auth/guards.test.ts`
// enforces that by name. A route with its own idea of "authenticated" is the
// `publishedLevel`/`vendorLevel` fork with a much worse failure mode.
import { createSessionAuth, principalOf, registerAuth, type SessionAuth } from '../auth/session.js';

/**
 * The API.
 *
 * **It was read-only until M4 and is not any more**, which is the fact this
 * file's header has to carry rather than leave to whoever greps for `app.post`.
 * Every route declares an auth policy — `'public-read'`, `'login'` or
 * `'required'` — as `config.auth` at its registration, and `auth/session.ts`
 * decides what the declaration means. This file has no opinion about identity
 * beyond naming the policy, and a route registered here without one is refused
 * before its handler runs. `auth/routeTable.test.ts` holds the enumeration.
 *
 * The reads are deliberately `'public-read'`: that is what they were before the
 * seam existed, now written down as a decision rather than left as an omission.
 *
 * One rule governs this file: **`SourceResult<T>` is mirrored outward
 * unchanged.** `fetchedAt`, `degraded`, `empty` and `error` reach the client
 * exactly as the store holds them. A route that flattened an errored source
 * into an empty array would have thrown away the only thing separating
 * "nothing is wrong" from "we could not look" — the failure this product
 * exists to prevent, reappearing at the last hop after every layer beneath was
 * built to preserve it.
 *
 * Two consequences worth stating, because both look like bugs to a reader
 * expecting a conventional REST API:
 *
 *  - **A dead source is HTTP 200.** Six good sources and one errored returns
 *    six payloads and one error object. The transport succeeded; the source
 *    did not. Those are different facts and the status code describes the
 *    first one. A 5xx here would blank six healthy panels over one bad feed.
 *  - **The vendor's payload is never derived from.** The store already returns
 *    the last good payload with the last failure attached; this file re-derives
 *    none of it. Branch on `error` for the stale badge and on `data` for
 *    whether there is anything to draw — never infer one from the other
 *    (amendment 9).
 *
 *    Two things are computed BESIDE the mirror, and neither touches it.
 *
 *    The first is `ServiceEntry.currentLevel`, and it sits BESIDE the
 *    envelope rather than inside it. A pure mirror hands the client
 *    `data.level: 'operational'` for a vendor we have not read since
 *    breakfast, and `statusColor()` takes exactly that field — so "every
 *    consumer must remember to check `error` before reading `level`" becomes
 *    the contract. That is the same shape as "everyone remembers not to use a
 *    raw token", which cost this repo 42 contrast failures in one wave. The
 *    mirror stays byte for byte; the safe reading is served next to it, so
 *    getting it right is the easy path rather than the remembered one.
 *
 *    The second is our own half of each tile — `ours`, the latencies, the
 *    sparkline, uptime, the incident count — which is not the vendor's claim at
 *    all but a reading of our own store, and `tile.ts` owns every decision in
 *    it. The one that matters: **an absent measurement crosses the wire as
 *    `null`, never as 0 and never as an omitted key.** Five of the seven
 *    services have no probe of their own today, so that is the common path
 *    rather than the edge case, and a zero there would render as a real
 *    measurement of a thing nobody measured.
 *
 * ## The auth seam, deliberately visible
 *
 * There is **no authentication here**, and this comment is the seam rather
 * than a `TODO` buried in a handler. Milestone 4 fills it, together with the
 * ack/mute/resolve routes that need it. Until then every route is a GET and
 * `routes.test.ts` asserts that over the registered route table — because a
 * mutating route added today would be an unauthenticated write. `/api/health`
 * reports `auth: { mode: 'none' }` so the gap is visible at runtime too, not
 * only to someone reading this file.
 */

/* ----------------------------------------------------------- dependencies */

/** The store, narrowed to what the API reads. Structural, so a test can supply
 *  one whose every read throws — the only honest way to exercise the store
 *  half of `/api/health`. `routes.test.ts` asserts the real `Store` satisfies
 *  this, so a rename in `db.ts` fails there rather than at composition. */
export type ApiStore = TileStore & {
  getSnapshot(source: string): SourceResult<unknown> | undefined;
  openIncidents(): Array<Record<string, unknown>>;
};

/**
 * How many individual runs `/api/checks` hands back.
 *
 * A page size that bounds the response, not a display preference. The original
 * justification here was "the detail page shows a short table, not a log",
 * which was me writing the cap before anything consumed it — and it was wrong
 * about the table's job. The view agent pushed back with the arithmetic: at one
 * poll a minute with two probes on a service, five rows is one or two ticks,
 * and a flapping probe is invisible in two ticks. 25 is roughly six to twelve
 * minutes of history.
 *
 * The rest of the page answers "how is this service"; this table is the only
 * thing that answers "which check, from where, how fast, when". Anything
 * wanting real history should ask for a time window rather than a bigger page
 * of the newest rows.
 */
export const CHECKS_PAGE = 25;

/** The poller, narrowed the same way. Typed from `schedule.ts`'s own
 *  `SourceStatus` rather than a copy of it, so the health payload cannot drift
 *  from what the scheduler actually records. */
export type ApiPoller = {
  allStatus(): Record<string, SourceStatus>;
};

export type ApiDeps = {
  store: ApiStore;
  /** Injected for the same reason `correlate` takes `at`: a route that reads
   *  the clock cannot be tested for what it does at a particular moment. The
   *  30- and 90-day windows on every tile are measured from here. */
  now?: () => Date;
  /** Optional: `index.ts` attaches one, a route test need not. Absent is
   *  reported as `configured: false, ok: false` — a poller that is not running
   *  is not a healthy poller. */
  poller?: ApiPoller;
  /**
   * The Graph certificate, as PEM text or an already-parsed certificate.
   *
   * **A function, and the route never learns where the file is.** The
   * composition root holds the config it loaded from `OPS_DASH_GRAPH_CONFIG`
   * and is the only thing that should know the path; `server/src/guards.test.ts`
   * and `web/src/guards.test.ts` between them forbid a credential path, a PEM
   * block or a thumbprint anywhere in source, and this signature is what makes
   * obeying that the easy path rather than the remembered one.
   *
   * A function rather than a string so it is read per request: a certificate
   * swapped on disk is picked up without a restart, which matters for the one
   * credential whose whole purpose here is to be replaced before it expires.
   *
   * Three absences, deliberately distinguished:
   *   - the dep is absent        → `unconfigured`
   *   - it returns `undefined`   → `unconfigured`
   *   - it throws                → `unreadable`, carrying the reason
   *
   * `unconfigured` is NOT a failure. There is no credential yet on a machine
   * that has not been given one, and rendering that as an expiry problem would
   * be the same lie as rendering a missing probe as 100% uptime.
   */
  graphCert?: () => string | X509Certificate | undefined;
  /**
   * The auth seam. Optional so every existing caller — `index.ts`, and a
   * hundred route tests — compiles and behaves unchanged; absent means the real
   * one, reading the credential file located by `OPS_DASH_AUTH_CONFIG` per
   * request.
   *
   * Absent AND no credential file is not "open": `required` routes answer 503
   * `auth_unconfigured`. This seam has no state in which it lets someone
   * through without knowing who they are.
   */
  auth?: SessionAuth;
};

/* ------------------------------------------------------------ source names */

/** The snapshot key for a vendor's stored `SourceResult`. One function so the
 *  writer (the poller) and the reader (this file) cannot spell it differently;
 *  a key spelled two ways reads as a source that has never been polled, which
 *  is indistinguishable from a real one. */
export function vendorSource(id: ServiceId): string {
  return `vendor:${id}`;
}

/** Runtime copy of the frozen `ServiceId` union, typed as an exhaustive
 *  Record: adding an eighth service to the contract without adding it here is
 *  a typecheck failure, not a tile that quietly stops being served. */
const SERVICE_IDS: Record<ServiceId, true> = {
  proofpoint: true,
  jira: true,
  helpjuice: true,
  claude: true,
  openai: true,
  zendesk: true,
  m365: true,
};

/** Response order, fixed by the declaration above. Every service is listed on
 *  every response whether or not it has ever been polled: a tile that vanishes
 *  because its poller died looks like a service nobody monitors. */
export const SERVICE_ORDER = Object.keys(SERVICE_IDS) as ServiceId[];

/* -------------------------------------------------------------- responses */

export type ServiceEntry = {
  id: ServiceId;
  /** The store key this came from, so a reader can tell an unpolled service
   *  from a mis-keyed one without guessing. */
  source: string;
  /** The stored envelope, byte for byte. See `store/currentLevel.ts` for why
   *  `result.data.level` is NOT the field to colour a tile with. */
  result: SourceResult<unknown>;
  /**
   * What this service is **now**, as opposed to what the payload says it was
   * when we could last read it. Derived, and sitting BESIDE the mirror rather
   * than inside it, by `vendorLevel` in `store/currentLevel.ts` — which is the
   * same call, with the same three arguments, that `index.ts` hands the
   * correlation engine. One rule, one definition: the API and the correlator
   * cannot disagree about whether a vendor is green.
   *
   * It was `publishedLevel(result)` until 2026-09-19, and they DID disagree —
   * the route served Zendesk `unknown` while the engine, in the same process
   * and against the same store, had it `operational` with 2/2 of our probes
   * passing. `currentLevel` answers the narrower question "what did the vendor
   * publish", and Zendesk publishes no health at all, so it can only ever
   * answer `unknown` there. Amendment 10's inference lives in `vendorLevel`
   * and needs the `ours` half, which this route did not compute until it
   * served a whole tile. Second time this seam has produced the same class of
   * bug: G2 HIGH 4 was the API and the engine disagreeing about a stale
   * payload.
   */
  currentLevel: StatusLevel;
  /**
   * Present when `currentLevel` was DERIVED from our own evidence rather than
   * published by the vendor (amendment 10). It belongs to `currentLevel` and
   * NOT to `result.data`, which is still the vendor's untouched word.
   *
   * The tile must show whose reading this is. A green the operator believes
   * Zendesk affirmed, when it was really our two probes, is a worse lie than
   * the grey it replaced — so this is carried outward rather than dropped, and
   * a client that renders the level without it is rendering a claim we did not
   * make.
   */
  inferred?: { basis: string };
  /** Which upstream the vendor half comes from (amendment 5). Served because
   *  the client cannot otherwise tell that four `unknown` tiles are one
   *  Statuspage outage rather than four independent ones — and because it is
   *  the input that decides whether `inferred` is even possible. */
  platform: VendorPlatform;
} & Omit<ServiceTile, 'error'> & {
  /**
   * `ServiceTile.error`, renamed at this boundary.
   *
   * The tile's fields are flattened onto the entry so that they carry the
   * frozen contract's own names — `ours`, `latencyMs`, `spark`, `uptime30d`
   * and the rest line up one-to-one with `ServiceStatus`, and a field the web
   * forgets to map is a typecheck failure there rather than a blank stat. The
   * one field that cannot keep its name is `error`, because `result.error` is
   * already on this object and means something entirely different: that one is
   * the vendor feed failing, this one is OUR STORE failing to answer.
   *
   * When it is present, every `null` above is ignorance rather than
   * measurement, and the client must not render either as a number.
   */
  metricsError?: ServiceTile['error'];
};

export type ServicesResponse = {
  /** When the API answered. Never confuse this with a source's `fetchedAt`,
   *  which is when that source was last read successfully. */
  servedAt: string;
  services: ServiceEntry[];
};

export type ApiIncident = {
  id: string;
  ruleKey: string;
  serviceId: string;
  severity: Severity;
  /** Present ONLY when the stored severity could not be decoded and
   *  `severity` above is a fallback rather than a reading. The client renders
   *  a badge; without it the fallback is invisible, and an invisible guess is
   *  indistinguishable from a fact. */
  severityRaw?: string;
  openedAt: string;
  resolvedAt?: string;
  summary: string;
};

export type IncidentsResponse = {
  servedAt: string;
  result: SourceResult<ApiIncident[]>;
};

export type HealthResponse = {
  servedAt: string;
  /** Store and poller are reported separately because they fail separately: a
   *  single boolean would say the system is unwell without saying which half,
   *  and the two have entirely different remedies. */
  store: { ok: boolean; error?: string };
  poller: PollerHealth;
  /** The credential this process authenticates with, and how long it has left.
   *  Reported here because a monitor whose own credential dies quietly is this
   *  product's thesis turned on itself — the M365 tile would go `unknown` with
   *  an auth error, and nobody watches the tile that says the watcher is
   *  broken. */
  credential: CredentialHealth;
  /** What this process can do about identity, and what it made of THIS request.
   *  `mode` is about the server; `authenticated` is about the caller, and they
   *  are separate fields because "auth is configured" and "you are signed in"
   *  are the two facts an operator staring at a 401 needs to tell apart. */
  auth: { mode: 'local-user' | 'unconfigured'; authenticated: boolean; note: string };
};

/**
 * The credential block, and the one thing on this route that the seam moved.
 *
 * The M1 review's release list carries `/api/health` as a disclosure: it names
 * the Graph certificate's subject, issuer, thumbprint and expiry to anyone who
 * can reach the port. **The liveness half stays public and the disclosure does
 * not.** A health endpoint that needs a credential to answer "am I alive" is the
 * wrong trade — that answer is wanted most by whoever cannot sign in — but
 * nothing about our certificate is needed to answer it.
 *
 * `configured` survives redaction deliberately: "is a credential present" is
 * the half an unauthenticated monitor legitimately needs, and it is not a fact
 * about the certificate.
 */
export type RedactedCert = { configured: boolean; redacted: true; note: string };
export type CredentialHealth = { graph: CertHealth } | { graph: RedactedCert };

/**
 * The Graph certificate's health.
 *
 * `configured` is the discriminant and it comes first on purpose: a reader who
 * branches on `level` alone has no case for "there is no certificate", and
 * would have to invent one — most likely by treating the absence as a problem,
 * which it is not.
 */
export type CertHealth =
  | { configured: false; note: string }
  | ({
      configured: true;
      /** `certNeedsAttention`, carried rather than recomputed: the line between
       *  "fine" and "somebody has to do something" is owned by one function, so
       *  a client cannot draw it somewhere else. */
      needsAttention: boolean;
    } & CertExpiry);

/**
 * The poller's health, as four named populations and one positive list.
 *
 * The first version of this field was a single `stalled: string[]` computed
 * from `SourceStatus.lastError`, which at the time was set only when
 * `source.run()` THREW — and nothing in this repo throws, because every layer
 * reports failure in the envelope. So `stalled` was empty by construction: a
 * health field that reported calm because nothing could make it speak, which
 * is the exact failure this product exists to prevent. Found at G2, together
 * with the poller defect underneath it.
 *
 * It is replaced rather than redefined. A field whose meaning silently changed
 * is worse than one that was renamed, because every reader who learned the old
 * meaning keeps it.
 *
 * `broken` and `failing` are separate because an operator does different
 * things with each: `broken` is a stack trace to read, `failing` is a vendor
 * to wait for. Collapsing them into one list is the same flattening this whole
 * route exists to refuse, applied to our own failures instead of a feed's.
 *
 * `neverSucceeded` deliberately OVERLAPS the two above: they answer "what is
 * wrong right now", it answers "have we ever had data at all". A source that
 * has 503'd since boot is in both, and the second fact is the one that decides
 * whether a panel has anything to draw.
 */
export type PollerHealth = {
  /** True only if every configured source can show a recorded success on its
   *  most recent run. Positive by construction: there is no default-true path
   *  through this, and an unstarted poller is not a healthy poller. */
  ok: boolean;
  configured: boolean;
  /** Succeeded on its latest run — the positive list. `ok` is this list being
   *  everything. Stated outward as well as `ok` so a reader can see WHICH
   *  sources the all-clear is made of. */
  healthy: string[];
  /** Our code broke: `run()` threw and the scheduler caught it. */
  broken: string[];
  /** The source ran fine and came back with an errored `SourceResult` — a feed
   *  that 503s, a 2xx carrying HTML, a platform with no adapter yet. */
  failing: string[];
  /** Has run at least once and has NEVER recorded a success. There is no last
   *  good payload behind this source at all. */
  neverSucceeded: string[];
  /** Configured and has not run once. Almost always `start()` was never
   *  called — which the old `poller.ok` reported as healthy. */
  neverRun: string[];
  /**
   * Has succeeded before, is not erroring now, and is nonetheless overdue.
   *
   * The last place in the chain where something broken read calm. A source
   * whose timer stopped keeps the `lastOkAt` it died with, and `lastOkAt`
   * twenty minutes ago is indistinguishable from twenty seconds ago unless you
   * know the cadence — so every one of these was in `healthy` until now.
   *
   * A FOURTH population and not a flavour of `failing`, because the operator
   * does something different about each: `failing` is a vendor to wait for,
   * `stale` is our own process to go and look at. Narrow by construction — a
   * source that is erroring, or has never succeeded, is reported as that
   * instead, since both are more specific and both already say the data is not
   * moving. Those are still judged in `staleness` below.
   */
  stale: string[];
  /**
   * Every source's freshness judgement, including the fresh ones: age of the
   * last success, the threshold it was judged against, and the reason. The
   * lists above are a reading of this; this is the evidence, and a reader who
   * wants "how old is the number in front of me" needs it for the healthy
   * sources too.
   */
  staleness: Record<string, Staleness>;
  /** Every source's full status, mirrored and not summarised. The lists above
   *  are a reading of this; this is the evidence. */
  sources: Record<string, SourceStatus>;
};

/* ---------------------------------------------------------------- helpers */

const message = (cause: unknown) => String((cause as Error)?.message ?? cause);

/** A source with no row at all. Reported explicitly, because "we have never
 *  looked" must not be served as anything a reader could mistake for health.
 *  `fetchedAt` is the time we looked in the store and found nothing — the
 *  contract requires the field, and the error code says what it means. */
const neverPolled = (at: string): SourceResult<never> => ({
  fetchedAt: at,
  degraded: true,
  error: { code: 'never_polled', message: 'no poll of this source has ever been recorded' },
});

const storeUnavailable = (at: string, cause: unknown): SourceResult<never> => ({
  fetchedAt: at,
  degraded: true,
  error: { code: 'store_unavailable', message: message(cause) },
});

/**
 * The prefix `poller/schedule.ts` puts on a `lastError` it produced by
 * CATCHING a throw, as opposed to one it read out of an errored
 * `SourceResult`. Our bug must not read like a vendor outage, and this string
 * is the only thing that tells them apart.
 *
 * It is a duplicated literal, on purpose: the alternative is importing the
 * scheduler's own template and asserting a value against the path that
 * produced it, which proves nothing. `routes.test.ts` runs a REAL schedule
 * over a source that throws and one that returns an errored result, and pins
 * that this classification puts them in different lists — so the day the
 * prefix changes, that test goes red rather than this constant going quietly
 * stale.
 */
export const THREW_PREFIX = 'threw: ';

/** One source's population. Order matters: a source that has never run cannot
 *  also be failing, and a `lastError` outranks a stale `lastOkAt` because it
 *  describes the most recent attempt. */
function classify(
  status: SourceStatus,
  now: Date,
): keyof Omit<PollerHealth, 'ok' | 'configured' | 'sources' | 'staleness'> {
  if (status.runs === 0) return 'neverRun';
  if (status.lastError !== undefined) {
    return status.lastError.startsWith(THREW_PREFIX) ? 'broken' : 'failing';
  }
  // Healthy requires positive evidence of a success, not merely the absence of
  // a complaint. Without the `lastOkAt` check, a status object that has run and
  // recorded nothing at all would read healthy — which is how the field this
  // replaces came to be empty by construction.
  if (status.lastOkAt === undefined) return 'neverSucceeded';
  // …and positive evidence of a RECENT success. The absence of a complaint is
  // exactly what a stopped timer produces: nothing complains, because nothing
  // is running. `sourceStaleness` owns the arithmetic and the cadence; this
  // only decides which list the answer lands in.
  return sourceStaleness(status, now).stale ? 'stale' : 'healthy';
}

/**
 * The stored severity, decoded to the frozen `Severity` union.
 *
 * SQLite holds it as TEXT, so '1' comes back where the contract says 1. A
 * value we cannot read decodes to **1**, the most severe, and not to 'info':
 * an unreadable severity is a thing we cannot see, and this codebase never
 * renders a thing it cannot see as benign.
 *
 * ## The layer rule: throw on the write path, degrade loudly on the read path
 *
 * `engine/correlate.ts`'s `parseSeverity` answers this same question by
 * THROWING, and that is right where it sits: a guess made on the write path
 * gets persisted and outlives the bug that made it. Here it would be wrong —
 * a throw inside a route turns one unreadable row into a 500 that blanks nine
 * good incidents, which is the flattening this file exists to refuse arriving
 * through a different door.
 *
 * What makes the pair safe rather than merely inconsistent is that the
 * fallback is **visible**: this returns `fellBack`, the route puts the
 * undecodable value in `severityRaw`, and the client can badge it. A fallback
 * nobody can see is just a guess with better manners.
 */
export function decodeSeverity(raw: unknown): { severity: Severity; fellBack: boolean } {
  if (raw === 'info') return { severity: 'info', fellBack: false };
  const n = typeof raw === 'number' ? raw : Number(raw);
  return n === 1 || n === 2 || n === 3
    ? { severity: n as Severity, fellBack: false }
    : { severity: 1, fellBack: true };
}

function toIncident(row: Record<string, unknown>): ApiIncident {
  const resolvedAt = row['resolved_at'];
  const { severity, fellBack } = decodeSeverity(row['severity']);
  return {
    id: String(row['id']),
    ruleKey: String(row['rule_key']),
    serviceId: String(row['service_id']),
    severity,
    ...(fellBack ? { severityRaw: String(row['severity']) } : {}),
    openedAt: String(row['opened_at']),
    ...(typeof resolvedAt === 'string' ? { resolvedAt } : {}),
    summary: String(row['summary']),
  };
}

/**
 * The Graph certificate's health, from a supplier the caller owns.
 *
 * Every branch here is a different fact and none of them may be confused with
 * another:
 *
 *   - no supplier, or a supplier returning nothing → `configured: false`. There
 *     is no credential on this machine. That is a state to report, not a
 *     failure to raise, and it must not read as an expiry.
 *   - the supplier threw → `unreadable`, with the reason. Reading the file is
 *     the caller's job and it can fail — deleted, unreadable, permissions —
 *     and "we cannot read our own credential" is precisely the thing this
 *     field exists to surface.
 *   - anything else → `certExpiry`'s own verdict, verbatim.
 *
 * Nothing here throws. A health route that 500s because the credential is odd
 * has taken away the page that would have explained it.
 */
export function graphHealth(supplier: ApiDeps['graphCert'], now: Date): CertHealth {
  if (supplier === undefined) {
    return { configured: false, note: 'no Graph credential is configured for this process' };
  }
  let pem: string | X509Certificate | undefined;
  try {
    pem = supplier();
  } catch (cause) {
    return { configured: true, needsAttention: true, level: 'unreadable', reason: message(cause) };
  }
  if (pem === undefined) {
    return { configured: false, note: 'no Graph credential is configured for this process' };
  }
  const expiry = certExpiry(pem, now);
  return { configured: true, needsAttention: certNeedsAttention(expiry), ...expiry };
}

/* ----------------------------------------------------------------- routes */

export const apiRoutes: FastifyPluginAsync<ApiDeps> = async (app, deps) => {
  const { store, poller } = deps;
  const clock = deps.now ?? (() => new Date());
  const auth = deps.auth ?? createSessionAuth();

  /**
   * Installed here, inside the plugin, so Fastify's encapsulation confines it
   * to the routes below. `static.ts` registers the SPA on the root instance and
   * must stay outside this — it serves files, it has no policy to declare, and
   * pulling it in would mean either exempting it or teaching the hook about a
   * second kind of route.
   *
   * Every route in this file declares `config.auth`, and one that does not is
   * refused with 500 before its handler runs. That is the whole seam: this file
   * declares, `auth/session.ts` decides.
   */
  registerAuth(app, auth, clock);

  app.get('/api/services', { config: { auth: 'public-read' } }, async (): Promise<ServicesResponse> => {
    const at = clock();
    const servedAt = at.toISOString();
    return {
      servedAt,
      services: SERVICE_ORDER.map((id) => {
        const source = vendorSource(id);
        let result: SourceResult<unknown>;
        try {
          // Mirrored, not rebuilt. getSnapshot already attaches the last
          // failure to the last good payload; re-deriving it here is how the
          // two would come to disagree.
          result = store.getSnapshot(source) ?? neverPolled(servedAt);
        } catch (cause) {
          // One service's read failing must not blank the other six.
          result = storeUnavailable(servedAt, cause);
        }
        // Our own half. `buildTile` never throws — it catches its own reads,
        // because one unreadable service must not blank the other six — and
        // every absent measurement comes back as `null` rather than as a zero
        // that would render as a reading. See `tile.ts` for each decision.
        const { error: metricsError, ...tile } = buildTile(store, id, at);
        const platform = SERVICE_PLATFORM[id];
        // Derived BESIDE the mirror, never instead of it: `result` is
        // untouched and this is the safe reading of it.
        //
        // `vendorLevel` and not `currentLevel`, with BOTH halves handed to it,
        // exactly as `index.ts` hands them to the engine. Our half is
        // `tile.ours`, which is why this line sits below the tile rather than
        // above it: the inference cannot be made without it, and making it
        // with a hardcoded `{ passing: 0, total: 0 }` would silently answer
        // `unknown` forever.
        const { level, inferred } = vendorLevel(result, platform, tile.ours);
        return {
          id,
          source,
          result,
          platform,
          currentLevel: level,
          ...(inferred ? { inferred } : {}),
          ...tile,
          ...(metricsError ? { metricsError } : {}),
        };
      }),
    };
  });

  app.get('/api/incidents', { config: { auth: 'public-read' } }, async (): Promise<IncidentsResponse> => {
    // `clock()`, like the other two. One route reading the wall clock while its
    // neighbours read an injected one is how a test comes to pass against a
    // clock it did not choose.
    const servedAt = clock().toISOString();
    try {
      const rows = store.openIncidents();
      return {
        servedAt,
        result: {
          data: rows.map(toIncident),
          fetchedAt: servedAt,
          degraded: false,
          // amendment 4: the query completed and returned no records. That is
          // not an assertion that nothing is wrong, and nothing downstream may
          // read it as one.
          empty: rows.length === 0,
        },
      };
    } catch (cause) {
      // No `empty` here on purpose: "we found no records" and "we could not
      // look" are different claims, and only the first one is about records.
      return { servedAt, result: storeUnavailable(servedAt, cause) };
    }
  });

  /**
   * The individual check runs behind a service's counts.
   *
   * `/api/services` says "1 of 2 checks passing"; this says WHICH, when, from
   * where and how fast. Until it existed the detail page could only print the
   * counts and admit that the runs were not served — honest, and useless to
   * anyone diagnosing which pod is down.
   *
   * A `SourceResult` like everything else on this surface: `empty: true` when a
   * service has no runs, which is NOT the same as a read that failed, and a
   * store error is `error` with no `data` rather than an empty list. "We looked
   * and there are none" and "we could not look" must not render the same.
   */
  app.get('/api/checks', { config: { auth: 'public-read' } }, async (request, reply): Promise<SourceResult<CheckRun[]>> => {
    const servedAt = clock().toISOString();
    const asked = (request.query as { service?: unknown } | undefined)?.service;

    // Validated against the frozen union, not passed through. The value reaches
    // a SQL parameter — bound, so not injectable — but an unknown id would
    // silently return an empty list, and "no runs" for a service that does not
    // exist reads exactly like "no runs" for one that does.
    if (typeof asked !== 'string' || !SERVICE_ORDER.includes(asked as ServiceId)) {
      void reply.code(400);
      return {
        fetchedAt: servedAt,
        degraded: false,
        error: { code: 'bad_service', message: `service must be one of: ${SERVICE_ORDER.join(', ')}` },
      };
    }

    try {
      const runs = store.runsFor(asked as ServiceId, CHECKS_PAGE);
      return {
        fetchedAt: servedAt,
        degraded: false,
        data: runs,
        ...(runs.length === 0 ? { empty: true } : {}),
      };
    } catch (cause) {
      // 200, like every other read failure here: the transport succeeded and
      // the store did not, and those are different facts.
      return {
        fetchedAt: servedAt,
        degraded: true,
        error: { code: 'store_unavailable', message: String((cause as Error)?.message ?? cause) },
      };
    }
  });

  app.get('/api/health', { config: { auth: 'public-read' } }, async (request): Promise<HealthResponse> => {
    const at = clock();
    const servedAt = at.toISOString();

    // An actual read, not a flag someone set at boot: a flag would go on
    // reporting ok long after the database was closed underneath it.
    let storeHealth: HealthResponse['store'];
    try {
      store.getSnapshot('__health__');
      storeHealth = { ok: true };
    } catch (cause) {
      storeHealth = { ok: false, error: message(cause) };
    }

    // `'public-read'`, so the hook set no principal — this route asks the
    // question itself rather than being told, and it is the ONE reader of the
    // published decision outside the hook. It does not verify anything: it
    // calls the same `decide` the hook calls, so a health page and a write
    // route can never disagree about whether this caller is signed in.
    const signedIn = auth.decide(request, at).authenticated;
    const configured = auth.configured();

    const sources = poller ? poller.allStatus() : {};
    const entries = Object.entries(sources);
    const bucket = (want: string) => entries.filter(([, st]) => classify(st, at) === want).map(([name]) => name);
    const healthy = bucket('healthy');
    // Overlaps `broken`/`failing` on purpose — a different question.
    const neverSucceeded = entries.filter(([, st]) => st.runs > 0 && st.lastOkAt === undefined).map(([n]) => n);
    const staleness = Object.fromEntries(entries.map(([name, st]) => [name, sourceStaleness(st, at)]));

    return {
      servedAt,
      store: storeHealth,
      poller: {
        // Every configured source must SHOW a success. No poller, no sources,
        // or one source short and this is false.
        ok: poller !== undefined && entries.length > 0 && healthy.length === entries.length,
        configured: poller !== undefined,
        healthy,
        broken: bucket('broken'),
        failing: bucket('failing'),
        neverSucceeded,
        neverRun: bucket('neverRun'),
        stale: bucket('stale'),
        staleness,
        sources,
      },
      credential: credentialHealth(graphHealth(deps.graphCert, at), signedIn),
      auth: {
        mode: configured ? 'local-user' : 'unconfigured',
        authenticated: signedIn,
        note: configured
          ? 'A local operator credential. Reads are deliberately open on this LAN; every write needs a session.'
          : 'No operator credential is configured on this host, so every route that needs one refuses rather than allows.',
      },
    };
  });

  /**
   * Sign in.
   *
   * `'login'` and not `'public-read'`: it is unauthenticated by necessity rather
   * than by choice, and the route-table guard treats the two differently — the
   * set of non-GET routes that may be reached without a session has exactly one
   * member and adding a second is a failing test.
   *
   * **The reply says nothing a caller did not already know.** One message for a
   * wrong username and a wrong password, and the cost is paid on both paths, so
   * this route is not an oracle for which half was right.
   */
  app.post('/api/session', { config: { auth: 'login' } }, async (request, reply) => {
    const outcome = auth.login(request.body, clock());
    if (!outcome.ok) {
      void reply.code(outcome.status);
      return { error: outcome.error };
    }
    void reply.header('set-cookie', outcome.setCookie);
    return { username: outcome.principal.username };
  });

  /**
   * Sign out. `'required'`, which reads oddly for a logout until you see what
   * the alternative costs: an unauthenticated route that sets a cookie is a
   * route anyone can make a browser execute. There is nothing to log out of
   * without a session, and the cookie the browser holds is dead either way.
   */
  app.delete('/api/session', { config: { auth: 'required' } }, async (request, reply) => {
    void reply.header('set-cookie', auth.logoutCookie());
    // `principalOf`, not a re-check: the hook already decided, and a second
    // reading of the same request is a second definition of who was calling.
    return { signedOut: principalOf(request)?.username ?? null };
  });
};

/** Redaction, as its own function so the route reads as one decision and so a
 *  test can reach it without a server. */
export function credentialHealth(graph: CertHealth, authenticated: boolean): CredentialHealth {
  if (authenticated) return { graph };
  return {
    graph: {
      configured: graph.configured,
      redacted: true,
      note: 'the certificate’s details are disclosed to a signed-in operator only',
    },
  };
}

/**
 * The API instance. The only constructor, so its options are not something a
 * caller can get wrong:
 *
 *  - `exposeHeadRoutes: false` — Fastify would otherwise pair every GET with a
 *    HEAD, and "the router exposes GET and nothing else" is a claim worth being
 *    able to assert literally rather than with an allowlist.
 *  - routes are registered through `register`, so they are booted at `ready()`
 *    and an `onRoute` hook added by a caller still sees every one of them.
 */
export function buildApi(deps: ApiDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, exposeHeadRoutes: false, ...opts });
  void app.register(apiRoutes, deps);
  return app;
}
