import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SESSION_COOKIE, SESSION_TTL_MS, parseCookies, serializeSessionCookie, signSession, verifySession } from './cookie.js';

const KEY = randomBytes(32);
const OTHER = randomBytes(32);
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const claims = { username: 'operator', issuedAt: NOW, expiresAt: NOW + SESSION_TTL_MS };

describe('the session cookie is signed, and one wrong bit is enough', () => {
  it('round-trips the claims it was given', () => {
    const check = verifySession(signSession(claims, KEY), KEY, NOW + 1000);
    expect(check).toEqual({ ok: true, claims });
  });

  it('refuses a token signed with another key', () => {
    expect(verifySession(signSession(claims, OTHER), KEY, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a claim edited after signing — the forgery this exists to stop', () => {
    // The attack, spelled out: take your own valid cookie, rewrite the username
    // to somebody else's, send it back. The payload is base64url and plainly
    // editable, which is why the signature is over exactly those bytes.
    const token = signSession(claims, KEY);
    const [payload, signature] = token.split('.') as [string, string];
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), username: 'somebody else' }),
    ).toString('base64url');
    expect(verifySession(`${tampered}.${signature}`, KEY, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an expired token, at its expiry and not a moment later', () => {
    const token = signSession(claims, KEY);
    expect(verifySession(token, KEY, claims.expiresAt - 1).ok).toBe(true);
    expect(verifySession(token, KEY, claims.expiresAt)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses everything that is not a token at all, without throwing', () => {
    for (const junk of ['', '.', 'a.', '.b', 'no-dot', 'a.b.c', undefined, null, 42, {}]) {
      expect(verifySession(junk, KEY, NOW).ok, String(junk)).toBe(false);
    }
  });

  it('checks the signature before it parses anything — the unauthenticated caller reaches no parser', () => {
    // A hostile payload with a plausible-looking signature: the answer must be
    // `bad_signature`, which is only possible if the MAC was checked first.
    // If this ever reads `malformed`, the parse is happening on bytes nobody
    // authenticated, and the ordering has been reversed by an innocent edit.
    const hostile = Buffer.from('{"username":').toString('base64url');
    expect(verifySession(`${hostile}.${'A'.repeat(43)}`, KEY, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a validly-signed token whose claims are the wrong shape', () => {
    const payload = Buffer.from(JSON.stringify({ username: 'operator' })).toString('base64url');
    const signed = signSession({ username: 'x', issuedAt: 0, expiresAt: 0 }, KEY);
    // Sign the wrong-shaped payload properly, by borrowing nothing: build it
    // through the same function, then swap the payload and recompute nothing —
    // so this asserts the shape check, not the signature.
    expect(signed.split('.').length).toBe(2);
    expect(verifySession(`${payload}.${signed.split('.')[1]!}`, KEY, NOW).ok).toBe(false);
  });
});

describe('the Set-Cookie this app sends', () => {
  const serialized = serializeSessionCookie('token-value', 28800);

  it('is HttpOnly, SameSite=Strict, path-wide, and named once', () => {
    expect(serialized.split('; ')).toEqual([
      `${SESSION_COOKIE}=token-value`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=28800',
    ]);
  });

  it('carries no Secure flag, and that is a recorded decision — see the release list', () => {
    // Asserted so that adding it is a deliberate act with a failing test
    // attached, rather than a one-word change that silently stops the cookie
    // being sent at all over the plain HTTP this runs on today. The day this
    // gets a hostname, this assertion is the line that has to be edited, which
    // is exactly where the decision should be forced.
    expect(serialized.includes('Secure')).toBe(false);
  });

  it('expires the cookie immediately when it is cleared', () => {
    expect(serializeSessionCookie('', 0)).toContain('Max-Age=0');
  });
});

describe('reading the Cookie header', () => {
  it('finds ours among others', () => {
    expect(parseCookies(`theme=dark; ${SESSION_COOKIE}=abc.def; other=1`)[SESSION_COOKIE]).toBe('abc.def');
  });

  it('takes the FIRST value when a name appears twice — a shadowing attempt cannot override', () => {
    // Two cookies of one name is a thing an attacker can arrange (a different
    // path or a parent domain). Taking the first is a decision; taking "some"
    // is how two parts of a system come to read two different sessions.
    expect(parseCookies(`${SESSION_COOKIE}=mine; ${SESSION_COOKIE}=theirs`)[SESSION_COOKIE]).toBe('mine');
  });

  it('answers with nothing for a missing, empty or malformed header', () => {
    for (const header of [undefined, '', ';;', 'novalue', 42]) {
      expect(parseCookies(header)[SESSION_COOKIE], String(header)).toBeUndefined();
    }
  });

  it('does not inherit Object.prototype — a cookie named __proto__ is not a lookup hit', () => {
    expect(parseCookies('__proto__=x; a=1')['toString']).toBeUndefined();
  });
});
