# ADR-0227: Show the Squad mark during ownership startup

## Context

The reported startup screen showed “Autohand Squad” and “Verifying your
Squad…” without its logo. `OwnershipBootstrap` rendered only a heading and
status line while the owned app was not yet mounted. Sign-in and About already
used the public transparent light/dark Squad marks.

## Decision

Use those same assets beside the existing startup heading, at a fixed 48-pixel
size. The shared verification/loading/error branch keeps the mark visible
through its status changes. Treat it as decorative because the adjacent heading
already names the product. Match the active surface: use the white mark by
default and switch to the dark mark under the existing `.light` class.

The initial implementation reused sign-in's `dark:` visibility pattern. Source
inspection showed that this was insufficient here: `styles.css` starts with
dark root tokens, while App applies its theme class only after ownership is
ready. Requiring `.dark` would show the dark mark on the dark startup surface.
The corrected visibility follows the light-class override, including startup
with no theme class at all.

Keep this markup independent of App's private BrandMark function. Importing the
full owned app back into its bootstrap wrapper would introduce a dependency
cycle for a static image. A broader brand-component refactor is unnecessary for
this correction and is deliberately deferred.

## Consequences and verification

Startup gains the product identity without a new panel, animation, network
request to an account service, or change to verification and Retry behavior.
The two static image variants follow the existing sign-in pattern; their
dimensions reserve space before decoding. This does not diagnose a slow or
failed account verification.

Verification uses the production bundle's startup state in light and dark mode,
plus the existing JSX/build and ownership checks. Screenshots and exact command
results are recorded with the PR; image presence alone is not proof of account
verification or an installed-app upgrade.
