import { describe, it, expect } from 'vitest';
import type { CheckRun } from '@ops-dash/shared';
import { runAll, DEFAULT_PROBES, type ProbeFn } from './runner.js';
import type { ProbeSpec } from './probe.js';

const spec = (serviceId: CheckRun['serviceId'], check: string): ProbeSpec => ({
  serviceId,
  check,
  url: `https://${check}.invalid`,
  region: 'us-east',
});

const SEVEN: ProbeSpec[] = [
  spec('zendesk', 'a'),
  spec('zendesk', 'b'),
  spec('jira', 'c'),
  spec('helpjuice', 'd'),
  spec('claude', 'e'),
  spec('openai', 'f'),
  spec('m365', 'g'),
];

const passing: ProbeFn = async (s) => ({
  serviceId: s.serviceId,
  at: '2026-09-19T00:00:00.000Z',
  check: s.check,
  region: s.region,
  result: 'pass',
  latencyMs: 42,
});

describe('runAll — one broken probe must not cost six good results', () => {
  it('returns one run per spec, in spec order', async () => {
    const runs = await runAll(SEVEN, undefined, passing);
    expect(runs.map((r) => r.check)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('one probe REJECTING still returns all seven runs', async () => {
    // Promise.allSettled, not Promise.all. The two are indistinguishable when
    // nothing throws, so the battery is run in the world where they differ:
    // with Promise.all this call rejects and all six good results are lost.
    const exploding: ProbeFn = async (s) => {
      if (s.check === 'd') throw new Error('probe bug, not a host problem');
      return passing(s);
    };
    const runs = await runAll(SEVEN, undefined, exploding);
    expect(runs).toHaveLength(7);
    expect(runs.filter((r) => r.result === 'pass').map((r) => r.check)).toEqual([
      'a', 'b', 'c', 'e', 'f', 'g',
    ]);
  });

  it('the probe that threw becomes a fail row rather than vanishing', async () => {
    // Asserted as what it MUST be. An absent row is indistinguishable from a
    // probe that never ran, and uptime would quietly improve when our own code
    // breaks — the failure this product exists to prevent, one layer down.
    const exploding: ProbeFn = async (s) => {
      if (s.check === 'd') throw new Error('probe bug');
      return passing(s);
    };
    const runs = await runAll(SEVEN, undefined, exploding);
    const broken = runs.find((r) => r.check === 'd')!;
    expect(broken.result).toBe('fail');
    expect(broken.latencyMs).toBeNull();
    expect(broken.serviceId).toBe('helpjuice');
  });
});

describe('the probe list', () => {
  it('Zendesk is one service with two probes, not two services', async () => {
    // Confirmed by John 2026-09-19. `ServiceId` is unchanged; a tile reading
    // "1/2 passing" is the intended rendering when one pod is down.
    const zendesk = DEFAULT_PROBES.filter((p) => p.serviceId === 'zendesk');
    expect(zendesk).toHaveLength(2);
    expect(zendesk.map((p) => p.url).sort()).toEqual([
      'https://help.netsapiens.com/api/v2/help_center/en-us/categories.json',
      'https://support.crexendo.com/api/v2/help_center/en-us/categories.json',
    ]);
  });

  it('probes the help-centre API, never a pod root behind the bot challenge', () => {
    // The hand-run measured both pod roots answering 403 `cf-mitigated:
    // challenge` to any automated client, forever. A probe pointed there scores
    // Cloudflare's opinion of us, not Zendesk's health, and would have pinned
    // the tile red from day one. Assert the positive — every Zendesk probe
    // names the API path — rather than the negative "is not the root", which a
    // third wrong hostname would satisfy.
    for (const p of DEFAULT_PROBES.filter((p) => p.serviceId === 'zendesk')) {
      expect(p.url).toMatch(/\/api\/v2\/help_center\//);
    }
  });

  it('expects 401 from the restricted pod, because that is its healthy answer', () => {
    // Measured 2026-09-19, stable over three rounds: crexendo 200, netsapiens
    // 401 (`Couldn't authenticate you` — sign-in restricted help centre).
    // Zendesk reaching the point of refusing us is Zendesk being up. Scored
    // against `response.ok` this probe fails forever, which arms half the
    // `vendor` Sev1 condition permanently.
    const byCheck = Object.fromEntries(DEFAULT_PROBES.map((p) => [p.check, p]));
    expect(byCheck['Zendesk pod: netsapiens']?.expectStatus).toBe(401);
    expect(byCheck['Zendesk pod: crexendo']?.expectStatus).toBeUndefined();
  });

  it('runs one region only in this milestone, and every target is HTTPS', async () => {
    expect([...new Set(DEFAULT_PROBES.map((p) => p.region))]).toEqual(['us-east']);
    expect(DEFAULT_PROBES.every((p) => p.url.startsWith('https://'))).toBe(true);
  });

  it('carries no M365 mailflow probe — that needs Graph and is Milestone 3', async () => {
    // Deliberately absent rather than stubbed: a stubbed probe that always
    // passes is worse than no probe, because the correlation rule would read
    // it as an affirmative "our side is fine".
    expect(DEFAULT_PROBES.map((p) => p.serviceId)).toEqual([
      'zendesk', 'zendesk', 'helpjuice', 'jira',
    ]);
  });

  it('probes the Jira tenant at its own liveness endpoint, not at the tenant root', () => {
    // The root answers 202 with an async loading shell — a 2xx, so it would
    // pass, but it proves only that Atlassian's edge is serving HTML. `/status`
    // is answered by the instance itself. Same reasoning as the Zendesk pods:
    // probe the application tier, not what stands in front of it.
    const jira = DEFAULT_PROBES.filter((p) => p.serviceId === 'jira');
    expect(jira).toHaveLength(1);
    expect(jira[0]!.url).toBe('https://netsapiens.atlassian.net/status');
    // No expectStatus: this one is an honest 200.
    expect(jira[0]!.expectStatus).toBeUndefined();
  });
});
