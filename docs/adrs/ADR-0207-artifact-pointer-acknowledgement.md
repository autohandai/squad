# ADR-0207: Wait for native pointer acknowledgement in artifact checks

Date: 2026-11-12
Status: Accepted

## Context and evidence

Main commit `507444614450c814bba044ddd07fa447a450c353` failed Web checks in
[CI run 43185999127](https://github.com/autohandai/squad/actions/runs/43185999127).
The artifact browser test reported a successful click on “Review findings”, but
the article remained “Three findings need review.” The other fifteen update
browser cases passed. The trace retained the sandbox and showed the expected
blocked bridge fetch, without an inline-handler exception.

Three unmodified desktop runs passed locally. Repeating the actual test with
Chromium CPU throttled sixfold reproduced the unchanged article twice before
remaining repeats were interrupted. Instrumenting document pointer events then
showed a complete artifact document with no pointer events and its body still
focused. Parent-side instrumentation identified the pointer target as the iframe
element, rather than its document. This establishes an input routing race; it
does not identify a particular Chromium implementation defect.

The initial diagnosis of entrance animation/file loading was insufficient.
Waiting for iframe load, removing the dialog translation, and explicitly setting
iframe pointer events did not establish a fix. An isolated iframe/body pointer
probe passed all eight cases both with and without an explicit override, so
generic pointer inheritance alone does not explain the integration failure.
Those production changes were removed.

## Decision

For desktop verification, move the native pointer to the embedded control and
poll its actual `:hover` state, repeating only pointer movement until the frame
acknowledges it. Then issue exactly one normal Playwright click and require the
article to change. On touch projects issue a native tap. Keep the sandbox,
parent/storage/IPC/bridge-denial assertions and subsequent Library/chat/knowledge/
export assertions. Do not force input, dispatch scripted clicks, add fixed
settling sleeps, retry clicks or retry whole tests.

Expose `ARTIFACT_CPU_THROTTLE` for the same public-path regression. Slow mode
extends the whole-test budget; startup waits for the actual connector to appear.
It does not extend or bypass the embedded interaction assertion.

## Consequences and verification

This changes the browser driver's input precondition, not the product UI. It
tests deliberate pointer movement followed by the first click, rather than
treating a successful protocol call as proof of child-document input. It does
not fix or claim to fix an upstream browser race at the instant a new frame
appears. A control that never acknowledges the pointer or never updates still
fails. Device keyboard/VoiceOver and native-WebKit acceptance remain separate.

All six cases passed: three consecutive desktop and three consecutive touch
cases with sixfold CPU throttling using:

```sh
ARTIFACT_CPU_THROTTLE=6 bunx playwright test \
  --config playwright.updates.config.mjs e2e/artifacts.spec.mjs --repeat-each 3
```

The full update suite and exact-head GitHub checks must be recorded before
merge. This is browser/fixture evidence, not live-provider,
published-update, iOS pairing or release-signing proof.
