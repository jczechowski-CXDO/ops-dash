import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync, existsSync } from 'node:fs';
import manifest from '../scripts/runtime-assets.json' with { type: 'json' };

const RUNTIME_ASSETS: string[] = manifest.assets;

const HERE = dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('every runtime asset is in the build manifest', () => {
  it('no source reads a non-TypeScript file that dist would not have', () => {
    // The failure this prevents happened twice in ten minutes the first time
    // the server was started as a process: `tsc` emits TypeScript and nothing
    // else, so `schema.sql` and `vendors.json` were simply absent from dist and
    // the process died on its first line with ENOENT. It typechecked, it
    // compiled, and it could not start.
    //
    // A hand-maintained copy list goes stale the moment somebody adds a config
    // file, and the symptom is a build that only fails in production. So this
    // reads the SOURCE for runtime file reads and checks the manifest covers
    // them, rather than trusting anyone to remember.
    const referenced = new Set<string>();
    for (const file of walk(HERE)) {
      const text = readFileSync(file, 'utf8');
      // `join(HERE, 'schema.sql')` and friends — a string literal with a
      // non-code extension, anywhere in a file that also reads from disk.
      if (!/readFileSync|createReadStream|readFile\(/.test(text)) continue;
      for (const [, name] of text.matchAll(/['"`]([\w./-]+\.(?:sql|json|pem|txt|csv|ya?ml))['"`]/g)) {
        // Fixtures are test-only and deliberately not shipped.
        if (name!.includes('__fixtures__') || name!.includes('package.json')) continue;
        // **Only files that actually sit beside the source.** The first version
        // of this matched any literal ending in `.json` inside a file that also
        // reads from disk, and immediately flagged `graph.json` — which is the
        // operator's credential config at an absolute path in their home
        // directory, emphatically NOT something to copy into a build artefact.
        // Existence beside the module is what distinguishes a bundled asset
        // from a path we merely compute, and it needs no allowlist to maintain.
        if (!existsSync(join(dirname(file), name!))) continue;
        referenced.add(`${relative(HERE, dirname(file))}/${name!}`.replace(/^\.\//, ''));
      }
    }

    const missing = [...referenced].filter((r) => !RUNTIME_ASSETS.includes(r));
    expect(missing, 'add these to RUNTIME_ASSETS in server/scripts/copy-assets.mjs').toEqual([]);
  });

  it('the manifest names files that actually exist', () => {
    // The other direction: a manifest entry for a file that has been deleted or
    // renamed makes the build fail loudly, which is fine — but it should fail
    // here first, where the message says what to do.
    for (const asset of RUNTIME_ASSETS) {
      expect(() => readFileSync(join(HERE, asset), 'utf8'), `${asset} is in the manifest but not in src`).not.toThrow();
    }
  });

  it('this guard can see a new asset — it is not matching nothing', () => {
    // The control. The regex is the whole guard, and one that matches nothing
    // reports a clean manifest forever.
    const sample = `const x = readFileSync(join(HERE, 'rules.yaml'), 'utf8');`;
    const found = [...sample.matchAll(/['"`]([\w./-]+\.(?:sql|json|pem|txt|csv|ya?ml))['"`]/g)].map((m) => m[1]);
    expect(found).toEqual(['rules.yaml']);
  });

  it('finds the two assets that exist, so the existence filter is not eating everything', () => {
    // The other half of the control. Narrowing to "files that sit beside the
    // source" is what stopped `graph.json` — an absolute path in the operator's
    // home — being treated as a bundled asset. A filter that narrowed too far
    // would report an empty manifest as correct, which is the same shape of
    // failure one step later.
    expect(existsSync(join(HERE, 'store/schema.sql'))).toBe(true);
    expect(existsSync(join(HERE, 'adapters/vendorstatus/vendors.json'))).toBe(true);
    expect(RUNTIME_ASSETS).toEqual(['store/schema.sql', 'adapters/vendorstatus/vendors.json']);
  });
});
