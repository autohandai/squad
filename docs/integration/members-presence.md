# Members: presence and stop (issue #35, ADR-0016)

Module files (owned by the module, no monolith edits):

- `server/members/presence.mjs` — `derivePresence()`, `liveRunsForMember()` (pure).
- `server/routes/members.route.mjs` — auto-loaded route plug-in.
- `src/lib/presence-states.js` — `presenceFor()`, `presenceMeta()`, `presenceOrder()`, `presenceDescription()` (pure).
- `src/components/members/PresenceDot.jsx` — `PresenceDot`, `PresenceLabel`.
- `src/components/members/StopMemberButton.jsx` — `StopMemberButton`.
- `scripts/check-members-presence.mjs` — Node check.

## Routes

| Route | Response `data` |
| --- | --- |
| `GET /api/members/presence` | `{ at, sessions: { active, busy }, presence: { [memberId]: { state, since, activeRuns, sessionIdleMs } } }` — `state` is `working`, `online`, `idle`, `offline` |
| `POST /api/members/:id/stop` | `{ memberId, closedSessions, stoppedRuns, runIds }` — answers within 2 s; runs are marked `stopped` before the response |

Presence reads `ctx.sdkSessions.stats()`, `ctx.runs`, and member ids/status from
`~/.autohand/squad/web-status.json` (the snapshot `App.jsx` already posts every
15 s). A member the bridge has never seen has no entry; `presenceFor()` falls
back to the stored member status for that case.

Events emitted: `member.stopped { memberId, closedSessions, stoppedRuns }` and
one `run.finished { status: "stopped" }` per aborted run.

## `App.jsx` wiring

**1. Poll.** Next to the runs poller (`useEffect` around `loadRuns`, ~line 4884):

```js
const [presenceMap, setPresenceMap] = useState({});
const [bridgeReachable, setBridgeReachable] = useState(true);
useEffect(() => {
  let cancelled = false;
  async function loadPresence() {
    try {
      const data = await api("/api/members/presence");
      if (!cancelled) { setPresenceMap(data.presence || {}); setBridgeReachable(true); }
    } catch {
      if (!cancelled) setBridgeReachable(false); // keep the last map; dots show Unknown
    }
  }
  loadPresence();
  const timer = window.setInterval(loadPresence, 10_000);
  return () => { cancelled = true; window.clearInterval(timer); };
}, []);
```

Also re-run `loadPresence()` right after `stopMember()` resolves (below) so the
dot goes grey without waiting for the next tick.

**2. Presence entry per member.** Replace the body of `memberPresenceForAgent`
(~line 4209) callers with:

```js
import { presenceFor, presenceMeta } from "@/lib/presence-states";
const entryFor = (agent) => presenceFor(agent.id, presenceMap, { bridgeReachable, memberStatus: agent.status });
```

Keep `memberPresenceForAgent` only for the "Queued" task hint if wanted; the
directory (`squadStatusMeta`, ~line 13013) can keep its task-derived labels.

**3. Replace the dots** (`MemberPresenceBadge`, ~line 4290, and inline dots):

| Spot | Today | Change |
| --- | --- | --- |
| Collapsed rail, ~line 9371–9392 | `memberPresenceForAgent(...)` + `<MemberPresenceBadge>` | `const entry = entryFor(agent)`; `<PresenceDot entry={entry} copy={copy} className="absolute bottom-0 right-0" />`; tooltip uses `presenceDescription(entry, copy)` and `aria-label` uses `presenceMeta(entry.state, copy).label` |
| `WorkspaceSidebar` prop, ~line 9625 | `presenceFor={(agent) => memberPresenceForAgent(...)}` | `presenceFor={(agent) => presenceMeta(entryFor(agent).state, copy)}` — the sidebar reads `presence.className` and `presence.label`; pass `{ ...meta, className: meta.dotClassName }`, or swap the inline `<span>` in `src/components/shell/WorkspaceSidebar.jsx` ~line 243 for `<PresenceDot entry={presence} size="xs" className="absolute -bottom-0.5 -right-0.5" />` |
| Mention picker items, ~line 10258–10272 | `.filter(item.status === "online")` and `presence: chatSendingByAgent ? {...} : memberPresenceForAgent(...)` | filter with `entryFor(item).state !== "offline"`; set `presence: entryFor(item)`; in the row (~line 11721) render `<PresenceDot entry={item.presence} size="xs" ring={false} copy={copy} />` |
| Chat header meta line, ~line 10976–10977 | hard-coded `bg-primary`/`bg-emerald-500`/`bg-destructive` + "Working"/"Online" | `<PresenceLabel entry={chatSending ? { state: "working" } : entryFor(agent)} copy={copy} />`; keep the `copy.autohandMissing` text when `!runtime?.available` |
| Profile preview, ~line 15512, and Profile page, ~line 20740 | `<span className="size-2 rounded-full bg-primary" />{copy.online}` | `<PresenceLabel entry={entryFor(agent)} copy={copy} />` (pass `presenceMap` and `bridgeReachable` down as props, or `entryFor`) |
| Directory rows (`squadStatusMeta`) | task-derived | optional: when the task status is `available`/`online`, use `presenceMeta(entryFor(agent).state, copy)` so Idle and Unknown appear there too |

The `Unknown` dotted ring appears in every spot when the poll fails, which is
the acceptance criterion for "bridge down".

**4. Stop handler.** Next to `deleteAgent` (~line 5262):

```js
async function stopMember(agentId) {
  const result = await api(`/api/members/${encodeURIComponent(agentId)}/stop`, { method: "POST" });
  await loadPresence?.(); // or trigger the poll
  return result;
}
```

Render `StopMemberButton`:

- Chat header actions (~line 11032, beside **New chat**): `<StopMemberButton member={agent} onStop={stopMember} iconOnly copy={copy} disabled={!runtime?.available} />`. Hide it when `entryFor(agent).state` is `offline` or `unknown`.
- Profile page action row (~line 20749, next to the ghost **Edit** button): `<StopMemberButton member={agent} onStop={stopMember} copy={copy} />`.

**5. Delete stops first.** In `deleteAgent` (~line 5262) call
`await stopMember(agentId).catch(() => {})` before `setAgents(...)`. The directory
confirm dialog (~line 13279) gains one sentence: `copy.removeMemberStopsWork`.

## Copy keys (`src/locales.js`, `en` block; other locales fall back to the literal)

```js
presenceWorking: "Working",
presenceOnline: "Online",
presenceIdle: "Idle",
presenceOffline: "Offline",
presenceUnknown: "Unknown",
presenceBridgeDown: "Unknown: the local bridge is not reachable",
presenceRuns: "runs",
presenceFor: "for",
presenceMin: "min",
stopMember: "Stop",
stopMemberConfirm: "Stop {name}? Running work will end.",
stopMemberStopping: "Stopping…",
stopMemberFailed: "Could not stop this member.",
removeMemberStopsWork: "Running work stops first.",
```

## `package.json`

```json
"check:members-presence": "node scripts/check-members-presence.mjs",
```

## `DESIGN.md`

Under **Workspace Shell**, amend the presence sentence: "Presence dots have five
states: accent and breathing while working, green online, amber idle, grey
offline, and a dotted ring when the bridge is unreachable. Only working
animates." Under **Agent Chat** header: "**Stop** sits with the header actions
and confirms in a small popover ('Stop Kai? Running work will end.')."
