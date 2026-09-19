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
const src = () =>
  // Anchored to this exact path, not endsWith: the old form exempted ANY
  // web/src/**/guards.test.ts from every guard, so a new file with that name
  // in any subdirectory would have been silently unguarded.
  walk(join(WEB, 'src'), ['.ts', '.tsx']).filter((f) => f !== SELF);
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(REPO.length + 1).replace(/\\/g, '/');
/** Prose mentioning a thing is not code doing it — several guards depend on this. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

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
    const offenders = assets.filter((f) => outbound.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no network client anywhere in web/src', () => {
    const offenders: string[] = [];
    for (const file of src()) {
      // offline.test.tsx asserts ON fetch being absent, so it names it.
      if (file.endsWith('offline.test.tsx')) continue;
      if (/\bfetch\s*\(|XMLHttpRequest|new WebSocket|new EventSource|navigator\.sendBeacon/.test(read(file))) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('no credentials, ever', () => {
  it('no credential path or secret-shaped key in the repo source', () => {
    const files = [...src(), ...walk(join(REPO, 'shared'), ['.ts'])];
    const pattern = /C:\\+secure|cert\.pem|refresh_token|client_secret|api_key|Zoho-oauthtoken|BEGIN (RSA )?PRIVATE KEY/i;
    const offenders = files.filter((f) => pattern.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('fixtures stay redacted', () => {
  // Deliberately scans ALL of web/src, not just src/fixtures. Scoping this to one
  // directory meant a redaction failure one level up — web/src/fixtures.ts rather
  // than web/src/fixtures/*.ts — passed every guard, and made "directory absent"
  // indistinguishable from "nothing found". Redaction binds everywhere, tests
  // included, so the guard should look everywhere.
  const fixtures = () => src().map(read).join('\n');

  it('carries no real corporate identifier', () => {
    // CXDO-GraphExport and Stellar-Connector are app-registration names, not
    // user or host identifiers, and are deliberately real. Hosts and UPNs are not.
    expect(fixtures()).not.toMatch(/@crexendo\.com/i);
    expect(fixtures()).not.toMatch(/CXDO-(LT|DT)-/);
  });

  it('uses only the RFC 5737 documentation range for IP addresses', () => {
    for (const ip of fixtures().match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.[\dx]{1,3}\b/g) ?? []) {
      expect(ip).toMatch(/^203\.0\.113\./);
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
    const spec = fields(testSource).map((f) => f.replace(/^data: number$/, 'data: T'));

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
