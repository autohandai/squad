# ADR-0081: Include shared bridge modules in portable archives

Status: accepted

## Context and evidence

Desktop staging copies `src/lib`, which bridge routes import. Portable packaging
copied `server` and `dist` but omitted it. An extracted archive importing the
actual workflow route failed with `ERR_MODULE_NOT_FOUND` for `src/lib/workflows.js`
(`portable-shared-runtime-red.log`). Source imports and web builds cannot detect
this packaged omission.

## Decision and verification

Copy staged `src/lib` into the portable archive at its existing relative path;
require workflow/profile entry files before archiving. Extend the archive check
to import the actual extracted workflow route and all 16 profile definitions.
`node scripts/check-computer-use-portable.mjs` passes with existing checksum and
corrupt-input rejection coverage. Native engine/host/CLI bytes and signatures are
fixtures: this proves archive composition, not installation or publication.

`node scripts/check-workflow-recovery.mjs` drives the real bridge/disk through
three restarts: webhook payload and unapproved gate survive, approval exposes one
pending app dispatch, repeated approval is refused, and controlled completion
survives without becoming pending. Existing checks retain trigger, scheduler and
HTTP-step coverage. Correct README's omission claim and the integration note to
describe the implementation that already exists.

## Consequences and limits

Portable artifacts resolve shared modules by shipping the pure-module directory,
instead of maintaining a fragile import allowlist. Channel workflows already
have bridge scheduling/webhooks; saved member Automations remain explicit Run now
definitions. App-dispatched workflow steps require the app open. In-flight crash
resume is not proved or changed. There is no new scheduler, missed-tick replay,
exactly-once HTTP-effect guarantee, workflow-store redesign or native release.
