# Entra adapter fixtures

**Hand-built, not captured.** Every other `__fixtures__` directory in this repo holds a
real upstream payload, committed verbatim, because those feeds are public status pages.
These are not. A Microsoft Graph response about this tenant is directory data — UPNs,
object ids, sign-in source addresses — and fixtures in this repository are committed and
pushed, so they leave the machine even though the app does not.

So these files reproduce the **shapes** that were measured against live Graph on
2026-09-20, with every value replaced: `@example.com` for principals, `DEMO-*` for
identifiers, and nothing resembling a GUID anywhere (`web/src/guards.test.ts` refuses a
GUID literal in repo source, and it is right to — it cannot tell Microsoft's well-known
constants from this tenant's identifiers).

What was measured, and is faithfully reproduced here:

- `@odata.nextLink` is an absolute `https://graph.microsoft.com/...` URL carrying a
  `$skiptoken`, and it is the only thing that says there is more. The two `signins-failed-*`
  files exist so the paging test has **more than one page** — the live tenant returns two
  pages of users, two of app registrations and at least two of failed sign-ins in 24
  hours, and an adapter that reads page one and stops is wrong by a factor of three in the
  reassuring direction.
- `initiatedBy` carries either a `user` or an `app`, never both, and a row initiated by
  neither is what the contract's `'System'` actor is for.
- `targetResources` is an array whose first entry is the subject of the event.
- Application credentials arrive as two sibling arrays, `passwordCredentials` and
  `keyCredentials`, with the same `endDateTime` shape.
