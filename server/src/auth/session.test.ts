import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ApiStore } from '../api/routes.js';
import { buildApi, type HealthResponse } from '../api/routes.js';
import { hashPassword } from './credentials.js';
import { SESSION_COOKIE, SESSION_TTL_MS } from './cookie.js';
import { createSessionAuth } from './session.js';

/**
 * The seam end to end, against a REAL credential file at a real path with real
 * modes — not a stub.
 *
 * `api/routes.test.ts` stubs the decision on purpose, because those tests are
 * about what a route does with an answer. This file is about how the answer is
 * reached, and stubbing anything here would leave the two halves untested
 * between them: the mode check, the env var, the cookie the browser would
 * actually send back.
 */

const PASSWORD = 'a correct horse battery staple';
const USERNAME = 'operator';
const NOW = new Date(Date.UTC(2026, 8, 20, 9, 0, 0));

let DIR: string;
let CONFIG: string;
let previous: string | undefined;

const writeConfig = (over: Record<string, unknown> = {}, mode = 0o600): void => {
  writeFileSync(
    CONFIG,
    JSON.stringify({
      username: USERNAME,
      password_hash: hashPassword(PASSWORD),
      session_key: randomBytes(32).toString('hex'),
      ...over,
    }),
  );
  chmodSync(CONFIG, mode);
};

beforeAll(() => {
  DIR = mkdtempSync(join(tmpdir(), 'ops-dash-auth-'));
  CONFIG = join(DIR, 'auth.json');
  previous = process.env['OPS_DASH_AUTH_CONFIG'];
  process.env['OPS_DASH_AUTH_CONFIG'] = CONFIG;
  writeConfig();
});
afterAll(() => {
  if (previous === undefined) delete process.env['OPS_DASH_AUTH_CONFIG'];
  else process.env['OPS_DASH_AUTH_CONFIG'] = previous;
  rmSync(DIR, { recursive: true, force: true });
});

/** A store that answers nothing and throws at nothing: these tests are about
 *  the seam, and a route's payload is `api/routes.test.ts`'s business. */
const quietStore = (): ApiStore => ({
  getSnapshot: () => undefined,
  openIncidents: () => [],
  runsFor: () => [],
  percentiles: () => undefined,
  uptime: () => undefined,
  incidentsSince: () => [],
});

const withApp = async <T>(fn: (app: ReturnType<typeof buildApi>) => Promise<T>): Promise<T> => {
  const app = buildApi({ store: quietStore(), now: () => NOW, auth: createSessionAuth() });
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
};

/** Sign in the way a browser does, and hand back the cookie it would keep. */
const signIn = async (app: ReturnType<typeof buildApi>, body: unknown = { username: USERNAME, password: PASSWORD }) => {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: body as object });
  const setCookie = res.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown>, setCookie: header ?? '' };
};

describe('signing in', () => {
  it('exchanges the right credential for a session cookie', async () => {
    await withApp(async (app) => {
      const { statusCode, body, setCookie } = await signIn(app);
      expect(statusCode).toBe(200);
      expect(body).toEqual({ username: USERNAME });
      expect(setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
      // The password is nowhere in the answer, and neither is the hash.
      expect(JSON.stringify(body) + setCookie).not.toContain(PASSWORD);
    });
  });

  it('refuses the wrong password, and says the same thing for a wrong username', async () => {
    // One message for both halves. Two different messages would tell an
    // attacker which half to keep — and there is exactly one account here, so
    // that is the whole search space halved for free.
    await withApp(async (app) => {
      const badPassword = await signIn(app, { username: USERNAME, password: 'nope' });
      const badUsername = await signIn(app, { username: 'someone else', password: PASSWORD });
      expect([badPassword.statusCode, badUsername.statusCode]).toEqual([401, 401]);
      expect(badPassword.body).toEqual(badUsername.body);
      expect(badPassword.setCookie).toBe('');
    });
  });

  it('refuses a body that is not a username and a password', async () => {
    await withApp(async (app) => {
      for (const body of [{}, { username: USERNAME }, { username: 1, password: 2 }, []]) {
        const res = await signIn(app, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
    });
  });
});

describe('a mutating route needs a session', () => {
  it('refuses the logout route with no cookie, and serves it with one', async () => {
    // The end-to-end shape of the seam: same route, same server, one cookie
    // apart. `DELETE /api/session` is the only mutating route that exists
    // today, which is exactly why the route-table guard exists beside it.
    await withApp(async (app) => {
      const anonymous = await app.inject({ method: 'DELETE', url: '/api/session' });
      expect(anonymous.statusCode).toBe(401);
      expect((anonymous.json() as { error: { code: string } }).error.code).toBe('unauthenticated');

      const { setCookie } = await signIn(app);
      const signedIn = await app.inject({
        method: 'DELETE',
        url: '/api/session',
        headers: { cookie: setCookie.split(';')[0] ?? '' },
      });
      expect(signedIn.statusCode).toBe(200);
      expect(signedIn.json()).toEqual({ signedOut: USERNAME });
      expect(String(signedIn.headers['set-cookie'])).toContain('Max-Age=0');
    });
  });

  it('refuses a cookie signed with another key — a forged session is not a session', async () => {
    await withApp(async (app) => {
      const { setCookie } = await signIn(app);
      const value = (setCookie.split(';')[0] ?? '').split('=')[1] ?? '';
      const [payload] = value.split('.');
      const forged = `${SESSION_COOKIE}=${payload}.${'A'.repeat(43)}`;
      const res = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie: forged } });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe('session_invalid');
    });
  });

  it('refuses a session that has aged out, on the server’s clock rather than the browser’s', async () => {
    // Max-Age is advice to a browser; a client that ignores it must still be
    // refused. Same cookie, a server whose clock is a day later.
    const cookie = await withApp(async (app) => (await signIn(app)).setCookie.split(';')[0] ?? '');
    const later = buildApi({ store: quietStore(), now: () => new Date(NOW.getTime() + 25 * 3600_000), auth: createSessionAuth() });
    try {
      const res = await later.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe('session_expired');
    } finally {
      await later.close();
    }
  });
});

describe('an unconfigured host fails closed', () => {
  it('refuses a mutating route with 503 rather than serving it, and says why', async () => {
    // The state a fresh box is in, and the one most likely to be reachable
    // before anyone has thought about it. "No credential" must never mean
    // "no check" — this is the assertion that says so.
    const auth = createSessionAuth({
      loadConfig: () => {
        throw new Error('no credential file');
      },
    });
    const app = buildApi({ store: quietStore(), now: () => NOW, auth });
    try {
      const res = await app.inject({ method: 'DELETE', url: '/api/session' });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('auth_unconfigured');
      const login = await app.inject({ method: 'POST', url: '/api/session', payload: { username: USERNAME, password: PASSWORD } });
      expect(login.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it('says nothing about where the credential is or what is wrong with it', async () => {
    // The one thing this module must never leak. The loader's message names a
    // path; the reply must not carry it, at any status.
    const auth = createSessionAuth({
      loadConfig: () => {
        throw new Error('ENOENT: /home/someone/.config/ops-dash/auth.json');
      },
    });
    const app = buildApi({ store: quietStore(), now: () => NOW, auth });
    try {
      const res = await app.inject({ method: 'DELETE', url: '/api/session' });
      expect(res.body).not.toContain('.config');
      expect(res.body).not.toContain('ENOENT');
    } finally {
      await app.close();
    }
  });
});

describe('/api/health discloses the certificate to a signed-in operator only', () => {
  const health = async (app: ReturnType<typeof buildApi>, cookie?: string) => {
    const res = await app.inject({ method: 'GET', url: '/api/health', ...(cookie ? { headers: { cookie } } : {}) });
    return { statusCode: res.statusCode, body: res.json() as HealthResponse };
  };

  it('answers the liveness question to anyone — that is the half that must not need a credential', async () => {
    await withApp(async (app) => {
      const { statusCode, body } = await health(app);
      expect(statusCode).toBe(200);
      expect(body.store.ok).toBe(true);
      expect(body.auth).toEqual({
        mode: 'local-user',
        authenticated: false,
        note: expect.stringContaining('local operator credential'),
      });
    });
  });

  it('redacts the certificate block for an anonymous caller, keeping only whether one is configured', async () => {
    await withApp(async (app) => {
      const { body } = await health(app);
      expect(body.credential.graph).toEqual({
        configured: false,
        redacted: true,
        note: expect.stringContaining('signed-in operator only'),
      });
    });
  });

  it('discloses it to a signed-in one — the control, so the redaction is not a route that answers nothing', async () => {
    await withApp(async (app) => {
      const { setCookie } = await signIn(app);
      const { body } = await health(app, setCookie.split(';')[0] ?? '');
      expect(body.auth.authenticated).toBe(true);
      expect(body.credential.graph).not.toHaveProperty('redacted');
      expect(body.credential.graph.configured).toBe(false);   // no Graph credential in this test, honestly reported
    });
  });

  it('reports an unconfigured host as unconfigured, without pretending anyone is signed in', async () => {
    const app = buildApi({
      store: quietStore(),
      now: () => NOW,
      auth: createSessionAuth({ loadConfig: () => { throw new Error('no credential file'); } }),
    });
    try {
      const { body } = await health(app);
      expect(body.auth.mode).toBe('unconfigured');
      expect(body.auth.authenticated).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe('the credential file’s mode is enforced through the real path', () => {
  it('a world-readable credential authenticates nobody', async () => {
    // Not a unit test of `loadAuthConfig` — that exists. This is the whole
    // chain: a file at 0644 must make the SERVER refuse, not merely make a
    // loader throw somewhere nobody is watching.
    writeConfig({}, 0o644);
    try {
      await withApp(async (app) => {
        const { statusCode } = await signIn(app);
        expect(statusCode).toBe(503);
      });
    } finally {
      writeConfig();
    }
  });
});
