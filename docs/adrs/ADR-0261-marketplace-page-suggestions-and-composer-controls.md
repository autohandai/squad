# ADR-0261: The Marketplace page, suggestions where members and teams start, and composer controls

Status: Accepted
Date: 2026-11-19

## Context

The owner, 19 November 2026, with screenshots:

- "marketplace shouldn't be a modal window, should be here … not as inbox but
  like inbox with more space to it." The marketplace was a dialog over
  whatever page was showing (ADR-0246), and in the installed app it said
  "The marketplace could not be reached. Check your connection and retry."
- New message › New member "doesn't show anything or suggest anything from
  the marketplace", and New team "doesn't show teams from the marketplace or
  custom one".
- In a chat with a new member there was no way to cancel it: no `/delete`, no
  keyboard shortcut.
- "Never mention grok bot in any template … the import feature you leave as
  it is, but when created never mention it."
- The send button (a paper plane in a grey circle) is "outdated"; the stop
  state (a filled circle with a square) "is ok". The mic "should be next to
  send".
- Dictation should be Autohand Voice's own Parakeet, from the Autohand Voice
  project (autohandai/voice).

What the "could not be reached" message hid: production `squad.autohand.ai`
answers the public marketplace routes with 401 `sign_in_required`, because
the marketplace Worker is not deployed yet (rollout awaiting approval). The
bridge turned that into the offline sentence.

## Decision

1. **A page, not a dialog.** `/marketplace` renders the same marketplace
   (Explore, From a link, Published, the listing view) in the main column
   with Inbox's header and rhythm and a wider 6xl column. Every entry point
   (account menu, ⌘K, the directory's overflow, links, suggestions) goes
   there; `/marketplace/agents/<id>` and `/teams/<id>` open that listing on
   the page. Add returns to the list instead of closing. A phone's add
   (ADR-0256) opens on the page; backing out of it or leaving the page
   declines it, as closing the dialog did.
2. **Say why it is empty.** An upstream 401/404 (the marketplace is not
   deployed) becomes `marketplace_not_live`: "The Squad marketplace isn't open
   yet. Your connection is fine; it opens when the marketplace goes live." A
   real network failure keeps the connection message. Still never an account
   code (check-marketplace-account-codes).
3. **Suggestions where members and teams start.** New member shows "Featured
   in the marketplace", then up to four agents matching its role and purpose;
   New team shows ready-made teams, then teams matching the objective, plus
   "Start from a template or your own team file…" (the existing Templates
   dialog: built-ins, import, a folder). Choosing one opens it on the
   Marketplace page. Nothing shows when the marketplace is unreachable.
4. **Remove a member from their chat.** `/delete` in the composer, or ⌘⇧⌫ on
   macOS (Ctrl+Shift+Backspace or Delete elsewhere), opens the same
   confirmation as the member menu's Remove.
5. **Imported templates never name their source.** `grokTemplate` no longer
   writes "Imported from the Grok Bot template …", the role "Grok Bot
   template" or the fallback name "Grok Bot"; pasted instructions are kept
   exactly as pasted. The import itself (From a link, its preview, the
   receipt that powers Update available) is unchanged.
6. **One send button.** `SendButton`: a filled foreground circle with an
   up-arrow when there is something to send, the same circle quiet when
   there is not, the stop square while a reply runs. Main window and Quick
   Chat use it; the channel composer already used an up-arrow. The mic sits
   directly beside it, its "Listening…" line before it.
7. **Dictation is Autohand Voice.** The `squad-voice` helper (ADR-0260) now
   depends on `AutohandVoiceCore` from autohandai/voice (public, pinned to
   b9ac297) and transcribes with its `LocalSpeechRecognizer` and
   `Transcript.finalText()`, instead of calling FluidAudio itself.

## Evidence

- The helper on Autohand Voice's recognizer, on `say`-made speech: "Remind me
  every weekday at 9am to post yesterday sign-ups in the growth channel."
  First run 18.1 s (Core ML compile), then 0.23 s; 22.6 MB, self-contained.
- `scripts/check-marketplace-account-codes.mjs`: a cloud 401 gives
  `marketplace_not_live` and the "isn't open yet" sentence.
- `scripts/check-marketplace.mjs`: an imported template contains no "grok"
  or "x.ai" anywhere, with or without pasted instructions.
- `check-marketplace-browser` and `check-marketplace-in-app-browser` drive the
  page: Explore, categories, search, a listing, Add returning to the list,
  links opening on `/marketplace`, a malformed link opening the page with no
  listing, the import page.

## Consequences

- The marketplace no longer floats over the page you were on; opening it
  navigates, and Back returns.
- Suggestions query the marketplace on every pause in typing (350 ms); with
  the marketplace not deployed they are simply absent, so New member and New
  team look as before until launch.
- ⌘⇧⌫ is taken in member chats; it only ever opens the confirmation.
- Squad's helper now builds Autohand Voice's package, which also resolves
  mlx-swift and llama.cpp's prebuilt framework (not linked into the helper).
  A change in Autohand Voice reaches Squad only when the pin moves.

## Addendum, 19 November 2026: New Squad member

The owner's screenshot of New Squad member showed no marketplace at all: the
suggestions had gone to New message › New member and New team only. The main
member page now has the same "Featured in the marketplace" / "From the
marketplace" list (driven by "Describe the role"), above the ready-made roles.
Because this page is where people most expect it, while the marketplace is not
live it says "Agents from the marketplace show here once it opens." with a
link to the Marketplace page, instead of showing nothing.
