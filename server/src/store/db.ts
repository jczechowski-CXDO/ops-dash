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
    putSnapshot: db.prepare(
      `INSERT INTO snapshots (source, payload, fetched_at, ok) VALUES (?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET payload = excluded.payload,
         fetched_at = excluded.fetched_at, ok = excluded.ok`,
    ),
    getSnapshot: db.prepare(`SELECT payload, fetched_at, ok FROM snapshots WHERE source = ?`),
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
      stmt.putSnapshot.run(source, JSON.stringify(result), result.fetchedAt, result.error ? 0 : 1);
    },
    /** The whole envelope back, so the API can mirror it outward unchanged. */
    getSnapshot(source: string): SourceResult<unknown> | undefined {
      const row = stmt.getSnapshot.get(source) as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as SourceResult<unknown>) : undefined;
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
