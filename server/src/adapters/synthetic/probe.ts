import type { CheckRun, ServiceId } from '@ops-dash/shared';
import type { FetchLike } from '../../http/fetchJson.js';

/** One HTTPS reachability check against one host, in one region.
 *
 *  `check` is the operator-facing label that reaches the UI ('Zendesk pod:
 *  crexendo'), and `region` is where we ran it from. Milestone 2 runs one
 *  region only; the field exists because `CheckRun` has always carried it and
 *  a second region is a config line, not a schema change. */
export type ProbeSpec = {
  serviceId: ServiceId;
  check: string;
  url: string;
  region: string;
  /** Per-probe override. A slow-but-alive host is a p95 story, not a failure,
   *  so this is generous by default. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Run one probe and return the `CheckRun` row the store will keep.
 *
 * **This deliberately does not use `fetchJson`, and the guard in
 * `web/src/guards.test.ts` has an escape hatch for exactly this file.** The
 * reason is not convenience:
 *
 *   - `fetchJson` answers "is this feed's payload usable?" and a probe asks
 *     "did this host answer at all?" — different questions with different
 *     right answers. Crexendo's Zendesk pod serves an HTML login page under
 *     HTTP 200. To `fetchJson` that is `non_json_2xx`, an error, and correctly
 *     so. To a reachability probe it is a pass: the host is up. Routing the
 *     probe through the shared helper would make every reachable host in the
 *     estate report as failing, and the correlation rule would then read our
 *     own half as "our check is failing" forever.
 *   - The four failure rules `fetchJson` exists to enforce are rules about
 *     *bodies*. A probe reads no body — it cancels the stream as soon as the
 *     headers arrive — so there is no body for those rules to be applied to or
 *     bypassed. Adding a `parseBody: false` flag would make `fetchJson`'s
 *     invariants conditional, which is the one property that makes it worth
 *     having.
 *   - The return types have nothing in common. `SourceResult<T>` is a payload
 *     envelope; a probe produces a `CheckRun` — timestamp, result, latency.
 *
 * What is shared is the *vocabulary*: the same AbortController timeout, the
 * same "a transport error is data, not an exception" contract. Nothing here
 * throws.
 *
 * The three results, and why they are three and not two:
 *
 *   2xx           -> 'pass',    latency measured to the response headers
 *   non-2xx       -> 'fail',    latency measured — a response did arrive
 *   no response   -> 'fail',    latencyMs null — nothing was timed
 *   our deadline  -> 'timeout', latencyMs null
 *
 * A timeout is NOT a 'fail' and a non-2xx is NOT a 'timeout'. They are
 * different diagnoses: a 503 means the host is up and the app is not, a
 * timeout means we could not reach it. An operator does different things with
 * each. And `latencyMs` is null rather than 0 on both no-response paths,
 * because a zero renders as an extremely fast probe — the exact opposite of
 * what happened. The contract's `number | null` exists for this.
 */
export async function runProbe(spec: ProbeSpec, fetchImpl: FetchLike = fetch): Promise<CheckRun> {
  const at = new Date().toISOString();
  const controller = new AbortController();
  // Our own flag rather than sniffing the error name. Whether an aborted
  // request rejects with `AbortError`, `TimeoutError` or something a stub
  // invented is not ours to depend on; whether OUR deadline fired is.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const started = performance.now();
  const since = () => Math.round(performance.now() - started);

  try {
    // deliberately not fetchJson — see the block comment above. A reachability
    // probe must not parse, or even download, the body.
    const response = await fetchImpl(spec.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: '*/*' },
    });
    const latencyMs = since();

    // Latency is measured to the response HEADERS, above, and the body is
    // dropped on the floor here. Reading it would fold the size of the
    // vendor's home page into a number we present as reachability.
    await response.body?.cancel().catch(() => undefined);

    return row(spec, at, response.ok ? 'pass' : 'fail', latencyMs);
  } catch {
    // No latency on either path: nothing completed, so there is nothing to
    // have timed. Null, never 0.
    return row(spec, at, timedOut ? 'timeout' : 'fail', null);
  } finally {
    clearTimeout(timer);
  }
}

function row(
  spec: ProbeSpec,
  at: string,
  result: CheckRun['result'],
  latencyMs: number | null,
): CheckRun {
  return {
    serviceId: spec.serviceId, // amendment 6 — a row in the store cannot be keyed by a Record
    at,
    check: spec.check,
    region: spec.region,
    result,
    latencyMs,
  };
}
