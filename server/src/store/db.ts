import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckRun, ServiceId, SourceResult, StatusLevel } from '@ops-dash/shared';

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
    putIncident: db.prepare(
      `INSERT INTO incidents (id, rule_key, service_id, severity, opened_at, resolved_at, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET resolved_at = excluded.resolved_at, summary = excluded.summary`,
    ),
    openIncidents: db.prepare(`SELECT * FROM incidents WHERE resolved_at IS NULL ORDER BY opened_at DESC`),
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
  };
}
