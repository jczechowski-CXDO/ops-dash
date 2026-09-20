import type { ServiceId } from '@ops-dash/shared';

/**
 * What each service is CALLED on screen.
 *
 * `/api/services` serves `id` and nothing human: the seven display names live
 * in the frozen contract's `short` / `name` fields, which the API does not
 * carry because the store never had them — they were never a measurement, they
 * are a label. So the labels live here, on the side that renders them.
 *
 * A `Record<ServiceId, …>` rather than a lookup with a fallback, for the same
 * reason `api/platforms.ts` is one: an eighth service fails the typecheck
 * instead of rendering a tile labelled `m365x`. There is no default branch and
 * no `?? id`.
 *
 * `serviceNames.test.ts` compares every entry against the FIXTURES' own `short`
 * and `name` for the same id — two independently-reachable definitions of the
 * same fact, so a live tile and a demo tile can never disagree about what a
 * service is called. That comparison is the reason this file is allowed to
 * exist beside the fixtures rather than being a second, drifting copy.
 */
export const SERVICE_NAMES: Record<ServiceId, { short: string; name: string }> = {
  proofpoint: { short: 'Proofpoint', name: 'Proofpoint 365 Total Protection' },
  jira: { short: 'Jira', name: 'Jira Software' },
  helpjuice: { short: 'Helpjuice', name: 'Helpjuice Knowledge Base' },
  claude: { short: 'Claude', name: 'Claude (Anthropic)' },
  openai: { short: 'OpenAI', name: 'OpenAI' },
  zendesk: { short: 'Zendesk', name: 'Zendesk Support' },
  m365: { short: 'Microsoft 365', name: 'Microsoft 365 / Entra ID' },
};

/**
 * The display name for an arbitrary string, which is what an incident's
 * `serviceId` is: the contract widens it deliberately, because an incident can
 * belong to `platform:statuspage` or to a product source that is not one of the
 * seven tiles. Anything unrecognised is returned unchanged rather than guessed
 * at — showing the raw key is honest, and inventing a title for it is not.
 */
export function serviceLabel(serviceId: string): string {
  return Object.hasOwn(SERVICE_NAMES, serviceId)
    ? SERVICE_NAMES[serviceId as ServiceId].short
    : serviceId;
}
