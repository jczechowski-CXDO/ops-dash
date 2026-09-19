import { describe, it, expect, afterEach } from 'vitest';
import type { SourceResult } from '@ops-dash/shared';
import { openStore, type Store } from '../store/db.js';
import type { SourceStatus } from '../poller/schedule.js';
import {
  buildApi,
  apiRoutes,
  vendorSource,
  SERVICE_ORDER,
  type ApiStore,
  type ApiPoller,
  type ServicesResponse,
  type IncidentsResponse,
  type HealthResponse,
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
});

const get = async (deps: { store: ApiStore; poller?: ApiPoller }, url: string) => {
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
      (body as IncidentsResponse).result.data!.map((i) => [i.id, i.severity]),
    );

    expect(byId['INC-1']).toBe('info');
    // A severity we cannot read is a thing we cannot see, and this codebase
    // never renders a thing it cannot see as benign.
    expect(byId['INC-2']).toBe(1);
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
  it('a broken store with a healthy poller: store not ok, poller ok', async () => {
    const { statusCode, body } = await get(
      { store: brokenStore(), poller: pollerWith({ 'vendor:jira': statusOf() }) },
      '/api/health',
    );
    const health = body as HealthResponse;

    expect(statusCode).toBe(200);
    expect(health.store.ok).toBe(false);
    expect(health.store.error).toContain('database connection is not open');
    expect(health.poller.ok).toBe(true);
    expect(health.poller.stalled).toEqual([]);
  });

  it('a healthy store with a stalled poller: store ok, poller not ok, and which source', async () => {
    const store = memStore();
    const { body } = await get(
      {
        store,
        poller: pollerWith({
          'vendor:jira': statusOf(),
          'probes': statusOf({ lastError: 'probeFn is not a function' }),
        }),
      },
      '/api/health',
    );
    const health = body as HealthResponse;

    expect(health.store.ok).toBe(true);
    expect(health.store.error).toBeUndefined();
    expect(health.poller.ok).toBe(false);
    expect(health.poller.stalled).toEqual(['probes']);
    // The per-source detail is mirrored, not summarised away.
    expect(health.poller.sources['probes']!.lastError).toBe('probeFn is not a function');
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
    expect(seen.map((r) => r.url).sort()).toEqual(['/api/health', '/api/incidents', '/api/services']);
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
