import type { CheckRun } from '@ops-dash/shared';
import type { FetchLike } from '../../http/fetchJson.js';
import { runProbe, type ProbeSpec } from './probe.js';

/**
 * The probes this milestone runs, one region, HTTPS reachability only.
 *
 * Scope decided 2026-09-19: the M365 mailflow round trip needs Graph and is
 * Milestone 3, so it is deliberately absent rather than stubbed — a stubbed
 * probe that always passes is worse than no probe, because the correlation
 * rule would read it as an affirmative "our side is fine".
 *
 * **Zendesk is one service with two probes.** The crexendo and netsapiens pods
 * are two pods of one tile, confirmed by John 2026-09-19; `ServiceId` is
 * unchanged and a tile reading `1/2 passing` when one pod is down is the
 * intended rendering, not a bug. Which is why the probe list is a flat array
 * keyed by `check` rather than a map keyed by service.
 *
 * **The URLs below are the ones the hand-run proved, not the obvious ones.**
 * Task 9 step 4 ran every probe against the live internet on 2026-09-19 and
 * three of the four original targets failed — none of them because the vendor
 * was unwell:
 *
 *   - Both Zendesk pod roots sit behind a Cloudflare bot challenge that answers
 *     `403 cf-mitigated: challenge` to any automated client, forever. Probing
 *     them measures Cloudflare's opinion of us, not Zendesk's health. The help
 *     centre API underneath the challenge answers honestly and fast, so that is
 *     what we probe.
 *   - `crexendo.atlassian.net` answered 404 on every path tried. The hostname
 *     was a guess derived from the tenant pattern and the guess was wrong; the
 *     tenant is `netsapiens`, confirmed by John 2026-09-19.
 *
 * The lesson is the one this product is about: a probe that cannot pass is
 * worse than no probe, because it teaches the operator that red means nothing.
 */
export const DEFAULT_PROBES: ProbeSpec[] = [
  // Measured 2026-09-19: 200 JSON in ~190ms. The public help-centre API, which
  // is not behind the challenge the pod root is behind, and which exercises
  // Zendesk's application tier rather than its CDN edge.
  {
    serviceId: 'zendesk',
    check: 'Zendesk pod: crexendo',
    url: 'https://support.crexendo.com/api/v2/help_center/en-us/categories.json',
    region: 'us-east',
  },
  // Measured 2026-09-19: 401 JSON in ~150ms, every time. This pod's help centre
  // is sign-in restricted, so 401 IS its healthy answer — see `expectStatus`.
  // Zendesk reaching the point of refusing us is Zendesk being up.
  {
    serviceId: 'zendesk',
    check: 'Zendesk pod: netsapiens',
    url: 'https://help.netsapiens.com/api/v2/help_center/en-us/categories.json',
    region: 'us-east',
    expectStatus: 401,
  },
  // Measured 2026-09-19: 200 in ~435ms. The tenant-pattern guess, confirmed.
  {
    serviceId: 'helpjuice',
    check: 'Helpjuice knowledge base',
    url: 'https://crexendo.helpjuice.com',
    region: 'us-east',
  },
  // Measured 2026-09-19: 200 `{"state":"RUNNING"}` in ~110ms, four rounds, no
  // redirect. The tenant is `netsapiens`, not `crexendo` — the guessed hostname
  // 404'd on every path and was removed rather than left to fail forever.
  //
  // `/status` rather than the tenant root, and the difference matters. The root
  // answers 202 with an async loading shell, which is a 2xx and would pass, but
  // it proves only that Atlassian's edge is serving HTML. `/status` is Jira's
  // own liveness endpoint: credential-free, JSON, and answered by the instance
  // rather than by the CDN in front of it. Same reasoning as the Zendesk pods —
  // probe the application tier, not the thing standing in front of it.
  {
    serviceId: 'jira',
    check: 'Jira Cloud tenant',
    url: 'https://netsapiens.atlassian.net/status',
    region: 'us-east',
  },
];

/** Injected only by the isolation test. A probe that rejects cannot be
 *  produced by `runProbe`, which catches everything — and a test that can only
 *  exercise isolation through a code path that cannot fail proves nothing. */
export type ProbeFn = (spec: ProbeSpec, fetchImpl?: FetchLike) => Promise<CheckRun>;

/**
 * Run every probe concurrently and return one `CheckRun` per spec, in spec
 * order.
 *
 * `Promise.allSettled`, not `Promise.all`, and that is the whole point of this
 * function. With `Promise.all` a single probe rejecting discards the other six
 * results that already succeeded — one unreachable host would blank the
 * latency history for the entire estate, and the dashboard would show an
 * outage we invented. A probe that throws becomes a `fail` row: it never
 * disappears, and it never reads as green.
 */
export async function runAll(
  specs: ProbeSpec[],
  fetchImpl?: FetchLike,
  probeFn: ProbeFn = runProbe,
): Promise<CheckRun[]> {
  const settled = await Promise.allSettled(specs.map((spec) => probeFn(spec, fetchImpl)));

  return settled.map((outcome, i) => {
    if (outcome.status === 'fulfilled') return outcome.value;
    // Reached only when the probe itself is broken, not the host. Still a row:
    // an absent row is indistinguishable from a probe that never ran, and the
    // uptime figure would quietly improve when our own code breaks.
    const spec = specs[i]!;
    return {
      serviceId: spec.serviceId,
      at: new Date().toISOString(),
      check: spec.check,
      region: spec.region,
      result: 'fail' as const,
      latencyMs: null,
    };
  });
}
