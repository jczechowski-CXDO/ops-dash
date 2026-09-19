import type { ServiceStatus, ServiceId } from '@ops-dash/shared';
import { clock, daysAgo, hoursAhead, minutesAgo, secondsAgo } from './time.js';

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

/** `latencyMs`, `p50Ms` and `p95Ms` are derived from the series rather than from
 *  the baseline, so the three numbers on the response-time card cannot disagree
 *  with the curve drawn beside them. The plan's flat `p95 = base * 1.8` left ten
 *  of the Sev1 m365 samples above the p95 line, and its `latencyMs: 840` was not
 *  the most recent probe, which is what the contract says that field is. */
function derive(series: number[]): { latencyMs: number; p50Ms: number; p95Ms: number } {
  const sorted = [...series].sort((a, b) => a - b);
  const at = (i: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, i))] ?? 0;
  const mid = sorted.length / 2;
  return {
    latencyMs: series[series.length - 1] ?? 0,
    p50Ms: Math.round((at(mid - 1) + at(mid)) / 2),
    p95Ms: at(Math.ceil(sorted.length * 0.95) - 1),
  };
}

/** Tile order: this is the order the Overview strip and tile grid render.
 *  `seed` keeps each service's curve stable across reloads; m365's and
 *  proofpoint's are the prototype's own seeds, the other five are fresh
 *  (their prototype counterparts were placeholder vendors). */
export type Base = { id: ServiceId; short: string; name: string; base: number; seed: number };

export const SERVICE_BASES: Base[] = [
  { id: 'm365', short: 'Microsoft 365', name: 'Microsoft 365 / Entra ID', base: 210, seed: 3 },
  { id: 'proofpoint', short: 'Proofpoint', name: 'Proofpoint 365 Total Protection', base: 260, seed: 13 },
  { id: 'jira', short: 'Jira', name: 'Jira Software', base: 175, seed: 17 },
  { id: 'zendesk', short: 'Zendesk', name: 'Zendesk Support', base: 190, seed: 19 },
  { id: 'helpjuice', short: 'Helpjuice', name: 'Helpjuice Knowledge Base', base: 140, seed: 23 },
  { id: 'claude', short: 'Claude', name: 'Claude (Anthropic)', base: 155, seed: 29 },
  { id: 'openai', short: 'OpenAI', name: 'OpenAI', base: 165, seed: 31 },
];

export function serviceBase(id: ServiceId): Base {
  const found = SERVICE_BASES.find((b) => b.id === id);
  if (!found) throw new Error(`no baseline for service ${id}`);
  return found;
}

/** Minutes before now that the Sev1 opened. Every clock string in the Sev1 world
 *  is derived from this one anchor, so the screen cannot disagree with itself. */
export const SEV1_OPENED_MINUTES_AGO = 83;

/** When Microsoft posted EX1084221 — the 'vendor' entry on the Sev1 timeline and
 *  the "last vendor update" in the tile note are the same event, so they share a
 *  constant instead of each carrying their own number. */
export const VENDOR_CONFIRMED_MINUTES_AGO = SEV1_OPENED_MINUTES_AGO - 46;

/** Mailflow's last success, four minutes before the incident opened. Quoted by
 *  the m365 tile note and by INC-2291's oldest queued message. */
export const MAILFLOW_LAST_SUCCESS_MINUTES_AGO = SEV1_OPENED_MINUTES_AGO + 4;

const healthy = (b: Base): ServiceStatus => {
  const series = spark(b.seed, b.base, false);
  return {
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
    ...derive(series),
    spark: series,
    uptime30d: 0.9998,
    incidents90d: 1,
    lastStateChange: daysAgo(11),
  };
};

/** Amendment 1 and amendment 4, on screen.
 *
 *  The Zendesk SSP publishes no per-service status field, so a successful poll
 *  that returns no incidents is indistinguishable from a poll that learned
 *  nothing. That is a property of the source, not of a demo world, so it holds
 *  in BOTH worlds — an adapter cannot become able to tell the difference just
 *  because the day is quiet. The consequence is deliberate and John decided it
 *  explicitly: "ALL SYSTEMS OPERATIONAL" is unreachable while Zendesk is one of
 *  the seven, because the strip asserts health only when every service is
 *  affirmatively operational. The quiet strip reads "6 AFFIRMED · 1 UNKNOWN".
 *
 *  This must render `var(--text-disabled)`, never green, and must never count
 *  toward the all-clear. Do not "fix" it to operational. */
const unknownVendor = (): ServiceStatus['vendor'] => ({
  level: 'unknown',
  label: 'Unknown',
  note: 'Zendesk SSP publishes no per-service status field and returned no incidents. An absence is not an affirmation. Reading is global Zendesk, not necessarily our pod.',
  incidentsSince: [],
  lastSuccessfulPoll: secondsAgo(60),
});

const withUnknownZendesk = (s: ServiceStatus): ServiceStatus =>
  s.id === 'zendesk' ? { ...s, vendor: unknownVendor() } : s;

export const quietServices: ServiceStatus[] = SERVICE_BASES.map(healthy).map(withUnknownZendesk);

/** Degraded on both halves: the vendor says so and our own probes agree. This is
 *  the pair that makes the 'vendor degraded + our check failing' rule fire. */
const m365Sev1 = (): ServiceStatus => {
  const series = spark(3, 210, true);
  return {
    ...healthy(serviceBase('m365')),
    vendor: {
      level: 'degraded',
      label: 'Degraded',
      note: `Advisory EX1084221 — "Users may experience delays receiving email." Last vendor update ${VENDOR_CONFIRMED_MINUTES_AGO} minutes ago.`,
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
      note: `Mailflow probe failing from us-east, us-west and eu-west. Last success ${clock(MAILFLOW_LAST_SUCCESS_MINUTES_AGO)}.`,
      passing: 1,
      total: 4,
    },
    // The series is the aggregate across all four regions, which is why it
    // climbs while ap-south alone stays fast in the check table: three regions
    // are timing out at the probe ceiling and drag the aggregate up.
    ...derive(series),
    spark: series,
    uptime30d: 0.9921,
    incidents90d: 4,
    lastStateChange: minutesAgo(SEV1_OPENED_MINUTES_AGO),
  };
};

/** Proofpoint's Sev1 series: the last ten samples ramp up, and the most recent
 *  sample is forced 15% above everything before it. That is what makes the tile
 *  note "above p95 from us-east" true rather than decorative — `latencyMs` is
 *  the most recent probe, and it has to exceed the p95 derived from the same
 *  series. `history.ts` reads the same number for the newest check run, so the
 *  curve, the stat and the table all quote one measurement. */
function proofpointSev1Series(): number[] {
  const b = serviceBase('proofpoint');
  const series = spark(b.seed, b.base, false).map((ms, i) =>
    i > 17 ? Math.round(ms * (1.6 + (i - 17) * 0.06)) : ms,
  );
  const peak = Math.max(...series.slice(0, -1));
  series[series.length - 1] = Math.round(peak * 1.15);
  return series;
}

/** The most recent proofpoint probe in the Sev1 world, shared with the check
 *  history so the two cannot drift apart. */
export const PROOFPOINT_SEV1_LATEST_MS: number =
  proofpointSev1Series()[27] ?? 0;

/** The vendor has posted an advisory and our probes are slow but passing — the
 *  common case where the two halves are both true and neither is an outage. */
const proofpointSev1 = (): ServiceStatus => ({
  ...healthy(serviceBase('proofpoint')),
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
  ...derive(proofpointSev1Series()),
  spark: proofpointSev1Series(),
  lastStateChange: minutesAgo(34),
});

/** Amendment 2's scheduled-maintenance window, which nothing else in the
 *  milestone reaches. A vendor maintenance notice is not a fault: our own probes
 *  stay green and the window is in the future, so the tile is informational. It
 *  is here so `vendor.maintenance` and `level: 'maintenance'` are both rendered
 *  by some screen, rather than being a field we argued for and never used. */
const helpjuiceSev1 = (): ServiceStatus => ({
  ...healthy(serviceBase('helpjuice')),
  vendor: {
    level: 'maintenance',
    label: 'Maintenance',
    note: 'Search index maintenance announced for tonight. Article reads are unaffected; search may return stale results during the window.',
    maintenance: {
      title: 'Search index rebuild',
      scheduledFor: hoursAhead(6),
      scheduledUntil: hoursAhead(8),
    },
    incidentsSince: [],
    lastSuccessfulPoll: secondsAgo(41),
  },
  lastStateChange: minutesAgo(52),
});

export const sev1Services: ServiceStatus[] = quietServices.map((s) => {
  switch (s.id) {
    case 'm365':
      return m365Sev1();
    case 'proofpoint':
      return proofpointSev1();
    case 'helpjuice':
      return helpjuiceSev1();
    default:
      // zendesk is already unknown in both worlds; the rest stay operational.
      return s;
  }
});
