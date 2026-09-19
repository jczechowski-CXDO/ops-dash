import type { ServiceStatus, ServiceId } from '@ops-dash/shared';
import { clock, daysAgo, minutesAgo, secondsAgo } from './time.js';

/** The prototype's LCG, retargeted from viewBox units to milliseconds so the
 *  curves match its screenshots while the contract stays honest. 28 samples,
 *  oldest first, as `ServiceStatus.spark` documents. */
function spark(seed: number, base: number, spike: boolean): number[] {
  let x = (seed * 7919 + 13) % 2147483647;
  const out: number[] = [];
  for (let i = 0; i < 28; i++) {
    x = (x * 48271) % 2147483647;
    const v = x / 2147483647;
    let ms = base * (0.85 + v * 0.35);
    if (spike && i > 17) ms = base * (2.6 + v * 1.6) + (i - 17) * base * 0.12;
    out.push(Math.round(ms));
  }
  return out;
}

/** Tile order: this is the order the Overview strip and tile grid render.
 *  `seed` keeps each service's curve stable across reloads; m365's and
 *  proofpoint's are the prototype's own seeds, the other five are fresh
 *  (their prototype counterparts were placeholder vendors). */
type Base = { id: ServiceId; short: string; name: string; base: number; seed: number };

const BASES: Base[] = [
  { id: 'm365', short: 'Microsoft 365', name: 'Microsoft 365 / Entra ID', base: 210, seed: 3 },
  { id: 'proofpoint', short: 'Proofpoint', name: 'Proofpoint 365 Total Protection', base: 260, seed: 13 },
  { id: 'jira', short: 'Jira', name: 'Jira Software', base: 175, seed: 17 },
  { id: 'zendesk', short: 'Zendesk', name: 'Zendesk Support', base: 190, seed: 19 },
  { id: 'helpjuice', short: 'Helpjuice', name: 'Helpjuice Knowledge Base', base: 140, seed: 23 },
  { id: 'claude', short: 'Claude', name: 'Claude (Anthropic)', base: 155, seed: 29 },
  { id: 'openai', short: 'OpenAI', name: 'OpenAI', base: 165, seed: 31 },
];

/** Minutes before now that the Sev1 opened. Every clock string in the Sev1 world
 *  is derived from this one anchor, so the screen cannot disagree with itself. */
export const SEV1_OPENED_MINUTES_AGO = 83;

const healthy = (b: Base): ServiceStatus => ({
  id: b.id,
  short: b.short,
  name: b.name,
  vendor: {
    level: 'operational',
    label: 'Operational',
    note: 'No advisories posted in the last 7 days. Feed polled every 60 seconds.',
    incidentsSince: [],
    lastSuccessfulPoll: secondsAgo(41),
  },
  ours: {
    level: 'operational',
    label: 'Passing',
    note: 'All probes green from four regions. Last run 41 seconds ago.',
    passing: 4,
    total: 4,
  },
  latencyMs: b.base,
  p50Ms: b.base,
  p95Ms: Math.round(b.base * 1.8),
  spark: spark(b.seed, b.base, false),
  uptime30d: 0.9998,
  incidents90d: 1,
  lastStateChange: daysAgo(11),
});

export const quietServices: ServiceStatus[] = BASES.map(healthy);

function base(id: ServiceId): Base {
  const found = BASES.find((b) => b.id === id);
  if (!found) throw new Error(`no baseline for service ${id}`);
  return found;
}

/** Degraded on both halves: the vendor says so and our own probes agree. This is
 *  the pair that makes the 'vendor degraded + our check failing' rule fire. */
const m365Sev1: ServiceStatus = {
  ...healthy(base('m365')),
  vendor: {
    level: 'degraded',
    label: 'Degraded',
    note: 'Advisory EX1084221 — "Users may experience delays receiving email." Last vendor update 12 minutes ago.',
    advisoryId: 'EX1084221',
    incidentsSince: [
      {
        id: 'EX1084221',
        title: 'Users may experience delays receiving email',
        level: 'degraded',
        startedAt: minutesAgo(SEV1_OPENED_MINUTES_AGO),
      },
    ],
    lastSuccessfulPoll: secondsAgo(41),
  },
  ours: {
    level: 'outage',
    label: 'Failing',
    note: `Mailflow probe failing from us-east, us-west and eu-west. Last success ${clock(SEV1_OPENED_MINUTES_AGO + 4)}.`,
    passing: 1,
    total: 4,
  },
  latencyMs: 840,
  spark: spark(3, 210, true),
  uptime30d: 0.9921,
  incidents90d: 4,
  lastStateChange: minutesAgo(SEV1_OPENED_MINUTES_AGO),
};

/** The vendor has posted an advisory and our probes are slow but passing — the
 *  common case where the two halves are both true and neither is an outage. */
const proofpointSev1: ServiceStatus = {
  ...healthy(base('proofpoint')),
  vendor: {
    level: 'degraded',
    label: 'Advisory',
    note: 'Status.io reports elevated processing latency in United States - Atlanta. Last vendor update 34 minutes ago.',
    incidentsSince: [],
    lastSuccessfulPoll: secondsAgo(41),
  },
  ours: {
    level: 'degraded',
    label: 'Slow',
    note: 'Mailflow round trip above p95 from us-east. Last success 2 minutes ago.',
    passing: 3,
    total: 4,
  },
  lastStateChange: minutesAgo(34),
};

/** Amendment 1 and amendment 4, on screen. The Zendesk SSP returned successfully
 *  and returned nothing; that is an absence of evidence, not evidence of health.
 *  It must render neutral, never green, and must not count toward
 *  'ALL SYSTEMS OPERATIONAL'. Do not "fix" this to operational. */
const zendeskSev1: ServiceStatus = {
  ...healthy(base('zendesk')),
  vendor: {
    level: 'unknown',
    label: 'Unknown',
    note: 'Zendesk SSP publishes no per-service status field and returned no incidents. An absence is not an affirmation. Reading is global Zendesk, not necessarily our pod.',
    incidentsSince: [],
    lastSuccessfulPoll: secondsAgo(60),
  },
};

export const sev1Services: ServiceStatus[] = quietServices.map((s) =>
  s.id === 'm365' ? m365Sev1 : s.id === 'proofpoint' ? proofpointSev1 : s.id === 'zendesk' ? zendeskSev1 : s,
);
