# Resume here — ops-dash

Last updated 2026-09-19. **Milestone 1 is COMPLETE.** All five waves built, all six gates
closed, `CLAUDE.md` written. Read this file, then `CLAUDE.md`, then start at "Pick up here" —
which is now the Milestone 2 plan, not this one.

**State: 539 unit tests, 153 e2e tests, 152 visual baselines, thirteen repository guards,
zero AA contrast failures in either theme, typecheck 0, build 0.**

This file is the single entry point. Everything needed to continue lives in git — there is no
state on the machine this was started on that you need.

## Where the work is

| Thing | Where |
|---|---|
| **The plan you execute** | `docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md` — 15 tasks, 5 waves, ~4,100 lines. Complete code and exact expected output per step. |
| The approved design | `docs/superpowers/specs/2026-09-18-ops-dash-design.md` — the authority the plan argues from |
| Visual spec of record | `design_handoff_it_ops_dashboard/README.md` — pixel measurements, tokens, every screen |
| The contract | `design_handoff_it_ops_dashboard/DATA_CONTRACTS.md` — amended 2026-09-18, has an amendment log |
| File-ownership discipline | `design_handoff_it_ops_dashboard/AGENTS.md` |
| The prototype | `design_handoff_it_ops_dashboard/IT Ops Dashboard.dc.html` — open in a browser; its `renderVals()` is the source of every fixture value |

Branch: **`milestone-1-scaffold`**, cut from `main` at `437a228`. Work continues on it.

## Getting running on a fresh box

```bash
git clone <remote> && cd ops-dash
git checkout milestone-1-scaffold
npm install
npm run typecheck     # must exit 0
npm run build         # must exit 0 (warns that /aurora/styles.css is missing — Task 3 adds it)
npm test              # exits 1, "No test files found" — correct until Task 2
```

**`npm test` exiting 1 right now is expected and is deliberately not suppressed.** There are no
tests yet. From Task 2 onward, a run that finds no tests is a real failure — a glob that stops
matching would otherwise show green while asserting nothing, which is precisely the failure
mode defect G-2 below was about. Chain the three with `;` not `&&` until the first test lands.

**Node.** `package.json` requires `>=24.14.1`; npm warns `EBADENGINE` below that. Milestone 1
genuinely builds and tests on Node 22 — nothing in it needs 24. **Milestone 2 is a hard stop**:
the store is `node:sqlite`, a Node 24 built-in. Install Node 24 before starting M2, and do not
lower the floor to silence the warning. Verified on v24.14.1 / npm 11.11.0 (Windows) and
v22.22.3 / npm 11.17.0 (Linux, builds clean with the engine warning).

**Dependency audit.** `npm audit --omit=dev` reports **0** — that is the check Task 11A runs.
A plain `npm audit` reports 2 moderate, both dev-only in `vitest`. Do not `npm audit fix
--force`; it installs vitest 5 as a breaking change mid-build.

Linux notes:

- `.gitattributes` normalises line endings to LF in the repo. A fresh clone is clean; do not
  "fix" line endings in a commit.
- Task 3's font script makes the one and only outbound network call in this milestone
  (Google Fonts). It needs internet once; its output is committed and never fetched again.
- Task 10A needs `npx playwright install chromium` — a local browser download, not a repo
  dependency. The 28 visual baselines are **platform-sensitive**: baselines generated on
  Windows will not match Linux rendering. Generate them on the machine that will keep running
  them, and say so in the commit that adds them.

## Pick up here

**Milestone 2.** `vendorstatus` (Statuspage first — four vendors, one adapter) + `synthetic`,
the poller, SQLite, correlation. At that point it detects a real outage. It gets its own plan
under `docs/superpowers/plans/`.

**Before you start it, three things:**

1. **Install Node 24.** The store is `node:sqlite`, a built-in. This is the hard stop the
   `engines` floor has been warning about since Task 1.
2. **Read the appendix at the end of the Milestone 1 plan** — the four Python clients' auth
   mechanics, rate limits and proven traps, before writing any adapter.
3. **Two amendments are queued for the frozen contract**, and the file should be opened once
   for all of them rather than three times: an explicit "all sources of one platform failed"
   correlation signal; the rule that a 2xx carrying non-JSON is an error, not data (proven
   necessary by `epc.py`'s `groups` endpoint returning an HTML login page under HTTP 200); and
   `CheckRun` having no `serviceId`, which the fixtures solved with a `Record` but an adapter
   cannot.

Superseded, for the record: Waves 0-4 of Milestone 1. `ops-primitives` builds the eight
primitives, the five shared dashboard components and `theme/statusColor.ts`; `ops-fixtures`
builds the prototype-derived fixture modules. Disjoint ownership; dispatch both together, then
run gate G1.

Two things to carry into that brief that are not in the plan. `tsconfig.base.json` sets
**`exactOptionalPropertyTypes: true`**, so `{ empty: undefined }` is a type *error* — an
optional field must be absent, not explicitly undefined; this will hit `ops-fixtures` first.
And **`Table`'s `Column<R>` must keep `key: keyof R & string`** — relaxing it to `string` for
convenience silently re-opens defect G-4, where a column keyed `dur` against a field named
`duration` renders empty cells with no error.

The plan's "Teams and file ownership" section defines five waves, the agent per task, and the
review gate that closes each wave. Waves 1 and 3 are parallel — two agents and four agents
respectively, with disjoint file ownership. Waves 0, 2 and 4 are sequential.

## What is actually built (verified, not claimed)

Commit `a9ac997`, Task 1 only:

```
package.json            npm workspaces ["shared","web"], scripts, dev deps
package-lock.json       committed — deploys use npm ci, never npm install
tsconfig.base.json      strict; noUncheckedIndexedAccess + exactOptionalPropertyTypes on
vitest.config.ts        root runner, test.projects: ["shared","web"]
.gitattributes          LF normalisation, binary + generated markers
shared/{package.json,tsconfig.json,vitest.config.ts}
shared/src/index.ts     `export {}` placeholder — Task 2 replaces it
web/{package.json,tsconfig.json,vite.config.ts,vitest.setup.ts,index.html}
web/src/main.tsx        one-line boot — Task 6 replaces it
```

Nothing else exists. No contract, no assets, no fonts, no icons, no primitives, no fixtures,
no shell, no views, no tests, no guards.

## Gate G0 — closed with accepted findings (2026-09-19)

Wave 0 is complete and reviewed. **Fixed and verified** at this gate: BLOCKER B-1
(`npm run typecheck` had been exiting 2 since Task 3A — `@types/node` was installed
nowhere and nothing caught it, because Vitest transpiles `web` without typechecking
and `vite build` does not typecheck either, so `npm test` and `npm run build` both
stayed green over a workspace that did not compile); H-1 (the milestone's only HTML
sink was caller-controllable — `Icon.tsx` spread `{...rest}` *after*
`dangerouslySetInnerHTML`, so `<Icon {...props} />` could inject arbitrary markup and
the guard could not see it, since it greps for a literal string a spread does not
contain); HIGH-3 (`web/index.html` — the file that ships, and the file Task 11A edits
— sat outside the outbound guard's scope); H-2 (redaction guards read `src/fixtures`
only, so `web/src/fixtures.ts` with a real UPN passed all nine); the tautology hazard;
the multiset hole; the conditional sink exemption; and both survivors of a ten-mutation
battery against `contracts.test.ts`.

The contract itself was audited twice, independently: 126 field lines on each side of
`DATA_CONTRACTS.md` ↔ `contracts.ts`, zero asymmetric difference, all four amendment
comments intact. Re-running `extract-icons.mjs` reproduces `icons.generated.ts`
byte-identically, so the committed artefact is genuinely generated.

**Accepted rather than fixed.** These are the written acceptance the plan's review-gate
rule requires. A gate is not closed because findings were recorded — only because they
were fixed or explicitly accepted, and these are the accepted ones.

| # | Finding | Owner | Deadline |
|---|---|---|---|
| 1 | `guards.test.ts:44` — the `prototype literal` marker is unscoped: it whitelists any hex on any line, not just `#fff` on chips/brand/badges | lead | before Wave 3 |
| 2 | `guards.test.ts:34` — self-exclusion by `endsWith`, so any `web/src/**/guards.test.ts` is exempt from every guard; anchor to the exact path | lead | before Wave 3 |
| 3 | Colour/palette guard scope — blind to `.css` under `web/src`, and **no colour or dark-palette guard covers `public/` at all**. Not a live risk for Waves 1-3 (nothing under `web/src` writes a stylesheet; everything is inline style + `var(--*)`), but Task 11A creates `web/public/app.css` | lead | `web/src` half → G1 brief; `public/` half → **before Task 11A** |
| 4 | `guards.test.ts` — nothing asserts the ten guards are still collected; rename or relocate the file and they vanish silently | lead | none |
| 5 | `ops-security.md` tools vs Task 11A's Files list | lead | **fixed at G0 close** |
| 6 | `ops-e2e.md` ownership claim vs the plan's table | lead | **fixed at G0 close** |
| 7 | Nine LOW items (see below) | as cited | — |

LOW, carried: credential guard skips `web/scripts/*.mjs`, `.json` and `e2e/`; network
guard misses `import('node:https')`, `new Image().src` and `<link>`/`@import` in JSX;
**nothing links `Incident.serviceId` to a `ServiceStatus.id`, so `/services/:id` can
render blank → G1 fixture test**; `BlockedMessage.reason` collapses to `string` in the
type system, so the Email view needs a default branch → G3; `Icon.tsx` throws and
unmounts the subtree on an unknown `name`, with no fallback glyph; pin the Aurora
bundle by SHA-256 at Task 11A; `export type *` exports no runtime values, which matters
at M2.

Items 5 and 6 were fixed at the gate rather than carried, along with two LOW agent-
definition defects: `ops-primitives` did not claim `web/src/theme/statusColor.ts`,
which the ownership table grants it, and `ops-contract` described an amendment
procedure its read-only tools cannot perform — it now states that it verifies and
reports while the lead performs the edit, so a change to a frozen file always passes
through a second pair of hands.


## Gate G1 — closed with accepted findings (2026-09-19)

Wave 1 (Tasks 4 and 5) is complete and reviewed twice, by `ops-reviewer` and `ops-contract`
in parallel. 193 tests, typecheck clean.

**All three gate questions passed, verified mechanically rather than by eye.** All 14 primitive
signatures match the plan's Interfaces block exactly — transcribed into a compiled probe with
proven negative controls, and re-run after remediation. Fixtures carry zero `as any`,
`as unknown`, `satisfies`, `@ts-ignore` or explicit `undefined`, with optional fields genuinely
absent. `statusColor` is total over all three unions, confirmed by adding a member to each and
watching `tsc` fail.

**The expensive findings were not divergence between agents.** They were places the *plan* was
internally inconsistent and each agent had faithfully implemented its own half:

- **G-13, the largest.** Task 5 point 3 adds the `needs_auth` row precisely because it "tells
  the truth" about the real M365 blocker — while the same task builds the flagship Sev1 on an
  m365 *vendor advisory*. We cannot read M365 vendor health and correlate on it. The sev1 story
  was resting on that: `ruleKey: 'vendor'` means "vendor degraded + our check failing", and
  amendment 1 forbids `unknown` from satisfying the vendor half, so the rule that supposedly
  opened the flagship incident **could not have fired**. John ruled the correlation moves to
  Proofpoint, whose Status.io feed is genuinely readable.
- **The quiet-mode BLOCKER.** Zendesk rendered `operational` in quiet, on evidence the contract
  says can never be green. Combined with amendment 1 this means **ALL SYSTEMS OPERATIONAL is
  unreachable in production**, and the quiet fixture was showing a screen the live system can
  never render — asserted by a test, and about to be frozen into 28 visual baselines.
- **H-3 and H-4**, both the same shape: a disabled rule that produced an incident, and a tile
  claiming a successful poll from a feed that has never authenticated.

Every one of these type-checked, passed 151 tests, and was invisible to the guards. They needed
someone reading the contract's prose against the fixtures' behaviour.

**Accepted at gate G1, not fixed.** This is the written acceptance the gate rule requires.

| Finding | Owner | Due |
|---|---|---|
| **M-9** — no incident carries `ack` or `muted`, so README:81's acknowledged/muted opacity-0.45 row ships unrendered and unbaselined. No Wave 3 agent owns that file, so the request must route back through the lead | `ops-fixtures` | before Task 10A |
| **M-6 residual** — no `:focus-visible` ring is expressible from `web/src`; every primitive carries an `aur-*` class awaiting a stylesheet | lead | Task 11A |
| **M-8 residual** — `@keyframes aur-skel-pulse` and eight orphaned `aur-*` classes have no home; `Skeleton` is static until then | lead | Task 11A |
| **L-1** three disabled treatments across `Button`/`IconButton`/`Switch` · **L-3** `Card.tsx:26,31` `style` overrides the recipe · **L-4** hard-coded relative copy in `history.ts`/`incidents.ts` · **L-6** `email.ts:19-23` registrable hostile sender domains · **L-7** `primitives.test.tsx:43` duplicate hex guard · **L-8** `guards.test.ts` marker still line-scoped · **L-9** `dashboard.test.tsx:51` name contradicts code · **L-10** `Sparkline.tsx:22` returns `null` against a published `JSX.Element` · **L-12** `Card` `role="button"` nesting interactive children | as cited | before G4 |

L-2, L-5 and L-11 were fixed rather than accepted.

**Seven plan edits made at source**, tagged `amended at G1 — G-13` / `amended at G0 — H-1` /
`amended at G1 — G-12`. The reviewer argued this and was right: `RESUME.md` calls the plan "the
plan you execute" and a fresh agent on a fresh box is told to run it, so a plan whose tests
contradict the fixtures is a trap. Two of the seven are defects the plan would otherwise
*reintroduce on regeneration* — Task 3 Step 8's unsafe `Icon.tsx` prop-spread ordering, and a
real corporate hostname in a committed fixture.

**Published to Wave 3 alongside the Interfaces block:** `ageLabel` and `UNKNOWN_AGE`
(`web/src/theme/ageLabel.ts`), `srOnly` (`web/src/theme/srOnly.ts`), and
`checkRunsFor(mode, id)` — `FixtureBundle.checkRuns` is now `Record<ServiceId, CheckRun[]>`, and
`useParams` hands `ServiceDetail` a `string | undefined` the record's key type rejects.

## Gate G2 — Wave 2 in review (2026-09-19)

Task 6 committed at `d52f888`. 228 tests, typecheck exit 0, `npm run build` exit 0.

**Two more plan defects, both of which give a red build on regeneration:**

- **G-14** — Task 6 Step 3's `ThemeProvider` reads the OS colour preference via a media query,
  which fails Task 3A's own `no second dark palette` guard. The guard greps prose too, so a
  comment naming the query, or quoting Aurora's `[data-theme=` selector, fails identically.
  Amended at source: default to `light`, stored value is the only input.
- **G-15** — Task 6 Step 4's `DemoModeProvider` does not typecheck, because `import.meta.env`
  is a Vite ambient type — while Vitest reports `Type Errors  no errors`. **Fourth occurrence
  of the typecheck trap, this time originating in the plan's own source.** Amended at source
  with a `/// <reference types="vite/client" />`.

**A third wrong-green, one string further along.** Task 6 Step 4's quiet subtitle read
`All 7 monitored services healthy`, over two services we cannot affirm. Now
`5 of 7 monitored services affirmed healthy · 2 unknown`, all counts derived. The
`All N healthy` branch is kept and still uses `allOperational`, with a test proving it
reachable only in a constructed all-affirmed world — which is the right way to retain a branch
that today's data cannot reach.

**Ownership gap closed:** `web/index.html` was assigned to no wave, while Task 6 Step 5 tells a
Wave 2 agent to edit it and Task 11A modifies it too. It is now **lead-owned in every wave**,
and is the only place in the tree that can hold `@keyframes` until Task 11A creates
`web/public/app.css`.

**One mutation survived out of ten** — deleting `end` from the `NavLink`s, because react-router
special-cases `/`. The agent's comment had claimed the assertion covered it; it corrected the
comment rather than the claim. That is the right response and worth the precedent.

**Not yet verified by a human eye.** There is no GUI in this environment. The agent confirmed
the dev server serves the page with local-only asset references and audited `dist` (the only
`https://` strings are React error-message URLs in vendor code), but nobody has *seen* the
shell. Worth a look before G2 closes.

## A test cannot forbid a literal by containing it

**Four occurrences, three agents, three different guards.** `Endpoints.test.tsx`'s
`/CXDO-LT-/` against the redaction guard; `w1-primitives`' `[data-theme="dark"]` regex against
the no-second-dark-palette guard; and the same `not.toMatch(/#fff|white/)` chip assertion
written **independently by two agents** against the no-literal-hex guard.

The instinct to prove an absence by naming the thing is strong, and it is wrong for three
separate reasons:

1. **It trips the guard**, because naming the forbidden value puts it in the tree.
2. **It is the weaker claim.** "Not `#fff`" permits `rgb(255,255,255)`, `hsl(0 0% 100%)` and
   every other wrong colour. "Not `CXDO-LT-`" permits every un-redacted hostname nobody thought
   to enumerate — which is exactly how G-12 got through.
3. **It survives the remedy changing.** Swap the token later and the negative assertion still
   passes over a broken screen.

**Assert what the value must be, not what it must not be.** Note that generalising the negative
does not help: `not.toMatch(/#/)` is the same error one level up, because it still defines
correctness as the absence of a bad thing — it passes for `rgb(255,255,255)`, for
`var(--nonexistent)`, and for no style at all. Four occurrences across three agents says the
phrasing is the attractor, not the agents.

And the trap one level on, which `w3-service` and `w3-overview` found **independently**:
equality against the published helper is not sufficient either, because both sides then call the
same function and the test passes if the view and the test are wrong together.

**The rule that survives all four cases is narrower: an assertion may not reach the value under
test by the same path the code did.** Either pin a literal, or compare two independently-
reachable definitions. A negative assertion is safe only as a *companion* to a positive one.

The general form, and the reason every one of these was the code being the wrong shape rather
than the guard having a blind spot: **when a guard fires on a test file, the test is usually
asserting the wrong thing.**

## Report an equivalent mutant as equivalent

A mutation that survives is not automatically a test gap. `Card` emitting
`data-testid={testId}` directly instead of via a conditional spread survives, and **no assertion
can kill it** — React omits an attribute whose value is `undefined`, so the two forms are
genuinely indistinguishable in the DOM. Verified with a probe rather than assumed.

The right response is to record it as *survived-and-equivalent*, not to add an assertion that
appears to kill it while actually testing something adjacent. That would be a vacuous test
manufactured to satisfy a practice designed to catch vacuous tests.

What made it worth reporting: the same mutation on `StatCard` is **not** equivalent — it is a
compile error under `exactOptionalPropertyTypes`, because forwarding to a typed component prop
carries an obligation that setting a DOM attribute does not. So the conditional spread is
load-bearing in one file and stylistic in the other, and the files say which.

## Never compute an expectation with the function under test

`w3-overview`'s strip test announced `vendor.level` instead of the rolled-up `tileLevel` and
**passed all 61 tests**. Two reasons compounded: the strip renders only in quiet, where every
`ours` half is operational so the two levels agree for all seven services — and the assertions
computed `tileLevel` on *both* sides, making them tautological about the very thing they named.

The cure is to **read the expected values off the fixtures by hand**. A test that derives its
expectation using the code under test can only ever confirm the code agrees with itself.

Stated in the strong form: **an assertion may not call the thing it is asserting about, even
transitively.** That is the rule the `isAffirmed`/`allOperational` drift guard already obeys —
it compares two independently-reachable definitions against each other rather than one
definition against itself.

**And run the battery against the world where the two candidates differ.** This is the other
half and it is equally load-bearing: the quiet fixtures could not have distinguished
`vendor.level` from `tileLevel` no matter how good the assertions were, because in quiet every
`ours` half is operational so the two agree for all seven services. Two independent conditions
had to coincide for that bug to hide — a fixture world where the candidates agree, *and*
assertions computed with the function under test — and removing either one would have caught it.

Corollary: "assert it over both worlds" sometimes has no page-level route. The strip does not
render in sev1 at all — README § 1 gives sev1 the tile grid — so the component had to be
exported and rendered directly to reach the second world.

## The no-second-dark-palette guard catches prose, not just code

Third time this has bitten, so it is written down. The contrast test needed to locate the dark
block in `fig-tokens.css`, and the obvious regex spells out the `[data-theme="dark"]` attribute
selector — which is exactly what the guard greps for, so the guard fired.

**The guard was right.** It cannot tell "reads the one palette" from "declares a second", and it
should not have to: the moment it tries, it acquires a semantic judgement it will get wrong in
the other direction.

**The fix is to write the pattern another way** — matching the `, .dark {` half of the same
selector is equally precise and contains no guarded literal.

**Two fixes to refuse**: weakening the guard, and assembling the literal from fragments to slip
past it. The second is worse, because it leaves the guard *looking* intact while it no longer
guards. A guard you can satisfy by spelling something differently has stopped being a guard.
This is the same ruling made at G3 over the redaction assertion, and the general form is:
**when a guard fires, it is usually telling you the code is the wrong shape — not that it has a
blind spot you can aim for.**

## Contrast is testable without a browser

`web/src/theme/statusColor.test.ts` runs under `@vitest-environment node`, parses
`fig-tokens.css` directly and computes WCAG ratios itself. **It would have caught all 14 G3
contrast failures**, it needs no Chromium, and it runs on every `npm test`.

This corrects a conclusion drawn at G1. A ratio assertion *through the DOM* genuinely is
theatre, because jsdom does not resolve `var()` — but that only meant the class was untestable
*through the DOM*, not untestable. Any defect class that seems to need a browser is worth a
second look for an out-of-band way to compute the same fact.

The file carries a deliberate canary: one test asserts `--warning-main` **fails** as text while
`--warning-dark` passes. Without it, a resolver bug returning the same colour twice would paint
every assertion vacuously green.

It also pins the exact list of decoration colours that do **not** clear WCAG 1.4.11's 3:1 bar
(`degraded` 2.40, `maintenance` 2.82, `unknown` 2.29, sev2 2.40, sev3/info 2.82 in light). That
is a **recorded decision, not an open failure** — see the dot ruling below.

## Ruling: a dot that has a text equivalent may stay decoration-grade

Where a status dot is accompanied by text carrying the same information — the Overview tile's
"Vendor: {label}" / "Ours: {label}" row, for instance — the dot is redundant decoration and
`-main` is appropriate.

Where a dot is the **sole** carrier, the fix is to add the text equivalent, **not** to darken the
dot. The Overview strip pill was `[dot][service name]` with no label: that is WCAG 1.4.1 Use of
Color at Level A, not merely a 1.4.11 contrast miss, and a screen-reader user got the service
name with no status at all. Darkening it would have satisfied a contrast checker while still
telling a blind user nothing — a signal that looks right and does not mean what it says, which
is the defect this whole project keeps producing.

## Queued for the post-G3 consolidation pass

**Hoist `ago` and `signedDelta` to `web/src/theme/`, beside `ageLabel`.** They currently live in
`web/src/views/Entra.tsx` and are imported by two other views, which quietly makes a *view* into
a utility module nobody owns as one. The next agent needing `ago` will either import a view or
write a sixth copy.

**Five sites compose a sentence from `ageLabel`, and only one handles `UNKNOWN_AGE`:**

| Site | Composes | Handles `UNKNOWN_AGE` |
|---|---|---|
| `components/Panel.tsx` `agePhrase` | `'14 minutes old'` / `'of unknown age'` | **yes** |
| `views/Entra.tsx` `ago` (+ Endpoints, Email) | `'34 days ago'` | no |
| `views/ServiceDetail.tsx` ×3 inline | `'... ago'` | no |
| `views/Settings.tsx` ×1 inline | `'Last success ... ago'` | no |

`ago(badIso)` renders **"an unknown age ago"** — a sentence no person would write. Unreachable
today, because every fixture timestamp is generated by `time.ts`; reachable at Milestone 2 the
first time a vendor payload carries a malformed date. The hoisted `ago` must branch on
`UNKNOWN_AGE` the way `agePhrase` already does, so the two compositions live together and
neither is the one that forgot.

**Structural duplication is not behavioural divergence, and the distinction matters.** Four
sites composing the same phrase from one *published* helper cannot disagree on screen. Three
independent implementations could, and did — that was the pre-G1 `ageLabel` situation and it is
why publishing it was the fix that mattered. The hoist is tidying, not a defect repair. Anyone
reading "fourth instance of the duplication pattern" without this paragraph will reasonably go
looking for something broken on screen and find nothing.

## Gate G3.5 — closed (2026-09-19)

Task 10A complete at `79a4154`, tagged `wave-3.5`. **152 baselines, 153 e2e tests, one expected
red** (the CSP test Task 11A lands). 513 unit tests, typecheck 0, build 0.

**The task's own tooling was wrong twice, in the same way, at two scales.** The plan specified
`maxDiffPixelRatio: 0.01` — about 13,000 pixels on a full-page capture — and a 348-pixel
regression passed green. Tightened to `maxDiffPixels: 40`, a **16-pixel** radius change then
passed. Now 4.

The method that settles it: **calibrate on the noise floor, not on a mutation's magnitude.** A
budget set from one mutation is set to that mutation's size. Measured here: **0** on a repeat
run, **2** cross-build jitter, **16** the smallest real design change, **348** the smallest
regression. The 8x gap between jitter and real change is the budget.

And the detection signal, which will recur: **a commit predicted a visual change and the
baselines did not move.** The suite was green and wrong, and the tolerance is the first suspect.

**Holding a stale baseline is sometimes the right call.** Eight captures were held deliberately
rather than regenerated around a 6px layout shift. After the fix they compared at **zero** pixels
against images from before the shift existed — proof it was reverted rather than improved.
Regenerating would have made the shift the acceptance criterion and re-blessed it silently.

**Two lessons worth carrying past this milestone:**

- **Measure the element AND the gap to its neighbour.** A `data-testid` wrapper left the
  sparkline correct at 26px and put 6px *underneath* it, so an assertion on the SVG alone stayed
  green through the whole episode. Most spacing defects live between elements, where nothing is
  wrong with either one.
- **A fix to a capture harness is itself a baseline-moving change** and needs the same "which
  moved and why" account as a code change. A `shotAround` bug produced silently-green **empty**
  captures; the first fix scrolled unconditionally and rewrote six clips that were fine.

## What Task 11's fidelity pass should and should not redo

`ops-e2e`'s scoping, adopted. **Cut**: walking screens for regressions, and every measurement
traceable to a README line — seven routes x two worlds x two themes x two viewports are
pixel-compared at a 4-pixel budget, with hover, focus and disabled states. Contrast over 1,696
text nodes in a real engine beats any eyeball. The offline proof and console cleanliness are
mechanical.

**Keep, in priority order:**

1. **Compare against the prototype.** The baselines prove the app matches *itself*; nothing in
   the suite has ever opened `IT Ops Dashboard.dc.html`. **Both fidelity defects found at G3.5 —
   radius 10, the clickable tile — came from reading the prototype's source, never from a test.**
   *Caveat:* the prototype carries placeholder ten-service data, so this needs someone who
   already knows which differences are intended — seven services, the quiet subtitle, the
   amended pill rung, `unknown` never green. A naive comparison generates false findings faster
   than real ones.
2. **Judgement with no assertion form.** Is the quiet `/incidents/:id` empty state — one bare
   sentence, no card, no icon — acceptable beside the Overview's iconned, carded one? Is
   "Outstanding invoice #8..." enough subject at 1000px? Is the alert row's action set right
   when it wraps to three lines?
3. **Copy.** No pixel test reads words: seven services throughout, tense, and the honesty of the
   `needs_auth` and `unknown` wording.
4. **The two viewports nobody has looked at** — 768 and 1920.
5. **Dark mode as a designed artefact** rather than a contrast score. Zero AA failures does not
   answer whether the palette reads as deliberate.

## Gate G3 — closed with accepted findings (2026-09-19)

Wave 3 is complete: seven views, four agents in parallel, 48 commits on `wave-2`. **478 tests,
typecheck 0, build 0.** Contrast: **0 AA failures** across 1,696 text nodes, 7 routes × 2 themes
× 2 worlds, theme application asserted on every load, with a positive control.

**The gate's own question — did four blind agents diverge? — answered no on every axis the plan
named.** Zero re-implemented `Card`/`StatCard`/`Panel`/`SectionHeading`; stat-grid `minmax`
values differ only where the README differs; every padding traces to a README line; all eight
empty states funnel through `PanelState`; `SectionHeading` at all sixteen heading sites. The
agent owning three sibling screens shared one `VIEW_STACK`/`STAT_GRID`/`TableSection` and
*reported* that they wanted a home in `theme/`.

**The expensive findings were not divergence.** They were:

- **A BLOCKER nobody could have found in light mode.** `background: 'var(--grey-grey-100)'` on
  the strip pill — a raw ramp token with no dark override, while `--text-primary` resolves to
  that same value in dark. **1.00:1**, seven invisible service names, in one of the 28 baselines.
  And it *inverted* the earlier ruling that produced it: we had added `srOnly` text so the dot
  would not be the sole carrier, and a sighted user was left with a blank capsule.
- **68 AA contrast failures**, 42 of them in three views that never adopted the published
  helpers because their sites bypass them with raw token literals. A new seam shape: not a
  duplicated helper, but a published one that callers route *around*.
- **The spec was wrong twice.** README § 7 names a pill pairing that cannot clear AA at the size
  the same line mandates; amended at source. And `unknown` rendering `--text-disabled` is right
  for decoration and fails as text in both themes.

**Accepted at G3, not fixed:**

| Finding | Owner | Due |
|---|---|---|
| `advisoryId`, `vendor.maintenance`, `scheduledFor`, `scheduledUntil` carried by fixtures and read by nothing — recorded in `OPEN_LOOPS` | view-service | before G4 |
| `threshold` deliberately unread — it is the machine form of what `AlertRule.detail` states in prose; load-bearing at M2 | — | decision |
| `Integration.error` has no fixture row, so its badge layout is never looked at | ops-fixtures | Wave 4 |
| Sidebar demo toggle is dev-only and never baselined | lead | — |

**Three standing guards arrived during remediation**, and the reviewer broke two of them:

- **open-loop guard** — a fixture field nothing reads. Found four on its first run. Was
  name-keyed, so an object *key* counted as a read; tightened to property access, which
  immediately surfaced a fifth.
- **theme-blindness guard** — no background token may lack a dark override. Matched only
  single-quoted values; the reviewer reintroduced the BLOCKER with double quotes and all
  fourteen guards passed.
- **per-view call-site guards** — the painted colour must be a readable rung. These are what
  caught a reverted `statusTextColor` and my own uncommitted positive control.

**Judgement calls recorded:** the views are *finished, not merely passing* — layout and copy
were already done and dark-mode colour grading was the only gap. And the plan's 3-4×
under-prediction of test counts is **a floor, not a defect**: the overage is mutation tests,
constructed-combination seams and drift batteries, none plannable in advance. Read the counts as
"at least N", and treat **a task landing *at* its prediction as the one to re-read**.

## A readability assertion is orthogonal to a semantic one

**A contrast test will never fail for a wrong-but-legible colour.** Found by `ops-primitives`
when three of its five mutations survived: `needs_auth` mapped to the info family, `polling` to
success, `error` to warning. Every one of those is perfectly readable at `-darker`-on-`-lighter`,
so the contrast suite could not see any of them — it was asking "can you read it", never "does
it mean the right thing".

`polling` → success is the one to remember: an integration that is merely **polling** would
render green and read as **connected**. That is the same wrong-green as a service tile going
green on an unknown vendor feed — readable, plausible and false.

So **every contrast test needs a meaning test beside it**: an explicit mapping assertion, a
"only this state may read as green" assertion, and a distinctness assertion across the set. Two
of the five colour helpers had that from the start and the other three did not, until the
mutants said so.

## An unrendered state is an unmeasured state

`Integration['state'].error` has no fixture row, so it could only be measured by resolving the
token pair directly — it never reaches a screen. That is the colour-dimension twin of M-9.

Mapping tests reach all four states regardless of what any fixture contains, which is the
cheaper half of the fix and is now in place. A fixture row for `error` is still worth having in
Wave 4, because it is the only way the **layout** of that badge ever gets looked at.

## How to set the theme when measuring or screenshotting

**Set it the way the app sets it — `localStorage['ops-dash.theme']` before any script runs.**
Adding the `dark` class to `documentElement` externally does not work: `ThemeProvider` owns that
class and syncs it back from its own state on the next render, so anything measured afterwards
is **light mode wearing a dark label**.

Playwright: `context.addInitScript(t => localStorage.setItem('ops-dash.theme', t), theme)`.
Then **assert the class actually applied** before measuring anything — `expect(
document.documentElement.classList.contains('dark')).toBe(true)` — and fail loudly if not.

This cost real time and produced a wrong number. My first contrast sweep reported 68 failures,
of which the dark half were artefacts: I had measured light twice. The **light** failures were
genuine and are fixed; the BLOCKER was genuine and was confirmed independently by resolving the
tokens rather than by measurement (`--grey-grey-100` on `--grey-grey-100`). But any figure I
gave for dark before this note is void.

**Restore a probe with `git checkout -- <path>`, and check the tree afterwards.** I twice left
control mutations in the working tree because the restoring `cp` sat in an `&&` chain after a
command that exited non-zero, so it never ran — the same failure `w3-overview` self-reported,
repeated by me in the same session while writing up the rule about it. The agents' own tests
caught it, which is the system working, but the tree should have been clean.

**The rule that covers the whole family: before trusting a negative result, prove the thing
that produces it can produce a positive one.** That is one statement of G-2, of the
presence-only contract assertions, of `not.toMatch(/#/)`, and of a contrast scan reporting zero.

And the distinction that makes it non-obvious, from `ops-primitives`: **a canary tests the
arithmetic; a control tests the subject.** The contrast suite's canary — asserting
`--warning-main` fails as text while `--warning-dark` passes — would catch a broken resolver,
and would **not** have caught my wrong control, because the control was pointed at the one
family whose `-main` is genuinely readable. Both are needed, and they are not substitutes.

**A positive control is a deliberate defect.** An uncommitted one is indistinguishable from a
real regression to whoever looks next — `ops-primitives` found my `success` → `-main` revert
still live in the tree and had to restore it. Revert in the same breath as measuring, and check
`git status` afterwards.

**A scan reporting zero needs a positive control.** After the fixes the sweep reported 0
failures, which is exactly what a broken scanner reports. Reverting `Button`'s `success` text
rung to `-main` reproduced 5 failures at 3.40 — the same value originally measured — which is
what makes the zero meaningful. Pick the control carefully: my first attempt reverted the
*neutral* family, which produced 0, because `--neutral-main` is genuinely readable. A control
that cannot fail proves nothing.

**Current measured state: 0 AA failures**, 1,696 text nodes, 7 routes × 2 themes × 2 worlds,
theme application asserted on all 28 loads, `document.fonts.ready` awaited, effective background
resolved by walking from the element itself so a filled control's own background counts.

## Task 10A environment notes — read before starting it

- **Await `document.fonts.ready` before every screenshot.** A screenshot was twice captured
  rendered in a **fallback face rather than Plus Jakarta Sans** — sidebar, header, everything.
  Not reproducible on demand afterwards (five consecutive clean captures), so: **observed,
  mitigation known, mechanism not pinned down.** Act on it anyway. A baseline that silently
  bakes fallback-font metrics passes for whoever generated it and fails for everyone else, and
  it is very hard to diagnose after the fact. `--virtual-time-budget=8000` suppressed it in
  every observed case; Playwright's equivalent is awaiting `document.fonts.ready`.
- **Rebuild before you preview, and use a positive control.** `vite preview` serves whatever is
  in `dist`. A comparison run without rebuilding compares a build against itself and produces a
  confident "pixel-identical, no layout shift" that means nothing. Every visual comparison needs
  a band you *expect* to differ; if that band matches too, you are comparing one build with
  itself.

- **G-16: `vite preview` binds `localhost`, not `127.0.0.1`.** Verified on this box:
  `localhost:4173` → 200, `127.0.0.1:4173` → connection refused (localhost resolves to `::1`).
  The plan's Playwright config used `127.0.0.1` for both `baseURL` and the `webServer` health
  check, so **nothing would have started** — the health check times out before a single test
  runs. Amended at source to `localhost`; the offline assertion already allows either hostname.
- **The installed Playwright and the cached browser disagree.** `@playwright/test` wants
  `chromium_headless_shell-1243`; the cache has `chromium-1228`. Either run
  `npx playwright install chromium`, or pass
  `executablePath: '/home/hermes/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'`.
- **Baselines must cover hover and focus, not just rest.** At G1 a proposed fix for the
  dark-mode Button would have moved the invisible state from rest to hover — 1.09:1 — and
  **every static screenshot would have shown it fixed**. A rest-only baseline suite would have
  certified the bug and made it the acceptance criterion.
- **Both demo worlds must be photographed.** `?demo=quiet` / `?demo=sev1` works in a production
  build; the footer control does not, because it is `import.meta.env.DEV`-gated and stripped.
  Without the query parameter all 28 baselines would be sev1-only (G2 HIGH-2).

## Why publishing beat deduplicating

Four cross-agent seams went through one arbitration point and came back as one published
definition each: `statusColor` (and the three rung-pickers that grew out of it), `ageLabel`,
`srOnly`, `isAffirmed`. The pattern is worth naming precisely, because the obvious reading of it
is wrong.

**In every case the duplicate copy was correct when it was written.** Nobody made a mistake.
The copies failed because **two correct copies diverge the moment either premise moves** — and
on this project the premises moved constantly: `unknown` stopped being an edge case, `-main`
stopped being good enough for text, an optional field stopped being absent. Each shift
invalidated one copy and not the other, silently, because both had been right.

That is why the fix was always to publish one definition rather than to correct a copy, and why
the drift guard — asserting that a derived function equals its definition across several
shapes — matters more than any individual correction.

## The published API Wave 3 builds on

Everything the four view agents import. Every signature is unchanged from the plan's
Interfaces block; the only behaviour change to a published function is `allOperational([])`,
which now returns **`false`** rather than `true` — `[].every()` is vacuously true, so an empty
or failed fixture load would otherwise render ALL SYSTEMS OPERATIONAL over no evidence at all.

```
theme/statusColor.ts   statusColor · severityColor · severityLabel · timelineColor
                       isAffirmed · allOperational
theme/ageLabel.ts      ageLabel(iso, now?) · UNKNOWN_AGE
theme/srOnly.ts        srOnly            (CSSProperties; clip-path idiom, NOT display:none)
components/aurora/     Button IconButton Switch Table<R>+Column<R> LinearProgress Skeleton Alert
components/            Card StatCard Sparkline Panel+PanelState SectionHeading
fixtures/              fixtures · serviceById · incidentById · checkRunsFor(mode, id)
```

`isAffirmed` considers **both halves** — a vendor status page is a claim about their fleet, not
a measurement of our path to it — and only `operational` affirms: `maintenance` and `unknown`
both return false.

**`affirmedCount` is deliberately NOT published.** "How many to name in a subtitle" is a view
concern; "is this service healthy" is a health rule. That line was drawn on purpose, after
three helpers had been duplicated because nobody had decided where the boundary was.

## Staging discipline while other agents are writing

**Stage by path. Never `git add -A` in a tree where another agent is working.**

This was learned by breaking it. Commit `1fbd2a8`, whose message says "docs: publish the Wave 3
API surface", also contains five of `ops-shell`'s in-flight source files — `DemoModeProvider.tsx`
and its test, `pageMeta.test.ts`, `shell.test.tsx`, `main.tsx` — swept up mid-edit, before their
author had run the suite over them. Nothing was lost and `8b95234` completed the work, but the
commit message misdescribes the commit, and had the agent been mid-refactor it would have
captured a broken intermediate state under someone else's name.

Two related hazards, both hit in Wave 1:

- **`git stash` is worse.** `ops-fixtures` used it to compare against HEAD and swept up a live
  agent's working tree. It popped back clean, but `git diff -- <path>` and
  `git show HEAD:<path>` do the same job without touching anyone else's files.
- **`git add -A` also picks up scratch and probe files.** Several agents create throwaway probes;
  reviewers create them by design.

The task steps already specify the paths to stage. Use them.

## The one practice this project has earned the hard way

**A passing test is not evidence until someone has watched it fail.**

Six times in two waves, this build produced a test that reported success without
exercising the thing its name claimed: `expectTypeOf` assertions that never ran outside
typecheck mode (G-2); presence-only contract checks that passed while a required array of
objects became an optional array of strings; a reviewer's own probe where
`[never] extends [true]` accepted everything; a contrast-ratio assertion under jsdom,
which cannot resolve `var()` against the token sheet; a Vitest run printing
`Type Errors  no errors` over a `web` file with two real type errors; and a lead-suggested
"at least one incident auto-created by an enabled rule" that passed with the entire
headline correlation deleted.

The common shape: **an assertion whose NAME describes a stronger property than its BODY
checks.** They are cheapest to catch by breaking the thing the name claims to protect and
seeing whether anything goes red. It costs about thirty seconds.

So: when you write a test whose name makes a claim, mutate the code it names and watch it
fail before you commit. When you review one, do the same rather than reading it. This is
mandatory at G3, where four agents land view tests in parallel and nobody can see anyone
else's work.

## tsc and vitest read the shared contract from two different places

`shared/package.json` points `main`/`types`/`exports` at `./src/index.ts`, so **vitest**
resolves the contract from source. But `web` and `server` declare
`references: [{ path: "../shared" }]`, and **TypeScript project references resolve to the
declaration output** — `shared/dist/*.d.ts`, which is gitignored and rebuilt by `tsc -b`.

Two resolvers, two answers. An agent amending the contract mid-task saw exactly this: `npm run
typecheck` reporting 62 errors against a `data?: T` it had just written, while vitest's
typecheck said clean, because `dist` had not been rebuilt yet.

In practice the `pretest` hook saves us — it runs `tsc -b` before the suite, which rebuilds
`dist` first. The hazard is running vitest directly after a contract change and trusting the
result. **After amending `shared/src/contracts.ts`, run `npm run typecheck` before anything
else**, or `rm -rf shared/dist` if a type error looks impossible.

## The trap that has now caught us three times

**`Type Errors  no errors` in a Vitest run is a claim about `shared` only.** Typecheck mode is
enabled in `shared/vitest.config.ts` and nowhere else, so Vitest never typechecks `web` at all.
Demonstrated: injecting two real type errors into `web/src/components/aurora/Alert.tsx` gives
`Tests 45 passed` and `Type Errors no errors`, while `tsc -b shared web` reports both.

This has produced three separate defects:

1. **BLOCKER B-1** — `npm run typecheck` exited 2 from Task 3A until G0, while `npm test` and
   `npm run build` both stayed green. Neither typechecks `web`.
2. **`TS2459` in `Alert.tsx`** — importing `IconName` from `./Icon.js`, which consumes the type
   without re-exporting it. Every Vitest run said no type errors; `tsc -b` failed. Found at G1.
3. My own reporting of a green typecheck twice, from reading `$?` after a pipe to `tail`.

Consequences, all load-bearing:

- **`pretest: npm run typecheck` must not be removed or softened.** It is the only thing in the
  default workflow that typechecks `web`. When a parallel agent's in-flight errors make it
  inconvenient, isolate with
  `npx tsc -b shared web 2>&1 | grep 'error TS' | grep -v 'src/fixtures/'` rather than disabling
  the hook.
- **Never read `$?` after a pipe.** It reports the last command in the pipeline. Run the command
  bare, or use `${PIPESTATUS[0]}`.
- **A success message that prints only on success is not evidence**, when you cannot distinguish
  "did not print" from "did not run". `cmd && echo RESTORED` prints nothing both when the
  restore failed and when the whole chain never reached it — and a missing failure message reads
  as success. This cost ~15 minutes of screenshots taken against a reverted working tree, and
  the conclusion drawn from them had to be withdrawn. **Echo the exit code positively**:
  `echo "exit=$?"`. Same family as the `$?`-after-a-pipe error that hid BLOCKER B-1 for two
  commits: in both cases the check reported on something other than what was being checked.
- **`tsc -b` is incremental.** It writes `*.tsbuildinfo` (gitignored) and can skip work; delete
  those if a result looks impossible.

## Three further plan defects, found by running it

Beyond the six the plan already records:

| # | Defect | Ruling |
|---|---|---|
| G-7 | Task 3A's guards cannot run under jsdom at all. The G-1 fix (`fileURLToPath`) throws `The URL must be of scheme file`, because Vite hands jsdom an `http://` `import.meta.url`. | Pin the file to the node environment with a `@vitest-environment node` docblock. These guards read the filesystem and never touch the DOM. |
| G-8 | `walk()` on `src/fixtures` throws ENOENT in Wave 0; the plan predicted a vacuous pass. | `walk()` tolerates a missing directory. Superseded in part: the redaction guards now scan all of `web/src`, which dissolves the ambiguity. |
| G-9 | Three guards fail on their own source, since the file necessarily contains the patterns it greps for. The plan exempts `guards.test.ts` from one of the nine, not the other three. | Exempt the guard file once, centrally, and document why. |

Also wrong in the plan, and load-bearing: **Task 3 Step 8's `Icon.tsx` has the unsafe
prop-spread ordering of H-1.** Regenerating from the plan reintroduces the injection
point. Task 3A's expected output for `grep -c viewBox` is 11; the true value is 12,
because the `Record<IconName, …>` type line also contains the word.

## Six plan defects found and fixed before/while building

Recorded because they were found by a pre-flight scan and by running the thing, and because
four of them would have produced silent wrong-green rather than a loud failure.

| # | Defect | Ruling |
|---|---|---|
| G-1 | `guards.test.ts` derived its path with `URL.pathname`, which encodes the space in `C:\git\ops dashboard` as `%20`; every `readdirSync` would throw. | Use `fileURLToPath`. Plan amended. Harmless on Linux, but the fix is strictly more correct — keep it. |
| G-2 | **The six contract tests would have passed while asserting nothing.** `expectTypeOf` is type-level; under a plain `vitest run` the file reports green with zero real assertions. | `shared/vitest.config.ts` enables `typecheck`; run via `--project shared --typecheck`; the run must report **6** assertions. Also replaced the deprecated `vitest.workspace.ts` with `test.projects`. |
| G-3 | Playwright measured the sidebar via `ancestor::div[1]` off the nav role — fragile. | `data-testid="sidebar"` on the Sidebar root (Task 6 adds it, Task 10A measures it). |
| G-4 | Recent-history `Table` columns keyed `dur`; the fixture field is `duration`. `Table` indexes `row[column.key]`, so this renders four empty cells **with no error**. | Correct keys named in Task 7. |
| G-5 | Task 9's Email test helper contradicted the Wave 3 preamble helper — the preamble's `at(path, route)` cannot express the empty-snapshot case. | Email's helper takes `Partial<EmailSnapshot>` and passes it via the documented `snapshot` prop. |
| G-6 | `npm run typecheck` **failed**: `TS6059`, `web/vitest.setup.ts` not under `rootDir: "src"`. Would have recurred for `e2e/` and `playwright.config.ts`. | `web/tsconfig.json` drops `rootDir`/`outDir`/`composite`. `web` emits nothing and nothing references it. `shared` keeps them — it is a referenced project. Fixed on disk and in the plan. |

## Standing rulings

- **Branch, not worktree.** The build scripts resolve `../design_handoff_it_ops_dashboard/...`,
  and per-agent worktrees would break a sequential build. Cost: `main` is not simultaneously
  usable while this branch is checked out.
- **Parallel implementers inside a wave.** The `subagent-driven-development` skill's default
  forbids it. Overridden because the file-ownership table is hard and disjoint — the discipline
  `AGENTS.md` already mandates. Cost: if two agents touch one file, gate G1/G3 catches it.
- **Dispatch per wave, not per task.** Tasks inside a wave are tightly coupled and the plan
  already defines its review boundaries as gates G0-G4. Cost: a larger diff per review, so a
  defect surfaces one gate later.
- **Testing dev-dependencies approved** (John, 2026-09-19): `@testing-library/react`,
  `@testing-library/jest-dom`, `jsdom`, `@playwright/test`. Dev-only, never shipped, beyond the
  spec's stated budget, which lists only `vitest`.
- **ops-dash runs locally only** (John, 2026-09-19). Not deployed, not served to any network,
  not on the corp VLAN. The spec's "deployment target is the existing audit dashboard server"
  is the *eventual* target, not a current fact. The security review in Task 11A is scoped to
  that premise and carries a "Reopens at release" list for the day it changes.

## Decided — don't relitigate

- Node API + Vite SPA, one repo, npm workspaces, TypeScript both sides, self-hosted
- SQLite via **`node:sqlite`** (Node 24 built-in — no native module). Milestone 2.
- Port the Python skills to TS, **sharing their existing credential files**
- Aurora **tokens only**; we build 8 primitives (Button, IconButton, Switch, Table,
  LinearProgress, Icon, Skeleton, Alert)
- **Zero runtime external deps**: vendored Plus Jakarta Sans `.woff2`, the 11 icons lifted from
  Aurora's extracted path data, no UI or chart library
- **Seven verified vendors**, config-driven, one adapter per *platform* (statuspage, statusio,
  zendesk-ssp, msgraph). The handoff's AWS/Okta/Cloudflare list was placeholder.
- Endpoints page comes from **Endpoint Central, not Intune**
- Contract amendments: all four approved and applied. `StatusLevel` gained `unknown` and
  `maintenance`; vendor gained `maintenance`, `incidentsSince[]`, `lastSuccessfulPoll`; the id
  union became the seven real vendors as `ServiceId`; `SourceResult` gained `empty`.
- Urbanist dropped. Dashboard sign-in deferred, auth seam in the API from day one.

## Open questions

M365 Graph consent (`ServiceHealth.Read.All` + `ServiceMessage.Read.All`) · Hornetsecurity
region filter = `United States - Atlanta`? · Zendesk pod (one instance or two) · synthetic check
targets and regions · alert delivery channel · CrowdStrike as a later tile.

Only the first blocks anything, and it blocks exactly one tile. It is now known to be a **hard
dependency**: there is no public per-workload status feed for commercial M365 at all, so Graph
is the only path. `status.cloud.microsoft/m365` is not one — its own payload scopes itself to
"can you reach Service Health".

## Facts worth not re-deriving

- **Graph:** app `CXDO-GraphExport`, thumbprint `9038A7B238AA5E3C84D5BA657335431902932539`,
  expires 2028-08-09. Holds all six scopes the Entra page needs — **no new consent for that
  page**. Credential path differs by machine: `C:\secure\.graph\` on the deploy server,
  `<vault>/_secure/_graph/` on the workstation. Since 2026-09-18 the app also holds
  `Exchange.ManageAsApp` and **Global Reader**, which `graph.py token` does not report.
- **EPC:** `C:\secure\.epc\config.json`; Zoho OAuth refresh token; **errors arrive as HTTP
  200**; 10 access tokens per refresh token per 10 minutes.
- **Icon extraction:** the Aurora glyph table is on the single bundle line beginning
  `let __ds_default_components_foundation_icon_data_hdnrqo;`, 885 entries, keys are
  `<PascalName>WeightRegular`, all eleven needed glyphs present at `viewBox="0 0 48 48"`.
- **Font vendoring:** Google's `css2` endpoint needs a desktop User-Agent or it serves ttf
  instead of woff2. Keep latin + latin-ext, both styles — four variable `.woff2` files.
- Environment this was started on: Node v24.14.1, npm 11.11.0, git 2.53.0, Windows 11.

A much longer set of carried-forward facts for Milestones 2-4 — the four Python clients' auth
mechanics, rate limits and proven traps, the deployment precedent, and an expansion scan of the
vault — is in the **appendix at the end of the plan**. Read it before writing any adapter.

## After Milestone 1

2. **The headline rule end to end.** `vendorstatus` (Statuspage first — four vendors, one
   adapter) + `synthetic`, the poller, SQLite, correlation. At this point it detects a real
   outage.
3. **The remaining adapters.** Graph, EPC, Proofpoint, Stellar — disjoint directories, safely
   parallel.
4. **Wire and harden.** Live queries, per-panel loading/stale/error states, ack/mute/resolve
   persistence, demo toggle removed, auth seam filled.

Each gets its own plan under `docs/superpowers/plans/`. Two things the vault survey says belong
in the Milestone 2 plan and are not yet in the contract: an explicit **"all sources of one
platform failed"** correlation signal (amendment 1 stops four Statuspage vendors rendering green
together, but raises no alarm that we have lost sight of all four at once), and the rule that
**a 2xx carrying non-JSON is an error, not data** — one shared helper, proven necessary by
`epc.py`'s `groups` endpoint returning an HTML login page under HTTP 200.

---

# Milestone 2 — detection. Complete (2026-09-19)

910 unit tests, typecheck clean. The chain reads five real vendor status feeds, runs
three synthetic probes, correlates two rules, stores the result and serves it read-only.
Run against the live internet; detects a simulated outage end to end.

## What M2 proved

Not that the code compiles — that the product **detects something true**. The composed
chain, hand-run against the real internet on 2026-09-19:

```
vendor:jira ok   vendor:helpjuice ok   vendor:claude ok   vendor:openai ok
vendor:zendesk ok   probes ok

proofpoint  unknown      statusio     ours=0/0  platform_unsupported
jira        operational  statuspage   ours=0/0
helpjuice   operational  statuspage   ours=1/1
claude      operational  statuspage   ours=0/0
openai      operational  statuspage   ours=0/0
zendesk     unknown      zendesk-ssp  ours=2/2
m365        unknown      msgraph      ours=0/0  platform_unsupported

incidents: 0
```

Three of seven `unknown`, zero incidents, nothing green that we could not read. That is
CLAUDE.md's "ALL SYSTEMS OPERATIONAL is unreachable in production" holding in production
rather than in a fixture.

## The finding that mattered most, and it was not in the code

**Three of the four synthetic probes could never have passed**, and no amount of fixture
testing could have shown it. Task 9 step 4 — the single hand-run against the real
internet — is the only step in the milestone that can prove a URL, and it earned its
place on the first attempt:

| target | live | why |
|---|---|---|
| `crexendo.zendesk.com` | 403 | Cloudflare bot challenge, `cf-mitigated: challenge` |
| `help.netsapiens.com` | 403 | same |
| `crexendo.atlassian.net` | 404 | hostname was a guess; it is wrong |
| `crexendo.helpjuice.com` | 200 | guess confirmed |

None of those are a vendor being unwell. Two of seven tiles would have shipped
permanently red, with half the `vendor` Sev1 condition armed from day one.

Run the probe against the real thing **before** writing the test that pins it. And note
what the fix required: `ProbeSpec.expectStatus`, because one endpoint's *healthy* answer
is a 401 — `help.netsapiens.com`'s help centre is sign-in restricted, so
`{"error":"Couldn't authenticate you"}` in 150ms is Zendesk's application tier working
perfectly. `response.ok` is the wrong predicate for a real estate.

~~**NEEDS JOHN: the real Jira Cloud hostname.**~~ **Answered 2026-09-19: the tenant is
`netsapiens`, not `crexendo`.** The guess came from the Zendesk pods' pattern, and the
pattern was the wrong one to generalise from — Crexendo and NetSapiens are both in play
and they do not use the same name everywhere. Probing `netsapiens.atlassian.net/status`:
200 `{"state":"RUNNING"}` in ~110ms, stable over four rounds, no redirect.

`/status` rather than the tenant root, and the distinction is the same one the Zendesk
pods taught: the root answers **202** with an async loading shell, which is a 2xx and
would pass, but it only proves Atlassian's edge is serving HTML. `/status` is Jira's own
liveness endpoint, answered by the instance. Probe the application tier, not what stands
in front of it.

## A comment nobody had measured was load-bearing

`probe.ts`'s block comment justified the whole `fetchJson` exemption with "Crexendo's
Zendesk pod serves an HTML login page under HTTP 200." It serves a Cloudflare challenge
under 403. The conclusion survived; the stated reason was invented. An exemption argued
from an unmeasured fact is an exemption nobody has actually checked.

## The poller counted a dead source as healthy (G2 BLOCKER 1)

`Source.run` was `() => Promise<unknown>` and any resolved promise was a successful poll.
But **nothing in this repo throws** — `fetchJson` and both adapters turn a broken feed
into an errored `SourceResult`, deliberately. So the only failure the poller could see
was the one that never happens.

A source whose feed answered 503 every minute for an hour reported `lastOkAt` seconds
old, `lastError` undefined, and on tick 1 `baseline: true` — a claim to know the starting
state of something it had never once read. `/api/health` already served `allStatus()`, so
this was a **served green for a dead source**.

The generalisation, and it is the M2 version of M1's assertion rule: **when a layer
reports failure in its return value, no caller above it may treat "it returned" as
success.** Every guard we had written for "a failed fetch must never render as green" was
pointed at the UI.

`error` is the failure signal. `empty` and `degraded` are **not**: an empty feed told us
something true (amendment 4), a degraded one told us most of it. Both are pinned by
tests, because that distinction was previously an accident of which branch the code took.

## The integration test never failed a feed

Fourteen green end-to-end checks, and the first mutation run had **four survivors out of
six**. Three traced to one gap: every test used healthy payloads, so the product's entire
reason for existing was untested end to end while the suite reported success.

This is the M1 lesson recurring in the file written to prove the milestone. The fix was
seven tests that break a feed — a 503, a 2xx carrying HTML, last-good retention across a
failing poll, a stale payload that must not satisfy the vendor half.

## Three seam defects the integration test found, each owned half-each by two agents

1. **`openIncidents()` cannot feed the correlation engine.** It returns
   `resolved_at IS NULL`; the engine also needs recently-resolved incidents, because a
   condition that clears and returns inside its window must re-open the same incident. It
   cannot recognise a prior it was never handed. The engine's whole recurrence branch was
   **unreachable in production while its unit tests passed.** Added
   `store.incidentsSince(since)`.
2. **`putIncident` never updated `severity`.** The engine escalates correctly; the store
   kept the opening value; the API reads the store. An incident that opened Sev2 and
   escalated to Sev1 was served as a Sev2 for as long as it lasted.
3. A stale `operational` payload could satisfy the vendor half. The signal builder now
   forces `unknown` whenever the newest attempt errored.

**Neither agent was wrong.** Each built its half correctly against the contract it was
given. The defects lived in the gap between two correct halves, which is precisely what
no per-file review and no unit test can see, and why composition is its own task.

## "Same id" can pass on wrong behaviour

Both the engine agent (its mutation 9) and I (the integration recurrence test) hit this
independently from opposite sides. Incident ids hash rule + service + window bucket, so a
**brand-new** incident opened in the same 30-minute bucket derives the *same id* as the
one it should have re-opened. "Same id, one row" passes just as happily on the broken
behaviour.

Only the carried `openedAt` distinguishes a re-opened incident from a fresh one wearing
its name. Same family as the standing rule: the assertion reached the value by the code's
own path.

## A test failure that was the test's fault, not the product's

The recurrence test first failed on `openedAt`. The cause was my setup: I planted the
prior into a store that already held the row, and `putIncident` deliberately does not move
`opened_at` on conflict. The assertion was measuring the test. Planted into a fresh store
instead.

Worth recording because the instinct on a red test is to suspect the code, and here the
code was right twice over — the upsert's exclusion of `opened_at` is correct and load
bearing (an incident's start time must never move, or the duration on the detail page
shrinks every tick).

## Open at the end of M2

- **NEEDS JOHN: the Jira Cloud hostname.** See above.
- ~~The `fetchJson` exemption is file-scoped.~~ **Closed.** Line-scoped now: the marker must
  sit on the offending line or the two above. Across the whole server that leaves exactly
  one site needing a licence — `probe.ts`'s `fetchImpl: FetchLike = fetch` default
  parameter — and the block comment above it stays as the argument rather than the licence.

  It needed a prerequisite nobody had noticed: `stripComments` replaced a block comment
  with a single space, collapsing forty lines into one, so **every offender line number a
  guard reported after a doc comment was already wrong**. It now blanks characters and
  keeps newlines.
- `ack` and `muted` have no columns in `incidents`. They are M4. Incident ids are a hash
  of the condition precisely so an ack has a stable row to land on when the column exists.
- `check_runs` has no retention policy and grows at one row per probe per minute forever.
- ~~The API and the engine disagree about an unreadable severity.~~ **Settled.** The rule is
  **throw on the write path, degrade loudly on the read path**, and it is not a compromise —
  each layer is right for its own reason. A guess on the write path gets *persisted*, and a
  silently downgraded Sev1 becomes a stored fact that outlives the bug. A throw on the read
  path propagates out of the route and turns one unreadable row into a 500 with no incident
  list at all: nine good incidents blanked by one bad one, which is the flattening
  `/api/incidents` exists to prevent, arriving by a different door.

  What makes the pair safe rather than merely different is that the fallback is **visible** —
  `ApiIncident.severityRaw` is populated only on a fallback decode, so the client renders a
  Sev1 row with a "severity unreadable" badge instead of an ordinary Sev1.

  Worth recording how this was decided: the API agent and the engine agent reached it
  independently, from opposite sides, having each been told only about the other's answer.
  Two agents converging on a layer rule after disagreeing on the mechanism is the strongest
  signal this project has produced that a rule is right rather than merely chosen.
- `VendorFeed` still has no `since` anchor, so `incidentsSince` on a vendor feed means
  "everything the feed publishes".
- `evaluate`'s `enabled` map is supplied by the caller and nothing reads the `rule_state`
  table into it, so both rules are effectively always on. A wiring gap, not an engine one.
- **NEEDS JOHN — the last open question, and it is a contract question, not a code one.** `DATA_CONTRACTS.md` §7's prose
  promises a **Sev2 for a single vendor `unknown` + our check failing**, and no M2 rule
  emits one; the engine's tests assert zero incidents for that state. This is either an M3
  rule or a prose correction. Deliberately not decided at the close of a milestone —
  inventing a third rule to make the prose true would be the wrong way round.

## Ruled at the close of M2, so nobody relitigates them

- **`WINDOW_MS` is 30 minutes.** Chosen by the engine agent, ratified by the lead, pinned by
  no test — it is a parameter on `correlate` and M3 may revisit it with real data.
- **A platform that has never been read DOES raise a blackout**, even though an unbuilt
  adapter does not. The distinction is by `error.code`, not by inference from the level, and
  the deciding argument is that suppressing it would make "blind since startup" the one case
  that raises nothing.
- **Flap is absorbed by the window, not by a damper.** The poller fix produces more of it: a
  feed 503ing intermittently moves a platform in and out of blackout every tick. A recurrence
  inside 30 minutes re-opens the same incident with a "Condition recurred" timeline entry
  rather than raising a fresh Sev2 each minute. Beyond 30 minutes apart it is two incidents,
  which is correct — that is a different outage.

## What M3 inherits

A working chain and two missing adapters: `statusio` (proofpoint) and `msgraph` (m365).
Both are listed in `SERVICE_PLATFORM` in `server/src/index.ts` and answer today with
`platform_unsupported`, which the blackout rule deliberately excludes — see the argued
comment in `engine/rules.ts`. **That exclusion self-repeals when the adapters land**, and
it is latent rather than hypothetical: statusio has one service today so blackout's
`>1` requirement hides it, but a second statusio vendor would make it a permanent Sev2.

msgraph is also the first adapter that needs a credential. Nothing in M1 or M2 reads one,
and no credential path has ever been transcribed into source. Keep it that way.

## A derived identifier cannot verify the logic that derives it

Task 7 step 3 in the M2 plan lists five mutations and calls them "the rule's specification".
Two engine defects live outside that list, and both survive the verification the plan names.
A reviewer following it literally signs off on either.

**The plan's mutation:** *make the incident id include a timestamp so it changes every poll.*
**The plan's check:** correlate twice and compare ids. **It does not fail.** Both calls land in
the same millisecond, `new Date().toISOString()` returns the same string, the ids match, green.
The only thing that kills it is recomputing the derivation independently in the test —
`INC-<sha256(rule\0service\0windowStart)[0:8]>` as a pinned expression — so the assertion never
takes the code's path to the value.

**The mutation the plan omits:** *make a recurrence open a brand-new incident instead of
re-opening the existing one.* The obvious check — same id, one row — passes, because a new
incident in the same 30-minute bucket derives the same id from the same ingredients. What kills
it is the facts the id does not carry: `openedAt` must be the original, the timeline must still
hold the first `opened` entry under the new `detected` one, and one case must straddle a bucket
boundary (resolve 12:29:30, recur 12:31:00) where a re-open and a fresh incident finally differ.
See "Same id can pass on wrong behaviour" above, which the lead reached from the integration
side at a cost of about an hour.

The general form, and it belongs with the standing rule rather than beside it: **an identifier
computed from the state cannot be used to check the logic that computed it.** Equality of two
derived ids proves the ingredients matched, and nothing else — not that the right branch ran,
not that the identity was carried rather than coincidentally re-derived. Verify a derived id
against a literal or an independent re-derivation, and verify the *behaviour* against a fact
the id does not encode.


## Gate G2 — closed with accepted findings, then all of them fixed anyway (2026-09-19)

The reviewer's eight findings were all real and all reproduced before being written down.
Six were fixed the same session; the two it marked "accepted" turned out to be cheap once
the poller could tell a failed read from a successful one, so they were fixed too.

Worth separating what the gate was *for* from what it found. It was asked three questions
about the poller. It answered all three, and then found something none of them named:
**the poller's definition of success was wrong**, because it had been written against a
convention — throw on failure — that this codebase had deliberately abandoned two waves
earlier. Nothing in the poller's own tests could see it. The tested path was the one
production never takes.

## The security review changed the standard of evidence

M1's review was a reasoned threat model. M2's reproduced things:

- a 300 MB response measured at **1.29 GB of RSS in 1.0 second** on loopback, which is
  what made a body cap non-negotiable rather than a nice-to-have
- a working redirect from a status feed into `http://127.0.0.1/latest/meta-data/`, whose
  body came back as **a clean un-degraded `SourceResult`**, indistinguishable from a good
  vendor read
- the file-scoped guard exemption demonstrated in both directions with a probe file

None of those were arguable afterwards. A finding with a number attached gets fixed in the
session it was found; a finding with a category name gets a ticket. Both reviews were
competent — the difference was the evidence, and it is worth asking any future reviewer
for the reproduction rather than the reasoning.

## Convergence as a signal

Twice in this milestone two agents reached the same answer independently, from opposite
sides, each knowing only that the other had answered differently:

- **the severity codec** — throw on the write path, degrade loudly on the read path
- **correlate on the newest attempt, never on the stale payload** — the engine recommended
  it; the lead had already built it; G2 found the same thing from the store's end as HIGH 4

Neither was in any plan. Both are now rules. When parallel agents disagree, the plan is
usually ambiguous; when they converge after disagreeing about mechanism, the rule is
usually right. That is a cheaper signal than a third review and it costs nothing to notice.

## Still open after M2, for whoever picks up M3

- ~~NEEDS JOHN: the Jira Cloud hostname~~ — answered, `netsapiens.atlassian.net/status`.
  **NEEDS JOHN: the §7 Sev2 prose question** is the only one left. See above.
- **A source whose timer silently stops still classifies as `healthy`.** `SourceStatus` now
  carries `intervalMs`, so the API *can* classify staleness at >3x interval — it is not yet
  wired. This is the last place in the chain where something broken reads calm.
- **Security MEDIUM-3**: adapters ship vendor-authored `url` strings that nothing parses,
  and `web/src/lib/safeUrl.ts` is still called by nothing. Goes live at M4 wiring, but the
  cheap fix belongs in the adapters, before the store.
- **Deep-nesting is inert only by accident**: every adapter replaces `data` with a flat
  `Vendor` before `db.ts` stringifies it. An M3 adapter that stores a raw vendor body
  re-arms it.
- **`check_runs` has no retention** — 263 MB/year measured at M2 cadence, unbounded.
- **Nothing has ever run unattended.** Every claim about the long-lived process is reasoned
  from the code, not observed. The first M3 task should be to leave it running for a day
  and look at what it did.


## Zendesk is pod-scoped, and I had the feed's limits half wrong (2026-09-19)

John pushed back on "the feed publishes no health" with Zendesk's own documentation. He
was right about the part that mattered and the correction is worth keeping, because I had
stopped investigating one probe too early.

**What I got wrong.** `?subdomain=<ours>` works. I had tried it, seen the `data` array
look identical, and moved on — but the answer is in `meta.location`:

```
?subdomain=crexendo  ->  Pod 23: East Coast US (Northern Virginia) (AWS)
no subdomain         ->  All locations
```

Scoped, the incident list drops from **17 to 10**. Seven of the seventeen were about pods
we are not on. A tile whose incidents are usually irrelevant is a tile the operator stops
reading — the same failure as a permanently-red tile, arrived at from the other direction.

The lesson is narrow and reusable: **two API responses that differ only in metadata look
identical if you diff the payload.** I compared the wrong part of the document.

**What survived.** Service attributes are `deprecated, description, hasSubservices, name,
position, slug` — with the subdomain applied, which is the obvious thing that might have
changed it. There is still no status field, and no `status.json` / `summary.json` /
`components.json` endpoint exists. Zendesk's status PAGE does render green bars, but it
derives them from incident history: it is making exactly the inference this adapter
declines to make. That is a real disagreement with the vendor's own convention, and it is
amendment 4, so it stands — but it should be stated as a choice, not as a limitation of
the feed.

**Two tenants, not one.** `crexendo` and `netsapiens`. Both sit on Pod 23 today, so a
single query would happen to cover both — and that coincidence is exactly what not to
build on. `VendorFeed.tenants` is a list; the adapter queries each, merges deduped by
incident id, and **fails the whole read if either tenant cannot be read**. If we cannot
see netsapiens we cannot speak for Zendesk, however healthy crexendo looked.

Four mutations, all caught: only the first tenant queried, scoping dropped, incidents
concatenated rather than deduped, and a failing tenant skipped instead of aborting.

The integration stub caught this change by itself, which is the design working: it 404s
any URL it was not given, so the new pod-scoped URLs failed loudly rather than quietly
reporting an empty Zendesk.


## Amendment 10 — the first amendment that NARROWS an earlier one (2026-09-19)

Approved by John. Amendment 4 said consumers never infer `operational` from `empty`, and it
was right about the failure it was written for. What it did not anticipate was a platform
that publishes **no health field at all**: for Zendesk, `unknown` was not a transient state,
it was the only state, and the tile could never move. A tile that can never change teaches
the operator to ignore it exactly as a permanently-red one does — the same failure the probe
work hit from the other direction on the same day.

**The rule.** A vendor half may read `operational` only when all four hold: the platform
publishes no health field (`zendesk-ssp` alone, verified twice); the newest poll SUCCEEDED;
its scoped incident feed shows nothing open; and we have at least one check of our own with
every one passing. It must then set `vendor.inferred.basis`, and the tile must show the
reading is ours. **Never downward** — `degraded` and `outage` come from published incidents
only.

**Why downward is forbidden, and it is not squeamishness.** The Sev1 rule is `vendor
degraded/outage AND our check failing`. Inferring a vendor outage from our own failing checks
would fold our half into the vendor half, and the rule would confirm itself from one piece of
evidence counted twice.

The fourth condition is what keeps the halves independent, and the argument is short enough
to check: inference fires only when our checks all pass, so it can never satisfy the vendor
half (`operational` does not), and never suppress one (with our checks failing there is no
inference, the level stays `unknown`, which also does not). **The rule's behaviour is
identical before and after — and that is asserted by tests calling the real
`vendorHalfSatisfied` and `ourCheckFailing`, not argued in a comment.** An amendment that
claims to leave a rule alone should be made to prove it.

Six mutations, all caught: each of the four conditions dropped in turn, the `inferred` marker
omitted, and inference made to run downward.

Live afterwards: zendesk `operational`, `2 of 2 of our own checks passing, and no open
incident published for our pod`. proofpoint and m365 stay `unknown` — condition 1 refusing to
infer for a platform whose adapter simply does not exist yet, which is the case it was
written for.

### Two guards caught this, and both were guards written to catch exactly this

The three-way agreement guard failed twice in a row, correctly:

1. I amended the prose in `DATA_CONTRACTS.md` and the type in `contracts.ts` but not the
   doc's own **type block** — and the doc's type block is the source of record.
2. Then the doc declared the field across three lines and the conformance test declared it
   inline on one, so the textual comparison still disagreed.

The second is arguably the guard being fussy about formatting. It is worth keeping anyway:
the guard's whole job is that the three declarations are transcribed from one another, and a
transcription that reformats is one a human can no longer diff at a glance.


## Proofpoint is Hornetsecurity on status.io (2026-09-19)

John supplied `https://live.hornet-status.com/`. The `statusio` platform guess in
`vendors.json` was right; the page id is in the page's own HTML
(`statuspage_id: "591aaa7fe69f388425000fda"`), and the API is
`https://api.status.io/1.0/status/<id>` — public, credential-free, 19 services.

**Unlike Zendesk it genuinely publishes health**, per service and per datacentre, so no
amendment-10 inference is needed or permitted here.

### The filter is the whole job, again

`containers` are datacentres and the feed lists ten. Ours is named **two mutually exclusive
ways**, which no amount of reading the docs would have told us:

```
United States - Atlanta   13 services   the core email estate
United States - Georgia    3 services   the newer 365 products
```

No service carries both. Listing one drops a third of the estate.

The captured payload happens to contain the perfect demonstration: on 2026-09-19
`365 Total Backup` was in **Planned Maintenance globally while its Georgia container read
Operational**. Unfiltered we report maintenance we are not having — 2 of 19 degraded
against the true 1 of 16. Same lesson as the Zendesk pod, third time in one day: filter
every vendor feed to the part of it that serves us.

### The mutation that mattered, and the test that lied

`worstLevel` across matching containers survived being replaced with `matched[0]`. Cause:
**no service in the real feed has both our containers**, so the rollup was always over a
one-element list — and the test asserting it was named *"worst wins across our two
datacentres"* while exercising one.

The fix is a constructed two-container service, asserted in **both array orders** so that
"take the last" is no more satisfiable than "take the first". The general form is already
in this file, but here is another face of it: **a test named after a condition the fixture
cannot produce is a test that passes on the fixture, not on the claim.** When the live data
has no instance of the case, construct one — the absence is precisely why it will break
unnoticed.

One false survivor too, worth recording because it wastes time: a `sed` mutation whose
pattern did not match the file's spacing reported "survived" when nothing had been mutated.
**Check that a mutation actually changed the file before believing it survived.**

### One open question for John

The rollup covers all 16 Hornetsecurity services in our datacentres. Some — Security
Awareness Service, Teams Protection, DMARC Manager — may not be in use, and each one we do
not use is a tile that can go amber for no reason. `VendorFeed.component` already narrows
to a named service if we want it. Not urgent: with no proofpoint probe, `ours.total === 0`,
so the vendor half can never pair with a failing our-half and no Sev1 can fire from this.
