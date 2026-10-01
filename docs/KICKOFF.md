# Kickoff — resume the Milestone 1 build on another machine

Two steps: get the repo running, then paste the prompt into Claude Code.

## 1. Shell

```bash
git clone https://github.com/jczechowski-CXDO/ops-dash.git
cd ops-dash
git checkout milestone-1-scaffold
node --version
npm install
npm run typecheck        # must exit 0
npm run build            # must exit 0
npm test                 # see note — exits 1 until Task 2, and that is correct
```

Three things you will see on a fresh box, all expected:

1. **`npm test` exits 1 with "No test files found".** There are no tests yet — Task 1 wrote
   none. Do not "fix" this with `passWithNoTests`: from Task 2 onward a zero-test run is a real
   failure signal, and silencing it is how a suite goes green while asserting nothing. Chain the
   three commands with `;` rather than `&&` until the first test lands.
2. **`vite build` says `/aurora/styles.css doesn't exist at build time`.** Correct — Task 3
   creates it. The warning disappears once the Aurora tokens are copied into `web/public/`.
3. **`npm audit` reports 2 moderate.** Both are dev-only, in `vitest`. `npm audit --omit=dev`
   reports **0**, which is the check the plan's Task 11A actually runs. Do not `npm audit fix
   --force` — it would install vitest 5 as a breaking change mid-build.

**Node version.** `package.json` requires `>=24.14.1` and npm will warn `EBADENGINE` on
anything lower. Milestone 1 does in fact build and test on Node 22 — nothing in it needs 24 —
so a warning is not a blocker today. **Milestone 2 is a hard stop**, because the store is
`node:sqlite`, a Node 24 built-in. Install Node 24 now rather than discovering this later:

```bash
# nvm
nvm install 24 && nvm use 24
# or Debian/Ubuntu via NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs
```

Do not lower the `engines` floor to silence the warning. The floor is correct; the environment
is what is behind.

**If `vite build` ever fails with a missing esbuild binary** — newer npm gates install scripts,
and you may see `allow-scripts: esbuild@0.28.2 (postinstall)`. It resolved on its own here, but
if it does not: `npm approve-scripts esbuild` then `npm install`.

## 2. Paste into Claude Code

Run `claude` in the repo root and paste this:

```
Resume the ops-dash Milestone 1 build.

Read docs/RESUME.md first — it is the entry point and states exactly what is built,
what is next, and the six plan defects already found and fixed. Then read the plan at
docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md.

Execute it with superpowers:subagent-driven-development, as an agent team, using the
plan's own wave and file-ownership structure:

  Wave 0  solo      Tasks 2, 3, 3A          (Task 1 is already done and committed)
  Wave 1  2 agents  Tasks 4, 5              parallel, disjoint ownership
  Wave 2  solo      Task 6
  Wave 3  4 agents  Tasks 7, 8, 9, 10       parallel, disjoint ownership
  Wave 3½ solo      Task 10A                Playwright baselines
  Wave 4  solo      Tasks 11, 11A, 12

Dispatch per wave rather than per task, and close the plan's review gate G0-G4 at the
end of each wave before dispatching the next. Tag each wave (git tag wave-0, etc.) so
the gate diffs are clean.

Rules that are already decided — do not relitigate them, they are in docs/RESUME.md
under "Standing rulings" and in the plan's Global Constraints:
  - shared/src/contracts.ts is FROZEN once Task 2 writes it
  - zero runtime external dependencies; the dev-dependency list is closed
  - no literal hex in web/src; every colour is a var(--*) token
  - fixtures are permanently redacted
  - the app runs locally only; it is not deployed anywhere
  - work on branch milestone-1-scaffold; do not merge to main without asking

Two things to know before you start:
  - Task 2's contract tests use expectTypeOf, which is type-level. They MUST run under
    `npx vitest run --project shared --typecheck` and MUST report 6 assertions. A run
    reporting 0 assertions is a green pass that proves nothing.
  - Task 10A's 28 Playwright baselines are platform-sensitive. Generate them on this
    machine and say so in the commit — Windows-generated baselines will not match.

Work continuously through all waves. Report at each gate.
```

## If you want it in one shot without the waves

Paste this instead. Simpler, slower, no parallelism, one context:

```
Resume the ops-dash Milestone 1 build. Read docs/RESUME.md, then the plan at
docs/superpowers/plans/2026-09-18-ops-dash-m1-scaffold.md, then execute Tasks 2
through 12 in order with superpowers:executing-plans. Task 1 is already committed.
Work on branch milestone-1-scaffold. Do not merge to main without asking.
```
