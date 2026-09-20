import { describe, it, expect } from 'vitest';
import type { ServiceId } from '@ops-dash/shared';
import { fixtures } from '../fixtures/index.js';
import { SERVICE_NAMES, serviceLabel } from './serviceNames.js';

/**
 * Two independently-reachable definitions of what a service is called: this
 * map, which the live path uses because the API serves no labels, and the
 * fixtures, which the demo path uses. Neither is computed from the other, so
 * this comparison is a real drift guard rather than a tautology — change one
 * spelling and it goes red.
 */
describe('the live labels and the fixture labels are the same labels', () => {
  const ids = Object.keys(SERVICE_NAMES) as ServiceId[];

  it('covers exactly the seven services the fixtures carry', () => {
    expect([...ids].sort()).toEqual([...fixtures.quiet.services.map((s) => s.id)].sort());
  });

  it.each(['quiet', 'sev1'] as const)('%s: every fixture service agrees with the map', (mode) => {
    for (const service of fixtures[mode].services) {
      expect({ short: service.short, name: service.name }).toEqual(SERVICE_NAMES[service.id]);
    }
  });

  it('pins two of the seven literally, so a matching pair of typos still fails', () => {
    // The comparison above is symmetric: rename a service in BOTH places and it
    // stays green. These two are the anchor, read off the design's own copy.
    expect(SERVICE_NAMES.m365).toEqual({ short: 'Microsoft 365', name: 'Microsoft 365 / Entra ID' });
    expect(SERVICE_NAMES.proofpoint.name).toBe('Proofpoint 365 Total Protection');
  });
});

describe('serviceLabel', () => {
  it('names a service we know', () => {
    expect(serviceLabel('zendesk')).toBe('Zendesk');
  });

  it('returns an unrecognised id unchanged rather than guessing at one', () => {
    // `Incident.serviceId` is deliberately wider than `ServiceId`: the blackout
    // rule opens incidents against `platform:statuspage`, which is not a tile.
    expect(serviceLabel('platform:statuspage')).toBe('platform:statuspage');
    expect(serviceLabel('endpointcentral')).toBe('endpointcentral');
  });

  it('does not treat an inherited Object property as a service', () => {
    // `Object.hasOwn`, not `in` and not a truthy lookup: `serviceLabel
    // ('toString')` must not return a function's name as a service label.
    expect(serviceLabel('toString')).toBe('toString');
    expect(serviceLabel('constructor')).toBe('constructor');
  });
});
