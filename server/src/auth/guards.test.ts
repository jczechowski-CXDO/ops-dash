import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The seam, enforced mechanically.
 *
 * `auth/session.ts` publishes the one answer to "who is calling, and may they".
 * Everything under it — a password comparison, a cookie signature, the
 * credential file — is a NARROWER question, and a caller that asks a narrower
 * question has quietly acquired its own idea of what "authenticated" means.
 * That fork is `publishedLevel` / `vendorLevel`, which this repo has now had
 * four times; the difference is that here the wrong branch writes to the store
 * for someone who is not who they say they are.
 *
 * Three rules, and the shape of each is taken from `server/src/guards.test.ts`
 * because it is the shape that survived review:
 *
 *  1. the narrow forms are named only by files that are allowed to
 *  2. each module's export surface is pinned as a SET, so nothing escapes under
 *     a new name — the hole that made the first version of the `publishedLevel`
 *     guard decoration
 *  3. `api/routes.ts` imports exactly the published surface and nothing else
 *
 * Every rule below comes with a control: a planted offender it must catch, and
 * a piece of prose it must not fire on. An absence-claim that matches nothing
 * is green for the same reason a correct one is.
 */

const SERVER = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const REPO = join(SERVER, '..');
const SRC = join(SERVER, 'src');

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (extname(entry) === '.ts') acc.push(p);
  }
  return acc;
}

const rel = (p: string) => p.slice(REPO.length + 1).replace(/\\/g, '/');
const read = (p: string) => readFileSync(p, 'utf8');

/** Blanks comments without moving a line, so prose naming a forbidden symbol is
 *  not an offence — every doc comment in this directory names them. */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');

const sources = () => walk(SRC).map((path) => ({ path, code: stripComments(read(path)) }));

const exportedNames = (code: string): string[] =>
  [...stripComments(code).matchAll(/^export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z0-9_$]+)/gm)]
    .map((m) => m[1]!)
    .sort();

/* ------------------------------------------------------- the narrow forms */

/**
 * The questions that are smaller than "may this request do this thing".
 *
 * `verifyPassword` — is this the password. `verifySession`/`signSession` — is
 * this cookie ours. `loadAuthConfig`/`hashPassword` — the credential itself.
 * Each is a legitimate function and none of them is the answer a route needs.
 */
const NARROW = ['verifyPassword', 'hashPassword', 'loadAuthConfig', 'signSession', 'verifySession'] as const;

/** Who may name them. `session.ts` is the publisher; the rest are the tests of
 *  the modules that define them, and this guard, which names them as strings.
 *  A sixth entry is a decision someone defends in review. */
const MAY_NAME_NARROW = [
  'server/src/auth/credentials.ts',
  'server/src/auth/credentials.test.ts',
  'server/src/auth/cookie.ts',
  'server/src/auth/cookie.test.ts',
  'server/src/auth/session.ts',
  'server/src/auth/session.test.ts',
  'server/src/auth/guards.test.ts',
];

const namesNarrow = (code: string) => NARROW.some((n) => new RegExp(`\\b${n}\\b`).test(code));

describe('only the auth module may ask the narrow questions', () => {
  it('exactly these files name a narrow form, and they are these', () => {
    // The positive set. "No offender found" is also what a broken walk, a
    // mis-joined path and a dead regex all report.
    const users = sources().filter((f) => namesNarrow(f.code)).map((f) => rel(f.path)).sort();
    expect(users).toEqual([...MAY_NAME_NARROW].sort());
  });

  it('catches a planted offender — a route verifying a password itself', () => {
    const planted = `import { verifyPassword } from '../auth/credentials.js';\nif (verifyPassword(h, p)) reply.send({ ok: true });\n`;
    expect(namesNarrow(planted)).toBe(true);
    expect(MAY_NAME_NARROW).not.toContain('server/src/api/routes.ts');
  });

  it('catches a route verifying a cookie itself — the other half of the same fork', () => {
    expect(namesNarrow(`const who = verifySession(request.headers.cookie, key, Date.now());\n`)).toBe(true);
  });

  it('does not fire on prose that merely names one', () => {
    // A comment explaining why you must not call `verifyPassword` must not be
    // an offence, or the rule teaches people to stop explaining it.
    expect(namesNarrow(stripComments('/** Not verifyPassword: that answers a narrower question. */\nconst d = auth.decide(r);\n'))).toBe(false);
  });

  it('is looking at a real, non-empty tree', () => {
    const files = sources().map((f) => rel(f.path));
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('server/src/api/routes.ts');
    expect(files).toContain('server/src/auth/session.ts');
  });
});

/* ------------------------------------------------- the export surfaces */

describe('each auth module exports exactly what it is meant to', () => {
  /**
   * Pinned as SETS, for the reason `server/src/guards.test.ts` gives about
   * `publishedLevel`: a rule that forbids a name is satisfied by a rename.
   * `export const check = verifyPassword` would pass every other assertion in
   * this file, and then any route could `import { check }` and never name a
   * guarded symbol at all.
   */
  it('credentials.ts', () => {
    expect(exportedNames(read(join(SRC, 'auth', 'credentials.ts')))).toEqual([
      'AuthConfig',
      'authConfigPath',
      'hashPassword',
      'loadAuthConfig',
      'verifyPassword',
    ]);
  });

  it('cookie.ts', () => {
    expect(exportedNames(read(join(SRC, 'auth', 'cookie.ts')))).toEqual([
      'SESSION_COOKIE',
      'SESSION_TTL_MS',
      'SessionCheck',
      'SessionClaims',
      'parseCookies',
      'serializeSessionCookie',
      'signSession',
      'verifySession',
    ]);
  });

  it('session.ts — the published surface, which is the thing everything else is allowed to know', () => {
    expect(exportedNames(read(join(SRC, 'auth', 'session.ts')))).toEqual([
      'AUTH_POLICIES',
      'AuthDecision',
      'AuthPolicy',
      'LoginErrorCode',
      'LoginOutcome',
      'Principal',
      'SessionAuth',
      'SessionAuthOptions',
      'actorOf',
      'createSessionAuth',
      'isAuthPolicy',
      'principalOf',
      'registerAuth',
    ]);
  });

  it('would see an alias escaping under another name — the control', () => {
    const planted = 'export const check = verifyPassword;\nexport function authConfigPath() {}\n';
    expect(exportedNames(planted)).toContain('check');
  });

  it('would see a module that stopped exporting everything — the other control', () => {
    expect(exportedNames('const hidden = 1;\n')).toEqual([]);
  });
});

/* ------------------------------------------------------- what routes.ts may know */

describe('the API knows only the published surface', () => {
  const ROUTES = join(SRC, 'api', 'routes.ts');

  /** The names `api/routes.ts` imports from anywhere under `auth/`. */
  const imported = (code: string): string[] =>
    [...stripComments(code).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[^']*auth\/[^']*'/g)]
      .flatMap((m) => m[1]!.split(','))
      .map((n) => n.trim().replace(/^type\s+/, ''))
      .filter((n) => n.length > 0)
      .sort();

  it('imports exactly these five names from the seam', () => {
    // Four: build one, install it, read the result, and the type. Everything
    // else about identity is `session.ts`'s to know.
    // `actorOf` joined them with the mutating routes: it is how a handler
    // learns who is writing, and it throws rather than returning a fallback.
    expect(imported(read(ROUTES))).toEqual(['SessionAuth', 'actorOf', 'createSessionAuth', 'principalOf', 'registerAuth']);
  });

  it('would see a fifth import appear — the control', () => {
    const planted = `import { createSessionAuth, verifySession } from '../auth/session.js';\n`;
    expect(imported(planted)).toEqual(['createSessionAuth', 'verifySession']);
  });

  it('only buildApi registers the plugin, so nothing can compose it without the hook', () => {
    // The hook sits on the ROOT instance now (M-2), added by `buildApi` before
    // the plugin so the plugin's routes inherit it. That is strictly better —
    // it covers `static.ts`'s wildcard too — and it costs one property:
    // `apiRoutes` registered directly on somebody else's Fastify would have no
    // enforcement at all.
    //
    // So the registration is confined the way `publishedLevel`'s importers are:
    // a positive set. `routes.ts` registers it inside `buildApi`; the tests name
    // it to assert it exists. A fourth file naming it is a decision somebody
    // defends in review rather than a diff nobody reads.
    const users = sources()
      .filter((f) => /\bapiRoutes\b/.test(f.code))
      .map((f) => rel(f.path))
      .sort();
    //
    // **This file is not in the list, and the reason is a trap worth naming.**
    // It contains the string twice — once in the comment above, which
    // `stripComments` blanks, and once in the pattern on the line above, where
    // the literal reads `\bapiRoutes\b` and the character before `apiRoutes`
    // is therefore the letter `b`. `\b` asserts a word boundary, and there is
    // none between `b` and `a`, so **the guard cannot see its own spelling of
    // itself**. That exclusion is incidental rather than designed, which is the
    // kind of accident this repo distrusts: write `apiRoutes` in code here
    // without a backslash in front of it and this test starts failing on
    // itself. Measured with a standalone probe rather than reasoned, after the
    // expected list disagreed with the tree.
    expect(users).toEqual(['server/src/api/routes.test.ts', 'server/src/api/routes.ts']);
  });

  it('declares a policy at every route it registers', () => {
    // A source-level companion to `routeTable.test.ts`, which reads the router.
    // Two independently-reachable definitions of the same claim: this one
    // counts registrations in the file, that one counts routes in Fastify, and
    // a route registered somewhere else would break the second while a route
    // registered here without a policy breaks the first.
    const code = stripComments(read(ROUTES));
    const registrations = [...code.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,\s*(\{[^}]*\}[^,]*)?/g)];
    expect(registrations.length).toBe(7);   // the routes registered by a literal `app.<method>(` call
    for (const [, method, url, options] of registrations) {
      expect(options ?? '', `${method} ${url}`).toMatch(/config:\s*\{\s*auth:\s*'(public-read|login|required)'/);
    }
  });
});
