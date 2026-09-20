import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadAuthConfig, verifyPassword, type AuthConfig } from './credentials.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  parseCookies,
  serializeSessionCookie,
  signSession,
  verifySession,
} from './cookie.js';

/**
 * **The one module that answers "who is calling, and may they".**
 *
 * Everything else in the server imports from here and is forbidden an opinion.
 * Not a style preference — this project has produced the same defect four times
 * (`publishedLevel` vs `vendorLevel` is the closest twin), and the failure mode
 * here is worse than a tile of the wrong colour: it is a route that writes for
 * someone who is not who they say they are.
 *
 * Three mechanisms hold it, because a comment did not hold the last three:
 *
 *  1. **A closed policy vocabulary.** `AuthPolicy` has exactly three values and
 *     a route can only *declare* one. A route cannot check a cookie, read a
 *     header, or decide anything.
 *  2. **Fail closed on silence.** A route registered with no declared policy is
 *     refused with 500 before its handler runs. "Somebody added a route and did
 *     not think about auth" therefore breaks loudly instead of shipping open,
 *     which is the single most likely way this seam fails in six months.
 *  3. **A guard.** `server/src/auth/guards.test.ts` pins the export surface of
 *     all three modules as a SET, restricts the narrow forms (`verifyPassword`,
 *     `signSession`, `verifySession`, `loadAuthConfig`) to this module, and
 *     enumerates the real route table as a positive set of literals.
 *
 * ## What is NOT authenticated, and why that is a decision
 *
 * The read routes are `'public-read'`, which is what they are today, written
 * down. ops-dash binds `0.0.0.0` with no auth at John's instruction on a
 * trusted LAN; M4 closes the half that matters — the writes — and leaves the
 * reads exactly as they were, but no longer by omission. Every read route names
 * its policy at its registration, and changing one is a one-word diff in a file
 * a reviewer is already reading.
 */

/* --------------------------------------------------------------- the policy */

/**
 * The three things a route may say about itself. Pinned as a set so a fourth
 * cannot be invented at a call site — an unrecognised value is not a policy,
 * it is a route with no policy, and is refused.
 */
export const AUTH_POLICIES = ['public-read', 'login', 'required'] as const;
export type AuthPolicy = (typeof AUTH_POLICIES)[number];

export const isAuthPolicy = (value: unknown): value is AuthPolicy =>
  typeof value === 'string' && (AUTH_POLICIES as readonly string[]).includes(value);

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Every route in `api/routes.ts` declares this. Optional only because
     *  Fastify's own type says so; a route that omits it is refused at runtime
     *  and fails the route-table guard at build. */
    auth?: AuthPolicy;
  }
}

/** Who a request is from. One field today; a shape rather than a bare string so
 *  a second fact about the caller has somewhere to go that is not a parallel
 *  lookup beside it. */
export type Principal = { username: string };

/* ----------------------------------------------------- the published answer */

export type AuthDecision =
  | { authenticated: true; principal: Principal }
  | {
      authenticated: false;
      status: 401 | 503;
      error: { code: 'unauthenticated' | 'session_invalid' | 'session_expired' | 'auth_unconfigured'; message: string };
    };

/**
 * The codes a caller can act on.
 *
 * **Pinned as a union rather than left as `string`, because the browser renders
 * a different panel per code.** `m4-views` branches on these: `unauthenticated`
 * is a sign-in prompt, `auth_unconfigured` is "this host has no credential",
 * `too_many_attempts` is a wait — and `session_expired` is none of the three.
 * A generic `string` here would let a well-meaning edit collapse two of them
 * into one code, and the symptom would be a screen that paints a deliberate
 * absence as an outage: G3 HIGH-2, which this project has now hit three times
 * in two days.
 *
 * The typechecker is the enforcement. `AuthDecision` below pins its four the
 * same way, for the same reason.
 *
 * One constraint from the other side of the seam, recorded because nothing in
 * this workspace can check it: `web/src/live/client.ts` owns the transport
 * vocabulary `aborted`, `unreachable`, `http_status`, `empty_body` and
 * `non_json_2xx`, and a served code colliding with `aborted` would make a real
 * failure vanish into a blank panel. None of ours collide; a new one must not.
 */
export type LoginErrorCode = 'bad_request' | 'bad_credentials' | 'too_many_attempts' | 'auth_unconfigured';

export type LoginOutcome =
  | { ok: true; principal: Principal; setCookie: string }
  | { ok: false; status: 400 | 401 | 429 | 503; error: { code: LoginErrorCode; message: string } };

export type SessionAuth = {
  /** The decision, for one request. The hook calls this; so may a test. */
  decide(request: FastifyRequest, now?: Date): AuthDecision;
  /** Exchange a username and password for a session cookie. */
  login(body: unknown, now?: Date): LoginOutcome;
  /** The `Set-Cookie` that ends a session. */
  logoutCookie(): string;
  /** Whether a usable credential file is present — for `/api/health`, which
   *  must be able to say "this process has no credential configured" without
   *  that being mistaken for "the password was wrong". */
  configured(): boolean;
};

export type SessionAuthOptions = {
  /** Injected by tests. The default reads the file located by
   *  `OPS_DASH_AUTH_CONFIG`, **per request**, so placing or rotating the
   *  credential does not need a restart — `main.ts` reads the Graph
   *  certificate the same way and for the same reason. */
  loadConfig?: () => AuthConfig;
};

/**
 * The login throttle.
 *
 * **Not deferred to the release list, because the premise that would justify
 * deferring it is already false.** John binds this to `0.0.0.0`, so the login
 * route is reachable by anything on the LAN, and scrypt's ~50ms is a throttle
 * measured in attempts per second — thousands an hour against a password a
 * human chose. A cost function is not a rate limit.
 *
 * In memory, no store, no table, no dependency. It dies with the process, which
 * is a real limitation and is on the release list rather than hidden here.
 *
 * **Two buckets, never one per name.** Keying by the submitted username would
 * let anyone on the LAN mint unbounded map entries by guessing names — a memory
 * leak reachable by an unauthenticated caller, which is a worse bug than the one
 * being fixed. There is exactly one account, so there are exactly two
 * populations: attempts against the real username, and everything else. The
 * separation matters in the other direction too: guessing wrong *usernames*
 * must not lock the operator out of their own dashboard.
 */
const OTHER = '\u0000other';

/** Two free attempts — fat fingers — then a doubling wait, capped at 30s. A cap
 *  rather than unbounded growth: a lockout an operator cannot wait out is a
 *  denial of service anybody on the LAN can perform on them. */
function delayAfter(failures: number): number {
  if (failures <= 2) return 0;
  return Math.min(30_000, 1000 * 2 ** (failures - 3));
}

type Bucket = { failures: number; nextAllowedAt: number };

function createThrottle() {
  const buckets = new Map<string, Bucket>();
  const keyFor = (submitted: string, configured: string) => (submitted === configured ? configured : OTHER);
  return {
    /** Milliseconds still to wait, or 0. */
    waitFor(submitted: string, configured: string, now: number): number {
      const bucket = buckets.get(keyFor(submitted, configured));
      return bucket ? Math.max(0, bucket.nextAllowedAt - now) : 0;
    },
    failed(submitted: string, configured: string, now: number): void {
      const key = keyFor(submitted, configured);
      const failures = (buckets.get(key)?.failures ?? 0) + 1;
      buckets.set(key, { failures, nextAllowedAt: now + delayAfter(failures) });
    },
    /** A success clears the bucket it succeeded in. Only the real username can
     *  ever succeed, so this cannot clear the other one. */
    succeeded(submitted: string, configured: string): void {
      buckets.delete(keyFor(submitted, configured));
    },
  };
}

export function createSessionAuth(opts: SessionAuthOptions = {}): SessionAuth {
  const load = opts.loadConfig ?? (() => loadAuthConfig());
  // Per instance. `buildApi` makes one instance per process, and a test makes
  // one per app — so a test cannot be slowed down by another test's failures.
  const throttle = createThrottle();

  /** `undefined` rather than a throw: unconfigured is a state this process
   *  reports, not an exception a handler has to decide what to do with. */
  const config = (): AuthConfig | undefined => {
    try {
      return load();
    } catch {
      // Deliberately swallows the reason. It names a path, and the one thing
      // this file must never do is tell an unauthenticated caller where the
      // credential lives or what is wrong with it.
      return undefined;
    }
  };

  const unconfigured = {
    authenticated: false as const,
    status: 503 as const,
    error: {
      code: 'auth_unconfigured' as const,
      message: 'this server has no operator credential configured, so it cannot authenticate anyone',
    },
  };

  return {
    configured: () => config() !== undefined,

    decide(request, now = new Date()) {
      const cfg = config();
      // Fails CLOSED. A missing credential file must never mean "let them in";
      // it is the state a fresh box is in, and a fresh box is the one most
      // likely to be reachable before anyone has thought about it.
      if (!cfg) return unconfigured;

      const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
      if (token === undefined) {
        return {
          authenticated: false,
          status: 401,
          error: { code: 'unauthenticated', message: 'this route needs a session; sign in first' },
        };
      }
      const check = verifySession(token, Buffer.from(cfg.session_key, 'hex'), now.getTime());
      if (!check.ok) {
        return check.reason === 'expired'
          ? { authenticated: false, status: 401, error: { code: 'session_expired', message: 'the session has expired; sign in again' } }
          : { authenticated: false, status: 401, error: { code: 'session_invalid', message: 'the session cookie is not valid' } };
      }
      // The username in the cookie must still be the configured one. Without
      // this, a cookie signed before the operator was renamed would keep
      // authenticating a user this box no longer has.
      if (check.claims.username !== cfg.username) {
        return { authenticated: false, status: 401, error: { code: 'session_invalid', message: 'the session cookie is not valid' } };
      }
      return { authenticated: true, principal: { username: check.claims.username } };
    },

    login(body, now = new Date()) {
      const cfg = config();
      if (!cfg) return { ok: false, status: 503, error: unconfigured.error };
      if (typeof body !== 'object' || body === null) {
        return { ok: false, status: 400, error: { code: 'bad_request', message: 'expected a JSON object with username and password' } };
      }
      const { username, password } = body as Record<string, unknown>;
      if (typeof username !== 'string' || typeof password !== 'string') {
        return { ok: false, status: 400, error: { code: 'bad_request', message: 'expected a JSON object with username and password' } };
      }
      // Both halves are checked and ONE message comes back. Telling a caller
      // that the username was right narrows their search to the password, and
      // there is exactly one account here to narrow it for.
      //
      // The password is verified even when the username is wrong, so the reply
      // takes the same time either way — scrypt is the expensive half, and
      // skipping it on a bad username is a free username oracle.
      // The wait is checked BEFORE the hash is computed. Checking it after
      // would still refuse the attempt and would still burn 50ms of CPU per
      // request — a rate limit that costs the defender more than the attacker
      // is a denial-of-service amplifier wearing a control's clothes.
      const wait = throttle.waitFor(username, cfg.username, now.getTime());
      if (wait > 0) {
        return {
          ok: false,
          status: 429,
          error: {
            code: 'too_many_attempts',
            message: `too many failed sign-in attempts; try again in ${Math.ceil(wait / 1000)} seconds`,
          },
        };
      }

      const right = verifyPassword(cfg.password_hash, password);
      if (!right || username !== cfg.username) {
        throttle.failed(username, cfg.username, now.getTime());
        return { ok: false, status: 401, error: { code: 'bad_credentials', message: 'that username and password do not match' } };
      }
      throttle.succeeded(username, cfg.username);
      const issuedAt = now.getTime();
      const token = signSession(
        { username: cfg.username, issuedAt, expiresAt: issuedAt + SESSION_TTL_MS },
        Buffer.from(cfg.session_key, 'hex'),
      );
      return {
        ok: true,
        principal: { username: cfg.username },
        setCookie: serializeSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)),
      };
    },

    logoutCookie: () => serializeSessionCookie('', 0),
  };
}

/* ------------------------------------------------------------- enforcement */

/**
 * Who the request turned out to be.
 *
 * A `WeakMap` rather than a property on the request, so nothing can *write* a
 * principal: the only thing holding the map is this module, and the only thing
 * that fills it is the hook below. A decorated `request.user` would be settable
 * by any plugin, and "a route that writes for someone who is not who they say
 * they are" is precisely the failure this seam exists to prevent.
 */
const principals = new WeakMap<FastifyRequest, Principal>();

/** The caller, or `undefined` on a route where there need not be one. */
export const principalOf = (request: FastifyRequest): Principal | undefined => principals.get(request);

/**
 * The actor to record against a write. **This is what a mutating handler calls**,
 * and it throws rather than returning a fallback, on purpose.
 *
 * A `?? 'John H.'` in a handler is how the literal actor string that M4 is
 * supposed to be replacing comes back — quietly, on the one path where the
 * session was missing. There is no correct default here: reaching this function
 * on a route that is not `'required'` is a wiring mistake of ours, not a runtime
 * condition, and the route-table guard makes it a build failure rather than
 * something this throw ever has to catch in production.
 */
export function actorOf(request: FastifyRequest): string {
  const principal = principals.get(request);
  if (!principal) {
    throw new Error('actorOf was called on a request that was never authenticated — the route is missing policy "required"');
  }
  return principal.username;
}

/**
 * Does this request's `Origin` name the host it was sent to?
 *
 * **Parsed, never pattern-matched** — `server/src/http/safeTarget.ts` makes the
 * same argument for outbound URLs and it is the same trap in the other
 * direction: `origin.startsWith('http://ops-dash')` is satisfied by
 * `http://ops-dash.attacker.example`, and `.endsWith(host)` by
 * `http://evilops-dash:4000`.
 *
 * An absent `Origin` passes. Browsers omit it on same-origin GETs and send it
 * on every cross-origin write, and a non-browser client never sends one at all
 * — refusing those would break `curl` and every future script while stopping
 * nobody, since the attacker this guards against IS a browser.
 */
function sameOrigin(origin: unknown, host: unknown): boolean {
  if (origin === undefined) return true;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;   // an unparseable Origin is not our own
  }
}

/**
 * Install the check. Call it inside the plugin that registers the routes, so
 * Fastify's encapsulation confines it to them — the SPA's static routes are
 * registered on the root instance and are none of this module's business.
 */
export function registerAuth(app: FastifyInstance, auth: SessionAuth, now?: () => Date): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const policy: unknown = request.routeOptions.config.auth;

    if (!isAuthPolicy(policy)) {
      // The fail-closed branch, and the reason this hook exists at all rather
      // than a `preHandler` on each route that needs one. A route added without
      // a policy is refused before its handler runs — 500 because it is OUR
      // mistake, not the caller's, and a 401 here would send someone hunting
      // for a credential that would not have helped.
      void reply.code(500).send({
        error: {
          code: 'auth_policy_missing',
          message: 'this route does not declare an auth policy, so the server refused to serve it',
        },
      });
      return reply;
    }

    // Cross-origin refusal, on the two policies that can change something: the
    // write routes and the one that hands out a session.
    //
    // `SameSite=Strict` is the control and this is the belt beside it. It is
    // cheap, it is parsed rather than pattern-matched, and it costs nothing for
    // a non-browser client (curl sends no `Origin`) — which is deliberate: this
    // defends against a browser being made to act for its user, which is the
    // only attacker who has the cookie in the first place.
    if (policy !== 'public-read' && !sameOrigin(request.headers.origin, request.headers.host)) {
      void reply.code(403).send({
        error: { code: 'cross_origin', message: 'this request came from another origin and was refused' },
      });
      return reply;
    }

    if (policy !== 'required') return;

    const decision = auth.decide(request, now?.());
    if (!decision.authenticated) {
      void reply.code(decision.status).send({ error: decision.error });
      return reply;
    }
    principals.set(request, decision.principal);
    return;
  });
}
