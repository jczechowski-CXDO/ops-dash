import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../http/fetchJson.js';
import type { EpcTokenSource } from './token.js';
import { pollEndpoints } from './index.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const fx = (name: string): unknown => JSON.parse(readFileSync(join(HERE, '__fixtures__', name), 'utf8'));

const PAGE1 = fx('computers-page1.json');
const PAGE2 = fx('computers-page2.json');
const PATCHES = fx('patch-allsystems.json');
const SUMMARY = fx('patch-summary.json');
const LOCKER = fx('bitlocker.json');

const BASE = 'https://endpointcentral.example.com';
const NOW = new Date('2026-09-20T12:00:00Z');

const goodToken = (): EpcTokenSource => ({ get: async () => ({ token: 'stub-token' }), reset: () => {} });
const failingToken = (): EpcTokenSource =>
  ({ get: async () => ({ error: { code: 'epc_config', message: 'no credential' } }), reset: () => {} });

type Route = [match: (url: string) => boolean, body: unknown];

function routes(over: Route[] = []): Route[] {
  const has = (...parts: string[]) => (url: string) => parts.every((p) => url.includes(p));
  return [
    ...over,
    [has('som/computers', 'page=1'), PAGE1],
    [has('som/computers', 'page=2'), PAGE2],
    [has('patch/allsystems'), PATCHES],
    [has('patch/summary'), SUMMARY],
    [has('bitlocker/bitlockerreports'), LOCKER],
  ];
}

function serve(table: Route[]): { impl: FetchLike; misses: string[] } {
  const misses: string[] = [];
  const impl: FetchLike = async (url) => {
    for (const [match, body] of table) {
      if (!match(url)) continue;
      if (body === null) return new Response('upstream said no', { status: 503 });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    misses.push(url);
    return new Response('{}', { status: 404 });
  };
  return { impl, misses };
}

const poll = (table: Route[]) => {
  const { impl, misses } = serve(table);
  return pollEndpoints({ tokens: goodToken(), apiBase: BASE, fetchImpl: impl, now: () => NOW }).then((r) => ({ r, misses }));
};

describe('the Endpoints snapshot, end to end over a stubbed EPC', () => {
  it('every stat is the hand-counted figure, and no request went unrouted', async () => {
    const { r, misses } = await poll(routes());
    expect(misses).toEqual([]);
    // Counted by eye off the fixtures, not computed with anything the adapter
    // uses: 5 computers across two pages; healthy 3 of 4 scanned = 0.75;
    // checked in within 7 days = 2 (1 day and 3 days ago); OS volumes
    // encrypted = 2; summary critical_count = 7.
    expect(r.data?.stats).toEqual({
      total: 5,
      patchCompliance: 0.75,
      checkedIn7d: 2,
      bitlockerEncrypted: 2,
      criticalPatchesMissing: 7,
    });
  });

  it('reads BOTH pages — page one alone would say 3 computers', async () => {
    const { r } = await poll(routes());
    expect(r.data?.stats.total).toBe(5);
    const onePage = await poll(routes([[(u) => u.includes('som/computers') && u.includes('page=2'),
      { status: 'success', message_response: { total: 5, computers: [] } }]]));
    // An empty second page ends the walk short of `total`, which is caught as a
    // short read rather than reported as a smaller estate.
    expect(onePage.r.data).toBeUndefined();
    expect(onePage.r.error?.code).toBe('epc_short_read');
  });

  it('takes criticalPatchesMissing from the summary, not from the per-system rows', async () => {
    // Four numbers describe this estate and all four are real. Live: 34 from
    // the summary, 49 as the sum of per-system `critical_patch_count`, 117
    // important, 483 all missing MS patches. The fixture reproduces the fork in
    // miniature — summary says 7, the per-system critical counts sum to 3 — so
    // a reading that quietly switched sources could not pass this.
    const { r } = await poll(routes());
    expect(r.data?.stats.criticalPatchesMissing).toBe(7);
    expect(r.data?.stats.criticalPatchesMissing).not.toBe(3);
  });

  it('bitlockerEncrypted is a COUNT and nothing divides it by total', async () => {
    // 2 of 5 here; 130 of 213 live, where 81 have never been scanned. A
    // fraction would announce that 39% of the estate is unencrypted when the
    // measured truth is two known-bad machines.
    const { r } = await poll(routes());
    expect(r.data?.stats.bitlockerEncrypted).toBe(2);
    expect(Number.isInteger(r.data!.stats.bitlockerEncrypted)).toBe(true);
  });

  it('gives every issue kind a turn in the attention list', async () => {
    const { r } = await poll(routes());
    expect(new Set((r.data?.attention ?? []).map((a) => a.issueKind)))
      .toEqual(new Set(['stale_agent', 'no_bitlocker', 'missing_patches']));
  });

  it('is NOT degraded by a machine that simply has no agent', async () => {
    // The fixture world matches the live one: one computer has never contacted
    // and has no agent installed. That is a fact about the estate, not a hole in
    // the read, so the snapshot is clean. The first version degraded here and
    // therefore degraded on EVERY poll of the real estate — a provenance note
    // that is permanently on is a note nobody reads.
    const { r } = await poll(routes());
    expect(r.degraded).toBe(false);
    expect(r.error).toBeUndefined();
    expect(r.data).toBeDefined();
  });

  it('IS degraded by an agent that exists and has never reported', async () => {
    // The other half. Same missing timestamp, different fact: this one is an
    // anomaly and the count really is a lower bound.
    const anomalous = {
      status: 'success',
      message_response: { total: 5, computers: [
        { resource_id: 104, resource_id_string: '104', resource_name: 'DEMO-LT-0355', os_name: 'macOS', agent_last_contact_time: 1787313600000, agent_installed_on: 1785000000000 },
        { resource_id: 105, resource_id_string: '105', resource_name: 'DEMO-DT-0092', os_name: 'macOS', agent_last_contact_time: 0, agent_installed_on: 1785000000000 },
      ] },
    };
    const { r } = await poll(routes([[(u) => u.includes('som/computers') && u.includes('page=2'), anomalous]]));
    expect(r.degraded).toBe(true);
    expect(r.error?.code).toBe('epc_partial');
    expect(r.error?.message).toContain('never reported');
    expect(r.data).toBeDefined();   // and the figures still reach the screen
  });
});

describe('a failed read never renders as green', () => {
  it('returns NO data at all when one constituent read fails', async () => {
    // Five required numbers and nowhere in the frozen contract to write "we
    // could not look". A zero here reads as good news: no endpoints, nothing
    // missing patches, nothing unencrypted.
    const { r } = await poll(routes([[(u) => u.includes('bitlocker'), null]]));
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe('epc_http_503');
    expect(r.error?.message).toContain('BitLocker drive reports');
  });

  it('names which question went unanswered, for each of several', async () => {
    for (const [fragment, named] of [
      ['som/computers', 'managed computers'],
      ['patch/allsystems', 'per-system patch status'],
      ['patch/summary', 'patch summary'],
    ] as const) {
      const { r } = await poll(routes([[(u) => u.includes(fragment), null]]));
      expect(r.data).toBeUndefined();
      expect(r.error?.message).toContain(named);
    }
  });

  it('a 200 carrying an error envelope costs the whole snapshot, not one number', async () => {
    const { r } = await poll(routes([[(u) => u.includes('patch/summary'), fx('epc-error.json')]]));
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe('epc_envelope_10022');
  });

  it('refuses to compute compliance when nothing was scanned', async () => {
    // 0/0 is NaN and "0 healthy of 0" is not 100% compliance. Either would
    // reach the screen as a number.
    const empty = { status: 'success', message_response: { summary: {
      system_summary: { total_systems: 0, healthy_systems: 0 },
      missing_patch_severity_summary: { critical_count: 0 },
    } } };
    const { r } = await poll(routes([[(u) => u.includes('patch/summary'), empty]]));
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe('epc_empty');
  });

  it('an auth failure is a failure to LOOK, and carries no snapshot', async () => {
    const { impl } = serve(routes());
    const r = await pollEndpoints({ tokens: failingToken(), apiBase: BASE, fetchImpl: impl, now: () => NOW });
    expect(r.data).toBeUndefined();
    expect(r.error?.code).toBe('epc_config');
    expect(r.error?.message).toContain('nothing about the estate was read');
  });
});
