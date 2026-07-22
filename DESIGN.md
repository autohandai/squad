# Design Direction

## UI Component Style

- Product UI should feel simple, functional, and Notion-like: calm document surfaces, clear hierarchy, whitespace, and concise controls.
- Avoid bento-style layouts, boxed dashboards, and card walls. Do not turn each designated area into a bordered or tinted rectangle.
- Use borders, background fills, and framed panels only when they materially improve scanning, form containment, or interaction affordance.
- Keep border radius restrained, usually in the 4px to 8px range. Avoid heavy bevels, bulbous corners, glassy panels, and decorative gradients.
- Prefer subtle separators, text scale, alignment, and spacing over colorful section backgrounds to show grouping.
- Keep colors neutral and restrained. Use accent color for actions, status, and focus states, not as broad section fill.
- Use shadcn/ui components and tokens as the baseline. This repo is configured through `components.json`; add missing registry components to `src/components/ui` before writing custom primitives.
- Chat replies should stream the answer as it arrives, show elapsed time and tool activity, and keep raw diagnostic output hidden unless an explicit chat setting enables it.
- While a chat reply is running, the composer should keep a clear stop control and accept additional follow-ups into an editable queue shown directly above the input.
- The composer is a single calm bordered field on the page background (no nested card, heavy drop shadow, or glassy blur); use a subtle focus-within border rather than elevation.
- Do not open a conversation with a boxed status/metric dashboard. Show the member's purpose as quiet text and surface mode/status/workspace as a subtle inline meta line, not bordered metric cards.
- Keep Mission Control out of the primary sidebar; expose it from the Settings/account menu and Settings page while preserving direct routes and tray deep links.
- Keep the tray/menu-bar menu action-focused. Do not add disabled status summary blocks above the actions when equivalent live details are available in submenus or app views.

## Squad Directory (landing surface)

- Opening Autohand Squad lands on the Squad directory at `/squad` (the app root `/` redirects there). This is the team's home, not an individual member's chat.
- The directory is an employee-directory layout: a calm header (live eyebrow, title, one-line intro), a borderless metric strip (Members / Online now / Active work / Needs attention), a search + status filter row, then a divider-separated member list — no cards or tinted panels.
- Each member row shows: avatar with a status dot, name + role + workspace, a status indicator (dot + label derived from live task/run state), and up to three most-recent tasks with status dots and relative time. Row actions are an inline chat button plus a manage menu (open chat, view profile, automations, remove member). Removal always goes through a confirm dialog.
- Status is conveyed with small colored dots and text, never full-bleed colored fills, consistent with the neutral product surface. The page is theme-aware via design tokens (works in light and dark).
- Live data comes from the existing agents/tasks/runs state (same source as Mission Control via `buildMissionRows`); keep it reading those rather than introducing a parallel data path.

## First-Run Onboarding

- Opening `/` routes to `/welcome` until the user is signed in and completes or skips setup; completed or skipped users continue to land on `/squad` only while account state is ready.
- Onboarding is a native app view, not a modal or marketing landing page. Keep it calm, document-like, and task-led: progress/status on one side, setup sections on the other, subtle dividers, and direct controls.
- The flow guides runtime readiness, account sign-in, provider setup, workspace selection, and first squad member readiness. It should reuse the existing runtime, tray/browser auth, provider settings, workspace, and member-creation paths instead of introducing parallel setup systems.
- Account sign-in must stay delegated to the existing Autohand Squad browser/device login path owned by the tray/runtime controller. The web UI can request that path and refresh status, but must not collect credentials itself.
- Provider setup should deep-link or route to the existing Settings LLM Providers surface and `/api/provider-settings`; do not duplicate provider forms in onboarding.
- Users must be able to skip optional setup and resume it from the normal app shell, but skip must not bypass required account sign-in. Persist only lightweight local setup state such as status, selected workspace, and member readiness.

## Squad Channels

- Channels live inside the primary Squad sidebar as a collapsible category under the main navigation, not as a second navigation sidebar.
- The expanded channel category shows channel rows inline with the rest of the sidebar and exposes channel creation from the same area.
- Channel detail pages should use the main canvas for the active channel, member controls, threads, and composer; avoid adding another left rail or boxed dashboard around channel navigation.
- Channel creation and member assignment should stay reachable from both the sidebar category and an empty channel state.
- Channel composers should match the normal chat mention autocomplete behavior for `@here` and member handles, including keyboard selection. Channel loading placeholders should say the member is typing rather than thinking.

## Maintenance

- When a durable user UI preference emerges, update this file in the same change so future UI work reflects it.
