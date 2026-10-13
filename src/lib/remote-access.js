// Browser-side helpers for Telegram remote access (ADR-0088). Pure: no React,
// no DOM, importable from scripts/check-remote-access.mjs.
//
// Turns started from Telegram are owned by the bridge; the app reconciles
// them into the member's conversation the same way it reconciles goals
// (src/lib/member-goals.js), so a message sent from the phone shows up in
// the member chat as a user line followed by the member's reply.

export const NOTIFY_MODES = ["long", "all", "off"];

export function notifyModeLabel(mode, copy = {}) {
  switch (mode) {
    case "all": return copy.remoteNotifyAll || "Everything";
    case "off": return copy.remoteNotifyOff || "Off";
    default: return copy.remoteNotifyLong || "Long work";
  }
}

export function notifyModeDescription(mode, copy = {}) {
  switch (mode) {
    case "all": return copy.remoteNotifyAllDetail || "Every finished run and reply, plus everything that needs you.";
    case "off": return copy.remoteNotifyOffDetail || "Only handoffs, approvals, channel proposals and failures. Those always come through.";
    default: return copy.remoteNotifyLongDetail || "Runs that took a minute or more, plus everything that needs you.";
  }
}

/** One phrase for the settings nav: off, connecting, pairing, or who is paired. */
export function remoteAccessDetail(status = {}, copy = {}) {
  if (!status?.configured) return copy.remoteAccessOff || "Off";
  if (status.error && !status.polling) return copy.remoteAccessError || "Needs attention";
  if (status.paired) return status.paired.name || copy.remoteAccessPaired || "Paired";
  return copy.remoteAccessPairing || "Waiting to pair";
}

/** The status sentence under the token row. */
export function remoteAccessSentence(status = {}, copy = {}) {
  if (!status?.configured) return copy.remoteAccessNotConnected || "Not connected. Paste a bot token to start.";
  if (status.error) return status.error;
  if (status.polling && status.bot?.username) return `${copy.remotePollingAs || "Polling as"} @${status.bot.username}.`;
  return copy.remoteConnecting || "Connecting…";
}

export function isRemoteTurnRunning(turn) {
  return turn?.status === "running";
}

function timeLabel(iso, locale) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** The two conversation rows a remote turn produces. */
export function remoteTurnMessages(turn, locale = "en") {
  const running = isRemoteTurnRunning(turn);
  const time = timeLabel(turn.startedAt, locale);
  const user = {
    id: `remote-${turn.id}-u`,
    role: "user",
    body: turn.prompt,
    time,
    createdAt: turn.startedAt,
    startedAt: turn.startedAt,
    requestId: `remote-${turn.id}`,
    source: "telegram",
  };
  const agent = {
    id: `remote-${turn.id}-a`,
    role: "agent",
    body: turn.status === "completed" ? turn.reply || "The member finished without a written reply." : turn.status === "running" ? "Working on a message from Telegram…" : turn.error || "The turn did not finish.",
    status: running ? "loading" : turn.status === "failed" ? "error" : "complete",
    activityLabel: running ? "Working on a message from Telegram" : "",
    time,
    createdAt: turn.startedAt,
    startedAt: turn.startedAt,
    completedAt: running ? null : turn.finishedAt || turn.updatedAt,
    requestId: `remote-${turn.id}`,
    workspace: turn.workspace,
    remoteTurnId: turn.id,
    remoteUpdatedAt: turn.updatedAt,
    source: "telegram",
  };
  return [user, agent];
}

/** Reconcile bridge-owned remote turns into the members' conversations. */
export function reconcileRemoteTurns(current, turns, members, locale = "en") {
  let next = current;
  for (const turn of Array.isArray(turns) ? turns : []) {
    const member = (members || []).find((item) => item.id === turn.memberId);
    if (!member || !turn.id) continue;
    const messages = next[member.id] || [];
    const existing = messages.find((message) => message.remoteTurnId === turn.id);
    // /new in the app deliberately starts another conversation; older remote
    // turns stay in the bridge's history but must not refill it.
    if (!existing && member.conversationStartedAt && turn.startedAt < member.conversationStartedAt) continue;
    if (existing && existing.remoteUpdatedAt === turn.updatedAt) continue;
    const [user, agent] = remoteTurnMessages(turn, locale);
    if (next === current) next = { ...current };
    if (existing) {
      next[member.id] = messages.map((item) => (item.id === existing.id ? { ...existing, ...agent } : item));
    } else {
      const withoutUser = messages.some((item) => item.id === user.id) ? messages : insertByTime(messages, user);
      next[member.id] = insertByTime(withoutUser, agent);
    }
  }
  return next;
}

// Place a rehydrated row before the first message known to be later, so an
// old turn never becomes the newest message. Rows without a time stay put.
function insertByTime(messages, message) {
  const at = String(message.createdAt || "");
  const index = at ? messages.findIndex((item) => String(item.createdAt || item.startedAt || "") > at) : -1;
  return index < 0 ? [...messages, message] : [...messages.slice(0, index), message, ...messages.slice(index)];
}
