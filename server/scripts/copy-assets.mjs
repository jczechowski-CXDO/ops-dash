import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy the non-TypeScript files the server reads at runtime into `dist/`.
 *
 * `tsc` emits TypeScript and nothing else, so a build without this produces an
 * artefact that typechecks, compiles, and then dies on its first line with
 * ENOENT. That is exactly what happened the first time the server was started
 * as a process — twice, once per asset.
 *
 * The manifest lives in `runtime-assets.json` so that this script and the test
 * that checks it read the same source and cannot drift. `assets.test.ts` greps
 * the source for files read from beside a module and fails if one is missing —
 * a list maintained by hand goes stale the moment somebody adds a config file,
 * and the symptom is a build that only fails in production.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const RUNTIME_ASSETS = JSON.parse(
  readFileSync(join(HERE, 'runtime-assets.json'), 'utf8'),
).assets;
const SRC = resolve(HERE, '..', 'src');
const DIST = resolve(HERE, '..', 'dist');

if (import.meta.url === `file://${process.argv[1]}`) {
  let copied = 0;
  for (const asset of RUNTIME_ASSETS) {
    const from = join(SRC, asset);
    const to = join(DIST, asset);
    if (!existsSync(from)) {
      console.error(`copy-assets: ${asset} does not exist in src — the manifest is wrong`);
      process.exit(1);
    }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied += 1;
  }
  console.log(`copy-assets: ${copied} runtime asset${copied === 1 ? '' : 's'} into dist/`);
}
