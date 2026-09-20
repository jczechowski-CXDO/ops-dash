import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, PARTIAL_READ_CODES, type Store } from './db.js';
import type { SourceResult } from '@ops-dash/shared';
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

describe('a partial read is not a failed read', () => {
  /**
   * Reported by `m4-auth`, confirmed here, and the contract had already decided
   * it. `SourceResult`'s own docblock says:
   *
   *   "`data` and `error` are NOT mutually exclusive ... Branch on `error` for
   *    the stale badge and on `data` for whether there is anything to draw;
   *    never infer one from the other."
   *
   * `putSnapshot` inferred exactly that — it read "has an error" as "has no
   * payload" and dropped the data. Right for a transport failure, where there
   * genuinely is nothing to keep; wrong for `pollEntra`'s partial, which is a
   * successful read of most of the answer plus an honest note about the rest.
   */
  const partial = (at: string, count: number, which = 'one page'): SourceResult<unknown> => ({
    data: { signals: count },
    fetchedAt: at,
    degraded: true,
    // The message names WHICH page failed, so two partials are distinguishable.
    // With one fixed message a stale-message bug is unkillable: the assertion
    // passes whichever poll the sentence came from.
    error: { code: 'entra_partial', message: `These counts are lower bounds: ${which} failed.` },
  });

  it('keeps the payload AND the error when both are present', () => {
    const s = open(':memory:');
    s.putSnapshot('entra', partial('2026-09-20T12:00:00.000Z', 7));
    const back = s.getSnapshot('entra');
    expect(back?.data, 'the payload must survive a partial').toEqual({ signals: 7 });
    expect(back?.error?.code).toBe('entra_partial');
    expect(back?.degraded).toBe(true);

    // The COLUMN, by raw SQL — a second, independent path to the same fact.
    // Without this the assertions above are satisfied by the error that rides
    // along inside the stored envelope, and `last_error` could be left NULL
    // with nothing noticing. Two reachable definitions of "was the last attempt
    // clean" must agree, or ops inspecting the table by hand sees a row that
    // contradicts what the API serves from it.
    const raw = s.db.prepare('SELECT payload, fetched_at, last_error FROM snapshots WHERE source = ?')
      .get('entra') as { payload: string | null; fetched_at: string | null; last_error: string | null };
    expect(raw.payload, 'the payload column really holds the partial').not.toBeNull();
    expect(raw.fetched_at).toBe('2026-09-20T12:00:00.000Z');
    expect(JSON.parse(raw.last_error!).code).toBe('entra_partial');
  });

  it('a FIRST poll that is partial serves data, not "we could not look"', () => {
    // The cold start. Three components on this project have shipped or nearly
    // shipped a cold-start defect; this is the store's. A fresh database whose
    // very first Entra poll is partial reached the browser with no data at all,
    // so the SPA rendered "we could not look" for a poll that looked and got
    // most of it.
    const s = open(':memory:');
    s.putSnapshot('entra', partial('2026-09-20T12:00:00.000Z', 7));
    expect(s.getSnapshot('entra')?.data).toBeDefined();
  });

  it('a later partial describes ITS OWN numbers, not an older poll’s', () => {
    // The consequence that would have been hard to find. `getSnapshot`
    // composes `{...good, degraded: true, error}` — so with the partial's
    // payload discarded, the screen showed counts from an EARLIER successful
    // poll underneath the sentence "these counts are lower bounds: one page
    // failed". A true sentence about the wrong numbers, which is the same
    // family as a false colour, one level of indirection out.
    const s = open(':memory:');
    s.putSnapshot('entra', { data: { signals: 3 }, fetchedAt: '2026-09-20T11:00:00.000Z', degraded: false });
    s.putSnapshot('entra', partial('2026-09-20T12:00:00.000Z', 9));
    const back = s.getSnapshot('entra');
    expect(back?.data, 'the message and the numbers must describe one poll').toEqual({ signals: 9 });
    expect(back?.fetchedAt).toBe('2026-09-20T12:00:00.000Z');
    expect(back?.error?.message, 'and the sentence is that poll\u2019s sentence')
      .toBe('These counts are lower bounds: one page failed.');
  });

  it('a partial after a partial pairs the NEW numbers with the NEW sentence', () => {
    // The sequence assertion in the form that can actually fail. The test above
    // has only one message in play, so it cannot distinguish "the sentence came
    // from this poll" from "there is only one sentence" — two partials with
    // DIFFERENT messages can. This is the shape the lead asked for: assert the
    // message and the numbers came from the same poll, not merely that both are
    // present.
    const s = open(':memory:');
    s.putSnapshot('entra', { data: { signals: 3 }, fetchedAt: '2026-09-20T11:00:00.000Z', degraded: false });
    s.putSnapshot('entra', partial('2026-09-20T12:00:00.000Z', 9, 'the groups page'));
    s.putSnapshot('entra', partial('2026-09-20T12:05:00.000Z', 12, 'the sign-in page'));

    const back = s.getSnapshot('entra');
    expect(back?.data).toEqual({ signals: 12 });
    expect(back?.error?.message).toBe('These counts are lower bounds: the sign-in page failed.');
    expect(back?.fetchedAt).toBe('2026-09-20T12:05:00.000Z');
    // The column too, independently: payload and last_error must have moved
    // together. If only one of the two writes landed, the API would compose a
    // mismatched pair and every assertion above that reads through getSnapshot
    // could still agree with itself.
    const raw = s.db.prepare('SELECT payload, last_error FROM snapshots WHERE source = ?')
      .get('entra') as { payload: string; last_error: string };
    expect(JSON.parse(raw.payload).data).toEqual({ signals: 12 });
    expect(JSON.parse(raw.last_error).message).toContain('sign-in page');
  });

  it('still drops nothing when a TRANSPORT failure follows a partial', () => {
    // A real failure after a partial keeps the partial as the last-good, marked
    // with the new error. The fallback chain still works; it just has one more
    // rung than it did.
    const s = open(':memory:');
    s.putSnapshot('entra', partial('2026-09-20T12:00:00.000Z', 9));
    s.putSnapshot('entra', {
      fetchedAt: '2026-09-20T12:01:00.000Z', degraded: true,
      error: { code: 'http_503', message: 'Service Unavailable' },
    });
    const back = s.getSnapshot('entra');
    expect(back?.data, 'the partial is still the best data we have').toEqual({ signals: 9 });
    expect(back?.error?.code, 'but the newest failure is what is reported').toBe('http_503');
  });

  it('a transport failure with no payload is STILL written as a failure', () => {
    // The branch that was already right must stay right. Without this the fix
    // could pass every test above by simply never calling putFailed.
    const s = open(':memory:');
    s.putSnapshot('x', {
      fetchedAt: '2026-09-20T12:00:00.000Z', degraded: true,
      error: { code: 'http_500', message: 'nope' },
    });
    const back = s.getSnapshot('x');
    expect(back?.data, 'a failed transport has nothing to draw').toBeUndefined();
    expect(back?.error?.code).toBe('http_500');
  });

  it('a later FULL success clears the partial’s error', () => {
    const s = open(':memory:');
    s.putSnapshot('entra', partial('2026-09-20T12:00:00.000Z', 9));
    s.putSnapshot('entra', { data: { signals: 12 }, fetchedAt: '2026-09-20T12:05:00.000Z', degraded: false });
    const back = s.getSnapshot('entra');
    expect(back?.data).toEqual({ signals: 12 });
    expect(back?.error, 'a clean poll is not degraded by the last one').toBeUndefined();
    expect(back?.degraded).toBe(false);
  });

  it('the partial-code set is not empty \u2014 it cannot be inert', () => {
    // Every "safe direction" assertion in this file would pass vacuously
    // against an empty set, because the default branch is the old behaviour.
    // This is the positive anchor that stops the whole feature being decoration.
    expect(PARTIAL_READ_CODES.size).toBeGreaterThan(0);
    expect(PARTIAL_READ_CODES.has('entra_partial')).toBe(true);
  });

  it('a payload carried by an UNLISTED error code does not overwrite last-good', () => {
    // The rule the first version of this fix got wrong, stated where the
    // behaviour is. A vendor adapter whose feed 503'd returns a synthesised
    // `unknown` alongside its error; that object is manufactured FROM the
    // failure, not measured, and letting it land would destroy a real reading
    // — G0 BLOCKER 2. Keying on the payload's presence did exactly that.
    const s = open(':memory:');
    s.putSnapshot('vendor:jira', {
      data: { level: 'operational' }, fetchedAt: '2026-09-20T11:00:00.000Z', degraded: false,
    });
    s.putSnapshot('vendor:jira', {
      data: { level: 'unknown' },     // manufactured by the adapter from the failure
      fetchedAt: '2026-09-20T12:00:00.000Z',
      degraded: true,
      error: { code: 'http_503', message: 'Service Unavailable' },
    });
    const back = s.getSnapshot('vendor:jira');
    expect(back?.data, 'the real reading must survive the manufactured one').toEqual({ level: 'operational' });
    expect(back?.error?.code).toBe('http_503');
  });
});
