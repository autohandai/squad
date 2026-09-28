# ADR-0047: The start-up screen you actually see

Date: 2026-09-29
Status: Accepted

## Context

The owner asked for the start-up screen to carry the mark and to animate its
check lines. Investigating it produced a more useful finding than the request.

**The screen in the screenshot is not the one ADR-0033 describes.** It is
`src-tauri/loading/index.html`, a 35-line static page Tauri serves as the
window's frontend while the Rust bootstrap runs on a worker thread. `BootChecks`,
the React screen ADR-0033 designed with its mark, divider rows and settling
avatars, comes after, and is on screen for 431 milliseconds, measured. The
owner has most likely never seen it. ADR-0033 improved a screen nobody looks
at while the one everyone looks at stayed untouched.

Measured at the 1280x840 the shell opens:

| | the native page | the React page |
| --- | --- | --- |
| mark | none | 56px |
| typeface | system | Autohand Sans |
| background | `#0b0b0b` | `#000000` |
| block occupancy | 7.1% | 9.7% |

The backgrounds differ, so the handover flashes. And the three bullet points
are hard-coded prose: the Rust side emits nothing to this page, so nothing
about them can change, including when the thing they describe fails.

## Decision

**Build the native page to match the React one**, so the handover costs no
visible movement: same background, same 56px mark, same column, same row
rhythm, same typeface. The mark and the variable font sit beside the page as
assets, because it is a standalone document and cannot reach into the app
bundle. Together they are 113 KB, so the product's own typeface is on the
first frame rather than a system fallback.

**The rows do not animate, and that is the decision.** The bootstrap emits no
progress to this page, so a row that ticked or filled would be inventing a
fact. All three read as pending, one dot pulses to say the app is alive, and
nothing claims a phase has passed. This is ADR-0033's rejected progress bar in
a smaller form, and it is refused for the same reason.

**The tail line is the change worth making, and it has no motion at all.** The
wait has a real ceiling, so it can say the two things ADR-0035 requires of a
wait: how long it has been, and when it stops. Nothing before 1.2 seconds, so
a normal start (measured at 734-884 ms cold) never flashes a wait state at
all. Then "Waiting 3s. Stops at 30." in whole seconds, replaced in place. Past
24 seconds it says what happens at 30. Integers, no easing: a number that
eases is harder to read and implies a smoothness this does not have.

## Consequences

- The window now shows the product from the first frame rather than a system
  font on a slightly different black.
- The rows still cannot report. Making them report needs the Rust bootstrap to
  emit its three phases to the window, which is a change to `bootstrap_once`
  and `main.rs`, not to this page. That is the next piece of work, and until
  it exists this screen tells the truth by saying less.
- A second finding, not fixed here: `BootChecks` never receives a failed
  state, so its failure rendering has never once executed. It is dead code
  that looks like coverage.
- The page is embedded in the binary at build time, so changing it needs a
  desktop build. Worth knowing before treating it as a quick edit.
