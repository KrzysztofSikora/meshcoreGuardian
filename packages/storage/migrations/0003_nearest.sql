ALTER TABLE devices ADD COLUMN path_hops INTEGER CHECK (path_hops IS NULL OR path_hops BETWEEN 0 AND 63);
ALTER TABLE devices ADD COLUMN adv_lat REAL CHECK (adv_lat IS NULL OR adv_lat BETWEEN -90 AND 90);
ALTER TABLE devices ADD COLUMN adv_lon REAL CHECK (adv_lon IS NULL OR adv_lon BETWEEN -180 AND 180);

CREATE TABLE contact_sync_origin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  companion_public_key TEXT NOT NULL,
  companion_lat REAL,
  companion_lon REAL,
  synced_at INTEGER NOT NULL
);
