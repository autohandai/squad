# ADR-0183: Apple glass for Quick Chat

Date: 2026-11-06

## Context and evidence

The user asked for Apple's glass UI in the menu-bar chat. ADR-0182's first
implementation used the older AppKit Popover vibrancy material under a
90-percent opaque web surface. That was native translucency, not Liquid Glass.
This machine reports macOS 15.5 (`sw_vers`), while `NSGlassEffectView` is a
macOS 26 API. The existing dependencies, window-vibrancy 0.8.0 and
objc2-app-kit 0.3.2, already expose the native implementation.

Apple specifies that content belongs in `NSGlassEffectView.contentView`:
arbitrary sibling/subview placement does not guarantee the glass's legibility
treatment. Inspection of window-vibrancy's content helper showed that it moves
the view with `addSubview` when the glass's contentView is initially absent.

## Decision

Offer Apple glass and Solid in Settings → Quick Chat. Persist
`quickChatAppearance` as `glass` (default) or `solid`, independently of skin,
usage visibility and menu-bar mode.

On macOS 26+, use the existing window-vibrancy Liquid Glass implementation,
retain the current WKWebView during reparenting, and explicitly assign it as
the glass's contentView. Preserve the Tao root container and the WKWebView's
identity. Subsequent changes use the helper's restoration path. Do not replace
the window's content root or create a second chat/webview.

Gate construction with runtime class availability. Older macOS uses the
existing native Popover material. Solid clears native effects. All hierarchy
work runs through Tauri's AppKit-thread callback; a per-window material cache
prevents repeated insertion during status refresh. The cache resets when the
Quick Chat window is created. Enforce AppKit-thread entry and publish only after
`with_webview` returns: Wry holds its webview-ID mutex through the callback, and
`eval` acquires that same mutex. Calling `eval` inside the callback deadlocks.
The native layer publishes the actual material
as `data-quick-chat-material`; web appearance changes retain the conversation
and drafts. A 65-percent skin-colored surface lets native material show
through while keeping the app's chosen foreground readable. CSS does not
simulate Apple's blur or refraction.

## Validation

The idle-avatar regression first failed with `[]` instead of `["idle-eva"]`
and now passes. Native eligibility checks cover available idle/online members,
explicitly unavailable members with running sessions, invalid IDs, single mode
and disablement. Browser checks cover saved appearance, switching glass/Solid
without losing an unsent draft, and the notice for an unsupported older shell.
The settings route rejects unknown appearance values and retains the choice
across bridge restart. The existing 16 desktop/mobile Playwright scenarios
also passed with the expanded settings shape.

The full native unit suite passed 31 tests and the packaged preview passed
strict signature verification. The native inspector then stalled the preview
while traversing the Apple menu. A process sample showed AppKit waiting on
Recent Items shared-file-list IPC. That sample did not establish whether the
material path was safe: a later review of Tauri 2.11.6 / tauri-runtime-wry
2.11.4 found a separate definite self-deadlock in our initial `publish` call
inside `with_webview` (`with_webview` holds `window_id` through synchronous
main-thread dispatch; `eval_script` locks it again). Publication now happens
after the callback returns. A main-thread marker enforces the synchronous
callback contract. Unit/browser checks cannot execute this AppKit/Wry mutex
path, so it still requires a native interaction check. Cua refused
termination because launch ownership was not attested; manual closure was
requested. Native material pixels and avatar interaction therefore remain
pending. This host can exercise only the macOS 15 fallback, not the macOS 26
Liquid Glass pixels; compilation is not proof of either rendering outcome.

## Consequences

The older-OS fallback is intentional and explained in Settings. Real Liquid
Glass rendering still needs a macOS 26+ machine; updating Squad cannot add an
unavailable OS API. The native view still hosts the shared web conversation,
trading an all-AppKit chat for unchanged queues, attachments and drafts. Glass
is limited to the floating menu surface rather than spreading decorative blur
through ordinary app content. System accessibility preferences control native
material behavior.

## Sources

- [Apple: NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview).
- [Apple: Build an AppKit app with the new design](https://developer.apple.com/videos/play/wwdc2025/310/), Glass chapter, especially contentView ownership.
- Installed window-vibrancy 0.8.0 `src/macos/liquid_glass.rs` and objc2-app-kit 0.3.2 `src/generated/NSGlassEffectView.rs`.
