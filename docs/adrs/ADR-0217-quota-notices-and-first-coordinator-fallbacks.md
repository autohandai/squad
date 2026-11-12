# ADR-0217: Recognize CLI quota notices and initialize coordinator fallbacks

## Context and evidence

Release preflight reported that the bundled Autohand Code 0.9.9 was behind the
published 0.9.11 release. The verified macOS ARM64 0.9.11 asset downloaded and
passed the SDK startup check. A live first-run rehearsal then exposed two gaps.

The actual configured Autohand account had exhausted its monthly request quota.
The CLI returned a four-line quota/reset/upgrade notice as `message_end` with a
successful exit, without a typed error. `replyFailure` accepted any nonempty
text, and the walkthrough's length check initially reported the notice as a
successful first review. Its next assertion failed because no question card had
been produced. That first success claim was wrong: no model answered.

The first Chief of Staff was also constructed directly, without the shared
creation-time fallback initializer used by app and MCP member creation. It
therefore had no automatic alternative even though another engine was ready.
The new SDK-notice assertion and coordinator-routing assertion both failed on
the previous code before the fixes were applied.

The rehearsal itself still read unscoped browser storage and a pre-ownership
config path. Its shared fixture helper always substituted a fixture identity
endpoint, which rejects the real credential. These are test-harness assumptions,
not reasons to relax account ownership in production.

## Decision

Bundle CLI 0.9.11. Recognize its complete monthly-quota wrapper before accepting
reply text: the exact header, explanation, reset line and Autohand upgrade URL
must match. Raise the existing runtime failure so the router classifies quota
and switches immediately. With no configured fallback, return an error. Ordinary
answers mentioning quotas, prefixed quotations and fenced logs remain answers.

Initialize the new coordinator with `initialMemberExecution` and the connected
harness catalog, keeping its advertised Autohand primary. Save eligible ready
fallbacks and their configured model/reasoning defaults only at creation. Retry,
folder repair and existing coordinators retain saved routing, including an empty
fallback list chosen by the person. No engine is installed or signed in here.

The live rehearsal explicitly opts into real identity verification, reads setup
and runtime-permission receipts through the owned APIs, and rejects quota notices
as answers. Ordinary fixtures keep their isolated identity service. Future live
runs copy only Codex authentication and model/reasoning defaults into a private
temporary home, so rehearsals do not install plugins or write sessions in the
person's Codex home. The source credential and configuration are never modified.
Correct the release runbook's stale optional-macOS-signing and Node guidance to
match ADR-0173 and the current runtime/ruleset contracts.

## Verification and limits

- SDK error checks pass the recorded text-only notice and negative quotation
  cases. Existing partial-answer and context-overflow behavior remains covered.
- The real bridge fixture switches once from a text-only quota result to Codex,
  records quota as the reason, and returns an error without a fallback. Existing
  bidirectional routing, context/images, access, queues, assigned runs and goals
  checks pass separately. Fixtures do not establish provider availability.
- Onboarding state checks pass connected coordinator defaults and their existing
  failed/interrupted provisioning, identity, authored settings and replay cases.
- In the subsequent real-account browser rehearsal, the primary quota failure
  recovered through Codex (`gpt-6.1-sol`). The review used Squad MCP tools; a
  question was answered through the UI and the proposed team was created through
  its confirmation. Codex wrote the requested test file. This is partial live
  evidence: its approval surface differs from the Autohand-specific permission
  card expected by the older walkthrough. It does not establish that card,
  idle recovery, Reset, a packaged installer or all other harnesses.

## Consequences

This compatibility check is coupled to the pinned CLI's actual notice template;
future wording needs another fixture or, preferably, an upstream typed error.
Matching the entire wrapper deliberately leaves other unfamiliar text notices
untreated rather than broadly classifying normal answers as failures. Automatic
fallbacks remain limited to four ready connections and do not retrofit existing
members. A successful SDK start and partial live fallback are insufficient to
claim a completed stable-release rehearsal. Signing, notarization and mounted
installer proof still belong to the actual release workflow, and the installed
Squad app remains untouched during these checks.
