// @vitest-environment node
// These guards read the repository from disk. Under the jsdom environment
// import.meta.url is an http:// URL and fileURLToPath rejects it, so this file
// pins itself to node. Nothing here touches the DOM.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: the repo path contains a space
// ("C:\git\ops dashboard") and pathname would hand back "%20".
const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO = join(WEB, '..');

function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  // A directory that does not exist yet contributes nothing. src/fixtures does
  // not exist until Wave 1; without this the fixture guards would throw ENOENT
  // instead of passing vacuously, which is what Wave 0 requires of them.
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, exts, acc);
    else if (exts.includes(extname(entry))) acc.push(p);
  }
  return acc;
}

// This file is excluded from every guard below. It necessarily contains the
// literal patterns it searches for ('dangerouslySetInnerHTML', the credential
// shapes, '[data-theme='), so without this exclusion each guard fails on its
// own source. It ships in no bundle and renders nothing.
const SELF = join(WEB, 'src', 'guards.test.ts');
const SERVER = join(REPO, 'server');
/** Every .ts under server/src. Milestone 2 added a workspace whose whole job is
 *  to make network calls, so the guards below split: the web must make none,
 *  the server must make them ONLY through its one helper. */
const serverSrc = () => walk(join(SERVER, 'src'), ['.ts']);

/** Committed NON-code under `server/src` — the adapter fixtures and their notes.
 *
 *  This exists because both guards below walked `.ts` only, and Milestone 4 put
 *  hand-redacted Graph payloads in `__fixtures__/*.json`. Those files were read
 *  by NOTHING: not the redaction guard, not the credential guard. A real UPN, a
 *  tenant GUID or a pasted PEM in a fixture would have been committed and pushed
 *  with every check green.
 *
 *  It was reported by the agent that wrote those fixtures, having redacted them
 *  by hand and then noticed nothing would have caught it if they had not. The
 *  redaction guard's own comment already said "redaction binds everywhere, tests
 *  included, so the guard should look everywhere" — and then looked at one
 *  workspace. That is the fourth accurate comment on this project to fail to
 *  prevent the thing it described, which is the argument for guards over prose. */
const serverData = () => walk(join(SERVER, 'src'), ['.json', '.md']);
const src = () =>
  // Anchored to this exact path, not endsWith: the old form exempted ANY
  // web/src/**/guards.test.ts from every guard, so a new file with that name
  // in any subdirectory would have been silently unguarded.
  walk(join(WEB, 'src'), ['.ts', '.tsx']).filter((f) => f !== SELF);
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(REPO.length + 1).replace(/\\/g, '/');
/** Prose mentioning a thing is not code doing it — several guards depend on this. */
/**
 * Blank out comments **without moving any line**.
 *
 * The old form replaced a block comment with a single space, which collapses a
 * forty-line doc comment into one line — so every offender line number a guard
 * reported after one was wrong, and any rule wanting to relate a source line to
 * a comment near it was impossible to write. Each non-newline character becomes
 * a space instead, so offsets and line numbers are identical to the original.
 */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');

describe('every colour is a token', () => {
  it('no literal hex in web/src', () => {
    const offenders: string[] = [];
    for (const file of src()) {
      if (file.endsWith('icons.generated.ts')) continue;
      read(file).split('\n').forEach((line, i) => {
        // Only CSS hex lengths: 3, 4, 6 or 8 digits. The old {3,8} range matched
        // any run, so the prototype's subject line "Outstanding invoice #88214"
        // — five digits, plainly not a colour — failed the guard and forced a
        // fixture to claim an exemption it should never have needed.
        // The marker is scoped to #fff, which is the only literal the constraint
        // actually allows (solid severity chips, the brand square, nav badges).
        // Previously it whitelisted ANY hex on any line that mentioned it.
        const hex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.exec(line);
        const exempt = /#fff\b[^\n]*prototype literal/.test(line);
        if (hex && !exempt) {
          offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no second dark palette — the dark class is the whole implementation', () => {
    const offenders = src().filter((f) => /prefers-color-scheme|\[data-theme=/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('nothing reaches off-box', () => {
  it('no outbound reference in the served assets', () => {
    // web/index.html is the file that actually ships and the file Task 11A edits,
    // and it sits OUTSIDE public/ — scoping this to public/ alone left the most
    // important file unguarded. Extensions beyond css/html/js are included because
    // an .svg, .json or .webmanifest dropped into public/ is served just the same.
    const assets = [
      ...walk(join(WEB, 'public'), ['.css', '.html', '.js', '.svg', '.json', '.webmanifest']),
      join(WEB, 'index.html'),
    ];
    // Also catches protocol-relative //host/path, which inherits the page scheme
    // and is just as outbound as an explicit https://.
    const outbound = /https?:\/\/|(^|[^:])\/\/[a-z0-9.-]+\.[a-z]{2,}/i;
    // XML namespace identifiers are not references: no browser ever fetches
    // http://www.w3.org/2000/svg, it is a name that happens to be spelled as a
    // URL, and a standalone .svg file is invalid without it. Stripped by exact
    // match rather than by exempting .svg files, so a real https:// inside an
    // SVG — an <image href>, a webfont — still fails.
    const NAMESPACES = /https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml)/g;
    const offenders = assets.filter((f) => outbound.test(read(f).replace(NAMESPACES, '')));
    expect(offenders.map(rel)).toEqual([]);
  });

  /**
   * ## The one-door rule, and why this guard changed in Milestone 3
   *
   * Through Milestones 1 and 2 this guard read "no network client anywhere in
   * web/src", full stop, and that was right: the scaffold was offline and
   * nothing in it had any business opening a socket. Milestone 3 connects the
   * dashboard to our OWN API, so the absolute form could not survive — and it
   * was not weakened to a hole. It became the rule the server has lived under
   * since Milestone 2: **exactly one file may name a network client**, and
   * everything about the call is checked at that one door.
   *
   * The regexes are the server guard's own, so the three ways the old grep was
   * blind — `const f = fetch`, `globalThis.fetch`, `function p(impl = fetch)`
   * — fail everywhere else here too. Two conditions are added that the server
   * does not need, because the web has a CSP to keep faith with: the door may
   * name no absolute URL, and may send no credential.
   *
   * There is no marker-comment exemption, deliberately. The server's guard has
   * one and it had to grow a second test proving a marker elsewhere in a file
   * does not license a bare `fetch` further down. An allowlist of one path,
   * spelled here, cannot be opened by anything written in another file.
   */
  const DOOR = join(WEB, 'src', 'live', 'client.ts');
  /**
   * `fetch` as a bare identifier USED AS A VALUE: the call, the alias, the
   * default parameter, and passing it as an argument.
   *
   * The lookbehind excludes `fetchJson`, `x.fetch` and `fetchImpl`, as the
   * server's copy does. The lookahead is the part the server's copy does not
   * need and this one does: the web tree is full of English prose and probe
   * names — "never renders children as if real when the fetch failed", and a
   * Zendesk probe literally called 'Help centre fetch' — and the server's
   * pattern flags both. A guard that fires on a sentence gets weakened by the
   * next person who hits it, so it is narrowed HERE, deliberately and once, to
   * the punctuation that can follow a value: `(`, `,`, `;`, `)`, `]`, `}` or
   * end of line. The control test below runs both lists through it.
   */
  const BARE_GLOBAL = /(?<![.\w$])fetch\s*(?=[(,;)\]}]|$)/m;
  const VIA_GLOBAL = /\b(?:globalThis|window|self)\s*\.\s*fetch\b/;
  const OTHER_CLIENTS = /XMLHttpRequest|new WebSocket|new EventSource|navigator\.sendBeacon|import\s*\(\s*['"]node:/;

  it('only web/src/live/client.ts may reach a network client', () => {
    /**
     * Stated as the POSITIVE SET, not as "no offenders".
     *
     * `expect(offenders).toEqual([])` is the natural way to write this and it is
     * hollow: a rule that can see nothing reports nothing, and nothing is
     * exactly what a clean run looks like. Blank every file, break `src()`,
     * mis-join a path, or hand `stripComments` something it eats whole, and the
     * empty-offenders form passes while certifying that no file in the SPA
     * reaches the network. It is a security-relevant claim and it would be
     * false.
     *
     * The API agent found this exact hole in their own import guard hours
     * before this one was written, in `server/src/guards.test.ts`. It is in
     * `docs/RESUME.md`: an absence-claim fails by matching nothing, so it has
     * to be anchored to something it must find. Two files here MUST name a
     * network client — the door, and the offline test that asserts on the
     * absence of one — so the assertion names them and cannot survive their
     * disappearance.
     */
    const namers: string[] = [];
    for (const file of src()) {
      const code = stripComments(read(file));
      if (BARE_GLOBAL.test(code) || VIA_GLOBAL.test(code) || OTHER_CLIENTS.test(code)) {
        namers.push(rel(file));
      }
    }
    expect(namers.sort()).toEqual(['web/src/app/offline.test.tsx', 'web/src/live/client.ts']);
  });

  it('that guard is reading the tree — it cannot pass vacuously', () => {
    // The anchor's own anchor. If `src()` ever returns a short list because a
    // directory moved, the assertion above still fails (its two files vanish)
    // — but this one says WHY in one line instead of leaving the next reader to
    // work out whether two named files were deleted or the walk went blind.
    expect(src().length).toBeGreaterThan(50);
    expect(src().some((f) => f === DOOR)).toBe(true);
  });

  it('the one door opens onto our own origin only, and sends credentials no further', () => {
    const code = stripComments(read(DOOR));
    // Same-origin paths, spelled as literals in a union type. An absolute URL
    // or a protocol-relative one in this file would be a target outside the
    // CSP's `connect-src 'self'` and outside anything we control.
    expect(code).not.toMatch(/https?:\/\/|(^|[^:])\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    // POSITIVE, and that is the half that carries the claim. This pinned
    // `'omit'` until Milestone 4, which was right while there was no auth and
    // became an assertion that auth could not work: the server issues an
    // HttpOnly session cookie and `omit` meant the SPA could never hold it.
    //
    // The literal moved; the STRUCTURE did not, deliberately. Replacing this
    // with "never `include`, never `Authorization`" was proposed and is the
    // absence-claim failure this file has now hit five times — a pure negative
    // passes for a missing option, for a typo, and for no `credentials` key at
    // all, any of which silently restores the default. One allowed value,
    // spelled out, with the negatives as companions underneath.
    expect(code).toMatch(/credentials:\s*'same-origin'/);
    expect(code).not.toMatch(/Authorization|credentials:\s*'(include|omit)'/i);
  });

  it('the guard above can fail — the patterns are not inert', () => {
    // The control. Every assertion here is "no offender found", which passes
    // identically against a regex that matches nothing. These are the strings
    // the rule is meant to catch, checked against the same patterns.
    const caught = [
      'await fetch(url)',
      'const f = fetch;',
      'function p(impl = fetch) {}',
      'const go = globalThis.fetch;',
      'new XMLHttpRequest().open("GET", "/x")',
      'navigator.sendBeacon("/x")',
    ];
    for (const line of caught) {
      expect(
        BARE_GLOBAL.test(line) || VIA_GLOBAL.test(line) || OTHER_CLIENTS.test(line),
        `pattern missed: ${line}`,
      ).toBe(true);
    }
    const allowed = [
      'const r = await getJson("/api/services");',
      'client.get(path)',
      'fetchedAt: row.at',
      // Prose and data, which the server's copy of this pattern would flag.
      'it("renders when the fetch failed with nothing cached", () => {',
      "  zendesk: ['API /users/me', 'Help centre fetch', 'Portal HTTP 200'],",
    ];
    for (const line of allowed) {
      expect(
        BARE_GLOBAL.test(line) || VIA_GLOBAL.test(line) || OTHER_CLIENTS.test(line),
        `false positive: ${line}`,
      ).toBe(false);
    }
  });
});

/**
 * **No placeholder exemption, deliberately, and this replaces an earlier
 * version of this file that had one.**
 *
 * I narrowed these rules to exempt values that *look* fabricated — `DEMO-`,
 * `stub-`, `test-` — to unblock two adapter tests. team-lead ruled against it
 * and the ruling is right: the rule is *no credential assigned to a literal*,
 * and **a guard that infers "this looks fake" waves through the one that does
 * not look fake enough**. A false positive costs two minutes. A false negative
 * costs a credential rotation and a rewritten history on a repo that is pushed.
 *
 * The remedy for a test that must pin a literal credential-shaped string is the
 * one this file's own controls use: **assemble it from fragments**. That keeps
 * the assertion literal — so it stays a real assertion rather than one
 * computing its expectation from the value under test — while keeping the
 * forbidden shape out of the tree. It costs one line at each site.
 */

/** A secret's own VALUE, however it got into the file: a PEM block or a
 *  hard-coded Windows secrets path is a secret whether or not anything was
 *  assigned to it. No placeholder exemption — there is no fabricated form of
 *  these. */
const VALUE_SHAPES_PATTERN = /C:\\+secure|cert\.pem|BEGIN (RSA )?PRIVATE KEY/i;

/** Zoho's scheme followed by a token that is neither interpolated nor a
 *  placeholder. One definition, because the guard and its control each held a
 *  copy — and a control computing its answer from a drifted copy proves nothing
 *  about the guard it is named after. That is not hypothetical: the edit that
 *  hoisted these replaced the CONTROL's copy and silently missed the GUARD's,
 *  so for one run the control passed against a pattern the guard did not use. */
const INLINE_BEARER_PATTERN = /Zoho-oauthtoken\s+(?!\$\{)[A-Za-z0-9._-]{8}/;

/**
 * A credential field assigned a literal, **in JS or in JSON**.
 *
 * H-2, found at the gate. The walk was widened to read `.json` under
 * `server/src` precisely because a credential could hide in a committed
 * fixture — and then this pattern was narrowed to require the field name to be
 * followed DIRECTLY by `:` or `=`. A quoted key is not. So JSON, the one syntax
 * the walk was widened to reach, was the one form the pattern could not see:
 * the two halves of that change cancelled, and a real refresh token in a
 * fixture would have been committed and pushed with every check green.
 *
 * The optional quotes around the name, and the optional `]`, are what close it:
 * `{"refresh_token": "…"}`, `"api_key" : "…"` and `{ ["refresh_token"]: "…" }`
 * all fire. Reading a field off a config object still does not — `cfg.api_key`,
 * `{ client_secret }`, `grant_type: 'refresh_token'` — because none of those
 * assigns a literal TO the field.
 */
const ASSIGNED_LITERAL_PATTERN =
  /["'`]?\b(client_secret|refresh_token|api_key)\b["'`]?\s*\]?\s*[:=]\s*['"`](?!\$\{)/i;

describe('no credentials, ever', () => {
  /** Everything a human might paste while wiring an adapter up. */
  const sources = () => [...src(), ...walk(join(REPO, 'shared'), ['.ts']), ...serverSrc(), ...serverData()];

  it('no credential path or secret-shaped key in the repo source', () => {
    // server/src included from Milestone 2. It holds no credential today and
    // must hold none in M3 either — the adapters read from disk at runtime, and
    // the PATHS are what must never be transcribed here.
    // NARROWED 2026-09-20, and the reason matters more than the change.
    //
    // This forbade the *names of fields* when what it means to forbid is a
    // *credential value transcribed into source*. Zoho OAuth — which the
    // Endpoint Central adapter must speak — cannot be written at all without
    // the identifiers `client_secret`, `refresh_token` and `Zoho-oauthtoken`.
    // `graphToken.ts` never tripped it only by luck of spelling: certificate
    // auth happens to use `tenant_id`/`client_id`/`cert_pem`.
    //
    // `m4-entra` hit it, verified it by running this regex rather than
    // predicting it, and **refused to route around it** — which is the whole
    // point. `RESUME.md` records that assembling a literal from fragments is
    // WORSE than weakening a guard, because `raw['client' + '_secret']` passes
    // while leaving the guard looking intact. A guard that forces that is a
    // guard that has stopped guarding and started teaching evasion.
    //
    // So: reading a field off a config object is fine, and only an assignment
    // to a LITERAL is refused. `cfg.client_secret` passes; `client_secret:
    // "abc123"` does not. The bare-value shapes below are unchanged, because a
    // PEM block or a hard-coded Windows secrets path in source is a value
    // however it got there.
    const VALUE_SHAPES = VALUE_SHAPES_PATTERN;
    const ASSIGNED_LITERAL = ASSIGNED_LITERAL_PATTERN;
    /** Zoho's scheme followed by something that is not an interpolation.
     *  `\`Zoho-oauthtoken ${t}\`` is the correct way to write it; the same
     *  string with the token typed in is the thing to refuse.
     *
     *  Deliberately NOT generic `Bearer`. Widening it there caught three
     *  existing `'Bearer stub-token'` assertions in adapter tests, which are
     *  obviously fake and legitimately literal — and `password` and
     *  `access_token`, which I also tried, caught `session.test.ts`'s test
     *  password. Both were scope creep on a change whose whole job is to
     *  unblock three Zoho identifiers. A guard widened past its reason
     *  collects false positives, and false positives are how a guard gets
     *  disabled by someone in a hurry. */
    const INLINE_BEARER = INLINE_BEARER_PATTERN;
    const pattern = new RegExp(
      `${VALUE_SHAPES.source}|${ASSIGNED_LITERAL.source}|${INLINE_BEARER.source}`,
      'i',
    );
    const offenders = sources().filter((f) => pattern.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('the narrowed credential rule still refuses a transcribed secret — the controls', () => {
    // Every branch of the narrowing proved in BOTH directions, because a guard
    // relaxed without controls is a guard nobody can tell from a deleted one.
    // Assembled from fragments so this file does not itself trip the rule.
    const q = String.fromCharCode(34);
    const VALUE_SHAPES = VALUE_SHAPES_PATTERN;
    const ASSIGNED_LITERAL = ASSIGNED_LITERAL_PATTERN;
    const INLINE_BEARER = INLINE_BEARER_PATTERN;
    const fires = (line: string) =>
      VALUE_SHAPES.test(line) || ASSIGNED_LITERAL.test(line) || INLINE_BEARER.test(line);

    // MUST still fire — a real secret, transcribed.
    expect(fires(`client_secret: ${q}1000.abcdef0123456789${q}`)).toBe(true);
    expect(fires(`refresh_token = ${q}1000.zyxw9876${q}`)).toBe(true);
    expect(fires(`api_key: ${q}sk-live-000111222${q}`)).toBe(true);
    // Assembled, not written — the same reason the zero-GUID control above is
    // assembled: this guard forbids these shapes in source and its own control
    // must not be the one exception to it. A self-exclusion would work and is
    // strictly worse, because it exempts the whole file forever.
    expect(fires('authorization: `' + ['Zoho', 'oauthtoken'].join('-') + ' 1000.deadbeefcafe`')).toBe(true);
    expect(fires(['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '))).toBe(true);

    // MUST NOT fire — the adapter that has to exist.
    expect(fires('const { client_id, client_secret, refresh_token } = raw;')).toBe(false);
    expect(fires('grant_type: ' + q + 'refresh_token' + q)).toBe(false);
    expect(fires('authorization: `Zoho-oauthtoken ${token}`')).toBe(false);
    // H-2: the JSON form, which the narrowed pattern could not see at all.
    // These four are the whole reason the walk reads `.json` under `server/src`
    // — a credential hiding in a committed fixture — and every one of them was
    // MISSED while the five unquoted controls above reported the rule safe. A
    // control set that cannot distinguish the old pattern from the new one is
    // not a control set. Assembled from fragments, like the others, so this
    // file does not trip its own rule.
    const key = (name: string) => q + name + q;
    const val = q + '1000.9f8e7d6c5b4a3210' + q;
    expect(fires('{' + key('refresh_token') + ': ' + val + '}')).toBe(true);
    expect(fires('{' + key('client_secret') + ': ' + val + '}')).toBe(true);
    expect(fires('  ' + key('api_key') + ' : ' + val)).toBe(true);
    expect(fires('const t = { [' + key('refresh_token') + ']: ' + val + ' };')).toBe(true);
    // A fabricated value is refused exactly as a real one is. The guard cannot
    // tell them apart and must not try: a rule that waves through what looks
    // fake waves through the real secret that does not look fake enough. A test
    // needing a literal assembles it, as every line in this block does.
    for (const fake of ['DEMO-SECRET', 'stub-token', 'changeme']) {
      expect(fires('client_secret: ' + q + fake + q), fake).toBe(true);
      expect(fires('{' + key('refresh_token') + ': ' + q + fake + q + '}'), fake).toBe(true);
    }
    expect(fires('body.set(' + q + 'refresh_token' + q + ', cfg.refresh_token);')).toBe(false);
    expect(fires('if (!cfg.client_secret) return missing(' + q + 'client_secret' + q + ');')).toBe(false);
    // The interpolation, which is the ONE honest way to write a credential into
    // a request: read it off the config object into a template. It fired until
    // `(?!${)` was added to match `INLINE_BEARER`, so the only way to satisfy
    // the guard was to write around it — and a guard that refuses honest code
    // is a guard somebody in a hurry switches off. Found by `m4-auth`.
    //
    // These two are here because I added that lookahead in 6e2ba41 WITHOUT
    // them, which left a control set that could not tell the old pattern from
    // the new one — the same name-vs-body drift that hid the JSON hole. A
    // pattern change and its controls belong in the same commit; this is the
    // second half arriving late.
    const tick = String.fromCharCode(96);
    for (const field of ['client_secret', 'refresh_token', 'api_key']) {
      expect(fires(field + ': ' + tick + '${cfg.' + field + '}' + tick), field).toBe(false);
    }
  });

  it('no certificate, thumbprint or tenant identifier — the Graph shapes', () => {
    // Written BEFORE the Graph credential exists, which is the only time this
    // guard can be added without the thing it forbids already being in the
    // history. `git log -p` keeps a pasted secret forever, and this repo is
    // pushed.
    //
    // The three shapes an msgraph app registration brings, none of which the
    // adapter needs in source because it reads them from a file outside the
    // repo at runtime:
    //
    //   BEGIN CERTIFICATE          the public cert, harmless but a sign the
    //                              private half is nearby and pasted too
    //   a GUID                     tenant id / client id — not secret, but they
    //                              identify the tenant, and fixtures here are
    //                              permanently redacted for exactly that reason
    //   40 hex characters          a certificate thumbprint
    const shapes: [string, RegExp][] = [
      ['a PEM certificate block', /-----BEGIN CERTIFICATE-----/],
      ['a GUID (tenant or client id)', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
      ['a certificate thumbprint', /\bthumbprint\b\s*[:=]\s*['"`]?[0-9a-f]{40}\b/i],
    ];
    const offenders: string[] = [];
    for (const file of sources()) {
      const text = read(file);
      for (const [what, pattern] of shapes) {
        if (pattern.test(text)) offenders.push(`${rel(file)}: ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('this guard can actually fail — the shapes are real ones', () => {
    // A guard written against a secret that does not exist yet is the easiest
    // kind to get wrong, and the easiest kind never to notice is wrong. These
    // are syntactically real and semantically nothing: an all-zero GUID, the
    // PEM header with no body, forty zeros.
    expect(/-----BEGIN CERTIFICATE-----/.test('-----BEGIN CERTIFICATE-----')).toBe(true);
    // Assembled, not written: this guard forbids a GUID literal in source and
    // the guard's own control must not be the one exception to it.
    const zeroGuid = ['00000000', '0000', '0000', '0000', '000000000000'].join('-');
    expect(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(
      `tenantId: "${zeroGuid}"`,
    )).toBe(true);
    expect(/\bthumbprint\b\s*[:=]\s*['"`]?[0-9a-f]{40}\b/i.test(
      `thumbprint: "${'0'.repeat(40)}"`,
    )).toBe(true);

    // And does not fire on things that legitimately look close: status.io's
    // 24-hex page id, and a sha256 incident digest.
    const guid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    expect(guid.test('591aaa7fe69f388425000fda')).toBe(false);
    expect(guid.test('INC-a3f9c2d1')).toBe(false);
  });
});

describe('fixtures stay redacted', () => {
  // Deliberately scans ALL of web/src, not just src/fixtures. Scoping this to one
  // directory meant a redaction failure one level up — web/src/fixtures.ts rather
  // than web/src/fixtures/*.ts — passed every guard, and made "directory absent"
  // indistinguishable from "nothing found". Redaction binds everywhere, tests
  // included, so the guard should look everywhere.
  //
  //  WIDENED 2026-09-20 to every workspace AND to committed non-code. `src()` is
  //  web/src; the Graph fixtures are `server/src/adapters/*/__fixtures__/*.json`,
  //  which nothing read. See `serverData` above for how that was found.
  const redactable = () => [...src(), ...walk(join(REPO, 'shared'), ['.ts']), ...serverSrc(), ...serverData()];
  const fixtures = () => redactable().map(read).join('\n');

  it('actually reads the fixture files it claims to guard', () => {
    // NON-VACUITY, and it is the positive set rather than an absence claim —
    // the distinction this project keeps relearning. Every assertion below is
    // "no match found", which a walk over an empty list satisfies perfectly.
    // Rename a directory, change an extension, break `walk`, and the guard goes
    // green while reading nothing at all.
    //
    // So: name the files that must be in scope. A fixture directory that is
    // renamed fails HERE, loudly, instead of silently leaving its contents
    // unguarded.
    const scanned = redactable().map(rel);
    for (const required of [
      'server/src/adapters/entra/__fixtures__/applications.json',
      'server/src/adapters/entra/__fixtures__/directory-audits.json',
      'server/src/adapters/vendorstatus/__fixtures__/msgraph-health-overviews.json',
      // The Email fixtures, pinned at `m4-email`'s request. This is the
      // likeliest place in the repo for a real subject line or a real address
      // to be committed: that page's whole job is to display attacker-authored
      // content and the upstream data is genuine mail. They are in scope and
      // being read today — but without being named here, a silent rename would
      // drop them from the walk and every redaction assertion would go on
      // passing over a directory nobody was reading.
      'server/src/adapters/email/__fixtures__/search-blocked.json',
      'server/src/adapters/email/__fixtures__/statistics-by-type.json',
      'server/src/adapters/email/__fixtures__/README.md',
    ]) {
      expect(scanned).toContain(required);
    }
    // And the JSON really is being read, not merely listed.
    expect(fixtures()).toContain('@example.com');
  });

  it('carries no real corporate identifier', () => {
    // CXDO-GraphExport and Stellar-Connector are app-registration names, not
    // user or host identifiers, and are deliberately real. Hosts and UPNs are not.
    expect(fixtures()).not.toMatch(/@crexendo\.com/i);
    expect(fixtures()).not.toMatch(/CXDO-(LT|DT)-/);
    // Added with the Graph fixtures: a tenant's own domain is as identifying as
    // a UPN, and `onmicrosoft.com` is the one nobody thinks to redact because it
    // does not look like a company name.
    expect(fixtures()).not.toMatch(/\bonmicrosoft\.com\b/i);
    expect(fixtures()).not.toMatch(/@netsapiens\.com/i);
  });

  /** Domains an address in this repo may legitimately carry. Each one is here
   *  because somebody decided it, which is the property that matters: a domain
   *  nobody listed fails, including the one nobody thought to forbid.
   *
   *  The second group is the Email page's reason for existing. Its job is to
   *  display attacker-authored content, so its fixtures carry sender addresses
   *  that are *supposed* to look hostile — including `exarnple.com`, which is a
   *  homoglyph of `example.com` and is the fixture doing its job. They are
   *  fabricated and must stay fabricated; a real phishing sender captured from a
   *  live mailbox is somebody's actual address and does not belong in a repo
   *  that is pushed. */
  const ALLOWED_DOMAINS = [
    // documentation ranges, RFC 2606
    'example.com', 'example.net', 'example.org', 'status.example.com',
    // fabricated phishing senders — web/src/fixtures/email.ts
    'invoice-secure.net', 'sharefile-cloud.ru', 'ms-verify.co', 'example-hr.com', 'exarnple.com',
    // commit trailer
    'noreply.anthropic.com',
    // RFC 2606 reserves `.example` as a TLD, exactly as it reserves the three
    // second-level names above, so a name under it can never be anybody's real
    // address. `server/src/auth/session.test.ts` uses it for the origin-
    // confusion cases — `http://ops-dash.local:4000@evil.example`, which is a
    // userinfo attack that `startsWith`/`includes` all accept — and the
    // `host:port@domain` form is a syntactically valid address, so this
    // extraction sees it. Listed rather than exempted: the guard is right that
    // every domain in the tree should be one somebody decided on, and this is
    // the deciding.
    'evil.example',
  ];

  /** The extraction, named once so the guard below and its control cannot
   *  drift into asking two different questions. */
  const domainsIn = (text: string): string[] =>
    (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((addr) =>
      addr.slice(addr.indexOf('@') + 1).toLowerCase(),
    );

  it('every address in the repo is a documentation or fabricated address', () => {
    // The POSITIVE form, and it is the half that catches what nobody listed. The
    // not.toMatch assertions above can only refuse domains somebody thought of;
    // this requires every address to be one we allow. Assert what a value must
    // be, never what it must not be.
    for (const domain of domainsIn(fixtures())) {
      expect(ALLOWED_DOMAINS).toContain(domain);
    }
  });

  it('that guard can fail — the extraction and the allowlist are both live', () => {
    // The control, and this guard needed one badly: every assertion it makes is
    // "the domain I found is allowed", which passes perfectly over a regex that
    // finds nothing at all. A walk that stopped reading, an extraction that
    // stopped matching, or an allowlist widened to a wildcard would all leave it
    // green while guarding nothing.
    //
    // Same `domainsIn`, so this proves the extraction the guard above actually
    // uses, not a second copy of it that could agree while both are wrong.
    expect(domainsIn('contact person@acme-corporation.co.uk for details')).toEqual([
      'acme-corporation.co.uk',
    ]);
    expect(ALLOWED_DOMAINS).not.toContain('acme-corporation.co.uk');
    // …and the extraction really does see the userinfo form, which is the shape
    // that brought `evil.example` into the list and is easy to lose in a regex
    // change.
    expect(domainsIn('http://ops-dash.local:4000@evil.example')).toEqual(['evil.example']);
    // Non-vacuity of the run itself: the tree genuinely contains addresses, so
    // the loop above is not iterating over an empty list.
    expect(domainsIn(fixtures()).length).toBeGreaterThan(5);
  });

  /**
   * Dotted quads that are not our estate leaking.
   *
   * **L-4: the two RFC 1918 entries are scoped to the files that argue for
   * them, and the others are not.** The distinction is the whole finding.
   * `0.0.0.0`, `127.0.0.1` and `169.254.169.254` are unmistakable — no real
   * internal address can hide behind them, because they are not addresses of
   * anything on our estate — so a tree-wide entry costs nothing. `10.0.0.5`
   * and `192.168.1.1` are *weakly identifying*: they are shaped exactly like a
   * real internal host, and a tree-wide exemption for them is a hole any future
   * fixture can walk through by choosing the same two numbers.
   *
   * Scoping only those two keeps the churn where the risk is. A new file
   * carrying an RFC 1918 address has to come here and say why, which is the
   * point; a new file mentioning loopback does not, which is not.
   */
  const ALLOWED_QUADS: { quad: string; why: string; only?: string[] }[] = [
    { quad: '0.0.0.0', why: 'the documented bind address; John ruled it, and it is on the release list' },
    { quad: '127.0.0.1', why: 'loopback — safeTarget proves it is REFUSED, so it must appear' },
    { quad: '169.254.169.254', why: 'cloud metadata — the classic SSRF target, same reason' },
    {
      quad: '10.0.0.5',
      why: 'RFC 1918 — an SSRF refusal case',
      only: ['server/src/http/fetchJson.test.ts'],
    },
    {
      quad: '192.168.1.1',
      why: 'RFC 1918 — an SSRF refusal case',
      only: ['server/src/http/fetchJson.test.ts'],
    },
    // Not an address at all. Kept explicit rather than loosening the pattern,
    // because a regex that stops matching this stops matching real quads too.
    {
      quad: '6.63.0.0',
      why: 'NOT an IP: a Hornetsecurity Control Panel version, verbatim in a vendor payload',
      only: ['server/src/adapters/vendorstatus/__fixtures__/statusio-hornet.json'],
    },
  ];

  const QUAD = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.[\dx]{1,3}\b/g;

  /** The decision, named so it can be exercised over pairs the tree does not
   *  contain. Scoping is a rule about files that do not exist yet, so a test
   *  that can only see today's files cannot tell a scoped entry from an
   *  unscoped one — both pass while nothing violates either. */
  const quadAllowedIn = (ip: string, path: string): boolean => {
    const entry = ALLOWED_QUADS.find((e) => e.quad === ip);
    return entry !== undefined && (entry.only === undefined || entry.only.includes(path));
  };

  it('uses only the RFC 5737 documentation range for IP addresses', () => {
    // Per FILE rather than over one concatenated blob, which is what makes a
    // scoped exemption expressible at all — and gives the failure a path to
    // name instead of an address with no home.
    let seen = 0;
    for (const file of redactable()) {
      const path = rel(file);
      for (const ip of read(file).match(QUAD) ?? []) {
        seen += 1;
        if (quadAllowedIn(ip, path)) continue;
        expect(ip, `${path} carries ${ip}`).toMatch(/^203\.0\.113\./);
      }
    }
    // Non-vacuity, and it belongs on EVERY walk-and-assert guard in this file:
    // the loop above is "no offender found", which a walk over nothing
    // satisfies perfectly. Pointing this guard at an empty file list survived a
    // mutation until this line existed — the same hole the URL-attribute guard
    // had, found the same way, in the same session.
    expect(redactable().length, 'the redaction walk read no files').toBeGreaterThan(50);
    expect(seen, 'the walk found no dotted quads at all').toBeGreaterThan(5);
  });

  it('a scoped quad is refused outside the file that argues for it', () => {
    // The control the tree cannot provide. Nothing in the repo currently
    // carries `10.0.0.5` outside `fetchJson.test.ts`, so scoping and not
    // scoping look identical from the corpus — removing `only` entirely
    // survived a mutation until this test existed. These pairs are the
    // future files the scoping exists for.
    expect(quadAllowedIn('10.0.0.5', 'server/src/http/fetchJson.test.ts')).toBe(true);
    expect(quadAllowedIn('192.168.1.1', 'server/src/http/fetchJson.test.ts')).toBe(true);
    // …and the same address in any other file is not exempt, which is the
    // whole of L-4: an RFC 1918 quad is shaped exactly like a real internal
    // host, so a tree-wide exemption is a hole a future fixture walks through
    // by choosing the same two numbers.
    for (const path of [
      'server/src/adapters/email/config.ts',
      'server/src/adapters/endpoints/__fixtures__/computers.json',
      'web/src/fixtures/email.ts',
    ]) {
      expect(quadAllowedIn('10.0.0.5', path), path).toBe(false);
      expect(quadAllowedIn('192.168.1.1', path), path).toBe(false);
    }
    // The unscoped entries stay unscoped, deliberately: no real internal
    // address can hide behind loopback or the metadata address.
    expect(quadAllowedIn('127.0.0.1', 'server/src/adapters/email/config.ts')).toBe(true);
    expect(quadAllowedIn('169.254.169.254', 'anywhere/at/all.ts')).toBe(true);
    // And an address on nobody's list is refused everywhere.
    expect(quadAllowedIn('10.11.12.13', 'server/src/http/fetchJson.test.ts')).toBe(false);
  });

  it('every scoped quad is still in the file that argues for it', () => {
    // An exemption that outlives its reason is a licence nobody is using and
    // nobody will notice being used again — the same rule the URL-attribute
    // allowlist is held to. A scoped entry whose file no longer contains the
    // address should be deleted, not left lying about.
    const scanned = new Set(redactable().map(rel));
    for (const { quad, only, why } of ALLOWED_QUADS) {
      expect(why.length, `${quad} carries no reason`).toBeGreaterThan(20);
      for (const path of only ?? []) {
        expect(scanned, `${quad} is scoped to ${path}, which this guard does not scan`).toContain(path);
        expect(read(join(REPO, path)), `${quad} is scoped to ${path}, which no longer contains it`).toContain(quad);
      }
    }
  });
});

describe('HTML sinks', () => {
  it('only Icon.tsx may use dangerouslySetInnerHTML', () => {
    const offenders = src().filter(
      (f) =>
        read(f).includes('dangerouslySetInnerHTML') &&
        !f.endsWith('aurora/Icon.tsx') &&
        // Icon.test.tsx proves the sink cannot be hijacked via prop spread, so it
        // must name it. The exemption is conditional on that proof still being
        // present: strip the assertion and the file stops being exempt.
        !(f.endsWith('aurora/Icon.test.tsx') && read(f).includes("not.toContain('<image')")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  /**
   * URL-bearing attributes this tree may contain. **Empty, and that is the
   * finding**: measured across every non-test file under `web/src`, there is
   * not one `href`, `src`, `action` or `formaction` in the application. All
   * navigation is react-router's `to`, every image is an inline SVG from
   * `Icon.tsx`'s vetted path data, and every font and stylesheet is referenced
   * from `index.html`, which the outbound guard covers separately.
   *
   * An entry here is a decision, like `ALLOWED_DOMAINS` above: `path => reason`.
   */
  const ALLOWED_URL_ATTRIBUTES: Record<string, string> = {};

  /**
   * The files this guard reads: every non-test source file under `web/src`.
   *
   * ONE definition, used by the guard and by its control. Found by mutation:
   * with the control computing the corpus separately, pointing the guard at an
   * empty list left all thirty tests green — the control was asserting that
   * `src()` is non-empty, which was never the question. A non-vacuity check on
   * a parallel computation proves nothing about the computation that matters.
   */
  const urlScanned = () => src().filter((f) => !/\.test\.tsx?$/.test(f));

  /**
   * `href=`, `src=`, `action=`, `formaction=` **as an attribute**, in JSX or
   * inside a template string, in any casing.
   *
   * The two restrictions are both load-bearing and both were put there by the
   * guard firing on honest code the first time it ran:
   *
   *   - the value must start `{`, `"`, `'` or `$` — an attribute's value always
   *     does, and `const href = navHref(item)` and `href === item.path` do not.
   *     `app/Sidebar.tsx`, `app/routes.ts` and `live/parse.ts` all hold a local
   *     named `href` or `action`, and a guard that cried wolf on those would
   *     have been deleted within the week.
   *   - not preceded by a word character, `.` or `:`, which is what keeps
   *     `xlink:href` with the generated-icon assertion below that owns it.
   *
   * Three known blind spots, stated rather than papered over. None is live
   * today, all three were measured rather than assumed, and the next person
   * should know where this guard stops rather than trusting it further than it
   * reaches:
   *
   *   - `createElement('a', { href: u })` uses a colon and is invisible here.
   *     This tree is JSX throughout and contains no `createElement` call.
   *   - **`style` is uncovered.** `style={{ backgroundImage: `url(${x})` }}` is
   *     a URL-bearing sink this pattern cannot see. Grepped by `m4-auth`:
   *     there is no `url(`, `backgroundImage`, `cssText` or `setProperty`
   *     anywhere under `web/src`.
   *   - **A spread is invisible.** `<a {...props} />` carries an `href` the
   *     pattern never sees — which is exactly H-1's shape from G0, where
   *     `Icon.tsx` spread `{...rest}` after `dangerouslySetInnerHTML` and the
   *     guard could not see the sink because a spread contains no literal.
   *     That one became a real vulnerability, so this is the gap of the three
   *     most worth closing if any of them ever goes live.
   */
  const URL_ATTRIBUTE =
    /(?<!\b(?:const|let|var)\s)(?<![\w$.:])(href|src|action|formaction)\s*=\s*["'{$]/i;

  it('no value reaches a URL-bearing attribute, because there are none', () => {
    // Written because `m4-email` traced the Email page's sinks and found the
    // gap: `BlockedMessage.from` is the most link-shaped field in the product —
    // an attacker-chosen address, one `mailto:` convenience away from being an
    // href — and nothing in this file would have caught it. `mailto:` is also
    // not the only scheme a browser accepts from a string somebody else wrote.
    //
    // The guard deliberately does NOT try to judge whether a particular href is
    // safe. That is a semantic judgement a grep gets wrong in both directions,
    // and the moment it tries, it acquires an opinion it will be wrong about.
    // It asserts the much stronger and currently TRUE property: this tree has
    // no such attribute at all. Adding the first one is then a conversation
    // rather than a diff nobody reads — which is the whole value, because the
    // dangerous href is never the one somebody thought about.
    const offenders = urlScanned()
      .filter((f) => URL_ATTRIBUTE.test(read(f)))
      .map(rel)
      .filter((f) => !Object.hasOwn(ALLOWED_URL_ATTRIBUTES, f));
    expect(offenders).toEqual([]);
  });

  it('every allowlisted path is real and still needs its exemption', () => {
    // Found by mutation: an entry added to the allowlist hid a genuine sink and
    // nothing complained, because nothing ever checked the entries. An
    // exemption that outlives its reason is worse than no guard — the guard
    // still looks present. Same shape as the open-loop guard's own
    // 'the allowlist names real contract fields and carries a reason' test.
    const scanned = new Set(urlScanned().map(rel));
    for (const [path, reason] of Object.entries(ALLOWED_URL_ATTRIBUTES)) {
      expect(scanned, `${path} is allowlisted but is not a file this guard scans`).toContain(path);
      // It must STILL contain one. An exemption for a sink somebody removed is
      // a licence nobody is using and nobody will notice being used again.
      expect(
        URL_ATTRIBUTE.test(read(join(REPO, path))),
        `${path} is allowlisted but no longer has a URL attribute — drop the entry`,
      ).toBe(true);
      expect(reason.length, `${path} carries no reason`).toBeGreaterThan(20);
    }
  });

  it('that guard can fail — the pattern fires on every shape it claims to catch', () => {
    // The control. The assertion above is "no offender found", which passes
    // identically against a regex that matches nothing, a walk that reads no
    // files, or a filter that excludes everything. Three of those four
    // possibilities are live here, so this proves the pattern AND the corpus.
    for (const sink of [
      '<a href={`mailto:${row.from}`}>',
      "<img src={row.preview} />",
      '<a HREF="x">',
      '<form action={u}>',
      '<button formaction={u}>',
      'const s = `<img src=${u}>`;',
    ]) {
      expect(URL_ATTRIBUTE.test(sink), sink).toBe(true);
    }
    // `xlink:href` belongs to the generated-icon assertion below and must not be
    // double-claimed here, or a real offender on the same line would be read as
    // that one's problem.
    expect(URL_ATTRIBUTE.test('<use xlink:href="#a"/>')).toBe(false);
    // The OTHER half of the control, and the half this guard actually needed:
    // the real lines that made it fire on its first run. A pattern that goes
    // back to matching these is a pattern somebody will switch off.
    for (const innocent of [
      'const href = navHref(item, dashboard.incidents.data ?? []);',
      'return pathname === item.path && href === item.path;',
      "const action = str(raw['action']);",
      'if (at === null || action === null) return null;',
    ]) {
      expect(URL_ATTRIBUTE.test(innocent), innocent).toBe(false);
    }
    // The `style` gap, closed as far as an assertion can close it. The
    // attribute pattern cannot see `style={{ backgroundImage: url(...) }}`,
    // and rather than teach it to parse CSS this pins the property that makes
    // the gap theoretical: the CSS url() function appears nowhere in the tree.
    // True today, measured, and it fails loudly the first time somebody adds
    // one — which is the moment to look at it, not three commits later.
    const cssUrl = 'url' + '(';
    expect(urlScanned().filter((f) => read(f).includes(cssUrl)).map(rel)).toEqual([]);
    // Assembled from two fragments so this file does not contain the literal it
    // forbids — the rule it applies to every other pattern here.
    expect(cssUrl).toHaveLength(4);
    // And the corpus the GUARD ITSELF reads is real — `urlScanned`, the same
    // call, not a second one that happens to agree.
    expect(urlScanned().length).toBeGreaterThan(20);
    expect(urlScanned().map(rel)).toContain('web/src/views/Email.tsx');
  });

  it('the generated icon data is geometry only — no script, no event handler, no external ref', () => {
    const generated = read(join(WEB, 'src/components/aurora/icons.generated.ts'));
    expect(generated).not.toMatch(/<script|on[a-z]+=|javascript:|xlink:href|<image|<foreignObject|url\(/i);
    // every body is one or more <path .../> elements and nothing else
    for (const [, body] of generated.matchAll(/body: "((?:[^"\\]|\\.)*)"/g)) {
      const decoded = JSON.parse(`"${body}"`);
      expect(decoded.replace(/<path\b[^>]*\/>/g, '').trim()).toBe('');
    }
  });
});

describe('the contract test cannot become a tautology', () => {
  // contracts.ts is frozen; contracts.test.ts is not. The cheapest way to green a
  // failing exact-shape assertion is to paste the shape out of contracts.ts — and
  // the result still reports every assertion passing, with nothing to signal that
  // the test now only proves the file equals itself. That is defect G-2's failure
  // class one level up: a green suite asserting nothing.
  //
  // This makes the check permanent: the field set is derived from all three files
  // and all three must agree. Because the expected shapes must match
  // DATA_CONTRACTS.md — the source of record — it also enforces "amend the
  // document first" mechanically rather than by convention.
  //
  // It lives here, not in shared/, because this file is already node-environment
  // and already does disk I/O; a node:fs import under shared/ would reproduce the
  // B-1 typecheck failure.

  const DOC = join(REPO, 'design_handoff_it_ops_dashboard/DATA_CONTRACTS.md');
  const CONTRACT = join(REPO, 'shared/src/contracts.ts');
  const CONTRACT_TEST = join(REPO, 'shared/src/contracts.test.ts');

  /** `name: type` and `name?: type` pairs, comments and whitespace normalised away. */
  function fields(source: string): string[] {
    const out: string[] = [];
    for (const raw of source.split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
      const m = /^([A-Za-z_$][\w$]*)(\??):\s*(.+?);?$/.exec(line);
      if (!m) continue;
      const [, name, opt, type] = m;
      // Skip prose and code that merely looks like a field.
      if (/^(import|export|const|let|var|function|return|it|describe)$/.test(name!)) continue;
      out.push(`${name}${opt}: ${type!.replace(/\s+/g, ' ').trim()}`);
    }
    return out.sort();
  }

  /** Only the fenced ```ts blocks of the markdown are contract text. */
  function tsBlocks(md: string): string {
    return [...md.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  }

  it('DATA_CONTRACTS.md, contracts.ts and contracts.test.ts declare the same fields', () => {
    const doc = fields(tsBlocks(read(DOC)));
    const impl = fields(read(CONTRACT));
    // The test instantiates the SourceResult<T> generic at number, so normalise it
    // back to T. This is the single known, legitimate difference between the three.
    // Stop at the sentinel: below it the test file uses deliberately malformed
    // literals as hostile probes, which are not contract shapes.
    const testSource = read(CONTRACT_TEST).split('@contract-shapes-end')[0]!;
    const spec = fields(testSource).map((f) => f.replace(/^data(\??): number$/, 'data$1: T'));

    // Counted multiset, not set membership. `label: string` appears under both
    // vendor and ours, so an includes() check leaves the survivor matching and a
    // deletion passes. Compare occurrence counts so duplicates are load-bearing.
    const missing = (a: string[], b: string[]) => {
      const left = new Map<string, number>();
      for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
      const out: string[] = [];
      for (const x of a) {
        const n = left.get(x) ?? 0;
        if (n === 0) out.push(x);
        else left.set(x, n - 1);
      }
      return out;
    };

    expect({
      inDocNotInImpl: missing(doc, impl),
      inImplNotInDoc: missing(impl, doc),
    }).toEqual({ inDocNotInImpl: [], inImplNotInDoc: [] });

    expect({
      inDocNotInTest: missing(doc, spec),
      inTestNotInDoc: missing(spec, doc),
    }).toEqual({ inDocNotInTest: [], inTestNotInDoc: [] });
  });
});

describe('no optional contract field is carried by a fixture and read by nothing', () => {
  // The general form of accepted finding M-9, proposed by ops-fixtures after the
  // same thing happened twice: a fixture gains an optional field, the view that
  // would render it has not been written yet (or vice versa), and nothing
  // detects the open loop. Both halves type-check, both suites are green, and
  // the field renders in no world — so it ships unbaselined and surfaces at
  // Milestone 2 when real data first populates it.
  //
  // Static on purpose. A render-based version would have to defeat formatting
  // (an ISO timestamp becomes "4 hours"), so it would either be fragile or be
  // weakened until it proved nothing. Asking "does any non-fixture source file
  // read this property name" is crude, errs toward passing, and still catches
  // the case that has now bitten twice: nothing reads it at all.

  /** Optional fields deliberately unread in Milestone 1, each with its reason.
   *  An entry here is a decision on the record, not a suppression — remove one
   *  and the guard tells you whether it became reachable. */
  const DELIBERATELY_UNREAD: Record<string, string> = {
    empty: 'SourceResult envelope. No adapter exists until Milestone 2, so no fixture carries one.',
    error: 'Same: SourceResult envelope, Milestone 2.',
    lastSuccessfulPoll:
      'ServiceStatus.vendor.lastSuccessfulPoll is DERIVED by parse.ts rather than read off the ' +
      'wire, deliberately: the honest definition on the wire is "the snapshot carries a payload, ' +
      'so some poll succeeded, and fetchedAt is when". Reading a served field would let a server ' +
      'that stopped sending it silently blank the provenance line ServiceDetail branches on.',
    threshold:
      'AlertRule.threshold is the machine-readable form of the same fact AlertRule.detail states ' +
      'in prose, and Settings renders detail. Rendering both would show one threshold twice. It ' +
      'becomes load-bearing at Milestone 2, when the poller reads it to decide whether a rule fires.',
  };

  /** Found by this guard and NOT yet fixed. Distinct from the map above: those
   *  are decisions, these are open findings with owners. This map should empty. */
  const OPEN_LOOPS: Record<string, string> = {
    advisoryId:
      'Proofpoint carries hs-8841 and nothing renders it, so the one vendor advisory we can ' +
      'actually read is invisible. Owner: view-service, on ServiceDetail vendor card.',
    maintenance:
      'Amendment 2. Helpjuice carries a scheduled window and no view reads vendor.maintenance ' +
      'at all — the parent of the two below. It passed until G3 because the guard was ' +
      'name-keyed, and a StatusLevel rank map containing `maintenance: 1` counted as a read. ' +
      'Owner: view-service.',
    scheduledFor:
      'Amendment 2 maintenance window. Helpjuice is in one and the screen cannot say when it ' +
      'started. Owner: view-service.',
    scheduledUntil:
      'Same window, and the more useful half — when does it end. Owner: view-service.',
    url:
      'VendorIncident.url and vendor.url — the link to the advisory itself, dropped by parse.ts ' +
      'so it cannot reach a screen on the live path at all. Note for whoever renders it: it ' +
      'would be the FIRST href in web/src, so it lands on the URL-attribute guard above and is ' +
      'a conversation rather than a diff. It is also vendor-authored, which is why that guard ' +
      'exists. Found by the parser-side guard below.',
    title:
      'VendorIncident.title — the advisory headline. Same cause as url: the whole ' +
      'incidentsSince[] array is dropped at the parser, so no part of a vendor advisory reaches ' +
      'the live UI. Found by the parser-side guard below.',
  };

  function optionalContractFields(): string[] {
    const text = readFileSync(join(REPO, 'shared/src/contracts.ts'), 'utf8');
    const names = [...text.matchAll(/^\s+([a-zA-Z][\w]*)\?:/gm)].map((m) => m[1]!);
    // Also the fields declared INSIDE an optional object's inline type. This is
    // the case that motivated the guard: `muted?: { by; until }` makes `until`
    // required-within-optional, so it never appears as `until?:` and a
    // top-level-only scan would miss exactly the open loop we are hunting.
    for (const [, body] of text.matchAll(/^\s+[a-zA-Z][\w]*\?:\s*\{([^}]*)\}/gm)) {
      for (const [, inner] of body!.matchAll(/([a-zA-Z][\w]*)\s*:/g)) names.push(inner!);
    }
    return [...new Set(names)];
  }

  /** Every property name present (and not undefined) anywhere in the fixtures. */
  function namesCarriedByFixtures(node: unknown, acc = new Set<string>()): Set<string> {
    if (Array.isArray(node)) {
      for (const v of node) namesCarriedByFixtures(v, acc);
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (v !== undefined) acc.add(k);
        namesCarriedByFixtures(v, acc);
      }
    }
    return acc;
  }

  it('every optional field a fixture carries is read somewhere outside the fixtures', async () => {
    const { fixtures } = (await import('./fixtures/index.js')) as { fixtures: unknown };
    const carried = namesCarriedByFixtures(fixtures);

    // Consumers only: not the fixtures that supply the value, not the guards.
    // Comments are stripped, because prose mentioning a field is not code
    // reading it — `statusColor.ts` cites `SourceResult.empty` in a doc comment,
    // which would otherwise count as a consumer and let a genuine open loop pass.
    const consumers = src()
      .filter((f) => !f.includes(`${sep}fixtures${sep}`))
      .map((f) => stripComments(read(f)))
      .join('\n');

    const unread = optionalContractFields()
      .filter((name) => carried.has(name))
      .filter((name) => !(name in DELIBERATELY_UNREAD))
      .filter((name) => !(name in OPEN_LOOPS))
      // Property ACCESS only: `x.name`, `x['name']`, or destructuring `{ name }`.
      // The original also accepted `name:`, which matches an object KEY — so a
      // StatusLevel rank map containing `maintenance: 1` counted as reading
      // `vendor.maintenance`, and three carried-and-unread fields passed.
      .filter(
        (name) =>
          !new RegExp(
            `\\.${name}\\b|\\[['"\`]${name}['"\`]\\]|\\{[^{}]*\\b${name}\\b[^{}]*\\}\\s*=`,
          ).test(consumers),
      );

    expect(unread).toEqual([]);
  });

  /**
   * The second half of this rule, and the half that would have caught the one
   * that actually shipped.
   *
   * The guard above is gated on **a fixture carrying the field**. `ack` and
   * `muted` have been declared on `Incident` since Milestone 1 and **no fixture
   * carries either** — that is accepted finding M-9 — so this guard was
   * structurally blind to precisely the two fields that went wrong. When
   * `/api/incidents` began hydrating them, `parse.ts` dropped both on the
   * floor: `Overview.tsx` dims an acknowledged row, credits `incident.ack.by`
   * and disables its Acknowledge button, and every one of those was dead on the
   * live path. An operator's acknowledgement rendered as untouched.
   *
   * Nobody was wrong. The parser was correct when written because nothing
   * served the fields, and it became wrong when the other side started. **What
   * failed is that no artefact spanned the two workspaces** — and there is
   * exactly one that could, the contract. Proposed by `m4-auth` after finding
   * the mirror image of the same defect on the server side.
   *
   * So: for every contract type the live layer names, every optional field must
   * be READ by the parser that builds it. The gate is "does the web reference
   * this type", not "does a fixture carry this value", which is what makes it
   * fire the day a field is declared rather than the day someone fills it.
   */
  const CONTRACTS = join(REPO, 'shared/src/contracts.ts');

  /** Each exported object type, by name, with its body — brace-matched rather
   *  than line-scanned, so a nested object cannot end a block early. */
  function contractBlocks(): Record<string, string> {
    const text = read(CONTRACTS);
    const out: Record<string, string> = {};
    for (const m of text.matchAll(/export type (\w+)\s*=\s*\{/g)) {
      const start = m.index! + m[0].length - 1;
      let depth = 0;
      for (let j = start; j < text.length; j += 1) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            out[m[1]!] = text.slice(start + 1, j);
            break;
          }
        }
      }
    }
    return out;
  }

  function optionalsIn(body: string): string[] {
    const names = [...body.matchAll(/^\s+([a-zA-Z]\w*)\?:/gm)].map((m) => m[1]!);
    // Fields declared INSIDE an optional object are required-within-optional,
    // so they never appear as `name?:` — `muted?: { by; until }` is the case
    // that motivated this, and a top-level scan misses exactly the open loop.
    for (const m of body.matchAll(/^\s+[a-zA-Z]\w*\?:\s*\{([^}]*)\}/gm)) {
      for (const inner of m[1]!.matchAll(/([a-zA-Z]\w*)\s*:/g)) names.push(inner[1]!);
    }
    return [...new Set(names)];
  }

  /** `raw['name']` or `x.name` in the parser. Property ACCESS, not an object
   *  key — the distinction that made the guard above real when it was tightened. */
  const readsField = (source: string, name: string): boolean =>
    new RegExp(`\\[['"\`]${name}['"\`]\\]|\\.${name}\\b`).test(source);

  /** The types the live layer names at all. A new parser importing
   *  `EmailSnapshot` brings its optional fields into scope with no edit here,
   *  which is what stops this list rotting. */
  const liveTypeNames = (): string[] => {
    const live = ['parse.ts', 'model.ts', 'DataSource.tsx', 'client.ts']
      .map((f) => read(join(WEB, 'src/live', f)))
      .join('\n');
    return Object.keys(contractBlocks()).filter((name) => new RegExp(`\\b${name}\\b`).test(live));
  };

  it('every optional field of a contract type the live layer names is read by the parser', () => {
    const blocks = contractBlocks();
    const parser = stripComments(read(join(WEB, 'src/live/parse.ts')));
    const unread: string[] = [];
    for (const name of liveTypeNames()) {
      for (const field of optionalsIn(blocks[name]!)) {
        if (field in DELIBERATELY_UNREAD || field in OPEN_LOOPS) continue;
        if (!readsField(parser, field)) unread.push(`${name}.${field}`);
      }
    }
    expect(unread).toEqual([]);
  });

  it('that guard can fail, and is reading real types — it cannot pass vacuously', () => {
    // Non-vacuity on BOTH halves, because "no offender found" is what an empty
    // walk reports and I have shipped that hole twice in this file already.
    const blocks = contractBlocks();
    expect(Object.keys(blocks).length, 'no contract types parsed').toBeGreaterThan(10);
    expect(liveTypeNames(), 'the live layer names no contract types').toContain('Incident');
    expect(optionalsIn(blocks['Incident']!), 'Incident has no optional fields').toEqual(
      expect.arrayContaining(['ack', 'muted', 'resolvedAt']),
    );

    // The decision, over inputs the tree cannot supply. `ack` is READ today —
    // it was not before `8e034c1`, and this guard is the thing that would have
    // said so on the day the field was declared.
    const parser = stripComments(read(join(WEB, 'src/live/parse.ts')));
    expect(readsField(parser, 'ack')).toBe(true);
    expect(readsField(parser, 'muted')).toBe(true);
    expect(readsField(parser, 'resolvedAt')).toBe(true);
    expect(readsField(parser, 'aFieldNobodyDeclared')).toBe(false);
    // An object KEY is not a read. This is the tightening that made the guard
    // above real, asserted here rather than inherited on trust.
    expect(readsField('const m = { maintenance: 1 };', 'maintenance')).toBe(false);
    expect(readsField("const v = raw['maintenance'];", 'maintenance')).toBe(true);
  });

  it('the allowlist names real contract fields and carries a reason for each', () => {
    // Stops the allowlist rotting into a list of names nobody revisits. It does
    // NOT assert the fields are still unread: this matcher is name-based, and
    // `empty` collides with PanelState's `kind: 'empty'`, so "is it referenced"
    // cannot distinguish SourceResult.empty from an unrelated property. Claiming
    // otherwise would be a test asserting something it cannot see — which is the
    // failure this whole file exists to prevent. The reason strings are the
    // control instead: each must say why, so an exemption is a decision on the
    // record rather than a silenced failure.
    for (const [name, reason] of Object.entries({ ...DELIBERATELY_UNREAD, ...OPEN_LOOPS })) {
      expect(optionalContractFields()).toContain(name);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

describe('no background token is blind to the theme', () => {
  // The G3 BLOCKER: `background: 'var(--grey-grey-100)'` on the Overview strip
  // pill. That is a raw ramp VALUE with no dark override, so it stayed
  // rgb(235,242,245) in both palettes — while `--text-primary` resolves to the
  // same rgb(235,242,245) in dark. 1.00:1, seven invisible service names, and
  // it would have been frozen into quiet-dark-overview.png.
  //
  // The general form, from view-overview: **a role resolves to different colours
  // per palette; a ramp value resolves to the same colour in both.** So rather
  // than blocklisting `--grey-grey-*` by name, this asks the question that
  // actually matters of every token used as a background — does it change with
  // the theme? A new ramp token, or a semantic one someone forgets to override,
  // fails without anybody having to predict it.

  /** Token names redefined inside fig-tokens.css's dark block. */
  function themeAwareTokens(): Set<string> {
    const css = readFileSync(join(WEB, 'public/aurora/tokens/fig-tokens.css'), 'utf8');
    // Located by the `.dark` half of the selector on purpose: the other half is
    // the literal the no-second-dark-palette guard greps for.
    const start = css.indexOf(', .dark');
    const block = css.slice(start, css.indexOf('\n}', start));
    return new Set([...block.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!));
  }

  it('every token used as a bare background is redefined in the dark palette', () => {
    const aware = themeAwareTokens();
    const offenders: string[] = [];

    for (const file of src()) {
      stripComments(read(file))
        .split('\n')
        .forEach((line, i) => {
          // Bare `var(--x)` only. `var(--semantic, var(--ramp))` is fine: the
          // fallback fires only if the semantic token is missing, and all of
          // ours exist.
          // Any quoting, including template literals, and every property that
          // paints a colour — not just `background`. The first version of this
          // guard matched single quotes only, and the BLOCKER was reintroduced
          // verbatim with double quotes while all fourteen guards passed.
          const m =
            /\b(?:background|backgroundColor|borderColor|outlineColor|fill|stroke):\s*['"`]var\((--[\w-]+)\)['"`]/.exec(
              line,
            );
          if (m && !aware.has(m[1]!)) {
            offenders.push(`${rel(file)}:${i + 1}  ${m[1]} has no dark override`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('is not defeated by how the value is quoted', () => {
    // The hole this guard shipped with. Each of these is the same defect; the
    // original pattern saw only the first.
    const pattern =
      /\b(?:background|backgroundColor|borderColor|outlineColor|fill|stroke):\s*['"`]var\((--[\w-]+)\)['"`]/;
    for (const form of [
      "background: 'var(--grey-grey-100)'",
      'background: "var(--grey-grey-100)"',
      'background: `var(--grey-grey-100)`',
      'backgroundColor: "var(--grey-grey-100)"',
      'borderColor: `var(--grey-grey-100)`',
    ]) {
      expect(pattern.exec(form)?.[1]).toBe('--grey-grey-100');
    }
  });

  it('the dark block was actually found — this guard cannot pass vacuously', () => {
    // If the selector ever changes, themeAwareTokens() returns an empty set and
    // every background becomes an offender — loud. But the inverse, a parse that
    // silently matches everything, would make the guard green forever. Pin both.
    const aware = themeAwareTokens();
    expect(aware.size).toBeGreaterThan(50);
    expect(aware.has('--text-primary')).toBe(true);        // a role: overridden
    expect(aware.has('--grey-grey-100')).toBe(false);      // a ramp value: not
  });
});


describe('the server talks to the network only through its one helper', () => {
  // The web must make no network call at all; the server exists to make them.
  // So the rule inverts rather than extends: every outbound call goes through
  // src/http/fetchJson.ts, which is where all four failure rules live —
  // non-2xx, non-JSON-under-2xx, empty, and network error. An adapter calling
  // `fetch` directly has bypassed every one of them, and the most likely
  // symptom is an expired token's HTML error page being reported as a
  // successful poll of zero records. That has happened on this tenant.
  const HELPER = join(SERVER, 'src', 'http', 'fetchJson.ts');

  /** A thin reachability probe is allowed its own request, because it must NOT
   *  parse a body — but it has to say so at the call site, so the exemption is
   *  a decision on the record rather than a bypass nobody noticed. */
  const EXEMPT_MARKER = 'deliberately not fetchJson';

  /**
   * How close the marker has to be to the thing it licenses.
   *
   * This used to be file-scoped: the marker anywhere in a file exempted the
   * WHOLE file, checked against the raw text before comments were stripped — so
   * one comment licensed every line in the file forever. The security review
   * reproduced it both ways with a probe file, and the realistic path to it is
   * not malice but copy-paste: `probe.ts` is the file you read to learn the
   * convention, and an M3 adapter that copies its header comment gets a blanket
   * pass on all four failure rules.
   *
   * Line-scoped, the entire server has exactly ONE site needing a licence —
   * `probe.ts`'s `fetchImpl: FetchLike = fetch` default parameter. Its actual
   * call is `fetchImpl(...)`, which is not the global and never trips the guard.
   * So the block comment stays as the argument; it just stops being the licence.
   */
  const EXEMPT_LINES_ABOVE = 2;

  it('the global fetch is not reachable outside the helper, by call OR by alias', () => {
    // Matches the IDENTIFIER, not the call. The first version of this guard
    // looked for `fetch(` and was therefore blind to the most natural way to
    // use the global without calling it directly:
    //
    //     async function runProbe(spec, fetchImpl: FetchLike = fetch)
    //
    // There is no literal `fetch(` on that line, so the guard passed — and
    // deleting the exemption marker from the file changed nothing. Found by the
    // probes agent testing whether the marker it had been told to write was
    // load-bearing. It was not. Aliasing the global is exactly how an M3
    // adapter would bypass the four failure rules without meaning to.
    //
    // `fetchJson`, `fetchImpl`, `x.fetch` and a parameter named fetch are all
    // fine: the negative lookarounds below exclude an identifier that is part
    // of a longer name or reached through a property.
    // `globalThis.fetch` and `window.fetch` reach the same global through a
    // property, which the lookbehind above deliberately excludes — so they get
    // their own pattern rather than a weaker one that would also flag
    // `this.fetcher.fetch`. And a raw node HTTP module bypasses the helper
    // entirely without the word `fetch` appearing at all, which is how an M3
    // adapter ported from a Python client would most naturally do it.
    const VIA_GLOBAL = /\b(?:globalThis|window|self)\s*\.\s*fetch\b/;
    const RAW_HTTP = /from\s+['"]node:(?:http|https|net|dgram|tls)['"]|require\(['"]node:(?:http|https|net|dgram|tls)['"]\)/;
    const BARE_GLOBAL = /(?<![.\w$])fetch(?![\w$])/;
    const offenders: string[] = [];
    for (const file of serverSrc()) {
      if (file === HELPER) continue;
      const raw = read(file).split('\n');
      // The marker lives in a comment, so it is found in the RAW text; the
      // offending code is found in the stripped text. `stripComments` now
      // preserves line numbers exactly, which is what makes the two comparable.
      const licensed = new Set<number>();
      raw.forEach((line, i) => {
        if (line.includes(EXEMPT_MARKER)) {
          for (let d = 0; d <= EXEMPT_LINES_ABOVE; d += 1) licensed.add(i + d);
        }
      });
      stripComments(read(file))
        .split('\n')
        .forEach((line, i) => {
          if (licensed.has(i)) return;
          if (BARE_GLOBAL.test(line) || VIA_GLOBAL.test(line) || RAW_HTTP.test(line)) {
            offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('a marker elsewhere in the file does not license a bare fetch', () => {
    // The guard's own control, and the thing that makes the rule above worth
    // anything. This is the exact shape the security review reproduced: a file
    // whose header comment carries the marker — the most natural way to write
    // an M3 adapter, since probe.ts is the file you read to learn the
    // convention — and a bare `fetch` fifteen lines down.
    //
    // Run against the real rule rather than a re-implementation of it, so the
    // two cannot drift: same regexes, same EXEMPT_LINES_ABOVE, same
    // stripComments.
    const BARE_GLOBAL = /(?<![.\w$])fetch(?![\w$])/;
    const file = [
      '/**',
      ' * An adapter for some vendor.',
      ' *',
      ' * deliberately not fetchJson — copied from probe.ts without thinking.',
      ' */',
      'export async function poll(url: string) {',
      '  const res = await fetch(url);',
      '  return res.json();',
      '}',
    ].join('\n');

    const raw = file.split('\n');
    const licensed = new Set<number>();
    raw.forEach((line, i) => {
      if (line.includes(EXEMPT_MARKER)) {
        for (let d = 0; d <= EXEMPT_LINES_ABOVE; d += 1) licensed.add(i + d);
      }
    });
    const caught = stripComments(file)
      .split('\n')
      .filter((line, i) => !licensed.has(i) && BARE_GLOBAL.test(line));

    expect(caught).toHaveLength(1);
    expect(caught[0]).toContain('await fetch(url)');

    // And the positive half: a marker on the line above DOES license it, or the
    // rule would be a wall rather than a floor and probe.ts could not exist.
    const withMarker = ['// deliberately not fetchJson', 'const res = await fetch(url);'];
    const ok = new Set<number>();
    withMarker.forEach((line, i) => {
      if (line.includes(EXEMPT_MARKER)) for (let d = 0; d <= EXEMPT_LINES_ABOVE; d += 1) ok.add(i + d);
    });
    expect(
      stripComments(withMarker.join('\n'))
        .split('\n')
        .filter((line, i) => !ok.has(i) && BARE_GLOBAL.test(line)),
    ).toEqual([]);
  });

  it('catches every shape of reaching the global, not just the one we thought of', () => {
    // The guard's own control. Each of these is a real way to get at the
    // global, and the first version caught only the first.
    const BARE_GLOBAL = /(?<![.\w$])fetch(?![\w$])/;
    const VIA_GLOBAL = /\b(?:globalThis|window|self)\s*\.\s*fetch\b/;
    const RAW_HTTP = /from\s+['"]node:(?:http|https|net|dgram|tls)['"]|require\(['"]node:(?:http|https|net|dgram|tls)['"]\)/;
    const reaches = (line: string) =>
      BARE_GLOBAL.test(line) || VIA_GLOBAL.test(line) || RAW_HTTP.test(line);

    for (const shape of [
      'await fetch(url)',
      'const f = fetch;',
      'function p(impl = fetch) {}',
      'run(fetch, url)',
      'export const client = { get: fetch };',
      // Found at G0: these three passed the first two versions of this guard.
      'const go = globalThis.fetch;',
      "import { request } from 'node:https';",
      "const { request } = require('node:http');",
    ]) {
      expect(reaches(shape), shape).toBe(true);
    }
    // And must NOT fire on these, or the guard is unusable.
    for (const ok of [
      'const r = await fetchJson(url);',
      'fetchImpl(spec.url)',
      'await this.fetcher.fetch(url)',
      'import { fetchJson } from "../http/fetchJson.js";',
      "import { readFileSync } from 'node:fs';",
    ]) {
      expect(reaches(ok), ok).toBe(false);
    }
  });

  it('this guard is watching a directory that exists', () => {
    // Without this it passes vacuously while server/src is empty, and keeps
    // passing if the directory is ever moved or renamed — which is the shape
    // of half the defects this file was written to catch.
    expect(existsSync(join(SERVER, 'src'))).toBe(true);
    expect(serverSrc().length).toBeGreaterThan(0);
  });
});
