import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hornetConfigPath, loadHornetConfig } from './config.js';

/** A config file written into a temp directory, never into the repo. The
 *  values are obviously fabricated: a documentation host, the word 'stub'. */
function write(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'ops-dash-hornet-'));
  const path = join(dir, 'hornet.json');
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return path;
}

const GOOD = {
  base_url: 'https://cp.example.com/api/v0',
  token: 'stub-token',
  app_id: '1234567890',
  object_id: '99',
};

describe('where the credential lives', () => {
  it('prefers the environment variable', () => {
    expect(hornetConfigPath({ OPS_DASH_HORNET_CONFIG: '/somewhere/else.json' })).toBe('/somewhere/else.json');
  });

  it('falls back to the same conventional directory Graph already uses', () => {
    // The fallback is what actually runs on this box — no OPS_DASH_* variable is
    // set here and `graphToken.ts` has been running off its own fallback since
    // M3. Asserted as a shape rather than as an absolute path, because the path
    // contains a home directory and this assertion is committed.
    const path = hornetConfigPath({});
    expect(path.endsWith(join('.config', 'ops-dash', 'hornet.json'))).toBe(true);
  });
});

describe('the config is validated because every field of it is interpolated', () => {
  it('reads a well-formed file and strips a trailing slash from the base', () => {
    expect(loadHornetConfig(write({ ...GOOD, base_url: 'https://cp.example.com/api/v0/' }))).toEqual({
      baseUrl: 'https://cp.example.com/api/v0',
      token: 'stub-token',
      appId: '1234567890',
      objectId: '99',
    });
  });

  it('refuses a base that is not a public https target, at boot rather than on the first poll', () => {
    // `refuseTarget` is the SSRF floor and `fetchJson` applies it again on every
    // request. Applying it here too is not redundant: this one fails LOUDLY and
    // immediately, instead of a poller that looks healthy and reports unknown.
    for (const base of ['http://cp.example.com/api/v0', 'https://127.0.0.1/api/v0', 'https://localhost/api', 'not a url']) {
      expect(() => loadHornetConfig(write({ ...GOOD, base_url: base }))).toThrow(/base_url/);
    }
  });

  it('refuses a token that could not go in a header', () => {
    // A newline in a header value is a header-injection primitive. Checked as a
    // positive character class, because 'no newline' permits every other
    // control character nobody listed.
    expect(() => loadHornetConfig(write({ ...GOOD, token: `abc${String.fromCharCode(13, 10)}X-Evil: 1` }))).toThrow(/header/);
    expect(() => loadHornetConfig(write({ ...GOOD, token: 'abc def' }))).toThrow(/header/);
    expect(() => loadHornetConfig(write({ ...GOOD, token: '' }))).toThrow(/token/);
    expect(() => loadHornetConfig(write({ ...GOOD, token: 42 }))).toThrow(/token/);
  });

  it('refuses an app_id or object_id that is not a bare decimal', () => {
    // object_id selects the customer scope in the vendor's object hierarchy. An
    // injected `&` in a query parameter assembled by hand is how a request ends
    // up reading somebody else's tenant.
    for (const bad of ['99&object_id=1', '', 'abc', '9 9', 99]) {
      expect(() => loadHornetConfig(write({ ...GOOD, object_id: bad }))).toThrow(/object_id/);
      expect(() => loadHornetConfig(write({ ...GOOD, app_id: bad }))).toThrow(/app_id/);
    }
  });

  it('refuses a file that is not an object at all', () => {
    expect(() => loadHornetConfig(write('[]'))).toThrow(/not an object/);
    expect(() => loadHornetConfig(write('null'))).toThrow(/not an object/);
    expect(() => loadHornetConfig(write('nonsense'))).toThrow();
  });

  it('names the offending field without ever putting a value in the message', () => {
    // An exception message reaches a log and, one day, /api/health. It may say
    // WHICH field was wrong and must never say what was in it.
    const secret = 'a-real-looking-token-value';
    try {
      loadHornetConfig(write({ ...GOOD, token: `${secret}${String.fromCharCode(10)}` }));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(String(e)).toContain('token');
      expect(String(e)).not.toContain(secret);
    }
  });
});
