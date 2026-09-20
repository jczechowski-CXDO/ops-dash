import { describe, it, expect } from 'vitest';
import { SERVICE_PLATFORM } from '../services.js';
import { loadVendorFeeds } from '../adapters/vendorstatus/common.js';

/**
 * What `/api/services` assumes about the platform map.
 *
 * It lives beside the API rather than beside `services.ts` because the API is
 * the consumer with something at stake: `platform` is the input that decides
 * whether amendment 10's inference can fire at all, so a wrong entry here is a
 * Zendesk tile stuck grey forever, or — worse — some other vendor's tile going
 * green on our probes alone.
 *
 * There were two copies of the map for a few hours while it lived in
 * `index.ts`, and this file compared them. It does not need to any more: the
 * map moved to `services.ts` and both sides import it. What survives is the
 * cross-check against an independent source, which is the part that was always
 * load-bearing.
 */
describe('the platform of each service has one answer', () => {
  it('matches vendors.json for every feed that is configured', () => {
    // An independent source: the config the adapters actually poll. A map that
    // typechecked and disagreed with the feed would route a service's inference
    // by one platform while its data came from another — and the two lists are
    // written for different reasons, so nothing but this compares them. The
    // `Record` must be exhaustive over `ServiceId`; `vendors.json` lists only
    // what we poll.
    for (const feed of loadVendorFeeds()) {
      expect([feed.id, SERVICE_PLATFORM[feed.id]]).toEqual([feed.id, feed.platform]);
    }
  });

  it('finds feeds to check, so the loop above is not passing on an empty list', () => {
    // The control. A `loadVendorFeeds()` that returned nothing would make the
    // cross-check vacuous and green.
    expect(loadVendorFeeds().length).toBeGreaterThan(0);
  });

  it('pins zendesk to the one platform that publishes no health', () => {
    // A literal, because it is the input to the only inference in the system.
    expect(SERVICE_PLATFORM.zendesk).toBe('zendesk-ssp');
  });
});
