import type { CheckRun, ServiceId } from '@ops-dash/shared';
import { secondsAgo } from './time.js';
import { serviceBase, PROOFPOINT_SEV1_LATEST_MS, type Base } from './services.js';

/** Recent-history table row. Not a contract type — it is presentation-only copy
 *  for the Overview's closed-incident table, which has no adapter behind it. */
export type HistoryRow = {
  id: string;
  title: string;
  service: string;
  duration: string;
  closed: string;
};

/** The prototype's five closed incidents, with the services moved from the
 *  placeholder ten to the seven verified vendors. Identical in both worlds:
 *  these are closed, so the quiet/Sev1 switch does not change them. */
export const recentHistory: HistoryRow[] = [
  { id: 'INC-2284', title: 'Zendesk agent workspace slow to load', service: 'Zendesk', duration: '41m', closed: '2 days ago' },
  { id: 'INC-2281', title: 'Helpjuice search index rebuild', service: 'Helpjuice', duration: '2h 14m', closed: '4 days ago' },
  { id: 'INC-2279', title: 'Teams call quality degradation', service: 'Microsoft 365', duration: '1h 06m', closed: '6 days ago' },
  { id: 'INC-2277', title: 'Jira automation queue backlog', service: 'Jira', duration: '3h 48m', closed: '8 days ago' },
  { id: 'INC-2275', title: 'Claude API elevated error rate', service: 'Claude', duration: '27m', closed: '11 days ago' },
];

/** Check history is per service, not global: Jira's probes are not "Mailflow
 *  round trip", and a single shared array meant six of the seven detail pages
 *  showed m365's checks under another vendor's name. Each service names its own
 *  four probes and its rows are scaled from its own baseline latency. */
const PROBES: Record<ServiceId, [string, string, string, string]> = {
  m365: ['Mailflow round trip', 'Graph /me', 'OIDC token', 'Portal HTTP 200'],
  proofpoint: ['Mailflow round trip', 'Control Panel API', 'Quarantine list', 'Portal HTTP 200'],
  jira: ['REST /myself', 'Issue search', 'Webhook echo', 'Portal HTTP 200'],
  zendesk: ['API /users/me', 'Ticket search', 'Help centre fetch', 'Portal HTTP 200'],
  helpjuice: ['Search query', 'Article fetch', 'API /categories', 'Portal HTTP 200'],
  claude: ['Messages API', 'Token auth', 'Model list', 'Portal HTTP 200'],
  openai: ['Chat completions', 'Token auth', 'Model list', 'Portal HTTP 200'],
};

/** Newest first, at the prototype's 31/29-second cadence. The fifth row repeats
 *  the first probe from a fourth region, as the prototype's table does. */
const ROWS: { seconds: number; probe: 0 | 1 | 2 | 3; region: string; factor: number }[] = [
  { seconds: 41, probe: 0, region: 'us-east', factor: 1 },
  { seconds: 72, probe: 1, region: 'us-west', factor: 1 },
  { seconds: 101, probe: 2, region: 'eu-west', factor: 1.2 },
  { seconds: 132, probe: 3, region: 'us-east', factor: 0.7 },
  { seconds: 161, probe: 0, region: 'ap-south', factor: 1.4 },
];

const passing = (b: Base): CheckRun[] =>
  ROWS.map((r) => ({
    at: secondsAgo(r.seconds),
    check: PROBES[b.id][r.probe],
    region: r.region,
    result: 'pass' as const,
    latencyMs: Math.round(b.base * r.factor),
  }));

/** Written out per key rather than built with Object.fromEntries, so the type
 *  checks exhaustiveness for us: add an eighth ServiceId and this stops
 *  compiling, instead of silently producing a record with a missing entry. */
const everythingPassing = (): Record<ServiceId, CheckRun[]> => ({
  m365: passing(serviceBase('m365')),
  proofpoint: passing(serviceBase('proofpoint')),
  jira: passing(serviceBase('jira')),
  zendesk: passing(serviceBase('zendesk')),
  helpjuice: passing(serviceBase('helpjuice')),
  claude: passing(serviceBase('claude')),
  openai: passing(serviceBase('openai')),
});

export const quietCheckRuns: Record<ServiceId, CheckRun[]> = everythingPassing();

/** m365 in the Sev1 world. The tile says the mailflow probe is failing from
 *  us-east, us-west and eu-west and passing from ap-south — one of four — so the
 *  table has to show exactly that, by name. Flipping only the newest row left
 *  us-west and eu-west visibly green while the note called them failing.
 *  A timeout has no latency at all, so `latencyMs` is null and not 0; a zero
 *  would render as an extremely fast probe. */
const m365Sev1Runs: CheckRun[] = [
  { at: secondsAgo(41), check: 'Mailflow round trip', region: 'us-east', result: 'timeout', latencyMs: null },
  { at: secondsAgo(72), check: 'Mailflow round trip', region: 'us-west', result: 'timeout', latencyMs: null },
  { at: secondsAgo(101), check: 'Mailflow round trip', region: 'eu-west', result: 'timeout', latencyMs: null },
  { at: secondsAgo(132), check: 'Mailflow round trip', region: 'ap-south', result: 'pass', latencyMs: 294 },
  { at: secondsAgo(161), check: 'Graph /me', region: 'us-west', result: 'pass', latencyMs: 210 },
];

/** Proofpoint is slow, not failing: every probe passes, but the newest us-east
 *  round trip is above p95, which is what `ours.level: 'degraded'` with
 *  `passing: 3` of 4 means — one of the four is outside its objective. The
 *  latency is the same number the tile shows as `latencyMs`, read from
 *  services.ts, so the table and the stat quote one measurement. */
const proofpointSev1Runs: CheckRun[] = passing(serviceBase('proofpoint')).map((run, i) =>
  i === 0 ? { ...run, latencyMs: PROOFPOINT_SEV1_LATEST_MS } : run,
);

export const sev1CheckRuns: Record<ServiceId, CheckRun[]> = {
  ...everythingPassing(),
  m365: m365Sev1Runs,
  proofpoint: proofpointSev1Runs,
};
