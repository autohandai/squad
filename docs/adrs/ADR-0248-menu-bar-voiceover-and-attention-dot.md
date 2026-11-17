# ADR-0248: the menu bar speaks to VoiceOver, and a dot says something needs you

Status: accepted. Finishes the two items ADR-0236 left undone (VoiceOver on
the status item, spec §5; the attention variant of the status icon, spec
§3.6). Amends `docs/design/menu-bar-menu.md` §3.6 and §5.

## Context and evidence

Everything below was read on the owner's Mac (macOS 27.2) with a Swift
helper calling `AXUIElementCopyAttributeValue` from a separate process, the
same API VoiceOver and Accessibility Inspector use. Read-only: nothing was
opened or clicked.

**What the installed Squad 0.1.22 served.** The Squad status item:
`AXMenuBarItem`, role description "status menu", no AXTitle, no
AXDescription, AXHelp "Autohand Squad" (the tooltip), one action, AXPress.
VoiceOver had no name to read, only a hint. The menu, read closed through
the status item's `AXMenu` child, had one `AXMenuItem` per row with AXTitle
equal to the words on screen: "Squad · no members yet", "Codex out until Mon
7:50 am", and so on, with no AXHelp. Reading order is menu order.

**What AppKit serves when the shell sets things.** A throwaway accessory
process put a menu under its main menu (which stays in the AX tree without
showing anything) and set one property per item:

| set on the NSMenuItem | served to another process |
|---|---|
| `setAccessibilityTitle` | replaces AXTitle |
| `setAccessibilityLabel` | AXDescription, alongside the original AXTitle |
| `setAccessibilityHelp` | AXHelp |
| `toolTip` | nothing |
| `image.accessibilityDescription` | nothing, with or without a title |

So the drawings (comb, headroom mark, portraits) are already silent, and the
only way to change what VoiceOver reads as the row's name is AXTitle.

**A wrong first check.** Before that, the same properties were read
in-process with `accessibilityAttributeValue:` on a closed menu. AXDescription
and AXHelp came back nil even after being set, which would have meant the
setters do nothing for menu items. The out-of-process read shows they work.
In-process legacy reads of NSMenuItem are not what the accessibility server
answers; only the cross-process read counts as evidence here.

**The spec's premise about pressing was wrong.** §5 said left-click and
AXPress open Quick Chat, so VoiceOver could not reach the menu without
`accessibilityPerformShowMenu`. Reading tray-icon 0.24.2
(`platform_impl/macos/mod.rs`): the crate sets `NSStatusItem.menu` and lays a
view over the button that takes every mouse event. A mouse click never
reaches the button; AXPress does, through `performClick:`, and a status item
with a menu pops it (the crate's own `show_menu` relies on exactly that for
right-click). So VoiceOver's press already opens this menu, and Quick chat is
a row in it (⌘⇧K). The real gap was elsewhere: in Agent avatars mode a
member's status item has no menu and its button no action, so AXPress on it
did nothing at all.

**A visible bug on the way.** muda strips `&` as a mnemonic marker
(`strip_mnemonic`, muda 0.19.3), so a member called "R&D Scout" showed, and
was read, as "RD Scout".

**Status items from a helper are not in the tree here.** A status item made
by an unbundled or ad-hoc-bundled helper landed at x = 981 behind the notch
of the owner's full menu bar, with occlusion "not visible" and no
AXExtrasMenuBar entry. Out-of-process checks of the status *button* were
therefore only possible against an installed app whose item is visible.

## Decision

1. **Rows say a sentence.** The planner (`desktop_tray::menu`) gives every
   row `spoken_title()`: the words with ` · ` read as a comma, so VoiceOver
   says "Noah, Working on checkout tests" whatever the punctuation verbosity.
   Where a row cuts text short, VoiceOver gets more than the screen: the
   whole question or approval (up to 160 characters, not 40) and the whole
   task title. "Plenty of headroom" also says the number its mark shows
   ("tightest is Codex 82% left this week"). The shell sets AXTitle only when
   it differs from the screen.
2. **Rows that act say what they do** (AXHelp): the header "Opens the Squad
   window.", a needs-you row "Opens Eva's chat in Squad to approve or
   decline.", a member row "Opens Quick Chat with Noah." (or "a chat … in
   Squad" when Quick Chat is off), Quick chat, Open Needs you, Start
   services. Rows whose title already says it carry none.
3. **The Squad status item has a name and a state.** AXDescription
   "Autohand Squad", gaining ", 1 thing needs you" while something waits, so
   the part VoiceOver always reads carries the one thing worth acting on.
   AXValue is the header ("2 working, 3 ready", "Stopped", "signed out").
   AXHelp says pressing opens the Squad menu with Quick chat in it. AXPress
   keeps opening the menu; no `accessibilityPerformShowMenu` was added.
4. **Members' own status items** (Agent avatars) get the member's name,
   their row's state and "Opens Quick Chat with {name}.", and a target and
   action on the button, so VoiceOver's press opens their Quick Chat exactly
   like a click (`menu_bar_access::make_pressable`). Mouse clicks still go
   through the tray crate, so nothing fires twice.
5. **Announcements.** When a question or approval appears that the last
   bridge read did not have, and VoiceOver is running, Squad posts
   `NSAccessibilityAnnouncementRequestedNotification` on the application at
   medium priority: "Squad: Eva needs approval: push the release branch to
   main", or "Squad: 2 things need you" when several arrive together. Items
   already waiting when Squad starts or switches account are not announced.
6. **The attention dot.** While anything needs the person, the Squad icon is
   the same template with a 5 pt dot cut into its lower right and a 1.25 pt
   clear gap around it (`tray_art::with_attention_dot`). It stays a template,
   so macOS paints it in the menu bar's own foreground on light, dark and
   tinted bars, and it is drawn in Rust into the same pixels as the icon,
   so it is as visible as the icon is (no ADR-0229 image-visibility trap:
   that applies to menu item images, not the status button). In Agent
   avatars mode the waiting member's own portrait also gets the dot, in the
   menu's orange `YOU`. The dot follows exactly the items the needs-you row
   shows (`menu::attention_count`): none while services are stopped or
   signed out, and it goes on the next refresh after the item is handled.
7. **On by default, one switch for both signals.** Settings › Quick Chat ›
   "Show when something needs you" (`menuBarAttentionDot`, default true)
   turns off the dot and the announcement together. On, because the menu's
   one question is whether the squad can keep working without you, a waiting
   approval is the case where it cannot, the Dock badge already counts the
   same thing by default, and the dot is quiet: monochrome, no motion, gone
   when there is nothing. One switch, because the announcement is the dot
   for someone who cannot see it; a person who turns off the dot has said
   the menu bar should not signal, and VoiceOver users get the same choice
   in the same words.
8. **No flicker.** The icon is replaced only when the dot's state changes,
   both calls in one main-thread turn. A bridge read that fails or times out
   keeps the last items of its kind (`tray_bridge::merge_needs`) instead of
   dropping them, which would have taken the row and the dot away for five
   seconds and brought them back.
9. **`&` survives.** The shell doubles `&` before handing words to muda, so
   the native title equals the planned words, which `describe_menu` checks
   before describing an item.

## Consequences

- Evidence for the menu rows and the announcement is out-of-process: the
  example `src-tauri/examples/menu_bar_ax.rs` runs the shell's own module on
  the real planner's rows, and `scripts/menu-bar-ax-check.swift` read back 29
  described items, the help lines and the announcement "Squad: Eva needs
  approval: push the release branch to main and tag it v0.1.23". Evidence for
  the status buttons is in-process only (their label, value and help getters,
  and `accessibilityPerformPress` reaching the press handler), because this
  Mac hides helper status items behind the notch. Run the check script
  against the installed build's pid to read the real status item.
- VoiceOver itself was not run, so what is spoken is inferred from the
  attributes, not heard. In particular, whether VoiceOver speaks AXValue for
  a menu-bar item is not confirmed; the attention count is in the label for
  that reason.
- The dot clears up to five seconds after the item is answered (the tray's
  refresh period), not at once. The Dock badge, driven by the web app, is
  faster.
- The Dock badge counts everything in Needs you (handoffs, proposals, vault
  and folder requests); the dot and the announcement count questions and
  approvals only, because those are what the menu can open. They can
  disagree, and the dot can be off while the Dock shows a number.
- A person with native notifications on and VoiceOver running may hear a
  waiting item twice: once as the notification banner, once as the
  announcement. Medium priority keeps the second from cutting the first off.
- The orange dot on a member's portrait is colour on a picture that changes
  with the member; its gap keeps it apart from the portrait, but it is not
  measured for contrast against every bird.
- The member press target is rebuilt per member id and kept for as long as
  that member has a status item; Squad switching accounts drops the items
  and so the targets.
- Not done: Increase Contrast is still read on every rebuild instead of on
  the system notification (ADR-0236), and two-line or custom-view rows remain
  out of reach for the same muda reasons.
