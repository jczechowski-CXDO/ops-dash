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

Open for John, and it changes the work: **is this a shared secret in the config file, or
does it need to be real sign-in?** The honest recommendation is the former — it matches the
single-operator reality and can be done in an evening — but it is his call, and the answer
determines whether Task 1 is one task or a milestone of its own.

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

### Task 4: Entra adapter (agent `m4-graph`)
### Task 5: Endpoints adapter (same agent, queued)

Both are Graph reads against the certificate credential already in place at
`~/.config/ops-dash/graph.json`. The app has broad read-only permission; that is a reason
to be *narrower* in code, not wider. Request only what the screen renders, and record which
scopes each adapter actually uses, because "the toolbox app can do it" is how a read-only
premise erodes.

`~612 endpoints` and `~512 users` are the real cardinalities. Paging is not optional and
the fixture cannot prove it works — the first adapter that quietly returns page one and
calls it the estate is a lie that looks exactly like data.

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
5. **Does `DemoModeProvider` die here?** The M1 plan says M4 removes it. But the 152
   baselines and the offline proof are *built on* `?demo=`, so removing it deletes the
   regression suite along with the affordance. **Recommendation: keep it, dev-gated, and
   strike the M1 note** — the thing that made it a prototype smell was that it was the only
   way to reach both states, and since M3 it is not. Do not remove it silently.

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
