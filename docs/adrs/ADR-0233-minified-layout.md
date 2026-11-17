# ADR-0233: a Minified layout, chosen independently of the skin

Status: accepted. Supersedes the layout half of the Grut skin (DESIGN.md,
Settings) and extends onboarding (ADR-0230).

## Context and evidence

The owner showed a competitor's chat app and asked for its job, not its look:
"a calm, small, chat-first Squad where my teammates are one click away". A
narrow column with the few most important people as large faces at the top,
one list of conversations with a one-line preview, the person's name at the
bottom; on the right one conversation with a slim centred header and bubbles.

What the code did before this change:

- The only way to get a conversation list was the **Grut skin**.
  `src/lib/skins.js` gave every skin a `layout` field, defaulting to
  `'workspace'`, and Grut alone set `layout: 'conversations'`. `SidebarContent`
  in `App.jsx` passed `conversationLayout={skin.layout === "conversations"}` to
  `WorkspaceSidebar`, which already built the unified list (members, groups and
  channels with `conversationPreview()` text and times, pinned first in pin
  order, then newest recorded message).
- The bubbles were CSS keyed to the skin id: eleven
  `html[data-skin="grut"] .app-main …` rules in `src/styles.css` hid the reply
  avatar column, put the muted surface behind `.chat-agent-answer` and inverted
  `.chat-user-bubble` with local tokens for contrast.
- So choosing Grut's colours forced its layout, and nobody could have the list
  with Paper's portraits or Blueprint's type. Grut's blob faces were also the
  only faces that layout had ever been seen with.
- Skin, theme and locale are device preferences in
  `src/lib/owned-storage.js` (`DEVICE_KEYS`), written unprefixed so the sign-in
  gate and Quick Chat can read them before an owner is known.

## Decision

1. **Layout is its own choice**: `full` or `minified`, in
   `src/lib/layouts.js`, stored as the device preference
   `autohandSquad.v1.layout` beside skin and theme (added to `DEVICE_KEYS`).
   `App.jsx` reads it, writes it at once on change (`changeLayout`), mirrors it
   to `html[data-layout]` and provides it through a `LayoutContext` that only
   the main window's tree receives. A storage event or window focus re-reads it
   like the skin, so a second main window follows.
2. **Skins no longer carry a layout.** The `layout` field is gone from
   `skins.js`; Grut's description now names what it still is (cool greys, a
   blue accent, round corners, blob faces). `check-skins.mjs` asserts no skin
   declares a layout and that no `data-skin="grut"` rule styles the bubbles.
3. **Grut users get Minified once.** `resolveLayoutId(stored, skin)` returns the
   stored layout when there is one, otherwise `minified` for a stored Grut skin
   and `full` for everything else. The first load writes the result, so the
   migration happens exactly once; choosing Full afterwards sticks even though
   the skin is still Grut (covered by the "Grut user gets Minified once" test).
4. **Minified reuses the Grut machinery** rather than re-implementing it. The
   same `WorkspaceSidebar` branch is driven by `layout === "minified"`; the
   eleven bubble rules moved from `data-skin="grut"` to `data-layout="minified"`
   with neutral token names (`--bubble-surface`, `--bubble-ink`) and a bubble
   radius of `--radius + 6px`, so Blueprint stays crisp and Grut stays soft.
   All rules are scoped to `.app-main`, which Quick Chat does not render, so
   Quick Chat is unaffected.
5. **What Minified shows.**
   - Header: mark and "Squad" (the full product name collided with the three
     header icons at 280px: the More button's focus ring sat over "Squad" in the
     first screenshots), then More (…), New message (+) and collapse. Search
     everything (⌘K) and the notification bell stay as the second row.
   - Top row: up to eight **pinned members** in pin order as 48px portraits in a
     four-column grid with names, presence dots and unread counts; the open
     conversation gets a ring, not a fill. With nothing pinned, the four most
     recently spoken to fill it (labelled "Recent members" for assistive tech),
     so a new squad does not open on an empty promise.
   - A divider, one **Needs you** row with its count, then the one
     conversation list (36px avatars, name, time, preview). Unread counts,
     draft pencils, hidden-channel recovery and every row menu are the same
     code as before.
   - Member chat header from 768px: one centred chip (portrait, name, role,
     presence, engine chip). Workspace, model and context gauge are hidden by
     CSS (`.chat-header-detail`) and remain in the profile popover and the
     composer; phones keep the ADR-0161 header.
6. **Where the Full sidebar's destinations went.** Squad, Memory and Create
   channel, then New member, New team… and Templates… are in **More (…)** in
   the sidebar header. Settings stays in the account footer. Everything is
   also reachable through ⌘K search, which is unchanged. Nothing was removed.
7. **Settings and onboarding share one store.** Settings › Appearance has a
   Layout row above Skin, the same divider radio list with a small layout glyph
   (`LayoutGlyph`) instead of swatches. Onboarding gains **Choose your layout**
   right after Work folders (before Menu bar): one preview that follows the
   hovered or selected option, drawn from page tokens so it follows skin and
   mode, messages arriving on a 7s loop, a still frame under reduced motion,
   then the radio rows. Choosing calls the same `changeLayout`. Progress reads
   "Step 2 of 4 · Layout" in the Mac app and "Step 2 of 3" on the web.

## Verification (what was run)

- `bun run build`: passes.
- `bun run check:jsx`, `bun run check:render`, `bun run check:skins` (with the
  new layout assertions): pass.
- `bun run check:minified:browser` (new, `e2e/minified-layout.spec.mjs`):
  1280×800 and iPhone 13 widths; Autohand light and dark, Paper light,
  Blueprint dark, Grut light and Slate dark on desktop, Autohand and Paper on
  the phone. It asserts the top row switches from "Recent members" to "Pinned
  members" after pinning, Needs you, previews, More's destinations, ⌘K, a
  bubble fill different from the page, user-bubble text contrast ≥ 4.5:1, the
  header identity centred within 4px, no horizontal overflow and no page
  errors; plus the Grut migration and that Quick Chat answers carry no bubble
  fill. 11 passed, 5 skipped by design (phone runs limited to two skins).
- `bun run check:grut:browser` now selects Grut **and** Minified, and checks
  that switching skin keeps Minified until Full is chosen: 3 passed.
- `bun run check:setup-guide:browser` walks the new step in light and dark,
  checks the saved device key and `html[data-layout]`, and the later step
  numbers: 13 passed, 1 skipped. Its first run failed 2 tests: a third spec
  ("an earlier save receipt…") also went straight from Save work folders to
  the phone step's Not now. Any test or script that assumed folders → phone
  needed a Continue; the three live first-run scripts got the same step.
- `bun run check:settings:browser`: passed.

Screenshots were inspected by eye at each iteration; see the change report.

## Consequences

- A person can pair any skin with either layout, and Grut users keep what they
  had. The layout survives sign-out like the skin, because it is a device
  preference; it is not per account or per Squad, and it does not sync between
  computers.
- Knowingly left undone:
  - **Channel headers are not centred.** Only the member chat header becomes a
    chip; channel pages keep their own header with tabs and settings.
  - **The collapsed rail** (72px) is the same in both layouts; it does not show
    the pinned faces.
  - **Avatar tiles have no menu.** Pin, Hide and the rest stay on the list row
    and in the chat header; a right-click on a tile does nothing special.
  - **Pinned members appear twice** (top row and first in the list). The list
    is "conversations, newest first" and the row is "people"; removing them
    from the list would also hide their previews and unread state.
  - **Squad, Memory and channel management are one click further away** in
    Minified. Channel sections are flattened into the one list; section names
    are not shown.
  - The live first-run scripts (`check:first-run:live`, `check:fresh-install`,
    `check:onboarding-live`) were updated to press Continue on the new step but
    were not run here: they need a signed-in runtime.
  - The native macOS app and Squad for iPhone were not rebuilt or checked.

## Amendment (2026-11-17): the header chip lines up

The centred chat header centred each of its two lines on its own: the
avatar-and-name row, then the status line. With a 36px avatar beside a 20px
name, the status line floated loose under the avatar instead of under the
name (owner's screenshot, Iris · Code Reviewer). The chip is still centred as
one block, but inside it the avatar sits left and the status line starts
under the name, exactly as the Full header lays out (`-mt-4 ml-12`). Only the
alignment changed; nothing moved in or out of the chip.
