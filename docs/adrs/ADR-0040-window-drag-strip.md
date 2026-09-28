# ADR-0040: One strip owns the window drag

Date: 2026-09-28
Status: Accepted

## Context

A user:

> There's only a couple of spots on the window title bar I can drag from, and
> sometimes they disappear on particular panels (eg Permissions for a team
> member). It looks like a layering issue as the scroll bar sometimes goes all
> the way to the top of the window. In this particular screenshot I cannot
> drag the window at all.

The window is built with `TitleBarStyle::Overlay`, `hidden_title` and
`transparent`, so it has no title bar of its own and the page draws under the
traffic lights. Two things follow from that, and the app did neither properly.

**Dragging was delegated to page headers.** The whole app had two
`data-tauri-drag-region` elements: the sidebar's brand row and the chat
header. Tauri starts a drag only when the pointer lands on the annotated
element itself, so a header full of children is a header you mostly cannot
drag. Only the side padding, the gaps and the vertical slack worked, which is
exactly "a couple of spots". Every member profile route, Permissions included,
renders a different sidebar and a plain page root, neither annotated, so those
pages had no draggable pixel at all.

**The band was never reserved.** The 28px inset existed on two classes,
`.app-sidebar` and `.app-titlebar-inset`, and not on the main column. So every
non-chat page began at the top of the window, under the traffic lights, with
its scroll container starting there too. That is the scrollbar reaching the
top of the window, and the same fault put a logo behind the traffic lights on
the profile page earlier.

## Decision

**One element owns the drag, and it is empty.** `.app-drag-strip` is a fixed,
childless band across the top of the window, rendered once in the shell root.
With no children every pixel of it is a direct hit, so it cannot be partly
swallowed the way a header is. The two header annotations are removed; there
is now exactly one drag region in the app.

**The band is reserved on the shell root**, not per column, so a new page or a
new sidebar cannot forget it. The inset is a custom property, zero everywhere
but macOS, so the rule is the same on every platform.

**Full-height utilities are rewritten inside the shell.** `h-screen` and
`min-h-screen` measure the viewport, not the padded shell, so each one was
exactly the inset too tall and produced a scrollbar the page did not need.
Measured before: 28px of overflow on the chat and Inbox pages. After: zero.
The `lg:` variants are rewritten inside Tailwind's own `lg` query so they
still do nothing below it.

## Consequences

- Every page can be dragged from anywhere along the top band. Verified on
  chat, the squad directory, Work, Inbox and a member's Permissions page: one
  strip, 28px tall, and all four probe points across the width hit it.
- Content starts below the traffic lights everywhere, rather than on the pages
  that happened to remember.
- A modal covers the strip, so the window cannot be dragged while a dialog is
  open. That is what happened before as well, and closing the dialog restores
  it. Fixing it would mean portalling the strip above every overlay, which is
  more machinery than the problem is worth today.
- The rewrite of `h-screen` and `min-h-screen` is a blunt instrument: it
  reaches every element in the shell using those utilities. It is narrow in
  what it changes, a fixed subtraction of the inset, and it is the only way to
  avoid auditing twenty-five call sites and every future one.
