CREATE TABLE diagnostic_runs (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  companion_public_key TEXT NOT NULL,
  companion_name TEXT NOT NULL,
  companion_firmware TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  attempts_used INTEGER NOT NULL,
  attempts_per_check INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('RESPONDED', 'NO_RESPONSE', 'TRANSPORT_UNAVAILABLE', 'UNSUPPORTED', 'NOT_TESTED')),
  reason TEXT NOT NULL,
  limitations_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX diagnostic_runs_device_finished ON diagnostic_runs (device_id, finished_at);

CREATE TABLE diagnostic_checks (
  run_id INTEGER NOT NULL REFERENCES diagnostic_runs (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'status', 'telemetry')),
  result TEXT NOT NULL CHECK (result IN ('RESPONDED', 'NO_RESPONSE', 'TRANSPORT_UNAVAILABLE', 'UNSUPPORTED', 'NOT_TESTED')),
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  timeout_ms INTEGER,
  timeout_source TEXT CHECK (timeout_source IS NULL OR timeout_source IN ('estimate', 'default', 'override')),
  started_at INTEGER,
  duration_ms INTEGER,
  evidence_json TEXT,
  PRIMARY KEY (run_id, seq)
);
