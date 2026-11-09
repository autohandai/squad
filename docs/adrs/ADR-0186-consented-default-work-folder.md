# ADR-0186: A default work folder created with consent

Date: 2026-11-09

## Context and evidence

The owner reported Git initialization failing when chat had no selected folder
or used the application's folder. The bridge's default candidates started
with the source directory, then broad Documents folders. The browser could
also silently choose the first scanned project. Neither choice establishes
where the person wants new work saved.

The owner selected `~/Documents/autohand-desktop/` and requested consent before
creating it. Git is optional and must not be initialized merely to start chat.

## Decision

Use that fixed Documents path as the fallback when it already exists and
resolves inside the user's home. Reading runtime readiness never creates it.
When it is absent, show a quiet inline choice in chat, New member, the blank-member entry and first-run setup: Create folder or Choose
another folder. Creation requires an explicit `consent: true` request; there
is no caller-controlled creation path. Resolve existing parents before mkdir
to reject an alias outside the user's home. Preserve existing files.

Reuse the normal saved member-folder selection after creation, retain the
draft, and remove the arbitrary source-directory/scanned-project fallbacks.
Folder creation and profiling do not initialize Git. Onboarding accepts ordinary accessible folders as well as existing Git repositories. Keep the historical `repositories` persistence/API field for compatibility, but describe the choice as work folders. Explicit Git repositories still resolve to their Git root; other folders retain their own physical root. Runtime instructions require the agent to ask before initializing Git unless the person already chose it.

## Validation and limits

The default-workspace bridge check first failed because runtime had no consent
metadata. It now verifies refusal without consent, no directory created by a
read, denial of an outside-home Documents alias, explicit creation, preserved
files and restart reuse. Rendered checks pass at 1440px in light mode and 380px
in dark mode, including the saved member workspace, draft retention and page
width. These checks use private fixture homes and do not create the person's
real Documents folder.

This does **not** prove the entire engine startup is read-only. Inspection of
the CLI startup checks found a separate empty-directory `git init` branch.
This branch affects normal terminal/direct-CLI startup; current CLI RPC mode routes before that check. An SDK process-spawn receipt alone is also too early to prove initialization, so its compatibility check must wait for a real state RPC. The terminal/direct-CLI behavior must be corrected and included in the bundled CLI before
the no-implicit-Git requirement is complete; merely suppressing startup with
`--bare` would also disable project instructions, hooks and other features.

A rendered New member check also exposed a draft-scope transition: once the default folder existed, reload mounted a different folder-scoped draft key and lost the visible role description. The form now saves the chosen workspace before closing the consent row, and recovers the matching unassigned draft when entering that new default-folder scope. Clearing a completed or cancelled draft removes only aliases with that same member identity.

## Consequences

The default is shared by members without a selected project, as requested;
members needing separate files should select their own folders. Creation
consent is tied to a concrete path, not permission to create arbitrary folders.
Unavailable or out-of-home paths require another choice. This is not a new
permission to initialize Git, and it does not replace the remaining engine
startup fix.
