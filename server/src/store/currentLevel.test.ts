import { describe, it, expect } from 'vitest';
import type { SourceResult, StatusLevel } from '@ops-dash/shared';
import { openStore } from './db.js';
import { currentLevel, isStatusLevel, vendorLevel } from './currentLevel.js';
import { vendorHalfSatisfied, ourCheckFailing } from '../engine/rules.js';

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

describe('amendment 10 — a platform that publishes no health at all', () => {
  const noHealth = (over: Partial<SourceResult<unknown>> = {}): SourceResult<unknown> => ({
    // What the Zendesk adapter returns on a clean read with nothing open: a
    // real `unknown` with a note explaining that absence is not affirmation.
    data: { platform: 'zendesk-ssp', level: 'unknown', label: 'Unknown', incidentsSince: [] },
    fetchedAt: '2026-09-19T12:00:00.000Z',
    degraded: false,
    ...over,
  });
  const allPass = { passing: 2, total: 2 };

  it('reads operational when our own checks all pass and nothing is open', () => {
    const got = vendorLevel(noHealth(), 'zendesk-ssp', allPass);
    expect(got.level).toBe('operational');
    // And it says whose evidence it is. A green the reader believes the vendor
    // affirmed, when it was really our two probes, is a worse lie than the grey.
    expect(got.inferred?.basis).toContain('our own checks');
    expect(got.inferred?.basis).toContain('2 of 2');
  });

  it('marks a vendor-published level as NOT inferred', () => {
    // The field has to distinguish, or the tile cannot label anything.
    const said = vendorLevel(
      { ...noHealth(), data: { platform: 'statuspage', level: 'operational' } },
      'statuspage',
      allPass,
    );
    expect(said.level).toBe('operational');
    expect(said.inferred).toBeUndefined();
  });

  it('condition 1: a platform that normally publishes health stays unknown', () => {
    // Statuspage saying `unknown` has genuinely failed to tell us something —
    // a missing component, a shape we did not recognise. That is a real gap and
    // our passing probes do not fill it.
    for (const platform of ['statuspage', 'statusio', 'msgraph'] as const) {
      expect(vendorLevel(noHealth(), platform, allPass).level).toBe('unknown');
    }
  });

  it('condition 2: a failed read is never inferred over', () => {
    // The rule the whole product rests on, and amendment 10 does not touch it.
    const failed = noHealth({ degraded: true, error: { code: 'http_503', message: 'x' } });
    expect(vendorLevel(failed, 'zendesk-ssp', allPass).level).toBe('unknown');
    // Nor is a source we have never polled at all.
    expect(vendorLevel(undefined, 'zendesk-ssp', allPass).level).toBe('unknown');
  });

  it('condition 3: an open incident means the published level already speaks', () => {
    // `currentLevel` returns degraded/outage here, so the inference never runs —
    // asserted through the real path rather than by trusting that it does not.
    for (const level of ['degraded', 'outage', 'maintenance'] as const) {
      const open = noHealth({ data: { platform: 'zendesk-ssp', level } });
      const got = vendorLevel(open, 'zendesk-ssp', allPass);
      expect(got.level).toBe(level);
      expect(got.inferred).toBeUndefined();
    }
  });

  it('condition 4: no checks of our own infers nothing', () => {
    // No evidence is not evidence. Matches `ourCheckFailing`, which also treats
    // `total === 0` as "produced nothing", not as a verdict.
    expect(vendorLevel(noHealth(), 'zendesk-ssp', { passing: 0, total: 0 }).level).toBe('unknown');
  });

  it('condition 4: one failing check of ours is enough to withhold the claim', () => {
    // Zendesk is two pods on one tile. One dead pod is our side failing even
    // though the other answers, and we must not call that operational.
    expect(vendorLevel(noHealth(), 'zendesk-ssp', { passing: 1, total: 2 }).level).toBe('unknown');
    expect(vendorLevel(noHealth(), 'zendesk-ssp', { passing: 0, total: 2 }).level).toBe('unknown');
  });

  it('never infers downward, whatever our checks say', () => {
    // The independence the Sev1 rule depends on. Inferring an outage from our
    // own failing checks would fold our half into the vendor half, and the rule
    // `vendor degraded/outage AND our check failing` would then confirm itself.
    for (const ours of [{ passing: 0, total: 2 }, { passing: 1, total: 2 }, { passing: 0, total: 1 }]) {
      const got = vendorLevel(noHealth(), 'zendesk-ssp', ours);
      expect(got.level).toBe('unknown');
      expect(got.level).not.toBe('outage');
      expect(got.level).not.toBe('degraded');
    }
  });
});

describe('amendment 10 leaves the Sev1 rule behaving identically', () => {
  // Not an argument in a comment — the actual rule, over the four combinations
  // that matter. This is the claim the amendment is allowed to make.
  const noHealth = (level: StatusLevel = 'unknown'): SourceResult<unknown> => ({
    data: { platform: 'zendesk-ssp', level, label: level, incidentsSince: [] },
    fetchedAt: '2026-09-19T12:00:00.000Z',
    degraded: false,
  });

  it('cannot satisfy the vendor half — inference only ever yields operational', () => {
    const got = vendorLevel(noHealth(), 'zendesk-ssp', { passing: 2, total: 2 });
    expect(vendorHalfSatisfied(got.level)).toBe(false);
  });

  it('cannot suppress a Sev1 — when our checks fail there is no inference', () => {
    // If our checks are failing, the level stays `unknown`, which also does not
    // satisfy the vendor half. So the rule's answer is the same before and
    // after the amendment, in both directions.
    const failing = { passing: 0, total: 2 };
    expect(vendorHalfSatisfied(vendorLevel(noHealth(), 'zendesk-ssp', failing).level)).toBe(false);
    expect(ourCheckFailing(failing)).toBe(true);
    // And a real published outage still fires, inference or not.
    const real = vendorLevel(noHealth('outage'), 'zendesk-ssp', failing);
    expect(vendorHalfSatisfied(real.level) && ourCheckFailing(failing)).toBe(true);
  });
});
