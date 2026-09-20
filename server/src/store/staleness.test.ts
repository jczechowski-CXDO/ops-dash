import { describe, it, expect, afterEach, vi } from 'vitest';
import type { SourceStatus } from '../poller/schedule.js';
import { createSchedule } from '../poller/schedule.js';
import { sourceStaleness, staleSources, staleThresholdMs, STALE_FLOOR_MS, STALE_INTERVALS } from './staleness.js';

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const MINUTE = 60_000;
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

/** `lastOkAt: undefined` must be expressible — a source that has never
 *  succeeded is half the cases here — and `exactOptionalPropertyTypes` makes
 *  `Partial<SourceStatus>` refuse it. Widened rather than the property being
 *  deleted afterwards, so the call sites stay readable. */
type Over = Omit<Partial<SourceStatus>, 'lastOkAt' | 'lastSkipAt' | 'lastRunAt'>
  & { lastOkAt?: string | undefined; lastSkipAt?: string | undefined; lastRunAt?: string | undefined };

const status = (over: Over = {}): SourceStatus => {
  const built: Over = {
    baseline: false, runs: 10, skipped: 0, intervalMs: MINUTE,
    lastRunAt: agoMs(30_000), lastOkAt: agoMs(30_000), ...over,
  };
  // An explicitly-undefined optional is how a real SourceStatus expresses
  // "never happened" — the poller simply never assigns the key — so the keys
  // are removed rather than left present-and-undefined. `exactOptionalPropertyTypes`
  // is on, and the two are not the same type even though they compare alike.
  for (const k of ['lastOkAt', 'lastRunAt', 'lastSkipAt'] as const) {
    if (built[k] === undefined) delete built[k];
  }
  return built as SourceStatus;
};

describe('the threshold', () => {
  it('is three intervals for a source polled faster than that floor allows', () => {
    // Pinned to literals, not recomputed with the same expression the function
    // uses. A 60s source is overdue at 3 minutes; a 15-minute source at 45.
    expect(staleThresholdMs(60_000)).toBe(180_000);
    expect(staleThresholdMs(15 * MINUTE)).toBe(45 * MINUTE);
    expect(STALE_INTERVALS).toBe(3);
  });

  it('never drops below the floor, however fast the source', () => {
    // A 10-second source would be stale at 30s under the multiple alone, which
    // one slow call reaches with nothing wrong.
    expect(staleThresholdMs(10_000)).toBe(STALE_FLOOR_MS);
    expect(staleThresholdMs(1)).toBe(STALE_FLOOR_MS);
  });

  it('is the floor, not NaN, for an interval that is not a cadence', () => {
    // NaN would make every comparison false and the source permanently fresh —
    // the exact failure this file exists to prevent, arrived at by arithmetic.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(staleThresholdMs(bad)).toBe(STALE_FLOOR_MS);
    }
  });
});

describe('a source that is answering', () => {
  it('is fresh one interval after its last success', () => {
    const s = sourceStaleness(status({ lastOkAt: agoMs(MINUTE) }), NOW);
    expect(s).toEqual({ stale: false, reason: 'fresh', ageMs: MINUTE, thresholdMs: 3 * MINUTE });
  });

  it('is still fresh after two missed polls, because one slow poll is not an outage', () => {
    expect(sourceStaleness(status({ lastOkAt: agoMs(2 * MINUTE + 59_000) }), NOW).stale).toBe(false);
  });

  it('is fresh exactly ON the threshold and stale one millisecond past it', () => {
    expect(sourceStaleness(status({ lastOkAt: agoMs(3 * MINUTE) }), NOW).reason).toBe('fresh');
    expect(sourceStaleness(status({ lastOkAt: agoMs(3 * MINUTE + 1) }), NOW).reason).toBe('silent');
  });

  it('is fresh when its clock runs slightly ahead of ours', () => {
    // Clock skew puts lastOkAt in the future. A negative age is not staleness.
    expect(sourceStaleness(status({ lastOkAt: new Date(NOW + 5_000).toISOString() }), NOW).stale).toBe(false);
  });
});

describe('a source whose timer has silently stopped', () => {
  it('is stale twenty minutes after its last success, with the age to say so', () => {
    // The whole finding. lastOkAt twenty minutes ago is indistinguishable from
    // twenty seconds ago unless the cadence is known; this is where it becomes
    // distinguishable.
    const s = sourceStaleness(status({ lastOkAt: agoMs(20 * MINUTE) }), NOW);
    expect(s.stale).toBe(true);
    expect(s.reason).toBe('silent');
    expect(s.ageMs).toBe(20 * MINUTE);
  });

  it('is judged on the last SUCCESS, not the last run that started', () => {
    // lastRunAt is stamped at the start of a run, so a run that never settles
    // holds it at a fixed, recent-looking age forever. A judgement taken from it
    // would read this source as fine.
    const hung = status({ lastRunAt: agoMs(1_000), lastOkAt: agoMs(45 * MINUTE) });
    expect(sourceStaleness(hung, NOW).stale).toBe(true);
    expect(sourceStaleness(hung, NOW).ageMs).toBe(45 * MINUTE);
  });

  it('separates a wedged source from a dead one by its skips', () => {
    // A wedged source keeps ticking and keeps finding the previous run in
    // flight, so lastSkipAt stays recent while lastOkAt freezes. A stopped timer
    // updates neither. Both are stale; the reason is what an operator needs to
    // know which thing to go and look at.
    const wedged = status({ lastOkAt: agoMs(30 * MINUTE), lastSkipAt: agoMs(10_000), skipped: 29 });
    expect(sourceStaleness(wedged, NOW)).toMatchObject({ stale: true, reason: 'wedged' });

    const dead = status({ lastOkAt: agoMs(30 * MINUTE), lastSkipAt: agoMs(29 * MINUTE), skipped: 1 });
    expect(sourceStaleness(dead, NOW)).toMatchObject({ stale: true, reason: 'silent' });
  });

  it('a 15-minute source is not called stale at four minutes', () => {
    // The multiple is per-source for this reason. A fixed three-minute constant
    // would report every 15-minute source as stale for 80% of its cycle.
    const slow = status({ intervalMs: 15 * MINUTE, lastOkAt: agoMs(4 * MINUTE) });
    expect(sourceStaleness(slow, NOW).stale).toBe(false);
    expect(sourceStaleness({ ...slow, lastOkAt: agoMs(46 * MINUTE) }, NOW).stale).toBe(true);
  });
});

describe('a source that has never succeeded', () => {
  it('is stale with no age, however recently it ran', () => {
    // m365 before consent: polling briskly, failing every time. Absent is not
    // fresh, and an age of zero would be the freshest possible value for the
    // least fresh possible state.
    const s = sourceStaleness(status({ lastOkAt: undefined, lastRunAt: agoMs(1_000), lastError: 'http_403' }), NOW);
    expect(s.stale).toBe(true);
    expect(s.reason).toBe('never-succeeded');
    expect(s.ageMs).toBeUndefined();
  });

  it('is stale rather than throwing when the timestamp is unreadable', () => {
    const s = sourceStaleness(status({ lastOkAt: 'not a date' }), NOW);
    expect(s).toEqual({ stale: true, reason: 'silent', thresholdMs: 3 * MINUTE });
  });
});

describe('staleSources', () => {
  it('names the stale ones and only the stale ones', () => {
    const all: Record<string, SourceStatus> = {
      'vendor:jira': status({ lastOkAt: agoMs(30_000) }),
      'vendor:m365': status({ lastOkAt: undefined }),
      'probe:zendesk': status({ lastOkAt: agoMs(20 * MINUTE) }),
    };
    const out = staleSources(all, NOW);
    expect(Object.keys(out).sort()).toEqual(['probe:zendesk', 'vendor:m365']);
    expect(out['vendor:m365']!.reason).toBe('never-succeeded');
  });

  it('is empty when every source is answering', () => {
    expect(staleSources({ a: status(), b: status({ intervalMs: 15 * MINUTE }) }, NOW)).toEqual({});
  });
});

describe('against a real schedule rather than a hand-built status', () => {
  // The status objects above are constructed by this test file, so they prove
  // the arithmetic and nothing about the field names the poller actually
  // populates. A rename of lastOkAt would leave every test above green. This one
  // drives the real createSchedule and judges what it produces.
  afterEach(() => { vi.useRealTimers(); });

  it('reads a freshly polled source as fresh and the same source as stale later', async () => {
    vi.useFakeTimers({ now: NOW });
    const schedule = createSchedule(
      [{ name: 'vendor:jira', intervalMs: MINUTE, run: async () => ({ fetchedAt: new Date().toISOString(), degraded: false, data: { level: 'operational' } }) }],
      () => {},
    );
    schedule.start();
    await vi.advanceTimersByTimeAsync(0);
    schedule.stop();      // the timer is now gone; nothing will ever update it again

    const st = schedule.statusOf('vendor:jira')!;
    expect(st.lastOkAt, 'the poller must have recorded a success for this test to mean anything').toBeDefined();
    expect(sourceStaleness(st, Date.now()).stale).toBe(false);
    // Ten minutes later the stopped timer is exactly the failure being caught.
    expect(sourceStaleness(st, Date.now() + 10 * MINUTE)).toMatchObject({ stale: true, reason: 'silent' });
  });

  it('reads a source whose every poll fails as never-succeeded', async () => {
    vi.useFakeTimers({ now: NOW });
    const schedule = createSchedule(
      [{ name: 'vendor:m365', intervalMs: MINUTE, run: async () => ({ fetchedAt: new Date().toISOString(), degraded: false, error: { code: 'http_403', message: 'consent pending' } }) }],
      () => {},
    );
    schedule.start();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    schedule.stop();

    const st = schedule.statusOf('vendor:m365')!;
    expect(st.runs, 'it must really have polled').toBeGreaterThan(1);
    expect(sourceStaleness(st, Date.now())).toMatchObject({ stale: true, reason: 'never-succeeded' });
  });
});
