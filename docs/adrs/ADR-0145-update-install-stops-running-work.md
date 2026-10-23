# ADR-0145: Installing an update stops running work

Date: 2026-10-23. Status: Accepted.

## Context

ADR-0130 refused installation while any chat, observation, session, run,
goal or queued follow-up was active. A team that is always working, or has
queued follow-ups, never becomes idle, so the 0.1.9 update showed "Finish
active agent work and queued follow-ups before installing" and could not be
installed. The person asked for the update to come first.

## Decision

Install stops work instead of waiting for it. After the saved installer
passes its checksum, the bridge takes the install lock (new chats and runs
are refused from that moment), holds the daemon admission pause for an
automatic install, then calls `stopManagedRuns`: running goals are paused
with a reason so they can be resumed, chats are aborted, SDK sessions and
live runs are stopped, and the project observer stops. Queued work is not
deleted; with admission paused it waits for the restarted service.

The only refusal left is a second install while one is in progress. A
tampered or missing installer still fails before any work is stopped.

## Consequences

- Clicking Install always installs. The Updates panel says that running
  work stops first and paused goals can be resumed afterwards.
- Work in progress is interrupted, not finished. Goals keep their state as
  paused; chats and runs record the stop reason.
- If installation fails after work was stopped, the work stays stopped and
  the person can resume it or retry the install.
- `check-update-flow.mjs` proves the second-install guard and that a
  tampered installer never reaches the stop step. The stop itself reuses the
  existing service-stop path and was not exercised against live work here.
