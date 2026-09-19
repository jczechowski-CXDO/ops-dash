import type {
  AlertRule,
  CheckRun,
  EmailSnapshot,
  EndpointSnapshot,
  EntraSnapshot,
  Incident,
  Integration,
  ServiceStatus,
} from '@ops-dash/shared';

import { quietServices, sev1Services } from './services.js';
import { quietIncidents, sev1Incidents } from './incidents.js';
import { recentHistory, quietCheckRuns, sev1CheckRuns, type HistoryRow } from './history.js';
import { entra } from './entra.js';
import { endpoints } from './endpoints.js';
import { email } from './email.js';
import { rules, integrations } from './rules.js';

export type { HistoryRow };

/** Which of the two worlds the app is showing. Dev-only in Milestone 1; the
 *  switch and this type both disappear in Milestone 4 when real data lands. */
export type DemoMode = 'quiet' | 'sev1';

export type FixtureBundle = {
  services: ServiceStatus[];
  incidents: Incident[];
  recentHistory: HistoryRow[];
  checkRuns: CheckRun[];
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
    entra,
    endpoints,
    email,
    rules,
    integrations,
  },
  sev1: {
    services: sev1Services,
    incidents: sev1Incidents,
    recentHistory,
    checkRuns: sev1CheckRuns,
    entra,
    endpoints,
    email,
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
