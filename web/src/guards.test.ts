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
    const assets = walk(join(WEB, 'public'), ['.css', '.html', '.js']);
    const offenders = assets.filter((f) => /https?:\/\//.test(read(f)));
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
  const fixtures = () => walk(join(WEB, 'src/fixtures'), ['.ts']).map(read).join('\n');

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
      (f) => read(f).includes('dangerouslySetInnerHTML') && !f.endsWith('aurora/Icon.tsx'),
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
