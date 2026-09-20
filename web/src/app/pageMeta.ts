import { isAffirmed, type Halves } from '../theme/statusColor.js';
import type { FixtureBundle } from '../fixtures/index.js';
import type { Dashboard } from '../live/DataSource.js';
import { loadKind, type IncidentView, type Load, type ServiceView } from '../live/model.js';
import { ROUTE } from './routes.js';

/** Derived from ROUTE rather than retyped: '/services/:id' -> '/services/'. The
 *  path is spelled once, in routes.ts, or it is eventually spelled two ways. */
const SERVICE_PREFIX = ROUTE.service.replace(':id', '');
const INCIDENT_PREFIX = ROUTE.incident.replace(':id', '');

/**
 * How many services are affirmatively healthy, using the ONE definition of that
 * (G2 HIGH-1). This file used to re-implement the predicate; two copies of "is
 * this healthy" is how the header comes to say 7 of 7 affirmed while the
 * Overview banner, one component away, says the opposite. `isAffirmed` lives in
 * theme/statusColor.ts beside `allOperational`, which is now defined in terms
 * of it, so there is nothing left here to drift.
 */
export function affirmedCount(services: Halves[]): number {
  return services.filter(isAffirmed).length;
}

/**
 * The overview subtitle, derived rather than written down.
 *
 * The prototype's copy was "All 10 monitored services healthy · 512 users, 612
 * endpoints". Ten became seven (amendment 3), and the health claim became
 * conditional: the quiet world is 5 AFFIRMED · 2 UNKNOWN permanently, because
 * the Zendesk SSP publishes no per-service status and M365 Service Health
 * consent is pending. Saying "all healthy" over two services we cannot see is
 * the wrong-green that gate G1 opened a blocker on, and no count of zero open
 * incidents licenses it.
 */
function overviewSubtitle(source: MetaSource): string {
  const services = source.services.data;
  const incidents = source.incidents.data;
  // Every clause below counts something. With nothing to count, the subtitle
  // says which of the two silences this is rather than counting zero — "0 open
  // incidents across 0 monitored services" is the all-clear this dashboard is
  // built to refuse, wearing a number.
  if (services === undefined || incidents === undefined) return sourceSubtitle(source);

  const open = incidents.length;
  const total = services.length;
  if (open > 0) return `${open} open incidents across ${total} monitored services`;

  const affirmed = affirmedCount(services);
  const scale = `512 users, ${source.endpointsTotal} endpoints`;
  return affirmed === total
    ? `All ${total} monitored services healthy · ${scale}`
    : `${affirmed} of ${total} monitored services affirmed healthy · ${total - affirmed} unknown · ${scale}`;
}

/** The subtitle for a header with no counts to state. Unreachable in either
 *  demo world, where both loads are always ready. */
function sourceSubtitle(source: MetaSource): string {
  const kinds = [loadKind(source.services), loadKind(source.incidents)];
  if (kinds.includes('failed')) return 'We cannot reach our own API';
  return 'Reading service status…';
}

/**
 * What the header counts, from wherever the page got it.
 *
 * `endpointsTotal` is still the fixture's, and deliberately: the Endpoints
 * screen has no adapter until Milestone 4, so the scale clause is the one part
 * of this line that is not a live reading. It is the fixture's number in both
 * modes rather than a zero in one of them.
 */
export type MetaSource = {
  services: Load<ServiceView[]>;
  incidents: Load<IncidentView[]>;
  endpointsTotal: number;
};

export function metaSourceOf(dashboard: Dashboard, bundle: FixtureBundle): MetaSource {
  return {
    services: dashboard.services,
    incidents: dashboard.incidents,
    endpointsTotal: bundle.endpoints.stats.total,
  };
}

export function pageMeta(
  pathname: string,
  source: MetaSource,
): { title: string; subtitle: string } {
  if (pathname.startsWith(SERVICE_PREFIX)) {
    const id = pathname.slice(SERVICE_PREFIX.length);
    const svc = source.services.data?.find((s) => s.id === id);
    return {
      title: svc?.name ?? 'Service detail',
      subtitle: 'Vendor status and our synthetic checks, side by side',
    };
  }
  if (pathname.startsWith(INCIDENT_PREFIX)) {
    const id = pathname.slice(INCIDENT_PREFIX.length);
    const inc = source.incidents.data?.find((i) => i.id === id);
    if (inc) return { title: inc.id, subtitle: inc.title };
    // G3 HIGH-2. The page below renders a calm empty state, so the header must
    // not contradict it with "not found". The two absences are different news
    // and the subtitle says which: in a world with no open incidents this is the
    // good outcome, not a failure. Derived from the bundle, never from the id.
    const list = source.incidents.data;
    return {
      title: 'Incident',
      subtitle:
        // Three absences, not two: we hold no list at all, we hold an empty
        // one, or we hold one this id is not in. Only the middle one is good
        // news and only it says so.
        list === undefined
          ? sourceSubtitle(source)
          : list.length === 0
            ? 'No incidents are open'
            : 'That incident is not open',
    };
  }
  switch (pathname) {
    case ROUTE.entra:
      return { title: 'Entra security', subtitle: 'Sign-in risk, identity hygiene and directory audit' };
    case ROUTE.endpoints:
      return {
        title: 'Endpoints & patch health',
        subtitle: `${source.endpointsTotal} managed endpoints · Endpoint Central`,
      };
    case ROUTE.email:
      return { title: 'Email security', subtitle: 'Proofpoint 365 Total Protection · last 24 hours' };
    case ROUTE.settings:
      return { title: 'Rules & integrations', subtitle: 'What we watch and where it comes from' };
    default:
      return { title: 'Overview', subtitle: overviewSubtitle(source) };
  }
}
