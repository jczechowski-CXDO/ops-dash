import type { EndpointIssue } from '@ops-dash/shared';
import type { Row } from './client.js';

/**
 * The Endpoint Central paths this adapter reads, and the pure readings over
 * them.
 *
 * Endpoint Central rather than Intune, which is a standing decision and one the
 * measurement confirmed rather than merely inherited: Intune's
 * `deviceManagement/managedDevices` holds **16** devices on this tenant, against
 * an EPC estate of **213**. An Endpoints screen built on Graph would have
 * rendered `total: 16` — precise, internally consistent, and wrong by a factor
 * of thirteen.
 *
 * Every path below returns `{ status, message_response }` and answers a bad
 * request with HTTP 200 either way, so `client.ts` checks the envelope. See its
 * comment; that is where the trap lives.
 */

export const COMPUTERS = { path: '/api/1.4/som/computers', key: 'computers' } as const;
export const PATCH_SYSTEMS = { path: '/api/1.4/patch/allsystems', key: 'allsystems' } as const;
export const BITLOCKER = { path: '/api/1.4/bitlocker/bitlockerreports', key: 'bitlockerreports' } as const;

/** The estate-wide patch rollup. Not a collection — it answers with a single
 *  `summary` object and no `total`, so it is fetched directly rather than
 *  through the pager. */
export const PATCH_SUMMARY = '/api/1.4/patch/summary';

export const DAY_MS = 24 * 60 * 60 * 1000;
/** `checkedIn7d` in the contract. */
export const CHECKIN_WINDOW_DAYS = 7;
/** Section 7's `stale` rule: "no check-in for 21 days". The attention list uses
 *  the same number so the screen and the rule cannot disagree about what stale
 *  means. */
export const STALE_AGENT_DAYS = 21;

/**
 * How many rows the attention list carries.
 *
 * 150 computers are missing at least one Microsoft patch on this tenant. A list
 * of 150 is not an attention list, it is an inventory — and a screen the
 * operator scrolls past is the same failure as a permanently-red tile. Ten,
 * worst first.
 */
export const ATTENTION_LIMIT = 10;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' && v !== '--' ? v : undefined;

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * EPC timestamps are epoch **milliseconds as a number**, not ISO strings.
 * `undefined` rather than `NaN` and never "now": 2 of 213 computers carry no
 * readable `agent_last_contact_time`, and a parser that shrugged would report
 * them as freshly checked in — the reassuring direction.
 */
export function instant(v: unknown): number | undefined {
  const n = asNumber(v);
  return n !== undefined && n > 0 ? n : undefined;
}

/**
 * Who a computer belongs to.
 *
 * Measured: `owner_email_id` is populated on **2 of 213** rows, so it is not the
 * field despite its name. `agent_logged_on_users` covers 145 of 213, which
 * leaves 68 machines with nobody attributable — shared, lab and kiosk hardware,
 * mostly.
 *
 * `EndpointIssue.assignedTo` is a required `string` with nowhere to put
 * "absent", so the absence is rendered in words. A real name would be an
 * invention and an empty cell reads as a rendering bug; `'unattributed'` says
 * the true thing, which is that EPC does not know either.
 */
export function assignedTo(row: Row): string {
  return asString(row['agent_logged_on_users']) ?? asString(row['owner_email_id']) ?? 'unattributed';
}

export const computerName = (row: Row): string => asString(row['resource_name']) ?? asString(row['full_name']) ?? 'unknown';
export const osName = (row: Row): string => asString(row['os_name']) ?? asString(row['os_platform_name']) ?? 'unknown';

/* ------------------------------------------------------------ the readings */

/**
 * Computers seen inside the check-in window.
 *
 * **A missing check-in time is two different facts and only one of them is a
 * hole.** The first version counted every unreadable timestamp as unreadable
 * and marked the whole snapshot `degraded`, which on the live estate fired on
 * **every single poll** — 2 of 213 computers have no last-contact time, and
 * they always will. A provenance note that is permanently on is a note nobody
 * reads, which is the same failure as a permanently-red tile arriving from a
 * quieter direction.
 *
 * Measured, which is what separates the two facts: **both** of those machines
 * also have no `agent_installed_on`. Their agent was never installed, so they
 * have never contacted anything — "not checked in" is the *correct* answer for
 * them, not an approximation, and `checkedIn7d` is exact rather than a lower
 * bound. (The converse does not hold: 3 computers lack an install time and one
 * of them has contacted, so the sets are not interchangeable and this tests the
 * one direction that was actually measured.)
 *
 * A computer with no contact time that DOES have an install time is the real
 * anomaly — an agent that exists and has never spoken — and that one still
 * counts as unreadable and still degrades the snapshot. Today there are none,
 * which is why the live poll is now clean.
 */
export function checkedInWithin(
  rows: Row[],
  now: number,
  days = CHECKIN_WINDOW_DAYS,
): { count: number; neverInstalled: number; unreadable: number } {
  let count = 0;
  let neverInstalled = 0;
  let unreadable = 0;
  for (const row of rows) {
    const t = instant(row['agent_last_contact_time']);
    if (t === undefined) {
      if (instant(row['agent_installed_on']) === undefined) neverInstalled += 1;
      else unreadable += 1;
      continue;
    }
    if (now - t <= days * DAY_MS) count += 1;
  }
  return { count, neverInstalled, unreadable };
}

/**
 * Computers whose **operating-system volume** is encrypted.
 *
 * Folded drives to computers, because the report is per-drive: 136 rows over
 * 132 computers, of which 4 rows are data volumes (`volume_type` 1). Only the
 * OS volume answers "is this machine encrypted".
 *
 * **What this number is NOT is a fraction of the estate.** 81 of the 213
 * computers have no BitLocker record at all — ManageEngine's own documentation
 * says the status appears only after an inventory scan — so absence here means
 * *not scanned*, not *not encrypted*. Measured: 130 encrypted, **2**
 * affirmatively unencrypted, 81 unknown. Rendering 130/213 would announce that
 * 39% of the estate is unencrypted when the measured truth is two known-bad
 * machines; that is a false number in the alarming direction, which this
 * project treats as no better than a false green. `EndpointSnapshot.stats` has
 * no field for the unknown 81, so the count travels alone and the screen must
 * never divide it by `total`.
 */
export function encryptedComputers(rows: Row[]): { encrypted: number; knownUnencrypted: number; scanned: number } {
  const encrypted = new Set<string>();
  const unencrypted = new Set<string>();
  const scanned = new Set<string>();
  for (const row of rows) {
    const id = asString(row['resource_id_string']) ?? String(asNumber(row['resource_id']) ?? '');
    if (id === '') continue;
    scanned.add(id);
    // `volume_type` 0 is the OS volume. A data volume left unencrypted is a
    // different finding and not this one.
    if (String(row['volume_type']) !== '0') continue;
    if (String(row['encryption_status']) === '1') encrypted.add(id);
    else unencrypted.add(id);
  }
  return { encrypted: encrypted.size, knownUnencrypted: unencrypted.size, scanned: scanned.size };
}

/**
 * The attention list: the three issue kinds EPC can actually answer.
 *
 * **`eol_build` is deliberately absent.** `os_version` gives builds and
 * `os_name` gives product names, but nothing in EPC says a build is
 * end-of-life. That judgement needs a maintained build-to-end-of-support table
 * which this repository would own and which **goes stale silently** — a tile
 * that stops flagging EOL machines because nobody updated a constant is exactly
 * the failure class this project keeps paying for. A list can express absence
 * and a required number cannot, so the kind gets no rows rather than wrong ones.
 *
 * **Round-robin across the kinds, not sorted by kind — and that is a finding
 * from running it rather than a preference.** The first version ranked stale
 * agents above unencrypted machines above missing patches and took the worst
 * ten. Against the live estate it returned **ten stale agents and nothing
 * else**, because there are 22 of them: the two unencrypted machines and every
 * missing-patch row were pushed off the screen by a kind that merely happens to
 * be more numerous. No fixture would have caught that — it needs an estate
 * where one kind exceeds the whole limit.
 *
 * So each kind gets its turn, worst-first within the kind, and the order of the
 * kinds decides who goes first rather than who appears at all. An attention
 * list that silently omits an entire class of problem is worse than a shorter
 * one, because the operator cannot tell the difference between "no unencrypted
 * machines" and "unencrypted machines did not fit".
 */
export function attentionRows(
  computers: Row[],
  patchByResource: Map<string, Row>,
  bitlocker: Row[],
  now: number,
  limit = ATTENTION_LIMIT,
): EndpointIssue[] {
  const unencrypted = new Set<string>();
  for (const row of bitlocker) {
    if (String(row['volume_type']) !== '0' || String(row['encryption_status']) === '1') continue;
    const id = asString(row['resource_id_string']) ?? String(asNumber(row['resource_id']) ?? '');
    if (id !== '') unencrypted.add(id);
  }

  type Ranked = { issue: EndpointIssue; rank: number; magnitude: number };
  const out: Ranked[] = [];

  for (const row of computers) {
    const id = asString(row['resource_id_string']) ?? String(asNumber(row['resource_id']) ?? '');
    const seen = instant(row['agent_last_contact_time']);
    const base = {
      computer: computerName(row),
      assignedTo: assignedTo(row),
      os: osName(row),
      // A computer with no readable check-in still deserves a row; the contract
      // needs an ISO string, so the epoch is used and the absence shows as 1970
      // rather than as today. Wrong-and-obvious beats wrong-and-plausible.
      lastCheckIn: new Date(seen ?? 0).toISOString(),
    };

    if (seen !== undefined && now - seen > STALE_AGENT_DAYS * DAY_MS) {
      const days = Math.floor((now - seen) / DAY_MS);
      out.push({ issue: { ...base, issue: `Agent stale · ${days} days`, issueKind: 'stale_agent' }, rank: 0, magnitude: days });
      continue;
    }
    if (unencrypted.has(id)) {
      out.push({ issue: { ...base, issue: 'BitLocker not enabled', issueKind: 'no_bitlocker' }, rank: 1, magnitude: 1 });
      continue;
    }
    const missing = asNumber(patchByResource.get(id)?.['missing_ms_patches']) ?? 0;
    if (missing > 0) {
      out.push({
        issue: { ...base, issue: `${missing} missing patch${missing === 1 ? '' : 'es'}`, issueKind: 'missing_patches' },
        rank: 2,
        magnitude: missing,
      });
    }
  }

  // Worst-first inside each kind...
  const byKind = new Map<number, Ranked[]>();
  for (const r of out) {
    const bucket = byKind.get(r.rank) ?? [];
    bucket.push(r);
    byKind.set(r.rank, bucket);
  }
  for (const bucket of byKind.values()) bucket.sort((a, b) => b.magnitude - a.magnitude);

  // ...then one from each kind in turn, so no kind can be crowded out.
  const kinds = [...byKind.keys()].sort((a, b) => a - b).map((k) => byKind.get(k)!);
  const picked: EndpointIssue[] = [];
  for (let round = 0; picked.length < limit; round += 1) {
    let tookAny = false;
    for (const bucket of kinds) {
      const next = bucket[round];
      if (next === undefined) continue;
      picked.push(next.issue);
      tookAny = true;
      if (picked.length === limit) break;
    }
    if (!tookAny) break;
  }
  return picked;
}
