-- Squad agent marketplace (ADR-0246). A separate D1 database, squad-marketplace,
-- bound to squad-api as MARKETPLACE: public, read-heavy listing traffic stays
-- off the private control plane, and its backups, Time Travel restores and
-- retention are decided apart from accounts, sessions and memory.
-- People are referenced by issuer and subject (or team account id), never by
-- control-plane row ids, because no foreign key can cross databases.

CREATE TABLE publishers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('autohand','user','team')),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, issuer, subject)
);

CREATE TABLE listings (
  id TEXT PRIMARY KEY CHECK (length(id) = 12),
  publisher_id TEXT NOT NULL REFERENCES publishers(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('engineering','product','design','marketing','sales','support','operations','finance','people','personal')),
  tags TEXT NOT NULL DEFAULT '[]',
  bird TEXT NOT NULL DEFAULT '',
  creator_kind TEXT NOT NULL CHECK (creator_kind IN ('autohand','user','team')),
  creator_name TEXT NOT NULL,
  search_text TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  skills INTEGER NOT NULL DEFAULT 0,
  has_memory INTEGER NOT NULL DEFAULT 0 CHECK (has_memory IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('published','unpublished','hidden','removed')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  adds INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  moderated_at TEXT,
  moderation_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX listings_public ON listings(status, featured DESC, created_at DESC, id DESC);
CREATE INDEX listings_category ON listings(status, category, featured DESC, created_at DESC, id DESC);
CREATE INDEX listings_publisher ON listings(publisher_id, updated_at DESC);

CREATE TABLE listing_versions (
  listing_id TEXT NOT NULL REFERENCES listings(id),
  version INTEGER NOT NULL CHECK (version > 0),
  document TEXT,
  content_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (listing_id, version)
);

-- One publish request, replayed on retry with the same key and body.
CREATE TABLE publish_receipts (
  actor TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor, idempotency_key)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  reason TEXT NOT NULL CHECK (reason IN ('spam','harmful','impersonation','secrets','broken','other')),
  details TEXT NOT NULL DEFAULT '',
  reporter TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX reports_open ON reports(status, created_at DESC);
CREATE UNIQUE INDEX reports_one_open_per_reporter ON reports(listing_id, reporter) WHERE status = 'open';

-- Hashed network or actor buckets. No IP address is stored.
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);

-- One add per network per listing per day, so the count means people.
CREATE TABLE listing_adds (
  listing_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (listing_id, bucket)
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('admin','user','team','system','public')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  listing_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_listing ON audit(listing_id, id DESC);
