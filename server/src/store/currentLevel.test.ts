import { describe, it, expect } from 'vitest';
import type { SourceResult } from '@ops-dash/shared';
import { openStore } from './db.js';
import { currentLevel, isStatusLevel } from './currentLevel.js';

const good = (level: string): SourceResult<unknown> => ({
  data: { platform: 'statuspage', level, label: level, incidentsSince: [] },
  fetchedAt: '2026-09-19T10:00:00.000Z',
  degraded: false,
});

describe('currentLevel', () => {
  it('reports the level of a successful read', () => {
    for (const level of ['operational', 'degraded', 'outage', 'maintenance', 'unknown'] as const) {
      expect(currentLevel(good(level))).toBe(level);
    }
  });

  it('reports unknown when the newest attempt errored, whatever the payload says', () => {
    // The whole point. Assert `unknown` positively rather than "not
    // operational": a bug that returned `degraded` here would satisfy the
    // negative form and still open a Sev1 on a three-hour-old reading.
    expect(currentLevel({ ...good('operational'), degraded: true, error: { code: 'http_503', message: 'x' } })).toBe('unknown');
    expect(currentLevel({ ...good('degraded'), degraded: true, error: { code: 'network', message: 'x' } })).toBe('unknown');
  });

  it('reports unknown for a source never polled, and for one with no payload', () => {
    expect(currentLevel(undefined)).toBe('unknown');
    expect(currentLevel({ fetchedAt: '2026-09-19T10:00:00.000Z', degraded: true })).toBe('unknown');
  });

  it('reports unknown rather than trusting a payload with a nonsense level', () => {
    // A cast would let this straight through into a colour. A half-written row,
    // a schema change or a future writer can all put something else there.
    for (const level of ['OPERATIONAL', 'green', '', null, 1, {}]) {
      expect(currentLevel({ ...good('operational'), data: { level } })).toBe('unknown');
    }
  });

  it('counts an empty result as a real read, not a failure', () => {
    // amendment 4. `empty` means the feed published nothing, which is a fact.
    expect(currentLevel({ ...good('operational'), empty: true })).toBe('operational');
  });

  it('is not fooled by degraded alone — degraded is a partial read, not a failed one', () => {
    expect(currentLevel({ ...good('operational'), degraded: true })).toBe('operational');
  });

  it('isStatusLevel accepts exactly the five contract levels', () => {
    const all = ['operational', 'degraded', 'outage', 'maintenance', 'unknown'];
    expect(all.filter(isStatusLevel)).toEqual(all);
    expect(['', 'ok', 'OUTAGE', 'down'].filter(isStatusLevel)).toEqual([]);
  });
});

describe('the seam G2 HIGH 4 found, through the real store', () => {
  it('a stored good payload survives a later failed poll and still reads operational as HISTORY', () => {
    // Both halves of the tension, in one test, so neither can be "fixed" without
    // the other failing. G0 BLOCKER 2 says the good payload must survive; this
    // product says a vendor we cannot read must not render green. Both hold
    // only because `data` and `currentLevel` answer different questions.
    const store = openStore(':memory:');
    store.putSnapshot('vendor:jira', good('operational'));
    store.putSnapshot('vendor:jira', {
      fetchedAt: '2026-09-19T13:00:00.000Z',
      degraded: true,
      data: { platform: 'statuspage', level: 'unknown', label: 'Unknown', incidentsSince: [] },
      error: { code: 'http_503', message: 'Service Unavailable' },
    });

    const snapshot = store.getSnapshot('vendor:jira')!;

    // The store kept the last good reading — G0 BLOCKER 2 holds.
    expect((snapshot.data as { level: string }).level).toBe('operational');
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.error?.code).toBe('http_503');

    // And the one thing anybody may colour a tile from says we do not know.
    expect(currentLevel(snapshot)).toBe('unknown');
    store.close();
  });
});
