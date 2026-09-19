import { describe, it, expect } from 'vitest';
import { fixtures } from '../fixtures/index.js';
import { allOperational } from '../theme/statusColor.js';
import { affirmedCount, pageMeta } from './pageMeta.js';

const worlds = ['quiet', 'sev1'] as const;

describe('affirmedCount', () => {
  it.each(worlds)('agrees with allOperational in the %s world', (mode) => {
    const services = fixtures[mode].services;
    expect(affirmedCount(services) === services.length).toBe(allOperational(services));
  });

  it('counts a service only when both halves affirm it', () => {
    const services = fixtures.quiet.services;
    // Blind OUR half of a service the vendor calls operational. The first
    // entry in the list will not do: it is m365, already unknown on the vendor
    // side, so blinding it changes nothing and the assertion would have been
    // measuring the wrong thing.
    const target = services.findIndex((s) => s.vendor.level === 'operational' && s.ours.level === 'operational');
    expect(target).toBeGreaterThanOrEqual(0);
    const blinded = services.map((s, i) =>
      i === target ? { ...s, ours: { ...s.ours, level: 'unknown' as const } } : s,
    );
    expect(affirmedCount(blinded)).toBe(affirmedCount(services) - 1);
  });
});

describe('pageMeta', () => {
  it('never asserts health over a service it cannot see', () => {
    const { subtitle } = pageMeta('/', fixtures.quiet);
    expect(fixtures.quiet.incidents).toHaveLength(0);
    expect(subtitle).not.toMatch(/All \d+ monitored services healthy/);
    expect(subtitle).toBe('5 of 7 monitored services affirmed healthy · 2 unknown · 512 users, 612 endpoints');
  });

  it('would say all healthy, and only then, if every service were affirmed', () => {
    // The all-clear branch is not dead code — it is unreachable from today's
    // fixtures and from production, and reachable the day Zendesk publishes a
    // status field and Graph consent lands. Proven by constructing that world.
    const allGreen = {
      ...fixtures.quiet,
      services: fixtures.quiet.services.map((s) => ({
        ...s,
        vendor: { ...s.vendor, level: 'operational' as const },
        ours: { ...s.ours, level: 'operational' as const },
      })),
    };
    expect(pageMeta('/', allGreen).subtitle).toBe('All 7 monitored services healthy · 512 users, 612 endpoints');
  });

  it('counts the open incidents of the world it is given', () => {
    expect(pageMeta('/', fixtures.sev1).subtitle).toBe(
      `${fixtures.sev1.incidents.length} open incidents across 7 monitored services`,
    );
  });

  it('titles a service page from the service and an incident page from the incident', () => {
    expect(pageMeta('/services/m365', fixtures.sev1).title).toBe('Microsoft 365 / Entra ID');
    expect(pageMeta('/services/nope', fixtures.sev1).title).toBe('Service detail');
    expect(pageMeta('/incidents/INC-2291', fixtures.sev1)).toEqual({
      title: 'INC-2291',
      subtitle: fixtures.sev1.incidents.find((i) => i.id === 'INC-2291')!.title,
    });
    expect(pageMeta('/incidents/INC-0000', fixtures.sev1)).toEqual({
      title: 'Incident',
      subtitle: 'Incident not found',
    });
  });

  it('takes the endpoint population from the snapshot, not from the copy deck', () => {
    expect(pageMeta('/endpoints', fixtures.sev1).subtitle).toBe(
      `${fixtures.sev1.endpoints.stats.total} managed endpoints · Endpoint Central`,
    );
  });
});
