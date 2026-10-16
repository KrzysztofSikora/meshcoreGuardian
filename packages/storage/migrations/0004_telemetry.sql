CREATE TABLE telemetry_samples (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  run_id INTEGER NOT NULL,
  check_seq INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('status', 'telemetry')),
  measured_at INTEGER NOT NULL,
  voltage_v REAL,
  uptime_s INTEGER CHECK (uptime_s IS NULL OR uptime_s >= 0),
  rssi_dbm REAL,
  rssi_scope TEXT CHECK (rssi_scope IS NULL OR rssi_scope IN ('last_hop', 'unknown')),
  snr_db REAL,
  snr_scope TEXT CHECK (snr_scope IS NULL OR snr_scope IN ('last_hop', 'unknown')),
  extra_json TEXT NOT NULL DEFAULT '[]',
  CHECK ((rssi_dbm IS NULL) = (rssi_scope IS NULL)),
  CHECK ((snr_db IS NULL) = (snr_scope IS NULL)),
  UNIQUE (run_id, check_seq),
  FOREIGN KEY (run_id, check_seq) REFERENCES diagnostic_checks (run_id, seq) ON DELETE CASCADE
);

CREATE INDEX telemetry_samples_device_measured ON telemetry_samples (device_id, measured_at);
