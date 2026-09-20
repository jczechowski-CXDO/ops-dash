import { describe, it, expect } from 'vitest';
import { SERVICE_PLATFORM as FROM_INDEX } from '../index.js';
import { SERVICE_PLATFORM } from './platforms.js';
import { loadVendorFeeds } from '../adapters/vendorstatus/common.js';

describe('the platform of each service has one answer', () => {
  it('matches index.ts, which still holds a copy', () => {
    // Two independently written definitions compared, not one read twice. The
    // day either is edited alone this goes red — which is the only thing
    // holding the duplicate safe until `index.ts` can be pointed at this file.
    expect(SERVICE_PLATFORM).toEqual(FROM_INDEX);
  });

  it('matches vendors.json for every feed that is configured', () => {
    // A third, independent source: the config the adapters actually poll. A
    // map that agreed with index.ts and disagreed with the feed would route a
    // service's inference by one platform while its data came from another.
    for (const feed of loadVendorFeeds()) {
      expect([feed.id, SERVICE_PLATFORM[feed.id]]).toEqual([feed.id, feed.platform]);
    }
  });

  it('pins zendesk to the one platform that publishes no health', () => {
    // Amendment 10 turns on exactly this value. Pinned as a literal: it is the
    // input to the only inference in the system.
    expect(SERVICE_PLATFORM.zendesk).toBe('zendesk-ssp');
  });
});
