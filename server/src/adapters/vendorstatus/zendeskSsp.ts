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
 * Zendesk's own SSP feed — the reason amendment 4 exists.
 *
 * There is **no per-service status field anywhere in this platform**. Neither
 * `services.json` nor `incidents.json` carries one; that was confirmed against
 * the captured bytes in `__fixtures__/`, not inferred from documentation. The
 * only signal resembling health is "no incident is currently open", which is an
 * **absence**, and an absence is not an affirmation. So this adapter can return
 * `degraded`, `outage` or `unknown`, and **never `operational`**. A future
 * reader will see a working feed returning nothing and be tempted to call it
 * healthy; this comment and the note on every result exist to stop them.
 *
 * Two documents, joined JSON:API style: `incidents.json` carries the incidents
 * and `included[]` carries one `incidentService` row per affected service.
 * `feed.url` is the SSP base and the adapter appends the document names.
 */

/** Zendesk's impact words, used only when the explicit `outage` / `degradation`
 *  booleans on the incident say nothing. */
export const ZENDESK_IMPACT: Record<'minor' | 'major' | 'critical', StatusLevel> = {
  minor: 'degraded',
  major: 'outage',
  critical: 'outage',
};

type SspIncident = {
  id: string;
  name: string;
  level: StatusLevel;
  startedAt: string;
  resolvedAt: string | undefined;
  url: string | undefined;
  serviceIds: string[];
};

function incidentLevel(attrs: Record<string, unknown>): StatusLevel {
  if (attrs.outage === true) return 'outage';
  if (attrs.degradation === true) return 'degraded';
  const impact = asString(attrs.impact);
  if (impact !== undefined && Object.hasOwn(ZENDESK_IMPACT, impact)) {
    return ZENDESK_IMPACT[impact as keyof typeof ZENDESK_IMPACT];
  }
  return 'unknown';
}

function toVendorIncident(i: SspIncident): VendorIncident {
  return {
    id: i.id,
    title: i.name,
    level: i.level,
    startedAt: i.startedAt,
    ...(i.resolvedAt === undefined ? {} : { resolvedAt: i.resolvedAt }),
    ...(i.url === undefined ? {} : { url: i.url }),
  };
}

/** `included[]` maps an incidentService row id to the service it names. */
function serviceNamesById(included: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(included)) return map;
  for (const raw of included) {
    const row = asRecord(raw);
    const attrs = row === null ? null : asRecord(row.attributes);
    const id = row === null ? undefined : asString(row.id);
    const name = attrs === null ? undefined : asString(attrs.serviceName);
    if (id !== undefined && name !== undefined) map.set(id, name);
  }
  return map;
}

function readIncidents(body: unknown): SspIncident[] | null {
  const doc = asRecord(body);
  const rows = Array.isArray(body) ? body : doc !== null && Array.isArray(doc.data) ? doc.data : null;
  if (rows === null) return null;
  const names = serviceNamesById(doc?.included);

  return rows.flatMap((raw) => {
    const row = asRecord(raw);
    const attrs = row === null ? null : asRecord(row.attributes);
    if (row === null || attrs === null) return [];
    const rel = asRecord(asRecord(row.relationships)?.incidentServices);
    const serviceRows = Array.isArray(rel?.data) ? rel.data : [];
    const serviceIds = serviceRows.flatMap((s) => {
      const id = asString(asRecord(s)?.id);
      const name = id === undefined ? undefined : names.get(id);
      return name === undefined ? [] : [name];
    });
    return [
      {
        id: asString(row.id) ?? 'unknown',
        name: asString(attrs.name) ?? 'Untitled incident',
        level: incidentLevel(attrs),
        startedAt: asString(attrs.startedAt) ?? '',
        // `resolvedAt`, NOT `status`. Zendesk leaves `status` stale: incident
        // 10079 in the captured feed is still "monitoring" two months after it
        // resolved. Reading `status` shows a July outage as open forever.
        resolvedAt: asString(attrs.resolvedAt),
        url: asString(attrs.postmortem),
        serviceIds,
      },
    ];
  });
}

function publishedServiceNames(body: unknown): string[] {
  const rows = asRecord(body)?.data;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw) => {
    const name = asString(asRecord(asRecord(raw)?.attributes)?.name);
    return name === undefined ? [] : [name];
  });
}

const ABSENCE_NOTE =
  'Zendesk SSP publishes no per-service status field, so the only green signal available is the absence of an open incident — and an absence is not an affirmation (amendment 4). Reading is global Zendesk, not necessarily our pod.';

export async function pollZendeskSsp(feed: VendorFeed, fetchImpl?: FetchLike): Promise<SourceResult<Vendor>> {
  const base = feed.url.replace(/\/+$/, '');
  const opts = fetchImpl === undefined ? {} : { fetchImpl };
  const wanted = feed.component;

  // services.json is fetched only when we are watching one named service: it
  // exists here to prove that service is still published. A service that
  // disappears must read unknown, not quietly drop out of a rollup.
  if (wanted !== undefined) {
    const services = await fetchJson<unknown>(`${base}/services.json`, opts);
    if (services.error !== undefined) {
      return {
        ...services,
        data: unknownVendor(
          feed.platform,
          `We could not read the Zendesk service list (${services.error.code}: ${services.error.message}). This is our failure to look, not a statement of health.`,
        ),
      };
    }
    const names = publishedServiceNames(services.data);
    if (!names.some((n) => n.toLowerCase() === wanted.toLowerCase())) {
      return {
        ...services,
        data: unknownVendor(
          feed.platform,
          `The Zendesk service "${wanted}" we watch is no longer published; ${names.length} other services were listed. A service that disappears is not a service that is healthy.`,
        ),
      };
    }
  }

  const result = await fetchJson<unknown>(`${base}/incidents.json`, opts);

  if (result.error !== undefined) {
    return {
      ...result,
      data: unknownVendor(
        feed.platform,
        `We could not read the Zendesk incident feed (${result.error.code}: ${result.error.message}). This is our failure to look, not a statement of health.`,
      ),
    };
  }

  const all = readIncidents(result.data);
  if (all === null) {
    return {
      ...result,
      data: unknownVendor(feed.platform, `The Zendesk incident feed returned a shape we do not recognise. ${ABSENCE_NOTE}`),
    };
  }

  const mine =
    wanted === undefined
      ? all
      : all.filter((i) => i.serviceIds.some((n) => n.toLowerCase() === wanted.toLowerCase()));
  const open = mine.filter((i) => i.resolvedAt === undefined);
  const scope = wanted === undefined ? 'Zendesk' : `Zendesk ${wanted}`;

  const level = open.length === 0 ? 'unknown' : worstLevel(open.map((i) => i.level));
  const note =
    open.length === 0
      ? `${ABSENCE_NOTE} ${mine.length} incident${mine.length === 1 ? '' : 's'} published for ${scope}, none open.`
      : `Zendesk SSP reports ${open.length} open incident${open.length === 1 ? '' : 's'} for ${scope}: ${open
          .map((i) => i.name)
          .join('; ')}.`;

  const advisoryId = open[0]?.id;
  // `empty` from the adapter, not the helper: the document is an object with
  // `data` and `included` keys even when nothing is published, so the
  // transport cannot see that it carried no records. Amendment 4's `empty`
  // still has to be told the truth.
  const empty = result.empty === true || mine.length === 0;

  return {
    ...result,
    ...(empty ? { empty: true } : {}),
    data: {
      platform: feed.platform,
      level,
      label: labelFor(level),
      note,
      incidentsSince: mine.map(toVendorIncident),
      ...(advisoryId === undefined ? {} : { advisoryId }),
      url: new URL(base).origin,
    },
  };
}
