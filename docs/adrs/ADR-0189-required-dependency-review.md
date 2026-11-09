# ADR-0189: Produce the required dependency review check

Date: 2026-11-09

## Context and evidence

The active main-branch ruleset requires two reviews and the GitHub Actions
checks Dependabot, Web checks and Dry-run release metadata. The effective
rules were read with `gh api repos/autohandai/squad/rules/branches/main`.
No workflow in the repository produced a check named Dependabot, leaving a
normal pull request unable to satisfy that required status.

## Decision

Add a pull-request job named Dependabot using GitHub's dependency review
action, pinned to the verified v5.0.0 commit. It reviews dependency changes
with the action's vulnerability defaults and reports its actual result.
Use read-only permissions and disable summary comments. Keep the branch's
review and status requirements in place.

## Consequences

The check now represents a dependency diff review, not a synthetic success
or a dependency-update bot's activity. It does not audit every unchanged
dependency or replace runtime/security testing. GitHub's dependency graph
service must be available; a service failure can hold a pull request. The
workflow's actual result is verified on the pull request, not inferred from
the local YAML.
