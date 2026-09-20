-- ops-dash store. One SQLite file, node:sqlite, no ORM.
--
-- Every table here exists because something must survive a restart. A store
-- that only works in-process is not a store, and the whole point of persisting
-- probe history is that spark[], p50, p95 and uptime30d become measurements
-- rather than a generated curve.

PRAGMA journal_mode = WAL;   -- a read during a write must not block
PRAGMA foreign_keys = ON;
-- A bulk delete writes every touched page into the WAL, and WAL does not shrink
-- back on its own: the review measured a 264 MB WAL during a one-year bulk load
-- and the first prune after a long outage is the same shape of transaction.
-- 64 MB is the checkpoint's high-water mark, after which the file is truncated.
-- This is why retention does NOT run VACUUM: freed pages are reused by the next
-- day's inserts, so the main file reaches a steady size on its own, and a VACUUM
-- rewrites the whole database — a multi-second stall on a process whose job is to
-- answer every minute — to reclaim space that is about to be refilled anyway.
PRAGMA journal_size_limit = 67108864;

-- Last-good SourceResult per source, so a failed poll serves a stale panel
-- rather than an empty one. The payload is the whole envelope as JSON —
-- fetchedAt, degraded, empty and error included — because the API mirrors it
-- outward unchanged and flattening it here would lose the only thing that
-- distinguishes "nothing is wrong" from "we could not look".
-- Last GOOD payload and last ATTEMPT are separate columns, because they are
-- separate facts and the panel needs both. The first version of this table kept
-- one payload per source and upserted it on every poll — so a failed poll
-- overwrote the good data it was supposed to fall back to, and `ok`'s comment
-- ("last-good is the newest ok=1") described a history that could not exist
-- with one row per source. Caught at G0 before anything depended on it.
--
-- A stale panel is then last_good_payload + last_error + degraded, which is
-- exactly what DATA_CONTRACTS says the UI renders: the previous data with a
-- stale badge, never zeros dressed as fresh.
CREATE TABLE IF NOT EXISTS snapshots (
  source            TEXT PRIMARY KEY,
  payload           TEXT,               -- last SourceResult that CARRIED DATA - a clean read, or a
                                        -- partial one. NULL until a poll returns something to draw.
  fetched_at        TEXT,               -- when that successful one was fetched
  last_attempt_at   TEXT NOT NULL,      -- every poll, success or not
  last_error        TEXT                -- the failed attempt's error as JSON; NULL if the last attempt was good
);

-- Every probe run. This is the table that makes the latency figures real.
CREATE TABLE IF NOT EXISTS check_runs (
  service_id  TEXT NOT NULL,
  at          TEXT NOT NULL,
  check_name  TEXT NOT NULL,
  region      TEXT NOT NULL,
  result      TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'timeout')),
  latency_ms  INTEGER                   -- NULL on timeout. NOT 0 — a zero renders as
);                                      -- an extremely fast probe, the opposite of true.

-- Measured at 300,000 rows on Node 24, five runs averaged. The first comment
-- here claimed this index rescued the percentile query; it does not, and the
-- claim was written without measuring.
--
--                    with index   without
--   runsFor (recent)     0.01ms    32.34ms   <- this is what the index is for
--   uptime (window)     13.63ms    26.18ms
--   percentiles         35.90ms    31.30ms   <- no help, marginally worse
--
-- percentiles ORDERs BY latency_ms, which this index cannot serve, so it scans
-- and sorts either way. That is acceptable at this volume and is worth
-- revisiting only if the window grows: the fix would be a second index on
-- (service_id, latency_ms), not a wider one here.
CREATE INDEX IF NOT EXISTS check_runs_service_at ON check_runs (service_id, at DESC);

-- Last canonical level per (vendor, component). Keyed on the PAIR: a vendor
-- with two components must not have one overwrite the other.
CREATE TABLE IF NOT EXISTS vendor_state (
  vendor               TEXT NOT NULL,
  component            TEXT NOT NULL,
  level                TEXT NOT NULL,
  last_successful_poll TEXT,            -- NULL until one succeeds. Absent is not stale.
  updated_at           TEXT NOT NULL,
  PRIMARY KEY (vendor, component)
);

-- Correlation output. The id is derived from rule+service+window and is
-- therefore STABLE across polls — an ack recorded against it must not be
-- orphaned by the next tick.
CREATE TABLE IF NOT EXISTS incidents (
  id          TEXT PRIMARY KEY,
  rule_key    TEXT NOT NULL,
  service_id  TEXT NOT NULL,
  severity    TEXT NOT NULL,
  opened_at   TEXT NOT NULL,
  resolved_at TEXT,
  summary     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_actions (
  incident_id TEXT NOT NULL REFERENCES incidents (id),
  action      TEXT NOT NULL CHECK (action IN ('ack', 'mute', 'unmute', 'resolve')),
  actor       TEXT NOT NULL,
  at          TEXT NOT NULL,
  until       TEXT
);

CREATE TABLE IF NOT EXISTS rule_state (
  key     TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL
);
