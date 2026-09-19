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
    // The next line carries the colour guard's allowlist marker under protest: its
    // regex /#[0-9a-fA-F]{3,8}\b/ matches the invoice number in this subject, which
    // is five hex digits and is not a colour. The subject is prototype copy that
    // Task 9's Email test asserts verbatim, and guards.test.ts is not mine to fix.
    // This is G0 accepted-finding #1 ("the marker is unscoped") biting for real;
    // reported to the lead. Narrowing the guard to {3,4}|{6}|{8} digits removes
    // both the false positive and the need for this marker.
    { at: minutesAgo(12), from: 'billing@invoice-secure.net', to: 'ap@example.com', subject: 'Outstanding invoice #88214', reason: 'Credential phishing' }, /* prototype literal — not a colour, see note above */
    { at: minutesAgo(29), from: 'no-reply@ms-verify.co', to: 'j.hart@example.com', subject: 'Your password expires today', reason: 'Credential phishing' },
    { at: minutesAgo(48), from: 'hr-update@example-hr.com', to: '14 recipients', subject: 'Updated payroll direct deposit', reason: 'Impersonation' },
    { at: minutesAgo(65), from: 'ceo@exarnple.com', to: 'finance@example.com', subject: 'Quick favour — wire today', reason: 'Lookalike domain' },
    { at: minutesAgo(80), from: 'docs@sharefile-cloud.ru', to: 'm.reyes@example.com', subject: 'Contract for signature', reason: 'Malicious URL' },
  ],
};
