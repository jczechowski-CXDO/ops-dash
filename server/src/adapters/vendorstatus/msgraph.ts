import type { SourceResult, StatusLevel, VendorIncident } from '@ops-dash/shared';
import { fetchJson, type FetchLike } from '../../http/fetchJson.js';
import type { TokenSource } from '../../http/graphToken.js';
import { asRecord, asString, labelFor, unknownVendor, worstLevel, type Vendor, type VendorFeed } from './common.js';

/**
 * Microsoft 365, via Graph's service-health API.
 *
 * The first adapter that needs a credential, and the only one. Everything else
 * in this directory reads a public page; this one is app-only auth by
 * certificate — see `http/graphToken.ts`, which owns all of that and hands back
 * a bearer token or a reason.
 *
 * **The service list is the whole design problem here.** Graph reports 32
 * services and Microsoft always has something degraded somewhere: on the day
 * this was written, nine of the thirty-two were, including three Copilot
 * products nobody here has ever opened. Rolling up all of them would leave the
 * M365 tile permanently amber, which teaches the operator to ignore it — the
 * same failure as a permanently-red tile, for the third time in this codebase.
 *
 * So `components` names what we actually depend on. It is a config line, and
 * changing it needs no code.
 */

/**
 * Graph's `serviceHealthStatus`, mapped to our five levels.
 *
 * Only `serviceOperational` and `serviceDegradation` have been observed live;
 * the rest are from Microsoft's published enumeration and are marked, because a
 * mapping nobody has watched fire can be wrong for a long time quietly.
 *
 * The judgement calls, stated rather than buried:
 *
 *   - the *investigating / restoring / verifying* family is `degraded`, not
 *     `outage`. Microsoft is telling us something is wrong and it does not yet
 *     know how badly; `degraded` says that honestly and `outage` overstates it.
 *   - `serviceInterruption` is the only `outage`. It is Microsoft's word for
 *     "users cannot use this".
 *   - the *resolved / mitigated / falsePositive* family is `operational`. A
 *     resolved incident is a healthy service with history, and the history
 *     belongs in `incidentsSince`, not in the level.
 *   - `extendedRecovery` is `degraded`: the incident is fixed but users are
 *     still feeling it, which is exactly what degraded means.
 */
export const GRAPH_HEALTH: Record<string, StatusLevel> = {
  serviceOperational: 'operational',          // observed
  serviceDegradation: 'degraded',             // observed
  serviceInterruption: 'outage',
  investigating: 'degraded',
  restoringService: 'degraded',
  verifyingService: 'degraded',
  extendedRecovery: 'degraded',
  confirmed: 'degraded',
  reported: 'degraded',
  investigationSuspended: 'degraded',
  serviceRestored: 'operational',
  resolved: 'operational',
  resolvedExternal: 'operational',
  mitigated: 'operational',
  mitigatedExternal: 'operational',
  falsePositive: 'operational',
  postIncidentReviewPublished: 'operational',
};

export const HEALTH_OVERVIEWS_URL = 'https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews';

/** An unrecognised status is `unknown`, never `operational`. Microsoft adds to
 *  this enumeration, and the one thing a new value must not do is read healthy. */
function levelOf(status: unknown): StatusLevel {
  return typeof status === 'string' && status in GRAPH_HEALTH ? GRAPH_HEALTH[status]! : 'unknown';
}

type Overview = { service: string; level: StatusLevel; raw: string };

function readOverviews(body: unknown): Overview[] | null {
  const root = asRecord(body);
  const value = root?.['value'];
  if (!Array.isArray(value)) return null;
  const out: Overview[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (rec === null) return null;
    const service = asString(rec['service']);
    if (service === undefined) return null;
    out.push({ service, level: levelOf(rec['status']), raw: asString(rec['status']) ?? 'unknown' });
  }
  return out;
}

export async function pollMsgraph(
  feed: VendorFeed,
  fetchImpl: FetchLike | undefined,
  tokens: TokenSource,
): Promise<SourceResult<Vendor>> {
  const fetchedAt = new Date().toISOString();
  const auth = await tokens.get();
  if ('error' in auth) {
    // Auth failure is a failure to LOOK, not a statement about Microsoft.
    return {
      fetchedAt,
      degraded: false,
      error: auth.error,
      data: unknownVendor(
        feed.platform,
        `We could not authenticate to Microsoft Graph (${auth.error.code}). This is our failure to look, not a statement of health.`,
      ),
    };
  }

  const opts = {
    headers: { authorization: `Bearer ${auth.token}` },
    ...(fetchImpl ? { fetchImpl } : {}),
  };
  const result = await fetchJson<unknown>(feed.url, opts);

  if (result.error !== undefined) {
    return {
      ...result,
      data: unknownVendor(
        feed.platform,
        `We could not read Microsoft Graph service health (${result.error.code}: ${result.error.message}). This is our failure to look, not a statement of health.`,
      ),
    };
  }

  const all = readOverviews(result.data);
  if (all === null) {
    return {
      ...result,
      data: unknownVendor(feed.platform, 'Graph service health returned a shape we do not recognise, so we cannot say how Microsoft 365 is.'),
    };
  }

  // Narrow to what we depend on. Absent means roll up everything, which is
  // honest but noisy — see the block comment.
  const wanted = feed.components;
  const mine = wanted === undefined ? all : all.filter((o) => wanted.includes(o.service));

  // A service we named that Graph no longer reports is `unknown`, never a
  // quietly shorter list that still reads healthy. Same rule as every other
  // adapter in this directory.
  const missing = wanted === undefined ? [] : wanted.filter((w) => !all.some((o) => o.service === w));
  if (missing.length > 0) {
    return {
      ...result,
      data: unknownVendor(
        feed.platform,
        `Graph no longer reports ${missing.length} service${missing.length === 1 ? '' : 's'} we watch (${missing.join(', ')}); ${all.length} others were listed. A service that disappears is not a service that is healthy.`,
      ),
    };
  }

  if (mine.length === 0) {
    return {
      ...result,
      data: unknownVendor(feed.platform, 'Graph service health published no services to roll up.'),
    };
  }

  const level = worstLevel(mine.map((o) => o.level));
  const notOk = mine.filter((o) => o.level !== 'operational');
  const note =
    notOk.length === 0
      ? `Microsoft Graph reports all ${mine.length} services we depend on operational.`
      : `Microsoft Graph reports ${notOk.length} of ${mine.length} services we depend on not operational: ${notOk
          .map((o) => `${o.service} (${o.raw})`)
          .join('; ')}.`;

  const incidentsSince: VendorIncident[] = notOk.map((o) => ({
    id: o.service,
    title: `${o.service}: ${o.raw}`,
    level: o.level,
    startedAt: result.fetchedAt,
  }));

  return {
    ...result,
    data: {
      platform: feed.platform,
      level,
      label: labelFor(level),
      note,
      incidentsSince,
      url: 'https://admin.microsoft.com/#/servicehealth',
    },
  };
}
