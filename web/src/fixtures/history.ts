import type { CheckRun } from '@ops-dash/shared';
import { secondsAgo } from './time.js';

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
 *  placeholder ten to the seven verified vendors. Identical in both modes: these
 *  are closed, so the quiet/Sev1 switch does not change them. */
export const recentHistory: HistoryRow[] = [
  { id: 'INC-2284', title: 'Zendesk agent workspace slow to load', service: 'Zendesk', duration: '41m', closed: '2 days ago' },
  { id: 'INC-2281', title: 'Helpjuice search index rebuild', service: 'Helpjuice', duration: '2h 14m', closed: '4 days ago' },
  { id: 'INC-2279', title: 'Teams call quality degradation', service: 'Microsoft 365', duration: '1h 06m', closed: '6 days ago' },
  { id: 'INC-2277', title: 'Jira automation queue backlog', service: 'Jira', duration: '3h 48m', closed: '8 days ago' },
  { id: 'INC-2275', title: 'Claude API elevated error rate', service: 'Claude', duration: '27m', closed: '11 days ago' },
];

/** Check history for the selected service, newest first, at the prototype's
 *  31/29-second cadence. Latencies are m365's baseline of 210 ms and its
 *  multiples, matching the prototype's `checkRows`. */
export const quietCheckRuns: CheckRun[] = [
  { at: secondsAgo(41), check: 'Mailflow round trip', region: 'us-east', result: 'pass', latencyMs: 210 },
  { at: secondsAgo(72), check: 'Graph /me', region: 'us-west', result: 'pass', latencyMs: 210 },
  { at: secondsAgo(101), check: 'OIDC token', region: 'eu-west', result: 'pass', latencyMs: 252 },
  { at: secondsAgo(132), check: 'Portal HTTP 200', region: 'us-east', result: 'pass', latencyMs: 147 },
  { at: secondsAgo(161), check: 'Mailflow round trip', region: 'ap-south', result: 'pass', latencyMs: 294 },
];

/** The us-east mailflow round trip times out; ap-south is the one probe of four
 *  still passing, which is what `ours.passing: 1` of `total: 4` means. A timeout
 *  has no latency at all, so `latencyMs` is null rather than 0 — a zero would
 *  render as a very fast probe. */
export const sev1CheckRuns: CheckRun[] = [
  { at: secondsAgo(41), check: 'Mailflow round trip', region: 'us-east', result: 'timeout', latencyMs: null },
  ...quietCheckRuns.slice(1),
];
