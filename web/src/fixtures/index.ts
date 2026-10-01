import type {
  AlertRule,
  CheckRun,
  EmailSnapshot,
  EndpointSnapshot,
  EntraSnapshot,
  Incident,
  Integration,
  ServiceId,
  ServiceStatus,
} from '@ops-dash/shared';

import { quietServices, sev1Services } from './services.js';
import { quietIncidents, sev1Incidents } from './incidents.js';
import { recentHistory, quietCheckRuns, sev1CheckRuns, type HistoryRow } from './history.js';
import { quietEntra, sev1Entra } from './entra.js';
import { quietEndpoints, sev1Endpoints } from './endpoints.js';
import { quietEmail, sev1Email } from './email.js';
import { rules, integrations } from './rules.js';

export type { HistoryRow };

/** Which of the two worlds the app is showing. Dev-only in Milestone 1; the
 *  switch and this type both disappear in Milestone 4 when real data lands. */
export type DemoMode = 'quiet' | 'sev1';

export type FixtureBundle = {
  services: ServiceStatus[];
  incidents: Incident[];
  recentHistory: HistoryRow[];
  /** Keyed by service: the detail page shows that service's own probes, and a
   *  single shared array meant six of the seven pages showed m365's checks under
   *  another vendor's name. Index it with `checkRunsFor`, not directly — the
   *  route param is an arbitrary string, not a `ServiceId`. */
  checkRuns: Record<ServiceId, CheckRun[]>;
  entra: EntraSnapshot;
  endpoints: EndpointSnapshot;
  email: EmailSnapshot;
  rules: AlertRule[];
  integrations: Integration[];
};

export const fixtures: Record<DemoMode, FixtureBundle> = {
  quiet: {
    services: quietServices,
    incidents: quietIncidents,
    recentHistory,
    checkRuns: quietCheckRuns,
    entra: quietEntra,
    endpoints: quietEndpoints,
    email: quietEmail,
    rules,
    integrations,
  },
  sev1: {
    services: sev1Services,
    incidents: sev1Incidents,
    recentHistory,
    checkRuns: sev1CheckRuns,
    entra: sev1Entra,
    endpoints: sev1Endpoints,
    email: sev1Email,
    rules,
    integrations,
  },
};

export function serviceById(mode: DemoMode, id: string): ServiceStatus | undefined {
  return fixtures[mode].services.find((s) => s.id === id);
}

export function incidentById(mode: DemoMode, id: string): Incident | undefined {
  return fixtures[mode].incidents.find((i) => i.id === id);
}

/** Check history for one service. `id` is whatever the route gave us, so the
 *  lookup is total: an id that is not one of the seven yields an empty list and
 *  the view renders its empty state, rather than indexing a Record with a string
 *  and getting `undefined` at runtime while the types claim otherwise. */
export function checkRunsFor(mode: DemoMode, id: string): CheckRun[] {
  const runs = fixtures[mode].checkRuns;
  return Object.hasOwn(runs, id) ? (runs[id as ServiceId] ?? []) : [];
}
