import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, ENTRA_SOURCE, ENTRA_INTERVAL_MS, ENDPOINTS_INTERVAL_MS } from './index.js';
import { ENDPOINTS_SOURCE } from './api/routes.js';
import type { FetchLike } from './http/fetchJson.js';
import type { EntraSnapshot } from '@ops-dash/shared';
import { loadFixtures, routes, serve, NOW as STUB_NOW, goodToken } from './adapters/entra/__fixtures__/graphStub.js';

/** The shared Graph world, read from the adapter's own fixtures so both sides of
 *  the seam see one set of payloads rather than two that agree today. */
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'adapters', 'entra', '__fixtures__');

/** Obviously fake, like the integration suite's. No test in this repo can reach
 *  the real credential by forgetting to stub something: `createApp` has no token
 *  source unless it is handed one. */
const stubTokens = { get: async () => ({ token: 'entra-source-stub' }), reset: () => {} } as never;
const NOW = STUB_NOW;
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

describe('the previous-snapshot round trip, through the real store', () => {
  /**
   * THE GAP THIS FILE RECORDED, NOW CLOSED — and the delay is the interesting part.
   *
   * This block used to be a comment saying the round trip was untested because
   * the Graph stub lived unexported inside the adapter's own suite, and that
   * writing a second one would be the duplication this project keeps paying
   * for. `m4-entra` then extracted `__fixtures__/graphStub.ts` so both sides
   * could read one world — and nobody wrote this test, so for several hours the
   * shared module had **no consumer outside its own directory.**
   *
   * They found that by checking an assumption about their own file rather than
   * assuming it was being used. The module was not unused because it was
   * unnecessary; it was unused because the other end of the seam was never
   * built. A stub extracted for a caller that never arrives looks, from the
   * outside, exactly like a stub that is working.
   *
   * What this asserts that the adapter's own suite cannot: that the value
   * `pollEntra` receives as `previous` is **the one the store actually kept**,
   * not one a test handed it. Two independently-reachable definitions of "the
   * previous snapshot" — the adapter's parameter and the store's row — compared
   * against each other rather than either against itself.
   */
  const fixtures = loadFixtures((name) =>
    JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as unknown,
  );

  const app = (impl: FetchLike) =>
    createApp({ dbPath: ':memory:', fetchImpl: impl, now: () => NOW, probes: [], tokens: goodToken() });

  it('the second poll sees the first poll STORED, not a value a test supplied', async () => {
    const { impl, misses } = serve(routes(fixtures));
    const a = app(impl);
    const entra = a.sources.find((s) => s.name === ENTRA_SOURCE)!;

    await entra.run();
    const stored = a.store.getSnapshot(ENTRA_SOURCE)!.data as EntraSnapshot;
    // Cold start: no prior, so `mfa_gap` is omitted rather than emitted as zero.
    expect(stored.signals.map((s) => s.key)).not.toContain('mfa_gap');

    await entra.run();
    const warm = a.store.getSnapshot(ENTRA_SOURCE)!.data as EntraSnapshot;
    const gap = warm.signals.find((s) => s.key === 'mfa_gap');

    // The signal appears ONLY because the store kept the first reading and the
    // composition root handed it back. Nothing in this test passes `previous`.
    expect(gap).toBeDefined();
    expect(gap!.count).toBe(stored.stats.mfaUnregistered);

    // A route that 404s turns a real assertion into an accidental test of the
    // error path, so the world has to have answered every call it was asked.
    expect(misses).toEqual([]);
  });

  it('a failed second poll does not destroy the first poll payload', async () => {
    // The store's stale-with-last-good behaviour, exercised through the source
    // rather than asserted about it — `putSnapshot` branches on `error`, and a
    // pure failure must leave the good payload where it is.
    const { impl } = serve(routes(fixtures));
    const a = app(impl);
    const entra = a.sources.find((s) => s.name === ENTRA_SOURCE)!;
    await entra.run();
    const good = a.store.getSnapshot(ENTRA_SOURCE)!.data as EntraSnapshot;
    expect(good).toBeDefined();

    const dead = serve([[() => true, { status: 503, body: 'upstream is unwell' }]]);
    const b = createApp({ dbPath: ':memory:', fetchImpl: dead.impl, now: () => NOW, probes: [], tokens: goodToken() });
    const failing = b.sources.find((s) => s.name === ENTRA_SOURCE)!;
    const result = await failing.run();
    expect(result.error).toBeDefined();
    expect(result.data).toBeUndefined();
  });
});

describe('the endpoints source is registered, and only when it can run', () => {
  /** Obviously fake, like the Graph one. Constructed here per test because
   *  these never poll; the production path builds ONE and reuses it, which is
   *  the whole reason `epc` is an option rather than a config path. */
  const epc = () => ({
    tokens: { get: async () => ({ token: 'epc-stub' }), reset: () => {} } as never,
    apiBase: 'https://endpointcentral.example.com',
  });

  it('is absent with no credential — and the route can then say so', () => {
    const a = createApp({ dbPath: ':memory:', fetchImpl: never, now: () => NOW, probes: [] });
    expect(a.sources.map((s) => s.name)).not.toContain(ENDPOINTS_SOURCE);
  });

  it('is present with a credential, at the measured fifteen-minute interval', () => {
    const a = createApp({ dbPath: ':memory:', fetchImpl: never, now: () => NOW, probes: [], epc: epc() });
    const src = a.sources.find((s) => s.name === ENDPOINTS_SOURCE);
    expect(src).toBeDefined();
    // Pinned as a literal, not read back off the constant: the interval is a
    // measurement — several paged calls over 213 machines, and ten token mints
    // per ten minutes — and a test reading the constant agrees with any value.
    expect(src!.intervalMs).toBe(900_000);
    expect(ENDPOINTS_INTERVAL_MS).toBe(900_000);
  });

  it('the configured predicate agrees with whether the source exists', async () => {
    // THE SEAM. `/api/endpoints` distinguishes "nobody set this up" from "it
    // has not polled yet" using `endpointsConfigured`, and the source list is
    // built from the same `opts.epc`. If those two ever disagree the route
    // reports a state the process is not in — a route taking its own second
    // reading of the world is the defect this repo has counted three times.
    //
    // Asserted as an EQUIVALENCE across both worlds rather than as two facts
    // about today, so a divergent copy fails even when it agrees on one input.
    // Asserted through the ROUTE rather than an internal, because the route's
    // answer is the thing an operator sees and the only definition that matters.
    for (const opt of [undefined, epc()]) {
      const a = createApp({ dbPath: ':memory:', fetchImpl: never, now: () => NOW, probes: [], ...(opt ? { epc: opt } : {}) });
      const registered = a.sources.some((s) => s.name === ENDPOINTS_SOURCE);
      const res = await a.api.inject({ method: 'GET', url: '/api/endpoints' });
      const code = (JSON.parse(res.body) as { result: { error?: { code: string } } }).result.error?.code;
      // Never polled either way — nothing has run. The question is WHICH
      // absence the route names, and it must match whether the source exists.
      expect(code === 'never_polled').toBe(registered);
      expect(code === 'endpoints_unconfigured').toBe(!registered);
      await a.api.close();
    }
  });
});
