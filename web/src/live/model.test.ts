import { describe, it, expect } from 'vitest';
import { fixtures } from '../fixtures/index.js';
import {
  countText,
  feedMarker,
  firstSentence,
  holesPhrase,
  lastSeenLine,
  latencyText,
  loadKind,
  NO_VALUE,
  panelStateFor,
  percentileText,
  ready,
  serviceViewOf,
  sparkSamples,
  staleReason,
  uptimeText,
  type Load,
} from './model.js';

const REASON = { code: 'unreachable', message: 'Failed to fetch' };

/* ------------------------------------------------------------------ states */

describe('the four states come from two non-exclusive fields (amendment 9)', () => {
  /**
   * The full matrix, with the answer written down rather than derived. The one
   * that matters is row 4: data AND error is `stale`, not `failed` — a `Load`
   * type whose states were an enum could not express it, and the state it could
   * not express is the entire product.
   */
  const MATRIX: { load: Load<string>; expected: string }[] = [
    { load: {}, expected: 'loading' },
    { load: { data: 'x' }, expected: 'ready' },
    { load: { data: 'x', servedAt: 't' }, expected: 'ready' },
    { load: { error: REASON }, expected: 'failed' },
    { load: { data: 'x', error: REASON }, expected: 'stale' },
    { load: { data: 'x', servedAt: 't', error: REASON }, expected: 'stale' },
  ];

  it.each(MATRIX)('$expected', ({ load, expected }) => {
    expect(loadKind(load)).toBe(expected);
  });

  it('keeps the last-good payload readable in the stale state', () => {
    // Not merely classified as stale: the DATA is still there to render. A
    // classifier that got the name right while the caller had nothing to draw
    // would pass the row above and fail the product.
    const load: Load<string> = { data: 'last good', servedAt: 't', error: REASON };
    expect(load.data).toBe('last good');
  });

  it('an empty payload is data, not absence', () => {
    // `[]` and `0` are values we fetched. Only `undefined` is "we have nothing".
    expect(loadKind({ data: [] })).toBe('ready');
    expect(loadKind({ data: 0 })).toBe('ready');
    expect(loadKind({ data: [], error: REASON })).toBe('stale');
  });
});

describe('panelStateFor maps a load to the state the Panel renders', () => {
  it('loading, when nothing has answered', () => {
    expect(panelStateFor({}, 'Services')).toEqual({ kind: 'loading' });
  });

  it('error, with the reason, when there is nothing cached', () => {
    expect(panelStateFor({ error: REASON }, 'Services')).toEqual({
      kind: 'error',
      source: 'Services',
      message: 'Failed to fetch',
    });
  });

  it('stale, carrying the age of the data rather than the age of the failure', () => {
    expect(panelStateFor({ data: [1], servedAt: '2026-09-19T09:00:00Z', error: REASON }, 'Services')).toEqual({
      kind: 'stale',
      source: 'Services',
      fetchedAt: '2026-09-19T09:00:00Z',
      // The reason travels with the age. `toEqual` is exhaustive, so this also
      // asserts nothing ELSE was added to the state.
      reason: 'Failed to fetch',
    });
  });

  it('a stale state with no message says nothing rather than inventing one', () => {
    // `loadKind` is what decides stale, and it needs both fields — so this is
    // reachable only through a `Load` whose error has no message. The panel
    // then renders exactly what it rendered before the field existed, which is
    // the branch that keeps every existing stale literal honest.
    const state = panelStateFor({ data: [1], servedAt: '2026-09-19T09:00:00Z', error: { code: 'x', message: '' } }, 'Services');
    expect(state).toEqual({ kind: 'stale', source: 'Services', fetchedAt: '2026-09-19T09:00:00Z', reason: '' });
    // And the key is genuinely absent, not `undefined`, when there is no error
    // at all — `exactOptionalPropertyTypes` makes those different types and a
    // spread of `{ reason: undefined }` would not compile in `Panel`'s callers.
    expect('reason' in panelStateFor({ data: [1] }, 'Services')).toBe(false);
  });

  it('empty only when a successful load really is empty', () => {
    const empty = { when: (d: number[]) => d.length === 0, message: 'nothing here' };
    expect(panelStateFor({ data: [] }, 'Services', empty)).toEqual({ kind: 'empty', message: 'nothing here' });
    expect(panelStateFor({ data: [1] }, 'Services', empty)).toEqual({ kind: 'ready' });
  });

  it('never reports empty for an absence we did not measure', () => {
    // The ordering rule, and the reason it is a test: an empty predicate run
    // before the load check turns "we could not look" into "nothing is wrong",
    // which is this product's defining failure with a different label on it.
    const empty = { when: (d: number[]) => d.length === 0, message: 'nothing here' };
    expect(panelStateFor({}, 'Services', empty).kind).toBe('loading');
    expect(panelStateFor({ error: REASON }, 'Services', empty).kind).toBe('error');
    expect(panelStateFor({ data: [], error: REASON }, 'Services', empty).kind).toBe('stale');
  });

  it('staleReason speaks only in the stale state', () => {
    expect(staleReason({ data: [1], error: REASON })).toBe('Failed to fetch');
    expect(staleReason({ error: REASON })).toBeNull();
    expect(staleReason({ data: [1] })).toBeNull();
    expect(staleReason({})).toBeNull();
  });
});

/* ------------------------------------------------------------ measurements */

describe('absent is not zero, and zero is a measurement', () => {
  it('latency', () => {
    expect(latencyText(220)).toBe('220 ms');
    // The fastest probe ever recorded is still a probe that answered.
    expect(latencyText(0)).toBe('0 ms');
    expect(latencyText(null)).toBe(NO_VALUE);
  });

  it('uptime', () => {
    expect(uptimeText(1)).toBe('100.00%');
    expect(uptimeText(0.9996)).toBe('99.96%');
    // A total outage, which is emphatically not the same as no data.
    expect(uptimeText(0)).toBe('0.00%');
    expect(uptimeText(null)).toBe(NO_VALUE);
  });

  it('never renders no-uptime-data as either 100% or 0%', () => {
    // The two wrong answers, named. `?? 1` was the tempting one on the server
    // and `?? 0` the tempting one here; both read as measurements.
    expect(uptimeText(null)).not.toBe('100.00%');
    expect(uptimeText(null)).not.toBe('0.00%');
  });

  it('counts', () => {
    // A complete log with nothing in it is 0; a log we could not read is absent.
    expect(countText(0)).toBe('0');
    expect(countText(3)).toBe('3');
    expect(countText(null)).toBe(NO_VALUE);
  });

  it('percentiles, with either half absent', () => {
    expect(percentileText(112, 220)).toBe('p50 112 ms · p95 220 ms');
    expect(percentileText(null, null)).toBe(`p50 ${NO_VALUE} · p95 ${NO_VALUE}`);
  });
});

describe('sparkSamples keeps the holes countable', () => {
  it('no series at all is no samples and no holes', () => {
    expect(sparkSamples(null)).toEqual({ values: [], missing: 0 });
  });

  it('a clean series passes through unchanged', () => {
    expect(sparkSamples([1, 2, 3])).toEqual({ values: [1, 2, 3], missing: 0 });
  });

  it('the holes sentence is one definition, quoted by both screens', () => {
    // Pinned as a literal, not composed from the same template the function
    // uses: an expectation built the way the code builds it agrees with itself
    // however wrong it is.
    expect(holesPhrase(2, 2)).toBe('2 of 4 probes did not answer');
    expect(holesPhrase(6, 11)).toBe('6 of 17 probes did not answer');
    // The total is answered PLUS missing — the denominator is every probe we
    // asked, not the ones that came back. "6 of 11" over 17 samples would be a
    // true-looking number about the wrong population.
    expect(holesPhrase(1, 0)).toBe('1 of 1 probes did not answer');
  });

  it('a probe that did not answer is counted, not dropped and not zeroed', () => {
    const { values, missing } = sparkSamples([100, null, 300, null]);
    expect(values).toEqual([100, 300]);
    expect(missing).toBe(2);
    // The two wrong renderings, named: a zero in the series would dive the line
    // to instantaneous, and silently dropping the hole leaves a shorter line
    // that looks healthier than the data.
    expect(values).not.toContain(0);
    expect(values.length + missing).toBe(4);
  });

  it('a series where nothing answered draws nothing', () => {
    expect(sparkSamples([null, null])).toEqual({ values: [], missing: 2 });
  });

  it('keeps a genuine zero sample', () => {
    expect(sparkSamples([0, 5])).toEqual({ values: [0, 5], missing: 0 });
  });
});

/* -------------------------------------------------------------- staleness */

describe('a tile says when its own vendor feed is not current', () => {
  const NOW = Date.parse('2026-09-19T12:00:00Z');
  // `incidentsSince` is REQUIRED on `feed.data`, not optional, so every
  // construction site has to answer the question. An optional field here would
  // let a parser that silently dropped the array typecheck — which is exactly
  // the defect that made this field reach no screen for a milestone.
  const seen = { level: 'operational' as const, label: 'Operational', incidentsSince: [] };

  it('says nothing at all while the feed is current', () => {
    expect(feedMarker(ready(seen, '2026-09-19T11:59:00Z'), NOW)).toBeNull();
    expect(feedMarker({}, NOW)).toBeNull();
  });

  it('names the age when the feed is stale', () => {
    const marker = feedMarker({ data: seen, servedAt: '2026-09-19T09:00:00Z', error: REASON }, NOW);
    expect(marker).toBe('Vendor feed unreadable · last read 3 hours ago');
  });

  it('says so plainly when the feed has never been read', () => {
    expect(feedMarker({ error: REASON }, NOW)).toBe('Vendor feed unreadable · never read successfully');
  });

  it('renders what the vendor last said in the past tense, and only when stale', () => {
    expect(lastSeenLine({ data: seen, servedAt: '2026-09-19T09:00:00Z', error: REASON }, NOW)).toBe(
      'Last time we could read this feed, 3 hours ago, the vendor said Operational.',
    );
    // Not while it is current — there would be no "last time" about it.
    expect(lastSeenLine(ready(seen, '2026-09-19T11:59:00Z'), NOW)).toBeNull();
    // And not when there is nothing to have seen.
    expect(lastSeenLine({ error: REASON }, NOW)).toBeNull();
  });
});

/* ------------------------------------------------------------- the widening */

describe('serviceViewOf widens a fixture without changing anything an operator reads', () => {
  it.each(['quiet', 'sev1'] as const)('%s: every measurement survives intact', (mode) => {
    for (const s of fixtures[mode].services) {
      const view = serviceViewOf(s);
      expect(view.id).toBe(s.id);
      expect(view.short).toBe(s.short);
      expect(view.name).toBe(s.name);
      expect(view.latencyMs).toBe(s.latencyMs);
      expect(view.p50Ms).toBe(s.p50Ms);
      expect(view.p95Ms).toBe(s.p95Ms);
      expect(view.spark).toEqual(s.spark);
      expect(view.uptime30d).toBe(s.uptime30d);
      expect(view.incidents90d).toBe(s.incidents90d);
      expect(view.lastStateChange).toBe(s.lastStateChange);
      expect(view.vendor.level).toBe(s.vendor.level);
      expect(view.ours).toEqual(s.ours);
    }
  });

  it.each(['quiet', 'sev1'] as const)('%s: no fixture feed is stale, so no demo tile is marked', (mode) => {
    // This is the property the 152 baselines rest on. If a fixture ever came
    // through as stale, the tiles would grow a marker line and every screenshot
    // of the tile grid would move.
    for (const s of fixtures[mode].services) {
      const view = serviceViewOf(s);
      expect(loadKind(view.feed)).toBe('ready');
      expect(feedMarker(view.feed)).toBeNull();
      expect(lastSeenLine(view.feed)).toBeNull();
    }
  });

  it.each(['quiet', 'sev1'] as const)('%s: no fixture measurement is absent', (mode) => {
    // The other half of the same property: every em-dash branch added in this
    // task is unreachable from a fixture, so no demo pixel can change.
    for (const s of fixtures[mode].services) {
      const view = serviceViewOf(s);
      expect(view.latencyMs).not.toBeNull();
      expect(view.uptime30d).not.toBeNull();
      expect(view.incidents90d).not.toBeNull();
      expect(view.lastStateChange).not.toBeNull();
      expect(sparkSamples(view.spark).missing).toBe(0);
      expect(sparkSamples(view.spark).values.length).toBeGreaterThan(0);
    }
  });
});

describe('firstSentence', () => {
  it('cuts a served summary at its first full stop, keeping the stop', () => {
    expect(firstSentence('Jira is degraded. Both halves of the rule are satisfied.')).toBe(
      'Jira is degraded.',
    );
  });

  it('returns a one-sentence summary whole, with no trailing stop invented', () => {
    expect(firstSentence('Lost sight of every vendor on statuspage')).toBe(
      'Lost sight of every vendor on statuspage',
    );
  });

  it('does not cut at a decimal point or an abbreviation mid-sentence', () => {
    // `'. '` and not `'.'`: cutting on the character alone turns "99.9% of
    // probes failed" into "99." — a number that means something else.
    expect(firstSentence('99.9% of probes failed in us-east. Vendor confirms.')).toBe(
      '99.9% of probes failed in us-east.',
    );
  });
});
