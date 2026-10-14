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
