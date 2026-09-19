import type { SourceResult, StatusLevel, VendorIncident } from '@ops-dash/shared';
import { fetchJson, type FetchLike } from '../../http/fetchJson.js';
import {
  asRecord,
  asString,
  labelFor,
  unknownVendor,
  worstLevel,
  type Vendor,
  type VendorFeed,
} from './common.js';

/**
 * Statuspage v2 — one adapter, four vendors (Jira, Helpjuice, Claude, OpenAI).
 *
 * Written against the PLATFORM, not the vendor: everything vendor-specific
 * lives in `vendors.json`, which is what makes a fifth Statuspage vendor a
 * config line. `index.test.ts` proves that rather than asserting it.
 *
 * Always `/api/v2/summary.json`, never `/api/v2/status.json` — the latter is a
 * page-level rollup with no components, incidents or maintenance.
 */

/** Statuspage's component vocabulary. These five words are the platform's
 *  whole published set; anything else is a word we have never seen and maps to
 *  `unknown`, never through a default to `operational`. */
export type StatuspageComponentStatus =
  | 'operational'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'
  | 'under_maintenance';

export const COMPONENT_STATUS: Record<StatuspageComponentStatus, StatusLevel> = {
  operational: 'operational',
  degraded_performance: 'degraded',
  // `partial_outage` is an outage for the subset of users it touches — they
  // cannot use the thing. `degraded_performance` is slow-but-working. The
  // distinction is the reason our scale has both words.
  partial_outage: 'outage',
  major_outage: 'outage',
  under_maintenance: 'maintenance',
};

/** Statuspage's incident-impact vocabulary. `none` maps to `unknown` and not to
 *  `operational`: an incident that states no impact has made no statement of
 *  health, and this codebase never turns an absence into green. */
export const INCIDENT_IMPACT: Record<'none' | 'minor' | 'major' | 'critical' | 'maintenance', StatusLevel> = {
  none: 'unknown',
  minor: 'degraded',
  major: 'outage',
  critical: 'outage',
  maintenance: 'maintenance',
};

export function mapComponentStatus(raw: unknown): StatusLevel {
  const word = asString(raw);
  if (word !== undefined && Object.hasOwn(COMPONENT_STATUS, word)) {
    return COMPONENT_STATUS[word as StatuspageComponentStatus];
  }
  return 'unknown';
}

function mapImpact(raw: unknown): StatusLevel {
  const word = asString(raw);
  if (word !== undefined && Object.hasOwn(INCIDENT_IMPACT, word)) {
    return INCIDENT_IMPACT[word as keyof typeof INCIDENT_IMPACT];
  }
  return 'unknown';
}

type ParseOutcome = { vendor: Vendor; degraded: boolean };

/** Pure: a decoded body plus the config row in, the vendor half of a tile out.
 *  Separated from the transport so every branch below is reachable in a test
 *  without a stub server. */
export function parseStatuspage(body: unknown, feed: VendorFeed): ParseOutcome {
  const doc = asRecord(body);
  if (doc === null) {
    return {
      vendor: unknownVendor(feed.platform, 'The feed returned JSON that is not a Statuspage summary object.'),
      degraded: false,
    };
  }

  const page = asRecord(doc.page);
  const pageUrl = page ? asString(page.url) : undefined;
  const updatedAt = page ? asString(page.updated_at) : undefined;
  const indicator = asRecord(doc.status);
  const description = indicator ? asString(indicator.description) : undefined;

  // Incidents and maintenance are optional at the top level. That is not
  // defensive coding: OpenAI's summary.json publishes neither key, captured
  // 2026-09-19 and asserted in the test suite.
  const incidentsRaw = doc.incidents;
  const incidentsUnusable = incidentsRaw !== undefined && !Array.isArray(incidentsRaw);
  const incidents = Array.isArray(incidentsRaw) ? incidentsRaw : [];
  const maintenancesRaw = doc.scheduled_maintenances;
  const maintenances = Array.isArray(maintenancesRaw) ? maintenancesRaw : [];

  const components = Array.isArray(doc.components) ? doc.components : null;
  if (components === null) {
    return {
      vendor: unknownVendor(
        feed.platform,
        'The feed published no components array, so there is nothing to read a level from.',
      ),
      degraded: false,
    };
  }

  let level: StatusLevel;
  let source: string;

  if (feed.component !== undefined) {
    const wanted = feed.component;
    const found = components
      .map(asRecord)
      .find((c) => c !== null && asString(c.name)?.toLowerCase() === wanted.toLowerCase());
    if (found === undefined || found === null) {
      return {
        vendor: unknownVendor(
          feed.platform,
          `The component "${wanted}" we watch is not in the feed; ${components.length} other components were published. A component that disappears is not a component that is healthy.`,
        ),
        degraded: false,
      };
    }
    level = mapComponentStatus(found.status);
    source = `Statuspage reports "${wanted}" as ${String(found.status)}.`;
  } else if (components.length === 0) {
    return {
      vendor: unknownVendor(feed.platform, 'The feed published an empty components list and made no statement of health.'),
      degraded: false,
    };
  } else {
    const levels = components.map((c) => mapComponentStatus(asRecord(c)?.status));
    level = worstLevel(levels);
    const worstCount = levels.filter((l) => l === level).length;
    source =
      level === 'operational'
        ? `Statuspage reports all ${components.length} components operational.`
        : `Statuspage reports ${worstCount} of ${components.length} components ${level}.`;
  }

  const open = incidents.map(asRecord).filter((i): i is Record<string, unknown> => i !== null && !asString(i.resolved_at));
  const advisoryId = open.length > 0 ? asString(open[0]?.id) : undefined;
  const maintenance = firstMaintenance(maintenances);

  const note = [
    source,
    description === undefined ? '' : `Page status: ${description}.`,
    updatedAt === undefined ? '' : `Last vendor update ${updatedAt}.`,
    incidentsUnusable ? 'The feed’s incidents field was not a list, so no incident history could be read.' : '',
  ]
    .filter((s) => s !== '')
    .join(' ');

  return {
    vendor: {
      platform: feed.platform,
      level,
      label: labelFor(level),
      note,
      incidentsSince: incidents.map(asRecord).flatMap((i) => (i === null ? [] : [toVendorIncident(i)])),
      ...(advisoryId === undefined ? {} : { advisoryId }),
      ...(pageUrl === undefined ? {} : { url: pageUrl }),
      ...(maintenance === undefined ? {} : { maintenance }),
    },
    degraded: incidentsUnusable,
  };
}

function toVendorIncident(incident: Record<string, unknown>): VendorIncident {
  const resolvedAt = asString(incident.resolved_at);
  const url = asString(incident.shortlink);
  return {
    id: asString(incident.id) ?? 'unknown',
    title: asString(incident.name) ?? 'Untitled incident',
    level: mapImpact(incident.impact),
    startedAt: asString(incident.started_at) ?? asString(incident.created_at) ?? '',
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    ...(url === undefined ? {} : { url }),
  };
}

function firstMaintenance(maintenances: unknown[]): Vendor['maintenance'] {
  for (const raw of maintenances) {
    const m = asRecord(raw);
    if (m === null || asString(m.status) === 'completed') continue;
    const scheduledFor = asString(m.scheduled_for);
    const scheduledUntil = asString(m.scheduled_until);
    if (scheduledFor === undefined || scheduledUntil === undefined) continue;
    return { title: asString(m.name) ?? 'Scheduled maintenance', scheduledFor, scheduledUntil };
  }
  return undefined;
}

/**
 * Poll one Statuspage vendor.
 *
 * The call goes through `fetchJson` and nowhere else, so all four failure rules
 * apply before a single byte of vendor vocabulary is read. A failure is
 * returned as `unknown` WITH the helper's error intact on the envelope — the
 * level says what to render, the error says what went wrong, and neither is
 * allowed to become the other.
 */
export async function pollStatuspage(feed: VendorFeed, fetchImpl?: FetchLike): Promise<SourceResult<Vendor>> {
  const result = await fetchJson<unknown>(feed.url, fetchImpl === undefined ? {} : { fetchImpl });

  if (result.error !== undefined) {
    return {
      ...result,
      data: unknownVendor(
        feed.platform,
        `We could not read the vendor feed (${result.error.code}: ${result.error.message}). This is our failure to look, not a statement of health.`,
      ),
    };
  }

  if (result.empty === true) {
    return {
      ...result,
      data: unknownVendor(feed.platform, 'The feed responded but carried no records, which is not an assertion of health.'),
    };
  }

  const { vendor, degraded } = parseStatuspage(result.data, feed);
  return { ...result, data: vendor, degraded: result.degraded || degraded };
}
