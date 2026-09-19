import type {
  BlastMetric,
  ServiceStatus,
  Severity,
  StatusLevel,
  TimelineEntry,
} from '@ops-dash/shared';

/**
 * Every mapping below is an exhaustive switch whose default branch assigns the
 * scrutinee to `never`. Adding a member to `StatusLevel`, `Severity` or
 * `TimelineEntry['kind']` in the frozen contract therefore fails `tsc` here
 * rather than falling through to a transparent colour at runtime.
 */
function unreachable(value: never, what: string): never {
  throw new Error(`${what}: unhandled value ${JSON.stringify(value)}`);
}

/**
 * ---------------------------------------------------------------------------
 * Rungs, and why there are three of them
 *
 * G3 found 14 WCAG AA failures across five screens because one function
 * returned one rung and three views used it for three jobs with three different
 * contrast bars. Aurora's `-main` rung is DECORATION grade: --warning-main is
 * 2.40:1 on light paper, fine for a 3px border and unreadable as a word.
 *
 * So the family is chosen once, and the rung is chosen by the job:
 *
 *   decoration  -main      dots, 3px borders, sparkline strokes   (3:1 bar)
 *   text        -dark      any token painted as words             (4.5:1 bar)
 *   fill        -dark      solid chip background
 *   on-fill     -contrast  the words on a solid chip
 *
 * `-dark` and `-contrast` are both theme-aware: `-dark` LIGHTENS in the dark
 * palette. Measured on paper, worst case across both themes: text 4.61:1
 * (warning, light), on-fill 4.61:1 (warning, light). All clear AA.
 *
 * Family selection lives in ONE place per union, so a new StatusLevel or
 * Severity member cannot be added to the decoration mapping and forgotten in
 * the text mapping. That failure would be invisible: the wrong rung renders,
 * it just renders unreadably.
 * ---------------------------------------------------------------------------
 */

/** Aurora palette families, plus the neutral case that has no family. */
type Family = 'success' | 'warning' | 'info' | 'error';

function statusFamily(level: StatusLevel): Family | 'neutral' {
  switch (level) {
    case 'operational': return 'success';
    case 'degraded':    return 'warning';
    case 'outage':      return 'error';
    case 'maintenance': return 'info';
    // Amendment 1: 'unknown' is the absence of information, not health. It has
    // no palette family and must never read as green.
    case 'unknown':     return 'neutral';
    default:            return unreachable(level, 'statusFamily');
  }
}

function blastFamily(level: BlastMetric['level']): Family | 'neutral' {
  switch (level) {
    case 'warning': return 'warning';
    case 'error':   return 'error';
    // 'normal' is not a status. A blast metric at normal is just a measurement —
    // '512 licensed mailboxes' — and colouring it would invent an assertion the
    // contract does not make.
    case 'normal':  return 'neutral';
    default:        return unreachable(level, 'blastFamily');
  }
}

function severityFamily(severity: Severity): Family {
  switch (severity) {
    case 1:      return 'error';
    case 2:      return 'warning';
    case 3:      return 'info';
    case 'info': return 'info';
    default:     return unreachable(severity, 'severityFamily');
  }
}

/** StatusLevel -> Aurora token. Adapters never return colours; the UI computes them. */
export function statusColor(level: StatusLevel): string {
  const family = statusFamily(level);
  return family === 'neutral' ? 'var(--text-disabled)' : `var(--${family}-main)`;
}

/**
 * The same status as READABLE TEXT. Use wherever a level is painted as words.
 *
 * 'unknown' becomes --text-secondary, not --text-disabled. The decoration grey
 * is 2.29:1 on light paper and 2.78:1 on dark — it fails AA as text in BOTH
 * themes, and 'unknown' is not a rare case: two of the seven services are
 * permanently unknown (Zendesk SSP publishes nothing, M365 consent pending), so
 * this is the label users read most often. --text-secondary is 7.23 / 8.75 and
 * is still neutral grey, so the amendment-1 rule that unknown never reads green
 * is untouched.
 */
export function statusTextColor(level: StatusLevel): string {
  const family = statusFamily(level);
  return family === 'neutral' ? 'var(--text-secondary)' : `var(--${family}-dark)`;
}

/**
 * BlastMetric.level as readable text — the fourth union, and the last one a view
 * was mapping for itself.
 *
 * 'normal' resolves to --text-primary, NOT --text-secondary. A normal blast
 * metric is a headline number on an incident hero, the same weight as any other
 * value; de-emphasising it would imply the figure matters less, which is the
 * opposite of true for '384 users affected'. Measured at 16.28:1 light and
 * 17.72:1 dark on paper, and pinned by the contrast suite below rather than
 * assumed — assuming a rung is what produced all 14 of the G3 failures.
 */
export function blastTextColor(level: BlastMetric['level']): string {
  const family = blastFamily(level);
  return family === 'neutral' ? 'var(--text-primary)' : `var(--${family}-dark)`;
}

export function severityColor(severity: Severity): string {
  return `var(--${severityFamily(severity)}-main)`;
}

/** Severity as readable text. */
export function severityTextColor(severity: Severity): string {
  return `var(--${severityFamily(severity)}-dark)`;
}

/**
 * Background for a SOLID severity chip, paired with severityOnFillColor.
 *
 * Deliberate deviation from README:77/93, taken at gate G3: the prototype fills
 * with `-main`, which puts white on --warning-main at 2.40:1. An unreadable chip
 * is not fidelity. Filling with `-dark` needs no new palette and no new token.
 */
export function severityFillColor(severity: Severity): string {
  return `var(--${severityFamily(severity)}-dark)`;
}

/**
 * The words ON a solid severity chip. Always use this rather than a literal
 * white: Aurora's `-contrast` token is theme-aware, and in the DARK palette
 * `-dark` lightens, so white-on-chip collapses to 1.75:1 for warning and 2.16:1
 * for success. Against `-contrast` the same chips are 9.96:1 and 7.98:1.
 */
export function severityOnFillColor(severity: Severity): string {
  return `var(--${severityFamily(severity)}-contrast)`;
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
