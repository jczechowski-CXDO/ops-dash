# ops-dash

Internal IT operations dashboard for a ~512-user / ~612-endpoint Microsoft-centric
environment. Node API + Vite SPA, one repo, npm workspaces, TypeScript both sides,
self-hosted. Read-only upstream; the only writes are to our own store.

## Commands

| Command | What it does |
|---|---|
| `npm install` | install all workspaces |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | production build to `web/dist` |
| `npm test` | Vitest, all workspaces. **Runs `typecheck` first** via a `pretest` hook |
| `npm run typecheck` | `tsc -b shared web server` |
| `npm run test:e2e` | Playwright — 152 visual baselines, interaction, the offline proof |
| `npm run test:e2e:update` | regenerate baselines. **Look at them before committing** |
| `npm run icons` | regenerate `web/src/components/aurora/icons.generated.ts` from the Aurora bundle |
| `npm start` | build the server and run it: store + poller + adapters + engine + API, one process |
| `npm run build:server` | emit `server/dist` **and copy the runtime assets** — `tsc` alone produces an artefact that cannot start |
| `npm run dev:server` | the same, under `node --watch` |
| `npm run fonts` | re-vendor Plus Jakarta Sans (only if the font is replaced; one outbound call) |

## Layout

- `shared/src/contracts.ts` — the view-model contract. **Frozen.**
- `web/` — the SPA. `app/` shell and routing, `views/` the seven pages, `components/`
  the eight Aurora primitives plus five dashboard components, `fixtures/` the offline
  data, `theme/` the token helpers, `lib/` the URL guard.
- `web/e2e/` — Playwright. Baselines are **platform-sensitive**; these were generated
  on Linux and will not match Windows.
- `server/` — the API and the detection chain. `http/fetchJson.ts` is the only way out to
  the network and `http/safeTarget.ts` vets every URL it opens; `adapters/vendorstatus/`
  reads the six vendor status feeds and `adapters/synthetic/` runs the reachability probes;
  `store/` is `node:sqlite` plus the pure judgements that belong beside it (`currentLevel`,
  `staleness`, `retention`, `certExpiry`); `poller/` schedules; `engine/` holds the two
  correlation rules; `api/` serves them read-only; `services.ts` is the one platform map
  both the root and the API import; `index.ts` composes it all and `main.ts` runs it.
- **`server/src/main.ts` starts the process; `server/src/index.ts` only composes it.** That
  split is why every test can build the whole chain without binding a port or arming a
  timer. Keep it.
- `server/src/__integration__/` — the chain end to end on the committed real payloads,
  with only `fetch` stubbed. **This is where a seam defect shows up**; three did.
- `design_handoff_it_ops_dashboard/` — the design spec of record. Read-only.
- `docs/superpowers/` — the approved design, the per-milestone plans, the security review.
- `docs/RESUME.md` — **read this first.** State, standing rulings, and the traps.

## Rules that are not obvious from the code

- **`shared/src/contracts.ts` is frozen.** Amend `design_handoff_it_ops_dashboard/DATA_CONTRACTS.md`
  first, with John's approval, then the contract, then the consumers. Never work around it.
- **No runtime external dependencies.** Fonts, icons and tokens are vendored and served
  off our box. The CSP in `index.html` makes this enforceable by the browser rather than
  by everyone remembering it.
- **No literal hex colours in `web/src/`** — every colour is a `var(--*)` token, so dark
  mode needs no second palette.
- **Use the published colour helpers, do not reach for a raw token.** `statusColor` and
  `severityColor` return the `-main` rung, which is **decoration-grade**: correct for a
  dot, a 3px border or a sparkline, and unreadable as text. Text takes
  `statusTextColor` / `severityTextColor` / `blastTextColor`; fills take
  `severityFillColor` with `severityOnFillColor` on top. Bypassing these with a literal
  is how 42 contrast failures accumulated in one wave.
- **Fixtures are permanently redacted.** No real UPNs, hostnames, IPs or mail subjects,
  ever — fixtures are committed and pushed, so they leave the machine even though the
  app does not.
- **A failed fetch must never render as green.** `unknown` is neutral grey, never counts
  toward the all-clear, and never satisfies the vendor half of the Sev1 rule. `m365` is
  permanently `unknown` until its adapter exists, so **"ALL SYSTEMS OPERATIONAL" is
  unreachable in production** — that is correct, not a bug to fix.
- **Filter every vendor feed to the part of it that serves us.** Zendesk publishes every
  pod worldwide (`tenants` → `?subdomain=`, 17 incidents down to 10) and Hornetsecurity
  publishes ten datacentres (`locations` → `containers`, and a service can read
  `maintenance` globally while our region is fine). An unfiltered feed puts other people's
  outages on our tiles, and a tile whose incidents are usually irrelevant is one the
  operator stops reading — the same failure as a permanently-red tile, from the other side.
- **Everything upstream is read-only.** No mutating third-party call belongs in this repo.
- **Every network call goes through `server/src/http/fetchJson.ts`.** It owns the failure
  rules — non-2xx, a 2xx carrying non-JSON, an empty body, a throw, a body over the 5 MB
  cap, and an unsafe target or redirect — and it never throws, because a transport failure
  is a fact to report and not an exception to handle. That invariant is unconditional and
  tested against values that resist being stringified, which is the way it was once false.
- **Every URL this process opens is checked by `http/safeTarget.ts`, including the ones a
  redirect chose.** Parsed, never pattern-matched: `startsWith('https://')` is satisfied by
  `https://attacker@127.0.0.1/`. Redirects are followed manually so the `Location` header
  cannot pick the address for us. `web/src/guards.test.ts` enforces this by grepping for bare `fetch`. There is
  exactly one exemption, `adapters/synthetic/probe.ts`, and it is argued in a block
  comment there: a reachability probe asks a different question and must not read a body.
- **`vendorLevel` is the one honest reading of a service's level.** `publishedLevel` answers
  the narrower question "what did the vendor say"; a guard in `server/src/guards.test.ts`
  stops anything but its own module importing it. Two sibling functions that both sounded
  like the answer produced the same disagreement twice, which is why the third defence is
  mechanical rather than another comment.
- **Absent is not zero, and it crosses the wire as explicit `null`.** No probe data is not
  100% uptime, an empty sparkline is not a flat line at zero, and a service with no checks
  has `ours.total === 0` rather than "passing". An omitted key survives a spread in the web
  layer and silently restores a fixture's number; `null` overrides it and the typechecker
  forces the handling.
- **Nothing in `server/` throws to signal failure**, so nothing may treat a resolved
  promise as success. A `Source.run` that resolves with an errored `SourceResult` has
  failed. This was a shipped defect — the poller counted a source whose feed 503'd every
  minute as polling fine, and `/api/health` served it green.
- **A probe that cannot pass is worse than no probe.** It teaches the operator that red
  means nothing. Three of the four original probe targets could never have passed: two
  Zendesk pod roots behind a Cloudflare bot challenge, and a guessed Jira hostname that
  does not exist. Before adding a probe, run it against the real thing and record what it
  actually answered — `expectStatus` exists because one endpoint's healthy answer is a 401.
- **Runs locally only.** Not deployed, not served to any network. Deployment is John's
  call and is the trigger for everything on the "Reopens at release" list in
  `docs/superpowers/security/2026-09-18-m1-review.md`.

## Working with the agent team

The specialists live in `.claude/agents/`. They are long-lived collaborators, not
one-shot functions, and the difference matters more than it sounds.

**Two idle agents of the same type is the thing to watch for.** Not the headcount —
three `ops-view`s with two dormant. A duplicate specialist is a reuse failure made
visible: the second one exists only because the first was not reused, and the two
now hold divergent, partial pictures of the same files.

**Four tasks for one specialist is a queue, not four agents.** Send them to one
`ops-view` and let it work through them. This is the default and the wave structure
in the M1 plan — four views built in parallel — is the exception that has to justify
itself.

The reason is in this repo's own gate list. **G3 exists solely to catch divergence
created by running four `ops-view`s at once**; its brief says the expected finding is
"four agents quietly inventing four different versions of the same thing". That gate
is a tax we levy on ourselves for the parallelism. One agent through four views
cannot diverge from itself: by the fourth it is matching conventions it set in the
first, rather than a reviewer finding three date formatters afterwards.

Parallelism buys wall-clock and costs coherence, and on this project coherence has
been the expensive one — every serious Milestone 3 defect was two agents each doing
their half correctly and disagreeing about the join, and the same class recurred
three times. Spend the parallelism where the tasks are genuinely independent and the
seam between them is narrow and specified in both briefs. Do not spend it on four
tasks that share a vocabulary.

When several of one type ARE running in parallel, that stops being correct the moment
the parallel work ends: collapse back to one and give the follow-on task to the agent
that owns the files, rather than leaving the others dormant and spawning a fresh one
later.

**Pipeline across types instead of parallelising within one.** That is where the
wall-clock actually is, and it costs no coherence. An agent that has finished a slice
hands the verification to a different specialist — `ops-e2e` for the baselines and
interaction, `ops-reviewer` for the diff — **and starts the next slice immediately**
rather than waiting for the result. Two types working on two stages of the same work
cannot invent two versions of anything, because only one of them is inventing.

The rule for the handoff: the author keeps ownership and fixes what comes back. A
verification agent reports; it does not edit the author's files.

### How peer messages actually arrive, measured

**Inbound messages were not delivered mid-turn, in the one case anyone measured
deliberately.** An agent sent three messages, slept 90 seconds and then 120 seconds for no
purpose but to give the other a chance to answer, received nothing, committed, reported —
and then had six messages delivered in a single batch at its next turn boundary, including
four from the peer it had just described as silent. Both directions had worked the whole
time; only the timing was wrong, and only inbound.

The agent that measured it asked for this paragraph to say so rather than assert a
mechanism, which is the right instinct and this file's own standard. Since then the other
side of that exchange corroborated it independently, and **the direction of the failure is
now settled by evidence neither agent could have manufactured**:

- The receiving agent got two messages **in one batch** that had been sent roughly fifty
  minutes apart, then two more batched with a third.
- Sends never failed either way. The proof is in the commits: `d495367`'s message contains
  the other agent's phrasing verbatim — "interpolating a measurement nobody took",
  "`0` is a measurement, not a hole", "asserted in markup, unverified on screen". Those
  arrived between `0c593af` (21:50:37) and `d495367` (21:53:05), so a message landed
  **between two commits** two and a half minutes apart.
- A receiver deep in a two-minute Playwright run is many minutes from its next tool round,
  which is why "I committed without hearing back" was accurate when written and wrong by the
  time it was read.

**So the constraint is delay, not delivery.** Both agents' accounts were true. Nobody has
seen the transport, so treat batched-at-a-boundary as the observed pattern rather than a
guaranteed mechanism; the consequences below hold regardless, because they follow from the
delay alone.

Three consequences, all of which cost real time before they were understood:

- **An agent cannot wait for a peer inside its own turn.** Sleeping and polling is the
  obvious thing to reach for and it is structurally incapable of working — the message
  cannot be delivered while the agent is sitting in a tool call waiting for it. Do not
  instruct an agent to wait for a reply.
- **A working exchange looks like a monologue from both ends.** Neither party should read
  silence as refusal or disengagement. One agent reported to the lead that the other "never
  replied"; the other had replied twice over before that report was written. Silence means
  *I have not heard yet*, never *they are not answering*.
- **So "ask first" is the wrong instruction.** The right one is **make the first version
  impossible to be wrong about**: strictly additive, existing callers compile untouched, and
  say plainly in the commit that the open questions remain open and the file is yours to
  change on their word. That is what made a late reply cost nothing. Had the first version
  renamed a prop or changed a render path, answers arriving afterwards would have meant
  rework in files the author does not own. Both agents arrived at this independently and it
  is the pattern that makes a laggy channel safe rather than reckless.

A good check before dispatching: *if I spawn this, will there be two live agents of
this type, and is the second one doing something the first genuinely cannot?* If the
honest answer is "the first one is idle and knows these files", that is the agent.

**Keep an agent alive while it still owns something.** An idle agent costs nothing.
What costs is closing the one that wrote `parse.ts` and spawning a fresh
`ops-view` twenty minutes later to extend `parse.ts` — which happened, repeatedly,
in one session. Three things are lost, in increasing order of importance: the prompt
cache, the re-reading, and **the reasoning that never made it into a comment**. The
agent that wrote a file knows why it chose what it chose; its replacement sees only
the result.

**Before dispatching, check `ListAgents`.** If an idle agent owns the files the task
touches, send it the task by name. Spawn a new one when the work is a genuinely
different domain, when the previous context is exhausted or polluted, or when you
want a deliberately fresh reading — a reviewer re-reviewing its own work is worth
nothing.

**There is no way to reset a live agent's context.** `SendMessage` continues it with
everything intact; a new `Agent` call is a new agent; `TaskStop` ends it. Nothing
keeps the agent and drops the history. So **stop-and-respawn IS the reset**, and it
is the right move when a task is done-done and the next one is unrelated — at that
point the accumulated context is not an asset, it is stale assumptions and a spent
window.

The two failure modes pull opposite ways and both are real:

- respawning for work that touches the same files throws away the reasoning that was
  never written down
- reusing across an unrelated task carries assumptions from the old one into the new

The test is the files, not the calendar. Same files or the same seam — reuse. A
different corner of the codebase with nothing carried over — stop it and start
clean, and say in the new brief what the old agent concluded so the useful part
survives the reset.

**Close an agent when its context has no further use — not to tidy a list.** Idle
agents that will be reused are fine; spawning the whole team at the start of a
session and using the ones you need is fine. The waste is an agent that will never
be touched again left open, not the count. Closing is throwing away context, so it
is a decision about the context.

**Never mutate a file you do not own while its owner is awake.** A mutation battery is a
scripted multi-file write against a tree other people are reading. Send the mutation to the
owner and let them run it — the finding travels fine, and it is running it yourself that
creates the collision.

This is not theoretical and it was not an agent. The lead ran
`sed -i 's/if (answered.length === 0) return null;/if (false) return null;/'` on a
component owned by a live agent, to reproduce a finding rather than take it on trust. The
restore fired and both runs ended green — and the owner still found the mutant in their
working tree minutes later, spent twenty minutes reconstructing how it got there, and
concluded it must have been the other agent's battery. It was not. They were about to write
a rule blaming a peer who had done everything right.

**A restore that works is not sufficient.** The hazard is the window between the edit and
the restore, and it exists however reliable the restore is. So the rule is not "restore in a
`finally`" — though do that too — it is do not open the window at all on a file someone else
is reading.

**And the lead is not exempt.** Verifying is not a category that excuses a write; a `sed` is
a write whatever its purpose.

What kept it out of the history was staging by path. A single `git add -A` in that window
would have committed a deliberately broken component under a commit message about tests,
in someone else's file, with their name on it.

**Force-stop them; do not rely on the protocol.** `shutdown_request` needs the agent
to reply with a `shutdown_response`, which it cannot do if `SendMessage` is missing
from its allowlist — ten agents once approved shutdown in prose and none were ever
deregistered. `TaskStop` with the agent's name works regardless.

**They can and should talk to each other.** Every definition carries `SendMessage`
and `ListAgents`. When two agents own opposite sides of a seam, they settle it
directly and tell the lead what they agreed — the lead is not a router. Every serious
defect in Milestone 3 was two agents each doing their half correctly and disagreeing
about the join. Ownership disputes are the exception: those are the lead's call.

Note `to: "main"` is rejected — an agent spawned this way is a main conversation
itself, so `"main"` addresses the sender. Agents address the lead as `team-lead`.

## Testing, and the one habit this repo runs on

**A passing test is not evidence until someone has watched it fail.** This milestone
produced roughly twenty checks that reported success without exercising what their name
claimed — type assertions that never ran, presence-only contract checks, a contrast suite
blind to its own call sites, a baseline tolerance 300x the noise floor, and a screenshot
harness that silently captured empty strips.

So: **before committing a test whose name makes a claim, break the thing it names and
watch it go red.** The rule that covers every case found here is narrower than it sounds —
*an assertion may not reach the value under test by the same path the code did.* Pin a
literal, or compare two independently-reachable definitions.

Three corollaries, each learned the hard way and all in `docs/RESUME.md` with the
evidence: assert what a value **must be**, never what it must not be; run the battery
against the world where the candidates **differ**; and before trusting a check that
passes, prove it can fail.

**The last run before any commit is `npm test` from the repo root.** Two ways to get a
false green, both already paid for:

- `--typecheck.enabled=false` reports tests green while the file does not compile. It
  produced a commit with nine passing tests and a broken build.
- A **scoped** run — `--root web`, `--root server`, `--project x`, a single file path —
  prints "Type Errors: no errors" about that scope only. It produced a commit that left
  `npm test` red on the branch for an hour, with typecheck switched on the whole time.

Scope the run while you iterate; run the whole thing before you commit.

## Current state

Milestone 1 (offline scaffold) is complete: 539 unit tests, 153 e2e tests, 152 visual
baselines, eighteen repository guards, zero AA contrast failures across both themes.

Milestone 2 (detection) is complete: 1067 unit tests. The chain reads six real vendor
status feeds, runs four synthetic probes, correlates two rules, and serves the result
read-only. It has been run against the live internet and detects a simulated outage end
to end. Only `m365` has no adapter — its own is the first that needs a credential.

Milestone 3 (live) is in progress: the server runs as a process, `/api/services` serves a
whole tile, retention and staleness and certificate expiry are watched, and the operator's
rule overrides are read every tick. The SPA wiring is the remaining piece. Plans live under
`docs/superpowers/plans/`. **The server needs Node 24**:
the store is `node:sqlite`, a built-in.
