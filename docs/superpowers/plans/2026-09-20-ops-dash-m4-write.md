# Milestone 4 — write

**The one sentence.** Every screen so far only *reads*. M4 is the first milestone where the
operator changes something and the change outlives the page, which means it is really a
milestone about who is allowed to.

Three of the seven screens still render fixtures, two of the three need a credential we
already hold, and the third displays text chosen by an attacker. Those are the additions.
The **subtraction** is that ops-dash currently binds `0.0.0.0` with no authentication — a
deliberate ruling of John's, recorded as the highest-priority item on the release list — and
the first mutating route turns that from an exposure into a liability.

## The ordering this milestone turns on

**The auth seam comes first, and nothing mutating merges before it.**

Not because auth is interesting, but because the alternative has a shape this project has
already paid for three times: two halves each individually correct, disagreeing about the
join. Ship `POST /api/incidents/:id/ack` against the current server and the join is "anyone
on the LAN is John". Every later task then inherits a threat model nobody chose, and the
guard that would have caught it is the one we skipped to go faster.

It is also the cheapest it will ever be. Today there are zero mutating routes, so the seam
is a decision about one middleware. After Task 3 it is a decision about six handlers.

## The board, 2026-09-20 15:5x

Four agents running on disjoint directories. The one file everything wants is
`server/src/api/routes.ts`, so exactly one agent owns it and everyone else reports a route
need rather than editing it.

| # | Task | Owner | Directory | State |
|---|---|---|---|---|
| 1 | **Auth seam** — local user, route-table guard | `m4-auth` | `server/src/auth/**`, `server/src/api/routes.ts` | running · blocks 2, 3 |
| 2 | **Ack / mute / resolve, persisted** | `m4-store` | `server/src/store/**` | running · store half only |
| 3 | **Settings toggles a rule** | — | — | **store half was ALREADY DONE** (`db.ts` + 9 green tests + `index.ts:260` reads it every tick). Only the route (`m4-auth`) and rendering a disabled rule as disabled (`m4-views`) remain |
| 4 | **Entra adapter** | `m4-entra` | `server/src/adapters/entra/**` | **DONE** `b5dc9f2`, live |
| 5 | **Endpoints adapter** | — | — | **BLOCKED**: no EPC credential |
| 6 | **Email adapter** | — | — | **BLOCKED**: no Hornetsecurity CP credential |
| 7 | **Entra page, browser half** | `m4-views` | `web/src/views/Entra.tsx`, `web/src/live/**` | running · contract-first |
| 8 | **Section 7's four missing rules** | `m4-entra` | `server/src/engine/**` | running |
| 9 | `retryAfterMs` on the wire — amend or strip | lead | `DATA_CONTRACTS.md` / `routes.ts` | lead's call |
| 10 | Seam round-trip test, now unblocked by the shared stub | lead | `server/src/entraSource.test.ts` | lead |
| 11 | Resolved platform incidents reachable nowhere | — | needs a history route | queued behind 1 |
| 12 | `Panel.tsx` has no member for *fresh data, partial read* | — | `web/src/components/**` | **change request, deliberately deferred.** `degraded:true` + data + a fresh `fetchedAt` classifies as `stale`, so the headline reads "a few seconds old" when the news is "these counts are lower bounds". True but a buried lede. Widening a shared type while four agents are mid-flight is how one vocabulary becomes four readings of it — do it when the wave is quiet |
| 13 | Resolve-then-reopen needs a sentence on screen | `m4-views` | `web/src/views/**` | queued behind 1. Resolving a still-firing condition reopens it on the next tick, same id, ack intact. Correct, and unreadable as anything but a bug unless the button says so |

**Why these four in parallel and not one queue.** They touch four disjoint directories and the
seams between them are narrow and written into each brief. That is the case the agent-team
section in `CLAUDE.md` says parallelism is *for*. Tasks 2 and 3 are one agent's queue rather
than two agents, because they share a vocabulary — which is the case it says parallelism is
against.

**The seams, decided before either side builds**, because every serious defect in M3 was two
halves each individually correct disagreeing about the join:

- **auth → everything**: one module publishes the answer; the export surface is pinned as a set
  and a guard restricts who may import the narrow form. Nothing else forms an opinion about
  who the user is. `m4-store` takes the actor as a **parameter** and imports nothing from `auth/`.
- **store → routes**: `m4-store` proposes the function signatures to the lead before building;
  a route is a thin call over them.
- **engine → entra**: `m4-entra` proposes what the engine consumes before building. `ServiceSignal`
  is deliberately narrower than `ServiceStatus` so a rule cannot become a function of history;
  whatever replaces or extends it must keep that property.
- **routes → views**: the `/api/entra` response shape is agreed with the lead *first*, and
  `m4-views` builds the browser half against it while the route is written to meet it.

**What is NOT being built while blocked.** No honestly-scoped 16-device Intune panel as a
consolation for Task 5. A screen labelled "Endpoints" carrying a number no operator recognises
is the permanently-wrong-tile failure wearing a new hat, and both the lead and `m4-entra`
reached that conclusion independently.

## Global constraints — these bind every task

Carried forward and non-negotiable.

1. **A failed read never renders as green.** Now with a third state: *we were not allowed
   to look*. `403` is not `unknown` and neither is `empty`.
2. **An assertion may not reach the value under test by the same path the code did.**
3. **Break the thing a test's name claims and watch it go red — and say what should stay
   green.** M3 proved the survivor carries as much of the meaning as the kill.
4. **Stage by path. Never `git add -A`, never `git stash`.**
5. **`shared/src/contracts.ts` is frozen.** M4 needs at least two amendments (ack state,
   and whatever the Email page's row turns out to be). Amend `DATA_CONTRACTS.md` first,
   with John's approval, then the contract, then the consumers. The order is the point.
6. **The fixture path must keep working.** `?demo=quiet|sev1` and the 152 baselines are the
   offline proof. See the open question below before touching `DemoModeProvider`.
7. **Everything upstream stays read-only.** M4 adds writes to *our* store only. A mutating
   Graph call does not belong in this repo, and "acknowledge" means acknowledged here — it
   does not reach into Microsoft's service health.
8. **No new runtime dependency** without asking. This will be tempting for auth. Resist it:
   `node:crypto` already carries the JWT work for Graph.
9. **Fixtures stay redacted.** The Email page makes this sharper, not softer — see Task 6.

## Wave 1 — the seam

### Task 1: the auth seam (agent `ops-security`, with the lead)

The M1 review's "Reopens at release" item 1 says the spec defers sign-in and keeps a seam.
Fill it, and fill it for what is actually true: a single-operator tool on a machine John
controls, now reachable from his desktop.

- Every mutating route authenticated; every read route explicitly marked as it is today,
  so "unauthenticated" is a decision recorded in code rather than an omission.
- `/api/health` discloses certificate metadata and is already on the release list. Decide
  whether it moves behind the seam now.
- **The guard is the deliverable, not the middleware.** A test that enumerates the route
  table and asserts every non-`GET` handler is covered — so a seventh mutating route added
  in six months fails the build rather than quietly shipping open. Assert the *positive
  set*: the M3 lesson is that a guard phrased as an absence claim passes over anything it
  did not think to look for.

**Define the seam before either half is built.** `m3-runs`, who asked for this task and has
spent the milestone on exactly this class of defect, put it best: *the mutating routes and the
auth check will be written against two different ideas of what "authenticated" means unless one
of them is published and the other is forbidden from having an opinion.* That is the
`publishedLevel`/`vendorLevel` fork again — except the failure mode is a route that writes for
someone who is not who they say they are, rather than a tile that is the wrong colour.

So: one module publishes the answer, a guard restricts who may import the narrow form, and the
export surface is pinned as a set. **Mechanical, not documentary** — this project has now
watched three entirely accurate comments fail to prevent the thing they described, in one night.

**RULED 2026-09-20 by John: a local user.** Not federated sign-in, not Entra SSO — a
credential this box owns. Wave 1 is unblocked and Task 1 is one task, not a milestone.

The shape follows the pattern already proven here by the Graph credential: a file outside the
repo at `~/.config/ops-dash/auth.json`, mode 600, read through an env var, holding a username
and a **hash** — never a plaintext password, and never a path, hash or secret transcribed into
source, which `web/src/guards.test.ts` already fails the build over. Sessions are a signed
cookie with `HttpOnly`, `SameSite=Strict`, and `Secure` off only while this is plain HTTP on a
LAN — which is itself a line on the release list, not a decision to forget.

**One thing to get right that is not about auth at all.** The routes and the check will be
written against two different ideas of what "authenticated" means unless one module publishes
the answer and everything else is forbidden an opinion — the `publishedLevel`/`vendorLevel`
fork, except the failure mode is a route that writes for someone who is not who they say they
are. Define the seam before either half is built, pin the export surface as a set, and make the
route-table guard the deliverable.

## Wave 2 — after the seam lands

### Task 2: ack / mute / resolve, persisted (agent `m4-store`)

Local `useState` in M1 by design; the plan said so. Needs schema, mutating routes, and an
actor. The actor is the literal string `John H.` today and becomes whatever Task 1 decides.

**The interesting question is not storage, it is what an acknowledgement means when the
underlying condition clears and returns.** An incident id is
`INC-<sha256(rule\0service\0windowStart)[0:8]>`, so a recurrence after a clear is a
*different* id and arrives unacknowledged — which is correct, and worth an explicit test
rather than an accident of the hash.

### Task 3: Settings actually toggles a rule (folded into Task 2 if small)

The store and engine support it end to end; only the route is missing. A disabled rule must
be visible as disabled on the Overview — a muted detector that looks identical to a quiet
one is the same failure as a permanently-red tile.

## Wave 3 — the three fixture screens, parallel only if the seams are narrow

Read the agent-team section in `CLAUDE.md` before dispatching these. They share a
vocabulary, which is the case where parallelism costs more than it buys. **Default to one
`ops-view` working through all three**, and justify anything else.

The adapters are a different matter and genuinely independent.

### Task 4: Entra adapter (agent `m4-entra`) — **DONE**, `b5dc9f2`, live

A Graph read against the certificate credential at `~/.config/ops-dash/graph.json`. The app
has broad read-only permission; that is a reason to be *narrower* in code, not wider. Request
only what the screen renders, and record which scopes each call uses, because "the toolbox app
can do it" is how a read-only premise erodes.

### Task 5: Endpoints adapter — **BLOCKED, and this plan had the source wrong**

**CORRECTED 2026-09-20. The sentence here used to read "Both are Graph reads." That was my
error and it contradicted two standing records:** `docs/RESUME.md:833` — *"Endpoints page comes
from **Endpoint Central, not Intune**"* — and `DATA_CONTRACTS.md:304`, the contract of record:
*"Source: ManageEngine Endpoint Central Cloud, Zoho OAuth self-client, read-only."* A decided
line and the spec both said EPC; the plan drifted off them in a single clause, and that clause
was load-bearing.

**What it would have shipped, measured on the live tenant before a line was written:**

| source | devices | fills the contract? |
|---|---|---|
| Intune `deviceManagement/managedDevices` | **16** | no. Sixteen, not 612 |
| Entra `/devices` | 1203 registrations | no — 991 are BYOD `Workplace`, no BitLocker, no patch data |
| Endpoint Central | the real estate | **yes**, and there is no credential for it on this box |

Sixteen is not a paging or permission artefact: `managedDeviceOverview` independently reports
`enrolledDeviceCount: 16`. Two separately-reachable definitions, same answer. **A Graph-backed
Endpoints adapter would have rendered `total: 16` on a page whose fixture says 612** — a number
that is plausible, precise, internally consistent and off by 38x. Worse than the v1.0 sign-in
undercount, because 4535-vs-153 at least both described sign-ins; 16 describes a pilot.

**Entra `/devices` is not a fallback, recorded so nobody reaches for it later.** 1026 Windows
objects look temptingly close to 612 until you read the composition: 991 `trustType: Workplace`,
only 186 domain-joined, and just 385 signed in within 30 days. It is a registration registry,
not an inventory — and it carries no `isEncrypted` and no patch data, so three of the contract's
five stats and two of its four `issueKind`s are simply unreachable.

**Blocked on John: there is no EPC credential on this machine.** `~/.config/ops-dash/` holds
only `graph.json` and `graph-key.pem`; no `OPS_DASH_EPC` env var. `RESUME.md` records
`C:\secure\.epc\config.json` on the deploy server — a Windows path, and this is not that
machine.

**And it is a different adapter shape, so the "same agent, queued" argument is weaker than it
looked.** EPC is Zoho OAuth with a refresh token, not certificate JWT, and `RESUME.md` records
two traps to build against: **errors arrive as HTTP 200** (the reason `fetchJson`'s
`non_json_2xx` rule exists at all), and **10 access tokens per refresh token per 10 minutes** —
a hard limit on token minting, not on requests. None of that reuses `graphToken.ts`. What does
transfer is the paging, throttling and shape-validation work in `paged.ts`.

**A trap to pin wherever this lands:** `@odata.count` on `managedDevices` reports the **page**
size, not the collection total — `1` at `$top=1`, `16` at `$top=1000`. An adapter asking for one
row to read a cheap total would report `total: 1` and never page.

**Do not ship an honestly-scoped 16-device Intune panel as a consolation.** It fills a screen
labelled "Endpoints" with a number no operator would recognise, which is the permanently-wrong-
tile failure wearing a new hat.

**Cardinalities: measure, never inherit.** `~512 users` turned out to be enabled members (470)
against a directory of 1658 plus 514 guests and 1473 app registrations. `~612 endpoints` is from
the same source and is unverified against EPC. The rule this milestone earned: **a figure in a
brief is a hypothesis; the first thing an adapter does is test it.**

### Task 6: Email adapter (same agent, queued) — **the security-critical one**

The M1 review names this directly: *"The Email page's whole job is to display
attacker-authored content."* A mail subject and sender address are chosen on purpose by
someone hostile, and a local-only app is still a browser.

- No vendor string reaches an `href`, `src`, `style` string or any HTML sink. Trace each.
- The **redaction rule points the other way here.** Fixtures stay `@example.com` and
  `DEMO-*`, but the live page renders real UPNs and real subjects by design. That is the
  first time those two facts have had to coexist, and the test suite must not become the
  place a real subject line gets committed.
- A screenshot of this page is exfiltration. It does not get a visual baseline from live
  data — baselines come from fixtures, as they always have.

## Wave 4

### Task 7: review gate G6, then the docs and the close.

Point it at the seam between Task 1 and Tasks 2-3 specifically. That is the join this
milestone is most likely to split on, and it is the one where splitting is a vulnerability
rather than a wrong number.

## Open questions — John's, and they change the work

1. **Auth: shared secret or real sign-in?** Recommendation above. Blocks Wave 1.
2. **The three synthetic probes** — `api.anthropic.com/v1/messages` (405),
   `api.openai.com/v1/models` (401), `cp.hornetsecurity.com` (200) — and at what interval.
   Newly relevant: approving them leaves **m365 as the only service without a probe**, which
   puts "ALL SYSTEMS OPERATIONAL" one probe from reachable. Reachable is fine; reaching it
   by accident is not.
3. **`DATA_CONTRACTS.md` §7** promises a Sev2 for a single vendor `unknown` plus our check
   failing. No rule emits one. Either the prose or the engine is wrong.
4. **Resolved incidents are reachable nowhere.** `/api/incidents` serves open rows only, and
   `tile.ts`'s count excludes `platform:` ids by design — correctly, since rolling a blackout
   into its member tiles would print "4 incidents" on four tiles for one upstream failure.
   The result is that a resolved platform incident sits in the store for 180 days with no
   route to it. A history route is the honest fix and is M4-sized. **Do not fix it by widening
   the tile filter** — that trades an invisible row for a lie on four tiles.
5. ~~**Does `DemoModeProvider` die here?**~~ **RULED 2026-09-20: it stays.** The M1 plan's
   instruction to delete it is struck, in the file itself. It read as a prototype smell only
   because in M1 the toggle was the only way to reach both worlds; since M3 it is not, and
   deleting it would take the 152 baselines and the offline proof with it. The control is
   already dev-gated, which was the whole objection.

## Explicitly NOT in M4

Deployment. Everything on the security review's "Reopens at release" list stays struck
*except* the auth item, which M4 addresses because binding `0.0.0.0` already made it real.
Moving ops-dash to the audit dashboard server is John's call and its own milestone.

## Definition of done

Seven screens, none of them fixture-backed in production. An operator can acknowledge an
incident and toggle a rule, and both survive a restart. Nothing mutating is reachable
without passing the seam, and a guard enumerating the route table proves it rather than a
reviewer remembering to look. The 152 baselines still match, the offline proof still holds,
and `npm test` from the root is green.

And the clause M3 could not close: **it survives a night.** M4 does not get to inherit that
one as already-done.
