CREATE TABLE devices (
  id INTEGER PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE CHECK (length(public_key) = 64),
  reported_name TEXT NOT NULL,
  reported_role TEXT NOT NULL CHECK (reported_role IN ('repeater', 'room_server', 'chat', 'unknown')),
  reported_type INTEGER NOT NULL,
  user_label TEXT CHECK (user_label IS NULL OR length(user_label) BETWEEN 1 AND 64),
  user_role TEXT CHECK (user_role IS NULL OR user_role IN ('repeater', 'room_server', 'chat', 'unknown')),
  last_heard_at INTEGER,
  in_contacts INTEGER NOT NULL CHECK (in_contacts IN (0, 1)),
  dashboard_pinned INTEGER NOT NULL DEFAULT 0 CHECK (dashboard_pinned IN (0, 1)),
  created_at INTEGER NOT NULL,
  synced_at INTEGER NOT NULL
);

CREATE INDEX devices_in_contacts ON devices (in_contacts);
