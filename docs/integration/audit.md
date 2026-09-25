# Audit trail: integration notes

Issue #34 · ADR-0018. Module files: `server/audit/trail.mjs`,
`server/routes/audit.route.mjs`, `src/lib/member-history.js`,
`src/components/members/MemberHistory.jsx`, `scripts/check-audit.mjs`.

## Bridge

The route plug-in is auto-loaded; nothing in `server.mjs` changes. On `init`
it subscribes to `ctx.events` (`"*"`) and appends one record per event that
names a member (`memberId`, or `fromMemberId` for `handoff.pending`, or the
run's `agentId` looked up in `ctx.runs` for `approval.pending`). Files live at
`<squadStateDir>/audit/<memberId>.jsonl`.

| Route | Purpose |
| --- | --- |
| `GET /api/members/:id/activity?before=&limit=&kind=` | `{ memberId, records, hasMore, nextBefore, total, dropped }`, newest first, 50 per page (max 500). `before` is a record id (from `nextBefore`) or a time. `kind` narrows to one kind. |
| `GET /api/members/:id/activity/export` | The JSONL file as a download (`application/x-ndjson`, `<id>-activity.jsonl`). Empty file when nothing was recorded. |
| `POST /api/members/:id/activity` | `{ kind, summary, refs?, eventName?, status?, at? }` → `{ memberId, id }`. Appends a client-side action. |

Events already emitted today: `run.finished` (all run exits), `chat.finished`
(direct and channel replies). **Still to emit from `server.mjs`** so they get
recorded: `shell.ran` after the composer shell route (add `memberId` from the
request body when the composer sends it) and `member.stopped` from the
stop-member handler; `file.edited { memberId, path, runId }` is mapped to the
`edit` kind if a harness adapter ever emits it.

## Web app

### Where to render

`SquadMemberSectionPage` in `src/App.jsx` branches on `section`
(`harness`, `permissions`, `model`, `project`, `memory`, then a generic
rows page). Add a `history` entry to `MEMBER_SECTIONS` (icon `History` from
lucide-react, after `memory`) and a branch:

```jsx
if (section === "history") {
  return (
    <MemberHistoryPage agent={agent} api={api} copy={copy} locale={locale} navigate={navigate} />
  );
}
```

`MemberHistoryPage` is a thin App.jsx wrapper that owns fetch state and
renders `MemberHistory` in the same shell as the other section pages
(`PageTitle`, `mx-auto max-w-5xl px-4 py-5`, no `Card`):

```jsx
import { MemberHistory } from "@/components/members/MemberHistory";
import { HISTORY_PAGE, mergeRecords, nextCursor } from "@/lib/member-history";

const [records, setRecords] = useState([]);
const [hasMore, setHasMore] = useState(false);
const [filter, setFilter] = useState("all");
const [loading, setLoading] = useState(false);

async function load({ reset = false, kind = filter } = {}) {
  setLoading(true);
  try {
    const before = reset ? "" : nextCursor(records);
    const query = new URLSearchParams({ limit: String(HISTORY_PAGE), ...(before ? { before } : {}), ...(kind !== "all" ? { kind } : {}) });
    const page = await api(`/api/members/${encodeURIComponent(agent.id)}/activity?${query}`);
    setRecords((current) => (reset ? page.records : mergeRecords(current, page.records)));
    setHasMore(page.hasMore);
  } finally {
    setLoading(false);
  }
}
useEffect(() => { void load({ reset: true }); }, [agent.id]);

<MemberHistory
  records={records}
  hasMore={hasMore}
  loading={loading}
  filter={filter}
  onFilter={(kind) => { setFilter(kind); void load({ reset: true, kind }); }}
  onLoadMore={() => load()}
  onExport={() => window.open(`/api/members/${encodeURIComponent(agent.id)}/activity/export`, "_blank")}
  copy={copy}
  locale={locale}
  renderLink={(ref) => {
    if (ref.type === "channel") return <a className="underline-offset-4 hover:underline" href={channelsPath(ref.id)}>{ref.label}</a>;
    if (ref.type === "task") return <a className="underline-offset-4 hover:underline" href={`${memberProfilePath(agent.id, "task")}?task=${encodeURIComponent(ref.id)}`}>{ref.label}</a>;
    if (ref.type === "member") return <a className="underline-offset-4 hover:underline" href={memberProfilePath(ref.id, "home")}>{ref.label}</a>;
    if (ref.type === "run") return <a className="underline-offset-4 hover:underline" href={`${memberChatPath(agent.id)}&panel=runs&run=${encodeURIComponent(ref.id)}`}>{ref.label}</a>;
    return null;
  }}
/>
```

The run link opens the chat's Execution panel on the Runs tab
(`openPanel("runs")`); read `panel`/`run` from the query in the chat page and
call `openPanel` once. Return `null` for refs the app cannot route yet; the
row then shows no link for them. Filtering is server-side (refetch from the
first page); `filterRecords` exists for a client-only variant.

Also add the section to the profile's link list (`memberProfilePath(agent.id,
"history")`) and to `sectionLabels` in copy.

### Client-side actions to POST

Bridge events cover runs, replies, mentions, handoffs, and approvals. Post
these from `App.jsx` with `api(`/api/members/${id}/activity`, { method: "POST",
body: JSON.stringify(payload) })`, fire-and-forget (`.catch(() => {})`):

| Where in App.jsx | Payload |
| --- | --- |
| `dispatchChannelMemberReply` when the reply lands (`updateChannelMessage(…, { status: "done" })`) — only when the bridge did not emit `chat.finished` for it (SDK path emits; the fallback path may not) | `{ kind: "message", summary: "Posted in #<name>: <first 140 chars>", eventName: "channel.message.posted", refs: { channelId, messageId, threadId } }` |
| A member's direct-chat reply committed to `messages` when it came from a non-bridge path | `{ kind: "message", summary: "Replied: …", eventName: "chat.message.posted", refs: { messageId } }` |
| A file edit the app observes from the harness stream (`tool: edit/write` events in the work timeline) | `{ kind: "edit", summary: "Edited src/App.jsx", eventName: "file.edited", refs: { path, runId } }` |
| The `!` composer shell result, until `server.mjs` emits `shell.ran` | `{ kind: "shell", summary: "Ran <command>", eventName: "shell.ran", refs: { command, exitCode, workspace } }` |

Handoffs and approvals already reach the bus through `POST /api/events`; do
not also POST them here or the member gets two records.

## Copy keys (`src/locales.js`, `en`)

```js
history: "History",
historyDescription: "Everything this member did, newest first. Each row links to the run or channel it came from.",
historyExport: "Export",
historyLoadMore: "Load more",
historyLoading: "Loading…",
historyEmpty: "Nothing recorded yet. Runs, replies, edits, shell commands, handoffs, and approvals will appear here.",
historyEmptyFiltered: "Nothing of this kind yet.",
historyFilter: "Filter history",
historyKinds: { all: "All", message: "Messages", run: "Runs", edit: "Edits", shell: "Shell", handoff: "Handoffs", approval: "Approvals" },
historyKindTitles: { message: "Message", run: "Run", edit: "Edit", shell: "Shell", handoff: "Handoff", approval: "Approval" },
historyOpenRun: "Run", historyOpenChannel: "Channel", historyOpenTask: "Task", historyOpenApproval: "Approval", historyOpenMember: "Member",
today: "Today", yesterday: "Yesterday", justNow: "just now", ago: "ago",
sectionLabels: { …, history: "History" },
```

## `package.json`

```
"check:audit": "node scripts/check-audit.mjs",
```

## `DESIGN.md`

Under Agent Chat or a new "Member profile" heading: "History is a divider list
grouped by day with underlined text filters (All / Messages / Runs / Edits /
Shell / Handoffs / Approvals), a ghost Load more, and one outline Export
button. Rows are icon + sentence + a muted meta line (kind · time · links);
failures use the destructive colour on the text only. No cards, no badges."
