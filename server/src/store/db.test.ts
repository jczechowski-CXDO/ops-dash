import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from './db.js';
import type { CheckRun } from '@ops-dash/shared';

const run = (over: Partial<CheckRun> = {}): CheckRun => ({
  serviceId: 'jira', at: new Date().toISOString(), check: 'HTTPS reachability',
  region: 'us-east', result: 'pass', latencyMs: 120, ...over,
});

let tmp: string | undefined;
const opened: Store[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) { try { s.close(); } catch { /* already closed */ } }
  if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = undefined; }
});
const onDisk = () => {
  tmp ??= mkdtempSync(join(tmpdir(), 'opsdash-'));
  return join(tmp, 'test.sqlite');
};
const open = (path: string) => { const s = openStore(path); opened.push(s); return s; };

describe('the store survives a restart', () => {
  it('reads back what a previous process wrote', () => {
    // The whole point of a store. An in-memory one passes every other test in
    // this file and fails the only claim that matters.
    const path = onDisk();
    const a = open(path);
    a.putSnapshot('vendor:jira', { data: { level: 'operational' }, fetchedAt: '2026-09-19T10:00:00.000Z', degraded: false });
    a.addRun(run({ latencyMs: 175 }));
    a.close();

    const b = open(path);
    expect(b.getSnapshot('vendor:jira')).toMatchObject({ data: { level: 'operational' } });
    expect(b.runsFor('jira')).toHaveLength(1);
  });

  it('a failed poll leaves the last good data in place, marked stale', () => {
    // BLOCKER 2 at G0. The first version of this table kept one payload per
    // source and upserted on every poll, so a failed poll OVERWROTE the good
    // data it was supposed to fall back to — and the `ok` column's comment
    // described a last-good history that could not exist with one row.
    //
    // The contract says a failed source renders its previous data with a stale
    // badge, never zeros dressed as fresh and never an empty panel.
    const s = open(':memory:');
    s.putSnapshot('v:jira', {
      data: { level: 'operational' }, fetchedAt: '2026-09-19T10:00:00.000Z', degraded: false,
    });
    s.putSnapshot('v:jira', {
      fetchedAt: '2026-09-19T10:01:00.000Z', degraded: false,
      error: { code: 'http_503', message: 'Service Unavailable' },
    });

    const out = s.getSnapshot('v:jira')!;
    expect(out.data, 'the good data must survive the failure').toEqual({ level: 'operational' });
    expect(out.fetchedAt, 'and must date from when it was good').toBe('2026-09-19T10:00:00.000Z');
    expect(out.degraded, 'while saying plainly that it is stale').toBe(true);
    expect(out.error?.code).toBe('http_503');
  });

  it('a source that has NEVER succeeded is not the same as a stale one', () => {
    // Absent is not stale. A feed that has never returned has no previous data
    // to show, and inventing one would be the wrong-green this product exists
    // to prevent — the m365 consent case exactly.
    const s = open(':memory:');
    s.putSnapshot('v:m365', {
      fetchedAt: '2026-09-19T10:00:00.000Z', degraded: false,
      error: { code: 'http_403', message: 'consent pending' },
    });
    const out = s.getSnapshot('v:m365')!;
    expect(out.data).toBeUndefined();
    expect(out.degraded).toBe(true);
    expect(out.error?.code).toBe('http_403');
  });

  it('a good poll after a failure clears the error rather than leaving it stuck', () => {
    const s = open(':memory:');
    s.putSnapshot('v:jira', { fetchedAt: '1', degraded: false, error: { code: 'http_503', message: 'x' } });
    s.putSnapshot('v:jira', { data: { level: 'operational' }, fetchedAt: '2', degraded: false });
    const out = s.getSnapshot('v:jira')!;
    expect(out.error, 'a recovered source must stop reporting the old failure').toBeUndefined();
    expect(out.degraded).toBe(false);
  });

  it('mirrors the whole SourceResult envelope, error included', () => {
    // If the store flattens an errored source it throws away the only thing
    // separating "nothing is wrong" from "we could not look" — the failure this
    // product exists to prevent, reappearing at the persistence layer.
    const s = open(':memory:');
    s.putSnapshot('vendor:zendesk', {
      fetchedAt: '2026-09-19T10:00:00.000Z', degraded: false,
      error: { code: 'non_json_2xx', message: '200 carried 412 bytes that are not JSON' },
    });
    expect(s.getSnapshot('vendor:zendesk')?.error?.code).toBe('non_json_2xx');
  });
});

describe('vendor_state is keyed on the pair', () => {
  it('two components of one vendor do not overwrite each other', () => {
    const s = open(':memory:');
    s.putVendorState('m365', 'Exchange', 'degraded', null);
    s.putVendorState('m365', 'Teams', 'operational', null);
    expect(s.getVendorState('m365', 'Exchange')?.level).toBe('degraded');
    expect(s.getVendorState('m365', 'Teams')?.level).toBe('operational');
    expect(s.allVendorState()).toHaveLength(2);
  });

  it('distinguishes never-polled from polled-and-stale', () => {
    // NULL last_successful_poll is "this feed has never returned", which is the
    // m365 consent case exactly. Storing a zero date instead would make a blind
    // feed look like a very stale one, and those get different treatment.
    const s = open(':memory:');
    s.putVendorState('m365', 'ServiceHealth', 'unknown', null);
    expect(s.getVendorState('m365', 'ServiceHealth')?.last_successful_poll).toBeNull();
  });
});

describe('check_runs answers the questions the UI asks', () => {
  it('returns undefined rather than 1 when there is nothing to measure', () => {
    // No data is not perfect uptime. This is the product's thesis in one
    // function, and the naive SUM/COUNT returns NaN or 1 here.
    const s = open(':memory:');
    expect(s.uptime('jira', '2026-01-01T00:00:00.000Z')).toBeUndefined();
    expect(s.percentiles('jira', '2026-01-01T00:00:00.000Z')).toBeUndefined();
  });

  it('computes p50 and p95 over a known distribution', () => {
    const s = open(':memory:');
    // 1..100ms. Read off the distribution by hand rather than computed with the
    // function under test — an expectation derived the same way as the code
    // only confirms the code agrees with itself.
    for (let ms = 1; ms <= 100; ms++) s.addRun(run({ latencyMs: ms, at: `2026-09-19T10:00:${String(ms % 60).padStart(2, '0')}.000Z` }));
    const p = s.percentiles('jira', '2026-01-01T00:00:00.000Z')!;
    expect(p.p50).toBeGreaterThanOrEqual(50);
    expect(p.p50).toBeLessThanOrEqual(52);
    expect(p.p95).toBeGreaterThanOrEqual(95);
    expect(p.p95).toBeLessThanOrEqual(97);
  });

  it('excludes timeouts from latency but counts them against uptime', () => {
    // A timeout has no latency (null, never 0) and must not drag the p50 down,
    // but it is emphatically not a pass.
    //
    // Timeouts DOMINATE here on purpose. The first version of this test used
    // nine passes and one timeout, and the p50 landed on 100 whether or not
    // NULLs were filtered — SQLite sorts NULLs first, so one of them could not
    // move the midpoint. It passed against a query with the filter removed.
    // With nine timeouts and one pass, an unfiltered query returns a NULL at
    // every percentile and the assertion has something to catch.
    const s = open(':memory:');
    s.addRun(run({ latencyMs: 100 }));
    for (let i = 0; i < 9; i++) s.addRun(run({ result: 'timeout', latencyMs: null }));
    const p = s.percentiles('jira', '2026-01-01T00:00:00.000Z')!;
    expect(p.p50).toBe(100);
    expect(p.p95).toBe(100);
    expect(s.uptime('jira', '2026-01-01T00:00:00.000Z')?.ratio).toBeCloseTo(0.1, 5);
  });

  it('answers the percentile query at 30 days of real volume', () => {
    // Seven services at 60s for 30 days is ~300,000 rows. This is the
    // assumption in the design most likely to be wrong, and it is cheapest to
    // find out now — if it is slow, the fix is an index and the plan was right
    // to make this measured rather than assumed.
    const s = open(':memory:');
    const start = Date.parse('2026-08-20T00:00:00.000Z');
    s.db.exec('BEGIN');
    for (let i = 0; i < 300_000; i++) {
      s.addRun(run({
        serviceId: i % 7 === 0 ? 'jira' : 'claude',
        at: new Date(start + i * 60_000).toISOString(),
        latencyMs: 100 + (i % 200),
      }));
    }
    s.db.exec('COMMIT');

    const t0 = performance.now();
    const p = s.percentiles('jira', '2026-09-01T00:00:00.000Z');
    const up = s.uptime('jira', '2026-09-01T00:00:00.000Z');
    const elapsed = performance.now() - t0;

    expect(p).toBeDefined();
    expect(up?.ratio).toBe(1);
    // And the coverage comes from the same scan as the ratio, at real volume.
    expect(up?.samples).toBe(40_389);
    // Generous on purpose — this is a smoke alarm for a missing index, not a
    // benchmark. Without check_runs_service_at it is orders of magnitude worse.
    expect(elapsed, `percentile+uptime over 300k rows took ${elapsed.toFixed(0)}ms`).toBeLessThan(2000);
  }, 60_000);
});

describe('an incident id is stable, so an ack is not orphaned', () => {
  it('upserts rather than duplicating when the same incident is written twice', () => {
    const s = open(':memory:');
    const inc = {
      id: 'vendor:jira:2026-09-19T10', ruleKey: 'vendor', serviceId: 'jira', severity: '1',
      openedAt: '2026-09-19T10:00:00.000Z', resolvedAt: null, summary: 'first',
    };
    s.putIncident(inc);
    s.putIncident({ ...inc, summary: 'second poll, same incident' });
    const open_ = s.openIncidents();
    expect(open_).toHaveLength(1);
    expect(open_[0]!['summary']).toBe('second poll, same incident');
  });

  it('resolving sets resolved_at and drops it from the open list', () => {
    const s = open(':memory:');
    const inc = {
      id: 'vendor:jira:2026-09-19T10', ruleKey: 'vendor', serviceId: 'jira', severity: '1',
      openedAt: '2026-09-19T10:00:00.000Z', resolvedAt: null, summary: 'x',
    };
    s.putIncident(inc);
    expect(s.openIncidents()).toHaveLength(1);
    s.putIncident({ ...inc, resolvedAt: '2026-09-19T11:00:00.000Z' });
    expect(s.openIncidents()).toHaveLength(0);
  });
});
