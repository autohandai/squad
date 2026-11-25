-- The computer's own name beside its relay route, for "Other computers in
-- your account" in Squad's Computers settings (ADR-0282). Empty until the
-- computer names itself after connecting.
ALTER TABLE mobile_relay_routes ADD COLUMN computer_name TEXT NOT NULL DEFAULT '';
