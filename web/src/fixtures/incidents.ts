import type { Incident } from '@ops-dash/shared';
import { afterBy, clock, clockOf, dayAgoAt, hoursAhead, minutesAgo, span } from './time.js';
import {
  MAILFLOW_LAST_SUCCESS_MINUTES_AGO as LAST_SUCCESS,
  PROOFPOINT_OPENED_MINUTES_AGO as PP0,
  PROOFPOINT_VENDOR_UPDATE_MINUTES_AGO as PP_VENDOR,
  SEV1_OPENED_MINUTES_AGO as T0,
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
  /** The headline correlation, and the only incident in this milestone that a
   *  rule actually opened by itself. Hornetsecurity's Status.io feed is
   *  readable, so both halves of the 'vendor degraded + our check failing' rule
   *  have real inputs — which is why John moved the demo here from m365. */
  {
    id: 'INC-2292',
    severity: 1,
    title: 'Proofpoint filtering degraded — inbound mail delayed at the gateway',
    serviceId: 'proofpoint',
    openedAt: minutesAgo(PP0),
    summary:
      'Hornetsecurity reports elevated processing latency in United States - Atlanta, and our own mail-flow probes through the gateway are failing from us-east and eu-west. Both halves agree, independently, which is what opened this automatically.',
    metaParts: ['Proofpoint', `opened ${clock(PP0)}`, '12 of 14 inbound domains', 'advisory hs-8841'],
    ruleKey: 'vendor',
    blastRadius: [
      { label: 'Mail held at gateway', value: '1,860', note: 'inbound messages queued', level: 'error' },
      { label: 'Domains affected', value: '12', note: 'of 14 inbound domains', level: 'error' },
      { label: 'Median delivery delay', value: '9m 12s', note: 'up from 6s baseline', level: 'warning' },
      { label: 'Regions failing', value: '2 of 4', note: 'us-east and eu-west', level: 'warning' },
    ],
    timeline: [
      {
        at: minutesAgo(6),
        kind: 'update',
        title: 'Gateway queue easing',
        body: 'Queue down to 1,860 from a 2,400 peak. us-west and ap-south still delivering above p95.',
      },
      {
        at: minutesAgo(PP_VENDOR),
        kind: 'vendor',
        title: 'Vendor confirmed',
        body: 'Hornetsecurity posted hs-8841: elevated processing latency in United States - Atlanta.',
      },
      {
        at: minutesAgo(PP0 - 2),
        kind: 'detected',
        title: 'Gateway probes failing',
        body: 'Mail-flow round trip through the gateway timed out from us-east and eu-west.',
      },
      {
        at: minutesAgo(PP0),
        kind: 'opened',
        title: 'Incident opened',
        body: 'Auto-created from rule "Vendor status page degraded + our check failing". Both halves were independently sourced and both were bad.',
      },
    ],
  },
  {
    id: 'INC-2291',
    severity: 1,
    title: 'Exchange Online mail delivery delays',
    serviceId: 'm365',
    openedAt: minutesAgo(T0),
    summary:
      'Our synthetic mailflow probes are failing from three of four regions and 384 mailboxes are seeing delivery delays. We have nothing from Microsoft to corroborate it: there is no per-workload status feed for commercial M365 and our Service Health consent is still pending, so the vendor half of this page is blind. We are acting on our own evidence, which is the only evidence we have.',
    metaParts: ['Microsoft 365', `opened ${clock(T0)}`, '384 users affected', 'no vendor signal'],
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
        // Deliberately NOT kind 'vendor': there is no vendor statement here.
        // The absence is the entry, and an operator should be able to see that
        // we looked rather than that we forgot.
        at: minutesAgo(T0 - 46),
        kind: 'update',
        title: 'No vendor statement available',
        body: 'Nothing to corroborate this from Microsoft. There is no per-workload status feed for commercial M365 and our Service Health consent is still pending, so the vendor half stays unknown.',
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
    /** Muted until this afternoon, not indefinitely.
     *
     *  This reverses an earlier choice, deliberately. `until: null` is the more
     *  interesting half of the contract's `string | null` in the abstract, but
     *  only one form can be carried by a fixture and therefore baselined, and
     *  the timed one is strictly more informative: "muted by … until 14:30"
     *  renders everything the indefinite form does plus the expiry, so it
     *  exercises more of the view. It is also the case Milestone 2 will hit
     *  constantly — real mutes are "silence this for four hours" — and shipping
     *  only the indefinite form would leave the timed branch first rendering in
     *  M2 untested and unbaselined, which is the defect this whole exercise has
     *  been about. The `null` case keeps its type-level coverage here and its
     *  rendering coverage through constructed props, which is the weaker
     *  position, correctly given to the less informative rendering.
     *
     *  `until` is an expiry, so it is the one incident timestamp that points
     *  forward. The contract carries no `muted.at`, so "after the mute began"
     *  is not expressible; the checkable constraints are that it is in the
     *  future and later than the incident it silences, and both are asserted. */
    muted: { by: 'j.hart@example.com', until: hoursAhead(4) },
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
    /** Acknowledged, so the Overview dims this row and credits the actor —
     *  README:81's branch, which until now rendered in no world and would have
     *  been photographed by the Playwright baselines in a state the product can
     *  produce but the demo never showed (accepted finding M-9).
     *
     *  The lowest-severity incident, deliberately: dimming it does not weaken
     *  the Sev1 story the Overview and the baselines are built around. The
     *  actor is m.reyes, who the Entra audit already shows updating app
     *  credentials — the same person, doing the same job, on the same two
     *  registrations this incident is about. */
    ack: { by: 'm.reyes@example.com', at: afterBy(minutesAgo(2 * 24 * 60), 90) },
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
