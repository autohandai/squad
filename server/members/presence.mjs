// Member presence (ADR-0016), derived from what the bridge actually holds:
// the warm SDK session pool and the run table. The web app used to infer
// presence from tasks and chat messages, which cannot tell "idle but warm"
// from "no process at all" and has no notion of the bridge being away.
//
// Pure: no I/O, no clock access unless `now` is omitted. `derivePresence`
// is unit-checked by scripts/check-members-presence.mjs.

export const PRESENCE_STATES = ["working", "online", "idle", "offline", "unknown"];

// Mirrors LIVE_RUN_STATUSES / OFFLINE_MEMBER_STATUSES in src/App.jsx and
// isLiveRun() in server.mjs. Kept as literals here so the module stays free
// of the monolith.
const LIVE_RUN_STATUSES = new Set(["queued", "running", "launching"]);
const OFFLINE_MEMBER_STATUSES = new Set(["offline", "archived", "disabled"]);

function memberIdOf(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value[Symbol.iterator] === "function") return Array.from(value);
  return [];
}

function isoAt(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function earliestStart(runs) {
  const times = runs.map((run) => Date.parse(run?.startedAt || run?.createdAt || "")).filter(Number.isFinite);
  return times.length ? isoAt(Math.min(...times)) : null;
}

/**
 * Derive one presence entry per member.
 *
 * @param {object} input
 * @param {Array|{sessions: Array}} [input.sessions] `sdkSessions.stats()` or its `sessions` array
 *   (`{ agentId, busy, idleMs }`).
 * @param {Iterable|Map} [input.runs] run objects (`{ id, agentId, status, startedAt, title }`);
 *   a `Map` of runs is accepted as-is.
 * @param {Array} [input.members] `{ id, status }` rows, normally `web-status.json` members.
 * @param {boolean} [input.bridgeReachable=true] `false` marks every member `unknown`;
 *   the web app passes this when its poll fails.
 * @param {number} [input.now=Date.now()]
 * @returns {{[memberId: string]: {state: string, since: string|null, activeRuns: number, sessionIdleMs: number|null}}}
 */
export function derivePresence({ sessions = [], runs = [], members = [], bridgeReachable = true, now = Date.now() } = {}) {
  const sessionList = toArray(Array.isArray(sessions) ? sessions : sessions?.sessions);
  const runList = toArray(runs instanceof Map ? runs.values() : runs);
  const memberList = toArray(members);

  const sessionsByMember = new Map();
  for (const session of sessionList) {
    const id = memberIdOf(session?.agentId);
    if (!id) continue;
    if (!sessionsByMember.has(id)) sessionsByMember.set(id, []);
    sessionsByMember.get(id).push(session);
  }

  const liveRunsByMember = new Map();
  for (const run of runList) {
    const id = memberIdOf(run?.agentId || run?.agent_id);
    if (!id || !LIVE_RUN_STATUSES.has(String(run?.status || "").toLowerCase())) continue;
    if (!liveRunsByMember.has(id)) liveRunsByMember.set(id, []);
    liveRunsByMember.get(id).push(run);
  }

  const storedStatus = new Map();
  const lastActivity = new Map();
  for (const member of memberList) {
    const id = memberIdOf(member?.id);
    if (!id) continue;
    storedStatus.set(id, String(member?.status || "online").toLowerCase());
    if (member?.lastActivityAt) lastActivity.set(id, member.lastActivityAt);
  }

  // A member the bridge only knows through a run or a session still gets an
  // entry: the UI may not have posted its snapshot yet.
  const ids = new Set([...storedStatus.keys(), ...sessionsByMember.keys(), ...liveRunsByMember.keys()]);
  const result = {};
  for (const id of ids) {
    result[id] = presenceEntry({
      liveRuns: liveRunsByMember.get(id) || [],
      sessions: sessionsByMember.get(id) || [],
      status: storedStatus.get(id) || "online",
      lastActivityAt: lastActivity.get(id) || null,
      bridgeReachable,
      now,
    });
  }
  return result;
}

function presenceEntry({ liveRuns, sessions, status, lastActivityAt, bridgeReachable, now }) {
  const busySessions = sessions.filter((session) => session?.busy);
  const idleSessions = sessions.filter((session) => !session?.busy);
  // The pool reports how long since a session was last used; the most
  // recently used one is the member's "last seen" moment.
  const minIdleMs = sessions.length
    ? Math.min(...sessions.map((session) => (Number.isFinite(session?.idleMs) ? session.idleMs : 0)))
    : null;
  const base = { activeRuns: liveRuns.length, sessionIdleMs: minIdleMs };

  if (!bridgeReachable) return { state: "unknown", since: null, ...base };

  // A process doing work is the truth regardless of the stored status flag.
  if (liveRuns.length) return { state: "working", since: earliestStart(liveRuns) || isoAt(now), ...base };
  if (busySessions.length) return { state: "working", since: isoAt(now - (minIdleMs ?? 0)), ...base };

  // The user marked the member offline (or archived it). A warm session may
  // linger until the pool's idle sweep, but the user's choice wins over it.
  if (OFFLINE_MEMBER_STATUSES.has(status)) return { state: "offline", since: lastActivityAt, ...base };

  if (idleSessions.length) return { state: "idle", since: isoAt(now - (minIdleMs ?? 0)), ...base };
  return { state: "online", since: lastActivityAt, ...base };
}

/** Live runs that belong to `memberId`; the stop route acts on these. */
export function liveRunsForMember(runs, memberId) {
  const id = memberIdOf(memberId);
  return toArray(runs instanceof Map ? runs.values() : runs).filter(
    (run) => memberIdOf(run?.agentId || run?.agent_id) === id && LIVE_RUN_STATUSES.has(String(run?.status || "").toLowerCase())
  );
}
