# Bug hunt, October 2026

Autohand Squad used as a person would: a fresh install, then each surface in
turn, driven through a real Chrome over the DevTools protocol against a
throwaway bridge (fresh state directories, a copy of the Autohand sign-in).
Each entry says what was seen, why it happened, and what changed. Numbers
are in the order found.

| # | Area | What a person saw | Cause | Fix |
|---|------|-------------------|-------|-----|
| 1 | First run | A channel called `clients-pie-shop-nz` with eight messages appeared on every new install, pointing at `/Users/igorcosta/Documents/autohand/demo/pieshop`. | A one-off recovery of the developer's own channel (`RECOVERED_CHANNELS`) was merged into every browser's channel list. | Removed; installs that already saved it keep their copy. |
| 2 | Channels | Deleting `#general` or `#release-reviews` lasted until the next reload. | `mergeSeedChannels` re-added every seed channel missing from the saved list. | Seed channels are first-run defaults only; a saved list is taken as it is. |
| 3 | Squad | A fresh install said "4 members · 1 working" and listed current work such as "Implement Agent Mission Control route" from a project the person never opened. | Seed tasks were fabricated demo work, one of them `running`. | No seed tasks. |
| 4 | Needs you | A fresh install showed a pending memory decision about "nav overlap" in a folder that does not exist on the machine. | A seed memory proposal with `status: "pending"`. | No seed memory proposals. |
| 5 | Automations | A fresh install showed an active daily "Smoke test" automation that had "run" in May. | A seed automation with a made-up `lastRun`. | No seed automations. |
| 6 | Members | The four starting members worked in `/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli`, a folder that exists on one machine. | Seed members carried the developer's workspace and project. | Seed members start with no folder; first run or the member's settings give them one. |
| 7 | Members | Starting members claimed activity days, tasks and "Autohand Skill Installed" memories they never had. | Fabricated `stats`, `lastConversationAt` and memory lines in the seed. | Seed stats start at zero; the install lines are gone. |
| 8 | Squad | Every starting member showed "22 May" or "25 May" on a squad created today. | Seed members carried fixed May timestamps. | Seeds are dated when the install first loads them. |
| 9 | Chat header | A Stop button sat next to New chat while the member was idle. | It showed whenever the member was online, not when work was running. | Shown only while a reply, goal, queue or run is in progress. |
| 10 | Chat header | Task list and Previous chats used the same clock icon side by side. | Both used `History`. | Task list uses a checklist icon. |
| 11 | Chat header | The runs button was labelled "Current". | It borrowed a badge's copy. | Labelled "Runs", with the running count in the tooltip. |
| 12 | Chat | Suggested prompts read "tell me the three things most worth fixing for testing strategies". | The skill name was appended after "for". | "With testing strategies in mind, look at … and tell me the three things most worth fixing." |
| 13 | Chat | "As a Operations Lead", "the way a SRE would read it". | The article was always "a". | `withArticle` picks a/an, including acronyms. |
| 14 | Chat | "Walk me through in autohand the way a … would read it." | The " in <project>" fragment was reused as an object. | "Walk me through autohand the way …". |
| 15 | Member preview | "View profile" carried an external-link arrow and a full-weight primary fill, though it opens a page inside the app. | `ArrowUpRight` on a default button. | A right arrow on an outline button. |
| 16 | Sidebar | Opening a member's ⋯ menu left the row tooltip ("QA Engineer · Idle") on top of the menu, covering "Remove member". | The tooltip wrapped the whole row, menu included, so hovering the menu kept it open. | The tooltip belongs to the row's button only. |
| 17 | Sidebar | The ⋯ button disappeared while its own menu was open once the pointer left the row. | It was visible only on hover or focus, and focus moves into the menu. | It stays visible while its menu is open. |
| 18 | Member page | The member page also offered Stop for an idle member. | Same condition as #9: shown whenever stopping was possible. | Shown only while the member is working or has a live run. |
| 19 | Member page | The member navigation read "Skill", "Connector", "Permission" and "IM" next to "Projects", "Automations" and "Tasks". | Singular labels and an abbreviation in the English section copy. | "Skills", "Connectors", "Permissions", "Messaging". |
| 20 | Brain card | The autonomy line said "41 autonomous tools, 41 blocked" and left out the 48 tools that ask first, so the numbers did not add up to anything. | The summary counted `allow` and `block` only. | "41 tools run freely, 48 ask first, 41 blocked". |
| 21 | Brain card | Tool categories read "…isolated home.; Local read/search…" with doubled punctuation. | Sentences ending in "." were joined with "; ". | Trailing punctuation is trimmed before joining, one full stop at the end. |
| 22 | Brain card | Allowed tools, escalation rules and the workflow showed literal "- " and "1." at the start of each paragraph, each inside its own bordered box. | Lines were printed as paragraphs inside a boxed card. | Marked lines render as a real bulleted or numbered list, under a quiet divider instead of a box. |
| 23 | Member page | The brain card was a box holding six more boxes plus an ID card box holding five more; the permission ladder was six bordered tiles. The memory policy was clipped mid-sentence in a 7-line scroll area. | Card-in-card layout, against DESIGN.md. | One section under a divider, a definition list for the ID card, a stepped line for the ladder; the memory policy shows in full. |
| 24 | Member page | A member created a minute ago showed a year of activity in its Work Record calendar, the same pattern for every member. | `buildActivity()` returned a fixed repeating pattern. | `activityCalendar` builds the calendar from the member's own runs and tasks; a new member's is empty and says "No activity yet". |
| 25 | Member page | The calendar's months always read May to May, whatever the date. | Hard-coded month labels. | Months come from the dates shown, ending today; days after today are blank. |
| 26 | Member page | The ✕ on Work Record did nothing. | A button with no handler. | Removed. |
| 27 | Member page | The ✕ on Memory & Growth did nothing. | A button with no handler. | Removed. |
| 28 | Member page | Memory & Growth said "No memory updates yet" while listing a memory under "Recently Learned". | The empty message was always rendered beside the list. | The message shows only when there is nothing to list. |
| 29 | Member page | The memory icon tile was dark purple in light mode too. | Hard-coded `#211b40` and `#8472ff`. | Theme tokens (`bg-primary/10 text-primary`). |
| 30 | Member page | The Automations table showed column headings over nothing. | No empty row. | "No automations yet" across the table. |
| 31 | Member page | "Replies and launched runs appear here…" floated with no section above it. | The run list was placed without a heading. | It sits under a "Runs" heading. |
| 32 | Member page | "Active days" and "Projects" in Work Record came from stored counters that never changed. | `agent.stats.activeDays` and `agent.stats.projects` were seed values. | Active days come from the activity calendar; projects from the member's project list. |
| 33 | Member page | The memory policy was printed twice, in the brain card and again in the ID card beside it. | Both rendered `brainCard.memoryPolicy`. | The ID card leaves it to the brain card. |
| 34 | Member page, everywhere metrics show | Work Record, Memory & Growth, every metric and every empty state were bordered boxes inside a bordered box. | `Metric`, `EmptyBlock` and the profile cards each drew a border and a fill. | Sections sit under one divider; metrics are a value over a label; empty states have no frame. |
| 35 | Member page | "View All Memory" floated in the middle of the Memory & Growth heading row. | The header was a grid, so the button took the centre column. | A row with the link at the right. |
| 36 | Member page | The Automations summary was still a boxed card and said "Scheduled local Autohand work" for members on Claude Code or Codex. | Card frame; engine-specific copy. | Unboxed, and "Work this member runs on a schedule". |
