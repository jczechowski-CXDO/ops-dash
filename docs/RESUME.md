# Resume here — ops-dash

Last updated 2026-09-19. **Milestone 1 is under construction. Wave 0 (Tasks 1, 2, 3, 3A) is
done, committed and reviewed; gate G0 is closed with accepted findings. Wave 1 is next.**
Read this file, then the plan, then start at "Pick up here".

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

**Wave 2 — Task 6, `ops-shell` solo.** Shell, routing, theme, view stubs. Then gate G2.

Superseded, for the record: **Wave 1 — Tasks 4 and 5, two agents in parallel.** `ops-primitives` builds the eight
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

**Assert what the value must be, not what it must not be.** And note the trap one level on,
which `w3-service` and `w3-overview` both found independently: **equality against the published
helper is not sufficient either**, because both sides then call the same function and the test
passes if the view and the test are wrong together. Pin it with one concrete expected value
beside the equality, or with an inequality against the rung it must *not* be. The pair is the
guard; either alone is not.

The general form, and the reason every one of these was the code being the wrong shape rather
than the guard having a blind spot: **when a guard fires on a test file, the test is usually
asserting the wrong thing.**

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

## Task 10A environment notes — read before starting it

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
