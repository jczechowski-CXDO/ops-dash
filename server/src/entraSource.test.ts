import { describe, it, expect } from 'vitest';
import { createApp, ENTRA_SOURCE, ENTRA_INTERVAL_MS } from './index.js';
import type { FetchLike } from './http/fetchJson.js';
import type { EntraSnapshot } from '@ops-dash/shared';

/** Obviously fake, like the integration suite's. No test in this repo can reach
 *  the real credential by forgetting to stub something: `createApp` has no token
 *  source unless it is handed one. */
const stubTokens = { get: async () => ({ token: 'entra-source-stub' }), reset: () => {} } as never;
const NOW = new Date('2026-09-20T12:00:00Z');
const never: FetchLike = async () => {
  throw new Error('no network in this suite');
};

const sourceNames = (app: ReturnType<typeof createApp>) => app.sources.map((s) => s.name);

describe('the entra source is registered, and only when it can run', () => {
  it('is absent with no credential — a deliberate absence is not a failing source', () => {
    // Registering it anyway would put a permanent red on /api/health for a
    // source nobody configured, which is the same defect as a tile that can
    // never go green: an alarm that is always on is an alarm nobody reads.
    const app = createApp({ dbPath: ':memory:', fetchImpl: never, now: () => NOW, probes: [] });
    expect(sourceNames(app)).not.toContain(ENTRA_SOURCE);
  });

  it('is present with a credential, at the measured fifteen-minute interval', () => {
    const app = createApp({
      dbPath: ':memory:',
      fetchImpl: never,
      now: () => NOW,
      probes: [],
      tokens: stubTokens,
    });
    const entra = app.sources.find((s) => s.name === ENTRA_SOURCE);
    expect(entra).toBeDefined();
    // Pinned as a literal, not read back off the constant: fifteen minutes is a
    // measurement (43s per poll, a 30s throttle) and a test that reads the
    // constant would agree with any value someone typed.
    expect(entra!.intervalMs).toBe(900_000);
    expect(ENTRA_INTERVAL_MS).toBe(900_000);
  });
});

describe('a failed poll records the attempt without destroying the last good read', () => {
  const failing: FetchLike = async () =>
    new Response('upstream is unwell', { status: 503, headers: { 'content-type': 'text/plain' } });

  it('stores the failure, and stores no data it did not get', async () => {
    // `putSnapshot` branches on `error`, so this is really a test that the
    // source hands the whole envelope to the store rather than unwrapping it
    // and discarding the error — which is how a failed read comes to look like
    // a successful empty one.
    const a = createApp({
      dbPath: ':memory:',
      fetchImpl: failing,
      now: () => NOW,
      probes: [],
      tokens: stubTokens,
    });
    const entra = a.sources.find((s) => s.name === ENTRA_SOURCE)!;

    const result = await entra.run();
    expect(result.error).toBeDefined();
    expect(result.data).toBeUndefined();

    const stored = a.store.getSnapshot(ENTRA_SOURCE);
    expect(stored).toBeDefined();
    expect(stored!.error).toBeDefined();
    // The thing that must NOT have happened: a zero-valued snapshot written as
    // if it were a reading. Eight required numbers with nowhere to say "we could
    // not look" is why `stats` is all-or-nothing in the adapter.
    expect(stored!.data).toBeUndefined();
  });
});

/*
 * NOT COVERED HERE, and said out loud rather than left as a silence.
 *
 * The full previous-snapshot round trip — poll, store, poll again, and the
 * second call receiving the first snapshot as `previous` — needs a fetch stub
 * that answers all thirteen Graph calls with correctly-shaped payloads. That
 * harness exists, as `routes()` and `serve()` in
 * `server/src/adapters/entra/index.test.ts`, and it is not exported.
 *
 * Writing a second one here is the duplication this project has paid for three
 * times: two definitions of one thing, each correct, drifting apart. So the
 * wiring above is tested for what it decides — registration, interval, envelope
 * handling — and the arithmetic that consumes `previous` is tested by the
 * adapter's own suite, including the cold-start omission of `mfa_gap`.
 *
 * The gap is the JOIN, which is precisely the place this project's defects live.
 * Closing it is a one-line export in a file I do not own; requested, not taken.
 */
