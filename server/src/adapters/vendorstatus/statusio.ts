import type { SourceResult, StatusLevel, VendorIncident } from '@ops-dash/shared';
import { fetchJson, type FetchLike } from '../../http/fetchJson.js';
import { asRecord, asString, labelFor, unknownVendor, worstLevel, type Vendor, type VendorFeed } from './common.js';

/**
 * status.io — Hornetsecurity's platform, which is where Proofpoint's status
 * actually lives for this estate.
 *
 * Unlike Zendesk, this platform **does** publish health: every service carries
 * a `status_code`, and so does every `container` beneath it. So no amendment-10
 * inference is needed or permitted here — the vendor speaks for itself.
 *
 * **Containers are datacentres, and filtering to ours is the point.** The feed
 * lists ten: Frankfurt, Montreal, Lille, Hannover, Düsseldorf, London, Central
 * Switzerland, Europe-West, and two United States entries. Without a filter a
 * Frankfurt outage lands on our tile, which is the Zendesk pod lesson in a
 * different shape — a tile whose incidents are usually about someone else's
 * region is a tile the operator stops reading.
 *
 * Our region is named **two ways**, and they are mutually exclusive rather than
 * duplicates. Measured 2026-09-19 across all 19 services:
 *
 *   United States - Atlanta   13 services   the core email estate — Mail Traffic,
 *                                           Spam and Malware Protection, ATP,
 *                                           Email Archiving, Control Panel, ...
 *   United States - Georgia    3 services   the newer 365 products — Permission
 *                                           Manager, Multi Tenant Manager, Total Backup
 *
 * No service carries both. Atlanta is in Georgia, so this is one region labelled
 * differently by product line, and `locations` must list both or a third of the
 * estate silently drops out of the rollup.
 */

/**
 * status.io's component status scheme.
 *
 * Only 100 and 200 have been observed live; the rest are from status.io's
 * published table and are marked as such, because a mapping nobody has seen
 * fire is a mapping that can be wrong for a long time without anyone noticing.
 *
 * The trap worth naming: status.io reuses these numbers. On an *incident* the
 * same field means Investigating / Identified / Monitoring / Resolved, so 100
 * is "Operational" here and "Investigating" one object over. This map is for
 * component and container status only.
 */
export const STATUSIO_CODE: Record<number, StatusLevel> = {
  100: 'operational',   // observed
  200: 'maintenance',   // observed — "Planned Maintenance"
  300: 'degraded',      // documented: Degraded Performance
  400: 'degraded',      // documented: Partial Service Disruption
  500: 'outage',        // documented: Service Disruption
  600: 'outage',        // documented: Security Event — we cannot serve mail through it either way
};

type Container = { name: string; level: StatusLevel };
type Service = { id: string; name: string; level: StatusLevel; containers: Container[] };

/** A code we do not recognise is `unknown`, never `operational`. status.io could
 *  add a 700 tomorrow and the one thing it must not do is read as healthy. */
function levelOf(code: unknown): StatusLevel {
  return typeof code === 'number' && code in STATUSIO_CODE ? STATUSIO_CODE[code]! : 'unknown';
}

function readServices(body: unknown): Service[] | null {
  const root = asRecord(body);
  const result = root && asRecord(root['result']);
  const raw = result?.['status'];
  if (!Array.isArray(raw)) return null;

  const services: Service[] = [];
  for (const entry of raw) {
    const s = asRecord(entry);
    if (!s) return null;
    const name = asString(s['name']);
    if (name === undefined) return null;
    const containers: Container[] = [];
    if (Array.isArray(s['containers'])) {
      for (const c of s['containers']) {
        const rec = asRecord(c);
        if (rec === null) continue;
        const cname = asString(rec['name']);
        if (cname === undefined) continue;
        containers.push({ name: cname, level: levelOf(rec['status_code']) });
      }
    }
    services.push({ id: asString(s['id']) ?? name, name, level: levelOf(s['status_code']), containers });
  }
  return services;
}

/** Open incidents, for `incidentsSince`. status.io keeps resolved ones in a
 *  separate document, so everything in `result.incidents` is live. */
function readIncidents(body: unknown): VendorIncident[] {
  const root = asRecord(body);
  const result = root && asRecord(root['result']);
  const raw = result?.['incidents'];
  if (!Array.isArray(raw)) return [];
  const out: VendorIncident[] = [];
  for (const entry of raw) {
    const i = asRecord(entry);
    if (!i) continue;
    const title = asString(i['name']);
    if (title === undefined) continue;
    // `status_overall.status_code` on an incident is its STATE (investigating /
    // identified / monitoring / resolved), not a health level — see the note on
    // STATUSIO_CODE. The health of the affected services is read from the
    // service rows, so an incident contributes its title and time, not a level.
    out.push({
      id: asString(i['_id']) ?? asString(i['id']) ?? title,
      title,
      level: 'degraded',
      startedAt: asString(i['datetime_open']) ?? asString(i['created_at']) ?? new Date().toISOString(),
    });
  }
  return out;
}

export async function pollStatusio(feed: VendorFeed, fetchImpl?: FetchLike): Promise<SourceResult<Vendor>> {
  const opts = fetchImpl === undefined ? {} : { fetchImpl };
  const result = await fetchJson<unknown>(feed.url, opts);

  if (result.error !== undefined) {
    return {
      ...result,
      data: unknownVendor(
        feed.platform,
        `We could not read the status.io feed (${result.error.code}: ${result.error.message}). This is our failure to look, not a statement of health.`,
      ),
    };
  }

  const services = readServices(result.data);
  if (services === null) {
    return {
      ...result,
      data: unknownVendor(feed.platform, 'The status.io feed returned a shape we do not recognise, so we cannot say how Proofpoint is.'),
    };
  }

  // Narrow to the services we watch, if the feed names any. Same contract as
  // every other adapter: a named service that stops being published is
  // `unknown`, never a quietly shorter list that still reads healthy.
  const wanted = feed.component;
  const named = wanted === undefined ? services : services.filter((s) => s.name.toLowerCase() === wanted.toLowerCase());
  if (wanted !== undefined && named.length === 0) {
    return {
      ...result,
      data: unknownVendor(
        feed.platform,
        `The status.io service "${wanted}" we watch is no longer published; ${services.length} others were listed. A service that disappears is not a service that is healthy.`,
      ),
    };
  }

  // Narrow to our datacentres. A service with containers but none of ours is
  // not served to us from there at all, so it is dropped rather than rolled up
  // — including it would put another region's outage on our tile.
  const here = feed.locations;
  const relevant = here === undefined
    ? named.map((s) => ({ name: s.name, level: s.level }))
    : named
        .map((s) => ({ name: s.name, matched: s.containers.filter((c) => here.includes(c.name)) }))
        .filter((s) => s.matched.length > 0)
        .map((s) => ({ name: s.name, level: worstLevel(s.matched.map((c) => c.level)) }));

  if (relevant.length === 0) {
    return {
      ...result,
      data: unknownVendor(
        feed.platform,
        here === undefined
          ? 'The status.io feed published no services to roll up.'
          : `No status.io service is published for ${here.join(' or ')}. Either the datacentre names changed or we are reading the wrong ones — both mean we cannot see Proofpoint, which is not the same as Proofpoint being well.`,
      ),
    };
  }

  const level = worstLevel(relevant.map((s) => s.level));
  const notOk = relevant.filter((s) => s.level !== 'operational');
  const where = here === undefined ? '' : ` in ${here.join(' / ')}`;
  const note =
    notOk.length === 0
      ? `status.io reports all ${relevant.length} Hornetsecurity services${where} operational.`
      : `status.io reports ${notOk.length} of ${relevant.length} Hornetsecurity services${where} not operational: ${notOk
          .map((s) => `${s.name} (${labelFor(s.level)})`)
          .join('; ')}.`;

  const incidents = readIncidents(result.data);

  return {
    ...result,
    data: {
      platform: feed.platform,
      level,
      label: labelFor(level),
      note,
      incidentsSince: incidents,
      ...(incidents[0] === undefined ? {} : { advisoryId: incidents[0].id }),
      url: 'https://live.hornet-status.com/',
    },
  };
}
