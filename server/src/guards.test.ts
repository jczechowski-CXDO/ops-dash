import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository guards for `server/`.
 *
 * `web/src/guards.test.ts` already greps this workspace for bare `fetch`, and
 * it grew that reach because the server had nowhere of its own. It does now.
 * Rules about server source belong here; that file keeps the ones about the web
 * and the one about the network, which predates this file and is not worth
 * moving while it is green.
 *
 * Every guard in this file comes with a **control**: a planted offender that it
 * must catch. A guard is a claim that something is absent, and the one way an
 * absence-claim fails is by matching nothing at all — a typo in a path, a
 * directory walk that finds no files, a regex that cannot fire. This repo has
 * shipped that exact failure more than once, so the rule is that no guard is
 * committed until it has been watched to find something.
 */

// fileURLToPath, not URL.pathname — a repo path containing a space comes back
// percent-encoded from the latter. Same defect as G-1 in docs/RESUME.md.
const SERVER = join(fileURLToPath(new URL('.', import.meta.url)), '..');
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

/**
 * Blank comments out **without moving any line**, so a reported line number is
 * the real one. Copied in shape from `web/src/guards.test.ts`, for the reason
 * given there: prose mentioning a thing is not code doing it, and every guard
 * below depends on that distinction — this file's own doc comments name the
 * symbol it forbids.
 */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');

/** Every `.ts` under `server/src`, as { path, code-without-comments }. Read
 *  once; each guard filters it. */
const sources = () => walk(SRC).map((path) => ({ path, code: stripComments(read(path)) }));

/* ------------------------------------------------- the narrow vendor reading */

/**
 * `publishedLevel` answers a narrower question than almost every caller wants,
 * and the two functions that answer the two questions live side by side.
 *
 * `publishedLevel(snapshot)` is "what did the vendor publish, with staleness
 * applied". `vendorLevel(snapshot, platform, ours)` is "what is this service",
 * which is the same answer PLUS amendment 10 — a platform that publishes no
 * health at all may be read as `operational` from our own passing checks.
 *
 * Twice now the fix for a disagreement between two parts of this system has
 * been "put the honest answer in one shared function", and twice a caller has
 * then picked the wrong sibling:
 *
 *   - G2 HIGH 4: the API and the engine disagreed about a stale payload's
 *     level, fixed by creating the shared reading.
 *   - 2026-09-19: `/api/services` served Zendesk `unknown` while the engine, in
 *     the same process against the same store, had it `operational` with 2/2 of
 *     our own probes passing. The route called the narrow one.
 *
 * The third defence has to be mechanical. A paragraph of documentation was the
 * second, and the second did not hold.
 *
 * The rule is about ANY reference in code, not only an import: a re-export, a
 * namespace access or an alias reaches the same function by a route a
 * grep-for-import would miss.
 */
const NARROW_READING = 'publishedLevel';
const PUBLIC_READING = 'vendorLevel';

/** Its own module and its own test. Nothing else, and adding a third entry is
 *  a decision someone has to defend in review rather than a diff nobody reads. */
const MAY_USE_NARROW_READING = ['server/src/store/currentLevel.ts', 'server/src/store/currentLevel.test.ts'];

const usesNarrowReading = (file: { path: string; code: string }) =>
  new RegExp(`\\b${NARROW_READING}\\b`).test(file.code);

/** The home module declares the narrow reading, and declares it once under one
 *  name. A predicate rather than an inline assertion so it can be run against
 *  planted text as well as against the file — the same reason every other rule
 *  here is a function. */
const homeExports = (code: string) => ({
  narrow: code.includes(`export function ${NARROW_READING}(`),
  public: code.includes(`export function ${PUBLIC_READING}(`),
  /** Any surviving mention of the old name: a deprecated alias, a re-export, a
   *  parameter someone left behind. */
  oldName: /\bcurrentLevel\b/.test(stripComments(code)),
});

const HOME = join(SRC, 'store', 'currentLevel.ts');

describe('only its own module may read the vendor’s published level', () => {
  it('the symbols it guards exist, and no deprecated alias survives beside them', () => {
    // The anchor. Without it the rule below is a grep for a string that nothing
    // contains, which passes for the same reason an empty list does — and the
    // rename that produced this name was in flight when this was written.
    //
    // The old name must be gone entirely, not merely unexported: a rename that
    // leaves `export const currentLevel = publishedLevel` behind satisfies
    // every other assertion here and restores the trap in full — two names,
    // both sounding like the answer, one of them wrong.
    expect(homeExports(read(HOME))).toEqual({ narrow: true, public: true, oldName: false });
  });

  it('would see a deprecated alias if one were left behind — the control', () => {
    const planted = `export function ${NARROW_READING}(s: unknown) { return s; }\n` +
      `export function ${PUBLIC_READING}(s: unknown) { return s; }\n` +
      `export const currentLevel = ${NARROW_READING};\n`;
    expect(homeExports(planted).oldName).toBe(true);
    // …and it is not firing on the prose in the module's own doc comments.
    expect(homeExports(`/** was currentLevel until the rename */\n`).oldName).toBe(false);
  });

  it('would see the symbol vanish if the module stopped exporting it — the control', () => {
    expect(homeExports('export function somethingElse() {}').narrow).toBe(false);
    expect(homeExports('export function somethingElse() {}').public).toBe(false);
  });

  it('exactly three files in server/src name it, and they are these three', () => {
    // Stated as the set that MUST be there rather than as "no offenders".
    //
    // The negative form was the first draft and it was weaker than it looked:
    // blanking every file's contents left it green, because a rule that finds
    // nothing reports no offenders. The positive form cannot pass that way —
    // it fails if the legitimate users disappear too, which is what a blind
    // walk, a broken `stripComments` or a mis-joined path all look like.
    const users = sources().filter(usesNarrowReading).map((f) => rel(f.path)).sort();
    expect(users).toEqual(
      [
        ...MAY_USE_NARROW_READING,
        // This file names the symbol in its own rule, as a string literal and
        // not a call — the same self-exclusion `web/src/guards.test.ts` needs.
        'server/src/guards.test.ts',
      ].sort(),
    );
  });

  it('catches a planted offender — the control', () => {
    // The guard run against a file that breaks the rule, without writing one to
    // disk. If this passes and the rule above also passes, the rule is doing
    // work; if this fails, the rule is decoration whatever it reports.
    const planted = {
      path: join(SRC, 'api', 'routes.ts'),
      code: `import { ${NARROW_READING} } from '../store/currentLevel.js';\n` +
        `const level = ${NARROW_READING}(result);\n`,
    };
    expect(usesNarrowReading(planted)).toBe(true);
    expect(MAY_USE_NARROW_READING).not.toContain(rel(planted.path));
  });

  it('does not fire on prose that merely names it', () => {
    // The other half of a usable guard: a comment explaining why you must not
    // call the function must not itself be an offence, or the rule teaches
    // people to stop explaining it.
    const prose = {
      path: join(SRC, 'api', 'routes.ts'),
      code: stripComments(`/** Not ${NARROW_READING}: that one answers a narrower question. */\n` +
        `const level = ${PUBLIC_READING}(result, platform, ours);\n`),
    };
    expect(usesNarrowReading(prose)).toBe(false);
  });

  it('is looking at a real, non-empty tree', () => {
    // The walk finding nothing would make every guard in this file green. Two
    // independently known files, named as literals.
    const files = sources().map((f) => rel(f.path));
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('server/src/api/routes.ts');
    expect(files).toContain('server/src/store/currentLevel.ts');
  });
});
