import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSchedule, type Source } from './schedule.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const src = (over: Partial<Source> = {}): Source => ({
  name: 'vendor:jira',
  intervalMs: 60_000,
  run: vi.fn(async () => ({ ok: true })),
  ...over,
});

describe('each source keeps its own interval', () => {
  it('a slow source does not delay a fast one', async () => {
    // The failure this prevents: one sequential loop over all sources, where a
    // 9-second Graph call makes the 60s vendor feeds drift by 9s every cycle.
    const slow = src({ name: 'slow', intervalMs: 300_000, run: vi.fn(async () => new Promise((r) => setTimeout(() => r({}), 120_000))) });
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
        return {};
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
        return {};
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
