import type { EndpointSnapshot, SourceResult } from '@ops-dash/shared';
import { fetchJson, type FetchLike } from '../../http/fetchJson.js';
import { readAll, readEnvelope, type EpcRead, type Row } from './client.js';
import type { EpcTokenSource } from './token.js';
import {
  BITLOCKER,
  COMPUTERS,
  PATCH_SUMMARY,
  PATCH_SYSTEMS,
  attentionRows,
  checkedInWithin,
  encryptedComputers,
} from './queries.js';

/**
 * The Endpoints snapshot, read from ManageEngine Endpoint Central Cloud.
 *
 * Shaped after `adapters/entra/index.ts` and for the same reasons: failure is
 * returned as data rather than thrown, every request goes out through
 * `http/fetchJson.ts`, and **`stats` is all-or-nothing**. Five required numbers
 * with nowhere in the frozen contract to write "we could not look", and a zero
 * on this screen reads as good news — no endpoints, nothing missing patches,
 * nothing unencrypted. So any failed constituent read returns `error` with no
 * `data`, naming which question went unanswered.
 *
 * Read-only throughout: every request is a GET, and the Zoho credential is a
 * read scope.
 *
 * **Sequential, not parallel.** Four requests, and the token is minted once for
 * all of them — the refresh token allows ten access tokens per ten minutes,
 * which is a limit on minting rather than on requests, so the cache in
 * `token.ts` is what makes any of this safe. Firing the reads concurrently
 * would race the first four callers into four mints of the same token.
 */

export type EndpointsPollOptions = {
  tokens: EpcTokenSource;
  /** The configured API base, passed in rather than read here so this module
   *  never learns where the credential file is. */
  apiBase: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  maxPages?: number;
};

const asRecord = (v: unknown): Row | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row) : null;

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export async function pollEndpoints(opts: EndpointsPollOptions): Promise<SourceResult<EndpointSnapshot>> {
  const nowDate = (opts.now ?? (() => new Date()))();
  const fetchedAt = nowDate.toISOString();
  const now = nowDate.getTime();

  const auth = await opts.tokens.get();
  if ('error' in auth) {
    return {
      fetchedAt,
      degraded: false,
      error: {
        code: auth.error.code,
        message: `We could not authenticate to Endpoint Central (${auth.error.code}), so nothing about the estate was read.`,
      },
    };
  }

  let failure: { code: string; message: string } | undefined;
  const truncated: string[] = [];

  const read = async (what: string, spec: { path: string; key: string }): Promise<Row[]> => {
    if (failure) return [];
    const result: EpcRead = await readAll(opts.apiBase, spec.path, spec.key, auth.token, opts.fetchImpl, {
      ...(opts.maxPages === undefined ? {} : { maxPages: opts.maxPages }),
    });
    if (!result.ok) {
      failure = { code: result.error.code, message: `${what}: ${result.error.message}` };
      return [];
    }
    if (result.truncated) truncated.push(what);
    // The cross-check that makes a short read visible. `total` is EPC's own
    // count of the collection; if we walked fewer rows than that without
    // hitting the page budget, something ended the loop early and the numbers
    // built from it are all too small.
    if (!result.truncated && result.rows.length < result.total) {
      failure = {
        code: 'epc_short_read',
        message: `${what}: read ${result.rows.length} of ${result.total} rows without reaching the page budget`,
      };
      return [];
    }
    return result.rows;
  };

  const computers = await read('managed computers', COMPUTERS);
  const patches = await read('per-system patch status', PATCH_SYSTEMS);
  const bitlocker = await read('BitLocker drive reports', BITLOCKER);

  // The estate rollup is a single object, not a collection, so it does not go
  // through the pager.
  let summary: Row | null = null;
  if (!failure) {
    const result = await fetchJson<unknown>(`${opts.apiBase}${PATCH_SUMMARY}`, {
      headers: { authorization: `Zoho-oauthtoken ${auth.token}` },
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    if (result.error !== undefined) {
      failure = { code: `epc_${result.error.code}`, message: `patch summary: ${result.error.message}` };
    } else {
      // The SAME envelope check the pager uses, imported rather than repeated —
      // a mutation battery found two copies of it and two copies of a vendor's
      // error format diverge the moment the vendor changes it.
      const envelope = readEnvelope(result.data, 'patch summary');
      if (!envelope.ok) {
        failure = envelope.error;
      } else {
        summary = asRecord(envelope.response['summary']);
        if (summary === null) failure = { code: 'epc_shape', message: 'patch summary: no summary object' };
      }
    }
  }

  const systemSummary = asRecord(summary?.['system_summary']);
  const severitySummary = asRecord(summary?.['missing_patch_severity_summary']);
  const healthy = asNumber(systemSummary?.['healthy_systems']);
  const scanned = asNumber(systemSummary?.['total_systems']);
  const critical = asNumber(severitySummary?.['critical_count']);

  if (!failure && (healthy === undefined || scanned === undefined || critical === undefined)) {
    failure = { code: 'epc_shape', message: 'patch summary: healthy_systems, total_systems or critical_count was missing' };
  }
  if (!failure && scanned === 0) {
    // 0/0 is NaN and "0 healthy of 0" is not 100% compliance. Either would reach
    // the screen as a number.
    failure = { code: 'epc_empty', message: 'patch summary: no systems were scanned, so compliance cannot be computed' };
  }

  if (failure !== undefined) {
    return {
      fetchedAt,
      degraded: false,
      error: {
        code: failure.code,
        message:
          `We could not read Endpoint Central (${failure.message}). No figures are shown rather than partial ones, ` +
          `because a missing count on this screen reads as good news.`,
      },
    };
  }

  const checkIn = checkedInWithin(computers, now);
  const locker = encryptedComputers(bitlocker);
  const patchByResource = new Map<string, Row>();
  for (const row of patches) {
    const id = typeof row['resource_id_string'] === 'string' ? row['resource_id_string'] : String(asNumber(row['resource_id']) ?? '');
    if (id !== '') patchByResource.set(id, row);
  }

  const data: EndpointSnapshot = {
    stats: {
      // EPC's own count of managed computers. Deliberately NOT the patch
      // module's `total_systems`, which is 210 against 213 — the difference is
      // real (2 agents yet to install, 1 failed) and a computer whose agent
      // failed to install is still an endpoint. Hiding it would be the
      // flattering direction.
      total: computers.length,
      patchCompliance: healthy! / scanned!,
      checkedIn7d: checkIn.count,
      // A COUNT, never a fraction of `total`. See `encryptedComputers`.
      bitlockerEncrypted: locker.encrypted,
      /**
       * EPC's own severity classification of missing patches.
       *
       * **The ruling was 34 and I am implementing 34, but the cross-check it
       * rested on has since failed and that is recorded here rather than
       * buried.** Four numbers describe this estate and they are all real:
       *
       *   34   patch/summary.missing_patch_severity_summary.critical_count
       *   49   sum of per-system `critical_patch_count`
       *   117  sum of per-system `important_patch_count`
       *   483  sum of per-system `missing_ms_patches`
       *
       * 34 and 49 differ because the first counts distinct critical patches and
       * the second counts (system, patch) pairs — one patch missing on three
       * machines is 1 and 3 respectively. The contract's field is
       * `criticalPatchesMissing` and this is EPC's own classification of
       * exactly that, which is why it wins; but anyone reconciling this tile
       * against the EPC console will meet 49 and should find this comment
       * rather than rediscover the fork.
       */
      criticalPatchesMissing: critical!,
    },
    attention: attentionRows(computers, patchByResource, bitlocker, now),
  };

  const reasons: string[] = [];
  if (truncated.length > 0) reasons.push(`hit the page budget on: ${truncated.join(', ')}`);
  if (checkIn.unreadable > 0) reasons.push(`${checkIn.unreadable} computer(s) carry no readable last-contact time`);
  if (reasons.length > 0) {
    return { data, fetchedAt, degraded: true, error: { code: 'epc_partial', message: `These counts are lower bounds: ${reasons.join('; ')}.` } };
  }
  return { data, fetchedAt, degraded: false };
}
