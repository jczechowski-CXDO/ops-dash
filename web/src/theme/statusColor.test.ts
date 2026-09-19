// @vitest-environment node
// This file asserts real WCAG contrast ratios against the shipped token sheet,
// which means reading it from disk. Nothing here touches the DOM. Pinning the
// environment is also what defect G-7 requires: under jsdom import.meta.url is
// an http:// URL and fileURLToPath rejects it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServiceStatus } from '@ops-dash/shared';
import {
  blastTextColor,
  statusTextColor,
  severityTextColor,
  severityFillColor,
  severityOnFillColor,
  statusColor,
  severityColor,
  severityLabel,
  timelineColor,
  allOperational,
  isAffirmed,
} from './statusColor.js';

const svc = (vendor: ServiceStatus['vendor']['level'], ours: ServiceStatus['ours']['level']) =>
  ({ vendor: { level: vendor }, ours: { level: ours } }) as ServiceStatus;

describe('statusColor', () => {
  it('maps every StatusLevel to its token', () => {
    expect(statusColor('operational')).toBe('var(--success-main)');
    expect(statusColor('degraded')).toBe('var(--warning-main)');
    expect(statusColor('outage')).toBe('var(--error-main)');
    expect(statusColor('maintenance')).toBe('var(--info-main)');
  });

  it('renders unknown as neutral grey, never green', () => {
    expect(statusColor('unknown')).toBe('var(--text-disabled)');
    expect(statusColor('unknown')).not.toBe(statusColor('operational'));
  });
});

const LEVELS = ['operational', 'degraded', 'outage', 'maintenance', 'unknown'] as const;

describe('isAffirmed', () => {
  it('affirms only when BOTH halves are operational', () => {
    expect(isAffirmed(svc('operational', 'operational'))).toBe(true);
  });

  it('is false for every non-operational vendor level, one by one', () => {
    for (const level of LEVELS.filter((l) => l !== 'operational')) {
      expect({ level, affirmed: isAffirmed(svc(level, 'operational')) }).toEqual({
        level,
        affirmed: false,
      });
    }
  });

  it('is false for every non-operational level of OUR OWN probes, one by one', () => {
    // A vendor status page is a claim about their fleet, not a measurement of
    // our path to it. Dropping this half is the mutation that reads green while
    // our synthetic checks are failing.
    for (const level of LEVELS.filter((l) => l !== 'operational')) {
      expect({ level, affirmed: isAffirmed(svc('operational', level)) }).toEqual({
        level,
        affirmed: false,
      });
    }
  });

  it('does not treat announced maintenance as health', () => {
    // Amendment 1: not an incident, but not an assertion of health either.
    expect(isAffirmed(svc('maintenance', 'operational'))).toBe(false);
  });

  it('is the definition allOperational is built from, so the two cannot drift', () => {
    // The header subtitle counts with isAffirmed and the Overview banner decides
    // with allOperational. If these ever disagree, one screen contradicts the
    // other while both look right in isolation.
    const lists: ServiceStatus[][] = [
      [svc('operational', 'operational'), svc('operational', 'operational')],
      [svc('operational', 'operational'), svc('maintenance', 'operational')],
      [svc('operational', 'operational'), svc('unknown', 'operational')],
      [svc('operational', 'degraded')],
    ];
    for (const list of lists) {
      expect(allOperational(list)).toBe(list.every(isAffirmed));
    }
  });
});

describe('allOperational', () => {
  it('is true only when every service is affirmatively operational on both halves', () => {
    expect(allOperational([svc('operational', 'operational'), svc('operational', 'operational')])).toBe(true);
  });

  it('is false when any service is unknown — one Statuspage failure must not read as all-green', () => {
    expect(allOperational([svc('operational', 'operational'), svc('unknown', 'operational')])).toBe(false);
  });

  it('is false when a vendor is green but our own probe is not', () => {
    expect(allOperational([svc('operational', 'degraded')])).toBe(false);
  });

  it('is false during announced maintenance', () => {
    expect(allOperational([svc('maintenance', 'operational')])).toBe(false);
  });

  it('is false over an empty list — no services is not the same as all healthy', () => {
    // [].every() is vacuously true. A failed or empty fixture load would
    // otherwise render ALL SYSTEMS OPERATIONAL over no evidence at all, which is
    // the rule the contract already states for SourceResult.empty.
    expect(allOperational([])).toBe(false);
  });
});

describe('severity helpers', () => {
  it('maps severity to token and label', () => {
    expect(severityColor(1)).toBe('var(--error-main)');
    expect(severityColor(2)).toBe('var(--warning-main)');
    expect(severityColor(3)).toBe('var(--info-main)');
    expect(severityColor('info')).toBe('var(--info-main)');
    expect(severityLabel(1)).toBe('SEV 1');
    expect(severityLabel('info')).toBe('INFO');
  });
});

describe('blastTextColor', () => {
  it('maps the two status levels to the text-grade rung', () => {
    expect(blastTextColor('warning')).toBe('var(--warning-dark)');
    expect(blastTextColor('error')).toBe('var(--error-dark)');
  });

  it('leaves a normal metric as ordinary primary text, not a de-emphasised one', () => {
    // '384 users affected' at level normal is a headline figure, not a footnote.
    expect(blastTextColor('normal')).toBe('var(--text-primary)');
    expect(blastTextColor('normal')).not.toBe('var(--text-secondary)');
  });

  it('never colours a normal metric as though it carried a status', () => {
    for (const other of ['warning', 'error'] as const) {
      expect(blastTextColor('normal')).not.toBe(blastTextColor(other));
    }
  });
});

describe('timelineColor', () => {
  it('maps each kind to the dot colour from DATA_CONTRACTS section 2', () => {
    expect(timelineColor('opened')).toBe('var(--text-secondary)');
    expect(timelineColor('detected')).toBe('var(--error-main)');
    expect(timelineColor('escalated')).toBe('var(--error-main)');
    expect(timelineColor('vendor')).toBe('var(--warning-main)');
    expect(timelineColor('update')).toBe('var(--info-main)');
    expect(timelineColor('resolved')).toBe('var(--success-main)');
  });
});


// ---------------------------------------------------------------------------
// Contrast, measured rather than asserted by eye
//
// G3 found 14 AA failures that no Vitest run could have caught, because jsdom
// does not resolve var() against the token sheet. It does not follow that the
// class is untestable — only that it cannot be tested through the DOM. Here the
// token sheet is parsed directly and the ratios are computed, which is the same
// arithmetic a browser does and needs no browser to do it.
// ---------------------------------------------------------------------------

const TOKENS = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../public/aurora/tokens/fig-tokens.css',
);

function palettes(): { light: Map<string, string>; dark: Map<string, string> } {
  const css = readFileSync(TOKENS, 'utf8');
  // Matched on the `, .dark {` half of the selector deliberately. The obvious
  // regex spells out the attribute-selector form, and that literal is exactly
  // what the no-second-dark-palette guard greps for — this file reads the one
  // palette rather than declaring a second, but the guard cannot tell the
  // difference and should not have to. Writing the pattern another way is the
  // fix; weakening the guard, or assembling the literal from fragments to slip
  // past it, would not be.
  const split = /,\s*\.dark\s*\{/.exec(css);
  if (!split) throw new Error('no dark palette found in fig-tokens.css');
  const parse = (chunk: string) => {
    const out = new Map<string, string>();
    for (const [, name, value] of chunk.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      out.set(name!, value!.trim());
    }
    return out;
  };
  const light = parse(css.slice(0, split.index));
  // The dark block overrides the light one; it does not replace it.
  const dark = new Map([...light, ...parse(css.slice(split.index))]);
  return { light, dark };
}

/** 'var(--x)' or '--x' -> 'rgb(r,g,b)', following var() chains. */
function resolve(palette: Map<string, string>, token: string, depth = 0): string {
  const name = /^var\(--([\w-]+)\)$/.exec(token)?.[1] ?? token.replace(/^--/, '');
  const value = palette.get(name);
  if (value === undefined) throw new Error(`unknown token --${name}`);
  if (depth > 10) throw new Error(`var() cycle at --${name}`);
  return /^var\(/.test(value) ? resolve(palette, value, depth + 1) : value;
}

function luminance(rgb: string): number {
  const parts = rgb.match(/\d+/g);
  if (!parts || parts.length < 3) throw new Error(`not an rgb colour: ${rgb}`);
  const [r, g, b] = parts.slice(0, 3).map((n) => {
    const c = Number(n) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(palette: Map<string, string>, a: string, b: string): number {
  const la = luminance(resolve(palette, a));
  const lb = luminance(resolve(palette, b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const THEMES = Object.entries(palettes()) as [string, Map<string, string>][];
const ALL_LEVELS = ['operational', 'degraded', 'outage', 'maintenance', 'unknown'] as const;
const ALL_SEVERITIES = [1, 2, 3, 'info'] as const;
const PAPER = 'var(--background-paper)';
const ALL_BLAST_LEVELS = ['normal', 'warning', 'error'] as const;

describe('contrast of the text-grade colours', () => {
  it('the measurement is real — the decoration rung is proven to FAIL as text', () => {
    // Without this, a resolver bug that returned the same colour twice would
    // make every ratio 1.00 or every ratio pass, and the suite would be theatre.
    const light = palettes().light;
    expect(contrast(light, 'var(--warning-main)', PAPER)).toBeLessThan(4.5);
    expect(contrast(light, 'var(--warning-dark)', PAPER)).toBeGreaterThanOrEqual(4.5);
  });

  it('every StatusLevel clears AA as text on paper, in both themes', () => {
    const failures: string[] = [];
    for (const [theme, palette] of THEMES) {
      for (const level of ALL_LEVELS) {
        const ratio = contrast(palette, statusTextColor(level), PAPER);
        if (ratio < 4.5) failures.push(`${theme}/${level} ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('every Severity clears AA as text on paper, in both themes', () => {
    const failures: string[] = [];
    for (const [theme, palette] of THEMES) {
      for (const severity of ALL_SEVERITIES) {
        const ratio = contrast(palette, severityTextColor(severity), PAPER);
        if (ratio < 4.5) failures.push(`${theme}/sev${String(severity)} ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('every BlastMetric level clears AA as text on paper, in both themes', () => {
    const failures: string[] = [];
    for (const [theme, palette] of THEMES) {
      for (const level of ALL_BLAST_LEVELS) {
        const ratio = contrast(palette, blastTextColor(level), PAPER);
        if (ratio < 4.5) failures.push(`${theme}/${level} ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('a solid severity chip is readable in both themes', () => {
    // The pairing matters more than either half: in the dark palette `-dark`
    // LIGHTENS, so a chip filled correctly but lettered in white collapses to
    // 1.75:1. Measure the two together, as they are actually rendered.
    const failures: string[] = [];
    for (const [theme, palette] of THEMES) {
      for (const severity of ALL_SEVERITIES) {
        const ratio = contrast(palette, severityOnFillColor(severity), severityFillColor(severity));
        if (ratio < 4.5) failures.push(`${theme}/sev${String(severity)} ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('white lettering on a chip would NOT be readable — why severityOnFillColor exists', () => {
    const dark = palettes().dark;
    expect(contrast(dark, 'var(--common-white)', severityFillColor(2))).toBeLessThan(3);
    expect(contrast(dark, severityOnFillColor(2), severityFillColor(2))).toBeGreaterThanOrEqual(4.5);
  });

  it('records the decoration rung against the 3:1 non-text bar, gaps included', () => {
    // statusColor/severityColor keep returning -main for dots, 3px borders and
    // sparkline strokes, and their behaviour is deliberately unchanged — four
    // Wave 3 agents are written against them.
    //
    // But the premise that -main clears the 3:1 non-text bar (WCAG 1.4.11, which
    // a status dot is squarely subject to: it is a graphical object conveying
    // information) does NOT hold on light paper. Measured, not assumed. This is
    // pinned rather than deleted so the gap is visible and any drift fails here.
    //
    // RULED at G3, and the ruling is NOT a colour change. Where a dot has a text
    // equivalent it is decoration and -main is correct: the service tile carries
    // "Vendor: {label}" and "Ours: {label}" (README section 1), so its dot is
    // redundant. Where a dot was the SOLE carrier of status — the Overview strip
    // pill, which was [dot][service name] and nothing else — the defect was
    // larger than contrast: WCAG 1.4.1 Use of Color at Level A, and a screen
    // reader announced the service with no status at all. The fix is the text
    // equivalent (w3-overview added srOnly status text), not a darker dot.
    // Darkening would have satisfied a contrast checker while leaving a blind
    // user with nothing — a green signal that does not mean what it says.
    // This list is therefore a recorded decision, not an open failure.
    const gaps: string[] = [];
    for (const [theme, palette] of THEMES) {
      for (const level of ALL_LEVELS) {
        const ratio = contrast(palette, statusColor(level), PAPER);
        if (ratio < 3) gaps.push(`${theme}/${level} ${ratio.toFixed(2)}`);
      }
      for (const severity of ALL_SEVERITIES) {
        const ratio = contrast(palette, severityColor(severity), PAPER);
        if (ratio < 3) gaps.push(`${theme}/sev${String(severity)} ${ratio.toFixed(2)}`);
      }
    }
    expect(gaps).toEqual([
      'light/degraded 2.40',
      'light/maintenance 2.82',
      'light/unknown 2.29',
      'light/sev2 2.40',
      'light/sev3 2.82',
      'light/sevinfo 2.82',
      'dark/unknown 2.78',
    ]);
  });

  it('the text-grade colours have no such gap — the fix is complete where it applies', () => {
    const gaps: string[] = [];
    for (const [theme, palette] of THEMES) {
      for (const level of ALL_LEVELS) {
        if (contrast(palette, statusTextColor(level), PAPER) < 3) gaps.push(`${theme}/${level}`);
      }
    }
    expect(gaps).toEqual([]);
  });
});
