import type { ServiceStatus, Severity, StatusLevel, TimelineEntry } from '@ops-dash/shared';

/**
 * Every mapping below is an exhaustive switch whose default branch assigns the
 * scrutinee to `never`. Adding a member to `StatusLevel`, `Severity` or
 * `TimelineEntry['kind']` in the frozen contract therefore fails `tsc` here
 * rather than falling through to a transparent colour at runtime.
 */
function unreachable(value: never, what: string): never {
  throw new Error(`${what}: unhandled value ${JSON.stringify(value)}`);
}

/** StatusLevel -> Aurora token. Adapters never return colours; the UI computes them. */
export function statusColor(level: StatusLevel): string {
  switch (level) {
    case 'operational': return 'var(--success-main)';
    case 'degraded':    return 'var(--warning-main)';
    case 'outage':      return 'var(--error-main)';
    case 'maintenance': return 'var(--info-main)';
    // Amendment 1: 'unknown' is the absence of information, not health. It must
    // never read as green, so it takes the disabled-text grey.
    case 'unknown':     return 'var(--text-disabled)';
    default:            return unreachable(level, 'statusColor');
  }
}

export function severityColor(severity: Severity): string {
  switch (severity) {
    case 1:      return 'var(--error-main)';
    case 2:      return 'var(--warning-main)';
    case 3:      return 'var(--info-main)';
    case 'info': return 'var(--info-main)';
    default:     return unreachable(severity, 'severityColor');
  }
}

export function severityLabel(severity: Severity): string {
  switch (severity) {
    case 1:      return 'SEV 1';
    case 2:      return 'SEV 2';
    case 3:      return 'SEV 3';
    case 'info': return 'INFO';
    default:     return unreachable(severity, 'severityLabel');
  }
}

export function timelineColor(kind: TimelineEntry['kind']): string {
  switch (kind) {
    case 'opened':    return 'var(--text-secondary)';
    case 'detected':  return 'var(--error-main)';
    case 'escalated': return 'var(--error-main)';
    case 'vendor':    return 'var(--warning-main)';
    case 'update':    return 'var(--info-main)';
    case 'resolved':  return 'var(--success-main)';
    default:          return unreachable(kind, 'timelineColor');
  }
}

/**
 * Amendment 1, rule 1: the Overview strip asserts health only when every service
 * is affirmatively operational on both halves. 'unknown' and 'maintenance' do not
 * count. Without this, one Statuspage-wide failure paints Jira, Helpjuice, Claude
 * and OpenAI green at once — four vendors, one upstream, one correlated lie.
 */
export function allOperational(services: ServiceStatus[]): boolean {
  return services.every((s) => s.vendor.level === 'operational' && s.ours.level === 'operational');
}
