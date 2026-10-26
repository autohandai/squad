# First-install setup

See ADR-0148 and DESIGN.md. The bridge plug-in owns `onboarding.json` in the
Squad state directory; browser onboarding storage is a recoverable input cache.

| Endpoint | Contract |
| --- | --- |
| `GET /api/setup` | `new`, `preparing`, `completed` or `existing`; selected repository profiles and canonical coordinator when available. Does not create data. |
| `POST /api/setup/repositories` | `{ paths: string[] }` validates and deduplicates canonical Git roots, returns profiles and deterministic role recommendations. No model or state mutation. |
| `POST /api/setup/complete` | `{ paths: string[] }` revalidates and provisions one Chief of Staff on Autohand, saves #general, then saves a completion receipt. Concurrent/repeated calls return the same identity. A completed receipt does not recreate deleted data. |

`routeContext().provisionAgent(payload, workspace)` delegates to the existing
serialized member runtime provisioner. Provisioning failure leaves the saved
identity retryable; channel/member stores remain canonical. Existing team state
without a receipt is preserved as `existing`, not replaced with a new starter.
Browser hydration recovers canonical members into empty local storage while
honoring removed-member decisions and excluding `squad-designer` utility runs.

`FirstRun` requires repositories and existing account/runtime/provider readiness.
It saves the selected paths, displays inline recovery, and retains recommendations
after setup. Review links carry `role` and `workspace` into New member; Save member
is the explicit creation action. Role-scoped drafts do not overwrite another
unfinished member. Account sign-in and pinned-CLI setup keep their existing APIs.

Run `bun run check:onboarding`, `bun run check:onboarding:browser`,
`bun run check:onboarding:recovery`, `bun run check:runtime-source-staging` and
`bun run build`. The browser check uses an isolated fixture account and does not
execute a live provider. Staged-runtime and native/release proof are separate.
