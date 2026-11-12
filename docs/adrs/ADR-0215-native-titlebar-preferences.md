# ADR-0215: Honor macOS titlebar actions without doubling the gesture

## Context and evidence

ADR-0213 restores Tauri's built-in zoom permission. Its native preview enlarged
and restored correctly, but inspection of Tauri 2.11.6's `drag.js` and window
plugin showed that its internal command always toggles maximization. It never
reads the person's macOS titlebar preference. That closes the reported dead
strip but only part of the broader requested native behavior.

Apple's [Desktop & Dock guide](https://support.apple.com/en-gb/guide/mac-help/mchlp1119/mac)
distinguishes Fill, Zoom, Minimize and No Action. Fill occupies the area between
the menu bar and Dock. [NSWindow](https://developer.apple.com/documentation/appkit/nswindow)
provides `performZoom`, `performMiniaturize`, `screen`, `frame` and `setFrame`.
The installed typed AppKit bindings do not expose a `performFill` action; we do
not invent a private selector. Apple's guide does not specify the raw defaults
strings. The observed persistent `AppleActionOnDoubleClick` was absent and the
legacy minimize flag false; that does not establish the current Settings UI's
default choice.

## Decision

Inject one script only into the macOS main window. Capture the qualifying second
mousedown and mouseup before Tauri's bubble handler, preserve its composed-path
exclusions and cancel when the cursor moves. Leave ordinary dragging alone.
Intercept one trusted double-click, including No Action and native rejection,
so stock zoom cannot follow it. Buttons, editable/focusable content, roles,
disabled markers and bare-versus-deep regions retain their existing behavior.

Register one main-window command guarded by the exact current local bridge
origin. It accepts no renderer-supplied action, preference or target window.
Chrome still works before sign-in. On AppKit's main thread, read
`NSUserDefaults` freshly. Recognize Fill, Maximize/Zoom and Minimize; other
explicit values do nothing. If the modern value is absent, preserve legacy
miniaturization, otherwise use Zoom as our compatibility default.

Zoom and Minimize use native actions. Fill sets the native frame to its current
screen's visible area. Save the previous frame and restore it on the next Fill
only while the window and visible target still match; a move, resize or display
change invalidates the old restore point. Release the restore-state borrow
before AppKit can deliver resize callbacks. No pointer crosses an asynchronous
boundary. Other platforms retain Tauri's stock handler.

## Verification

- Native Rust tests cover explicit actions overriding the legacy flag, missing
  values, the compatibility default and an unknown future value.
- `bun run check:titlebar:browser` sends real browser mouse gestures through
  the injected script. It verifies one native command and no second bubble
  action, interactive controls and disabled/self-only regions, cancellation on
  movement, and refusal of untrusted synthetic events.
- An isolated, separately identified native preview was launched through Cua
  with temporary [Cocoa Argument-domain overrides](https://developer.apple.com/documentation/foundation/userdefaults), not persistent system preference writes.
  With Maximize, eligible trusted second-down/second-up events enlarged the
  window from 1280 by 841 to 1728 by 1021. With None on the clean bundle, the
  same gesture left its 1280 by 841 frame unchanged. With Minimize on the clean
  bundle, the existing window became off-screen while its process kept running.
  With Fill on the clean bundle, foreground double-clicks in the empty chat
  header changed the frame from `(224,124,1280,841)` to `(0,33,1728,1021)` and
  back to the exact prior frame. Background attempts and foreground clicks in
  the expected top strip did not establish that result; the verified native
  interaction was the empty header's deep drag region.
- Initial preview gestures were not valid negative results: the preview first
  served stale web assets or had not reached its usable page. A temporary
  diagnostic recorded only mouse-event metadata and confirmed a qualifying
  deep header path after the fresh production UI loaded. It was removed and
  the clean native bundle rebuilt before the None and Minimize checks. Cua's
  background coordinate delivery reached that header rather than the expected
  top strip, so those native checks prove an eligible chrome gesture, not every
  pixel of the overlay. Its AX walk was also intermittently unavailable;
  documented screenshot-only capture kept fresh window/pixel evidence.

## Consequences and limits

The user's explicit window preference can take effect without five separate
React handlers or global preference writes. AppKit failures do not silently
maximize against the person's preference. Fill deliberately uses visible-frame
geometry rather than undocumented OS tiling commands: system tiling margins and
an OS-created pre-existing restore history may differ. Missing preference means
our compatibility Zoom default, not a claim about every macOS release's default.
Preview verification is separate from installed-app and notarized-release proof.
