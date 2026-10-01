import type { AlertRule, Integration } from '@ops-dash/shared';
import { secondsAgo, minutesAgo } from './time.js';

/** The six rules of DATA_CONTRACTS section 7, in the prototype's order, with its
 *  defaults: `stale` is the one disabled rule. `threshold` is omitted, not set to
 *  undefined, on the three rules that have no numeric threshold —
 *  exactOptionalPropertyTypes makes an explicit undefined a type error. */
export const rules: AlertRule[] = [
  { key: 'vendor', name: 'Vendor degraded + our check failing', detail: 'Opens a Sev1 automatically', enabled: true },
  { key: 'spray', name: 'Failed sign-in spike', detail: 'More than 500 failures in 15 minutes', enabled: true, threshold: { failures: 500, windowMinutes: 15 } },
  { key: 'risky', name: 'Risky sign-in confirmed compromised', detail: 'Any single occurrence', enabled: true },
  { key: 'secrets', name: 'Secret or certificate expiring', detail: 'Within 14 days', enabled: true, threshold: { days: 14 } },
  { key: 'stale', name: 'Agent stale', detail: 'No check-in for 21 days', enabled: false, threshold: { days: 21 } },
  { key: 'legacy', name: 'Legacy auth attempt', detail: 'Any successful legacy protocol sign-in', enabled: true },
];

/** The prototype's integration list, with two reconciliations. The vendor feed
 *  names the seven verified vendors instead of the placeholder AWS/Okta list, and
 *  the needs_auth row is the real blocker — M365 Service Health has no public
 *  per-workload feed, so Graph is the only path and its consent is still pending.
 *  The row with no successful poll behind it has `lastSuccessAt` omitted. */
export const integrations: Integration[] = [
  { key: 'graph', name: 'Microsoft Graph', detail: 'App-only, certificate auth · CXDO-GraphExport', state: 'connected', stateLabel: 'Connected', lastSuccessAt: secondsAgo(41) },
  { key: 'epc', name: 'Endpoint Central Cloud', detail: 'Zoho OAuth self-client · read-only', state: 'connected', stateLabel: 'Connected', lastSuccessAt: minutesAgo(4) },
  { key: 'stellar', name: 'Stellar Cyber XDR', detail: 'Tenant API token · read-only', state: 'connected', stateLabel: 'Connected', lastSuccessAt: minutesAgo(2) },
  { key: 'proofpoint', name: 'Proofpoint 365 TP', detail: 'Hornetsecurity Control Panel API', state: 'connected', stateLabel: 'Connected', lastSuccessAt: minutesAgo(1) },
  { key: 'vendorstatus', name: 'Vendor status feeds', detail: 'Hornetsecurity, Jira, Helpjuice, Claude, OpenAI, Zendesk', state: 'polling', stateLabel: 'Polling 60s', lastSuccessAt: secondsAgo(41) },
  { key: 'm365health', name: 'M365 Service Health', detail: 'ServiceHealth.Read.All + ServiceMessage.Read.All consent pending', state: 'needs_auth', stateLabel: 'Needs auth' },
];
