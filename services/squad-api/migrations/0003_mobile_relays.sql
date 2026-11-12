CREATE TABLE IF NOT EXISTS mobile_relay_routes (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  team_id TEXT,
  last_seen_at TEXT NOT NULL
);
