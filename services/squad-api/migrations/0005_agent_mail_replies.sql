-- Agent email replies and one address change (Squad ADR-0267).
-- A mailbox records the address it replaced, so a member changes it once.
ALTER TABLE agent_mailboxes ADD COLUMN renamed_from TEXT;
-- A received email records the one reply sent to it.
ALTER TABLE agent_mail ADD COLUMN replied_at TEXT;
ALTER TABLE agent_mail ADD COLUMN reply_id TEXT;
CREATE INDEX agent_mail_replies_day ON agent_mail(user_id, replied_at);
