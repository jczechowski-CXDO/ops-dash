import type { EndpointSnapshot } from '@ops-dash/shared';
import { daysAgo, hoursAgo, minutesAgo } from './time.js';

/** The prototype's `endpointStats` and `endpointRows`. Hostnames are rewritten
 *  CXDO- -> DEMO- and stay that way permanently; `os` is carried because the
 *  contract keeps it even though the table dropped the column for width.
 *  Each row's `lastCheckIn` agrees with the age quoted in its `issue` string. */
export const endpoints: EndpointSnapshot = {
  stats: {
    total: 612,
    patchCompliance: 0.914,
    checkedIn7d: 598,
    bitlockerEncrypted: 576,
    criticalPatchesMissing: 38,
  },
  attention: [
    { computer: 'DEMO-LT-0412', assignedTo: 'a.nguyen', os: 'Windows 11 23H2', issue: 'Agent stale · 34 days', issueKind: 'stale_agent', lastCheckIn: daysAgo(34) },
    { computer: 'DEMO-LT-0288', assignedTo: 'r.patel', os: 'Windows 11 23H2', issue: '6 critical patches missing', issueKind: 'missing_patches', lastCheckIn: hoursAgo(2) },
    { computer: 'DEMO-DT-0117', assignedTo: 'shared / reception', os: 'Windows 10 22H2', issue: 'BitLocker not enabled', issueKind: 'no_bitlocker', lastCheckIn: minutesAgo(18) },
    { computer: 'DEMO-LT-0355', assignedTo: 'k.obrien', os: 'macOS 15.2', issue: 'Agent stale · 27 days', issueKind: 'stale_agent', lastCheckIn: daysAgo(27) },
    { computer: 'DEMO-LT-0501', assignedTo: 'd.silva', os: 'Windows 11 24H2', issue: '4 critical patches missing', issueKind: 'missing_patches', lastCheckIn: minutesAgo(41) },
    { computer: 'DEMO-DT-0092', assignedTo: 'lab / QA', os: 'Windows 10 22H2', issue: 'EOL build · upgrade required', issueKind: 'eol_build', lastCheckIn: daysAgo(3) },
  ],
};
