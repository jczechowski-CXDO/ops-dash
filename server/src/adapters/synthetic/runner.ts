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
 * **Zendesk is one service with two probes.** `crexendo.zendesk.com` and
 * `help.netsapiens.com` are two pods of one tile, confirmed by John
 * 2026-09-19; `ServiceId` is unchanged and a tile reading `1/2 passing` when
 * one pod is down is the intended rendering, not a bug. Which is why the probe
 * list is a flat array keyed by `check` rather than a map keyed by service.
 */
export const DEFAULT_PROBES: ProbeSpec[] = [
  // Confirmed by John, 2026-09-19.
  { serviceId: 'zendesk', check: 'Zendesk pod: crexendo', url: 'https://crexendo.zendesk.com', region: 'us-east' },
  { serviceId: 'zendesk', check: 'Zendesk pod: netsapiens', url: 'https://help.netsapiens.com', region: 'us-east' },
  // UNCONFIRMED tenant hostnames: derived from the Crexendo tenant pattern the
  // two Zendesk pods follow, not from anything anyone told us. Task 9 step 4 —
  // the one hand-run against the real internet — is where these are proven or
  // corrected, and they must not reach a live poller before then.
  { serviceId: 'jira', check: 'Jira Cloud tenant', url: 'https://crexendo.atlassian.net', region: 'us-east' },
  { serviceId: 'helpjuice', check: 'Helpjuice knowledge base', url: 'https://crexendo.helpjuice.com', region: 'us-east' },
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
