import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckRun, ServiceId, SourceResult, StatusLevel } from '@ops-dash/shared';
import { CHECK_RUN_RETENTION_DAYS, RESOLVED_INCIDENT_RETENTION_DAYS, cutoff } from './retention.js';

// fileURLToPath, not URL.pathname — a repo path containing a space would come
// back percent-encoded. Same defect as G-1, which cost a broken guard once.
const HERE = dirname(fileURLToPath(import.meta.url));

export type Store = ReturnType<typeof openStore>;

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
      `SELECT
         SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) AS passed,
         COUNT(*) AS total
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

  return {
    db,
    close: () => db.close(),

    putSnapshot(source: string, result: SourceResult<unknown>) {
      if (result.error) {
        stmt.putFailed.run(source, result.fetchedAt, JSON.stringify(result.error));
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
    uptime(serviceId: ServiceId, since: string): number | undefined {
      const row = stmt.uptime.get(serviceId, since) as { passed: number | null; total: number };
      return row.total === 0 ? undefined : (row.passed ?? 0) / row.total;
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
