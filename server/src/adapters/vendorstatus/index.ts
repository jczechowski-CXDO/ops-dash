import type { SourceResult } from '@ops-dash/shared';
import type { FetchLike } from '../../http/fetchJson.js';
import { unknownVendor, type Vendor, type VendorFeed } from './common.js';
import { pollStatuspage } from './statuspage.js';
import { pollZendeskSsp } from './zendeskSsp.js';
import { pollStatusio } from './statusio.js';
import { pollMsgraph } from './msgraph.js';
import type { TokenSource } from '../../http/graphToken.js';

export { loadVendorFeeds, VENDORS_JSON } from './common.js';
export type { Vendor, VendorFeed } from './common.js';

/**
 * Platform dispatch.
 *
 * One adapter per **platform**, not per vendor — four of the seven services sit
 * behind Statuspage and share one implementation, so a fifth Statuspage vendor
 * is a row in `vendors.json` and no code at all. `index.test.ts` proves that by
 * loading a five-entry list and polling the new row.
 *
 * Every path here returns a `SourceResult<Vendor>`; nothing throws. A platform
 * we cannot poll yet is an explicit error with an `unknown` level, because a
 * missing adapter is a thing we cannot see, and this codebase never renders a
 * thing it cannot see as green.
 */
export async function pollVendor(
  feed: VendorFeed,
  fetchImpl?: FetchLike,
  /** Only `msgraph` needs one. Passed in rather than constructed here so the
   *  credential has exactly one owner and tests never touch a real one. */
  tokens?: TokenSource,
): Promise<SourceResult<Vendor>> {
  switch (feed.platform) {
    case 'statuspage':
      return pollStatuspage(feed, fetchImpl);
    case 'zendesk-ssp':
      return pollZendeskSsp(feed, fetchImpl);
    case 'statusio':
      return pollStatusio(feed, fetchImpl);
    case 'msgraph':
      // The only adapter that needs a credential. Without a token source it is
      // unconfigured rather than broken, and says so — an operator who has not
      // set the credential up should see that, not a vendor-shaped failure.
      if (tokens === undefined) {
        return {
          fetchedAt: new Date().toISOString(),
          degraded: false,
          error: { code: 'graph_unconfigured', message: 'no Graph credential is configured for this process' },
          data: unknownVendor(
            feed.platform,
            'No Microsoft Graph credential is configured, so this vendor has never been polled. This is not an assertion of health.',
          ),
        };
      }
      return pollMsgraph(feed, fetchImpl, tokens);
    default: {
      // A fifth VendorPlatform added to the frozen contract fails the typecheck
      // here rather than falling through to a silent, level-less result.
      const unreachable: never = feed.platform;
      throw new Error(`unhandled VendorPlatform: ${String(unreachable)}`);
    }
  }
}
