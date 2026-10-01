import { describe, it, expect } from 'vitest';
import type { FetchLike } from '../../http/fetchJson.js';
import type { TokenSource } from '../../http/graphToken.js';
import type { VendorFeed } from './common.js';
import { GRAPH_HEALTH, HEALTH_OVERVIEWS_URL, pollMsgraph } from './msgraph.js';

const feed = (over: Partial<VendorFeed> = {}): VendorFeed => ({
  id: 'm365',
  platform: 'msgraph',
  url: HEALTH_OVERVIEWS_URL,
  components: ['Exchange Online', 'Microsoft Entra', 'Microsoft Teams'],
  ...over,
});

/** A token source that always works, and never touches a real credential. */
const goodToken = (): TokenSource =>
  ({ get: async () => ({ token: 'stub-token' }), reset: () => {} }) as unknown as TokenSource;

const failingToken = (code = 'graph_auth_http_401'): TokenSource =>
  ({ get: async () => ({ error: { code, message: 'refused' } }), reset: () => {} }) as unknown as TokenSource;

/** The live shape, trimmed: `value[]` of `{ service, status }`. */
const overviews = (rows: Record<string, string>) =>
  ({ value: Object.entries(rows).map(([service, status]) => ({ service, status, id: service })) });

const serve = (body: unknown, status = 200): { impl: FetchLike; seen: RequestInit[] } => {
  const seen: RequestInit[] = [];
  const impl: FetchLike = async (_url, init) => {
    if (init) seen.push(init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, seen };
};

const ALL_WELL = {
  'Exchange Online': 'serviceOperational',
  'Microsoft Entra': 'serviceOperational',
  'Microsoft Teams': 'serviceOperational',
  'Microsoft Viva': 'serviceDegradation',      // not one of ours
  'Microsoft 365 Copilot Chat': 'serviceDegradation',
};

describe('the Graph health map', () => {
  it('maps the statuses Microsoft publishes', () => {
    // Two observed live (serviceOperational, serviceDegradation); the rest from
    // Microsoft's enumeration, pinned as literals.
    expect(GRAPH_HEALTH['serviceOperational']).toBe('operational');
    expect(GRAPH_HEALTH['serviceDegradation']).toBe('degraded');
    expect(GRAPH_HEALTH['serviceInterruption']).toBe('outage');
    expect(GRAPH_HEALTH['extendedRecovery']).toBe('degraded');
    expect(GRAPH_HEALTH['investigating']).toBe('degraded');
    expect(GRAPH_HEALTH['resolved']).toBe('operational');
    expect(GRAPH_HEALTH['falsePositive']).toBe('operational');
  });

  it('serviceInterruption is the ONLY outage', () => {
    // The judgement worth pinning: investigating/restoring/verifying is
    // Microsoft saying "something is wrong and we do not yet know how badly",
    // which `degraded` states honestly and `outage` overstates.
    const outages = Object.entries(GRAPH_HEALTH).filter(([, l]) => l === 'outage').map(([k]) => k);
    expect(outages).toEqual(['serviceInterruption']);
  });

  it('an unrecognised status is unknown, never operational', async () => {
    // Microsoft adds to this enumeration. A new value must not read healthy.
    const { impl } = serve(overviews({ ...ALL_WELL, 'Exchange Online': 'someNewThing' }));
    const r = await pollMsgraph(feed(), impl, goodToken());
    expect(r.data!.level).toBe('unknown');
  });
});

describe('pollMsgraph', () => {
  it('sends the bearer token', async () => {
    const { impl, seen } = serve(overviews(ALL_WELL));
    await pollMsgraph(feed(), impl, goodToken());
    expect((seen[0]!.headers as Record<string, string>)['authorization']).toBe('Bearer stub-token');
  });

  it('rolls up only the services we depend on', async () => {
    // Microsoft always has something degraded somewhere — nine of thirty-two on
    // the day this was written, three of them Copilot. Rolling up all of them
    // leaves the tile permanently amber, which teaches the operator to ignore
    // it. Here Viva and Copilot are degraded and must not reach us.
    const { impl } = serve(overviews(ALL_WELL));
    const r = await pollMsgraph(feed(), impl, goodToken());
    expect(r.data!.level).toBe('operational');
    expect(r.data!.note).toContain('all 3 services we depend on operational');
    expect(r.data!.note).not.toContain('Viva');
  });

  it('a service we DO depend on going degraded reaches the tile', async () => {
    // The positive control for the test above: without it, that one passes just
    // as happily if the filter drops everything.
    const { impl } = serve(overviews({ ...ALL_WELL, 'Microsoft Teams': 'serviceDegradation' }));
    const r = await pollMsgraph(feed(), impl, goodToken());
    expect(r.data!.level).toBe('degraded');
    expect(r.data!.note).toContain('Microsoft Teams (serviceDegradation)');
  });

  it('worst wins across our services', async () => {
    const { impl } = serve(overviews({
      ...ALL_WELL, 'Microsoft Teams': 'serviceDegradation', 'Exchange Online': 'serviceInterruption',
    }));
    const r = await pollMsgraph(feed(), impl, goodToken());
    expect(r.data!.level).toBe('outage');
  });

  it('reads unknown when a service we watch stops being reported', async () => {
    // Never a quietly shorter list that still reads healthy. Same rule as every
    // other adapter here.
    const { impl } = serve(overviews({ 'Exchange Online': 'serviceOperational', 'Microsoft Entra': 'serviceOperational' }));
    const r = await pollMsgraph(feed(), impl, goodToken());
    expect(r.data!.level).toBe('unknown');
    expect(r.data!.note).toContain('Microsoft Teams');
    expect(r.data!.note).toContain('no longer reports');
  });

  it('rolls up everything when no components are named', async () => {
    const { locations: _l, components: _c, ...noComponents } = feed();
    const { impl } = serve(overviews(ALL_WELL));
    const r = await pollMsgraph(noComponents, impl, goodToken());
    expect(r.data!.level).toBe('degraded');   // Viva and Copilot now count
    expect(r.data!.note).toContain('of 5 services');
  });
});

describe('failure never reads as green', () => {
  it('an auth failure is unknown, and says it is OUR failure to look', async () => {
    const { impl } = serve(overviews(ALL_WELL));
    const r = await pollMsgraph(feed(), impl, failingToken());
    expect(r.data!.level).toBe('unknown');
    expect(r.error?.code).toBe('graph_auth_http_401');
    expect(r.data!.note).toContain('our failure to look');
  });

  it('does not call Graph at all when there is no token', async () => {
    // A request with no Authorization header would come back 401 and read as a
    // Microsoft problem. Asserted by counting calls, not by inspecting one.
    let calls = 0;
    const impl: FetchLike = async () => { calls += 1; return new Response('{}', { status: 200 }); };
    await pollMsgraph(feed(), impl, failingToken());
    expect(calls).toBe(0);
  });

  it('a 5xx from Graph is unknown with the code attached', async () => {
    const { impl } = serve('', 503);
    const r = await pollMsgraph(feed(), impl, goodToken());
    expect(r.data!.level).toBe('unknown');
    expect(r.error?.code).toBe('http_503');
  });

  it('a 2xx carrying HTML is unknown, not an empty healthy estate', async () => {
    const impl: FetchLike = async () =>
      new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'application/json' } });
    const r = await pollMsgraph(feed(), impl, goodToken());
    expect(r.data!.level).toBe('unknown');
    expect(r.error?.code).toBe('non_json_2xx');
  });

  it('carries the platform on every path, including the failures', async () => {
    const cases = [serve(overviews(ALL_WELL)).impl, serve('', 503).impl, serve({ nope: 1 }).impl];
    for (const impl of cases) {
      expect((await pollMsgraph(feed(), impl, goodToken())).data!.platform).toBe('msgraph');
    }
    expect((await pollMsgraph(feed(), serve({}).impl, failingToken())).data!.platform).toBe('msgraph');
  });
});
