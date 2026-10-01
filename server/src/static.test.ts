import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAsset } from './static.js';

/** A throwaway dist tree, plus a secret one beside it to escape into. */
function tree() {
  const dir = mkdtempSync(join(tmpdir(), 'ops-dash-static-'));
  const root = join(dir, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html>');
  writeFileSync(join(root, 'assets', 'app.js'), 'export {}');
  writeFileSync(join(dir, 'secret.txt'), 'not for the web');
  return { dir, root };
}

describe('resolveAsset', () => {
  it('serves a file that exists inside the root', () => {
    const { dir, root } = tree();
    expect(resolveAsset(root, '/assets/app.js')).toBe(join(root, 'assets', 'app.js'));
    expect(resolveAsset(root, '/index.html')).toBe(join(root, 'index.html'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses every traversal shape, including the encoded ones', () => {
    // The check compares RESOLVED paths, not the request string, because
    // `..%2f..%2fsecret.txt` and `/./../secret.txt` both look harmless before
    // resolution and neither is. Asserted against a file that really exists one
    // directory up, so a pass means the traversal was refused rather than that
    // the target happened to be missing.
    const { dir, root } = tree();
    for (const attempt of [
      '/../secret.txt',
      '/./../secret.txt',
      '/assets/../../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/....//secret.txt',
    ]) {
      expect(resolveAsset(root, attempt), `${attempt} was not refused`).toBeUndefined();
    }
    // The control: that file is genuinely there and readable by this process,
    // so the refusals above are the guard working and not a missing fixture.
    expect(resolveAsset(dir, '/secret.txt')).toBe(join(dir, 'secret.txt'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a malformed escape rather than throwing', () => {
    // `decodeURIComponent('%')` throws. A request is not a crash.
    const { dir, root } = tree();
    expect(resolveAsset(root, '/%')).toBeUndefined();
    expect(resolveAsset(root, '/%zz')).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a null byte', () => {
    const { dir, root } = tree();
    expect(resolveAsset(root, '/index.html%00.png')).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a directory, and a file that is not there', () => {
    const { dir, root } = tree();
    expect(resolveAsset(root, '/assets')).toBeUndefined();
    expect(resolveAsset(root, '/')).toBeUndefined();
    expect(resolveAsset(root, '/nope.js')).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores a query string', () => {
    const { dir, root } = tree();
    expect(resolveAsset(root, '/assets/app.js?v=abc123')).toBe(join(root, 'assets', 'app.js'));
    rmSync(dir, { recursive: true, force: true });
  });
});
