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
  /**
   * The status this endpoint returns **when it is healthy**, when that is not
   * a 2xx. Absent means the ordinary rule: any 2xx passes.
   *
   * This exists because the real estate forced it (Task 9 step 4, the hand-run
   * against the live internet). `help.netsapiens.com`'s help centre is
   * sign-in restricted, so its public API answers `401 {"error":"Couldn't
   * authenticate you"}` in ~150ms — every time, by design. That 401 is Zendesk's
   * application tier responding correctly; it is the *healthy* reading. Scored
   * against `response.ok` it is a permanent `fail`, which would have pinned the
   * Zendesk tile red forever and left half the `vendor` Sev1 condition armed
   * from the day we shipped.
   *
   * A probe asks "is this host answering the way it answers when it is well?".
   * For most hosts that is "with a 2xx". For a restricted one it is "with a
   * 401". Deviation in EITHER direction is a fail and that is deliberate: a 401
   * turning into a 200 means the help centre was opened to the world, which is
   * a change an operator wants to hear about.
   */
  expectStatus?: number;
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
 *     right answers. A host that answers with an HTML sign-in page, or with a
 *     JSON `{"error":"Couldn't authenticate you"}`, is up; to `fetchJson` the
 *     first is `non_json_2xx` and the second is `http_401`, both errors, and
 *     correctly so for a feed. Routing the probe through the shared helper
 *     would make reachable hosts report as failing, and the correlation rule
 *     would then read our own half as "our check is failing" forever.
 *
 *     (The original note here asserted that Crexendo's Zendesk pod serves an
 *     HTML login page under HTTP 200. The hand-run measured it: it serves a
 *     Cloudflare bot challenge under 403, `cf-mitigated: challenge`. The
 *     conclusion survived; the reason for it did not, and a comment nobody had
 *     measured was load-bearing for a whole exemption.)
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
 *   expected      -> 'pass',    latency measured to the response headers
 *   unexpected    -> 'fail',    latency measured — a response did arrive
 *   no response   -> 'fail',    latencyMs null — nothing was timed
 *   our deadline  -> 'timeout', latencyMs null
 *
 * "Expected" is any 2xx, or exactly `spec.expectStatus` when the spec names one.
 *
 * A timeout is NOT a 'fail' and an unexpected status is NOT a 'timeout'. They are
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

    return row(spec, at, healthy(spec, response.status) ? 'pass' : 'fail', latencyMs);
  } catch {
    // No latency on either path: nothing completed, so there is nothing to
    // have timed. Null, never 0.
    return row(spec, at, timedOut ? 'timeout' : 'fail', null);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether this status is the one this endpoint gives when it is well.
 *  Exact match when the spec names a status — NOT "expected or any 2xx", which
 *  would let a restricted help centre that started returning 200 read healthy
 *  and silently stop being the thing we thought we were measuring. */
function healthy(spec: ProbeSpec, status: number): boolean {
  return spec.expectStatus === undefined ? status >= 200 && status < 300 : status === spec.expectStatus;
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
