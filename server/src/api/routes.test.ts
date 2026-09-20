import { describe, it, expect, afterEach, afterAll, beforeAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import type { CheckRun, SourceResult } from '@ops-dash/shared';
import { openStore, type Store } from '../store/db.js';
import { createApp } from '../index.js';
import { createSchedule, type Source, type SourceStatus } from '../poller/schedule.js';
import {
  buildApi,
  apiRoutes,
  vendorSource,
  SERVICE_ORDER,
  type ApiDeps,
  type ApiStore,
  type ApiPoller,
  type ServicesResponse,
  type IncidentsResponse,
  type HealthResponse,
  CHECKS_PAGE,
} from './routes.js';

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

/** A vendor payload as the adapters store it: a whole SourceResult as JSON. */
const good = (level: string, fetchedAt: string): SourceResult<unknown> => ({
  data: { level, label: level[0]!.toUpperCase() + level.slice(1), note: 'from the feed', incidentsSince: [] },
  fetchedAt,
  degraded: false,
});

const statusOf = (over: Partial<SourceStatus> = {}): SourceStatus => ({
  baseline: false,
  // The scheduler now echoes each source's cadence, so a consumer can judge
  // freshness without keeping a second interval table of its own.
  intervalMs: 60_000,
  runs: 3,
  skipped: 0,
  lastRunAt: '2026-09-19T12:00:00.000Z',
  lastOkAt: '2026-09-19T12:00:00.000Z',
  ...over,
});

const pollerWith = (sources: Record<string, SourceStatus>): ApiPoller => ({ allStatus: () => sources });

/** A store whose every read throws — the only way to exercise the store half
 *  of /api/health honestly. A control that cannot fail proves nothing. */
const brokenStore = (): ApiStore => ({
  getSnapshot() {
    throw new Error('database connection is not open');
  },
  openIncidents() {
    throw new Error('database connection is not open');
  },
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
    throw new Error('database connection is not open');
  },
});

const get = async (deps: ApiDeps, url: string) => {
  const app = buildApi(deps);
  try {
    const res = await app.inject({ method: 'GET', url });
    return { statusCode: res.statusCode, body: res.json() as unknown };
  } finally {
    await app.close();
  }
};

/* ------------------------------------------------- the contract, type-level */

describe('the API depends on the store only through a shape the store really has', () => {
  it('the real Store satisfies ApiStore', () => {
    // Typecheck-mode assertion (vitest.config typecheck is on): renaming
    // getSnapshot or openIncidents in db.ts, or changing either signature,
    // fails HERE rather than at composition time in Task 9.
    const widened: ApiStore = memStore();
    expect(typeof widened.getSnapshot).toBe('function');
    expect(typeof widened.openIncidents).toBe('function');
    expect(typeof widened.runsFor).toBe('function');
    expect(typeof widened.percentiles).toBe('function');
    expect(typeof widened.uptime).toBe('function');
    expect(typeof widened.incidentsSince).toBe('function');
  });
});

/* ------------------------------------------------------------ /api/services */

describe('GET /api/services mirrors SourceResult outward unchanged', () => {
  it('passes fetchedAt, degraded, empty and data through byte for byte', async () => {
    const store = memStore();
    store.putSnapshot(vendorSource('jira'), {
      data: { level: 'degraded', label: 'Degraded', note: 'Elevated errors', incidentsSince: [] },
      fetchedAt: '2026-09-19T11:22:33.000Z',
      degraded: true,
      empty: false,
    });

    const { statusCode, body } = await get({ store }, '/api/services');
    const jira = (body as ServicesResponse).services.find((s) => s.id === 'jira')!;

    expect(statusCode).toBe(200);
    // Every field pinned as a literal, not read back off the input object.
    expect(jira.source).toBe('vendor:jira');
    expect(jira.result.fetchedAt).toBe('2026-09-19T11:22:33.000Z');
    expect(jira.result.degraded).toBe(true);
    expect(jira.result.empty).toBe(false);
    expect(jira.result.data).toEqual({
      level: 'degraded',
      label: 'Degraded',
      note: 'Elevated errors',
      incidentsSince: [],
    });
    expect(jira.result.error).toBeUndefined();
  });

  it('carries empty: true outward, and never turns it into operational', async () => {
    const store = memStore();
    store.putSnapshot(vendorSource('zendesk'), {
      data: { level: 'unknown', label: 'Unknown', note: 'feed published no records', incidentsSince: [] },
      fetchedAt: '2026-09-19T11:00:00.000Z',
      degraded: false,
      empty: true,
    });

    const { body } = await get({ store }, '/api/services');
    const zendesk = (body as ServicesResponse).services.find((s) => s.id === 'zendesk')!;

    expect(zendesk.result.empty).toBe(true);
    expect((zendesk.result.data as { level: string }).level).toBe('unknown');
  });

  it('carries data AND error together for a stale source (amendment 9)', async () => {
    const store = memStore();
    store.putSnapshot(vendorSource('claude'), good('operational', '2026-09-19T10:00:00.000Z'));
    store.putSnapshot(vendorSource('claude'), {
      fetchedAt: '2026-09-19T10:05:00.000Z',
      degraded: true,
      error: { code: 'http_503', message: '503 Service Unavailable' },
    });

    const { body } = await get({ store }, '/api/services');
    const claude = (body as ServicesResponse).services.find((s) => s.id === 'claude')!;

    // The stale panel: previous data, visibly stale, with the reason attached.
    expect(claude.result.data).toEqual({
      level: 'operational',
      label: 'Operational',
      note: 'from the feed',
      incidentsSince: [],
    });
    expect(claude.result.degraded).toBe(true);
    expect(claude.result.error).toEqual({ code: 'http_503', message: '503 Service Unavailable' });
    expect(claude.result.fetchedAt).toBe('2026-09-19T10:00:00.000Z');
  });

  it('a source that has never succeeded reports no data at all', async () => {
    const store = memStore();
    store.putSnapshot(vendorSource('openai'), {
      fetchedAt: '2026-09-19T10:05:00.000Z',
      degraded: true,
      error: { code: 'network', message: 'getaddrinfo ENOTFOUND' },
    });

    const { body } = await get({ store }, '/api/services');
    const openai = (body as ServicesResponse).services.find((s) => s.id === 'openai')!;

    // toEqual on the WHOLE envelope: a `data` key appearing from anywhere —
    // an empty object, a zeroed tile, a default — fails this.
    expect(openai.result).toEqual({
      fetchedAt: '2026-09-19T10:05:00.000Z',
      degraded: true,
      error: { code: 'network', message: 'getaddrinfo ENOTFOUND' },
    });
  });

  it('one dead source returns six payloads and one error object, at HTTP 200', async () => {
    const store = memStore();
    const live = SERVICE_ORDER.filter((id) => id !== 'm365');
    for (const id of live) store.putSnapshot(vendorSource(id), good('operational', '2026-09-19T12:00:00.000Z'));
    store.putSnapshot(vendorSource('m365'), {
      fetchedAt: '2026-09-19T12:00:05.000Z',
      degraded: true,
      error: { code: 'platform_unsupported', message: 'no adapter for platform "msgraph" yet' },
    });

    const { statusCode, body } = await get({ store }, '/api/services');
    const services = (body as ServicesResponse).services;

    expect(statusCode).toBe(200);            // the TRANSPORT succeeded
    expect(services).toHaveLength(7);
    expect(services.filter((s) => s.result.data !== undefined)).toHaveLength(6);
    const dead = services.filter((s) => s.result.error !== undefined);
    expect(dead.map((s) => s.id)).toEqual(['m365']);
    expect(dead[0]!.result.error).toEqual({
      code: 'platform_unsupported',
      message: 'no adapter for platform "msgraph" yet',
    });
  });

  it('lists all seven services even when nothing has ever been polled', async () => {
    const store = memStore();
    const { statusCode, body } = await get({ store }, '/api/services');
    const services = (body as ServicesResponse).services;

    expect(statusCode).toBe(200);
    expect(services.map((s) => s.id).sort()).toEqual(
      ['claude', 'helpjuice', 'jira', 'm365', 'openai', 'proofpoint', 'zendesk'],
    );
    for (const s of services) {
      expect(s.result.error?.code).toBe('never_polled');
      expect(s.result.degraded).toBe(true);
      expect(s.result.data).toBeUndefined();
    }
  });

  it('a store that throws becomes an error per service, not a 500 and not a blank list', async () => {
    const { statusCode, body } = await get({ store: brokenStore() }, '/api/services');
    const services = (body as ServicesResponse).services;

    expect(statusCode).toBe(200);
    expect(services).toHaveLength(7);
    expect(services.every((s) => s.result.error?.code === 'store_unavailable')).toBe(true);
    expect(services.every((s) => s.result.data === undefined)).toBe(true);
  });
});

/* ------------------------------------------- /api/services: the whole tile */

describe('GET /api/services serves our half as measurements or as nulls', () => {
  /** Months away from the wall clock, on purpose. Dated today, every window
   *  assertion below passed just as happily with the injected clock ignored. */
  const NOW = new Date('2026-06-01T12:00:00.000Z');
  const minutesBefore = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

  const addRun = (store: Store, over: Partial<CheckRun> & { at: string }) =>
    store.addRun({
      serviceId: 'zendesk',
      check: 'Help centre reachable',
      region: 'us-east',
      result: 'pass',
      latencyMs: 120,
      ...over,
    });

  const services = async (store: ApiStore) => {
    const app = buildApi({ store, now: () => NOW });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/services' });
      return { raw: res.body, entries: (res.json() as ServicesResponse).services };
    } finally {
      await app.close();
    }
  };

  it('gives a service with no probe of its own nulls, not zeros — the common case', async () => {
    // Five of the seven have no probe today. Every literal below is the value
    // that must NOT be a number.
    const [m365] = (await services(memStore())).entries.filter((s) => s.id === 'm365');
    expect(m365).toMatchObject({
      ours: {
        level: 'unknown',
        label: 'No checks',
        note: 'No probe of ours has ever run for this service.',
        passing: 0,
        total: 0,
      },
      latencyMs: null,
      p50Ms: null,
      p95Ms: null,
      spark: null,
      uptime30d: null,
      incidents90d: 0,
      lastStateChange: null,
    });
    // Measurement absent is not the same as the store failing, and only one of
    // the two may claim the operator's attention.
    expect(m365!.metricsError).toBeUndefined();
  });

  it('carries the nulls over the wire as nulls, so a spread cannot restore a fixture', async () => {
    // The decision this route turns on: `null`, not an omitted key. An omitted
    // key survives `{ ...defaults, ...entry }` in the web layer and silently
    // puts a fixture's 99.98% back on the tile. Asserted against the raw JSON
    // body, not the parsed object, because that is where the difference lives.
    const { raw } = await services(memStore());
    const m365 = (JSON.parse(raw) as { services: Array<Record<string, unknown>> }).services.find(
      (s) => s['id'] === 'm365',
    )!;
    expect(Object.keys(m365)).toEqual(
      expect.arrayContaining(['uptime30d', 'p50Ms', 'p95Ms', 'spark', 'latencyMs', 'lastStateChange']),
    );
    expect(raw).toContain('"uptime30d":null');
  });

  it('serves the measurements it does have, beside the vendor mirror it does not touch', async () => {
    const store = memStore();
    store.putSnapshot(vendorSource('zendesk'), good('operational', '2026-09-19T11:59:00.000Z'));
    addRun(store, { at: minutesBefore(3), latencyMs: 100 });
    addRun(store, { at: minutesBefore(2), latencyMs: 200 });
    addRun(store, { at: minutesBefore(1), latencyMs: 150 });

    const zendesk = (await services(store)).entries.find((s) => s.id === 'zendesk')!;
    expect(zendesk.ours.level).toBe('operational');
    expect(zendesk.ours.total).toBe(1);
    expect(zendesk.latencyMs).toBe(150);
    expect(zendesk.spark).toEqual([100, 200, 150]);
    expect(zendesk.uptime30d).toBe(1);
    expect(zendesk.currentLevel).toBe('operational');
    expect(zendesk.result.fetchedAt).toBe('2026-09-19T11:59:00.000Z');
  });

  it('measures its windows from the injected clock, not from the wall clock', async () => {
    // One day before the INJECTED now, which is months before the wall clock.
    // Read from the injected clock the run is inside the 30-day window and
    // uptime is 1; read from `new Date()` it is long outside it and uptime is
    // null. The two clocks give different answers, which is the only way this
    // test can see the difference — with NOW set to the day it was written it
    // passed with the injection removed.
    const store = memStore();
    addRun(store, { at: new Date(NOW.getTime() - 86_400_000).toISOString() });
    const zendesk = (await services(store)).entries.find((s) => s.id === 'zendesk')!;
    expect(zendesk.uptime30d).toBe(1);

    // And the run really is outside a wall-clock window, so the assertion above
    // is about the clock and not about the store holding nothing.
    const wallClock = buildApi({ store });
    try {
      const res = await wallClock.inject({ method: 'GET', url: '/api/services' });
      const entry = (res.json() as ServicesResponse).services.find((s) => s.id === 'zendesk')!;
      expect(entry.uptime30d).toBe(null);
    } finally {
      await wallClock.close();
    }
  });

  it('a store that throws reports metricsError and never a zero measurement', async () => {
    const entries = (await services(brokenStore())).entries;
    expect(entries).toHaveLength(7);
    for (const entry of entries) {
      expect(entry.metricsError).toEqual({
        code: 'store_unavailable',
        message:
          'probe history: database connection is not open; incidents: database connection is not open',
      });
      expect(entry.ours).toEqual({
        level: 'unknown',
        label: 'Unknown',
        note: 'Our probe history could not be read.',
        passing: 0,
        total: 0,
      });
      expect(entry.uptime30d).toBe(null);
      expect(entry.latencyMs).toBe(null);
      expect(entry.p50Ms).toBe(null);
      expect(entry.p95Ms).toBe(null);
      expect(entry.spark).toBe(null);
      expect(entry.incidents90d).toBe(null);
      expect(entry.lastStateChange).toBe(null);
    }
  });

  it('one service’s unreadable history does not take the other six down with it', async () => {
    const real = memStore();
    addRun(real, { at: minutesBefore(1), latencyMs: 90 });
    const store: ApiStore = {
      ...real,
      runsFor: (id, limit) => {
        if (id === 'jira') throw new Error('disk I/O error');
        return real.runsFor(id, limit);
      },
    };

    const entries = (await services(store)).entries;
    expect(entries.find((s) => s.id === 'jira')!.metricsError?.message).toBe('probe history: disk I/O error');
    const zendesk = entries.find((s) => s.id === 'zendesk')!;
    expect(zendesk.metricsError).toBeUndefined();
    expect(zendesk.latencyMs).toBe(90);
  });
});

/* --------------------------------- /api/services: the level, with our half */

describe('GET /api/services answers the level the ENGINE answers, not a narrower one', () => {
  /** A zendesk-ssp payload as its adapter stores it: no health field of its
   *  own, because the platform publishes none — only incidents. */
  const zendeskFeed = (fetchedAt: string): SourceResult<unknown> => ({
    data: { level: 'unknown', label: 'Unknown', note: 'the SSP feed publishes no health', incidentsSince: [] },
    fetchedAt,
    degraded: false,
  });

  const probes = (store: Store, results: Array<CheckRun['result']>) =>
    results.forEach((result, i) =>
      store.addRun({
        serviceId: 'zendesk',
        at: `2026-09-19T11:5${i}:00.000Z`,
        check: `pod ${i}`,
        region: 'us-east',
        result,
        latencyMs: result === 'pass' ? 120 : null,
      }),
    );

  it('infers operational for zendesk when our own checks all pass, and says whose evidence it is', async () => {
    // The live defect, 2026-09-19: this served `unknown` while the engine in
    // the same process said `operational`. `currentLevel` cannot answer
    // anything else for a platform that publishes no health.
    const store = memStore();
    store.putSnapshot(vendorSource('zendesk'), zendeskFeed('2026-09-19T11:59:00.000Z'));
    probes(store, ['pass', 'pass']);

    const { body } = await get({ store }, '/api/services');
    const zendesk = (body as ServicesResponse).services.find((s) => s.id === 'zendesk')!;

    expect(zendesk.currentLevel).toBe('operational');
    expect(zendesk.inferred).toEqual({
      basis: '2 of 2 of our own checks passing, and no open incident published for our pod',
    });
    // The vendor's own word is untouched underneath. The inference is OUR
    // reading served beside it, never an edit to what they published.
    expect((zendesk.result.data as { level: string }).level).toBe('unknown');
  });

  it('does not infer when one of our checks is failing, and does not claim an outage either', async () => {
    // Condition 4. Both directions matter: no green, and no red — inferring an
    // outage from our own half would fold the two halves of the Sev1 rule into
    // one and let it confirm itself.
    const store = memStore();
    store.putSnapshot(vendorSource('zendesk'), zendeskFeed('2026-09-19T11:59:00.000Z'));
    probes(store, ['pass', 'fail']);

    const { body } = await get({ store }, '/api/services');
    const zendesk = (body as ServicesResponse).services.find((s) => s.id === 'zendesk')!;

    expect(zendesk.currentLevel).toBe('unknown');
    expect(zendesk.inferred).toBeUndefined();
  });

  it('does not infer for a platform that DOES publish health, however well our probes are doing', async () => {
    // Jira is statuspage. An `unknown` there means the feed genuinely failed
    // to tell us something, and our probes do not get to answer for it.
    const store = memStore();
    store.putSnapshot(vendorSource('jira'), {
      data: { level: 'unknown', label: 'Unknown', note: 'no component matched', incidentsSince: [] },
      fetchedAt: '2026-09-19T11:59:00.000Z',
      degraded: false,
    });
    store.addRun({
      serviceId: 'jira',
      at: '2026-09-19T11:59:00.000Z',
      check: 'Jira reachable',
      region: 'us-east',
      result: 'pass',
      latencyMs: 90,
    });

    const { body } = await get({ store }, '/api/services');
    const jira = (body as ServicesResponse).services.find((s) => s.id === 'jira')!;

    expect(jira.currentLevel).toBe('unknown');
    expect(jira.inferred).toBeUndefined();
  });

  it('does not infer over a failed read, even with every probe of ours passing', async () => {
    // Condition 2. A feed we could not read is not a feed that said nothing.
    const store = memStore();
    store.putSnapshot(vendorSource('zendesk'), zendeskFeed('2026-09-19T11:00:00.000Z'));
    store.putSnapshot(vendorSource('zendesk'), {
      fetchedAt: '2026-09-19T11:59:00.000Z',
      degraded: true,
      error: { code: 'http_503', message: '503 Service Unavailable' },
    });
    probes(store, ['pass', 'pass']);

    const { body } = await get({ store }, '/api/services');
    const zendesk = (body as ServicesResponse).services.find((s) => s.id === 'zendesk')!;

    expect(zendesk.currentLevel).toBe('unknown');
    expect(zendesk.inferred).toBeUndefined();
  });

  it('serves each service’s platform, so four unknowns can be read as one outage', async () => {
    const { body } = await get({ store: memStore() }, '/api/services');
    const entries = (body as ServicesResponse).services;
    expect(Object.fromEntries(entries.map((s) => [s.id, s.platform]))).toEqual({
      proofpoint: 'statusio',
      jira: 'statuspage',
      helpjuice: 'statuspage',
      claude: 'statuspage',
      openai: 'statuspage',
      zendesk: 'zendesk-ssp',
      m365: 'msgraph',
    });
  });

  it('agrees with the engine’s own signals(), service by service, over one store', async () => {
    // The defect reproduced end to end: ONE process, ONE store, the route's
    // answer and `index.ts`'s `signals()` compared directly. Neither side is
    // recomputed here by this test — each is asked the way its real caller
    // asks it, which is the only arrangement in which they could have been
    // caught disagreeing.
    const app = createApp({ dbPath: ':memory:' });
    try {
      // A shape in which the two ANSWERS DIFFER unless both apply amendment
      // 10: zendesk inferable, jira plainly degraded, openai never polled.
      app.store.putSnapshot(vendorSource('zendesk'), zendeskFeed('2026-09-19T11:59:00.000Z'));
      app.store.putSnapshot(vendorSource('jira'), {
        data: { level: 'degraded', label: 'Degraded', note: 'elevated errors', incidentsSince: [] },
        fetchedAt: '2026-09-19T11:59:00.000Z',
        degraded: false,
      });
      probes(app.store, ['pass', 'pass']);

      const res = await app.api.inject({ method: 'GET', url: '/api/services' });
      const fromApi = Object.fromEntries(
        (res.json() as ServicesResponse).services.map((s) => [s.id, s.currentLevel]),
      );
      const fromEngine = Object.fromEntries(app.signals().map((s) => [s.serviceId, s.vendor.level]));

      expect(fromApi).toEqual(fromEngine);
      // …and pinned as literals too, so a future where BOTH are wrong in the
      // same way is still a red test. Equality alone would call that agreement.
      expect(fromApi).toEqual({
        zendesk: 'operational',
        jira: 'degraded',
        proofpoint: 'unknown',
        helpjuice: 'unknown',
        claude: 'unknown',
        openai: 'unknown',
        m365: 'unknown',
      });
    } finally {
      await app.api.close();
      app.store.close();
    }
  });
});

/* ----------------------------------------------------------- /api/incidents */

describe('GET /api/incidents', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'INC-2291',
    ruleKey: 'vendor',
    serviceId: 'jira',
    severity: '1',
    openedAt: '2026-09-19T09:00:00.000Z',
    resolvedAt: null,
    summary: 'Jira Cloud outage correlated with a failing tenant probe',
    ...over,
  });

  it('returns the open incidents, with severity decoded to the frozen contract', async () => {
    const store = memStore();
    store.putIncident(row());
    const { statusCode, body } = await get({ store }, '/api/incidents');
    const result = (body as IncidentsResponse).result;

    expect(statusCode).toBe(200);
    expect(result.data).toEqual([
      {
        id: 'INC-2291',
        ruleKey: 'vendor',
        serviceId: 'jira',
        severity: 1,                       // number, not the TEXT column '1'
        openedAt: '2026-09-19T09:00:00.000Z',
        summary: 'Jira Cloud outage correlated with a failing tenant probe',
      },
    ]);
    expect(result.empty).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("decodes 'info' as itself and an unreadable severity as Sev1", async () => {
    const store = memStore();
    store.putIncident(row({ id: 'INC-1', severity: 'info' }));
    store.putIncident(row({ id: 'INC-2', severity: 'catastrophic' }));
    const { body } = await get({ store }, '/api/incidents');
    const byId = Object.fromEntries(
      (body as IncidentsResponse).result.data!.map((i) => [i.id, i]),
    );

    expect(byId['INC-1']!.severity).toBe('info');
    // A severity we cannot read is a thing we cannot see, and this codebase
    // never renders a thing it cannot see as benign.
    expect(byId['INC-2']!.severity).toBe(1);
    // And the guess is VISIBLE. `severityRaw` is what makes "degrade on the
    // read path" different from "guess quietly": present only on a fallback,
    // carrying the value we could not read.
    expect(byId['INC-2']!.severityRaw).toBe('catastrophic');
    expect(byId['INC-1']!.severityRaw).toBeUndefined();
  });

  it('no open incidents is empty: true with an empty array, never an assertion of health', async () => {
    const store = memStore();
    const { body } = await get({ store }, '/api/incidents');
    const result = (body as IncidentsResponse).result;

    expect(result.data).toEqual([]);
    expect(result.empty).toBe(true);
    expect(result.degraded).toBe(false);
  });

  it('a store that throws is an error with no data, at HTTP 200', async () => {
    const { statusCode, body } = await get({ store: brokenStore() }, '/api/incidents');
    const result = (body as IncidentsResponse).result;

    expect(statusCode).toBe(200);
    expect(result.error?.code).toBe('store_unavailable');
    expect(result.degraded).toBe(true);
    expect(result.data).toBeUndefined();
    expect(result.empty).toBeUndefined();   // we did not look; we found nothing is a different claim
  });
});

/* -------------------------------------------------------------- /api/health */

describe('GET /api/health reports the store and the poller separately', () => {
  /**
   * Thirty seconds after `statusOf()`'s last success, so those sources are
   * genuinely fresh against a 60-second cadence.
   *
   * These two tests did not name a clock and did not need to, until freshness
   * became part of `healthy`: `lastOkAt` at noon read as healthy at any hour of
   * any day, which is the bug — a `lastOkAt` is only healthy relative to a
   * cadence and an instant. They went red the moment the rule landed, which is
   * the right way round.
   */
  const NOW = new Date('2026-09-19T12:00:30.000Z');
  const clock = () => NOW;

  it('a broken store with a healthy poller: store not ok, poller ok', async () => {
    const { statusCode, body } = await get(
      { store: brokenStore(), poller: pollerWith({ 'vendor:jira': statusOf() }), now: clock },
      '/api/health',
    );
    const health = body as HealthResponse;

    expect(statusCode).toBe(200);
    expect(health.store.ok).toBe(false);
    expect(health.store.error).toContain('database connection is not open');
    expect(health.poller.ok).toBe(true);
    expect(health.poller.healthy).toEqual(['vendor:jira']);
  });

  it('a healthy store with a broken poller: store ok, poller not ok, and which source', async () => {
    const store = memStore();
    const { body } = await get(
      {
        store,
        poller: pollerWith({
          'vendor:jira': statusOf(),
          'probes': statusOf({ lastError: 'threw: probeFn is not a function' }),
        }),
        now: clock,
      },
      '/api/health',
    );
    const health = body as HealthResponse;

    expect(health.store.ok).toBe(true);
    expect(health.store.error).toBeUndefined();
    expect(health.poller.ok).toBe(false);
    expect(health.poller.broken).toEqual(['probes']);
    expect(health.poller.failing).toEqual([]);
    expect(health.poller.healthy).toEqual(['vendor:jira']);
    // The per-source detail is mirrored, not summarised away.
    expect(health.poller.sources['probes']!.lastError).toBe('threw: probeFn is not a function');
    expect(health.poller.sources['vendor:jira']!.runs).toBe(3);
  });

  it('no poller attached is reported as not running, not as healthy', async () => {
    const store = memStore();
    const { body } = await get({ store }, '/api/health');
    const health = body as HealthResponse;

    expect(health.store.ok).toBe(true);
    expect(health.poller.configured).toBe(false);
    expect(health.poller.ok).toBe(false);
  });

  it('names the unfilled auth seam rather than pretending it is not there', async () => {
    const store = memStore();
    const { body } = await get({ store }, '/api/health');
    expect((body as HealthResponse).auth.mode).toBe('none');
  });
});

/* ------------------------------------------- /api/health: the stopped timer */

describe('GET /api/health does not call a source healthy because it stopped complaining', () => {
  /** Noon, and `statusOf()` succeeded at noon. Every age below is stated as a
   *  distance from this instant rather than from the wall clock, because the
   *  whole rule is arithmetic between the two. */
  const NOW = new Date('2026-09-19T12:00:00.000Z');
  const clock = () => NOW;
  const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000).toISOString();

  const health = async (sources: Record<string, SourceStatus>) => {
    const { body } = await get({ store: memStore(), poller: pollerWith(sources), now: clock }, '/api/health');
    return body as HealthResponse;
  };

  it('a source whose timer stopped is stale, and is NOT in healthy', async () => {
    // The defect, stated as a fixture: nothing is erroring, a poll succeeded,
    // and the poller has been dead for ten minutes. 600s against a 60s cadence
    // is well past 3x, and until now this was `healthy` — the last place in the
    // chain where something broken read calm.
    const h = await health({ 'vendor:jira': statusOf({ lastOkAt: secondsAgo(600), lastRunAt: secondsAgo(600) }) });

    expect(h.poller.stale).toEqual(['vendor:jira']);
    expect(h.poller.healthy).toEqual([]);
    expect(h.poller.ok).toBe(false);
    expect(h.poller.staleness['vendor:jira']).toEqual({
      stale: true,
      reason: 'silent',
      ageMs: 600_000,
      thresholdMs: 180_000,
    });
  });

  it('a source answering inside its cadence is healthy and says how fresh', async () => {
    // The world where the candidates differ: same shape, 30 seconds instead of
    // 600. Without this the test above would pass against a rule that called
    // everything stale.
    const h = await health({ 'vendor:jira': statusOf({ lastOkAt: secondsAgo(30), lastRunAt: secondsAgo(30) }) });

    expect(h.poller.healthy).toEqual(['vendor:jira']);
    expect(h.poller.stale).toEqual([]);
    expect(h.poller.ok).toBe(true);
    expect(h.poller.staleness['vendor:jira']).toEqual({
      stale: false,
      reason: 'fresh',
      ageMs: 30_000,
      thresholdMs: 180_000,
    });
  });

  it('judges each source against ITS OWN cadence, not one shared threshold', async () => {
    // Four minutes old. Stale for a 60-second source, fresh for a 15-minute
    // one, and a single global threshold cannot say both.
    const h = await health({
      fast: statusOf({ intervalMs: 60_000, lastOkAt: secondsAgo(240) }),
      slow: statusOf({ intervalMs: 900_000, lastOkAt: secondsAgo(240) }),
    });

    expect(h.poller.stale).toEqual(['fast']);
    expect(h.poller.healthy).toEqual(['slow']);
    expect(h.poller.staleness['fast']!.thresholdMs).toBe(180_000);
    expect(h.poller.staleness['slow']!.thresholdMs).toBe(2_700_000);
  });

  it('separates a wedged source from a silent one, because the remedies differ', async () => {
    // Still ticking, still skipping: the run never settles. The timer is alive
    // and the upstream is hung.
    const h = await health({
      wedged: statusOf({ lastOkAt: secondsAgo(600), lastSkipAt: secondsAgo(5), skipped: 9 }),
      silent: statusOf({ lastOkAt: secondsAgo(600) }),
    });

    expect(h.poller.staleness['wedged']!.reason).toBe('wedged');
    expect(h.poller.staleness['silent']!.reason).toBe('silent');
    // Both are stale. The reason changes what you go and look at, not whether
    // the number in front of you can be trusted.
    expect(h.poller.stale.sort()).toEqual(['silent', 'wedged']);
  });

  it('reports an erroring source as failing, not as stale, however old it is', async () => {
    // `stale` is narrow on purpose. A feed that has 503'd for an hour is
    // overdue too, and saying so adds nothing: `failing` is already the more
    // specific fact and is the one with a different remedy.
    const h = await health({
      'vendor:jira': statusOf({ lastOkAt: secondsAgo(3600), lastError: 'http_503: 503 Service Unavailable' }),
    });

    expect(h.poller.failing).toEqual(['vendor:jira']);
    expect(h.poller.stale).toEqual([]);
    // …and the staleness is still visible in the evidence, so nothing is lost.
    expect(h.poller.staleness['vendor:jira']!.stale).toBe(true);
    expect(h.poller.staleness['vendor:jira']!.ageMs).toBe(3_600_000);
  });

  it('reports a never-succeeded source as that, not as stale', async () => {
    // Built by omission rather than by `lastOkAt: undefined`:
    // `exactOptionalPropertyTypes` is on, and "the key is absent" is a
    // different type from "the key holds undefined" — which is the distinction
    // the field is carrying, so the fixture has to honour it.
    const { lastOkAt: _neverSucceeded, ...neverOk } = statusOf();
    const h = await health({ 'vendor:m365': neverOk });

    expect(h.poller.neverSucceeded).toEqual(['vendor:m365']);
    expect(h.poller.stale).toEqual([]);
    expect(h.poller.healthy).toEqual([]);
    // No age, because "never" has none. Zero would be the freshest possible
    // value for the least fresh possible state.
    expect(h.poller.staleness['vendor:m365']).toEqual({
      stale: true,
      reason: 'never-succeeded',
      thresholdMs: 180_000,
    });
  });

  it('measures staleness from the injected clock, not the wall clock', async () => {
    // Same status, two clocks, different answers. The fixture is fresh at the
    // injected instant and hours stale against the real one.
    const status = { 'vendor:jira': statusOf({ lastOkAt: secondsAgo(30), lastRunAt: secondsAgo(30) }) };
    const injected = await health(status);
    expect(injected.poller.healthy).toEqual(['vendor:jira']);
    // The evidence map as well as the buckets. They are computed by two
    // different calls, so a clock fixed in one and not the other is a real
    // possibility — and was, until this line: the mutation that pointed the map
    // at `new Date()` left every other assertion here green.
    expect(injected.poller.staleness['vendor:jira']!.ageMs).toBe(30_000);

    const { body } = await get({ store: memStore(), poller: pollerWith(status) }, '/api/health');
    expect((body as HealthResponse).poller.healthy).toEqual([]);
    expect((body as HealthResponse).poller.stale).toEqual(['vendor:jira']);
  });
});

/* ------------------------------------ /api/health: the credential's own life */

describe('GET /api/health watches the credential this process authenticates with', () => {
  /**
   * A throwaway certificate, generated at runtime into a temp directory.
   *
   * The same approach as `store/certExpiry.test.ts` and for the same reason:
   * the guards forbid a certificate block anywhere in source, so a committed
   * fixture would mean either weakening a guard or keeping a certificate in git
   * history forever. It is a real X.509 structure, so the dates come out of a
   * parser rather than out of a stub that agrees with the code.
   */
  let DIR: string;
  let PEM: string;
  let NOT_AFTER: number;

  beforeAll(() => {
    DIR = mkdtempSync(join(tmpdir(), 'ops-dash-api-cert-'));
    const keyPath = join(DIR, 'graph.key');
    const certPath = join(DIR, 'graph.crt');
    const stamp = (offsetDays: number) =>
      new Date(Date.now() + offsetDays * 86_400_000).toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, 'Z');
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
        '-not_before', stamp(0), '-not_after', stamp(400), '-subj', '/CN=ops-dash-api-health-test'],
      { stdio: 'ignore' },
    );
    // Key and certificate concatenated, which is the shape of the real file.
    PEM = readFileSync(keyPath, 'utf8') + readFileSync(certPath, 'utf8');
    // Read independently of the code under test, so no assertion below reaches
    // the date by the same path the route did.
    NOT_AFTER = Date.parse(new X509Certificate(PEM).validTo);
  });
  afterAll(() => rmSync(DIR, { recursive: true, force: true }));

  const graph = async (deps: Partial<ApiDeps>, now: Date) => {
    const { body } = await get({ store: memStore(), now: () => now, ...deps }, '/api/health');
    return (body as HealthResponse).credential.graph;
  };
  const DAY = 86_400_000;

  it('reports no credential as unconfigured, which is not a failure', async () => {
    // The default state of a machine nobody has given a credential to. It must
    // not read as expired, and it must not read as needing attention — the same
    // rule as "no probe data is not 100% uptime", pointed the other way.
    expect(await graph({}, new Date())).toEqual({
      configured: false,
      note: 'no Graph credential is configured for this process',
    });
  });

  it('reports a supplier that returns nothing as unconfigured too, not as unreadable', async () => {
    expect(await graph({ graphCert: () => undefined }, new Date())).toEqual({
      configured: false,
      note: 'no Graph credential is configured for this process',
    });
  });

  it('reports days remaining, counted from the certificate’s own notAfter', async () => {
    const health = await graph({ graphCert: () => PEM }, new Date(NOT_AFTER - 200 * DAY - 1000));
    expect(health).toMatchObject({
      configured: true,
      level: 'ok',
      needsAttention: false,
      daysLeft: 200,
      notAfter: new Date(NOT_AFTER).toISOString(),
    });
  });

  it('warns inside ninety days and escalates inside thirty', async () => {
    // Two instants, one certificate: the battery run where the answers differ.
    const warn = await graph({ graphCert: () => PEM }, new Date(NOT_AFTER - 60 * DAY));
    const critical = await graph({ graphCert: () => PEM }, new Date(NOT_AFTER - 10 * DAY));
    expect([warn, critical].map((c) => (c.configured ? [c.level, c.needsAttention] : ['unconfigured']))).toEqual([
      ['warn', true],
      ['critical', true],
    ]);
  });

  it('reports an expired certificate as expired, and needing attention', async () => {
    const health = await graph({ graphCert: () => PEM }, new Date(NOT_AFTER + DAY));
    expect(health).toMatchObject({ configured: true, level: 'expired', needsAttention: true });
  });

  it('reports a supplier that throws as unreadable, carrying the reason, and does not 500', async () => {
    // Reading the file is the caller's job and it can fail. "We cannot read our
    // own credential" is exactly what this field exists to surface, and a
    // health route that dies on it has taken away the page that explains it.
    const { statusCode, body } = await get(
      {
        store: memStore(),
        graphCert: () => {
          throw new Error('ENOENT: no such file or directory');
        },
      },
      '/api/health',
    );
    expect(statusCode).toBe(200);
    expect((body as HealthResponse).credential.graph).toEqual({
      configured: true,
      needsAttention: true,
      level: 'unreadable',
      reason: 'ENOENT: no such file or directory',
    });
  });

  it('reports rubbish as unreadable rather than parsing it leniently', async () => {
    const health = await graph({ graphCert: () => 'not a certificate' }, new Date());
    expect(health.configured).toBe(true);
    expect(health.configured && health.level).toBe('unreadable');
  });

  it('measures the credential against the injected clock', async () => {
    // Fresh against the real clock, expired against the injected one. Without
    // two clocks that disagree, a route reading `new Date()` would pass every
    // assertion above.
    const wall = await graph({ graphCert: () => PEM }, new Date());
    const future = await graph({ graphCert: () => PEM }, new Date(NOT_AFTER + DAY));
    expect([wall.configured && wall.level, future.configured && future.level]).toEqual(['ok', 'expired']);
  });

  it('asks the supplier on every request, so a swapped certificate is picked up', async () => {
    // A function and not a string, so the file can be replaced without a
    // restart — the one credential whose whole purpose is to be replaced.
    let calls = 0;
    const deps = { store: memStore(), graphCert: () => { calls += 1; return PEM; } };
    const app = buildApi(deps);
    try {
      await app.inject({ method: 'GET', url: '/api/health' });
      await app.inject({ method: 'GET', url: '/api/health' });
    } finally {
      await app.close();
    }
    expect(calls).toBe(2);
  });
});

/* ------------------------------------------------------------ read-only API */

describe('the API is read-only', () => {
  /** Reads the REGISTERED routes, not the result of trying a request. A POST
   *  that 404s proves only that one spelling is absent; this sees every route
   *  the router actually has. */
  const registered = async () => {
    const store = memStore();
    const app = buildApi({ store });
    const seen: Array<{ url: string; methods: string[] }> = [];
    app.addHook('onRoute', (route) => {
      seen.push({
        url: route.url,
        methods: Array.isArray(route.method) ? [...route.method] : [route.method],
      });
    });
    await app.ready();
    await app.close();
    return seen;
  };

  it('the route table this test reads is the real one', async () => {
    // Control: without this the method assertion below passes vacuously on an
    // empty list, which is exactly how a guard stops guarding.
    const seen = await registered();
    expect(seen.map((r) => r.url).sort()).toEqual(['/api/checks', '/api/health', '/api/incidents', '/api/services']);
  });

  it('every registered route is GET and nothing else', async () => {
    for (const route of await registered()) {
      expect(route.methods, route.url).toEqual(['GET']);
    }
  });

  it('the plugin is the only thing that registers routes', () => {
    expect(typeof apiRoutes).toBe('function');
  });
});

/* ------------------------------------------------ the derived current level */

describe('a stale payload never reaches the client as a colour', () => {
  /** G2 HIGH 4. `putSnapshot` branches on `error` alone, so an adapter that
   *  returns BOTH an `unknown` payload and an error has the payload dropped;
   *  `getSnapshot` then serves the last GOOD payload with the error attached.
   *  Mirroring that outward is correct and this route still does it — but
   *  `data.level` then says `operational` about a vendor we have not read for
   *  three hours, and `statusColor()` takes exactly that field. */
  const entryFor = async (id: string, prime: (s: Store) => void) => {
    const store = memStore();
    prime(store);
    const { body } = await get({ store }, '/api/services');
    return (body as ServicesResponse).services.find((s) => s.id === id)!;
  };

  it('a vendor erroring now reads unknown, while the envelope still carries the old payload', async () => {
    const entry = await entryFor('claude', (store) => {
      store.putSnapshot(vendorSource('claude'), good('operational', '2026-09-19T08:14:00.000Z'));
      store.putSnapshot(vendorSource('claude'), {
        fetchedAt: '2026-09-19T11:14:00.000Z',
        degraded: true,
        error: { code: 'http_503', message: '503 Service Unavailable' },
      });
    });

    expect(entry.currentLevel).toBe('unknown');
    // The mirror is intact: the old reading is still there to render as
    // "operational at 08:14", it is simply not what the tile is coloured by.
    expect((entry.result.data as { level: string }).level).toBe('operational');
    expect(entry.result.error?.code).toBe('http_503');
  });

  it('an affirmative, error-free statement of health is the only thing that reads operational', async () => {
    const entry = await entryFor('jira', (store) => {
      store.putSnapshot(vendorSource('jira'), good('operational', '2026-09-19T12:00:00.000Z'));
    });
    expect(entry.currentLevel).toBe('operational');
  });

  it('a service never polled reads unknown, not absent and not green', async () => {
    const entry = await entryFor('m365', () => {});
    expect(entry.currentLevel).toBe('unknown');
  });

  it('a level the contract does not define reads unknown', async () => {
    const entry = await entryFor('openai', (store) => {
      // A feed shape we have not seen, or a future adapter getting it wrong.
      store.putSnapshot(vendorSource('openai'), {
        data: { level: 'green' },
        fetchedAt: '2026-09-19T12:00:00.000Z',
        degraded: false,
      });
    });
    expect(entry.currentLevel).toBe('unknown');
  });
});

/* --------------------------------------------- the poller half of /health */

describe('the poller half of /api/health is computed from something that can speak', () => {
  const envelope = (over: Partial<SourceResult<unknown>> = {}): SourceResult<unknown> => ({
    data: { ok: true }, fetchedAt: '2026-09-19T12:00:00.000Z', degraded: false, ...over,
  });

  /**
   * Driven by a REAL `createSchedule`, not a hand-written status map.
   *
   * This is the test the previous `stalled[]` could not have had. That field
   * was computed from `lastError`, which at the time was set only when
   * `run()` threw — and nothing in this repo throws, so it was empty by
   * construction and every test of it passed. Running the real scheduler over
   * a source that throws AND one that returns an errored result is the world
   * where the two candidates differ; a hand-written map is a world where the
   * author has already decided the answer.
   *
   * It also pins `THREW_PREFIX` against the scheduler that produces it, so the
   * day that string changes this goes red rather than the constant going
   * quietly stale.
   */
  it('a real schedule: a thrown error is broken, an errored result is failing, a success is healthy', async () => {
    const sources: Source[] = [
      { name: 'ourBug', intervalMs: 60_000, run: async () => { throw new Error('probeFn is not a function'); } },
      { name: 'deadFeed', intervalMs: 60_000, run: async () =>
        envelope({ data: undefined, degraded: true, error: { code: 'http_503', message: '503 Service Unavailable' } }) },
      { name: 'goodFeed', intervalMs: 60_000, run: async () => envelope() },
    ];
    const schedule = createSchedule(sources);
    schedule.start();
    await vi.waitFor(() => {
      expect(schedule.statusOf('ourBug')?.lastError).toBeDefined();
      expect(schedule.statusOf('deadFeed')?.lastError).toBeDefined();
      expect(schedule.statusOf('goodFeed')?.lastOkAt).toBeDefined();
    });
    schedule.stop();

    const { body } = await get({ store: memStore(), poller: schedule }, '/api/health');
    const poller = (body as HealthResponse).poller;

    // Our bug and a vendor's outage are different facts with different
    // remedies, and this is the field that keeps them apart.
    expect(poller.broken).toEqual(['ourBug']);
    expect(poller.failing).toEqual(['deadFeed']);
    expect(poller.healthy).toEqual(['goodFeed']);
    expect(poller.neverSucceeded.sort()).toEqual(['deadFeed', 'ourBug']);
    expect(poller.neverRun).toEqual([]);
    expect(poller.ok).toBe(false);
  });

  it('every source succeeding on a real schedule is the only thing that reads ok', async () => {
    const schedule = createSchedule([
      { name: 'a', intervalMs: 60_000, run: async () => envelope() },
      { name: 'b', intervalMs: 60_000, run: async () => envelope({ empty: true }) },
    ]);
    schedule.start();
    await vi.waitFor(() => {
      expect(schedule.statusOf('a')?.lastOkAt).toBeDefined();
      expect(schedule.statusOf('b')?.lastOkAt).toBeDefined();
    });
    schedule.stop();

    const { body } = await get({ store: memStore(), poller: schedule }, '/api/health');
    const poller = (body as HealthResponse).poller;

    // `empty` is a completed read, not a failure to look — so `b` is healthy.
    expect(poller.healthy.sort()).toEqual(['a', 'b']);
    expect(poller.ok).toBe(true);
  });

  it('a source polled forty times that has never once succeeded is not healthy', async () => {
    // The exact G2 shape: the feed 503s every minute, so `runs` climbs, and
    // there is no last good payload behind it at all.
    const { body } = await get(
      {
        store: memStore(),
        poller: pollerWith({
          // Written out rather than spread over `statusOf`, because the
          // absence of `lastOkAt` IS the fact under test and a spread with
          // `lastOkAt: undefined` does not typecheck under
          // exactOptionalPropertyTypes.
          'vendor:m365': {
            baseline: false,
            intervalMs: 60_000,
            runs: 40,
            skipped: 0,
            lastRunAt: '2026-09-19T12:00:00.000Z',
            lastError: 'http_503: 503 Service Unavailable',
          },
        }),
      },
      '/api/health',
    );
    const poller = (body as HealthResponse).poller;

    expect(poller.ok).toBe(false);
    expect(poller.failing).toEqual(['vendor:m365']);
    expect(poller.neverSucceeded).toEqual(['vendor:m365']);
    expect(poller.healthy).toEqual([]);
  });

  it('a poller that was built and never started reads not ok, and says which sources never ran', async () => {
    // The hole in the first version of this route: no source had complained,
    // because no source had run. `start()` is deliberately not called.
    const schedule = createSchedule([{ name: 'vendor:jira', intervalMs: 60_000, run: async () => envelope() }]);
    const { body } = await get({ store: memStore(), poller: schedule }, '/api/health');
    const poller = (body as HealthResponse).poller;

    expect(poller.configured).toBe(true);
    expect(poller.neverRun).toEqual(['vendor:jira']);
    expect(poller.healthy).toEqual([]);
    expect(poller.ok).toBe(false);
  });

  it('a source that has run but recorded neither a success nor an error is not healthy', async () => {
    // Found by mutation: dropping the `lastOkAt` check from `classify` killed
    // nothing, because every other test reaches that branch with a `lastError`
    // set. This is the world where the two candidates differ.
    //
    // Today's `createSchedule` cannot produce this state — it sets one of the
    // two on every tick. The rule is still load-bearing: `ApiPoller` is a
    // structural type that anything can implement, and the whole finding
    // behind this rewrite was a health field that read calm because nothing
    // had complained. Silence is not evidence of a successful poll.
    const { body } = await get(
      {
        store: memStore(),
        poller: pollerWith({
          'vendor:jira': { baseline: false, intervalMs: 60_000, runs: 7, skipped: 0, lastRunAt: '2026-09-19T12:00:00.000Z' },
        }),
      },
      '/api/health',
    );
    const poller = (body as HealthResponse).poller;

    expect(poller.healthy).toEqual([]);
    expect(poller.neverSucceeded).toEqual(['vendor:jira']);
    expect(poller.ok).toBe(false);
  });

  it('a poller with no sources at all is not ok', async () => {
    // `healthy.length === entries.length` is true of two empty lists. An
    // all-clear made of nothing is the emptiest kind of green there is.
    const { body } = await get({ store: memStore(), poller: pollerWith({}) }, '/api/health');
    expect((body as HealthResponse).poller.ok).toBe(false);
  });
});

describe('GET /api/checks — the runs behind the counts', () => {
  const runsFor = (n: number, failing = 0) =>
    Array.from({ length: n }, (_, i) => ({
      serviceId: 'zendesk' as const,
      at: new Date(Date.parse('2026-09-19T12:00:00.000Z') - i * 60_000).toISOString(),
      check: i % 2 === 0 ? 'Zendesk pod: crexendo' : 'Zendesk pod: netsapiens',
      region: 'us-east',
      result: (i < failing ? 'fail' : 'pass') as 'fail' | 'pass',
      latencyMs: i < failing ? null : 40 + i,
    }));

  it('serves the individual runs for a service', async () => {
    // `/api/services` says "1 of 2 checks passing"; this says WHICH, when, from
    // where and how fast. Without it the detail page could only print the count
    // and admit the runs were not served — honest, and useless to anyone trying
    // to work out which pod is down.
    const store = { ...memStore(), runsFor: () => runsFor(4, 1) };
    const res = await get({ store }, '/api/checks?service=zendesk');
    expect(res.statusCode).toBe(200);
    const body = res.body as { data?: { check: string; result: string }[]; empty?: boolean };
    expect(body.data).toHaveLength(4);
    expect(body.data![0]!.result).toBe('fail');
    expect(body.data![0]!.check).toBe('Zendesk pod: crexendo');
    expect(body.empty).toBeUndefined();
  });

  it('empty is a completed read of a service with no runs', async () => {
    // Amendment 4, at the last hop. Five of seven services have no probe at
    // all, so this is the common path — and it must not look like a failure.
    const store = { ...memStore(), runsFor: () => [] };
    const body = (await get({ store }, '/api/checks?service=claude')).body as {
      data?: unknown[]; empty?: boolean; error?: unknown;
    };
    expect(body.empty).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.error).toBeUndefined();
  });

  it('a store failure is an error with NO data, at 200', async () => {
    // "We looked and there are none" and "we could not look" must not render
    // the same, and the transport succeeded either way.
    const store = { ...memStore(), runsFor: () => { throw new Error('disk gone'); } };
    const res = await get({ store }, '/api/checks?service=zendesk');
    expect(res.statusCode).toBe(200);
    const body = res.body as { data?: unknown; empty?: boolean; error?: { code: string } };
    expect(body.error?.code).toBe('store_unavailable');
    expect(body.data).toBeUndefined();
    expect(body.empty).toBeUndefined();
  });

  it('refuses a service that is not one of the seven', async () => {
    // An unknown id would otherwise return an empty list, and "no runs" for a
    // service that does not exist reads exactly like "no runs" for one that
    // does. 400, because this is the caller's mistake and not ours.
    for (const q of ['?service=nope', '?service=', '', '?service[]=zendesk']) {
      const res = await get({ store: memStore() }, `/api/checks${q}`);
      expect(res.statusCode, q).toBe(400);
      expect((res.body as { error?: { code: string } }).error?.code).toBe('bad_service');
    }
  });

  it('caps the page rather than serving the whole log', async () => {
    // The detail page shows a table, not a history. Asserted on the argument
    // the store was given, because a store that ignored the limit would make a
    // length assertion pass while the route asked for everything.
    let askedLimit: number | undefined;
    const store = { ...memStore(), runsFor: (_id: unknown, limit?: number) => { askedLimit = limit; return runsFor(3); } };
    await get({ store }, '/api/checks?service=zendesk');
    expect(askedLimit).toBe(CHECKS_PAGE);
  });
});
