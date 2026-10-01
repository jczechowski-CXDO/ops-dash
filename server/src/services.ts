import type { ServiceId, VendorPlatform } from '@ops-dash/shared';

/**
 * Which platform each service's vendor half comes from.
 *
 * Here, in a module neither the composition root nor the API owns, because both
 * need it and neither should import the other — `index.ts` composes `api/`, so
 * an `api/` module owning this would eventually be a cycle.
 *
 * **A typechecked `Record`, not something derived from the feed.** Reading the
 * platform off `result.data.platform` is the obvious way to avoid a second
 * list, and it is wrong: a poll that has never succeeded has no payload, so it
 * yields "no platform" — which silently disables amendment 10's inference and
 * renders the tile grey with nothing saying why. A `Record<ServiceId, …>` cannot
 * have that hole, and an eighth `ServiceId` fails the typecheck here instead of
 * quietly acquiring no platform.
 *
 * `api/platforms.test.ts` cross-checks this against `vendors.json`, so the two
 * cannot drift even though they are written twice for different reasons: this
 * one must be exhaustive over the union, that one lists what we actually poll.
 */
export const SERVICE_PLATFORM: Record<ServiceId, VendorPlatform> = {
  proofpoint: 'statusio',
  m365: 'msgraph',
  jira: 'statuspage',
  helpjuice: 'statuspage',
  claude: 'statuspage',
  openai: 'statuspage',
  zendesk: 'zendesk-ssp',
};
