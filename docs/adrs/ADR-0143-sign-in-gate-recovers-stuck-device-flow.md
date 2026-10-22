# ADR-0143: The sign-in gate recovers a stuck device flow

Date: 2026-10-23. Status: Accepted.

## Context and evidence

A new customer reported that signing in to Squad got stuck. The browser
opened in the wrong profile. They switched profiles and clicked "Open the
sign-in page", which did nothing. Closing and reopening Squad showed the same
waiting state, and they could only continue once the device code expired.

There are three causes, each confirmed in the code:

- The link was an `<a target="_blank">`. The main window's navigation
  handler (`info_navigation_handler` with `from_info_window = false`) allows
  the navigation, but the webview has no new-window handler, so the click is
  dropped. The information windows already open such links with the opener
  plugin. The main window does not.
- Closing the main window only hides it (`prevent_close`). The bridge keeps
  the `HarnessLoginManager` flow and its `squad login` child running, and a
  second start returns that same running flow. The gate had no cancel
  action, so the old code stayed until `expires_in` ran out.
- Opening the link again cannot fix a wrong browser profile. It opens the
  same default browser.

## Decision

- `POST /api/harnesses/login/open?id=` opens the running flow's own URL with
  the bridge's existing `openUrlInBrowser`. It returns 409 when no flow is
  waiting. The page never passes a URL to open.
- While a flow is waiting, the gate shows the URL as selectable text with a
  Copy link button, so the person can paste it into the right profile.
- "Start over with a new code" cancels the flow (`DELETE`) and starts a new
  one, which issues a new device code.
- When the gate mounts, it reads the flow status and resumes a running flow,
  so a reloaded window shows the link and code again.

Verified with an isolated bridge, a fake `squad login` and a fake `open` on
`PATH`. The check covered the link, a bridge open, resuming after a reload,
a new code after Start over, and a 409 once the flow was cancelled. It saw
no browser exceptions.

## Consequences and tradeoffs

- The main window's handling of `target="_blank"` is unchanged. Other
  external links there (for example `window.open` for Git events) may still
  be dropped. Fixing that in `info_navigation_handler` affects every
  navigation, so it needs its own change and its own check in the packaged
  app.
- Start over kills the old `squad login` process. If the person approves the
  old code in the browser after that, the approval is ignored and they must
  use the new code.
