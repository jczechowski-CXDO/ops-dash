import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckRun, ServiceId, SourceResult, StatusLevel } from '@ops-dash/shared';
import { CHECK_RUN_RETENTION_DAYS, RESOLVED_INCIDENT_RETENTION_DAYS, cutoff } from './retention.js';
import {
  foldActions,
  UnknownIncident,
  type ActionKind,
  type ActionRow,
  type IncidentFlags,
} from './incidentActions.js';

// fileURLToPath, not URL.pathname — a repo path containing a space would come
// back percent-encoded. Same defect as G-1, which cost a broken guard once.
const HERE = dirname(fileURLToPath(import.meta.url));

export type Store = ReturnType<typeof openStore>;

/**
 * The error codes that mean **"this read PARTLY succeeded, and the data is
 * real"** — as opposed to "the read failed and the adapter synthesised a
 * placeholder so the panel has something to say".
 *
 * Both shapes carry `data` AND `error`, which is why the obvious discriminator
 * does not work and why this list exists. The contract is explicit that the two
 * fields are independent (`SourceResult`'s docblock: *"never infer one from the
 * other"*), and it describes BOTH producers:
 *
 *   - a vendor adapter whose feed 503'd returns `data` holding a vendor at
 *     `unknown` whose note explains that we could not read it. That object is
 *     **manufactured from the failure**, not measured. It must never overwrite
 *     the stored last-good payload — that is G0 BLOCKER 2, and
 *     `currentLevel.test.ts` pins it.
 *   - `pollEntra` hitting its page budget returns most of the real answer plus
 *     "these counts are lower bounds". That data **was measured** and there is
 *     no other copy of it anywhere.
 *
 * Nothing in the frozen contract distinguishes them, and it cannot be inferred:
 * both are `degraded: true` with a payload and a code. So it is a closed,
 * argued set of codes, in the shape `engine/rules.ts`'s `NOT_BLINDNESS_YET`
 * already established for exactly this kind of question.
 *
 * **The default is the safe direction.** A code that is not listed here behaves
 * as it always has — the payload is not written and the last-good survives. So
 * a new adapter that forgets to register cannot silently destroy history; it
 * merely does not gain the new behaviour, which is visible as a stale panel
 * rather than as wrong numbers.
 *
 * Adding an entry is a deliberate act with a failing test attached, and it
 * belongs to whoever owns the adapter that emits the code — but nobody has to
 * REMEMBER to, because `db.test.ts` greps the adapters for a partial-shaped code
 * that is not registered here and fails naming it.
 *
 * ## THE THRESHOLD, and it is already met
 *
 * The lead's ruling (2026-09-20): *"One entry is a special case. Three is a
 * category the type system should be carrying, and at that point the amendment
 * is worth John's time."* **There are three.** The ruling was written against a
 * set that had one, twenty minutes after it had grown to three, so the condition
 * it names is satisfied now and the decision is open rather than deferred — it
 * is with the lead and John, not with this file.
 *
 * The one argument that has appeared SINCE the ruling, and that should be
 * weighed rather than assumed: the ruling's case for the closed set was that it
 * "forces them to come and add an entry, which is a moment of thought", where a
 * contract boolean would be filled in without one. The gap guard now forces the
 * visit mechanically — so the set keeps the moment of thought AND no longer
 * depends on anyone remembering, which is the combination a boolean field cannot
 * offer. That strengthens the set rather than the amendment. It does not settle
 * it, and it is not this file's call. That guard exists because
 * the first version of this set had one entry and there were already three
 * producers, spelled three different ways: `entra_partial`, `epc_partial` and
 * `partial_read`. A closed set keyed on strings that three agents each named
 * independently is exactly the kind that silently stops covering things.
 */
export const PARTIAL_READ_CODES: ReadonlySet<string> = new Set([
  'entra_partial',   // pollEntra hit its page budget
  'epc_partial',     // pollEndpoints: agents installed that have never reported
  'partial_read',    // pollEmail: one of the search windows came back short
]);

/** One `incident_actions` row, out of SQLite's untyped record and into the
 *  shape the pure fold takes. `until` is coerced to `string | null` and never
 *  to `undefined`: absent is not zero and it crosses every boundary in this
 *  codebase as an explicit null. */
function toActionRow(raw: unknown): ActionRow {
  const row = raw as Record<string, unknown>;
  const until = row['until'];
  return {
    action: row['action'] as ActionKind,
    actor: String(row['actor']),
    at: String(row['at']),
    until: typeof until === 'string' ? until : null,
  };
}

/**
 * Is this SQLite's foreign-key refusal, as opposed to any other write failure?
 *
 * Matched on the error CODE, not on the message text. `node:sqlite` puts
 * `SQLITE_CONSTRAINT_FOREIGNKEY` on `errcode`/`code`, and a message-substring
 * match would quietly start reporting a CHECK violation as a missing incident
 * the day the wording changed — turning "you sent an action verb that does not
 * exist" into a 404 about an incident that is sitting right there.
 */
function isForeignKeyViolation(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const e = cause as { code?: unknown; errcode?: unknown };
  return e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || e.errcode === 787;
}

/**
 * The store, opened once per process.
 *
 * The path is a parameter with a default rather than a constant: tests use
 * `:memory:` and the server uses a file, and a store that can only be
 * constructed one way cannot be tested honestly.
 */
export function openStore(path = 'ops-dash.sqlite') {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));

  // Prepared once and reused. The poller runs these every 60 seconds forever.
  const stmt = {
    // A good poll replaces the payload AND clears the error. A failed one
    // touches only last_attempt_at and last_error, leaving the good payload
    // exactly where it was — COALESCE is what makes the fallback work.
    putGood: db.prepare(
      `INSERT INTO snapshots (source, payload, fetched_at, last_attempt_at, last_error)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(source) DO UPDATE SET payload = excluded.payload,
         fetched_at = excluded.fetched_at, last_attempt_at = excluded.last_attempt_at,
         last_error = NULL`,
    ),
    putFailed: db.prepare(
      `INSERT INTO snapshots (source, payload, fetched_at, last_attempt_at, last_error)
       VALUES (?, NULL, NULL, ?, ?)
       ON CONFLICT(source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
         last_error = excluded.last_error`,
    ),
    // BOTH at once: a read that produced data AND has something to say about
    // what it could not reach. `pollEntra`'s partial is the live case — most of
    // the answer, plus "these counts are lower bounds". Writing it through
    // `putFailed` discarded the payload, and writing it through `putGood` would
    // throw the reason away instead; neither is the truth, so it gets its own
    // statement rather than being forced into one of the other two.
    //
    // No DDL change was needed for this — the columns were always able to hold
    // a payload and an error together. What was wrong was `putSnapshot` treating
    // the two writers as exhaustive.
    putPartial: db.prepare(
      `INSERT INTO snapshots (source, payload, fetched_at, last_attempt_at, last_error)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET payload = excluded.payload,
         fetched_at = excluded.fetched_at, last_attempt_at = excluded.last_attempt_at,
         last_error = excluded.last_error`,
    ),
    getSnapshot: db.prepare(
      `SELECT payload, fetched_at, last_attempt_at, last_error FROM snapshots WHERE source = ?`,
    ),
    addRun: db.prepare(
      `INSERT INTO check_runs (service_id, at, check_name, region, result, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    runsFor: db.prepare(
      `SELECT service_id, at, check_name, region, result, latency_ms
       FROM check_runs WHERE service_id = ? ORDER BY at DESC LIMIT ?`,
    ),
    latencies: db.prepare(
      `SELECT latency_ms FROM check_runs
       WHERE service_id = ? AND latency_ms IS NOT NULL AND at >= ?
       ORDER BY latency_ms ASC`,
    ),
    uptime: db.prepare(
      // MIN(at) comes from the same scan as the counts, deliberately. The
      // coverage behind an uptime figure has to describe the exact rows the
      // ratio was computed from — deriving it from a separate, row-capped read
      // would be a second implementation of the same question, which is how
      // this codebase has produced two answers to one question four times.
      `SELECT
         SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) AS passed,
         COUNT(*) AS total,
         MIN(at)  AS oldest
       FROM check_runs WHERE service_id = ? AND at >= ?`,
    ),
    putVendorState: db.prepare(
      `INSERT INTO vendor_state (vendor, component, level, last_successful_poll, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(vendor, component) DO UPDATE SET level = excluded.level,
         last_successful_poll = excluded.last_successful_poll, updated_at = excluded.updated_at`,
    ),
    getVendorState: db.prepare(
      `SELECT level, last_successful_poll FROM vendor_state WHERE vendor = ? AND component = ?`,
    ),
    allVendorState: db.prepare(`SELECT vendor, component, level, last_successful_poll FROM vendor_state`),
    // `severity` IS in the update list, and it was not until the integration
    // test caught it. The engine escalates correctly — `carryForward` takes the
    // finding's severity, so a vendor moving degraded -> outage raises the
    // incident — but the store kept the value it opened with, and the API reads
    // the store. An incident that opened Sev2 and escalated to Sev1 was served
    // to the operator as a Sev2 for as long as it lasted.
    //
    // `opened_at` is deliberately NOT updated: an existing incident's start time
    // must never move, or the duration on the detail page shrinks every tick.
    // `rule_key` and `service_id` are not updated either — they are the identity
    // the id was hashed from, so a row where they differed would mean a hash
    // collision, and quietly overwriting them would hide it.
    putIncident: db.prepare(
      `INSERT INTO incidents (id, rule_key, service_id, severity, opened_at, resolved_at, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         severity    = excluded.severity,
         resolved_at = excluded.resolved_at,
         summary     = excluded.summary`,
    ),
    openIncidents: db.prepare(`SELECT * FROM incidents WHERE resolved_at IS NULL ORDER BY opened_at DESC`),
    // Open, PLUS anything resolved recently enough to still own its identity.
    // The correlation engine needs both: a condition that clears and comes back
    // inside its window must re-open the same incident rather than opening a
    // second one, and it cannot recognise a prior it was never handed. Feeding
    // it `openIncidents` alone leaves that whole branch of the engine dead in
    // production while its unit tests pass.
    incidentsSince: db.prepare(
      `SELECT * FROM incidents WHERE resolved_at IS NULL OR resolved_at >= ? ORDER BY opened_at DESC`,
    ),
    // The operator's OVERRIDES, not the rules themselves. A row here means
    // "somebody turned this rule off (or explicitly back on)"; a rule with no
    // row has never been touched and runs at the default declared beside it in
    // `engine/rules.ts`, which is where the default lives and the only place it
    // lives. The table is emphatically NOT the source of truth for whether a
    // rule runs — `evaluate` reads it as `enabled[key] ?? RULES[key].enabled`.
    allRuleState: db.prepare(`SELECT key, enabled FROM rule_state`),
    putRuleState: db.prepare(
      `INSERT INTO rule_state (key, enabled) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled`,
    ),
    // The operator's actions against one incident, append-only. `until` is
    // meaningful for `mute` and NULL for everything else — a column that is
    // null for three of four verbs, rather than four tables.
    addAction: db.prepare(
      `INSERT INTO incident_actions (incident_id, action, actor, at, until) VALUES (?, ?, ?, ?, ?)`,
    ),
    // ORDER BY at, rowid. `at` alone is not a total order — two actions can
    // share a millisecond, and "the last instruction wins" is meaningless
    // without a tiebreak. rowid is insertion order and is the only thing here
    // that cannot tie.
    actionsFor: db.prepare(
      `SELECT action, actor, at, until FROM incident_actions
       WHERE incident_id = ? ORDER BY at, rowid`,
    ),
    allActions: db.prepare(
      `SELECT incident_id, action, actor, at, until FROM incident_actions ORDER BY at, rowid`,
    ),
    // `resolved_at IS NULL` in the WHERE: resolving twice must not move the
    // first resolution's timestamp forward. The row already exists — the action
    // insert's foreign key proved it — so zero changes here means "already
    // resolved", which is not an error.
    markResolved: db.prepare(
      `UPDATE incidents SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL`,
    ),
    // `at < ?` and not `<=`: the cutoff instant itself is inside the window a
    // 30-day query may still ask for. See retention.ts for the windows.
    deleteCheckRuns: db.prepare(`DELETE FROM check_runs WHERE at < ?`),
    // Actions first, then the incidents they reference — `PRAGMA foreign_keys`
    // is ON, so the other order fails on any incident that was ever acked.
    // An OPEN incident is never pruned however old it is: it is still the
    // operator's problem, and age is not resolution.
    deleteIncidentActions: db.prepare(
      `DELETE FROM incident_actions WHERE incident_id IN
         (SELECT id FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?)`,
    ),
    deleteResolvedIncidents: db.prepare(
      `DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?`,
    ),
  };

  /* --------------------------------------------------- operator actions */

  /**
   * Record one action against one incident.
   *
   * `actor` and `at` are both PARAMETERS. The store holds no opinion about who
   * the user is — that answer belongs to exactly one module and this is not it
   * — and it reads no clock, because a hidden `new Date()` here is a second
   * clock beside the one the poller and the API already inject, and two clocks
   * is how a test comes to pass against a time it did not choose.
   *
   * Throws `UnknownIncident` when the id names nothing. That is the foreign key
   * doing its job, translated: a route can answer 404 from it, where SQLite's
   * own message would become a 500 with the constraint name in it.
   * `api/routes.ts` already rules that the write path throws and the read path
   * degrades, and this is the write path.
   *
   * Declared here rather than as a method so the siblings below can call it
   * without `this` — a store method pulled off the object (`const { mute } =
   * store`) would otherwise break, and nothing in the type says it would.
   */
  const recordAction = (a: {
    incidentId: string;
    action: ActionKind;
    actor: string;
    at: string;
    until?: string | null;
  }): void => {
    // An action attributed to nobody is exactly as useless as one attributed to
    // an incident that does not exist, and this row is the audit record — the
    // only durable answer to "who silenced this". `auth/session.ts`'s `actorOf`
    // already throws rather than defaulting, so an empty actor arriving here is
    // a wiring mistake upstream, not user input; it gets a throw and no route
    // should have a branch for it. Defence in depth, on the write path, where a
    // value that is wrong gets persisted and outlives the bug that made it.
    if (a.actor.trim() === '') {
      throw new Error(`refusing to record a ${a.action} with no actor`);
    }
    try {
      // Stored VERBATIM — trimmed only for the emptiness test above, never for
      // the column. Tidying an identity on its way into an audit trail means
      // the name that comes back is not the name that was recorded, and the one
      // question this table exists to answer is exactly that one.
      stmt.addAction.run(a.incidentId, a.action, a.actor, a.at, a.until ?? null);
    } catch (cause) {
      // Narrow: only the FK failure becomes UnknownIncident. A CHECK violation
      // or a disk error is a different fact and must not be reported as a
      // missing incident.
      if (isForeignKeyViolation(cause)) throw new UnknownIncident(a.incidentId, { cause });
      throw cause;
    }
  };

  /** The raw log for one incident, oldest first. The fold is the answer to "is
   *  it acked"; this is the answer to "what happened", and a timeline needs
   *  both. */
  const actionsFor = (incidentId: string): ActionRow[] =>
    stmt.actionsFor.all(incidentId).map(toActionRow);

  return {
    db,
    close: () => db.close(),

    /**
     * Three outcomes, not two.
     *
     * The contract decided this and this function used to disagree with it.
     * `SourceResult`'s own docblock: *"`data` and `error` are NOT mutually
     * exclusive ... Branch on `error` for the stale badge and on `data` for
     * whether there is anything to draw; **never infer one from the other**."*
     * The old two-branch form inferred exactly that — it read "has an error" as
     * "has no payload" and dropped the data on the floor.
     *
     *   error, code in PARTIAL_READ_CODES -> a partial read. The data is real
     *                       and exists nowhere else, so keep the payload AND the
     *                       error together.
     *   error, anything else -> the read failed. Whatever `data` it carries is a
     *                       placeholder manufactured from the failure, so the
     *                       previous good payload stays where it is and becomes
     *                       the stale panel's content. This is the default, and
     *                       it is the safe direction.
     *   no error         -> a clean read. Replaces the payload and clears the
     *                       error.
     *
     * The middle branch is NOT `result.data === undefined`. That was the first
     * fix and it was wrong: a vendor adapter whose feed 503'd returns a
     * synthesised `unknown` payload alongside its error, so keying on the
     * payload's presence overwrote a real `operational` reading with a
     * manufactured one. `currentLevel.test.ts`'s G2 HIGH 4 test caught it
     * immediately, which is the system working.
     *
     * A partial OVERWRITES an older fully-good payload, deliberately. It is
     * newer real data, and the alternative is worse in a way that is hard to
     * see: `getSnapshot` composes `{...good, degraded: true, error}`, so keeping
     * the older payload would render an earlier poll's numbers underneath this
     * poll's "these counts are lower bounds" — a true sentence about the wrong
     * data. Newer-and-labelled beats older-and-mislabelled.
     */
    putSnapshot(source: string, result: SourceResult<unknown>) {
      if (result.error && !(result.data !== undefined && PARTIAL_READ_CODES.has(result.error.code))) {
        stmt.putFailed.run(source, result.fetchedAt, JSON.stringify(result.error));
      } else if (result.error) {
        stmt.putPartial.run(
          source, JSON.stringify(result), result.fetchedAt, result.fetchedAt, JSON.stringify(result.error),
        );
      } else {
        stmt.putGood.run(source, JSON.stringify(result), result.fetchedAt, result.fetchedAt);
      }
    },

    /**
     * The last good payload, carrying the last failure if there was one.
     *
     * This is the shape DATA_CONTRACTS describes for a stale panel: previous
     * data, visibly stale, with the reason attached — never zeros dressed as
     * fresh, and never an empty panel because one poll failed. `degraded` is
     * true exactly when the newest attempt did not succeed.
     */
    getSnapshot(source: string): SourceResult<unknown> | undefined {
      const row = stmt.getSnapshot.get(source) as
        | { payload: string | null; fetched_at: string | null; last_attempt_at: string; last_error: string | null }
        | undefined;
      if (!row) return undefined;
      const error = row.last_error ? (JSON.parse(row.last_error) as SourceResult<unknown>['error']) : undefined;
      if (!row.payload) {
        // Never succeeded. Not the same as stale, and must not read as data.
        return { fetchedAt: row.last_attempt_at, degraded: true, ...(error ? { error } : {}) };
      }
      const good = JSON.parse(row.payload) as SourceResult<unknown>;
      return error ? { ...good, degraded: true, error } : good;
    },

    addRun(run: CheckRun) {
      stmt.addRun.run(run.serviceId, run.at, run.check, run.region, run.result, run.latencyMs);
    },
    runsFor(serviceId: ServiceId, limit = 5): CheckRun[] {
      const rows = stmt.runsFor.all(serviceId, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        serviceId: r['service_id'] as ServiceId,
        at: r['at'] as string,
        check: r['check_name'] as string,
        region: r['region'] as string,
        result: r['result'] as CheckRun['result'],
        latencyMs: (r['latency_ms'] as number | null) ?? null,
      }));
    },
    /** p50 / p95 over a window. Computed here rather than in SQL because
     *  SQLite has no percentile function and a NTILE window is slower than
     *  reading an indexed, already-sorted column. */
    percentiles(serviceId: ServiceId, since: string): { p50: number; p95: number } | undefined {
      const rows = stmt.latencies.all(serviceId, since) as Array<{ latency_ms: number }>;
      if (rows.length === 0) return undefined;
      const at = (q: number) => rows[Math.min(rows.length - 1, Math.floor(q * rows.length))]!.latency_ms;
      return { p50: at(0.5), p95: at(0.95) };
    },
    /** 0-1. Returns undefined rather than 1 when there is nothing to measure —
     *  no data is not perfect uptime, which is this product's whole thesis. */
    /**
     * The pass ratio over a window, WITH the coverage behind it.
     *
     * `undefined` when nothing was measured — never 1, never 0, because both
     * are readings nobody took. When something was measured, the caller also
     * gets `samples` and `from`, so a true 100% over forty minutes can be
     * rendered as forty minutes rather than as a month (G5 HIGH 2).
     */
    uptime(
      serviceId: ServiceId,
      since: string,
    ): { ratio: number; samples: number; from: string } | undefined {
      const row = stmt.uptime.get(serviceId, since) as {
        passed: number | null;
        total: number;
        oldest: string | null;
      };
      if (row.total === 0 || row.oldest === null) return undefined;
      return { ratio: (row.passed ?? 0) / row.total, samples: row.total, from: row.oldest };
    },

    putVendorState(vendor: string, component: string, level: StatusLevel, lastPoll: string | null) {
      stmt.putVendorState.run(vendor, component, level, lastPoll, new Date().toISOString());
    },
    getVendorState(vendor: string, component: string) {
      return stmt.getVendorState.get(vendor, component) as
        | { level: StatusLevel; last_successful_poll: string | null }
        | undefined;
    },
    allVendorState() {
      return stmt.allVendorState.all() as Array<{
        vendor: string;
        component: string;
        level: StatusLevel;
        last_successful_poll: string | null;
      }>;
    },

    putIncident(i: {
      id: string; ruleKey: string; serviceId: string; severity: string;
      openedAt: string; resolvedAt: string | null; summary: string;
    }) {
      stmt.putIncident.run(i.id, i.ruleKey, i.serviceId, i.severity, i.openedAt, i.resolvedAt, i.summary);
    },
    openIncidents() {
      return stmt.openIncidents.all() as Array<Record<string, unknown>>;
    },
    /** Every incident the correlator could still be responsible for at `since`:
     *  all open ones, and those resolved at or after `since`. Pass the start of
     *  the correlation window. */
    incidentsSince(since: string) {
      return stmt.incidentsSince.all(since) as Array<Record<string, unknown>>;
    },

    /**
     * Every operator override, as booleans.
     *
     * Two conversions that look like fussiness and are not:
     *
     * `enabled` is an INTEGER column — SQLite has no boolean — so this comes
     * back as a number, and anything downstream doing a truthiness check would
     * be one refactor away from testing the STRING `"0"`, which is true. Same
     * class as the severity `"1.0"` round-trip the engine hit in M2. The
     * comparison is made here, once, against the number.
     *
     * An ABSENT key is not `false`. It is "no override", and `evaluate` falls
     * back to the rule's own default for it, so a fresh database with an empty
     * table leaves both rules ON. Returning a key with `false` for a rule
     * nobody has touched would silently disable the entire product, and the
     * symptom — a dashboard that never raises anything — is indistinguishable
     * from a quiet day. Hence: only rows that exist appear here.
     */
    ruleState(): Record<string, boolean> {
      const rows = stmt.allRuleState.all() as Array<{ key: string; enabled: number | bigint }>;
      return Object.fromEntries(rows.map((r) => [r.key, Number(r.enabled) !== 0]));
    },

    /** Record one override. `node:sqlite` will not bind a JS boolean, so the
     *  1/0 conversion happens here rather than at each call site. */
    setRuleState(key: string, enabled: boolean): void {
      stmt.putRuleState.run(key, enabled ? 1 : 0);
    },

    recordAction,
    actionsFor,

    /** Acknowledged HERE. Nothing upstream is told, and nothing upstream could
     *  be: everything this process reads is read-only, and an "acknowledge"
     *  that reached into Microsoft's service health would be a mutating
     *  third-party call this repo does not make. */
    acknowledge(incidentId: string, actor: string, at: string): void {
      recordAction({ incidentId, action: 'ack', actor, at });
    },

    /** `until === null` is an indefinite mute — until somebody unmutes it. */
    mute(incidentId: string, actor: string, until: string | null, at: string): void {
      recordAction({ incidentId, action: 'mute', actor, at, until });
    },

    unmute(incidentId: string, actor: string, at: string): void {
      recordAction({ incidentId, action: 'unmute', actor, at });
    },

    /**
     * Resolve by hand: log who did it, and set `resolved_at`.
     *
     * One transaction, because an action row saying "resolved" beside an
     * incident that is still open is a worse state than either alone.
     *
     * **A manual resolve does not make a live condition false.** If the rule is
     * still firing, the next correlation tick reopens this incident — same id,
     * because `correlate`'s `carryForward` strips `resolvedAt` and keeps the
     * identity. That is the honest outcome rather than a bug to suppress: the
     * operator sees it come back, which is true, instead of a screen that
     * agrees with them while the service is still down. The ack and the mute
     * survive it, because actions live in their own table keyed on the incident
     * id and never on the incident row's lifecycle.
     *
     * Resolving an already-resolved incident logs the action and leaves the
     * original `resolved_at` where it was. The first resolution is when it
     * stopped; a second press must not make the outage look shorter.
     */
    resolveIncident(incidentId: string, actor: string, at: string): void {
      db.exec('BEGIN IMMEDIATE');
      try {
        // Action first: its foreign key is what proves the incident exists, so
        // an unknown id fails before anything has been written.
        recordAction({ incidentId, action: 'resolve', actor, at });
        stmt.markResolved.run(at, incidentId);
        db.exec('COMMIT');
      } catch (cause) {
        db.exec('ROLLBACK');
        throw cause;
      }
    },

    /**
     * The contract's `ack` / `muted` for one incident, as of `now`.
     *
     * `now` is a parameter because a mute EXPIRES, and whether it has is a
     * question about a clock. Defaulted for the convenience of a route that has
     * no opinion; injected by every test.
     */
    incidentFlags(incidentId: string, now: Date | number | string = new Date()): IncidentFlags {
      return foldActions(actionsFor(incidentId), now);
    },

    /**
     * Flags for every incident that has any, in one query.
     *
     * For hydrating a list: the alternative is one query per row, and the list
     * route already reads every open incident. An incident with no live flags
     * is ABSENT from this record rather than present with an empty object — an
     * empty object would read as "this one has flags" to anyone checking for
     * the key, and a caller spreading `flags[id] ?? {}` gets the right answer
     * either way.
     */
    allIncidentFlags(now: Date | number | string = new Date()): Record<string, IncidentFlags> {
      const byIncident = new Map<string, ActionRow[]>();
      for (const raw of stmt.allActions.all()) {
        const id = String((raw as Record<string, unknown>)['incident_id']);
        const list = byIncident.get(id);
        if (list) list.push(toActionRow(raw));
        else byIncident.set(id, [toActionRow(raw)]);
      }
      const out: Record<string, IncidentFlags> = {};
      for (const [id, rows] of byIncident) {
        const flags = foldActions(rows, now);
        if (flags.ack || flags.muted) out[id] = flags;
      }
      return out;
    },

    /**
     * Delete what is older than the retention windows. Idempotent; safe to call
     * on a schedule and safe to call twice.
     *
     * Returns the counts it actually deleted rather than void, for one reason:
     * a retention function whose WHERE clause matches nothing is the classic
     * version of this bug and is completely silent — the disk keeps growing and
     * the daily log line still says "pruned". The caller should log these
     * numbers, and the tests assert them against a store they filled.
     *
     * One transaction, because deleting the actions and leaving their incidents
     * behind (or the reverse, which foreign_keys would refuse) is a worse state
     * than deleting nothing.
     */
    prune(now: Date | number = new Date(), days: { checkRuns?: number; resolvedIncidents?: number } = {}) {
      const checkRunsBefore = cutoff(now, days.checkRuns ?? CHECK_RUN_RETENTION_DAYS);
      const incidentsBefore = cutoff(now, days.resolvedIncidents ?? RESOLVED_INCIDENT_RETENTION_DAYS);
      db.exec('BEGIN IMMEDIATE');
      try {
        const checkRuns = Number(stmt.deleteCheckRuns.run(checkRunsBefore).changes);
        const incidentActions = Number(stmt.deleteIncidentActions.run(incidentsBefore).changes);
        const incidents = Number(stmt.deleteResolvedIncidents.run(incidentsBefore).changes);
        db.exec('COMMIT');
        return { checkRuns, incidents, incidentActions, checkRunsBefore, incidentsBefore };
      } catch (cause) {
        db.exec('ROLLBACK');
        throw cause;
      }
    },
  };
}
