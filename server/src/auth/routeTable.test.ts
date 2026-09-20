import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { ApiStore } from '../api/routes.js';
import { buildApi } from '../api/routes.js';
import { serveDashboard } from '../static.js';
import { AUTH_POLICIES, createSessionAuth, registerAuth, type AuthPolicy, type SessionAuth } from './session.js';

/**
 * **The deliverable of the auth task.** Not the middleware — this.
 *
 * A middleware is one file somebody reads once. What has to survive six months
 * is the property that *a route added later cannot ship open*, and the only
 * form of that which holds is a test that enumerates the real router and fails
 * when the set changes.
 *
 * Two things make this a guard rather than a restatement of the code:
 *
 *  - **It is a POSITIVE set.** Every route, its method and its declared policy,
 *    as literals. The absence form — "no unprotected mutating route exists" —
 *    is the one this project has watched pass over anything nobody thought to
 *    require: it is green against an empty router, a renamed plugin, a walk
 *    that found nothing. This one fails when a route appears, when one
 *    disappears, and when a policy changes, which is the whole space.
 *  - **It reads the router, not the source.** `onRoute` sees what Fastify will
 *    actually dispatch, so a route registered by any means, under any spelling,
 *    is in the list — **for the instance it is pointed at.** That qualifier is
 *    M-2: the first version pointed only at `buildApi` while the process also
 *    registers the SPA's `GET /*` on the same instance from `main.ts`, so the
 *    claim was broader than the evidence. There are now two enumerations: the
 *    plugin's, and the composed process's.
 */

const quietStore = (): ApiStore => ({
  getSnapshot: () => undefined,
  openIncidents: () => [],
  runsFor: () => [],
  percentiles: () => undefined,
  uptime: () => undefined,
  incidentsSince: () => [],
  // The writers, present because `ApiStore` requires them and doing nothing
  // because these tests are about the seam rather than about what it writes.
  // Required rather than optional on purpose: a store that cannot write is a
  // state nobody would compose and a branch nobody would test.
  acknowledge: () => undefined,
  mute: () => undefined,
  unmute: () => undefined,
  resolveIncident: () => undefined,
  incidentFlags: () => ({}),
  allIncidentFlags: () => ({}),
});

type Row = { method: string; url: string; policy: AuthPolicy | undefined };

/** The routes the PROCESS serves: the API plugin plus the SPA, composed the
 *  way `main.ts` composes them. The root argument is never read — nothing here
 *  makes a request — so a path that does not exist is the honest choice. */
const composedTable = async (): Promise<Row[]> => {
  const app = buildApi({ store: quietStore() });
  const rows: Row[] = [];
  // **The hook goes on BEFORE `serveDashboard`, and that ordering is the whole
  // reason this enumeration is trustworthy.** `onRoute` fires only for routes
  // registered after it is added. `buildApi` wraps the API in `register`, so
  // those are booted at `ready()` and a hook added later still sees them —
  // which is why the plugin enumeration above works. `serveDashboard` calls
  // `app.get` directly, so it is registered the instant it is called and a hook
  // added afterwards misses it silently. My first version of this helper did
  // exactly that and reported seven routes where the process serves eight: a
  // guard that had gone blind to the one route it was written to see.
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) rows.push({ method, url: route.url, policy: route.config?.auth });
  });
  serveDashboard(app, '/no/such/dist');
  await app.ready();
  await app.close();
  return rows.sort((a, b) => `${a.url} ${a.method}`.localeCompare(`${b.url} ${b.method}`));
};

/** Every route the real API registers, with the policy each one declares. */
const routeTable = async (): Promise<Row[]> => {
  const app = buildApi({ store: quietStore() });
  const rows: Row[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      rows.push({ method, url: route.url, policy: route.config?.auth });
    }
  });
  await app.ready();
  await app.close();
  return rows.sort((a, b) => `${a.url} ${a.method}`.localeCompare(`${b.url} ${b.method}`));
};

/**
 * The one set of non-GET routes that may be reached without a session, named
 * here and nowhere else.
 *
 * Signing in cannot require being signed in. That is the entire justification,
 * it admits exactly one member, and a second entry is a line someone has to
 * write in this file with their name on the commit.
 */
const MAY_MUTATE_WITHOUT_A_SESSION = ['POST /api/session'];

describe('the route table — every route declares a policy, and every write needs a session', () => {
  it('is exactly these routes, with exactly these policies', async () => {
    // Literals, deliberately. A table derived from the routes would agree with
    // the routes by construction and could never disagree with them, which is
    // the tautology this repo has now paid for four times.
    expect(await routeTable()).toEqual([
      { method: 'GET', url: '/api/checks', policy: 'public-read' },
      { method: 'GET', url: '/api/endpoints', policy: 'public-read' },
      { method: 'GET', url: '/api/entra', policy: 'public-read' },
      { method: 'GET', url: '/api/health', policy: 'public-read' },
      { method: 'GET', url: '/api/incidents', policy: 'public-read' },
      { method: 'POST', url: '/api/incidents/:id/ack', policy: 'required' },
      { method: 'POST', url: '/api/incidents/:id/mute', policy: 'required' },
      { method: 'POST', url: '/api/incidents/:id/resolve', policy: 'required' },
      { method: 'POST', url: '/api/incidents/:id/unmute', policy: 'required' },
      { method: 'GET', url: '/api/services', policy: 'public-read' },
      { method: 'DELETE', url: '/api/session', policy: 'required' },
      { method: 'POST', url: '/api/session', policy: 'login' },
    ]);
  });

  it('every route that can change something is behind the seam, with one named exception', async () => {
    // The rule, derived from the router rather than from the list above — so a
    // route added in six months is caught here even if somebody "fixed" the
    // enumeration by pasting the new row in without reading it.
    const open = (await routeTable())
      .filter((r) => r.method !== 'GET' && r.policy !== 'required')
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(open).toEqual(MAY_MUTATE_WITHOUT_A_SESSION);
  });

  it('no route is left without a policy at all', async () => {
    const undeclared = (await routeTable()).filter((r) => r.policy === undefined).map((r) => `${r.method} ${r.url}`);
    expect(undeclared).toEqual([]);
  });

  it('the COMPOSED process has exactly these routes too — including the one outside the seam', async () => {
    // **M-2. The three assertions above read `buildApi` alone, and the process
    // does not run `buildApi` alone**: `main.ts` calls `serveDashboard` on the
    // same instance, which registers `GET /*` for the SPA. That route is
    // OUTSIDE the encapsulated plugin, so the fail-closed hook never sees it —
    // and the docblock above used to claim that a route registered anywhere, by
    // anything, was in this list. It was not.
    //
    // So this enumerates what the process actually serves. `GET /*` is pinned
    // with `policy: undefined`, which is the honest record of the gap rather
    // than a hole nobody can see: it is a GET, it serves files from `web/dist`
    // and refuses `/api/*` itself, so nothing is unprotected today. The moment
    // anything non-GET is registered outside the plugin, the next assertion
    // fails.
    //
    // The runtime half needs `static.ts` to declare a policy so the hook can
    // move to the root instance; that file is not mine and the change is
    // requested rather than made.
    expect(await composedTable()).toEqual([
      { method: 'GET', url: '/*', policy: 'public-read' },
      { method: 'GET', url: '/api/checks', policy: 'public-read' },
      { method: 'GET', url: '/api/endpoints', policy: 'public-read' },
      { method: 'GET', url: '/api/entra', policy: 'public-read' },
      { method: 'GET', url: '/api/health', policy: 'public-read' },
      { method: 'GET', url: '/api/incidents', policy: 'public-read' },
      { method: 'POST', url: '/api/incidents/:id/ack', policy: 'required' },
      { method: 'POST', url: '/api/incidents/:id/mute', policy: 'required' },
      { method: 'POST', url: '/api/incidents/:id/resolve', policy: 'required' },
      { method: 'POST', url: '/api/incidents/:id/unmute', policy: 'required' },
      { method: 'GET', url: '/api/services', policy: 'public-read' },
      { method: 'DELETE', url: '/api/session', policy: 'required' },
      { method: 'POST', url: '/api/session', policy: 'login' },
    ]);
  });

  it('every route the PROCESS serves declares a policy — including the ones outside the plugin', async () => {
    // M-2, both halves now closed. The guard half is the enumeration above; the
    // runtime half is `static.ts` declaring `'public-read'` on the SPA
    // wildcard, which let the hook move from inside the plugin to the ROOT
    // instance — so a route registered from `main.ts` or `static.ts` is now
    // refused for having no policy exactly as one in `api/routes.ts` is.
    //
    // Stated positively: every route has a policy, and the set that can change
    // something is exactly these six. A route added anywhere fails one of the
    // two.
    const composed = await composedTable();
    // The message says which DIRECTION the drift went. `expected [] to deeply
    // equal ['GET /*']` reads identically whether a row appeared or vanished,
    // and those are opposite events with opposite remedies — two agents spent
    // real minutes working out which one it was when this last fired.
    const undeclared = composed.filter((r) => r.policy === undefined).map((r) => `${r.method} ${r.url}`);
    expect(undeclared, `these routes APPEARED without a policy: ${undeclared.join(', ')}`).toEqual([]);
    expect(composed.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`).sort()).toEqual([
      'DELETE /api/session',
      'POST /api/incidents/:id/ack',
      'POST /api/incidents/:id/mute',
      'POST /api/incidents/:id/resolve',
      'POST /api/incidents/:id/unmute',
      'POST /api/session',
    ]);
  });

  it('reads a real, non-empty router — the control for all three above', async () => {
    // Every assertion above is satisfied by an empty list except the first, and
    // the first would be "fixed" by deleting a row. This says the walk found a
    // router at all, against a count and a literal nobody can rename away.
    const rows = await routeTable();
    expect(rows.length).toBeGreaterThanOrEqual(11);
    expect(rows.map((r) => `${r.method} ${r.url}`)).toContain('GET /api/services');
  });

  it('the policy vocabulary is closed — a fourth value is not something a route can invent', () => {
    expect([...AUTH_POLICIES]).toEqual(['public-read', 'login', 'required']);
  });
});

/* ------------------------------------------------- the fail-closed control */

/** An app wearing the real hook, with whatever routes a test wants to plant. */
const planted = async (
  register: (app: ReturnType<typeof Fastify>) => void,
  auth: SessionAuth = createSessionAuth({ loadConfig: () => { throw new Error('unconfigured'); } }),
) => {
  const app = Fastify({ logger: false, exposeHeadRoutes: false });
  await app.register(async (scope) => {
    registerAuth(scope, auth);
    register(scope);
  });
  await app.ready();
  return {
    app,
    inject: (method: 'GET' | 'POST', url: string) => app.inject({ method, url }),
  };
};

describe('a route that declares no policy is refused before its handler runs', () => {
  it('refuses it with 500 and never reaches the handler — the control that makes the guard real', async () => {
    // The failure mode this seam is actually built for: somebody adds a route
    // in six months and does not think about auth. The build breaks (above),
    // AND the running server refuses it (here). Either alone is a single point
    // of failure — a guard can be edited, and a runtime check can be forgotten.
    let ran = false;
    const t = await planted((scope) => {
      scope.post('/api/forgot', async () => { ran = true; return { ok: true }; });
    });
    try {
      const res = await t.inject('POST', '/api/forgot');
      expect(res.statusCode).toBe(500);
      expect((res.json() as { error: { code: string } }).error.code).toBe('auth_policy_missing');
      expect(ran).toBe(false);
    } finally {
      await t.app.close();
    }
  });

  it('refuses a policy that is not one of the three, rather than treating it as public', async () => {
    // A typo — `'public'`, `'open'`, `'none'` — must not be a way through. An
    // unrecognised policy is a route with no policy.
    let ran = false;
    const t = await planted((scope) => {
      scope.post('/api/typo', { config: { auth: 'publicread' as AuthPolicy } }, async () => { ran = true; return { ok: true }; });
    });
    try {
      expect((await t.inject('POST', '/api/typo')).statusCode).toBe(500);
      expect(ran).toBe(false);
    } finally {
      await t.app.close();
    }
  });

  it('serves a declared public route normally — the other control, so 500 is not simply what this hook always does', async () => {
    let ran = false;
    const t = await planted((scope) => {
      scope.get('/api/fine', { config: { auth: 'public-read' } }, async () => { ran = true; return { ok: true }; });
    });
    try {
      expect((await t.inject('GET', '/api/fine')).statusCode).toBe(200);
      expect(ran).toBe(true);
    } finally {
      await t.app.close();
    }
  });

  it('refuses a declared `required` route on an unconfigured host, and does not run it', async () => {
    let ran = false;
    const t = await planted((scope) => {
      scope.post('/api/write', { config: { auth: 'required' } }, async () => { ran = true; return { ok: true }; });
    });
    try {
      expect((await t.inject('POST', '/api/write')).statusCode).toBe(503);
      expect(ran).toBe(false);
    } finally {
      await t.app.close();
    }
  });
});
