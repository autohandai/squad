# First-install setup

See ADR-0148 and DESIGN.md. The bridge plug-in owns `onboarding.json` in the
Squad state directory; browser onboarding storage is a recoverable input cache.

| Endpoint | Contract |
| --- | --- |
| `GET /api/setup` | `new`, `preparing`, `completed` or `existing`; selected repository profiles and canonical coordinator when available. Does not create data. |
| `POST /api/setup/repositories` | `{ paths: string[] }` validates ordinary work folders and deduplicates canonical Git roots, returns profiles and deterministic role recommendations. No model or state mutation. |
| `POST /api/setup/complete` | `{ paths: string[] }` revalidates and provisions one Chief of Staff on Autohand, saves #general, then saves a completion receipt. Concurrent/repeated calls return the same identity. A completed receipt does not recreate deleted data. |

`routeContext().provisionAgent(payload, workspace)` delegates to the existing
serialized member runtime provisioner. Provisioning failure leaves the saved
identity retryable; channel/member stores remain canonical. Existing team state
without a receipt is preserved as `existing`, not replaced with a new starter.
Browser hydration recovers canonical members into empty local storage while
honoring removed-member decisions and excluding `squad-designer` utility runs.

`FirstRun` requires a work folder and existing account/runtime/provider readiness for initial creation. Git is optional.
It saves the selected paths, displays inline recovery, and retains recommendations
after setup. Review links carry `role` and `workspace` into New member; Save member
is the explicit creation action. Role-scoped drafts do not overwrite another
unfinished member. Account sign-in and pinned-CLI setup keep their existing APIs.

Run `bun run check:onboarding`, `bun run check:setup-guide:browser`,
`bun run check:default-workspace`, `bun run check:default-workspace:browser`,
`bun run check:runtime-source-staging` and `bun run build`. The browser check uses an isolated fixture account and does not
execute a live provider. Staged-runtime and native/release proof are separate.

## Run the setup guide again

Settings → Setup → Run the setup guide reopens the editable work-folder flow.
An existing Squad chooses a saved local member (the original coordinator when
still present, or its sole local member). Otherwise the person selects one.
Missing paths remain removable; choosing no folders offers the existing
`~/Documents/autohand-desktop/` Create folder / Choose another folder consent.
Neither analysis nor creation initializes Git.

Save work folders replaces that member's primary and explicit additional-folder
list through the same revision-checked operation as MCP contract 2.4. It does
not call first-install completion, provision a new Chief of Staff, recreate
#general, or restore removed members. Roles, harnesses/fallbacks, memories,
skills, permissions and conversations are preserved. A member on another
computer must be configured on that execution computer.

The first-install completion receipt stays historical and idempotent. Review
reads current member projects rather than treating its old repository list as
an immutable form. Metadata-only folder repair can be saved without a ready
model provider/runtime; preparing a missing runtime during review is an explicit
action. Refresh members reloads revisions while retaining the folder draft.
