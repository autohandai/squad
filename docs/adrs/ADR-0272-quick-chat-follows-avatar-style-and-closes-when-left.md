# ADR-0272: Quick Chat and the menu bar follow the avatar style; Quick Chat closes when left

Status: accepted, 2026-11-23

## Context

"change the avatars on squad desktop doesn't reflect the quick chat window and
also the [menu bar], please fix that. another behaviour i found hard is when I
lose focus on the quick chat clicking somewhere on the OS the window should
close automatically after 2s".

What the code did:
- The avatar style (ADR-0240, ADR-0271) was saved per account in
  `ownedLocalStorage` and read once when a window loaded. Theme, skin and
  layout are device keys that every window re-reads on `storage`, `focus` and
  `squad:popup-shown`; the avatar style was in none of those paths. The Quick
  Chat panel stays mounted while hidden, so it kept the style it started with.
- The menu bar draws portraits natively (`quick_chat::member_icon_map`) from
  each member's stored avatar path, `/avatars/birds/<bird>.webp`. It never knew
  a style existed.
- Quick Chat hid itself 150 ms after `WindowEvent::Focused(false)`. The owner's
  screenshot shows it still open over the main window after clicking away, and
  the code already notes that the always-on-top panel does not reliably deliver
  focus events. I could not reproduce the click from here (macOS refused Apple
  Events to System Events), so the cause of the missing event is not confirmed.

## Decision

- **The avatar style is a device preference**, like the skin
  (`DEVICE_KEYS` in `owned-storage.js`). Every window re-reads it with the rest
  of the shared appearance, so Quick Chat changes as soon as it is shown or the
  key changes. The account-scoped values from before (key `"undefined"`, and
  `autohandSquad.v1.avatarStyle` under the owner prefix) are read once.
- **The bridge's system settings carry `avatarStyle`** (flat, 3d or clay;
  anything else is refused with 400). The main window saves it whenever it
  changes, with a few retries at launch, and asks the native shell to refresh
  the menu bar.
- **The menu bar swaps in the painted file.** For 3D or Clay,
  `birds/<file>` becomes `birds-3d/<file>` or `clay/<file>` when that file is
  in the bundle, and the stored picture otherwise. The portrait cache key
  includes the style, so a change redraws.
- **Quick Chat closes 2 seconds after the person moves on.** While it is
  visible, a watcher checks every 250 ms. It counts as left when another app
  is active, or when another Squad window (the main window) has focus. When
  Squad is still active but no Squad window has focus (a file picker or
  permission sheet that Quick Chat opened), it stays open. A focus-loss event
  still starts the watcher, and each show starts a fresh one.

## Evidence

- `cargo test --release quick_chat`: 13 passed, including the new
  `styled_avatar_maps_cast_birds_only` (`birds/kiwi.webp` in 3D maps to
  `birds-3d/kiwi.webp`; flat, unknown styles, other folders and `..` map to
  nothing).
- `check-quick-chat-settings`: `avatarStyle` defaults to flat, only a known
  style is stored, and `PUT { avatarStyle: "neon" }` answers 400.
  `check-automatic-updates` and `e2e/updates.spec.mjs` pin the new key.

## Consequences

- The menu bar follows only once the main window has saved the style, so
  there can be a short delay at launch.
- 2 seconds replaces 150 ms: a Quick Chat left by clicking elsewhere now
  lingers briefly instead of vanishing.
- A system prompt from another process (the microphone permission dialog)
  makes Squad inactive, so Quick Chat can close while it is showing. Not
  handled.
- The painted 3D and clay pictures exist for 26 birds so far. Other birds keep
  their flat portrait in the menu bar under those styles.
- The live behaviour in the installed app was not exercised by a test here;
  only the units and the bridge checks above were run.
