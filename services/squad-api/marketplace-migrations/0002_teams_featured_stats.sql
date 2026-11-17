-- Team templates, a curated featured order, and install analytics (ADR-0248).
-- A listing is one agent or a whole team, and both are team files. Counters on
-- the row are what admins read, listing_stats keeps them per day, seen rows
-- make each count one per network per listing per day, and attributions join a
-- website Add click to the install it led to, by a random id, for 30 days.

ALTER TABLE listings ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent' CHECK (kind IN ('agent','team'));
ALTER TABLE listings ADD COLUMN members INTEGER NOT NULL DEFAULT 1;
-- A team's member birds in order, lead first, so a row can show its faces.
ALTER TABLE listings ADD COLUMN faces TEXT NOT NULL DEFAULT '[]';
ALTER TABLE listings ADD COLUMN featured_rank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN add_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN installs INTEGER NOT NULL DEFAULT 0;
CREATE INDEX listings_kind ON listings(status, kind, category, featured DESC, created_at DESC, id DESC);
CREATE INDEX listings_featured ON listings(status, featured, featured_rank);

CREATE TABLE listing_stats (
  listing_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  add_clicks INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (listing_id, day)
);

CREATE TABLE listing_event_seen (
  listing_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('view','add_click','install')),
  bucket TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (listing_id, type, bucket)
);
CREATE INDEX listing_event_seen_expiry ON listing_event_seen(expires_at);

CREATE TABLE attributions (
  id TEXT PRIMARY KEY CHECK (length(id) = 20),
  listing_id TEXT NOT NULL,
  clicked_at TEXT NOT NULL,
  installed_at TEXT,
  install_source TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL
);
CREATE INDEX attributions_listing ON attributions(listing_id, installed_at);
CREATE INDEX attributions_expiry ON attributions(expires_at);
