# ADR-0273: A restricted member is not a dry run

Status: accepted, 2026-11-23

## Context

Daniel, a restricted member on the Autohand engine, was asked "can you learn
all the things we do for Noda autohand.ai/noda/". The run ended with "The model
kept announcing steps instead of executing them through 2 tool-free recoveries",
and its one tool call (`tool_search`) failed with "Dry-run mode: skipped
mutation".

What was found:
- `server/harness/fallback-router.mjs` turned an Autohand member with
  `permissionMode: "restricted"` into `access: "plan"`, and plan on Autohand
  into `dryRun: true`, so the CLI was started with `--dry-run`. The router runs
  only for members with engine fallbacks, so restricted members without
  fallbacks were unaffected. Daniel's profile has both.
- In dry-run mode the bundled CLI (0.9.11) refuses every tool outside
  `find_grep, fff_find, find, search, search_with_context, semantic_search,
  glob, plan, inspect_work_map` (read from the binary's strings). That covers
  `read_file`, `tool_search`, web reads and connector calls, so a restricted
  member could not read anything, and the model narrated instead.
- ADR-0114 (second revision) already said the permission level no longer
  forces a read-only mode. The router, added later with fallbacks (0d92699,
  30 Oct), kept the older rule.

## Decision

The router uses only explicit access: the request's, then the engine's.
`restricted` stays what it is everywhere else, Autohand's `--restricted`
approvals, which ask before risky actions instead of refusing reads.
An explicit plan choice still makes an Autohand fallback a dry run.

## Evidence

- `scripts/check-model-routing.mjs` now asserts that a restricted Autohand
  member's turn has `dryRun: false` and no derived access. It fails on the old
  router ("a restricted member is not turned into a dry run") and passes on the
  new one, together with the existing read-only fallback case.

## Consequences

- An explicit plan member on Autohand still cannot read files or the web,
  because of the CLI's dry-run allowlist. That is a CLI defect to report
  upstream (`autohandai/code-cli`), not fixed here.
- Restricted members with fallbacks may now take actions after approval, as
  restricted members without fallbacks always could.
