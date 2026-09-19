# Captured vendor payloads

**These are real responses, captured once by hand. Nothing is redacted and nothing is
invented** — they are public, unauthenticated feeds, and a fixture we wrote ourselves would
test our understanding of the format rather than the format.

Do not reformat them. They are byte-for-byte what came back; re-pretty-printing them loses
the one property that makes them evidence.

| File | URL | Captured | HTTP |
|---|---|---|---|
| `statuspage-jira-summary.json` | `https://jira-software.status.atlassian.com/api/v2/summary.json` | 2026-09-19 | 200 `application/json` |
| `statuspage-helpjuice-summary.json` | `https://status.helpjuice.com/api/v2/summary.json` | 2026-09-19 | 200 `application/json` |
| `statuspage-claude-summary.json` | `https://status.claude.com/api/v2/summary.json` | 2026-09-19 | 200 `application/json` |
| `statuspage-openai-summary.json` | `https://status.openai.com/api/v2/summary.json` | 2026-09-19 | 200 `application/json` |
| `zendesk-ssp-services.json` | `https://status.zendesk.com/api/ssp/services.json` | 2026-09-19 | 200 `application/json` |
| `zendesk-ssp-incidents.json` | `https://status.zendesk.com/api/ssp/incidents.json` | 2026-09-19 | 200 `application/json` |

Captured with, for each URL:

```
curl -sS -o <file> -w '%{http_code} %{content_type} %{size_download}\n' <url>
```

## What the real payloads taught us, that a hand-written fixture would not have

1. **OpenAI's `summary.json` has no `incidents` key and no `scheduled_maintenances` key at
   all.** Its top level is `page`, `status`, `components` — three keys, where Atlassian's is
   five. An adapter that reads `body.incidents.length` throws on OpenAI, today, with nothing
   wrong upstream. `statuspage.ts` treats both arrays as optional and says so.
2. **OpenAI's components carry no `group` / `group_id` fields** and use ULID ids; Atlassian's
   carry both and use short base-32 ids. Nothing may key off either.
3. **Zendesk's `status` field on an incident goes stale.** Incident `10079`
   ("Unable to Access Zendesk", 2026-07-24) is still `status: "monitoring"` two months later,
   while its `resolvedAt` is set to `2026-07-24T12:42:29.000Z`. Openness is therefore read
   from `resolvedAt === null`, never from `status` — reading `status` would have this feed
   showing a July incident as open forever. `zendeskSsp.ts` says so at the call site.
4. **Zendesk's `incidents.json` is a history, not a current-state feed** — 17 incidents here,
   all of them closed. So "empty incidents" is not the common case, and the adapter's green
   signal is "no incident with `resolvedAt === null`", which is still an **absence**. It maps
   to `unknown`, per amendment 4. See the note in `zendeskSsp.ts`.
5. **Zendesk publishes services and incidents in separate documents** joined by
   `included[].attributes.serviceId`, JSON:API style. There is no status field on a service
   anywhere in either document — confirmed against the captured bytes, which is the whole
   evidentiary basis for amendment 4.
