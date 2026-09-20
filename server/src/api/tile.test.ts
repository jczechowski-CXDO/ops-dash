import { describe, it, expect, afterEach } from 'vitest';
import type { CheckRun, ServiceId } from '@ops-dash/shared';
import { openStore, type Store } from '../store/db.js';
import { oursFor } from '../store/ours.js';
import {
  buildTile,
  latestPerCheck,
  OUR_LABEL,
  SPARK_SAMPLES,
  RUN_WINDOW,
  UPTIME_WINDOW_DAYS,
  INCIDENT_WINDOW_DAYS,
  type TileStore,
} from './tile.js';

/* --------------------------------------------------------------- fixtures */

const opened: Store[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
});
const memStore = () => {
  const s = openStore(':memory:');
  opened.push(s);
  return s;
};

/**
 * Deliberately months away from the wall clock.
 *
 * Every window here is measured from an injected `now`, and a fixture dated
 * today makes a test that cannot tell the difference: with `NOW` set to the day
 * the suite was written, swapping `now` for `new Date()` inside the code under
 * test changed no answer and every assertion stayed green. Found by mutation,
 * fixed by moving the fixture clock.
 */
const NOW = new Date('2026-06-01T12:00:00.000Z');
const minutesBefore = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const run = (over: Partial<CheckRun> & { at: string }): CheckRun => ({
  serviceId: 'zendesk',
  check: 'Help centre reachable',
  region: 'us-east',
  result: 'pass',
  latencyMs: 120,
  ...over,
});

/** A store whose every check-run read throws. The only honest way to exercise
 *  the read-failure path: a control that cannot fail proves nothing. */
const brokenRuns = (over: Partial<TileStore> = {}): TileStore => ({
  runsFor() {
    throw new Error('database connection is not open');
  },
  percentiles() {
    throw new Error('database connection is not open');
  },
  uptime() {
    throw new Error('database connection is not open');
  },
  incidentsSince() {
    return [];
  },
  ...over,
});

/* ------------------------------------------------- the store shape is real */

describe('the tile depends on the store only through a shape the store really has', () => {
  it('the real Store satisfies TileStore', () => {
    // Typecheck-mode assertion (vitest typecheck is on): renaming runsFor,
    // percentiles, uptime or incidentsSince in db.ts fails HERE.
    const widened: TileStore = memStore();
    expect(typeof widened.runsFor).toBe('function');
    expect(typeof widened.percentiles).toBe('function');
    expect(typeof widened.uptime).toBe('function');
    expect(typeof widened.incidentsSince).toBe('function');
  });
});

/* ------------------------------------------------ the no-data tile, pinned */

describe('a service with no probe data reports no data, not zero', () => {
  const emptyTile = () => buildTile(memStore(), 'm365', NOW);

  it('does not report 100% uptime', () => {
    // The literal that matters. 1 would be "a perfect month"; 0 would be "a
    // month of total outage"; both are measurements we did not take.
    expect(emptyTile().uptime30d).toBe(null);
  });

  it('does not report a latency, a p50 or a p95 of zero', () => {
    const tile = emptyTile();
    expect(tile.latencyMs).toBe(null);
    expect(tile.p50Ms).toBe(null);
    expect(tile.p95Ms).toBe(null);
  });

  it('does not report a flat sparkline at zero, or an empty one', () => {
    // null, not []. `[]` is "we have a series and it has no points"; a view
    // that renders a zero-length polyline has drawn a claim about latency.
    expect(emptyTile().spark).toBe(null);
  });

  it('does not report a last state change', () => {
    expect(emptyTile().lastStateChange).toBe(null);
  });

  it('reports ours as unknown with zero of zero, and never as passing', () => {
    expect(emptyTile().ours).toEqual({
      level: 'unknown',
      label: 'No checks',
      note: 'No probe of ours has ever run for this service.',
      passing: 0,
      total: 0,
    });
  });

  it('counts zero incidents, because our own incident log is authoritative', () => {
    // The one field that is legitimately 0 rather than null when empty, and the
    // asymmetry is deliberate: uptime is a ratio over evidence we do not have,
    // while this counts rows in a table we write ourselves and never lose.
    expect(emptyTile().incidents90d).toBe(0);
  });
});

/* --------------------------------------------------------------- our half */

describe('ours.level is the engine’s reading of the same counts, never a second opinion', () => {
  const tileWith = (results: Array<CheckRun['result']>) => {
    const store = memStore();
    results.forEach((result, i) => {
      store.addRun(run({ serviceId: 'zendesk', check: `probe ${i}`, at: minutesBefore(1), result }));
    });
    return buildTile(store, 'zendesk', NOW);
  };

  it('all checks passing is operational / Passing', () => {
    const tile = tileWith(['pass', 'pass']);
    expect(tile.ours.level).toBe('operational');
    expect(tile.ours.label).toBe('Passing');
    expect(tile.ours.passing).toBe(2);
    expect(tile.ours.total).toBe(2);
  });

  it('one check of two failing is outage / Failing — a partial pass is still failing', () => {
    const tile = tileWith(['pass', 'fail']);
    expect(tile.ours.level).toBe('outage');
    expect(tile.ours.label).toBe('Failing');
    expect(tile.ours.passing).toBe(1);
  });

  it('a timeout counts as failing, not as a missing sample', () => {
    expect(tileWith(['timeout']).ours.level).toBe('outage');
  });

  it('zero checks is unknown, matching ourCheckFailing’s "no evidence"', () => {
    // Pinned as a literal rather than compared with ourCheckFailing(): reaching
    // the answer through the same function the code called would pass however
    // wrong both were.
    expect(tileWith([]).ours.level).toBe('unknown');
  });

  it('offers exactly four labels, and Slow is not one of them', () => {
    // Named for what it checks — the label SET — rather than for "never emits",
    // which this cannot see: a hardcoded 'Slow' elsewhere in the module would
    // not fail here. The frozen contract's comment lists 'Slow'; no latency
    // budget exists anywhere in this repo, so no reading can produce it, and a
    // label nothing emits is the defect the 'Advisory' correction fixed one
    // field over.
    expect(Object.values(OUR_LABEL)).toEqual(['Passing', 'Failing', 'No checks', 'Unknown']);
  });

  it('counts the latest run of each check, not the last N rows', () => {
    // Zendesk has two probes on one tile. Three polls of both is six rows and
    // still 2 checks: a raw row count would report 5/6 passing for one dead pod.
    const store = memStore();
    for (const minutes of [3, 2, 1]) {
      store.addRun(run({ check: 'pod A', at: minutesBefore(minutes), result: 'pass' }));
      store.addRun(run({ check: 'pod B', at: minutesBefore(minutes), result: 'fail', latencyMs: null }));
    }
    const tile = buildTile(store, 'zendesk', NOW);
    expect(tile.ours.total).toBe(2);
    expect(tile.ours.passing).toBe(1);
  });

  it('names the failing checks and the MOST RECENT success in the note', () => {
    const store = memStore();
    // Two successes, so "last" and "first" are different answers. With one, a
    // mutation reversing the search stayed green — the fixture could not tell
    // the two apart.
    store.addRun(run({ check: 'pod A', region: 'us-east', at: minutesBefore(40), result: 'pass' }));
    store.addRun(run({ check: 'pod A', region: 'us-east', at: minutesBefore(9), result: 'pass' }));
    store.addRun(run({ check: 'pod B', region: 'eu-west', at: minutesBefore(1), result: 'fail', latencyMs: null }));
    expect(buildTile(store, 'zendesk', NOW).ours.note).toBe(
      '1 of 2 checks passing. Failing: pod B (eu-west). Last success 2026-06-01T11:51:00.000Z.',
    );
  });

  it('says so when no run in the retained window succeeded, rather than omitting it', () => {
    const store = memStore();
    store.addRun(run({ check: 'pod A', at: minutesBefore(1), result: 'fail', latencyMs: null }));
    expect(buildTile(store, 'zendesk', NOW).ours.note).toBe(
      '0 of 1 checks passing. Failing: pod A (us-east). No successful run in the retained history.',
    );
  });

  it('agrees with index.ts’s oursFor over the same store', () => {
    // Two independently written implementations of latest-per-check, compared.
    // This exists because `oursFor` still lives in index.ts, which this agent
    // does not own; when it is moved to delegate to `latestPerCheck` the test
    // becomes trivially true rather than wrong. Until then it is the thing that
    // goes red on the day they diverge.
    const store = memStore();
    for (const minutes of [5, 4, 3, 2, 1]) {
      store.addRun(run({ check: 'pod A', at: minutesBefore(minutes), result: minutes === 1 ? 'fail' : 'pass' }));
      store.addRun(run({ check: 'pod B', at: minutesBefore(minutes), result: 'pass' }));
    }
    const mine = latestPerCheck(store, 'zendesk');
    expect({
      passing: mine.filter((r) => r.result === 'pass').length,
      total: mine.length,
    }).toEqual(oursFor(store, 'zendesk'));
  });
});

/* ------------------------------------------------------------ the numbers */

describe('latency, percentiles and uptime are measurements or they are absent', () => {
  it('latencyMs is the newest run’s latency', () => {
    const store = memStore();
    store.addRun(run({ at: minutesBefore(2), latencyMs: 300 }));
    store.addRun(run({ at: minutesBefore(1), latencyMs: 175 }));
    expect(buildTile(store, 'zendesk', NOW).latencyMs).toBe(175);
  });

  it('latencyMs is null when the newest probe did not answer, not the last good one', () => {
    // 300 ms from two minutes ago is not the latency of a probe that just timed
    // out. Serving it would put a healthy number beside a failing tile.
    const store = memStore();
    store.addRun(run({ at: minutesBefore(2), latencyMs: 300 }));
    store.addRun(run({ at: minutesBefore(1), result: 'timeout', latencyMs: null }));
    expect(buildTile(store, 'zendesk', NOW).latencyMs).toBe(null);
  });

  it('serves p50 and p95 from the store, both or neither', () => {
    const store = memStore();
    [100, 100, 100, 900].forEach((ms, i) => store.addRun(run({ at: minutesBefore(4 - i), latencyMs: ms })));
    const tile = buildTile(store, 'zendesk', NOW);
    expect(tile.p50Ms).toBe(100);
    expect(tile.p95Ms).toBe(900);
  });

  it('has no percentiles when every run in the window failed', () => {
    const store = memStore();
    store.addRun(run({ at: minutesBefore(1), result: 'fail', latencyMs: null }));
    const tile = buildTile(store, 'zendesk', NOW);
    expect(tile.p50Ms).toBe(null);
    expect(tile.p95Ms).toBe(null);
  });

  it('measures uptime over thirty days, not some other number of days', () => {
    // 31 and 29 as LITERALS. Written as `UPTIME_WINDOW_DAYS + 1` this reached
    // the window through the same constant the code did, and widening the
    // window to 90 days left it green — it asserted "the window is the window".
    expect(UPTIME_WINDOW_DAYS).toBe(30);
    const store = memStore();
    store.addRun(run({ at: daysBefore(29), result: 'fail', latencyMs: null }));
    store.addRun(run({ at: daysBefore(31), result: 'pass' }));
    // Only the 29-day-old failure is inside a thirty-day window.
    expect(buildTile(store, 'zendesk', NOW).uptime30d).toBe(0);
  });

  it('uptime30d is the ratio of passes to runs in the window', () => {
    const store = memStore();
    store.addRun(run({ at: minutesBefore(1), result: 'pass' }));
    store.addRun(run({ at: minutesBefore(2), result: 'fail', latencyMs: null }));
    expect(buildTile(store, 'zendesk', NOW).uptime30d).toBe(0.5);
  });

  it('uptime30d is null, never 1, when the window holds nothing', () => {
    const store = memStore();
    store.addRun(run({ at: daysBefore(31), result: 'pass' }));
    expect(buildTile(store, 'zendesk', NOW).uptime30d).toBe(null);
  });
});

/* ---------------------------------------------------------------- sparkline */

describe('the sparkline is the samples we have, holes included', () => {
  it('is oldest first', () => {
    const store = memStore();
    store.addRun(run({ at: minutesBefore(3), latencyMs: 111 }));
    store.addRun(run({ at: minutesBefore(2), latencyMs: 222 }));
    store.addRun(run({ at: minutesBefore(1), latencyMs: 333 }));
    expect(buildTile(store, 'zendesk', NOW).spark).toEqual([111, 222, 333]);
  });

  it('caps at 28 samples and keeps the newest ones', () => {
    const store = memStore();
    for (let i = 40; i >= 1; i--) store.addRun(run({ at: minutesBefore(i), latencyMs: i }));
    const spark = buildTile(store, 'zendesk', NOW).spark!;
    // 28 as a literal: `SPARK_SAMPLES` on both sides would assert that the cap
    // is the cap, and a cap of 10 would pass.
    expect(SPARK_SAMPLES).toBe(28);
    expect(spark.length).toBe(28);
    // Oldest kept is 28 minutes ago (value 28), newest is 1 minute ago.
    expect(spark[0]).toBe(28);
    expect(spark.at(-1)).toBe(1);
  });

  it('carries a probe that did not answer as null, never as 0 and never dropped', () => {
    // 0 renders as an instantaneous response and a dropped sample renders as a
    // healthy line with a shorter history. Both turn an outage into a good tile.
    const store = memStore();
    store.addRun(run({ at: minutesBefore(3), latencyMs: 100 }));
    store.addRun(run({ at: minutesBefore(2), result: 'timeout', latencyMs: null }));
    store.addRun(run({ at: minutesBefore(1), latencyMs: 140 }));
    expect(buildTile(store, 'zendesk', NOW).spark).toEqual([100, null, 140]);
  });

  it('is an all-null series, not a null field, when every probe failed', () => {
    const store = memStore();
    store.addRun(run({ at: minutesBefore(1), result: 'fail', latencyMs: null }));
    expect(buildTile(store, 'zendesk', NOW).spark).toEqual([null]);
  });
});

/* ------------------------------------------------------- lastStateChange */

describe('lastStateChange reports a transition we watched happen, or nothing', () => {
  it('is the moment our half flipped', () => {
    const store = memStore();
    store.addRun(run({ at: minutesBefore(5), result: 'pass' }));
    store.addRun(run({ at: minutesBefore(4), result: 'pass' }));
    store.addRun(run({ at: minutesBefore(3), result: 'fail', latencyMs: null }));
    store.addRun(run({ at: minutesBefore(2), result: 'fail', latencyMs: null }));
    expect(buildTile(store, 'zendesk', NOW).lastStateChange).toBe('2026-06-01T11:57:00.000Z');
  });

  it('is the most recent flip when there were several', () => {
    const store = memStore();
    store.addRun(run({ at: minutesBefore(5), result: 'pass' }));
    store.addRun(run({ at: minutesBefore(4), result: 'fail', latencyMs: null }));
    store.addRun(run({ at: minutesBefore(3), result: 'pass' }));
    expect(buildTile(store, 'zendesk', NOW).lastStateChange).toBe('2026-06-01T11:57:00.000Z');
  });

  it('is null when the state never changed, rather than the oldest row we still hold', () => {
    // The oldest retained row is where the pruner happened to cut. Reporting it
    // would make "last state change" jump every time retention runs.
    const store = memStore();
    for (const minutes of [5, 4, 3]) store.addRun(run({ at: minutesBefore(minutes), result: 'pass' }));
    expect(buildTile(store, 'zendesk', NOW).lastStateChange).toBe(null);
  });

  it('does not count a second probe appearing as a state change', () => {
    // pod B's first run makes it 2 of 2 rather than 1 of 1. Our half did not
    // change; the fleet did.
    const store = memStore();
    store.addRun(run({ check: 'pod A', at: minutesBefore(5), result: 'pass' }));
    store.addRun(run({ check: 'pod B', at: minutesBefore(4), result: 'pass' }));
    expect(buildTile(store, 'zendesk', NOW).lastStateChange).toBe(null);
  });

  it('replays to exactly the ours it serves', () => {
    // The invariant that makes the replay trustworthy: the state the walk ends
    // in is the state the tile reports. If they disagree the walk is measuring
    // something else and the timestamp is about something else too.
    const store = memStore();
    for (const minutes of [6, 5, 4]) store.addRun(run({ check: 'pod A', at: minutesBefore(minutes), result: 'pass' }));
    store.addRun(run({ check: 'pod A', at: minutesBefore(3), result: 'fail', latencyMs: null }));
    store.addRun(run({ check: 'pod B', at: minutesBefore(2), result: 'pass' }));
    const tile = buildTile(store, 'zendesk', NOW);
    expect(tile.ours.level).toBe('outage');
    expect(tile.lastStateChange).toBe('2026-06-01T11:57:00.000Z');
  });
});

/* -------------------------------------------------------------- incidents */

describe('incidents90d counts this service’s incidents in the window', () => {
  const putIncident = (store: Store, id: string, serviceId: string, openedAt: string, resolvedAt: string | null) =>
    store.putIncident({ id, ruleKey: 'vendor', serviceId, severity: '1', openedAt, resolvedAt, summary: 's' });

  it('counts open and resolved incidents opened inside the window', () => {
    const store = memStore();
    putIncident(store, 'a', 'zendesk', daysBefore(1), null);
    putIncident(store, 'b', 'zendesk', daysBefore(10), daysBefore(9));
    expect(buildTile(store, 'zendesk', NOW).incidents90d).toBe(2);
  });

  it('does not count another service’s incidents', () => {
    const store = memStore();
    putIncident(store, 'a', 'zendesk', daysBefore(1), null);
    putIncident(store, 'b', 'jira', daysBefore(1), null);
    putIncident(store, 'c', 'platform:statuspage', daysBefore(1), null);
    expect(buildTile(store, 'zendesk', NOW).incidents90d).toBe(1);
  });

  it('counts over ninety days, not some other number of days', () => {
    // 91 and 89 as literals, for the same reason the uptime window is.
    expect(INCIDENT_WINDOW_DAYS).toBe(90);
    const store = memStore();
    putIncident(store, 'old', 'zendesk', daysBefore(91), daysBefore(1));
    putIncident(store, 'new', 'zendesk', daysBefore(89), daysBefore(1));
    expect(buildTile(store, 'zendesk', NOW).incidents90d).toBe(1);
  });
});

/* ------------------------------------------------------- the read failing */

describe('a store that cannot be read says so, loudly', () => {
  it('reports every measurement absent and an error naming the reads that failed', () => {
    const tile = buildTile(brokenRuns(), 'zendesk', NOW);
    expect(tile.error).toEqual({
      code: 'store_unavailable',
      message: 'probe history: database connection is not open',
    });
    expect(tile.latencyMs).toBe(null);
    expect(tile.p50Ms).toBe(null);
    expect(tile.p95Ms).toBe(null);
    expect(tile.spark).toBe(null);
    expect(tile.uptime30d).toBe(null);
    expect(tile.lastStateChange).toBe(null);
  });

  it('does not report our half as "no checks", which would be a claim about the fleet', () => {
    // 'No checks' says we looked and there are none. This is "we could not
    // look", and the two must not render the same.
    expect(buildTile(brokenRuns(), 'zendesk', NOW).ours).toEqual({
      level: 'unknown',
      label: 'Unknown',
      note: 'Our probe history could not be read.',
      passing: 0,
      total: 0,
    });
  });

  it('serves a null incident count rather than zero when the incident read fails', () => {
    const store = brokenRuns({
      incidentsSince() {
        throw new Error('no such table: incidents');
      },
    });
    const tile = buildTile(store, 'zendesk', NOW);
    expect(tile.incidents90d).toBe(null);
    expect(tile.error?.message).toBe(
      'probe history: database connection is not open; incidents: no such table: incidents',
    );
  });

  it('keeps the halves independent: probe history readable, incidents not', () => {
    const real = memStore();
    const store: TileStore = {
      runsFor: (id: ServiceId, limit?: number) => real.runsFor(id, limit),
      percentiles: (id, since) => real.percentiles(id, since),
      uptime: (id, since) => real.uptime(id, since),
      incidentsSince() {
        throw new Error('no such table: incidents');
      },
    };
    real.addRun(run({ at: minutesBefore(1), latencyMs: 90 }));
    const tile = buildTile(store, 'zendesk', NOW);
    expect(tile.latencyMs).toBe(90);
    expect(tile.ours.level).toBe('operational');
    expect(tile.incidents90d).toBe(null);
    expect(tile.error).toEqual({ code: 'store_unavailable', message: 'incidents: no such table: incidents' });
  });

  it('asks the store for a bounded window, once, not the whole table', () => {
    // 263 MB a year lives in check_runs. An unbounded read here is a route that
    // gets slower every day it runs — and two reads would let the counts and
    // the sparkline be computed from different sets of rows.
    //
    // This assertion was decoration when it was written: the mutation that
    // removed the limit from `latestPerCheck` left it green, because at the
    // time `buildTile` called that function with a stub. Both call sites are
    // pinned now.
    const seen: Array<number | undefined> = [];
    const store = brokenRuns({
      runsFor: (_id: ServiceId, limit?: number) => {
        seen.push(limit);
        return [];
      },
      percentiles: () => undefined,
      uptime: () => undefined,
    });
    buildTile(store, 'zendesk', NOW);
    expect(seen).toEqual([RUN_WINDOW]);
    latestPerCheck(store, 'zendesk');
    expect(seen).toEqual([RUN_WINDOW, RUN_WINDOW]);
  });
});

describe('uptime coverage comes from the same scan as the ratio', () => {
  it('counts every run in the window, not just the RUN_WINDOW rows read for the folds', () => {
    // The discriminating case, and the reason it is needed: `buildTile` reads
    // `runsFor(serviceId, RUN_WINDOW)` for the sparkline and the latest-per-check
    // folds, and it is tempting to count THOSE rows as the uptime coverage.
    // That read is capped at 500; the uptime query is not. On a busy service the
    // caption would describe fewer runs than the percentage was computed from —
    // the exact shape of G5 HIGH 1, one field over.
    //
    // Every other fixture in this file is under the cap, so the two numbers
    // cannot differ there. This one is deliberately over it.
    const store = memStore();
    const base = Date.parse('2026-09-19T12:00:00.000Z');
    const rows = RUN_WINDOW + 137;
    for (let i = 0; i < rows; i += 1) {
      store.addRun({
        serviceId: 'jira',
        at: new Date(base - i * 60_000).toISOString(),
        check: 'REST /myself',
        region: 'us-east',
        result: 'pass',
        latencyMs: 100,
      });
    }

    const tile = buildTile(store, 'jira', new Date(base));
    expect(store.runsFor('jira', RUN_WINDOW)).toHaveLength(RUN_WINDOW);
    expect(tile.uptimeSamples).toBe(rows);
    expect(tile.uptimeSamples).toBeGreaterThan(RUN_WINDOW);
    // And the window start is the oldest run, not the oldest row we happened to
    // read — 637 minutes back, not 500.
    expect(tile.uptimeFrom).toBe(new Date(base - (rows - 1) * 60_000).toISOString());
  });

  it('reports no coverage when there is no uptime figure', () => {
    const tile = buildTile(memStore(), 'jira', new Date('2026-09-19T12:00:00.000Z'));
    expect(tile.uptime30d).toBeNull();
    expect(tile.uptimeFrom).toBeNull();
    expect(tile.uptimeSamples).toBe(0);
  });
});
