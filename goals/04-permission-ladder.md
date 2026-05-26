# Goal 04: Permission Ladder

## Outcome

Make autonomy visual and configurable per agent and repository.

## Ladder

1. Chat only
2. Suggest commands
3. Run read-only
4. Edit files
5. Open PR
6. Auto-merge disabled

## Why This Matters

Users should understand what an agent can do before they delegate work. Trust increases when autonomy is explicit, bounded, and different per role.

## Scope

- Show a clear permission ladder on each agent profile.
- Allow different permissions per repository or workspace.
- Map ladder levels to concrete tool capabilities.
- Surface warnings before a run uses risky capabilities.
- Keep auto-merge explicitly disabled.

## Acceptance Criteria

- A user can set an agent to any ladder level for a selected workspace.
- The UI explains which tools become available at each level.
- Risky actions ask for approval or stay blocked according to the configured level.
- Mission Control shows permission warnings.
- Existing low-level permission controls remain consistent with the ladder.

## Evidence To Capture

- Screenshot of ladder states for two agents with different permissions.
- Example blocked destructive command.
- Example approval prompt for a tool above the current level.

## Dependencies

- Current permissions page
- Tool permission groups
- Local Autohand launch policy

## Decisions

- Ladder versus matrix: the ladder should summarize the detailed permission matrix, not replace it. Users get one clear autonomy level first, with a drill-down for exact tool permissions.
- Repo-specific storage: store permission overrides in local Squad/daemon state keyed by agent ID plus normalized workspace or repo identity. Avoid writing permission policy into the repo by default.
- Open PR readiness: "Open PR" requires GitHub connector readiness, an authenticated account, repo access, and an approval step unless the user has explicitly saved an automation policy that allows draft PR creation.
