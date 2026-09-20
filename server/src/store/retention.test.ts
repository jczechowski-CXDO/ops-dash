import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from './db.js';
import { CHECK_RUN_RETENTION_DAYS, RESOLVED_INCIDENT_RETENTION_DAYS, cutoff } from './retention.js';
import type { CheckRun } from '@ops-dash/shared';

const DAY = 24 * 60 * 60 * 1000;
/** A fixed clock. Every timestamp below is an offset from it, so nothing in
 *  this file depends on when it is run. */
const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

const opened: Store[] = [];
let tmp: string | undefined;
afterEach(() => {
  for (const s of opened.splice(0)) { try { s.close(); } catch { /* already closed */ } }
  if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = undefined; }
});
const open = (path = ':memory:') => { const s = openStore(path); opened.push(s); return s; };
const onDisk = () => {
  tmp ??= mkdtempSync(join(tmpdir(), 'opsdash-retention-'));
  return join(tmp, 'test.sqlite');
};

const run = (over: Partial<CheckRun> = {}): CheckRun => ({
  serviceId: 'jira', at: daysAgo(0), check: 'HTTPS reachability',
  region: 'us-east', result: 'pass', latencyMs: 120, ...over,
});
const countRuns = (s: Store) =>
  (s.db.prepare('SELECT COUNT(*) AS n FROM check_runs').get() as { n: number }).n;

describe('the cutoff arithmetic', () => {
  it('is exactly N days before the clock it is given', () => {
    // Pinned against a literal rather than re-derived with the same expression
    // the function uses.
    expect(cutoff(Date.UTC(2026, 8, 19, 12, 0, 0), 45)).toBe('2026-08-05T12:00:00.000Z');
    expect(cutoff(new Date(Date.UTC(2026, 8, 19, 12, 0, 0)), 180)).toBe('2026-03-23T12:00:00.000Z');
  });

  it('keeps more than the 30 days the contract publishes', () => {
    // uptime30d and the 30-day p95 are contract fields. A retention window at
    // or under 30 days truncates them with no label saying so. This asserts the
    // margin, not merely that the constants exist.
    expect(CHECK_RUN_RETENTION_DAYS).toBeGreaterThanOrEqual(35);
    // incidents90d is also a contract field, over ninety days — the security
    // review's suggested "prune resolved incidents older than the correlation
    // window" (30 minutes) would serve a hard zero on every tile.
    expect(RESOLVED_INCIDENT_RETENTION_DAYS).toBeGreaterThanOrEqual(90);
  });
});

describe('prune actually deletes', () => {
  it('removes rows older than the window and keeps the rest, counted before and after', () => {
    // The whole point. A WHERE clause that matches nothing is silent: the disk
    // keeps growing and the log line still says "pruned". So: fill a store with
    // a known split, count, prune, count again, and assert both numbers.
    const s = open();
    for (const d of [0, 1, 29, 30, 44]) s.addRun(run({ at: daysAgo(d) }));      // 5 kept
    for (const d of [46, 60, 120, 400]) s.addRun(run({ at: daysAgo(d) }));      // 4 gone
    expect(countRuns(s)).toBe(9);

    const result = s.prune(NOW);

    expect(result.checkRuns, 'the prune must report what it deleted').toBe(4);
    expect(countRuns(s), 'and the table must agree with the report').toBe(5);
    // What SURVIVED, by value — not merely "fewer rows than before".
    const survivors = (s.db.prepare('SELECT at FROM check_runs ORDER BY at').all() as Array<{ at: string }>)
      .map((r) => r.at);
    expect(survivors).toEqual([daysAgo(44), daysAgo(30), daysAgo(29), daysAgo(1), daysAgo(0)]);
  });

  it('keeps a row sitting exactly on the boundary', () => {
    // Off-by-one in the direction that loses data. The cutoff instant is inside
    // the window a 30-day query may still ask for.
    const s = open();
    s.addRun(run({ at: cutoff(NOW, CHECK_RUN_RETENTION_DAYS) }));
    s.addRun(run({ at: new Date(NOW - CHECK_RUN_RETENTION_DAYS * DAY - 1).toISOString() }));
    expect(s.prune(NOW).checkRuns).toBe(1);
    expect(countRuns(s)).toBe(1);
  });

  it('is idempotent — a second prune against the same clock deletes nothing', () => {
    const s = open();
    for (const d of [10, 100]) s.addRun(run({ at: daysAgo(d) }));
    expect(s.prune(NOW).checkRuns).toBe(1);
    expect(s.prune(NOW).checkRuns).toBe(0);
    expect(countRuns(s)).toBe(1);
  });

  it('deletes nothing when everything is inside the window', () => {
    const s = open();
    for (const d of [0, 5, 44]) s.addRun(run({ at: daysAgo(d) }));
    expect(s.prune(NOW).checkRuns).toBe(0);
    expect(countRuns(s)).toBe(3);
  });
});

describe('the numbers the contract publishes survive a prune', () => {
  it('a 30-day p95 is identical before and after pruning', () => {
    // The risk the window exists to prevent: retention quietly shortening a
    // published figure. Latencies are laid out so that the rows OUTSIDE the
    // retention window are extreme — if the prune took anything the 30-day
    // percentile needed, the number would move.
    const s = open();
    const since = new Date(NOW - 30 * DAY).toISOString();
    for (let d = 0; d < 30; d += 1) s.addRun(run({ at: daysAgo(d), latencyMs: 100 + d }));
    for (const d of [50, 60, 200]) s.addRun(run({ at: daysAgo(d), latencyMs: 9000 }));

    const before = s.percentiles('jira', since);
    const deleted = s.prune(NOW).checkRuns;
    const after = s.percentiles('jira', since);

    expect(deleted, 'the old rows must really have gone').toBe(3);
    expect(after).toEqual(before);
    // And pinned to a computed-by-hand value, so this cannot pass by both sides
    // being undefined or both being wrong in the same way. 30 sorted samples
    // 100..129; index floor(0.95*30) = 28 -> 128, index floor(0.5*30) = 15 -> 115.
    expect(after).toEqual({ p50: 115, p95: 128 });
  });

  it('uptime30d is identical before and after pruning', () => {
    const s = open();
    const since = new Date(NOW - 30 * DAY).toISOString();
    // 20 passes and 5 fails inside the window -> 0.8. Everything outside it is
    // a fail, so a prune that over-reached would raise the number.
    for (let d = 0; d < 20; d += 1) s.addRun(run({ at: daysAgo(d) }));
    for (let d = 20; d < 25; d += 1) s.addRun(run({ at: daysAgo(d), result: 'fail', latencyMs: null }));
    for (const d of [46, 90, 300]) s.addRun(run({ at: daysAgo(d), result: 'fail', latencyMs: null }));

    const before = s.uptime('jira', since);
    s.prune(NOW);
    expect(before).toBe(0.8);
    expect(s.uptime('jira', since)).toBe(0.8);
  });

  it('a service with no rows left still reports undefined, not 100%', () => {
    // No data is not perfect uptime — and a prune is a way to arrive at no data.
    const s = open();
    s.addRun(run({ at: daysAgo(200) }));
    s.prune(NOW);
    expect(s.uptime('jira', daysAgo(30))).toBeUndefined();
    expect(s.percentiles('jira', daysAgo(30))).toBeUndefined();
  });
});

describe('incident retention', () => {
  const incident = (id: string, resolvedAt: string | null, openedAt = resolvedAt ?? daysAgo(0)) => ({
    id, ruleKey: 'vendor+probe', serviceId: 'jira', severity: 'sev2',
    openedAt, resolvedAt, summary: 'redacted test incident',
  });

  it('keeps an OPEN incident however old it is', () => {
    // Age is not resolution. An incident open for a year is still the
    // operator's problem and deleting it would make it vanish from the screen.
    //
    // OPENED 400 days ago, not opened today: with a recent opened_at this test
    // passed against a prune keyed on COALESCE(resolved_at, opened_at), which
    // WOULD delete a long-open incident. Caught by mutating exactly that.
    const s = open();
    s.putIncident(incident('INC-old-open', null, daysAgo(400)));
    expect(s.prune(NOW).incidents).toBe(0);
    expect(s.openIncidents()).toHaveLength(1);
  });

  it('keeps resolved incidents the 90-day count still needs', () => {
    const s = open();
    s.putIncident(incident('INC-89d', daysAgo(89)));
    s.putIncident(incident('INC-179d', daysAgo(179)));
    s.putIncident(incident('INC-181d', daysAgo(181)));
    expect(s.prune(NOW).incidents).toBe(1);
    const left = (s.db.prepare('SELECT id FROM incidents ORDER BY id').all() as Array<{ id: string }>)
      .map((r) => r.id);
    expect(left).toEqual(['INC-179d', 'INC-89d']);
  });

  it('takes an acked incident and its actions together, foreign key and all', () => {
    // foreign_keys is ON: deleting the incident while an action references it
    // throws. This asserts the pair goes, which is the only correct outcome.
    const s = open();
    s.putIncident(incident('INC-acked', daysAgo(300)));
    s.db.prepare(`INSERT INTO incident_actions (incident_id, action, actor, at) VALUES (?, 'ack', ?, ?)`)
      .run('INC-acked', 'ops@example.com', daysAgo(300));

    const r = s.prune(NOW);
    expect(r.incidents).toBe(1);
    expect(r.incidentActions).toBe(1);
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM incident_actions').get() as { n: number }).n).toBe(0);
  });

  it('leaves the actions of an incident it is keeping alone', () => {
    const s = open();
    s.putIncident(incident('INC-recent', daysAgo(10)));
    s.db.prepare(`INSERT INTO incident_actions (incident_id, action, actor, at) VALUES (?, 'ack', ?, ?)`)
      .run('INC-recent', 'ops@example.com', daysAgo(10));
    const r = s.prune(NOW);
    expect(r.incidents).toBe(0);
    expect(r.incidentActions).toBe(0);
  });
});

describe('the prune on a real file', () => {
  it('survives a restart and does not leave a growing WAL behind', () => {
    // :memory: cannot show either of these. The WAL assertion is the reason
    // schema.sql sets journal_size_limit: a bulk delete writes every touched
    // page into the WAL and WAL does not shrink back on its own.
    const path = onDisk();
    const a = open(path);
    for (let i = 0; i < 2000; i += 1) a.addRun(run({ at: daysAgo(50 + (i % 100)) }));
    for (let i = 0; i < 100; i += 1) a.addRun(run({ at: daysAgo(i % 20) }));
    expect(a.prune(NOW).checkRuns).toBe(2000);
    a.close();

    const b = open(path);
    expect(countRuns(b), 'the deletion must be durable, not per-connection').toBe(100);
    const wal = statSync(`${path}-wal`, { throwIfNoEntry: false });
    expect(wal?.size ?? 0).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});
