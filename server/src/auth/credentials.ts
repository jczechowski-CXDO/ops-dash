import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * The operator's credential, on disk, outside this repo.
 *
 * **The shape is `http/graphToken.ts`'s, deliberately and line for line.** That
 * pattern is already proven here and already understood by everyone who has
 * read the Graph adapter: a file outside the repo, located by an env var with
 * an XDG-ish fallback, read at runtime, and **no path, hash or secret ever
 * transcribed into source**. `web/src/guards.test.ts` fails the build over the
 * credential shapes; the way to obey it is to have nothing to transcribe.
 *
 * **No new dependency.** `scrypt` is in `node:crypto`. This is the file where
 * somebody reaches for `bcrypt` or `argon2` and the dependency budget is
 * closed — the M1 offline proof rests on it.
 *
 * **It holds a hash, never a password.** The file is expected at mode 600 and
 * this module refuses to read it otherwise, because a world-readable hash on a
 * machine several people can log into is a password everyone has, given time.
 *
 * ## The file's shape
 *
 * ```json
 * { "username": "<name>",
 *   "password_hash": "scrypt$16384$8$1$<salt-b64url>$<hash-b64url>",
 *   "session_key": "<64+ hex characters, from randomBytes>" }
 * ```
 *
 * `hashPassword` below produces the middle line; it is exported so the one
 * command that writes this file is the same code that reads it, rather than an
 * openssl incantation in a README that drifts from the parser.
 *
 * ## Why the session key lives here rather than being generated at boot
 *
 * A per-process random key would mean every restart logs the operator out —
 * and a monitoring tool that is restarted whenever it is upgraded would then
 * teach its one user that being logged out means nothing. A key on disk beside
 * the hash, at the same mode, is the honest trade, and an absent one is
 * `unconfigured` rather than a silent fallback. A fallback here is the failure
 * this repo keeps naming: a security control that quietly answers a weaker
 * question than the one it was asked.
 */

export type AuthConfig = {
  username: string;
  /** `scrypt$N$r$p$salt$hash`, all base64url. Never a password. */
  password_hash: string;
  /** Hex. The HMAC key the session cookie is signed with. */
  session_key: string;
};

/** Where the credential lives. An env var first, so nothing is baked in. */
export function authConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['OPS_DASH_AUTH_CONFIG'] ?? join(homedir(), '.config', 'ops-dash', 'auth.json');
}

/** scrypt's cost parameters, pinned so a stored hash names the ones it was
 *  made with and an upgrade cannot silently verify old hashes at new cost. */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

/**
 * Hash a password for storage. `salt` is a parameter only so a test can pin a
 * literal — every real call takes the random default.
 */
export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

/**
 * Check a password against a stored hash, in constant time.
 *
 * **This is the narrow form** — it answers "is this the password", which is a
 * strictly smaller question than "may this request do this thing", and
 * `server/src/auth/guards.test.ts` stops anything but `session.ts` from
 * importing it. The `publishedLevel`/`vendorLevel` fork, with a worse failure
 * mode: a route that checked a password itself would be a route with its own
 * private idea of who is calling.
 *
 * Returns `false` for every malformed stored hash rather than throwing. A
 * corrupt credential file must read as "this password is wrong", not as an
 * exception that a handler somewhere turns into a 500 with a stack trace — and
 * certainly not as a comparison that was skipped.
 */
export function verifyPassword(stored: string, password: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = parts[5];
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || !salt || !expected) return false;
  let want: Buffer;
  try {
    want = Buffer.from(expected, 'base64url');
    if (want.length === 0) return false;
    const got = scryptSync(password, Buffer.from(salt, 'base64url'), want.length, { N: n, r, p });
    // Equal lengths by construction — `got` is derived at `want`'s length — so
    // timingSafeEqual cannot throw, and the comparison leaks nothing.
    return timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/**
 * Read and validate the credential file.
 *
 * Throws, for `graphToken.ts`'s reason: a malformed credential config is a
 * boot-time mistake of ours, not a runtime failure of anyone else's, and an
 * auth check that silently ran without a credential would be an open door
 * wearing a closed one's clothes. Every caller in this module tree catches it
 * and answers `auth_unconfigured` — **fails closed, and says which**.
 *
 * `mode` is checked here rather than documented, because "chmod 600 it" in a
 * comment is exactly the class of instruction this project has watched fail
 * three times in one night.
 */
export function loadAuthConfig(
  path = authConfigPath(),
  read: (p: string) => { text: string; mode: number } = readWithMode,
): AuthConfig {
  const { text, mode } = read(path);
  // The low nine bits: group and other must both be empty.
  if ((mode & 0o077) !== 0) {
    throw new Error(`the credential file is readable by group or other (mode ${(mode & 0o777).toString(8)}); it must be 600`);
  }
  const raw: unknown = JSON.parse(text);
  // `Array.isArray` as well as the null check: `typeof [] === 'object'`, and an
  // array would otherwise fall through to the field checks and be reported as a
  // missing username, which sends the reader looking at the wrong line.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('the credential file is not an object');
  const { username, password_hash, session_key } = raw as Record<string, unknown>;
  if (typeof username !== 'string' || username.length === 0) throw new Error('username must be a non-empty string');
  if (typeof password_hash !== 'string' || !password_hash.startsWith('scrypt$')) {
    throw new Error('password_hash must be a scrypt hash — a plaintext password here is not supported');
  }
  if (typeof session_key !== 'string' || !/^[0-9a-f]{64,}$/i.test(session_key)) {
    throw new Error('session_key must be at least 64 hex characters');
  }
  return { username, password_hash, session_key };
}

/** Split out so `loadAuthConfig` can be tested without a real file, and so the
 *  mode and the bytes come from one pair of syscalls against one path rather
 *  than from two reads that could disagree. */
function readWithMode(path: string): { text: string; mode: number } {
  return { text: readFileSync(path, 'utf8'), mode: statSync(path).mode };
}
