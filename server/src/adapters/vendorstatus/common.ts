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
    const { id, platform, url, component } = entry as Record<string, unknown>;
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
    if (seen.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    seen.add(id);
    return {
      id: id as ServiceId,
      platform: platform as VendorPlatform,
      url,
      ...(component === undefined ? {} : { component }),
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
