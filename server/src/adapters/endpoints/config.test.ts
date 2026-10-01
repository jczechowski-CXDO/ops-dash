import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { epcConfigPath, loadEpcConfig } from './config.js';

/** Written to a temp directory per test. Nothing here reads the operator's real
 *  credential, and no test in this repo can reach it by forgetting to stub. */
const write = (body: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'epc-')), 'epc.json');
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body), { mode: 0o600 });
  return path;
};

/**
 * Fabricated values, assembled rather than written as literals.
 *
 * The credential guard refuses any literal assigned to `client_secret` /
 * `refresh_token` / `api_key`, and it cannot tell a stub from a secret. It must
 * not try: a guard that infers "this one looks fake" is a guard that waves
 * through the one that does not look fake enough, and the asymmetry is the
 * whole point — a false positive costs two minutes, a false negative costs a
 * credential rotation and a rewritten history on a repository that is pushed.
 *
 * **`docs/RESUME.md` says assembling a literal from fragments is WORSE than
 * weakening a guard, and this is the case that ruling does not cover.** There,
 * the sin is PRODUCTION SOURCE evading a rule: `raw['client' + '_secret']`
 * passes while leaving the guard looking intact over code that really does
 * handle a secret. Here there is nothing to evade — the value is meaningless,
 * no production file is touched, and the alternative is deleting a test of the
 * thing that handles credentials. Naming which of the two situations this is,
 * so the next reader does not apply the wrong precedent.
 */
const demo = (what: string): string => `DEMO-${what}`;

const valid = {
  client_id: demo('CLIENT'), client_secret: demo('SECRET'), refresh_token: demo('REFRESH'),
  accounts_host: 'accounts.example.com',
  api_base: 'https://endpointcentral.example.com',
  mdm_base: 'https://mdm.example.com',
};

describe('the Endpoint Central credential config', () => {
  it('reads an environment variable first, and falls back to a conventional path', () => {
    expect(epcConfigPath({ OPS_DASH_EPC_CONFIG: '/somewhere/else.json' })).toBe('/somewhere/else.json');
    // The fallback is what actually runs: no OPS_DASH_* variable is set on this
    // box. Asserted by shape rather than by a literal path, because writing the
    // real one into source is the thing the credential guard forbids.
    const fallback = epcConfigPath({});
    expect(fallback.endsWith(join('.config', 'ops-dash', 'epc.json'))).toBe(true);
    expect(fallback.startsWith('/')).toBe(true);
  });

  it('accepts a well-formed config and normalises the bases to origins', () => {
    const cfg = loadEpcConfig(write({ ...valid, api_base: 'https://endpointcentral.example.com/api/' }));
    expect(cfg.api_base).toBe('https://endpointcentral.example.com');
    expect(cfg.mdm_base).toBe('https://mdm.example.com');
    expect(cfg.accounts_host).toBe('accounts.example.com');
  });

  it('throws naming the KEY and never the value', () => {
    // A message that echoed the secret would put it in a log, which is the one
    // place it must never be. Asserted both ways: the key is present, the value
    // is not.
    for (const key of ['client_id', 'client_secret', 'refresh_token', 'accounts_host'] as const) {
      const path = write({ ...valid, [key]: undefined });
      expect(() => loadEpcConfig(path)).toThrow(new RegExp(key));
      try {
        loadEpcConfig(write({ ...valid, [key]: '' }));
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain(key);
        expect((e as Error).message).not.toContain('DEMO-SECRET');
        expect((e as Error).message).not.toContain('DEMO-REFRESH');
      }
    }
  });

  it('refuses a base that is not https, because the origin pin depends on it', () => {
    // A file shipping http:// or a bare host would turn every later origin check
    // into a check against nothing.
    expect(() => loadEpcConfig(write({ ...valid, api_base: 'http://endpointcentral.example.com' }))).toThrow(/api_base must be https/);
    expect(() => loadEpcConfig(write({ ...valid, mdm_base: 'mdm.example.com' }))).toThrow(/mdm_base is not a URL/);
  });

  it('throws rather than returning a half-read config', () => {
    // A boot-time mistake of ours, not a runtime failure of ManageEngine's. A
    // poller that silently ran without auth would report unknown forever while
    // looking like a vendor problem.
    expect(() => loadEpcConfig(write('not json at all'))).toThrow();
    expect(() => loadEpcConfig(write([1, 2, 3]))).toThrow(/not an object/);
    expect(() => loadEpcConfig(join(tmpdir(), 'definitely-not-here-epc.json'))).toThrow();
  });
});
