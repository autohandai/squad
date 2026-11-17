# ADR-0230: onboarding continues to the menu bar and an iPhone

Status: accepted. Builds on ADR-0228 (phone routes) and the Quick Chat
preferences in Settings › Quick Chat.

## Context and evidence

The owner's feedback: the "Setup guide" should be called onboarding; it never
asks how Squad should appear in the menu bar, and it never invites pairing a
phone. Reading the code before this change:

- `src/components/onboarding/FirstRun.jsx` was one screen: readiness lines,
  work folders, suggestions and **Start with Chief of Staff**. Finishing
  called `startFirstConversation`, which navigated straight to `#general`;
  the review variant's **Save work folders** navigated to `/squad`.
- The menu bar choice (`quickChatMenuBarMode`: `single` or `active-agents`)
  existed only in Settings › Quick Chat, saved by an inline function in
  `QuickChatPreferences.jsx` (bridge PUT, local cache, a
  `squad:quick-chat-settings` event and the `squad_refresh_quick_chat` native
  call).
- Phone pairing existed only in Settings › Computers (`/api/mobile/*`, QR,
  six-digit approval). Nothing pointed a new person at it.

## Decision

1. **Onboarding is a short guided flow** on `/welcome`: Work folders, then
   Menu bar (macOS desktop app only), then iPhone. Progress is one quiet line,
   "Step 2 of 3 · Menu bar", with thin segments. Each step's heading takes
   focus when it arrives, so VoiceOver announces where the person is. Back
   exists between the new steps, and from Menu bar to Work folders only when
   the squad was not created in this run (going back to a creation form that
   has already run would only confuse). The route, the `setup` Settings id and
   the onboarding state keep their names; only the visible copy changed to
   "Onboarding" and "Run onboarding again".
2. **Finishing a step no longer navigates.** `startFirstConversation` and
   `saveSetupWorkspaces` save and return; `FirstRun` advances. The last step
   calls `finishOnboarding('channel' | 'squad')`: a squad created in this run
   still lands in `#general`, a reviewed one in the directory, as before.
3. **Menu bar step saves through the exact Settings path.** That inline save
   became `saveQuickChatSettings(api, patch)`, exported from
   `QuickChatPreferences.jsx` and used by both. Choosing a style while Quick
   Chat is off also turns it on, and says so. The step shows only when
   `menuBarAvailableHere()` is true: a Tauri bridge on a Mac platform.
4. **The preview is one stage, not two cards.** DESIGN.md says choices are
   divider rows with a check, never boxes, so the two options are a native
   radio list and a single illustration above them follows the hovered or
   selected option. It is CSS keyframes only (no new dependency; framer-motion
   is not installed): the pointer reaches the Squad item, the item takes the
   pressed highlight, Quick Chat drops from it with the members' portraits and
   presence dots, and the selected member's reply writes itself in. Under
   reduced motion it is one still frame with Quick Chat open. The Squad item
   masks `src-tauri/icons/tray-template.png`, the same template image the
   native tray loads, so the preview tints like a real status item.
5. **iPhone step reuses the Computers flow.** `PairingCode` is exported from
   `ComputersSettings.jsx`; the step calls the same `/api/mobile/status`,
   `/config`, `/pair`, `/approve` and `/reject`. If phone connections are off,
   **Pair an iPhone** turns them on with the routes already saved, waits for a
   route, then shows the QR, three numbered steps and a waiting line. The
   six-digit match and **Approve connection** appear inline. **Not now**
   records `phonePairing: "skipped"` in the onboarding state
   (`normalizeOnboardingState` now keeps that field; an approval records
   `"paired"`). Every state says it can be done later in Settings › Computers.
6. **Onboarding hides the sidebar for everyone**, not only for unfinished
   setups, so the flow reads as one focused column whether it is the first run
   or a rerun. Returning people get **Open your squad** in the header as the
   way out.

## What was learnt

- The first screenshot run showed the menu bar step with no popover and the
  content half faded. The Playwright config sets `reducedMotion: 'reduce'`,
  but the spec's `page.emulateMedia({ colorScheme })` call was followed by
  animated frames; passing `reducedMotion: 'reduce'` explicitly in the same
  call gave the intended still frame. The spec now does that and waits 350ms
  before each capture.
- The first desktop run failed "Step 1 of 2" where 3 was expected: the
  Playwright "Desktop Chrome" device reports a Windows platform, so the macOS
  detection correctly said no. The spec stubs a Mac platform with the Tauri
  bridge rather than loosening the detection.
- The coloured brand mark at 15px was an unreadable grey blot in the menu bar
  preview. The native tray template reads at 16px, hence decision 4's mask.

## Verification (run on 2026-11-16)

- `bun run build`: built.
- `bun run check:jsx`: passed for 257 files.
- `bun run check:render`: the first run timed out waiting for mount while
  other agents' work loaded the machine; the rerun passed.
- `bun run check:onboarding`: passed.
- `bun run check:setup-guide:browser` (now includes
  `e2e/onboarding-steps.spec.mjs`): 13 passed across desktop and compact. The
  new spec walks Settings › Onboarding › Run onboarding again, Next, the menu
  bar choice (asserts the bridge stored `active-agents` and the native refresh
  was invoked), Back, the iPhone step, a real QR offer, a simulated phone
  claim over the real protocol, approval, and `phonePairing: "paired"`; and on
  the web, no menu bar step and `phonePairing: "skipped"` with phone
  connections left off.
- `bun run check:quick-chat-settings`, `check:quick-chat:browser` and
  `check:mobile:browser` (2 passed): the shared save path and exported
  `PairingCode` still behave in Settings.
- `bun run check:onboarding:browser` and `scripts/check-fresh-install.mjs`
  fail, and fail the same way on a clean `HEAD` worktree: the signed-out
  `/api/runtime` read has no `account`, the seeded existing squad uses
  unprefixed storage keys, and fresh install still expects a plain folder to
  be refused and an "Add repository" button. Their onboarding assertions were
  updated to click **Not now** after **Start with Chief of Staff**, but they
  could not prove it here.

## Consequences

- **Save work folders** no longer jumps to `/squad`; it moves to the next
  step. Scripts that relied on the old landing were updated.
- The new-install path (Start with Chief of Staff, then Menu bar, then
  iPhone) is covered by code and the updated live scripts, but no browser run
  here proved it, because the fresh-install check was already broken.
- Resuming mid-flow works only on `/welcome` (from `lastStep`). Someone who
  quits during the Menu bar step and reopens at `/` lands in their squad and
  skips the rest; Settings › Onboarding brings them back from the start.
- Turning phone connections on from onboarding uses the saved routes. Where
  the relay identity is missing, the bridge refuses, and the step shows that
  error and points to Settings › Computers rather than silently dropping the
  relay (DESIGN.md: never change a route silently).
- With fewer than three local members, the preview pads with bird portraits
  that are not members. It is an illustration and is hidden from assistive
  technology, but it is not the person's real roster.
- The preview draws the static template, not ADR-0229's in-progress menu bar
  art or usage bars; when that lands, the preview may need to follow it.
- Windows and Linux desktop builds skip the menu bar step, because the
  detection asks for a Mac platform.
- There is no App Store link; the copy says "Open Squad on your iPhone".

## Addendum (2026-11-16): pairing from the sidebar

The owner asked why the sidebar's workspace menu ("Local ⌄", which already
offers Connect a relay…) had no way to pair a phone. It now has Pair iPhone…,
which opens `PairPhoneDialog`: the same `PhoneStep` in a dialog variant
(smaller heading, Close and Done instead of Not now and Open your squad), so
there is one pairing flow, not three. Verified with
`node scripts/check-pair-phone-menu-browser.mjs` (menu item, dialog, a live QR
offer from the real bridge, Close). The check moves the bridge's phone port to
a free one first, because an installed Squad already hosting a phone holds
29323; with that collision the dialog shows the raw `EADDRINUSE` error, which
is left as is for now.

## Addendum (2026-11-17): which phones are paired, and are they reaching me

The pairing dialog said only "Already paired: iPhone, iPhone." — two identical
names (iOS gives apps the model name only) and no sign of whether either phone
was working. The phone host now remembers, in memory, when each paired phone
last made a verified request and whether it came over the local network or
the relay (`lastSeenAt`, `lastSeenVia` in `/api/mobile/status`; not persisted,
so it reads "Not seen since Squad started" after a restart until the phone
next connects). `PairedPhones` lists them newest first with "Active now on
this Wi-Fi" / "Last seen 2 h ago from anywhere", the pairing date to tell
identical names apart, and Disconnect, in both the pairing dialog and
Settings › Computers. Verified by `bun run check:mobile` (new last-seen and
relay assertions), `check:mobile:browser`, `check:setup-guide:browser` and
`scripts/check-pair-phone-menu-browser.mjs`.
