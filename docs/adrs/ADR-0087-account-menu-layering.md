# ADR-0087: Account menus above the workspace surface

Date: 2026-10-13

## Context

The user’s Soft-skin screenshot showed the chat composer painting over the
account gear menu and reported that its options could not be selected. The
menu was an absolutely positioned element inside the sidebar’s sticky
stacking context. Its own `z-50` could not lift it above content in another
stacking context. It also had manual outside/Escape listeners without a
keyboard menu’s focus and arrow-key behavior.

A rendered 1170 × 760 reproduction with a collapsed Soft sidebar confirmed
that the chat page and composer, rather than the enabled menu rows, received
the sampled pointer hits. An initial fixture also opened the modal Execution
sheet, which legitimately intercepted background input; removing that modal
reproduced the account-menu defect independently. The screen’s appearance
alone was not used to infer which element received a click.

## Decision

Add the shadcn dropdown-menu primitive through the configured registry and
use it for every account-menu placement. Its portal escapes sidebar stacking
and clipping, with collision handling and bounded height/width. Use the
existing Radix dependency and repository `cn` utility; the registry’s separate
utility package was removed after adapting its generated import.

Keep the existing account/actions and each skin’s surface tokens. Use a
non-modal dropdown so opening a small account menu does not lock the rest of
the application. Radix owns focus, roving keyboard selection, outside
dismissal and Escape rather than maintaining another custom listener set.

## Evidence

`node scripts/check-account-settings-browser.mjs` exercises the rendered app
against an isolated bridge. It checks actual pointer hit targets across the
menu rows, clicks Settings through the browser input protocol, exercises
keyboard selection and Escape/focus restoration, and checks window bounds.
The pre-fix run failed the pointer-target assertion in Soft with no modal open.
The fixture runs Autohand light/dark, Soft and Grut, in both sidebar layouts,
and checks all skins in a narrow window. Provider execution is prohibited.

The completed run passed all eight desktop skin/theme/sidebar combinations,
three narrow-window skin checks, keyboard selection and Escape focus return.
The installed native candidate exposed the new account menu and its actions
through macOS accessibility. Native pointer hit testing is not substituted for
the browser check; the user resumed interacting with the app during the probe.

## Consequences

- The account menu sits above the chat page and composer without raising the
  whole sidebar above the application.
- Menus use the same collision, focus and dismissal behavior as the shared
  primitive. On a short window, content can scroll instead of being clipped.
- The menu remains a small account surface rather than a redesigned sidebar.
  Existing modal sheets still own their background interaction boundary.
- Hit testing proves all sampled row regions receive pointer input; navigation
  is exercised through Settings. The check does not sign out or submit bug
  reports, feedback or external account actions.
