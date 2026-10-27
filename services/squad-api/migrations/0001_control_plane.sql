PRAGMA foreign_keys = ON;
CREATE TABLE identities (
  id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
  email TEXT NOT NULL, display_name TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES identities(id), label TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE auth_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES identities(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  created_at TEXT NOT NULL, PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id, tenant_id);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  created_by TEXT NOT NULL REFERENCES identities(id), expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES identities(id), revoked_at TEXT
);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  created_at TEXT NOT NULL, archived_at TEXT, UNIQUE (tenant_id, id)
);
CREATE INDEX workspaces_tenant ON workspaces(tenant_id, created_at, id);
CREATE TABLE devices (
  id TEXT NOT NULL, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES identities(id), label TEXT NOT NULL,
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, id)
);
CREATE TABLE memory_entries (
  tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('team','member','project')),
  revision INTEGER NOT NULL CHECK (revision > 0), object_key TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0,1)),
  updated_by TEXT NOT NULL REFERENCES identities(id), updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, id)
);
CREATE TABLE memory_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  entry_id TEXT NOT NULL, revision INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE,
  deleted INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX memory_changes_workspace ON memory_changes(tenant_id, workspace_id, sequence);
CREATE TABLE mutations (
  tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, object_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, actor_id, idempotency_key)
);
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE releases (
  channel TEXT PRIMARY KEY CHECK (channel IN ('stable','nightly')),
  version TEXT NOT NULL, object_key TEXT NOT NULL, digest TEXT NOT NULL, published_at TEXT NOT NULL
);
