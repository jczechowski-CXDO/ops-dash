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
 * Is this ONE service affirmatively healthy?
 *
 * The single definition of affirmed health. Exported because "is this service
 * healthy" is useful to more than one caller: the Overview banner wants the
 * verdict over the list, the header subtitle wants the count. Both must mean the
 * same thing or one screen contradicts the other.
 *
 * BOTH HALVES, deliberately. The vendor's own feed and our synthetic probes must
 * each say 'operational'. A vendor status page is a claim about their fleet, not
 * a measurement of our path to it; a green feed with our probes failing is
 * exactly the case the synthetic checks exist to catch. Today m365 is
 * vendor-'unknown' with our probes failing in sev1 and passing in quiet, so a
 * vendor-only definition would already disagree with this one in a live fixture.
 *
 * ONLY 'operational' AFFIRMS. Amendment 1: 'maintenance' is announced work, not
 * an incident but equally not an assertion of health; 'unknown' is the absence of
 * information and is the reason the amendment exists. 'degraded' and 'outage'
 * speak for themselves. Widening this predicate by one member is the whole bug.
 */
export function isAffirmed(service: ServiceStatus): boolean {
  return service.vendor.level === 'operational' && service.ours.level === 'operational';
}

/**
 * Amendment 1, rule 1: the Overview strip asserts health only when every service
 * is affirmatively operational on both halves. Without this, one Statuspage-wide
 * failure paints Jira, Helpjuice, Claude and OpenAI green at once — four vendors,
 * one upstream, one correlated lie.
 *
 * An EMPTY list is not health. `[].every()` is vacuously true, which would let a
 * failed or empty fixture load render ALL SYSTEMS OPERATIONAL over nothing at
 * all. The contract already rules on this shape for `SourceResult.empty`:
 * "NOT an assertion of health. Never infer 'operational' from it." Same rule
 * here — health is asserted only over evidence that exists.
 */
export function allOperational(services: ServiceStatus[]): boolean {
  if (services.length === 0) return false;
  return services.every(isAffirmed);
}
