-- Agent email addresses (Squad ADR-0262): <name>@code.autohandai.com, routed
-- by Cloudflare Email Routing to this Worker's email handler, held here until
-- the owner's Squad collects them for the member.
CREATE TABLE agent_mailboxes (
  local_part TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX agent_mailboxes_member ON agent_mailboxes(user_id, member_id) WHERE revoked_at IS NULL;
CREATE TABLE agent_mail (
  id TEXT PRIMARY KEY,
  local_part TEXT NOT NULL,
  user_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_name TEXT,
  subject TEXT,
  text TEXT NOT NULL,
  message_id TEXT,
  received_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX agent_mail_pending ON agent_mail(user_id, delivered_at, received_at);
CREATE INDEX agent_mail_box_day ON agent_mail(local_part, received_at);
