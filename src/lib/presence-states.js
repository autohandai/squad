// Presence states for member dots (ADR-0016). Pure: no React, no DOM, so
// scripts/check-members-presence.mjs can import it under Node.
//
// The bridge's GET /api/members/presence returns `{ presence: { [id]: entry } }`
// with `entry.state` in PRESENCE_ORDER. This module turns a state into what
// the UI needs (label, dot classes, sort order) and answers for members the
// bridge has not seen, or cannot be asked because it is down.

export const PRESENCE_ORDER = ["working", "online", "idle", "offline", "unknown"];

// Mirrors OFFLINE_MEMBER_STATUSES in src/App.jsx: a stored member status
// that means "not available" regardless of processes.
const OFFLINE_MEMBER_STATUSES = new Set(["offline", "archived", "disabled"]);

// Colours follow DESIGN.md: accent for work in progress, green for
// available, muted for idle and offline. Unknown draws no fill at all so a
// bridge outage never looks like a member being away.
const STATES = {
  working: { copyKey: "presenceWorking", label: "Working", dotClassName: "bg-primary", textClassName: "text-primary", pulse: true, ring: false },
  online: { copyKey: "presenceOnline", label: "Online", dotClassName: "bg-emerald-500", textClassName: "text-emerald-700 dark:text-emerald-300", pulse: false, ring: false },
  idle: { copyKey: "presenceIdle", label: "Idle", dotClassName: "bg-amber-500", textClassName: "text-amber-700 dark:text-amber-300", pulse: false, ring: false },
  offline: { copyKey: "presenceOffline", label: "Offline", dotClassName: "bg-muted-foreground/45", textClassName: "text-muted-foreground", pulse: false, ring: false },
  unknown: { copyKey: "presenceUnknown", label: "Unknown", dotClassName: "bg-transparent border border-dotted border-muted-foreground/70", textClassName: "text-muted-foreground", pulse: false, ring: true },
};

export function normalizePresenceState(state) {
  const value = String(state || "").toLowerCase();
  return PRESENCE_ORDER.includes(value) ? value : "unknown";
}

/** Sort key: working first, unknown last. */
export function presenceOrder(state) {
  return PRESENCE_ORDER.indexOf(normalizePresenceState(state));
}

/**
 * Presentation for one state. `copy` is the locale block; the component
 * falls back to the English literal when a key is missing.
 */
export function presenceMeta(state, copy = {}) {
  const key = normalizePresenceState(state);
  const meta = STATES[key];
  return {
    state: key,
    label: copy[meta.copyKey] || meta.label,
    dotClassName: meta.dotClassName,
    textClassName: meta.textClassName,
    pulse: meta.pulse,
    ring: meta.ring,
    order: PRESENCE_ORDER.indexOf(key),
  };
}

/**
 * Presence entry for a member.
 *
 * - bridge unreachable → `unknown`, whatever the map says (it is stale).
 * - member missing from the map (snapshot not posted yet) → derived from the
 *   member's stored status so a freshly created member shows Online, not a
 *   dotted ring, for the first poll interval.
 */
export function presenceFor(memberId, presenceMap, { bridgeReachable = true, memberStatus = "online" } = {}) {
  if (!bridgeReachable) return { state: "unknown", since: null, activeRuns: 0, sessionIdleMs: null };
  const entry = presenceMap && memberId ? presenceMap[String(memberId).trim()] : null;
  if (entry?.state) return { since: null, activeRuns: 0, sessionIdleMs: null, ...entry, state: normalizePresenceState(entry.state) };
  const stored = String(memberStatus || "online").toLowerCase();
  return { state: OFFLINE_MEMBER_STATUSES.has(stored) ? "offline" : "online", since: null, activeRuns: 0, sessionIdleMs: null };
}

/** One sentence for tooltips: "Working · 2 runs" / "Idle for 4 min". */
export function presenceDescription(entry, copy = {}, now = Date.now()) {
  const meta = presenceMeta(entry?.state, copy);
  if (meta.state === "working" && entry?.activeRuns > 1) return `${meta.label} · ${entry.activeRuns} ${copy.presenceRuns || "runs"}`;
  if (meta.state === "idle" && Number.isFinite(entry?.sessionIdleMs)) {
    const minutes = Math.max(1, Math.round(entry.sessionIdleMs / 60000));
    return `${meta.label} ${copy.presenceFor || "for"} ${minutes} ${copy.presenceMin || "min"}`;
  }
  if (meta.state === "unknown") return copy.presenceBridgeDown || "Unknown: the local bridge is not reachable";
  return meta.label;
}
