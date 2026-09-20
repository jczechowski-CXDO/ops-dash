# Milestone 3 — live

**The one sentence.** ops-dash has a detection chain that works and a dashboard that looks
right, and they have never met. M3 connects them and runs the result unattended.

Everything in M1 and M2 was verified by hand-run. Nothing has started as a process. No
screen has ever shown a number that came from a vendor. Both of those end here.

## Global constraints — these bind every task

Carried from M2 and non-negotiable.

1. **A failed read never renders as green.** Now reaching the UI for the first time, which
   is where every M1 guard was pointed and where it has never actually been tested against
   real failure.
2. **An assertion may not reach the value under test by the same path the code did.**
3. **Before committing a test whose name makes a claim, break the thing it names and watch
   it go red.** Report the mutations.
4. **Stage by path. Never `git add -A`, never `git stash`.** Other agents are writing.
5. **`shared/src/contracts.ts` is frozen.** Amend `DATA_CONTRACTS.md` first, with John's
   approval.
6. **The fixture path must keep working.** `?demo=quiet|sev1` and the 152 visual baselines
   are the offline proof; live data is an addition, never a replacement.
7. **No new runtime dependency** without asking.

## The scoping rule M2 earned

Four vendors in a row, the whole design question was *which part of this feed is about us*.
The M3 equivalent: **which part of this payload is about this screen** — and what the screen
shows when the answer is "we could not look".

## Wave 1 — parallel

### Task 1: the entry point (lead, solo)
`server/src/main.ts`, scripts, graceful shutdown. Then **run it for an hour and read the
log**, and put what actually happened in the commit message. This is the only task that can
tell us something we do not already believe.

### Task 2: `/api/services` serves a whole tile (agent `m3-api`)
It serves the vendor half. A tile needs `ours`, `latencyMs`, `p50Ms`, `p95Ms`, `spark`,
`uptime30d`, `incidents90d`, `lastStateChange`. The store computes most of it.

**The honesty rule is the task.** `db.uptime()` returns `undefined`, not 1, when there is no
data. No probe data is NOT 100% uptime, an empty spark is NOT a flat line at zero, and a
service with no checks has `ours.total === 0`, which is not "passing". Whatever carries
those outward must keep them distinguishable from real numbers.

### Task 3: retention, staleness, and the last silent failure (agent `m3-store`)
- `check_runs` grows unbounded — 263 MB/year measured. Prune on a schedule, keep enough for
  a 30-day p95, prove the retention actually deletes and that the percentile survives it.
- **A source whose timer silently stops still classifies as `healthy`.** `SourceStatus` now
  carries `intervalMs`; nothing uses it. Classify `stale` past a small multiple of the
  interval. This is the last place in the chain where something broken reads calm.
- Watch the Graph certificate's expiry the same way. A monitor whose own credential dies
  quietly is this product's thesis turned on itself.

## Wave 2 — after Task 2 lands

### Task 4: wire Overview, ServiceDetail, IncidentDetail (agent `m3-web`)
A fetch layer, and the three states every panel now has to have: loading, failed, and
**stale-but-showing-last-good**. That third one is the product.

`?demo=` must still work and must be the default in tests, so the baselines do not move.

### Task 5: Settings reads `rule_state` (folded into Task 4 if small)
Both rules are effectively always on; nothing reads the table.

## Wave 3

### Task 6: the review gate G5, then the docs and the close.

## Explicitly NOT in M3

Entra, Endpoints and Email screens keep their fixtures — each needs its own adapter and
they are M4. Auth is M4. Ack/mute need schema and are M4.

## Definition of done

`npm start` runs one process that polls, correlates, serves, and survives a night. Opening
the dashboard shows real vendor data on three screens, with failure visible as failure.
1129 tests still pass and the 152 baselines still match.
