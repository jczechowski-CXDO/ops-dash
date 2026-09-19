import type { EntraSnapshot } from '@ops-dash/shared';
import { dayAgoAt, daysAgo, hoursAgo, minutesAgo } from './time.js';
import { SEV1_OPENED_MINUTES_AGO as T0 } from './services.js';

/** The prototype's `entraStats`, `entraRows` and `auditRows`, as the contract's
 *  numbers rather than its pre-formatted strings — the view does the formatting.
 *  Actors and external targets are redacted to @example.com / @example.net;
 *  `Stellar-Connector` is an app registration name, not a person or a host, and
 *  is deliberately real. */
export const entra: EntraSnapshot = {
  stats: {
    riskySignIns24h: 7,
    riskyConfirmedCompromised: 3,
    failedSignIns24h: 1204,
    failedSignInAccounts: 96,
    mfaCoverage: 0.943,
    mfaUnregistered: 29,
    privilegedAccounts: 11,
    globalAdmins: 4,
  },
  signals: [
    { key: 'risky_signin', label: 'Risky sign-ins', count: 7, delta24h: 4, severity: 1, lastSeen: minutesAgo(10) },
    // Same instant as INC-2290 opened: the spike is the incident, seen twice.
    { key: 'failed_spike', label: 'Failed sign-in spike', count: 1204, delta24h: 1102, severity: 2, lastSeen: minutesAgo(T0 + 25) },
    { key: 'legacy_auth', label: 'Legacy auth attempts', count: 318, delta24h: 296, severity: 2, lastSeen: minutesAgo(T0 + 21) },
    { key: 'mfa_gap', label: 'MFA registration gaps', count: 29, delta24h: -2, severity: 3, lastSeen: hoursAgo(5) },
    // Same instant as INC-2286 opened: the two expiring secrets.
    { key: 'expiring_credentials', label: 'Expiring secrets & certs', count: 2, delta24h: 0, severity: 3, lastSeen: minutesAgo(2 * 24 * 60) },
    // Same instant as the 'Add member to role' audit event below.
    { key: 'role_change', label: 'Privileged role changes', count: 1, delta24h: 1, severity: 2, lastSeen: dayAgoAt(1, 16, 4) },
    { key: 'guest_access', label: 'Guest / external access', count: 43, delta24h: 3, severity: 'info', lastSeen: hoursAgo(6) },
    { key: 'ca_change', label: 'CA policy changes', count: 0, delta24h: 0, severity: 'info', lastSeen: daysAgo(9) },
  ],
  audit: [
    { at: dayAgoAt(1, 16, 4), actor: 'j.hart@example.com', action: 'Add member to role', target: 'Helpdesk Administrator', result: 'success' },
    { at: dayAgoAt(1, 14, 22), actor: 'System', action: 'Disable user', target: 'contractor-ac41', result: 'success' },
    { at: dayAgoAt(1, 11, 7), actor: 'm.reyes@example.com', action: 'Update app credentials', target: 'Stellar-Connector', result: 'success' },
    { at: dayAgoAt(2, 9, 40), actor: 'j.hart@example.com', action: 'Invite external user', target: 'auditor@example.net', result: 'success' },
  ],
};
