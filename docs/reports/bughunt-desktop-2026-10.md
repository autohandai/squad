# Bug hunt on the installed desktop app, October 2026

The first pass (`bughunt-2026-10.md`) drove the web build in headless
Chrome. This one drives the installed Autohand Squad app (0.1.6, built from
`main`) through CuaDriver: real window, real clicks, real data in
`~/.autohand/squad`. Each row was seen on screen first, then traced to code
in this lane and fixed there. Nothing destructive was done to the person's
data; rows that needed a destructive action to reproduce say so.

How it was driven: `cua-driver call click … "delivery_mode":"foreground"`.
Background clicks reach the window but not the web view, and the web view
exposes no accessibility tree beyond the window chrome, so every action is by
pixel off a screenshot.

| # | Where | What you'd see | Cause | Fix |
|---|---|---|---|---|
| 1 | Sidebar | A paused member had a green dot in the sidebar while the Squad list called them Paused. | The dot took the bridge's presence, which reports an open session as online, and ignored the stored status. | A stored paused or offline status overrides presence; paused has its own slate dot and the label "Paused". |
| 2 | Member chat | Every reply put the member's avatar on a line of its own, with the name, time and text starting underneath it. | The row used `grid-cols-[auto,minmax(0,1fr)]`; Tailwind keeps the comma, so the browser rejected `grid-template-columns: auto,minmax(0,1fr)` and the grid collapsed to one column. | `grid-cols-[auto_minmax(0,1fr)]`: avatar beside the reply, as on user messages. |
| 3 | Member chat | A reply cut off by a restart showed "5 hours 37 min" beside its time, as if the member had worked that long. | Recovery sets `completedAt` to the moment Squad restarted, and the header shows start → completed as the reply's duration. | Interrupted replies show no duration. |
| 4 | Needs you | The warnings count read "1 WARNINGS". | The label was `{n} Warnings`, upper-cased, with no singular. | A bare count, as the other sections show. |
| 5 | Needs you | "Permission Warnings" was a large title-case heading among small sentence-case ones ("Decisions", "Work that stopped"). | The section was written before the inbox `Section` shape and kept its own `text-xl` heading. | "Permission warnings", `text-sm font-semibold`, like its neighbours. |
| 6 | Needs you | One warning was drawn as a bordered box hanging under the heading, half the page wide. | A three-column grid of cells with `border-t` and `md:border-r`; with one item only the box edges showed. | Divider rows like Decisions: avatar, name and level on one line, the warning under it. |
| 7 | Needs you | Work that stopped listed Alex's "so, tell me how many leads…" twice and "changed go ahead" twice, each pair opening the same chat. | One row per failed attempt; asking again after a failure added a row and left the old one. | One row per member and question, the newest; the "stopped" count in the summary counts the same rows. Untitled replies are never merged. |
| 8 | Needs you | The status word read "failed" in lower case on every stopped row. | `[&::first-letter]:uppercase` on an inline `<span>`; `::first-letter` only applies to block-level boxes. | The span is `inline-block`, so it reads "Failed". |
| 9 | Needs you | The status and time column jumped sideways between rows ending in "Retry in chat" and rows ending in "Open chat". | The action button sized to its label, so the text before it moved by the difference. | The action has a fixed minimum width and right-aligns its label. |
| 10 | Needs you, In progress | "Open chat" on a running or failed row carried a Play icon, and on a blocked row a Workflow icon. | `missionNextAction` reused the icons from when those buttons started runs and handoffs. | A chat icon on every "Open chat". |
| 11 | Needs you, In progress | The evidence line read "file change: Command: bun run build pending; file change: src/App.jsx …". | The bold type is guessed from words in the text and was put in front of text that already labels its own parts. | No guessed prefix when the text starts with its own "Label:". |
| 12 | Needs you, In progress | A task showed "Running" since 26 May, five months on, and the summary counted it as "1 working". | A task's own status won over its run's, so a task whose run had ended or been pruned stayed running for good. | A running task whose run has ended, or is missing from the bridge's run list, shows as blocked with the reason, under Work that stopped. |
