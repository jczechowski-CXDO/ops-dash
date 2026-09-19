import type { IconName } from '../components/aurora/icons.generated.js';

export type NavId = 'overview' | 'service' | 'incident' | 'entra' | 'endpoints' | 'email' | 'settings';

/**
 * One source of truth for every path in the app. The router renders from it,
 * the sidebar renders from it and pageMeta keys off it — a path spelled in two
 * places is eventually spelled two ways.
 */
export const ROUTE = {
  overview: '/',
  service: '/services/:id',
  incident: '/incidents/:id',
  entra: '/entra',
  endpoints: '/endpoints',
  email: '/email',
  settings: '/settings',
} as const;

/** Which count, if any, the sidebar puts on a nav item. The number itself comes
 *  from the fixture bundle at render time — see Sidebar.tsx. A count typed here
 *  beside the label would be a constant pretending to be data (gate G2). */
export type NavBadge = 'openIncidents' | 'openSev1s';

export type NavItem = {
  id: NavId;
  label: string;
  icon: IconName;
  path: string;
  badge?: NavBadge;
};

/** The sidebar's two detail entries need a concrete target. They point at the
 *  first service and the open Sev1 — the same defaults the prototype showed. */
export const NAV: readonly NavItem[] = [
  { id: 'overview',  label: 'Overview',             icon: 'space_dashboard', path: '/',                   badge: 'openIncidents' },
  { id: 'service',   label: 'Service detail',       icon: 'dns',             path: '/services/m365' },
  // G3 HIGH-2: this hard-coded INC-2291, which does not exist in quiet — so the
  // nav was one click from a red error over a healthy system. The href is now
  // resolved per render from the bundle; see navHref().
  { id: 'incident',  label: 'Incident',             icon: 'report',          path: '/incidents/:id',      badge: 'openSev1s' },
  { id: 'entra',     label: 'Entra security',       icon: 'shield',          path: '/entra' },
  { id: 'endpoints', label: 'Endpoints',            icon: 'computer',        path: '/endpoints' },
  { id: 'email',     label: 'Email security',       icon: 'mail',            path: '/email' },
  { id: 'settings',  label: 'Rules & integrations', icon: 'settings',        path: '/settings' },
];

/** The nav's Incident entry points at whichever incident the list sorts first —
 *  severity, then newest. With none open it points at the Overview, because a
 *  nav item that leads to "there is nothing here" is a dead end, and in quiet
 *  mode "nothing here" is the correct state of the world rather than an error. */
export function navHref(item: { id: string; path: string }, incidents: { id: string }[]): string {
  if (item.id !== 'incident') return item.path;
  const first = incidents[0];
  return first ? `/incidents/${first.id}` : '/';
}
