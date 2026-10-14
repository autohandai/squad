# Forty UX enhancements, October 2026

Bug hunts fixed what was wrong. This pass adds what was missing for the things
people do most in Squad: reading and answering long replies, moving between
members and channels, clearing Needs you, finding a member or a setting, and
understanding a member's memory, history and permissions. Each row was tried in
the lane preview (lane build served locally, reads forwarded to the installed
0.1.7 bridge, every write refused), against the real roster and history.

| # | Where | Use case | Enhancement |
|---|---|---|---|
| 1 | Replies, channels | Taking a command or snippet out of a reply | Every code block has a copy control (on hover or focus) that says when the copy failed. |
| 2 | Member chat | Pasting an answer into a doc or ticket | "Copy reply" beside Read aloud on each finished reply. |
| 3 | Channels | Quoting a channel message elsewhere | "Copy message" in the hover actions of every message, without the engine's retry chatter. |
| 4 | Member chat | Reading an earlier answer in a long chat | "Jump to latest" appears once you are more than a screen up. |
| 5 | Channels | Same, in a busy channel | The same control; it found Radix's viewport even before Radix enabled scrolling. |
| 6 | Member chat | Asking again with one word changed | Up in an empty composer brings back the last message you sent. |
| 7 | Member chat | A reply failed because of how it was asked | "Edit and resend" beside Retry puts the question back in the composer. |
| 8 | Member chat | Opening a member to talk to them | The composer has the cursor when the chat opens. |
| 9 | Member chat | "When did I ask this?" | Hovering a message time shows the full date and time. |
| 10 | Channels | Same, in channels | The same tooltip on channel message times. |
| 11 | Member chat, channels | Scanning recent days | Day lines say "Today" and "Yesterday". |
| 12 | Everywhere | Learning what the app answers to | "?" opens a Keyboard shortcuts sheet: search, direct messages, sending, steering, recall, mentions, commands. |
| 13 | Everywhere | Moving between the people you talk to most | ⌘1–⌘9 (Ctrl on Windows and Linux) opens the nth direct message, in sidebar order. |
| 14 | Window, tab | Telling Squad windows and tabs apart | The title names the page: "Noah · Autohand Squad", "#general · …", "Needs you · …", "Settings · …". |
| 15 | Window, tab | Seeing there is something waiting without switching | The title starts with the Needs you count: "(2) …". |
| 16 | Channels | Opening a channel from a typed or shared address | `/channels/general` (or `%23general`) opens #general; only internal ids worked before. |
| 17 | Squad | Finding a member quickly | "/" anywhere on the page puts the cursor in member search; the field says so. |
| 18 | Squad | Getting back to the full roster | Esc in member search clears it. |
| 19 | Squad | A search that finds nobody | "No member matches “zzz”." with Clear search (or Show everyone for a status filter), instead of a centred icon block. |
| 20 | Squad | Finding who is on what | Search also matches the line a member is working on ("handoff" finds Iris). |
| 21 | Squad | Seeing who was active lately, or scanning by name | Sort: As arranged, Recent, A–Z, remembered between visits. |
| 22 | Sidebar | Coming back to a half-written message | A pencil on a direct message that holds an unsent draft (drafts already survived; nothing said where they were). |
| 23 | Sidebar | Folding a section away without missing anything | A collapsed section says "N unread" beside its name. |
| 24 | Sidebar | Catching up on a channel section at once | "Mark read" on a section's header while any of its channels is unread. |
| 25 | Sidebar | Keeping the sidebar the way you arranged it | Folded channel sections and Direct messages stay folded after a reload. |
| 26 | Needs you | Clearing stopped work you dealt with elsewhere | "Hide" on a stopped row; it stays hidden until that row changes (fails again, is retried), with "N stopped items are hidden. Show". The summary's count follows. |
| 27 | Needs you | Going from the count to the items | Each part of the summary ("1 decision · 1 unread · 6 stopped") goes to its section; "working" opens In progress. |
| 28 | Member, Memory | Finding one fact a member keeps | "What Eva knows" shows a count and, past six entries, a search field; Esc clears it, and an empty result says what found nothing. |
| 29 | Member, History | Finding one event in a long trail | "Search this history" over the loaded records, saying when Load more would search further back. |
| 30 | Member, Permissions | Undoing hand-tuned tool settings | "3 tools differ from the Level 4 defaults. Reset to the level's defaults": choosing the level you are already on did nothing, so there was no way back. |
| 31 | Settings | Finding a setting without knowing its section | "Find a setting" above the section list matches names and what each section holds ("dark" → Appearance, "api key" → LLM Providers, "telegram" → Remote access); Enter opens the first match. |
| 32 | Search (⌘K) | Using the palette from the keyboard | A hint row: ↑↓ move, Enter open, Esc close, ? all shortcuts. |
| 33 | Member chat | Knowing the keys that are on no button | While the composer is focused and empty, one quiet line: Enter sends, Shift Enter for a new line, ↑ last message, / for commands. |
