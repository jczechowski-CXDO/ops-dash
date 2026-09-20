import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, createSign, randomUUID, X509Certificate } from 'node:crypto';
import { fetchJson, type FetchLike } from './fetchJson.js';

/**
 * Microsoft Graph app-only auth, by certificate.
 *
 * **No MSAL.** The client-credentials flow with a certificate is a signed JWT
 * and one form POST, which is what this file is — about forty lines against
 * `node:crypto`. Adding a dependency tree to this repo for it would cost more
 * than it saves, and the rule that there are no runtime external dependencies
 * is one of the reasons the M1 offline proof holds.
 *
 * **No credential is transcribed here, and no path to one either.** The config
 * location comes from `OPS_DASH_GRAPH_CONFIG`, falling back to a conventional
 * XDG-ish directory under the user's home. What that file contains, and where
 * the key beside it lives, this file learns at runtime and never records.
 *
 * The token goes out over `fetchJson` like every other request, so the four
 * failure rules, the 5 MB cap and the SSRF floor all apply to the single most
 * security-sensitive call this process makes. `fetchJson` also refuses to
 * follow a redirect on a POST, which matters here specifically: the body is a
 * signed assertion, and a `Location` header must never get to choose who
 * receives it.
 */

export type GraphConfig = {
  tenant_id: string;
  client_id: string;
  /** Path to a PEM holding the certificate AND its private key. */
  cert_pem: string;
};

/** Where the config lives. An env var first, so nothing is baked in. */
export function graphConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['OPS_DASH_GRAPH_CONFIG'] ?? join(homedir(), '.config', 'ops-dash', 'graph.json');
}

/**
 * Read and validate the config. Throws, because a malformed credential config
 * is a boot-time mistake of ours rather than a runtime failure of Microsoft's —
 * and a poller that silently ran without auth would report `unknown` forever
 * while looking like a vendor problem.
 *
 * The GUID shapes are validated because they are interpolated into a URL.
 */
export function loadGraphConfig(path = graphConfigPath()): GraphConfig {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null) throw new Error(`${path}: not an object`);
  const { tenant_id, client_id, cert_pem } = raw as Record<string, unknown>;
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof tenant_id !== 'string' || !guid.test(tenant_id)) throw new Error(`${path}: tenant_id is not a GUID`);
  if (typeof client_id !== 'string' || !guid.test(client_id)) throw new Error(`${path}: client_id is not a GUID`);
  if (typeof cert_pem !== 'string' || cert_pem.length === 0) throw new Error(`${path}: cert_pem must be a path`);
  return { tenant_id, client_id, cert_pem };
}

/** Build the signed client assertion. Exported for its own test: this is the
 *  one piece here with no observable behaviour until Microsoft rejects it. */
export function clientAssertion(cfg: GraphConfig, pem: string, now = Date.now()): string {
  const cert = new X509Certificate(pem);
  // x5t is the base64url of the certificate's SHA-1 fingerprint BYTES. The
  // obvious wrong version — base64 of the hex STRING openssl prints — produces
  // a well-formed assertion that Microsoft rejects with a generic error.
  const x5t = createHash('sha1').update(cert.raw).digest('base64url');
  const seconds = Math.floor(now / 1000);
  const aud = tokenUrl(cfg);
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT', x5t });
  // `sub` equals `iss` for a client assertion: the app is asserting about
  // itself. `jti` must be unique — a replayed one is refused.
  const payload = b64({
    aud,
    iss: cfg.client_id,
    sub: cfg.client_id,
    jti: randomUUID(),
    nbf: seconds - 60,       // a minute of clock skew
    exp: seconds + 540,      // nine, well inside Microsoft's ten-minute ceiling
  });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(pem, 'base64url')}`;
}

export const tokenUrl = (cfg: GraphConfig): string =>
  `https://login.microsoftonline.com/${cfg.tenant_id}/oauth2/v2.0/token`;

type Cached = { token: string; expiresAt: number };

/**
 * A token, cached until shortly before it expires.
 *
 * Cached because the poller runs every minute and a token lasts an hour:
 * without this we would ask Microsoft for sixty tokens an hour to make sixty
 * requests, which is both rude and a good way to get throttled. The 60-second
 * margin is so a token cannot expire between being handed out and being used.
 */
export function createTokenSource(opts: { config?: GraphConfig; fetchImpl?: FetchLike; now?: () => number } = {}) {
  let cached: Cached | undefined;

  return {
    /** `undefined` on failure, never a throw — the caller is an adapter, and an
     *  adapter reports failure as data. The reason is returned alongside so it
     *  can reach the tile rather than a log nobody reads. */
    async get(): Promise<{ token: string } | { error: { code: string; message: string } }> {
      const now = opts.now ?? Date.now;
      if (cached && cached.expiresAt > now() + 60_000) return { token: cached.token };

      let cfg: GraphConfig;
      let pem: string;
      try {
        cfg = opts.config ?? loadGraphConfig();
        pem = readFileSync(cfg.cert_pem, 'utf8');
      } catch (cause) {
        // Deliberately does not echo the path. It is the one string here that
        // says where a private key lives.
        return { error: { code: 'graph_config', message: `could not read the Graph credential config: ${(cause as Error).name}` } };
      }

      const result = await fetchJson<{ access_token?: unknown; expires_in?: unknown; error_description?: unknown }>(
        tokenUrl(cfg),
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: cfg.client_id,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
            client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion: clientAssertion(cfg, pem, now()),
          }).toString(),
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        },
      );

      if (result.error) return { error: { code: `graph_auth_${result.error.code}`, message: result.error.message } };
      const token = result.data?.access_token;
      const ttl = result.data?.expires_in;
      if (typeof token !== 'string' || typeof ttl !== 'number') {
        return { error: { code: 'graph_auth_shape', message: 'the token endpoint returned no usable access_token' } };
      }

      cached = { token, expiresAt: now() + ttl * 1000 };
      return { token };
    },

    /** Test seam only: forget the cached token. */
    reset(): void {
      cached = undefined;
    },
  };
}

export type TokenSource = ReturnType<typeof createTokenSource>;
