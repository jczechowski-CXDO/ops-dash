import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SourceResult } from '@ops-dash/shared';
import { createSchedule, type Source } from './schedule.js';

/** A successful read. Adapters return an envelope, never a bare value — see
 *  the `Source.run` docblock for why the poller now insists on it. */
const ok = (): SourceResult<unknown> => ({ data: {}, fetchedAt: new Date().toISOString(), degraded: false });

/** A completed read that failed. This is what a 503 looks like coming out of
 *  `fetchJson`: resolved, no throw, `error` set. */
const errored = (code = 'http_503'): SourceResult<unknown> => ({
  fetchedAt: new Date().toISOString(),
  degraded: true,
  error: { code, message: 'Service Unavailable' },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const src = (over: Partial<Source> = {}): Source => ({
  name: 'vendor:jira',
  intervalMs: 60_000,
  run: vi.fn(async () => ok()),
  ...over,
});

describe('each source keeps its own interval', () => {
  it('a slow source does not delay a fast one', async () => {
    // The failure this prevents: one sequential loop over all sources, where a
    // 9-second Graph call makes the 60s vendor feeds drift by 9s every cycle.
    const slow = src({ name: 'slow', intervalMs: 300_000, run: vi.fn(async () => new Promise<SourceResult<unknown>>((r) => setTimeout(() => r(ok()), 120_000))) });
    const fast = src({ name: 'fast', intervalMs: 60_000 });
    const s = createSchedule([slow, fast]);
    s.start();

    await vi.advanceTimersByTimeAsync(180_000);
    // fast: t=0, 60, 120, 180 => 4. Its cadence must not know slow exists.
    expect(fast.run).toHaveBeenCalledTimes(4);
    s.stop();
  });
});

describe('one bad source does not take the others down', () => {
  it('keeps polling the rest when an adapter throws', async () => {
    // A poller that dies on a bad feed turns one vendor's outage into a total
    // blackout of our own making — worse than the outage it was watching for.
    const boom = src({ name: 'boom', run: vi.fn(async () => { throw new Error('feed exploded'); }) });
    const fine = src({ name: 'fine' });
    const s = createSchedule([boom, fine]);
    s.start();

    await vi.advanceTimersByTimeAsync(180_000);
    expect(boom.run).toHaveBeenCalledTimes(4);   // and keeps being retried
    expect(fine.run).toHaveBeenCalledTimes(4);
    expect(s.statusOf('boom')?.lastError).toContain('feed exploded');
    expect(s.statusOf('fine')?.lastError).toBeUndefined();
    s.stop();
  });

  it('a source that throws EVERY time is still retried, not quarantined', () => {
    // Deliberate: a feed down for an hour must recover on its own when the
    // vendor does. Quarantining after N failures would need a manual reset
    // nobody would remember to perform.
    const boom = src({ run: vi.fn(async () => { throw new Error('x'); }) });
    const s = createSchedule([boom]);
    s.start();
    return vi.advanceTimersByTimeAsync(600_000).then(() => {
      expect((boom.run as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(9);
      s.stop();
    });
  });
});

describe('runs of one source never overlap', () => {
  it('skips a tick rather than stacking when a poll outlives its interval', async () => {
    // Two concurrent runs of the same source race on its store row, and the
    // loser silently wins. Skipping is the honest behaviour: the next tick
    // reports what it finds.
    let inFlight = 0;
    let maxConcurrent = 0;
    const slow = src({
      intervalMs: 10_000,
      run: vi.fn(async () => {
        maxConcurrent = Math.max(maxConcurrent, ++inFlight);
        await new Promise((r) => setTimeout(r, 35_000));
        inFlight--;
        return ok();
      }),
    });
    const s = createSchedule([slow]);
    s.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(maxConcurrent, 'two runs of one source were in flight at once').toBe(1);
    expect(s.statusOf('vendor:jira')?.skipped).toBeGreaterThan(0);
    s.stop();
  });
});

describe('the first run announces itself', () => {
  it('reports baseline on the first poll and not on the second', async () => {
    // From the vault survey, and a real trap: vendor_state is keyed
    // (vendor, component) and the first run writes a baseline with nothing to
    // compare against. If it does not SAY so, a correct first run is
    // indistinguishable from a silent failure — which is exactly what someone
    // watching the first deploy is trying to tell apart.
    const s = createSchedule([src()]);
    s.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.statusOf('vendor:jira')?.baseline).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.statusOf('vendor:jira')?.baseline).toBe(false);
    s.stop();
  });

  it('baselines the first SUCCESS, not the first attempt', async () => {
    // The case where `!hasSucceeded` and `runs === 1` differ, and the only one:
    // a source that fails then recovers. Both are correct when the first poll
    // succeeds, so a test that only covers that path cannot tell them apart —
    // and `runs === 1` is the wrong rule, because the poll that finally works is
    // the first time we know the starting state and therefore the one that must
    // report baseline rather than a change against nothing.
    let attempt = 0;
    const flaky = src({
      run: vi.fn(async () => {
        if (++attempt === 1) throw new Error('first poll failed');
        return ok();
      }),
    });
    const s = createSchedule([flaky]);
    s.start();

    await vi.advanceTimersByTimeAsync(1);
    expect(s.statusOf('vendor:jira')?.baseline, 'a failed first poll knows nothing').toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.statusOf('vendor:jira')?.baseline, 'the first SUCCESS is the baseline').toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.statusOf('vendor:jira')?.baseline, 'and only that one').toBe(false);
    s.stop();
  });

  it('a source whose FIRST poll fails is not treated as a baseline', () => {
    // A baseline is "we now know the starting state". A failed first poll knows
    // nothing, and marking it baseline would suppress the change report on the
    // first poll that actually succeeds.
    const boom = src({ run: vi.fn(async () => { throw new Error('x'); }) });
    const s = createSchedule([boom]);
    s.start();
    return vi.advanceTimersByTimeAsync(1).then(() => {
      expect(s.statusOf('vendor:jira')?.baseline).toBe(false);
      s.stop();
    });
  });
});

describe('start and stop', () => {
  it('polls immediately on start rather than waiting a full interval', async () => {
    // A 15-minute EPC interval would otherwise mean fifteen minutes of empty
    // panels after every restart.
    const a = src();
    const s = createSchedule([a]);
    s.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(a.run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('stop actually stops, and is safe to call twice', async () => {
    const a = src();
    const s = createSchedule([a]);
    s.start();
    await vi.advanceTimersByTimeAsync(1);
    s.stop();
    s.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(a.run).toHaveBeenCalledTimes(1);
  });
});


describe('an errored result is a failed poll, not a successful one', () => {
  // G2 BLOCKER 1. Nothing in this repo throws: `fetchJson` and both adapters
  // turn a broken feed into an errored `SourceResult`. Before this, the poller
  // counted any resolved promise as a success, so the only failure it could see
  // was the one that never happens.

  it('a source whose feed fails forever never reports a successful poll', async () => {
    // The exact shape G2 pinned. Every field asserted positively: this is the
    // whole claim, and "not true" would pass for a field that stopped existing.
    const dead = src({ run: vi.fn(async () => errored()) });
    const s = createSchedule([dead]);
    s.start();
    await vi.advanceTimersByTimeAsync(180_000);

    const st = s.statusOf('vendor:jira')!;
    expect(dead.run).toHaveBeenCalledTimes(4);
    expect(st.runs).toBe(4);
    expect(st.baseline).toBe(false);
    expect(st.lastOkAt).toBeUndefined();
    expect(st.lastError).toBe('http_503: Service Unavailable');
    // It kept trying. A source that fails is retried, never quarantined.
    expect(st.lastRunAt).toBeDefined();
    s.stop();
  });

  it('does not baseline on the first errored poll', async () => {
    // The inversion that made this a BLOCKER rather than a MEDIUM: on tick 1 a
    // permanently-broken source announced itself as the baseline, which is a
    // claim to know the starting state of something we have never read.
    const dead = src({ run: vi.fn(async () => errored('network')) });
    const s = createSchedule([dead]);
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.statusOf('vendor:jira')!.baseline).toBe(false);
    s.stop();
  });

  it('baselines the first poll that succeeds after a run of errored results', async () => {
    // The discriminating case, now reachable through the path production
    // actually takes. Two ticks errored, the third clean: baseline belongs to
    // the third, and `lastError` must be gone rather than merely stale.
    let tick = 0;
    const flaky = src({ run: vi.fn(async () => (++tick <= 2 ? errored() : ok())) });
    const s = createSchedule([flaky]);
    s.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.statusOf('vendor:jira')!.baseline).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    const st = s.statusOf('vendor:jira')!;
    expect(st.baseline).toBe(true);
    expect(st.lastOkAt).toBeDefined();
    expect(st.lastError).toBeUndefined();

    // And the baseline is spent: the fourth poll is not a second first.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.statusOf('vendor:jira')!.baseline).toBe(false);
    s.stop();
  });

  it('keeps lastOkAt when a healthy source starts failing, and says it is failing', async () => {
    // Both halves matter and they are different facts. `lastOkAt` answers "when
    // did we last read this?" and must NOT be cleared by a failure — the store's
    // last-good/last-attempt split (G0 BLOCKER 2) is the same idea. `lastError`
    // answers "are we failing now?".
    let tick = 0;
    const decays = src({ run: vi.fn(async () => (++tick === 1 ? ok() : errored('timeout'))) });
    const s = createSchedule([decays]);
    s.start();

    await vi.advanceTimersByTimeAsync(0);
    const good = s.statusOf('vendor:jira')!.lastOkAt;
    expect(good).toBeDefined();

    await vi.advanceTimersByTimeAsync(120_000);
    const st = s.statusOf('vendor:jira')!;
    expect(st.lastOkAt).toBe(good);          // unchanged, not refreshed
    expect(st.lastError).toBe('timeout: Service Unavailable');
    expect(st.baseline).toBe(false);
    s.stop();
  });

  it('counts an empty result as a successful read, not a failure', async () => {
    // Amendment 4, and the distinction the whole store depends on. `empty` means
    // the fetch completed and the feed published nothing — it has told us
    // something true. Only `error` means we failed to look. A poller that
    // treated empty as a failure would report a quiet vendor as unreachable.
    const quiet = src({
      run: vi.fn(async (): Promise<SourceResult<unknown>> => ({
        data: [], fetchedAt: new Date().toISOString(), degraded: false, empty: true,
      })),
    });
    const s = createSchedule([quiet]);
    s.start();
    await vi.advanceTimersByTimeAsync(0);

    const st = s.statusOf('vendor:jira')!;
    expect(st.lastOkAt).toBeDefined();
    expect(st.lastError).toBeUndefined();
    expect(st.baseline).toBe(true);
    s.stop();
  });

  it('counts a degraded result as a successful read too', async () => {
    // `degraded` means some pages or regions failed and we still have most of
    // it. Partial data is data.
    const partial = src({
      run: vi.fn(async (): Promise<SourceResult<unknown>> => ({
        data: {}, fetchedAt: new Date().toISOString(), degraded: true,
      })),
    });
    const s = createSchedule([partial]);
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.statusOf('vendor:jira')!.lastOkAt).toBeDefined();
    s.stop();
  });

  it('distinguishes an adapter throwing from a feed failing, in the message', async () => {
    // A throw is OUR bug — an adapter broke its contract — and must not read
    // like a vendor outage in the health output. Different prefixes, asserted
    // as literals rather than by matching whatever the code produced.
    const thrower = src({ name: 'boom', run: vi.fn(async () => { throw new Error('adapter is broken'); }) });
    const failer = src({ name: 'feed', run: vi.fn(async () => errored('http_500')) });
    const s = createSchedule([thrower, failer]);
    s.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(s.statusOf('boom')!.lastError).toBe('threw: adapter is broken');
    expect(s.statusOf('feed')!.lastError).toBe('http_500: Service Unavailable');
    s.stop();
  });
});

describe('a thrown value that resists being stringified', () => {
  it('does not escape the catch and kill the process', async () => {
    // G2 HIGH 3. `String(cause?.message ?? cause)` throws on a null-prototype
    // object and on a throwing `toString` — and it throws INSIDE the catch, so
    // it leaves `tick`, which is called as `void tick(source)` from a timer.
    // That is an unhandled rejection: the process death the catch exists to
    // prevent, reached through the catch itself.
    const hostile = [
      Object.assign(Object.create(null), { message: Object.create(null) }),
      { get message() { throw new Error('nope'); }, toString() { throw new Error('nope'); } },
      Object.create(null),
    ];
    for (const value of hostile) {
      const bad = src({ name: 'hostile', run: vi.fn(async () => { throw value; }) });
      const alive = src({ name: 'alive', intervalMs: 60_000 });
      const s = createSchedule([bad, alive]);
      s.start();
      await vi.advanceTimersByTimeAsync(120_000);

      // Recorded as a failure rather than lost, and the sibling kept polling —
      // which is the thing an escaping throw would have stopped.
      expect(s.statusOf('hostile')!.lastError).toBeDefined();
      expect(s.statusOf('hostile')!.lastOkAt).toBeUndefined();
      expect(alive.run).toHaveBeenCalledTimes(3);
      s.stop();
    }
  });
});
