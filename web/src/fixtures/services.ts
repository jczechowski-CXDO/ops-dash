import type { ServiceStatus, ServiceId, VendorPlatform } from '@ops-dash/shared';
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
export type Base = {
  id: ServiceId;
  short: string;
  name: string;
  base: number;
  seed: number;
  /** amendment 5. Declared here rather than at each vendor literal so one
   *  service cannot claim two platforms, and so the blackout rule's grouping
   *  reads off the same table the tiles do. Four of the seven are `statuspage`,
   *  which is the whole reason the rule exists. */
  platform: VendorPlatform;
};

export const SERVICE_BASES: Base[] = [
  { id: 'm365', short: 'Microsoft 365', name: 'Microsoft 365 / Entra ID', base: 210, seed: 3, platform: 'msgraph' },
  { id: 'proofpoint', short: 'Proofpoint', name: 'Proofpoint 365 Total Protection', base: 260, seed: 13, platform: 'statusio' },
  { id: 'jira', short: 'Jira', name: 'Jira Software', base: 175, seed: 17, platform: 'statuspage' },
  { id: 'zendesk', short: 'Zendesk', name: 'Zendesk Support', base: 190, seed: 19, platform: 'zendesk-ssp' },
  { id: 'helpjuice', short: 'Helpjuice', name: 'Helpjuice Knowledge Base', base: 140, seed: 23, platform: 'statuspage' },
  { id: 'claude', short: 'Claude', name: 'Claude (Anthropic)', base: 155, seed: 29, platform: 'statuspage' },
  { id: 'openai', short: 'OpenAI', name: 'OpenAI', base: 165, seed: 31, platform: 'statuspage' },
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

/** Proofpoint carries the headline vendor correlation (G-13). Its Status.io feed
 *  is genuinely readable, so 'vendor degraded + our check failing' is a rule that
 *  can actually fire here — which is what makes it, and not m365, the honest
 *  home for the demo. INC-2292 opens at this anchor. */
export const PROOFPOINT_OPENED_MINUTES_AGO = 34;

/** When Hornetsecurity posted hs-8841. Shared by the tile note and the 'vendor'
 *  entry on INC-2292's timeline, so the two cannot quote different times. */
export const PROOFPOINT_VENDOR_UPDATE_MINUTES_AGO = 20;

const healthy = (b: Base): ServiceStatus => {
  const series = spark(b.seed, b.base, false);
  return {
    id: b.id,
    short: b.short,
    name: b.name,
    vendor: {
      platform: b.platform,
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
 *  affirmatively operational. With m365 blind for its own reason (see
 *  `noVendorFeed`), the quiet strip reads "5 AFFIRMED · 2 UNKNOWN".
 *
 *  This must render `var(--text-disabled)`, never green, and must never count
 *  toward the all-clear. Do not "fix" it to operational. */
const unknownVendor = (platform: VendorPlatform): ServiceStatus['vendor'] => ({
  platform,
  level: 'unknown',
  label: 'Unknown',
  note: 'Zendesk SSP publishes no per-service status field and returned no incidents. An absence is not an affirmation. Reading is global Zendesk, not necessarily our pod.',
  incidentsSince: [],
  lastSuccessfulPoll: secondsAgo(60),
});

/** The same ruling, applied to the other service we genuinely cannot see.
 *
 *  There is no public per-workload status feed for commercial M365 at all, so
 *  Graph is the only path, and our Service Health consent is still pending —
 *  `rules.ts` carries that as the `needs_auth` integration with no
 *  `lastSuccessAt`, because the feed has never once authenticated. A tile
 *  claiming "no advisories posted in the last 7 days, polled every 60 seconds"
 *  beside that row was showing a successful poll from a feed that has never run.
 *
 *  `lastSuccessfulPoll` is therefore ABSENT, not stale: there has never been
 *  one. Note the vendor-feeds integration names six vendors for seven services,
 *  which is the same fact seen from the other side.
 *
 *  Our own half is unaffected and stays real: our synthetic probes against M365
 *  are ours, not Microsoft's. Being blind to the vendor's claim while our own
 *  checks fail is exactly the case the contract's two-level model exists for. */
const noVendorFeed = (): ServiceStatus['vendor'] => ({
  // msgraph even though it has never returned: the platform says where the
  // claim WOULD come from, not whether it arrived. A blind feed still belongs
  // to its platform, and the blackout rule needs it there to group correctly.
  platform: 'msgraph',
  level: 'unknown',
  label: 'Unknown',
  note: 'No vendor signal. Microsoft publishes no per-workload status feed for commercial M365, and our Graph Service Health consent (ServiceHealth.Read.All + ServiceMessage.Read.All) is still pending, so this feed has never returned. This is not an assertion of health.',
  incidentsSince: [],
});

const withUnknownVendors = (s: ServiceStatus): ServiceStatus =>
  s.id === 'zendesk'
    ? { ...s, vendor: unknownVendor('zendesk-ssp') }
    : s.id === 'm365'
      ? { ...s, vendor: noVendorFeed() }
      : s;

export const quietServices: ServiceStatus[] = SERVICE_BASES.map(healthy).map(withUnknownVendors);

/** The Sev1, with one half of the screen blank on purpose.
 *
 *  Our probes are failing from three of four regions and we have NO vendor
 *  statement to corroborate them, because Service Health consent is pending.
 *  The advisory exists — a human read EX1084221 in the admin centre — but it
 *  reached us out of band, so it lives on the incident, where a person put it,
 *  and not on the vendor half, which is fed by an adapter that has never run.
 *
 *  The consequence is stated on the incident and is the honest one: the
 *  'vendor degraded + our check failing' rule COULD NOT fire, because amendment
 *  1 is explicit that `unknown` never satisfies the vendor side. The Sev1 rests
 *  on our own probes and a human decision. That is the operational cost of the
 *  missing consent, and it is now visible on the screen rather than papered
 *  over by a vendor half that was telling us what we wanted to hear. */
const m365Sev1 = (): ServiceStatus => {
  const series = spark(3, 210, true);
  return {
    ...healthy(serviceBase('m365')),
    vendor: noVendorFeed(),
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
 *  note "above p95" true rather than decorative — `latencyMs` is
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

/** The headline correlation, moved here from m365 by John's ruling (G-13).
 *
 *  Both halves are independently sourced and both are bad: Hornetsecurity's
 *  Status.io feed reports degraded processing, and our own gateway probes are
 *  failing from two of four regions. That is the pair the 'vendor degraded +
 *  our check failing' rule needs, and — unlike m365 — every input is something
 *  a live poll can actually read, so the demo is reproducible rather than
 *  staged. The vendor half carries a real `incidentsSince` entry and a real
 *  `lastSuccessfulPoll`, which is what a readable feed looks like next to
 *  m365's blind one. */
const proofpointSev1 = (): ServiceStatus => ({
  ...healthy(serviceBase('proofpoint')),
  vendor: {
    platform: 'statusio',
    level: 'degraded',
    label: 'Degraded',
    note: `Status.io reports elevated processing latency in United States - Atlanta. Last vendor update ${PROOFPOINT_VENDOR_UPDATE_MINUTES_AGO} minutes ago.`,
    advisoryId: 'hs-8841',
    incidentsSince: [
      {
        id: 'hs-8841',
        title: 'Elevated processing latency — United States - Atlanta',
        level: 'degraded',
        startedAt: minutesAgo(PROOFPOINT_OPENED_MINUTES_AGO),
      },
    ],
    lastSuccessfulPoll: secondsAgo(41),
  },
  ours: {
    level: 'outage',
    label: 'Failing',
    note: 'Mail through the gateway failing from us-east and eu-west. us-west and ap-south are still delivering, but above p95.',
    passing: 2,
    total: 4,
  },
  ...derive(proofpointSev1Series()),
  spark: proofpointSev1Series(),
  uptime30d: 0.9957,
  incidents90d: 2,
  lastStateChange: minutesAgo(PROOFPOINT_OPENED_MINUTES_AGO),
});

/** Amendment 2's scheduled-maintenance window, which nothing else in the
 *  milestone reaches. A vendor maintenance notice is not a fault: our own probes
 *  stay green and the window is in the future, so the tile is informational. It
 *  is here so `vendor.maintenance` and `level: 'maintenance'` are both rendered
 *  by some screen, rather than being a field we argued for and never used. */
const helpjuiceSev1 = (): ServiceStatus => ({
  ...healthy(serviceBase('helpjuice')),
  vendor: {
    platform: 'statuspage',
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
