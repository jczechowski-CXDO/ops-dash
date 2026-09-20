import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServiceId, ServiceStatus, StatusLevel, VendorPlatform } from '@ops-dash/shared';

// fileURLToPath, not URL.pathname — a repo path containing a space comes back
// percent-encoded from the latter. Same defect as G-1 in docs/RESUME.md.
const HERE = dirname(fileURLToPath(import.meta.url));

/** One row of `vendors.json`. The platform decides which adapter runs; the id
 *  decides which tile the answer lands on. They are independent on purpose:
 *  a vendor can move platform without becoming a different service, and
 *  `platform` is therefore read from config and NEVER inferred from `id`. */
export type VendorFeed = {
  id: ServiceId;
  platform: VendorPlatform;
  url: string;
  /** Optional narrowing to one published component/service by name. Absent
   *  means "roll up everything the feed publishes". Present means the feed
   *  MUST publish it — a component that disappears is `unknown`, never a
   *  quietly shorter list that still reads healthy. */
  component?: string;
  /**
   * Our tenant on this vendor, when the vendor scopes its feed by one.
   *
   * Zendesk is the reason this exists. `status.zendesk.com` answers globally by
   * default — every incident on every pod worldwide — but
   * `?subdomain=<ours>` resolves the account to the pod it lives on and returns
   * only what affects it. Measured 2026-09-19: 17 global incidents become 10 on
   * Pod 23 (East Coast US, N. Virginia, AWS), which is where both Crexendo
   * subdomains sit. Seven of the seventeen were about infrastructure we are not
   * on, and an operator who learns that our incidents are usually irrelevant
   * has learned to ignore the tile.
   *
   * A LIST, because we have two — `crexendo` and `netsapiens`. Both sit on Pod
   * 23 today, so one query would happen to cover both, and that is exactly the
   * coincidence not to build on: the day either is migrated, a single-tenant
   * feed stops covering the other one silently, and silently is the only way
   * this product is allowed to fail at nothing.
   *
   * Not a credential and not sensitive: the subdomain is public, and Zendesk's
   * own documentation says the status page "is visible to anyone who knows your
   * Zendesk subdomain".
   */
  tenants?: string[];
  /**
   * The vendor's datacentres that actually serve us, when the vendor publishes
   * per-location health.
   *
   * status.io is the reason this exists. Hornetsecurity publishes ten
   * `containers` — Frankfurt, Montreal, Lille, Hannover, Düsseldorf, London,
   * Central Switzerland, Europe-West and two United States entries — and
   * without a filter a Frankfurt outage lands on our tile. Same shape as
   * `tenants`, different axis: that one narrows WHOSE account, this one narrows
   * WHERE it runs.
   *
   * Ours is named two ways and they are mutually exclusive, not duplicates:
   * `United States - Atlanta` carries the 13 core email services and
   * `United States - Georgia` the 3 newer 365 products. Listing only one
   * silently drops a third of the estate from the rollup.
   */
  locations?: string[];
  /**
   * Several named services to roll up, where `component` names one.
   *
   * Microsoft Graph is the reason. It reports 32 services and Microsoft always
   * has something degraded somewhere — nine of the thirty-two on the day this
   * was written, three of them Copilot products nobody here has opened. Rolling
   * up all of them leaves the tile permanently amber, which teaches the operator
   * to ignore it. Naming what we depend on is the difference between a tile that
   * means something and one that does not.
   *
   * Same contract as `component`: a named service the feed stops publishing is
   * `unknown`, never a quietly shorter list that still reads healthy.
   */
  components?: string[];
};

/** The vendor half of a service tile, as the contract defines it. */
export type Vendor = ServiceStatus['vendor'];

/* ------------------------------------------------------------------ levels */

/** Rollup precedence. Read it as "how much worse does this make the answer".
 *
 *  `unknown` outranks `maintenance` and `operational` deliberately: not knowing
 *  is worse than announced work, and it is emphatically worse than fine. That
 *  is the product's whole ethos — a failed read never renders green — applied
 *  to a page where one component of ten has become unreadable. */
const RANK: Record<StatusLevel, number> = {
  operational: 0,
  maintenance: 1,
  unknown: 2,
  degraded: 3,
  outage: 4,
};

/** Worst wins. An empty list is `unknown`, not `operational`: a feed that
 *  published nothing to roll up has made no statement of health. */
export function worstLevel(levels: readonly StatusLevel[]): StatusLevel {
  let worst: StatusLevel = 'unknown';
  let seen = false;
  for (const level of levels) {
    if (!seen || RANK[level] > RANK[worst]) {
      worst = level;
      seen = true;
    }
  }
  return worst;
}

/** The tile label for a canonical level. Exhaustive by switch with a `never`
 *  default, so a sixth `StatusLevel` fails the typecheck rather than rendering
 *  an empty label. */
export function labelFor(level: StatusLevel): string {
  switch (level) {
    case 'operational':
      return 'Operational';
    case 'degraded':
      return 'Degraded';
    case 'outage':
      return 'Outage';
    case 'maintenance':
      return 'Maintenance';
    case 'unknown':
      return 'Unknown';
    default: {
      const unreachable: never = level;
      throw new Error(`unhandled StatusLevel: ${String(unreachable)}`);
    }
  }
}

/** The shape every failure path in this directory returns. There is exactly one
 *  of these so that no adapter can invent a cheerier one. */
export function unknownVendor(platform: VendorPlatform, why: string): Vendor {
  return {
    platform,
    level: 'unknown',
    label: labelFor('unknown'),
    // The note is not decoration. A reader looking at a grey tile needs to know
    // whether we failed to look or the vendor declined to say.
    note: why,
    incidentsSince: [],
  };
}

/* ------------------------------------------------------------------ config */

// Runtime copies of two frozen unions. They are typed as exhaustive Records, so
// adding a ServiceId to the contract without adding it here is a typecheck
// failure — a duplicated literal that cannot silently drift.
const SERVICE_IDS: Record<ServiceId, true> = {
  proofpoint: true,
  jira: true,
  helpjuice: true,
  claude: true,
  openai: true,
  zendesk: true,
  m365: true,
};

const PLATFORMS: Record<VendorPlatform, true> = {
  statuspage: true,
  statusio: true,
  'zendesk-ssp': true,
  msgraph: true,
};

export const VENDORS_JSON = join(HERE, 'vendors.json');

/**
 * Read and validate `vendors.json`.
 *
 * Validation is strict and throws, because a malformed feed list is a boot-time
 * mistake by us, not a runtime failure of a vendor — silently dropping a
 * mistyped vendor would take a tile dark with nobody being told. The https
 * check is the SSRF floor: this process fetches exactly what this file says,
 * and this file says nothing but public https status feeds.
 *
 * The path is a parameter with a default so a test can load a different list
 * without editing the shipped one.
 */
export function loadVendorFeeds(path: string = VENDORS_JSON): VendorFeed[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { feeds?: unknown }).feeds)) {
    throw new Error(`${path}: expected an object with a "feeds" array`);
  }
  const feeds = (raw as { feeds: unknown[] }).feeds;
  const seen = new Set<string>();
  return feeds.map((entry, i) => {
    const where = `${path}: feeds[${i}]`;
    if (typeof entry !== 'object' || entry === null) throw new Error(`${where}: not an object`);
    const { id, platform, url, component, tenants, locations, components } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !(id in SERVICE_IDS)) {
      throw new Error(`${where}: id ${JSON.stringify(id)} is not a ServiceId`);
    }
    if (typeof platform !== 'string' || !(platform in PLATFORMS)) {
      throw new Error(`${where}: platform ${JSON.stringify(platform)} is not a VendorPlatform`);
    }
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error(`${where}: url must be https, got ${JSON.stringify(url)}`);
    }
    if (component !== undefined && typeof component !== 'string') {
      throw new Error(`${where}: component must be a string when present`);
    }
    if (components !== undefined) {
      if (!Array.isArray(components) || components.length === 0 || !components.every((c) => typeof c === 'string' && c.length > 0)) {
        throw new Error(`${where}: components must be a non-empty array of non-empty strings when present`);
      }
    }
    if (locations !== undefined) {
      if (!Array.isArray(locations) || locations.length === 0 || !locations.every((l) => typeof l === 'string' && l.length > 0)) {
        throw new Error(`${where}: locations must be a non-empty array of non-empty strings when present`);
      }
    }
    if (tenants !== undefined) {
      // Validated, because each is interpolated into a query string. A hostname
      // label is all one can ever legitimately be.
      if (!Array.isArray(tenants) || tenants.length === 0) {
        throw new Error(`${where}: tenants must be a non-empty array when present`);
      }
      for (const t of tenants) {
        if (typeof t !== 'string' || !/^[a-z0-9-]+$/i.test(t)) {
          throw new Error(`${where}: tenant must be a hostname label, got ${JSON.stringify(t)}`);
        }
      }
    }
    if (seen.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    seen.add(id);
    return {
      id: id as ServiceId,
      platform: platform as VendorPlatform,
      url,
      ...(component === undefined ? {} : { component }),
      ...(tenants === undefined ? {} : { tenants: tenants as string[] }),
      ...(locations === undefined ? {} : { locations: locations as string[] }),
      ...(components === undefined ? {} : { components: components as string[] }),
    };
  });
}

/* ------------------------------------------------------------- tiny helpers */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
