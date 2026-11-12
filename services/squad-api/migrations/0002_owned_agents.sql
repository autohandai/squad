CREATE TABLE owned_records (
  owner_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('agent','squad')),
  id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL CHECK (revision > 0),
  object_key TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0,1)),
  created_by TEXT NOT NULL REFERENCES identities(id),
  updated_by TEXT NOT NULL REFERENCES identities(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, kind, id)
);
CREATE TABLE agent_blobs (
  owner_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES identities(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, sha256)
);
CREATE TABLE agent_mutations (
  owner_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES identities(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, actor_id, idempotency_key)
);
CREATE TABLE agent_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES identities(id),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX agent_audit_owner ON agent_audit(owner_key, id);
CREATE TABLE owned_exports (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES identities(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  include_shared INTEGER NOT NULL CHECK (include_shared IN (0,1)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  retained_at TEXT,
  label TEXT NOT NULL DEFAULT '',
  UNIQUE (owner_key, actor_id, idempotency_key)
);
CREATE TABLE owned_export_records (
  plan_id TEXT NOT NULL REFERENCES owned_exports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('agent','squad')),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (plan_id, kind, id)
);
CREATE INDEX owned_exports_expiry ON owned_exports(expires_at);
CREATE INDEX owned_exports_retained ON owned_exports(owner_key,retained_at,created_at,id);
