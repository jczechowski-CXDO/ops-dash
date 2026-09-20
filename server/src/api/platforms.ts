import type { ServiceId, VendorPlatform } from '@ops-dash/shared';

/**
 * Which platform each service's vendor half comes from.
 *
 * A `Record<ServiceId, …>` rather than a lookup over `vendors.json`, and that
 * is deliberate: this way an eighth `ServiceId` fails the typecheck instead of
 * silently acquiring no platform. Every service is listed whether or not its
 * adapter exists — `blackout` groups by platform, so a service whose platform
 * were merely absent would group with everything else that had none and could
 * manufacture a blackout out of unrelated services.
 *
 * ## Why it is here and not read off the stored payload
 *
 * The snapshot's `data.platform` is the same value and would have saved a
 * file. It is the wrong source: on a poll that has never succeeded there is no
 * payload at all, and on a payload written by an older build the field may be
 * missing — in both cases reading it yields "no platform", which quietly turns
 * amendment 10's inference off and renders a tile grey with nothing anywhere
 * saying why. A typechecked map cannot have a hole.
 *
 * ## Why there are two copies of it today
 *
 * `index.ts` has the original and this agent does not own that file. The two
 * are compared in `platforms.test.ts` — a real comparison of two independently
 * reachable definitions, which goes red the day they diverge. It should become
 * one: `index.ts` already imports `vendorSource` and `SERVICE_ORDER` from
 * `api/routes.js`, so pointing it here is an import line and a deletion.
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
