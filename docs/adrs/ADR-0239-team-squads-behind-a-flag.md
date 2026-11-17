# ADR-0239: team Squads sit behind the `squad_team_squads` flag

Status: accepted. Amends ADR-0193 (account and team owned Squads), ADR-0234
(switching lives in Settings › Squads) and ADR-0237 (team access survives
account-service outages).

## Context and evidence

Team Squads (a Squad owned by an Autohand team, chosen in Settings › Squads)
shipped to everyone who belongs to a team. On 2026-11-17 the owner's own
switch to "Igor Costa's Team" left them stuck (ADR-0237), and the feature is
not ready to be on for every team member. The owner asked for it to be
switchable per person without a release, using Autohand's existing flags.

What the flag system could and could not do that day:

- Flags live in `code-db` (`feature_flags`, `feature_flag_environments`) and
  the website admin already edits client types, platforms and a list of
  people (`actor_targeting_mode = 'specific'`, `actor_emails_json`).
- `GET https://api.autohand.ai/v1/feature-flags/evaluate` ignored the list of
  people entirely. A read-only query of production found four `specific`
  flags, one of them (`autohand_inference`) on for the CLI, which never sends
  a credential. The API now applies the list when the request carries an
  Autohand credential and keeps the CLI's old answers when it does not
  (api ADR-0002, deployed as version `91602d33`).
- After the migration (dark-web-cli `102_add_squad_team_squads_flag.sql`,
  applied to production) the endpoint answered
  `{"key":"squad_team_squads","enabled":false,"reason":"disabled"}` to
  `?clientType=squad&platform=macos` without a token.

## Decision

The bridge asks for `squad_team_squads` with the signed-in person's bearer
token (`clientType=squad`, `platform=macos|windows|linux`, the app version as
`cliVersion`) when an account is verified and again when the answer's
`ttlSeconds` runs out (300 today, clamped to 1–60 minutes; 30 seconds after a
failure). The answer is held per credential fingerprint, in memory and in
`ownership-flags.json` in the state directory for a day. The file holds the
fingerprint, the answer and when it was given; never the token or email.

- **Off:** the owners list is the Personal Squad alone, selecting a team is
  refused (`403 team_squads_off`), and a person whose current Squad is a team
  is moved to their Personal Squad by the same verified reopen used for any
  ownership change. Settings › Squads lists only the Personal Squad and says
  nothing about teams; the account menu offers no Switch Squad….
- **On:** behaviour is as before: teams are listed, full teams are writable,
  lapsed teams are a read-only archive (ADR-0237).
- Turning the flag on lists teams in place; nobody is switched. The saved
  team choice is kept while the flag is off, so the next start after the flag
  returns opens that team again.
- `AUTOHAND_SQUAD_FLAG_TEAM_SQUADS=1|0` fixes the answer and skips the
  service. It is for checks and development only.

Why off when there is no answer: the flag exists to keep an unready feature
away from people. If an outage turned it on, the people it protects would
meet the same broken switch the flag exists to hide. The saved answer covers
the common case, a restart during a short outage, without that risk.

Checked with `node scripts/check-squad-ownership.mjs` (account without the
flag sees only the Personal Squad and is refused a team; the flag service
going down keeps the team open; the flag turning off moves the team Squad to
the Personal Squad and fences the old context; turning it on lists the team
without a switch; a fresh install with the service down is off; a saved
answer survives a restart while it is down; the env override never calls the
service) and `node scripts/check-owner-switcher-browser.mjs` (new
`team-flag-off` scenario: one row, no team sentence, no Switch Squad…; the
team row appears live when the flag turns on and goes when it turns off).

## Consequences

- The owner must add their own email to the flag in the website admin and
  turn it on in production, or they lose team Squads too. Until then every
  Squad, including the owner's, opens on the Personal Squad.
- Team data is not deleted or moved when the flag is off; it is unreachable
  from the app until the flag is on. Backups of a team Squad cannot be taken
  from Squad while it is off.
- A fresh install, or a new sign-in, that cannot reach the flag service
  opens the Personal Squad even for a listed person, until the service
  answers (retried every 30 seconds).
- A listed person who is signed out of Autohand or whose credential is
  rejected gets `actor_required`, so team Squads are off for them; this is the
  same as having no team access at all.
- The check fixtures that build their own identity without a flag
  (`check-owned-remote`, `check-owned-transactions`, `check-owned-backups-browser`,
  `check-owned-lifecycle`) keep team Squads on; the broker treats an identity
  without a gate as "on" so those checks keep testing what they did.
- Rollout percentage and plan targeting are not used. "Paid" stays defined by
  the team's access mode from `/v1/accounts`.
