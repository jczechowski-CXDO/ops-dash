import type { Incident } from '@ops-dash/shared';
import { clock, clockOf, dayAgoAt, minutesAgo, span } from './time.js';
import {
  MAILFLOW_LAST_SUCCESS_MINUTES_AGO as LAST_SUCCESS,
  SEV1_OPENED_MINUTES_AGO as T0,
  VENDOR_CONFIRMED_MINUTES_AGO as VENDOR_CONFIRMED,
} from './services.js';

/** INC-2288 opened by hand at yesterday 17:20. The instant and the copy that
 *  quotes it are derived from this one value. */
const EPC_OPENED = dayAgoAt(1, 17, 20);

/** The four open incidents of the Sev1 world, ordered so severity reads
 *  [1, 2, 2, 3] — the order the Overview alert list renders.
 *
 *  `serviceId` is wider than `ServiceId` on purpose: INC-2288 belongs to Endpoint
 *  Central, which is a product source and not one of the seven vendor tiles.
 *  `fixtures.test.ts` enumerates the legitimate non-tile sources, because nothing
 *  in the type system does. */
export const sev1Incidents: Incident[] = [
  {
    id: 'INC-2291',
    severity: 1,
    title: 'Exchange Online mail delivery delays',
    serviceId: 'm365',
    openedAt: minutesAgo(T0),
    summary:
      'Microsoft advisory EX1084221, read by hand from the admin centre, reports delayed transport in North America. Our synthetic mailflow probe is failing from three of four regions, which matches it. We have no automated vendor signal for M365 while Service Health consent is pending, so this correlation rests on our own probes and a human reading the advisory.',
    metaParts: ['Microsoft 365', `opened ${clock(T0)}`, '384 users affected', 'advisory EX1084221'],
    ruleKey: 'vendor',
    blastRadius: [
      { label: 'Users affected', value: '384', note: 'of 512 licensed mailboxes', level: 'error' },
      { label: 'Mail queue depth', value: '2,140', note: 'inbound messages held', level: 'error' },
      { label: 'Median delay', value: '18m 40s', note: 'up from 4s baseline', level: 'warning' },
      // The oldest still-queued message is the one that missed the last
      // successful mailflow round trip, so it shares that anchor: it cannot be
      // younger than the incident, which `clock(72)` made it by eleven minutes.
      { label: 'Oldest message', value: span(LAST_SUCCESS), note: `queued since ${clock(LAST_SUCCESS)}`, level: 'warning' },
    ],
    timeline: [
      {
        at: minutesAgo(T0 - 72),
        kind: 'update',
        title: 'Queue drain started',
        body: 'Delay down to 18m 40s from a 31m peak. Monitoring.',
      },
      {
        at: minutesAgo(VENDOR_CONFIRMED),
        kind: 'vendor',
        title: 'Vendor confirmed, by hand',
        body: 'Advisory EX1084221 read in the Microsoft 365 admin centre: a transport infrastructure fault. Not visible to us automatically — Service Health consent is still pending.',
      },
      {
        at: minutesAgo(T0 - 19),
        kind: 'escalated',
        title: 'Escalated to Sev1',
        body: 'Affected mailbox count crossed 300. Help desk notified, banner posted in Teams.',
      },
      {
        at: minutesAgo(T0 - 2),
        kind: 'detected',
        title: 'Synthetic probes failing',
        body: 'Mailflow round trip timed out from us-east, us-west and eu-west.',
      },
      {
        at: minutesAgo(T0),
        kind: 'opened',
        title: 'Incident opened',
        // The rule this incident belongs to could not fire: amendment 1 says
        // `unknown` never satisfies the vendor side, and M365's vendor half is
        // unknown while Service Health consent is pending. Opened by hand off
        // the failing probes instead. `ruleKey` still names the rule, which is
        // how the Settings page explains why nothing alerted.
        body: 'Opened by hand from three failing mailflow regions. The "Vendor degraded + our check failing" rule could not fire — we have no vendor signal for M365 while Service Health consent is pending.',
      },
    ],
  },
  {
    id: 'INC-2290',
    severity: 2,
    title: 'Failed sign-in spike — 1,204 attempts against 96 accounts',
    serviceId: 'm365',
    openedAt: minutesAgo(T0 + 25),
    summary:
      '1,204 failed sign-ins in fifteen minutes against 96 accounts, sourced from one hosting range and aimed at legacy authentication endpoints. No confirmed compromise yet.',
    metaParts: ['Entra ID', `opened ${clock(T0 + 25)}`, 'source 203.0.113.x (RO, NL)', 'legacy auth endpoints'],
    ruleKey: 'spray',
    blastRadius: [
      { label: 'Accounts targeted', value: '96', note: 'of 512 licensed users', level: 'warning' },
      { label: 'Failed attempts', value: '1,204', note: 'in a 15-minute window', level: 'error' },
    ],
    timeline: [
      {
        at: minutesAgo(T0 + 23),
        kind: 'detected',
        title: 'Legacy endpoints targeted',
        body: 'Attempts concentrated on SMTP AUTH and IMAP, which conditional access does not cover.',
      },
      {
        at: minutesAgo(T0 + 25),
        kind: 'opened',
        title: 'Incident opened',
        body: 'Auto-created from rule "More than 500 failures in 15 minutes".',
      },
    ],
  },
  {
    id: 'INC-2288',
    severity: 2,
    title: '14 Endpoint Central agents stale for 21+ days',
    serviceId: 'endpointcentral',
    openedAt: EPC_OPENED,
    summary:
      'Fourteen managed endpoints have not checked in for 21 days or more. Their patch and encryption state is unknown rather than compliant, so they are excluded from the compliance figures until they report.',
    metaParts: ['Endpoint Central', `opened yesterday ${clockOf(EPC_OPENED)}`, '9 laptops, 5 desktops'],
    ruleKey: 'stale',
    blastRadius: [
      { label: 'Agents stale', value: '14', note: 'of 612 managed endpoints', level: 'warning' },
      { label: 'Longest silence', value: '34 days', note: 'DEMO-LT-0412', level: 'error' },
    ],
    timeline: [
      {
        at: dayAgoAt(1, 17, 22),
        kind: 'detected',
        title: 'Agents grouped by last check-in',
        body: 'Nine laptops and five desktops, none of them reporting since the 21-day threshold.',
      },
      {
        at: EPC_OPENED,
        kind: 'opened',
        title: 'Incident opened',
        // The 'Agent stale' rule is the one rule disabled by default, both in
        // the prototype and on our Settings page, so nothing fired: this one was
        // raised by hand. `ruleKey` still names the rule the incident belongs
        // to, which is how the Settings page explains why it was missed.
        body: 'Opened by hand during the weekly endpoint review. The "Agent stale" rule is disabled, so nothing alerted on this.',
      },
    ],
  },
  {
    id: 'INC-2286',
    severity: 3,
    title: '2 app registration secrets expire in 9 days',
    serviceId: 'm365',
    openedAt: minutesAgo(2 * 24 * 60),
    summary:
      'Two app registration credentials expire in nine days. Graph collection and the Stellar connector both stop silently when a secret lapses, so this is renewed ahead of the date rather than on it.',
    metaParts: ['Entra ID', 'opened 2 days ago', 'CXDO-GraphExport, Stellar-Connector'],
    ruleKey: 'secrets',
    blastRadius: [
      { label: 'Credentials expiring', value: '2', note: 'within 9 days', level: 'warning' },
      { label: 'Integrations affected', value: '2', note: 'Graph export and Stellar', level: 'normal' },
    ],
    timeline: [
      {
        at: minutesAgo(2 * 24 * 60 - 2),
        kind: 'detected',
        title: 'Owners identified',
        body: 'Both registrations are owned by IT operations; neither has a second valid credential.',
      },
      {
        at: minutesAgo(2 * 24 * 60),
        kind: 'opened',
        title: 'Incident opened',
        body: 'Auto-created from rule "Secret or certificate expiring within 14 days".',
      },
    ],
  },
];

/** The quiet world has nothing open. Recent history still carries closed ones. */
export const quietIncidents: Incident[] = [];
