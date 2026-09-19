import type { ServiceStatus } from '@ops-dash/shared';
import { isAffirmed } from '../theme/statusColor.js';
import type { FixtureBundle } from '../fixtures/index.js';
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
export function affirmedCount(services: ServiceStatus[]): number {
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
function overviewSubtitle(bundle: FixtureBundle): string {
  const open = bundle.incidents.length;
  const total = bundle.services.length;
  if (open > 0) return `${open} open incidents across ${total} monitored services`;

  const affirmed = affirmedCount(bundle.services);
  const scale = `512 users, ${bundle.endpoints.stats.total} endpoints`;
  return affirmed === total
    ? `All ${total} monitored services healthy · ${scale}`
    : `${affirmed} of ${total} monitored services affirmed healthy · ${total - affirmed} unknown · ${scale}`;
}

export function pageMeta(
  pathname: string,
  bundle: FixtureBundle,
): { title: string; subtitle: string } {
  if (pathname.startsWith(SERVICE_PREFIX)) {
    const id = pathname.slice(SERVICE_PREFIX.length);
    const svc = bundle.services.find((s) => s.id === id);
    return {
      title: svc?.name ?? 'Service detail',
      subtitle: 'Vendor status and our synthetic checks, side by side',
    };
  }
  if (pathname.startsWith(INCIDENT_PREFIX)) {
    const id = pathname.slice(INCIDENT_PREFIX.length);
    const inc = bundle.incidents.find((i) => i.id === id);
    return { title: inc?.id ?? 'Incident', subtitle: inc?.title ?? 'Incident not found' };
  }
  switch (pathname) {
    case ROUTE.entra:
      return { title: 'Entra security', subtitle: 'Sign-in risk, identity hygiene and directory audit' };
    case ROUTE.endpoints:
      return {
        title: 'Endpoints & patch health',
        subtitle: `${bundle.endpoints.stats.total} managed endpoints · Endpoint Central`,
      };
    case ROUTE.email:
      return { title: 'Email security', subtitle: 'Proofpoint 365 Total Protection · last 24 hours' };
    case ROUTE.settings:
      return { title: 'Rules & integrations', subtitle: 'What we watch and where it comes from' };
    default:
      return { title: 'Overview', subtitle: overviewSubtitle(bundle) };
  }
}
