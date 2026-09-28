# ADR-0043: The setup guide, the right-click menu, and a disabled primary

Date: 2026-09-28
Status: Accepted

## Context

Three faults from one round of owner feedback. Each is small, and each is a
judgement that could have gone the other way, so each is written down.

**The setup guide was an account action.** It sat in the account menu between
Work and Settings, above Report a bug and Sign out. It is a first-run
checklist: what runtime is installed, whether you are signed in, which model
provider to use, which workspace, and your first member. None of that is an
account action, and there was no way back to it once dismissed. The owner put
it exactly: "setup guide shouldn't exist here, in fact this is an onboarding
exercise that users can run again via settings."

**Right-clicking offered browser actions.** The desktop webview's own context
menu shows Back and Reload. Back has no meaning in an app with no browser
history to walk, and Reload throws away whatever a member is in the middle of.

**A disabled primary still read as the call to action.** DESIGN.md already
says a disabled primary button drops to a neutral surface. The Save button on
the new-member page hard-coded its own colours, so it escaped the shared
button's disabled treatment and kept the full accent fill at half opacity. An
empty page showed a bright green Save with nothing to save. Measured: the
disabled button's background was the accent, while the disabled Design button
beside it was correctly neutral.

## Decision

**The setup guide is a Settings section**, first in the list, with a button
that runs it again. It is gone from the account menu.

**The desktop shell suppresses the context menu, except in text fields.**
Cut, copy and paste are the reason anyone right-clicks in an input, so inputs,
textareas and anything contenteditable keep theirs. The listener is registered
only when the app detects the desktop shell, so the browser build is
untouched.

This is deliberately blunt. The alternative is a real application context
menu, which is the right answer eventually and a larger piece of work; the
owner asked to "disable right click for now on these two options", and a menu
offering two wrong actions is worse than no menu.

**A primary button must come from the shared primitive.** The bespoke classes
are gone. The label is now "Save member" rather than "Save & Enable", because
enabling is not a second thing the button does.

## Consequences

- A disabled primary is neutral everywhere this primitive is used, which is
  the point of having a primitive. Any future button that hard-codes accent
  colours will reintroduce the same fault; DESIGN.md now says so explicitly.
- Suppressing the context menu removes the browser's spell-check and
  inspect-element entries in the desktop build. Inspect element is not
  available in a release webview anyway, and text fields keep the menu that
  carries spell-check.
- The setup guide being re-runnable means it can be run when it is not needed.
  It is read-only in effect: it reports what is configured, so running it
  again costs nothing but time.
- Not a fault, checked and ruled out: the owner also flagged the fonts. Both
  Autohand Sans and Autohand Mono ship inside the bundle, load from disk with
  no font CDN, and render everywhere, confirmed in the running app rather than
  assumed.
