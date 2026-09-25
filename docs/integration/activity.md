# Activity feed (issue #30)

Semantic rows for a run or a chat turn: one row per action that moves from
pending to done or failed in place, quiet reads folded into "read 12 files",
failures prominent, a Raw toggle for the unprocessed trace. Module files:

| Path | Role |
| --- | --- |
| `server/activity/normalize.mjs` | pure fold: events or log lines → `ActivityItem[]`; `collapseActivity`, `summarizeQuiet`, `activityFromTrace`, `activityStats` |
| `server/routes/activity.route.mjs` | `GET /api/runs/:id/activity`, `POST /api/activity/normalize` (auto-loaded) |
| `src/lib/activity.js` | browser re-export of the same module (no Node imports; Vite bundles it) |
| `src/components/activity/ActivityFeed.jsx` | the feed component |
| `scripts/check-activity.mjs` | 197-event fixture; asserts the acceptance criteria |
| `docs/adrs/ADR-0017-activity-feed.md` | decision record |

## Routes

- `GET /api/runs/:id/activity` → `{ runId, status, items, rows, summary, stats, source, raw }`.
  `source` is `trace` when the harness kept `run.trace.events` (SDK runs after
  they finish), otherwise `logs` (`run.logs` folded line by line). `raw` is the
  last 260 log lines, ready for the Raw toggle. 404 for an unknown run.
- `POST /api/activity/normalize { events, status?, live? }` or `{ trace, status? }`
  → `{ items, rows, summary, stats, source }`. Same fold the browser runs
  locally; useful for tests and for tooling that lacks the bundle.

No events are subscribed to or emitted. The bridge does not need to emit
`activity` SSE events: the browser folds the `sdk` events it already receives
(see below), which keeps the protocol unchanged. If the integrator wants the
server-side rows on the wire anyway, one line next to each
`stream.send("sdk", …)` in `server.mjs` does it:
`stream.send("activity", normalizeActivity(eventsSoFar, { status: "running", live: true }))`.

## ActivityItem

```
{ id, kind, verb, object, outcome, state, quiet, startedAt, endedAt, detail, refs }
kind   tool | edit | shell | message | thought | plan | approval | error | status
state  pending | done | failed
verb   read | list | search | fetch | edit | run | call | say | think | plan | ask | fail | status | output
refs   [{ type: "file" | "command" | "url", value }]
```

Ids depend only on the events seen so far (`tool:<toolId>`,
`message:<messageId>:<n>`, `thought:<n>`, `status:<n>`, `tool:log:<n>` for log
lines), so re-folding a growing event list keeps every id and React updates
rows in place. Quiet: reads, lists, searches, fetches, thoughts, status. A
failed row is never quiet.

`normalizeActivity(events, { status, live })`: `status` is the run or reply
status; once it is not `running`, pending rows resolve (done for `completed`,
failed otherwise) so nothing spins forever. `live: true` keeps an open message
pending while deltas still arrive.

Inputs are detected per entry: stream events from `chatStreamEventFromSdkEvent`
(`message_delta`, `tool_start { tool }`, …), raw harness events
(`message_update`, `tool_start { toolId }`, `agent_start`, …), trace events
(`tool_call`, `tool_result`, `thought`, `assistant_event`, `step`), and
`run.logs` lines (`{ source, line, at }`, including the pretty-printed JSON
args `appendSdkEventLog` splits over several `tool` lines).

## Component

```jsx
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { activityFromTrace, normalizeActivity } from "@/lib/activity";

<ActivityFeed items={items} raw={raw} showRaw={showRaw} onToggleRaw={() => setShowRaw((v) => !v)} copy={copy} className="mt-2" />
```

| Prop | Meaning |
| --- | --- |
| `items` | `ActivityItem[]` |
| `raw` | the unprocessed list: log lines `{ source, line, at }` or events `{ type, … }` |
| `showRaw` | controlled; renders `raw` as a monospace list instead of the feed |
| `onToggleRaw` | shows the "Raw · n" / "Feed" text control; omit it to hide the control and let the parent decide (e.g. the chat setting `displayCliOutput`) |
| `copy` | `activityRaw`, `activityFeed`, `activityEmpty`, `activityPending`; each has a fallback literal |

Rows are a `divide-y` list, no cards: state glyph (spinner while pending, dot
when done, destructive dot when failed), "Edited src/App.jsx" in mono for edits
and shell, "· outcome" muted, time at the right, chevron to open the detail.
Failed rows render in `text-destructive` with the detail open. A run of quiet
rows becomes one "read 12 files · 2 searches" row that expands to the rows.

## Replace `AgentWorkTrace` (chat and channel rows)

`AgentResponseMessage` (`src/App.jsx`, `function AgentResponseMessage`) renders
`<AgentWorkTrace view={view} open={isLoading} durationLabel=… />` under the
answer, where `view = buildAgentResponseView(message)` and `message.trace` is
the trace from `updateLiveTraceFromStreamEvent` (while streaming) or
`data.trace` from the `done` event. Channel replies and DMs go through the
same `SquadMessage → AgentResponseMessage` path, so one change covers both.

1. In the `sdk` branch of the chat stream loop (`if (event === "sdk")`, near
   `liveTrace = updateLiveTraceFromStreamEvent(liveTrace, data)`), also keep
   the raw events: `liveEvents = [...liveEvents, data]` and store them on the
   message (`streamEvents: liveEvents`). They are what `ActivityFeed`'s Raw
   view shows and the most faithful input to the fold. For finished messages
   without `streamEvents`, fall back to the trace.
2. In `AgentResponseMessage`:
   ```js
   const activity = useMemo(
     () => (message.streamEvents?.length
       ? normalizeActivity(message.streamEvents, { status: isLoading ? "running" : message.status === "error" ? "failed" : "completed", live: isLoading })
       : activityFromTrace(message.trace, { status: isLoading ? "running" : "completed" })),
     [message.streamEvents, message.trace, isLoading, message.status]
   );
   const raw = message.streamEvents?.length ? message.streamEvents : (message.trace?.events || []);
   ```
   Keep the existing `<details>` disclosure with its "Work details · steps ·
   tools · duration" summary (DESIGN.md: work details are a text disclosure)
   and put `<ActivityFeed items={activity} raw={raw} showRaw={showRaw} onToggleRaw={…} copy={copy} />`
   inside it in place of the `<ol>` timeline. `activityStats(activity)` gives
   `{ rows, tools, failed, pending }` for the summary line (`rows` replaces
   `view.orderedEvents.length`, `tools` replaces `view.toolCalls.length`;
   append "· 1 failed" when `failed > 0`).
3. `RawTraceBlock` and the chat setting `displayCliOutput` stay: pass
   `showRaw={normalizedChatSettings.displayCliOutput}` and omit `onToggleRaw`
   when the setting should remain the only switch, or pass `onToggleRaw` for a
   per-message toggle.
4. Once nothing else renders them, `AgentWorkTrace`, `WorkTraceEvent`,
   `StepTrace`, `ThoughtTrace`, `ToolCallTrace`, `AssistantEventTrace`, and
   `buildOrderedWorkEvents` can go; `normalizeTrace` and
   `buildAgentResponseView` stay for the answer text and `raw`.

## Replace the Execution panel run output

The runs list in the Execution sheet (`src/App.jsx`, the `<details>` whose
summary is `Output · ${run.logs.length} lines`) prints the last twelve log
lines in a `<pre>`. Replace the `<pre>` with:

```jsx
<ActivityFeed
  items={normalizeActivity(run.logs, { status: run.status })}
  raw={run.logs}
  showRaw={showRawRuns}
  onToggleRaw={() => setShowRawRuns((v) => !v)}
  copy={copy}
  className="mt-2"
/>
```

`run.logs` comes from `runSummary` (last 260 lines) via `GET /api/runs`; for
the full history of a finished SDK run call `api(\`/api/runs/${run.id}/activity\`)`
and use its `items` and `raw` instead. Keep `<code>{run.command}</code>` above
the feed and the `<details>` summary as is.

## Scripts and copy

- `package.json`: `"check:activity": "node scripts/check-activity.mjs"`.
- `src/locales.js` (`en`): `activityRaw: "Raw"`, `activityFeed: "Feed"`,
  `activityEmpty: "No activity yet."`, `activityPending: "in progress"`.
- `DESIGN.md`, under Agent Chat: "Work details is a semantic activity feed:
  one divider row per action that updates in place, reads folded into a
  'read 12 files' row, edits and shell commands in mono, failures in the
  destructive colour with their detail open, and a text Raw toggle for the
  unprocessed trace. The Execution panel's run output uses the same feed."
