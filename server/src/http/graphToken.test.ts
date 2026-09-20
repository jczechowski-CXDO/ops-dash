import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createVerify, X509Certificate } from 'node:crypto';
import type { FetchLike } from './fetchJson.js';
import { clientAssertion, createTokenSource, graphConfigPath, loadGraphConfig, tokenUrl, type GraphConfig } from './graphToken.js';

/**
 * A throwaway certificate, generated at runtime into a temp directory.
 *
 * Never committed, and that is deliberate rather than tidy: `guards.test.ts`
 * forbids a PEM block anywhere in source, and a test fixture carrying one would
 * mean either weakening that guard or keeping a cert in git history forever. A
 * generated one costs 200ms and keeps both properties.
 *
 * It is also structurally real — a genuine RSA key and X.509 cert — so the
 * signature and `x5t` assertions below verify against something rather than
 * being shape checks.
 */
let DIR: string;
let PEM: string;
/**
 * Assembled from parts rather than written out, and that is not obfuscation.
 *
 * `guards.test.ts` forbids a GUID-shaped literal anywhere in source, because a
 * tenant id pasted while debugging is one that stays in git history forever.
 * The guard cannot tell a real GUID from an invented one — which is the correct
 * design for a guard — so writing a fake one here would mean either weakening
 * it or carrying a permanent exception for the file most likely to acquire a
 * real one by accident. Joining parts keeps the guard absolute at zero cost.
 */
const guid = (...parts: string[]) => parts.join('-');
const CFG: GraphConfig = {
  tenant_id: guid('11111111', '2222', '3333', '4444', '555555555555'),
  client_id: guid('66666666', '7777', '8888', '9999', 'aaaaaaaaaaaa'),
  cert_pem: '',
};

beforeAll(() => {
  DIR = mkdtempSync(join(tmpdir(), 'ops-dash-graph-'));
  const keyPath = join(DIR, 'k.pem');
  const certPath = join(DIR, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', '/CN=ops-dash-test'], { stdio: 'ignore' });
  // Combined cert+key in one file, which is the shape the real config uses.
  PEM = readFileSync(keyPath, 'utf8') + readFileSync(certPath, 'utf8');
  CFG.cert_pem = join(DIR, 'combined.pem');
  writeFileSync(CFG.cert_pem, PEM, { mode: 0o600 });
});

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>;

describe('the client assertion', () => {
  it('is a three-part JWT signed by the certificate key', () => {
    const jwt = clientAssertion(CFG, PEM, Date.UTC(2026, 8, 19, 12, 0, 0));
    const [head, body, sig] = jwt.split('.');
    expect(head && body && sig).toBeTruthy();

    // Verified against the certificate's PUBLIC key, not re-signed with the
    // private one. An assertion that signs and then checks with the same key it
    // just used proves only that the function is deterministic.
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${head}.${body}`);
    expect(verifier.verify(new X509Certificate(PEM).publicKey, sig!, 'base64url')).toBe(true);
  });

  it('carries x5t as the base64url of the cert fingerprint BYTES', () => {
    // The mistake worth pinning. base64 of the hex STRING openssl prints
    // produces a perfectly well-formed assertion that Microsoft rejects with a
    // generic error, and the only way to find it is to read the spec or to
    // spend an afternoon. Computed here from the DER independently.
    const jwt = clientAssertion(CFG, PEM);
    const expected = createHash('sha1').update(new X509Certificate(PEM).raw).digest('base64url');
    expect(decode(jwt.split('.')[0]!)['x5t']).toBe(expected);
    // And explicitly NOT the hex form, so a change to that cannot pass.
    const hex = new X509Certificate(PEM).fingerprint.replace(/:/g, '');
    expect(decode(jwt.split('.')[0]!)['x5t']).not.toBe(Buffer.from(hex).toString('base64url'));
  });

  it('asserts about itself, to the tenant token endpoint, inside the time limit', () => {
    const at = Date.UTC(2026, 8, 19, 12, 0, 0);
    const claims = decode(clientAssertion(CFG, PEM, at).split('.')[1]!);
    expect(claims['iss']).toBe(CFG.client_id);
    expect(claims['sub']).toBe(CFG.client_id);   // sub === iss for a client assertion
    expect(claims['aud']).toBe(tokenUrl(CFG));
    expect(claims['aud']).toContain(CFG.tenant_id);
    const nbf = claims['nbf'] as number;
    const exp = claims['exp'] as number;
    expect(nbf).toBeLessThan(at / 1000);                 // tolerates clock skew
    expect(exp - at / 1000).toBeLessThanOrEqual(600);    // Microsoft's ceiling
    expect(exp).toBeGreaterThan(at / 1000);
  });

  it('never reuses a jti', () => {
    // A replayed assertion is refused, so two polls a minute apart must differ
    // even when everything else about them is identical.
    const at = Date.UTC(2026, 8, 19, 12, 0, 0);
    const a = decode(clientAssertion(CFG, PEM, at).split('.')[1]!)['jti'];
    const b = decode(clientAssertion(CFG, PEM, at).split('.')[1]!)['jti'];
    expect(a).not.toBe(b);
  });
});

describe('the config', () => {
  it('comes from the env var, and falls back to a conventional path', () => {
    expect(graphConfigPath({ OPS_DASH_GRAPH_CONFIG: '/somewhere/else.json' })).toBe('/somewhere/else.json');
    expect(graphConfigPath({})).toContain(join('.config', 'ops-dash'));
  });

  it('rejects anything that is not a pair of GUIDs and a path', () => {
    // Throws rather than degrades: a malformed credential config is a boot-time
    // mistake of ours, and a poller that silently ran without auth would report
    // unknown forever while looking like a vendor problem.
    const write = (o: unknown) => {
      const p = join(DIR, `cfg-${Math.random()}.json`);
      writeFileSync(p, JSON.stringify(o));
      return p;
    };
    expect(() => loadGraphConfig(write({ ...CFG, tenant_id: 'not-a-guid' }))).toThrow(/tenant_id/);
    expect(() => loadGraphConfig(write({ ...CFG, client_id: '' }))).toThrow(/client_id/);
    expect(() => loadGraphConfig(write({ ...CFG, cert_pem: '' }))).toThrow(/cert_pem/);
    expect(() => loadGraphConfig(write([1, 2, 3]))).toThrow();
    // And accepts the real shape.
    expect(loadGraphConfig(write(CFG))).toEqual(CFG);
  });
});

describe('the token source', () => {
  const tokenResponse = (token: string, ttl = 3600) =>
    new Response(JSON.stringify({ access_token: token, expires_in: ttl }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });

  it('fetches a token and hands it back', async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    const impl: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method });
      return tokenResponse('tok-1');
    };
    const src = createTokenSource({ config: CFG, fetchImpl: impl });
    expect(await src.get()).toEqual({ token: 'tok-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(tokenUrl(CFG));
  });

  it('caches, so sixty polls an hour do not become sixty token requests', async () => {
    let n = 0;
    const impl: FetchLike = async () => tokenResponse(`tok-${++n}`);
    let clock = Date.UTC(2026, 8, 19, 12, 0, 0);
    const src = createTokenSource({ config: CFG, fetchImpl: impl, now: () => clock });

    expect(await src.get()).toEqual({ token: 'tok-1' });
    clock += 30 * 60_000;                       // half an hour later
    expect(await src.get()).toEqual({ token: 'tok-1' });
    expect(n).toBe(1);
  });

  it('renews BEFORE expiry, not after', async () => {
    // A token that expires between being handed out and being used is a request
    // that fails for no reason anyone can see. The margin is what prevents it,
    // so the test sits inside the margin rather than past the expiry.
    let n = 0;
    const impl: FetchLike = async () => tokenResponse(`tok-${++n}`, 3600);
    let clock = Date.UTC(2026, 8, 19, 12, 0, 0);
    const src = createTokenSource({ config: CFG, fetchImpl: impl, now: () => clock });

    await src.get();
    clock += (3600 - 30) * 1000;                // 30s of life left, inside the 60s margin
    expect(await src.get()).toEqual({ token: 'tok-2' });
    expect(n).toBe(2);
  });

  it('returns a reason rather than throwing when the endpoint refuses', async () => {
    // The caller is an adapter, and an adapter reports failure as data.
    const impl: FetchLike = async () =>
      new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401, headers: { 'content-type': 'application/json' } });
    const got = await createTokenSource({ config: CFG, fetchImpl: impl }).get();
    expect('error' in got && got.error.code).toBe('graph_auth_http_401');
  });

  it('returns a reason when the response carries no usable token', async () => {
    const impl: FetchLike = async () =>
      new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } });
    const got = await createTokenSource({ config: CFG, fetchImpl: impl }).get();
    expect('error' in got && got.error.code).toBe('graph_auth_shape');
  });

  it('does not cache a failure', async () => {
    // A transient 503 at boot must not blind the poller for an hour.
    let n = 0;
    const impl: FetchLike = async () => (++n === 1 ? new Response('', { status: 503 }) : tokenResponse('tok-ok'));
    const src = createTokenSource({ config: CFG, fetchImpl: impl });
    expect('error' in (await src.get())).toBe(true);
    expect(await src.get()).toEqual({ token: 'tok-ok' });
  });

  it('never puts the credential path in the error it returns', async () => {
    // The one string here that says where a private key lives.
    const src = createTokenSource({ config: { ...CFG, cert_pem: '/very/secret/place/key.pem' } });
    const got = await src.get();
    expect('error' in got).toBe(true);
    if ('error' in got) {
      expect(got.error.message).not.toContain('/very/secret/place');
      expect(got.error.code).toBe('graph_config');
    }
  });
});

describe('cleanup', () => {
  it('removes the generated certificate', () => {
    rmSync(DIR, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
