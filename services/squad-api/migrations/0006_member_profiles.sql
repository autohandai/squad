-- A member's profile kept in its owner's Autohand account (ADR-0280): small,
-- revisioned, one row per member id. Separate from owned_records, whose agent
-- revisions belong to portable backups (ADR-0194).
CREATE TABLE member_profiles (
  owner_key TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content TEXT,
  deleted INTEGER NOT NULL CHECK (deleted IN (0,1)),
  change_id TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES identities(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, id)
);
CREATE TABLE member_profile_mutations (
  owner_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES identities(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, actor_id, idempotency_key)
);
