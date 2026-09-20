import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { authConfigPath, hashPassword, loadAuthConfig, verifyPassword } from './credentials.js';

/** A stored config, built the way the real one is: by hashing a password with
 *  the exported function, never by pasting a hash into this file. */
const KEY = randomBytes(32).toString('hex');
const file = (over: Record<string, unknown> = {}, mode = 0o600) => {
  const body = JSON.stringify({ username: 'operator', password_hash: hashPassword('correct horse'), session_key: KEY, ...over });
  return () => ({ text: body, mode });
};

describe('where the credential lives', () => {
  it('takes the env var when it is set, and never a path from source', () => {
    expect(authConfigPath({ OPS_DASH_AUTH_CONFIG: '/somewhere/else.json' })).toBe('/somewhere/else.json');
  });

  it('falls back to the same conventional directory the Graph credential uses', () => {
    // Asserted as a shape, not as a literal: the two credentials must agree
    // about where this machine keeps its secrets, and a second convention is
    // how one of them ends up world-readable in a directory nobody audits.
    const path = authConfigPath({});
    expect(path.endsWith(['.config', 'ops-dash', 'auth.json'].join('/'))).toBe(true);
    expect(path.startsWith('/')).toBe(true);
  });
});

describe('the password is stored as a hash and compared in constant time', () => {
  it('accepts the right password', () => {
    expect(verifyPassword(hashPassword('correct horse'), 'correct horse')).toBe(true);
  });

  it('rejects the wrong one, and rejects a near miss', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword(stored, 'correct hors')).toBe(false);
    expect(verifyPassword(stored, 'correct horse ')).toBe(false);
    expect(verifyPassword(stored, '')).toBe(false);
  });

  it('salts, so the same password twice is two different stored values', () => {
    // The property that makes a stolen file a per-password problem rather than
    // a lookup. Two independently-reachable hashes of one password, compared to
    // each other rather than to anything this module computed for the purpose.
    const a = hashPassword('correct horse');
    const b = hashPassword('correct horse');
    expect(a).not.toBe(b);
    expect(verifyPassword(a, 'correct horse') && verifyPassword(b, 'correct horse')).toBe(true);
  });

  it('names its cost parameters in the stored value, so an upgrade cannot verify quietly at the old cost', () => {
    expect(hashPassword('x').split('$').slice(0, 4)).toEqual(['scrypt', '16384', '8', '1']);
  });

  it('refuses every malformed stored value rather than throwing or passing', () => {
    // A corrupt credential file must read as "wrong password", never as an
    // exception a handler turns into a 500 — and never as a comparison skipped.
    for (const junk of ['', 'plaintext', 'scrypt$x$8$1$aa$bb', 'scrypt$16384$8$1$aa', 'bcrypt$16384$8$1$aa$bb', 'scrypt$16384$8$1$aa$']) {
      expect(verifyPassword(junk, 'correct horse'), junk).toBe(false);
    }
  });

  it('a plaintext password in the file is not a credential — the control', () => {
    // The failure this whole module exists to prevent, asserted rather than
    // trusted to the parser: if `verifyPassword` ever compared strings, this
    // would pass and nobody would notice until the file leaked.
    expect(verifyPassword('correct horse', 'correct horse')).toBe(false);
  });
});

describe('reading the credential file', () => {
  it('reads a well-formed one', () => {
    expect(loadAuthConfig('/ignored', file())).toMatchObject({ username: 'operator', session_key: KEY });
  });

  it('refuses a file that group or other can read', () => {
    // The mode is checked rather than documented. A hash at 0644 on a machine
    // several people can log into is a password everyone has, given time.
    expect(() => loadAuthConfig('/ignored', file({}, 0o100644))).toThrow(/mode 644.*600/);
    expect(() => loadAuthConfig('/ignored', file({}, 0o100640))).toThrow(/mode 640/);
    // Owner-only is fine whatever the file type bits above it say.
    expect(loadAuthConfig('/ignored', file({}, 0o100600)).username).toBe('operator');
  });

  it('refuses a plaintext password in place of a hash, by name', () => {
    expect(() => loadAuthConfig('/ignored', file({ password_hash: 'correct horse' }))).toThrow(/plaintext/);
  });

  it('refuses a missing or short session key, so a weak signing key cannot be configured quietly', () => {
    expect(() => loadAuthConfig('/ignored', file({ session_key: undefined }))).toThrow(/session_key/);
    expect(() => loadAuthConfig('/ignored', file({ session_key: 'abc123' }))).toThrow(/session_key/);
    expect(() => loadAuthConfig('/ignored', file({ session_key: 'z'.repeat(64) }))).toThrow(/session_key/);
  });

  it('refuses an empty username and a file that is not an object', () => {
    expect(() => loadAuthConfig('/ignored', file({ username: '' }))).toThrow(/username/);
    expect(() => loadAuthConfig('/ignored', () => ({ text: '[]', mode: 0o600 }))).toThrow(/not an object/);
  });
});
