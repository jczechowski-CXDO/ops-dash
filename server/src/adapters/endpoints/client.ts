import { fetchJson, type FetchLike } from '../../http/fetchJson.js';

/**
 * Reading one Endpoint Central collection, page by page.
 *
 * Three things here are not general HTTP handling, and each was measured
 * against the live tenant rather than reasoned about.
 *
 * **1. A 200 is not a success. The envelope decides.** EPC answers a bad path
 * two different ways and `fetchJson` only covers one of them:
 *
 *     /api/1.4/desktop/computers   -> 200 with an HTML page
 *     /api/1.4/inventory/computers -> 200 with valid JSON:
 *       { "status": "error", "error_code": "10022",
 *         "error_description": "API Endpoint is not supported by current server." }
 *
 * The first is `fetchJson`'s `non_json_2xx` rule — the documented trap, and the
 * reason that rule exists at all. The second sails straight through as `data`,
 * **correctly**, because it is a vendor fact and not a transport one. So the
 * envelope check belongs here, and without it a wrong path reports a successful
 * poll of zero computers: the estate is empty, everything is compliant, nothing
 * needs patching.
 *
 * Nastier variant, same family: `?limit=100` instead of `?pagelimit=100` — a
 * typo'd PARAMETER NAME — also returns HTML under a 200. An unknown parameter
 * is indistinguishable from an outage without the non-JSON rule.
 *
 * **2. The page parameter is `pagelimit`, and 500 is accepted.** `limit` is not
 * a synonym, it is the typo above.
 *
 * **3. Paging is driven by `total`, not by a link.** There is no `nextLink`;
 * the response carries `{ total, limit, page }` beside the rows. 213 computers
 * fit one page today, which means **paging is invisible against the live estate
 * and can only be proven against a stub** — so it is, with more than one page.
 */

export type Row = Record<string, unknown>;

export type EpcRead =
  | { ok: true; rows: Row[]; total: number; pages: number; truncated: boolean }
  | { ok: false; error: { code: string; message: string } };

/** Rows per request. Measured: 500 is accepted, 999 is not the parameter's
 *  business here, and the default when omitted is 25 — small enough that
 *  forgetting it turns a 213-row estate into nine requests. */
export const PAGE_LIMIT = 500;

/** Pages to follow before giving up. Ten at 500 rows is 5,000 endpoints against
 *  an estate of 213: generous, and bounded so one bad answer cannot turn a poll
 *  into a download. */
export const MAX_PAGES = 10;

const asRecord = (v: unknown): Row | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row) : null;

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Read every page of one collection.
 *
 * `key` is the property inside `message_response` that holds the rows —
 * `computers`, `allsystems`, `bitlockerreports`. It is passed rather than
 * guessed because EPC names it differently per endpoint, and a guess that
 * missed would return an empty estate rather than an error.
 */
/**
 * The envelope check, in one place.
 *
 * Published rather than duplicated because it is needed twice — once per page of
 * a collection, and once for `patch/summary`, which answers with a single object
 * and does not go through the pager. A mutation battery found the two copies:
 * breaking the check here left the summary's own copy passing, which is the
 * shape of every drift this project has paid for. Two correct copies diverge the
 * moment either premise moves, and the premise here is a vendor's error format.
 *
 * Returns the `message_response` on success, or the reason it is not one.
 */
export function readEnvelope(data: unknown, what: string): { ok: true; response: Row } | { ok: false; error: { code: string; message: string } } {
  const body = asRecord(data);
  if (body?.['status'] !== 'success') {
    // The 200-carrying-an-error case. Named with EPC's own code so an operator
    // can look it up, and never reported as zero rows.
    const code = typeof body?.['error_code'] === 'string' ? body['error_code'] : 'unknown';
    const detail = typeof body?.['error_description'] === 'string' ? body['error_description'] : 'no description';
    return { ok: false, error: { code: `epc_envelope_${code}`, message: `${what}: ${detail}` } };
  }
  const response = asRecord(body['message_response']);
  if (response === null) {
    return { ok: false, error: { code: 'epc_shape', message: `${what}: a successful envelope carried no message_response` } };
  }
  return { ok: true, response };
}

export async function readAll(
  base: string,
  path: string,
  key: string,
  token: string,
  fetchImpl: FetchLike | undefined,
  opts: { maxPages?: number; pageLimit?: number } = {},
): Promise<EpcRead> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const pageLimit = opts.pageLimit ?? PAGE_LIMIT;

  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return { ok: false, error: { code: 'epc_bad_base', message: 'the configured API base is not a parseable URL' } };
  }

  const rows: Row[] = [];
  let total = 0;

  for (let page = 1; ; page += 1) {
    if (page > maxPages) return { ok: true, rows, total, pages: page - 1, truncated: true };

    const url = `${base}${path}${path.includes('?') ? '&' : '?'}pagelimit=${pageLimit}&page=${page}`;
    // Every request carries a tenant-wide access token, so the origin is pinned
    // even though we built this URL ourselves: a config change must not be able
    // to redirect the credential somewhere new without failing loudly here.
    if (new URL(url).origin !== origin) {
      return { ok: false, error: { code: 'epc_foreign_origin', message: 'a request was built for an origin other than the configured API base' } };
    }

    const result = await fetchJson<unknown>(url, {
      headers: { authorization: `Zoho-oauthtoken ${token}` },
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    if (result.error !== undefined) {
      return { ok: false, error: { code: `epc_${result.error.code}`, message: `${path}: ${result.error.message}` } };
    }

    const envelope = readEnvelope(result.data, path);
    if (!envelope.ok) return envelope;
    const { response } = envelope;
    const value = response[key];
    if (!Array.isArray(value)) {
      // A collection whose row key is missing is a shape we do not recognise,
      // not an empty estate. `total: 0` with no rows is a legitimate answer and
      // arrives through the branch below; this is the one that is not.
      return { ok: false, error: { code: 'epc_shape', message: `${path}: no '${key}' array in message_response` } };
    }
    for (const entry of value) {
      const row = asRecord(entry);
      if (row === null) return { ok: false, error: { code: 'epc_shape', message: `${path}: a row in '${key}' was not an object` } };
      rows.push(row);
    }

    // `total` is the collection size, echoed on every page. Trusted for the
    // loop condition and cross-checked afterwards by the caller, which is the
    // only reason a short read can be told from a small estate.
    total = asNumber(response['total']) ?? rows.length;
    if (rows.length >= total || value.length === 0) {
      return { ok: true, rows, total, pages: page, truncated: false };
    }
  }
}
