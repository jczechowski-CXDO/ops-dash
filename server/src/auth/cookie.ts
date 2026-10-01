import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The session cookie's codec: sign, verify, parse, serialise. Nothing else.
 *
 * **One codec, decided once.** M3's severity field was encoded twice by two
 * mechanisms and the two disagreed; this module exists so that cannot happen to
 * "who is calling". `server/src/auth/guards.test.ts` restricts `signSession`
 * and `verifySession` to `session.ts`, so no route can verify a cookie with its
 * own idea of what a valid one looks like.
 *
 * **A signed claim, not an opaque handle.** There is no session table: the
 * cookie carries the username and its own expiry, HMAC-SHA256 over the exact
 * bytes the client will send back. A server-side store would buy revocation,
 * which one operator on one box does not need and which would then need pruning,
 * a schema and a migration — and `m4-store` owns that directory.
 *
 * The consequence is stated rather than left implied: **a stolen cookie is
 * valid until it expires and cannot be revoked short of rotating
 * `session_key`.** That is on the release list.
 */

export type SessionClaims = {
  username: string;
  /** Epoch milliseconds. Both ends carried, so a verifier never has to infer
   *  one from the other, and a shortened TTL applies to new cookies only —
   *  visibly, rather than by silently re-dating old ones. */
  issuedAt: number;
  expiresAt: number;
};

/** Eight hours: one working day, so the operator logs in once. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'ops_dash_session';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');

/**
 * `<payload>.<signature>`, both base64url.
 *
 * Not a JWT. A JWT's `alg` header is a field the *attacker* fills in, and the
 * `alg: none` family of bugs exists because a verifier read it. There is one
 * algorithm here and it is not written down in the token, so it cannot be
 * argued with.
 */
export function signSession(claims: SessionClaims, key: Buffer): string {
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${mac(payload, key)}`;
}

export type SessionCheck =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Verify a token. Never throws, and the signature is checked **before** the
 * payload is parsed — an unauthenticated caller must not reach `JSON.parse`
 * with bytes of their choosing, and must not be able to tell a malformed
 * payload from a wrong key by which error comes back first.
 */
export function verifySession(token: unknown, key: Buffer, now: number): SessionCheck {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1 || token.indexOf('.', dot + 1) !== -1) {
    return { ok: false, reason: 'malformed' };
  }
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const want = Buffer.from(mac(payload, key), 'utf8');
  const got = Buffer.from(signature, 'utf8');
  // Length first: `timingSafeEqual` throws on a mismatch, and both operands
  // here are fixed-width hex of our own making, so a wrong length is not a
  // signal worth hiding — a wrong *value* is, and that is the comparison below.
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'bad_signature' };

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claims !== 'object' || claims === null) return { ok: false, reason: 'malformed' };
  const { username, issuedAt, expiresAt } = claims as Record<string, unknown>;
  if (typeof username !== 'string' || username.length === 0) return { ok: false, reason: 'malformed' };
  if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number') return { ok: false, reason: 'malformed' };
  // `>=`, not `>`: a cookie is dead AT its expiry, not one millisecond after.
  if (now >= expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true, claims: { username, issuedAt, expiresAt } };
}

const mac = (payload: string, key: Buffer): string =>
  createHmac('sha256', key).update(payload).digest('base64url');

/**
 * The `Cookie` header, as a map.
 *
 * Deliberately dumb: split on `;`, take the first `=`, do not decode. Our own
 * value is base64url and a dot, so there is nothing to decode — and a
 * percent-decode here would be a place where two spellings of one cookie name
 * could both be accepted.
 */
export function parseCookies(header: unknown): Record<string, string> {
  // A null-prototype object, so no cookie name can collide with an inherited
  // member and no lookup can succeed on something the header never carried.
  // `__proto__` is the name that matters: assigning it on a plain object is a
  // write to the prototype rather than to the map.
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.length === 0 || Object.prototype.hasOwnProperty.call(out, name)) continue;
    out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

/**
 * The `Set-Cookie` value.
 *
 * `HttpOnly` so no script can read it — the Email page renders attacker-authored
 * text, and "a local-only app is still a browser".
 * `SameSite=Strict` so no other origin can cause the browser to send it; that
 * is this app's CSRF control, since there is no session table to hang a token
 * off and no second mechanism worth inventing.
 * `Path=/` because the API and the SPA share an origin.
 *
 * **`Secure` is deliberately absent, and is the one line here that is wrong the
 * day this is deployed.** Setting it on plain HTTP would stop the cookie being
 * sent at all, so the app would silently never authenticate. It is on the
 * release list as its own item rather than left as a default nobody chose.
 */
export function serializeSessionCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}
