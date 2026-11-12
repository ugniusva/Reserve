CREATE TABLE IF NOT EXISTS booking_closures (
  id TEXT PRIMARY KEY NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS booking_closures_end_start
  ON booking_closures (end_ms, start_ms);
