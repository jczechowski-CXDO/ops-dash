import { describe, it, expect } from 'vitest';
import type { ServiceStatus } from '@ops-dash/shared';
import { statusColor, severityColor, severityLabel, timelineColor, allOperational } from './statusColor.js';

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
