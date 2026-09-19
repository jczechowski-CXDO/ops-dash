// @vitest-environment node
// These guards read the repository from disk. Under the jsdom environment
// import.meta.url is an http:// URL and fileURLToPath rejects it, so this file
// pins itself to node. Nothing here touches the DOM.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
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
const src = () =>
  walk(join(WEB, 'src'), ['.ts', '.tsx']).filter((f) => !f.endsWith('guards.test.ts'));
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(REPO.length + 1).replace(/\\/g, '/');

describe('every colour is a token', () => {
  it('no literal hex in web/src', () => {
    const offenders: string[] = [];
    for (const file of src()) {
      if (file.endsWith('icons.generated.ts')) continue;
      read(file).split('\n').forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !line.includes('prototype literal')) {
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
