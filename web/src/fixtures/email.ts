import type { EmailSnapshot } from '@ops-dash/shared';
import { minutesAgo } from './time.js';

/** The prototype's `emailStats` and `emailRows`. Sender domains are the
 *  prototype's synthetic hostile ones and stay; every recipient is @example.com.
 *  `reason` is checked by `fixtures.test.ts` against the six documented values —
 *  the contract's union collapses to `string`, so nothing else checks it.
 *  Newest first, at the prototype's intervals. */
export const email: EmailSnapshot = {
  stats: {
    processed24h: 18402,
    blocked24h: 3911,
    quarantined: 147,
    quarantinePendingReview: 12,
    credentialPhishing24h: 38,
    credentialPhishingDelta: 9,
  },
  recentBlocked: [
    { at: minutesAgo(12), from: 'billing@invoice-secure.net', to: 'ap@example.com', subject: 'Outstanding invoice #88214', reason: 'Credential phishing' },
    { at: minutesAgo(29), from: 'no-reply@ms-verify.co', to: 'j.hart@example.com', subject: 'Your password expires today', reason: 'Credential phishing' },
    { at: minutesAgo(48), from: 'hr-update@example-hr.com', to: '14 recipients', subject: 'Updated payroll direct deposit', reason: 'Impersonation' },
    { at: minutesAgo(65), from: 'ceo@exarnple.com', to: 'finance@example.com', subject: 'Quick favour — wire today', reason: 'Lookalike domain' },
    { at: minutesAgo(80), from: 'docs@sharefile-cloud.ru', to: 'm.reyes@example.com', subject: 'Contract for signature', reason: 'Malicious URL' },
  ],
};
