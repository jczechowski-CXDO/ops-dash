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
  toward the all-clear, and never satisfies the vendor half of the Sev1 rule.
  **"ALL SYSTEMS OPERATIONAL" is unreachable in production** — that is correct, not a bug
  to fix. Note the *reason* has moved and the old one is no longer true: `m365` has had an
  adapter since M3 and reports a real vendor level. The all-clear now fails on the **ours**
  half, because `allOperational` demands both halves be affirmatively `operational` and four
  services have `ours.total === 0` — proofpoint, claude, openai and m365 have no synthetic
  probe, so their `ours.level` is `unknown`, which is honest rather than broken. If the three
  proposed probes are approved, **m365 becomes the sole holdout** and the all-clear is one
  probe away from reachable. Decide that deliberately; do not let it happen as a side effect.
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

## The machine this runs on

Facts agents keep rediscovering, one at a time, at the cost of a round trip each.

| | |
|---|---|
| **Runtime** | Node 24 (`node:sqlite` is a built-in). Linux. |
| **The live server** | `http://192.168.1.201:4400` — bound `0.0.0.0` by John's ruling. `PORT=4400 OPS_DASH_DB=… node server/dist/main.js`. |
| **Its store** | `/tmp/longrun.sqlite` holds real overnight data. **Point your own runs at a different `OPS_DASH_DB`.** |
| **Credentials** | `~/.config/ops-dash/{graph,epc,hornet,auth}.json`, mode 600. Located by `OPS_DASH_*_CONFIG` env vars **which are not set** — every loader falls back to `join(homedir(), '.config', 'ops-dash', …)`, and the fallback is what has always been used. Do not export anything. |
| **Scratchpad** | Use it for backups, probes and throwaway specs. Never `/tmp` for repo-adjacent work, and never a scratch file under `server/src` or `web/src` — the guards walk those and a stray file reddens somebody else's build. |
| **Baselines** | Generated on Linux. Platform-sensitive; they will not match Windows. |

**`npm test` runs `typecheck` first via `pretest`, and `tsc -b` aborts on the first file
that fails to PARSE.** A syntax error anywhere in `server/src` or `web/src` therefore makes
the typecheck **blind, not merely red** — every other file goes unchecked and every agent
reads a clean-looking result as being about their own code. Measured: a deliberate type error
in `rules.ts` produced no output at all while an unrelated file was unparseable. If you see
only other people's errors, you have learned nothing about yours.

**The one command that always tells the truth is `npm test` from the repo root.** A scoped run
(`--root server`, a single file path) prints "Type Errors: no errors" about that scope only,
and has produced a red branch twice.

## What needs a human, and what does not

**Never prompts, run freely:** the project's own `npm`/`npx` commands, read-only `git`
(`log`, `status`, `diff`, `show`, `ls-files`), the usual inspection tools, `node -e` and
`python3 -c` for proving a claim rather than asserting it, and `curl` against
`127.0.0.1`/`localhost`.

**Deliberately still asks, and should:** `curl` to any external host. Probing a vendor is a
decision with consequences — one over-privileged token has already been revoked over exactly
that, and an adapter's first live call is the moment to think rather than the moment to be
unblocked.

**Never, and these are denied at the permission layer rather than merely written down here**,
because this project has counted four accurate comments that failed to prevent the thing they
described:

- `git add -A` / `git add .` — captures another agent's in-flight work under your message.

**And staging by path is NOT enough. Commit by path.**

```bash
git commit -m "…" -- path/one.ts path/two.ts     # takes ONLY these
```

`git add` and `git commit` share one index across every agent on this checkout. So
`git add mine.ts && git commit` commits **everything currently staged**, including files
another agent staged thirty seconds ago and has not committed yet. You never typed `-A` and
you take their work anyway.

Measured, in a scratch repo:

```
their file staged, then:  git add mine.txt && git commit   ->  2 files changed  (took theirs)
their file staged, then:  git commit -- mine.txt           ->  1 file changed   (theirs still staged)
```

This has now happened **three times**: `1fbd2a8`, `m4-auth`'s four `/api/entra` files landing
inside somebody else's commit, and `fb5ed18` — **the commit that added this very rule, which
swept four of `m4-email`'s files in under a message about documentation.** The rule and its
violation are the same commit object, which is the least arguable evidence this file contains
for why these belong at the permission layer rather than in prose.

Twice of the three were **docs commits**. A docs commit feels safe to stage broadly in a way a
code commit does not, and that feeling is the whole mechanism.

`git commit -- <paths>` bypasses the index entirely, so it is immune to the race and needs no
discipline about *when* you stage. Prefer it always; it costs nothing when you are alone.

**`--` must come after every option.** `git commit -- file.ts -F -` fails with
`pathspec '-F' did not match any file(s)`, which points at the wrong thing entirely. The
working order is `git commit -F <msgfile> -- <paths>`. The natural way to type it is the way
that breaks.

## Four ways a mutation battery lies to you

All found in one afternoon, all by agents who were being careful about everything else.

**1. A mutant that was never planted looks exactly like a mutant that survived.** A `sed`
whose pattern did not match plants nothing, and if the failure breaks an `&&` chain the test
never runs — so the output is silent in precisely the place a passing run is also silent.
**Never plant a mutant without asserting it is there.** `grep -c` the mutated text and check
the count *before* running the suite; that check has no silent form.

**2. The battery is exactly when you disable the typecheck, and exactly when a type error
reads as a surviving mutant.** Iterating with `--typecheck.enabled=false`, an agent's test
called `open()` with no argument — a compile error the root typecheck would have caught — so
`openStore(undefined)` fell through to its `'ops-dash.sqlite'` default: **a real file in the
repo root, shared across every test and persisting between runs.** Their cold-start test had
been passing against leftover state, and the mutation that should have killed it did not.
Re-enable the typecheck before you believe a survivor.

**3. A single before-control is not a control on this branch.** It establishes the tree's state
at one instant; the measurement happens at a different one, and the gap is exactly long enough
for somebody else's commit.

```
17:15:28Z  control, unmutated        ->  0 failures
17:15:53Z  mutation applied          ->  routeTable RED (2)      "reproduced against a clean control"
17:17:43Z  control, unmutated AGAIN  ->  routeTable RED (3)      no mutation anywhere
```

**The control was true when taken and false twenty-five seconds later.** Another agent had
committed twice in the window. One more run away from committing *"breaking the text escaper
reddens the route table"* — a coupling that does not exist — into a module two adapters depend
on, with a reproduction recipe that would have wasted whoever tried it.

**Use interleaved A/B/A: control, mutate, control, with the second control adjacent to the
measurement.** Three runs instead of two, sixty seconds, and it separates *my mutation did this*
from *the tree moved* without any inference. **On a shared branch a control has a shelf life
measured in seconds.**

**And the cheap alternative does not work: you cannot substitute `git log`.** The obvious
saving is to skip the second control and check afterwards whether anyone committed between the
first one and the measurement. It fails, because **vitest reads the working tree and not HEAD**.
An edit affects every agent's run from the moment it is *saved*; the commit that contains it may
arrive minutes later or never. A commit timestamp is an upper bound on when a change started
breaking your control, not the moment it did.

That is not hypothetical — it is what actually happened here. The lead excluded their own
`static.ts` edit as the cause of a 17:15:53Z red because they committed it at 17:16:08Z. The
edit had been sitting in the shared tree the whole time, and it *was* the cause. **Anyone
reconstructing that afternoon from the history would have reached the same wrong conclusion**,
because the thing that invalidated the control was invisible in `git log` by construction. Only
an adjacent second control catches it.

What a real coupling looks like, from the same battery: the escaping reds were **identical
across all three mutated runs** — `vendorText=4, email/parse=1, endpoints/queries=2`, every
time. The auth column moved run to run and eventually appeared with no mutation at all. Stable
across runs is the signal; present once is not.

**4. A mutation that does not typecheck is a bad instrument.** One attempt left a variable
assigned and unused — a type error — and Vitest warns that unhandled source errors *"may cause
false positive tests"*. Re-run with a type-*valid* mutation of the same intent before believing
either outcome.
- `git stash` — removes other agents' uncommitted files from the shared tree.
- `git checkout -- <file>` / `git restore` — restores to **HEAD, not to your edit**, and the
  suite goes green afterwards because green was also the state you just lost. Cost one agent
  an entire seam rework. **Restore a mutation from a copy you made.**
- `git reset --hard`, `git push --force`, `git rebase`, `git clean` — four agents are live on
  this branch.
- `rm -rf` — the tree holds uncommitted work that is not yours.
- `npm audit fix --force` — installs vitest 5 as a breaking change mid-build.

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

### What the official docs add, and where we already agreed

`https://code.claude.com/docs/en/agent-teams`. Read once against the rules above; most
of what this project learned by being burned is confirmed there, which is reassuring
and also means the rest of this section is the part worth keeping.

**Confirmed independently.** "Start with 3-5 teammates… **three focused teammates often
outperform five scattered ones**", and explicitly: fifteen independent tasks is still a
three-teammate job. That is the queueing rule above, arrived at from the other
direction. Also confirmed: teammates load `CLAUDE.md`, MCP servers and skills but
**never the lead's conversation history**, so the spawn prompt carries everything;
messages are delivered automatically and the lead "doesn't need to poll" — consistent
with the delay-not-delivery finding above, which remains the finer-grained statement.

**New, and worth acting on:**

- **Teammate prompt caches expire in five minutes, not an hour.** An in-process
  teammate's requests fall outside the main conversation's cache TTL bucket.
  `subagentPromptCacheTtl: "1h"` in `~/.claude/settings.json` fixes it, at a higher
  billing rate for cache writes. This is the actual mechanism behind "a dormant agent
  loses its cache" — it is not about dormancy at all, it is a five-minute TTL.
- **Three hooks can make our test discipline mechanical instead of documentary**:
  `TeammateIdle`, `TaskCreated` and `TaskCompleted`. **Exit code 2 sends feedback and
  keeps the teammate working.** A `TeammateIdle` hook that refuses the idle unless
  `npm test` from the root has passed is exactly the shape this file keeps arguing for,
  and it would have caught the scoped-run false green directly.
- **Teammates cannot spawn teammates**, and an in-process teammate cannot run a
  background subagent. So every dispatch is the lead's, and fan-out is one level deep.
- **Idle rows hide 30 seconds after the *whole panel* goes idle** (2.1.199+), and
  surplus idle rows collapse into one `N idle agents` row past three. Part of the
  "fifteen dormant windows" complaint is display, not state — but only part, and the
  duplicate-specialist rule above is about the state.
- **Shutdown is slow by design**: a teammate finishes its current tool call first. A
  two-minute Playwright run means a two-minute shutdown.
- `/model` and `/fast` always apply to the lead, never the viewed teammate; a
  teammate's model is fixed at spawn. `/effort` does follow the teammate.

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

**`TaskStop` is irreversible, and that is measured rather than assumed.** The official
docs say that messaging an in-process teammate "that is no longer running" brings it
back with its conversation restored. **That does not cover a teammate you stopped.**
Tested on 2.1.278 ten minutes after stopping two agents: `SendMessage` answers
`No agent named 'm3-runs' is reachable`, and the mechanism is visible on disk —
`~/.claude/teams/{team}/config.json` keeps a `members` array, and `TaskStop` removes
the entry. A name that is not in `members` cannot be addressed, so there is nothing
to revive. Revival presumably applies to a teammate that simply ended its turn and is
still a member.

The practical consequence: **there is no soft close.** Letting an agent go idle costs
nothing and keeps it addressable; stopping it is final within the session. Decide
accordingly, and prefer idle over stopped whenever the files might come back.

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

**The instinct was right and the instrument was wrong** — the distinction matters, because
the wrong lesson here is "do not verify". Wanting to watch a reported defect fail yourself
rather than taking it on trust is the habit this whole file is about, and it is why the
finding was real. `sed` on a live agent's file is simply the wrong way to get that evidence.
Asking the owner to run it gives the same evidence in the same minute with none of the cost.

**And say what you know, not what you concluded.** The owner reasoned correctly from a
roster of two while a third party was writing to their file, and named a peer. They had
evidence for the mechanism and none for the attribution, and reported both at the same
confidence. What they actually knew was "something outside my script wrote to this file and
I cannot tell you what", which was the whole of what needed saying. The collision cost
twenty minutes; the misattribution cost a correct behaviour a black mark, and only the
second one needed somebody else to undo.

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

Milestone 3 (live) is complete: **1652 unit tests, 157 e2e, 152 visual baselines.** One
process serves the API and the dashboard from a single URL, polls ten sources, correlates,
prunes, and watches its own staleness and certificate expiry. Overview, ServiceDetail and
IncidentDetail render real vendor data, with failure visible as failure — loading, stale
with last-good, "we could not look", and "we looked and there is nothing" are four different
panels.

**Milestone 3 is fully closed.** "Survives a night" was met on 2026-09-20: one process,
9h 42m unattended, 5257 poll cycles, zero errors, zero skipped cycles, WAL checkpointing and
plateauing as predicted, no handle or memory growth. It found a real defect in its first
fifteen minutes — a cold start opened a phantom Sev2, fixed at `600fdea` — which no test
could have caught, because every test in that file constructs already-polled signals.

Milestone 4 — the Entra, Endpoints and Email adapters, the auth seam, and the mutating
routes that need it — is planned in
`docs/superpowers/plans/2026-09-20-ops-dash-m4-write.md`, **not started**, and has four
open questions for John that change the work. **The server needs Node 24**:
the store is `node:sqlite`, a built-in.
