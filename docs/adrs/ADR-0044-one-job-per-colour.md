# ADR-0044: Green means state, not "press this"

Date: 2026-09-29
Status: Accepted

## Context

The owner, on the buttons: "the accent colours for button in my case is not
great."

The Autohand presets used the brand green as `--primary`, the colour of every
primary button. Green is also, everywhere else in this product, the colour of
state: a member online, a member working, a start-up check that passed, the
share of the team that is active. Counted: eighteen uses of the emerald scale
in `src/App.jsx` plus the shared presence states.

So one colour said three things at once. On the Squad page a green rectangle
could be the page's main action, and a green dot beside a name meant the
member was alive, and a green bar meant most of the team was working. A colour
carrying three meanings carries none.

`DESIGN.md` also asks for a surface that is "functional, calm, neutral, and
direct", and a saturated green was the loudest thing on every screen.

## Decision

**Green is state. The primary is neutral.** In the Autohand presets the
primary becomes the near-white already used as the foreground on dark, and
near-black on light, with the focus ring following it off the green. This is
the same convention the Vercel preset in this app already uses, and the reason
it looks calm.

**Only the Autohand presets change.** The other eighteen presets are other
products' palettes, chosen deliberately to look like Xcode, GitHub, Notion,
Raycast, Cloudflare, Linear, Vercel and Cursor. Their accent is their
identity, and neutralising it would make them all the same theme.

**The colour is a token, and buttons must use it.** Changing the token did
nothing at first, because the button that prompted this hard-codes nothing but
the page's create button sits next to several that do. The same fault was
fixed in ADR-0043 for the new-member Save button. A button that writes its own
colours cannot follow a decision like this one.

## Consequences

- Green now appears only where something is true about the system: online,
  working, passed, the active share of the team. When it appears, it means
  something.
- The presets are defined twice: as CSS custom properties in `src/styles.css`
  and as token maps in `THEME_PRESETS` in `src/App.jsx`, which are written
  onto the root at runtime and win. Both were updated. That duplication is a
  trap and is worth removing, but not inside this change.
- Any button that hard-codes a background escapes this decision, silently. The
  rule is already in `DESIGN.md` from ADR-0043; this is the second time it has
  cost something.
- The brand keeps its green. It is still in the swatches, the presence dots,
  the state bar and the logo. What it no longer does is compete with the one
  thing on the page you are meant to press.
