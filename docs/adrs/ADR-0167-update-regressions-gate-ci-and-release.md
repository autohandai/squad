# ADR-0167: Exercise update consent in both CI and release gates

Date: 2026-11-03. Status: Accepted.

## Context and evidence

The user reported repeated CI failures. GitHub inspection found the latest
main run [41571476517](https://github.com/autohandai/squad/actions/runs/41571476517)
green at `837ec2fe19e534aa384321d867d3386a01c5d05f`, including all four runtime
targets, desktop compilation, four release dry runs and manifest validation.
The latest release [41570800254](https://github.com/autohandai/squad/actions/runs/41570800254)
used older `1479b40c9322a861d213b8221b3e7e00f8d338a2` and failed at
“reopened chat retains file previews timed out”. Its job log was read directly
with `gh api repos/autohandai/squad/actions/jobs/125703073493/logs`; packaging
and publication did not run. Main subsequently changed queue merging and
reopened-chat deduplication and extended that regression (ADR-0163).

The old updater browser suite passed despite the stale completion receipt
bug: it tested availability and completion separately. An all-green historical
run is therefore insufficient evidence for the new requirement.

## Decision

Gate CI and release on the real update lifecycle, automatic-download policy,
and a dedicated Playwright scenario. Use isolated bridge state and a fixture
daemon with a different installed version. Verify that a previous completion
cannot hide availability, manual checks work with automatic checks off, saved
preferences survive reload, failures remain visible, the phone layout fits,
and installation occurs only after clicking Install. Installer endpoints are
mocked; release discovery and preference routes use the real bridge.

Retain traces/screenshots for failed Playwright cases. Do not hide failures
with retries or delete assertions to make CI green. Existing CDP coverage still
tests measured byte progress and lifecycle states.

## Consequences

- Adds browser runtime and a pinned Playwright development dependency. Uses
  Chrome already required by the existing rendered checks.
- A controlled switch changes only after its save completes. Playwright's
  synchronous `setChecked` initially rejected that valid behavior; the test
  now clicks and waits for the saved state, then verifies it through the API.
- These gates cannot prove a signed/notarized release or native replacement.
  A successful workflow at the final submitted commit is still required before
  claiming the new changes pass hosted CI. A passing run on old main is only
  baseline evidence, and an old failing release must not be called repaired
  merely because its source fix exists on main.
