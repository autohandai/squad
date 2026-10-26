# ADR-0149: Package runtime source without working state

Date: 2026-10-27
Status: Accepted

## Context and evidence

The fresh-install report also required an audit of build-machine data. Desktop
staging copied all of `server/`, `src/lib/` and `relay/` recursively. The inspected
trees contained code and intended catalogs; no copied operator preferences were
established by that audit. Nevertheless the recursive copy would also include
an untracked state JSON, `.env`, cache or symlink later placed there.

## Decision

Stage first-party runtime modules by source kind: server/relay `.mjs`, shared
library `.js`, plus the explicit bundled ACP registry and team-template JSON
catalogs. Exclude hidden paths, generated/dependency directories and other data
files; refuse symlinks. Keep the existing separately staged frontend build,
SDK packages, verified CLI and native helper pipelines. Team catalog JSON is an
enumerated list of shipped templates; an arbitrary personal team file in that
folder is excluded too.

`node scripts/check-runtime-source-staging.mjs` injects channel history, member
snapshots, config, environment credentials, hidden memory and dependencies into
a disposable source tree and asserts that only code/catalog files are copied.
It also proves a source symlink is refused. The actual staged runtime audit
passed for 221 first-party code/catalog files, with no other data files in
`server/`, `src/lib/` or `relay/`, and the staged frontend matched the current
build. The full clean-install browser check also passed against that runtime.
This is not proof of a published/notarized artifact or a scan of all SDK/binary
contents for secrets.

## Consequences

New legitimate runtime data types need an explicit staging rule rather than
silently joining a recursive copy. This adds maintenance but makes ownership
reviewable. Code and intended example team catalogs still ship; catalog presence
does not authorize importing a team on first run. This does not scan arbitrary
code for secrets or replace the existing SDK/binary verification pipeline.
