// What Needs you shows and counts (ADR-0121). Pure, so the composition of the
// page can be checked without a browser: decisions first, grouped by kind and
// newest first inside a kind; unread replies as one list; work that stopped
// as one line per record with never a command line on it.

export const WORK_VIEWS = ["needs-you", "in-progress", "all"];
export const WORK_VIEW_STORAGE_KEY = "autohandSquad.v1.workView";

export function workViewForRoute(route, savedView = "needs-you") {
  const [path, query = ""] = String(route || "").split("?");
  const params = new URLSearchParams(query);
  if (WORK_VIEWS.includes(params.get("view"))) return params.get("view");
  if (params.has("task") || params.has("run") || params.has("eval")) return "all";
  if (path === "/inbox" || params.has("handoff")) return "needs-you";
  if (path === "/mission-control") return "all";
  return WORK_VIEWS.includes(savedView) ? savedView : "needs-you";
}

export function workRowsNeedingYou(rows, handoffs = []) {
  const handoffTaskIds = new Set(handoffs.map((item) => item.task?.id).filter(Boolean));
  return rows.filter((row) =>
    !handoffTaskIds.has(row.task?.id) &&
    (["blocked", "failed", "handoff-pending"].includes(row.status) ||
      (!["completed", "cancelled"].includes(row.status) && Boolean(row.blocker)))
  );
}

export function workRowsInProgress(rows) {
  return rows.filter((row) => ["running", "launching", "pending"].includes(row.status) && !row.blocker);
}

// ---- decisions --------------------------------------------------------------

/**
 * The order decisions appear in: what blocks a member's work first (a step
 * waiting for approval, a secret or a payment, a folder), then handoffs, then
 * what a member proposes (a channel, a routine, a memory). Inside a kind,
 * newest first.
 */
export const DECISION_KINDS = ["approval", "vault", "folder", "handoff", "channel", "routine", "memory"];

const newestFirst = (a, b) => String(b.at || "").localeCompare(String(a.at || ""));

/** Needs-you rows for member-opened channel proposals (ADR-0075). */
export function channelProposalRows(actions = [], members = []) {
  const nameOf = (id) => members.find((member) => member.id === id)?.name || "A member";
  return (Array.isArray(actions) ? actions : [])
    .filter((item) => item?.status === "proposed")
    .map((item) => ({
      id: `channel-${item.id}`,
      proposal: item,
      memberId: item.actorId,
      title: `${nameOf(item.actorId)} proposes #${item.action?.name || "a channel"}`,
      detail: item.action?.purpose || "A shared place to organise work.",
      who: nameOf(item.actorId),
      at: item.createdAt || "",
    }))
    .sort(newestFirst);
}

/** Needs-you rows for routines a member proposed from chat (ADR-0110). */
export function routineProposalRows(proposals = [], members = []) {
  const nameOf = (id) => members.find((member) => member.id === id)?.name || "A member";
  return (Array.isArray(proposals) ? proposals : [])
    .filter((item) => item && (item.status === "proposed" || !item.status) && !item.expired)
    .map((item) => ({
      id: `routine-${item.id}`,
      proposal: item,
      memberId: item.memberId,
      title: `${nameOf(item.memberId)} proposes a routine: ${item.title || "untitled"}`,
      detail: [item.description, item.timeZone].filter(Boolean).join(" · "),
      who: nameOf(item.memberId),
      at: item.createdAt || "",
    }))
    .sort(newestFirst);
}

/** The action word a decision row carries, in the copy's words. */
export function decisionAction(kind, row = {}, copy = {}) {
  switch (kind) {
    case "approval": return copy.approve || "Approve";
    case "vault": return row.request?.type === "payment" ? copy.reviewPayment || "Decide payment" : copy.reviewSecret || "Open secure form";
    case "folder": return copy.decideFolder || "Allow or decline";
    case "handoff": return copy.reviewHandoff || "Review handoff";
    case "channel": return copy.approveChannel || "Approve channel";
    case "routine": return copy.confirmRoutine || "Confirm routine";
    case "memory": return copy.reviewMemory || "Review memory";
    default: return copy.open || "Open";
  }
}

/**
 * Every decision on one list, grouped by kind in DECISION_KINDS order and
 * newest first inside a kind. Each row keeps its source row under `item`
 * so the existing navigation targets still get what they expect.
 */
export function decisionRows({ approvals = [], vaultRequests = [], folderRequests = [], handoffs = [], channelProposals = [], routineProposals = [], memoryProposals = [] } = {}, copy = {}) {
  const byKind = { approval: approvals, vault: vaultRequests, folder: folderRequests, handoff: handoffs, channel: channelProposals, routine: routineProposals, memory: memoryProposals };
  const rows = [];
  for (const kind of DECISION_KINDS) {
    const list = [...(byKind[kind] || [])].sort(newestFirst);
    for (const item of list) rows.push({ kind, id: item.id, title: item.title, detail: item.detail || "", who: item.who || "", at: item.at || "", action: decisionAction(kind, item, copy), item });
  }
  return rows;
}

// ---- unread -----------------------------------------------------------------

/** Replies and unread channels as one list, newest first. */
export function unreadRows({ replies = [], unreadChannels = [] } = {}) {
  return [
    ...replies.map((item) => ({ kind: "reply", id: item.id, title: item.count > 1 ? `${item.name} · ${item.count}` : item.name, detail: item.preview || "", at: item.at || "", item })),
    ...unreadChannels.map((item) => ({ kind: "channel", id: `unread-${item.channel?.id}`, title: `#${item.channel?.name || ""}`, detail: item.preview || "", at: item.latestAt || "", item })),
  ].sort(newestFirst);
}

// ---- work that stopped --------------------------------------------------

/**
 * The person's question on one line, cut on a word boundary. The same rule
 * the Execution panel uses; repeated here so this module stays free of
 * browser-only imports and the checks can run it under node.
 */
export function cutOnWord(text, max = 88) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const head = value.slice(0, max + 1);
  const cut = head.lastIndexOf(" ");
  return `${(cut > max * 0.5 ? head.slice(0, cut) : value.slice(0, max)).replace(/[\s,;:.-]+$/, "")}…`;
}

/** "chat" | "goal" | "launched" for a run row, "task" otherwise. */
export function stoppedWorkKind(row = {}) {
  if (row.task) return "task";
  const run = row.run || {};
  if (run.mode === "chat" || run.kind === "chat") return "chat";
  if (run.mode === "goal" || run.kind === "goal") return "goal";
  return "launched";
}

/**
 * Work that stopped, one short row each: who, the person's question cut on
 * a word, the status word and when. A chat reply offers "Retry in chat" (the
 * conversation already has Retry on the failed reply); a launched run offers
 * Replay; a goal or a task opens the chat. The command line never appears
 * here: it belongs in Work details and the Execution panel.
 */
export function stoppedWorkRows(rows = [], handoffs = [], copy = {}) {
  const labels = copy.statusLabels || {};
  // Asking the same thing again after a failure left one row per attempt:
  // Alex's "so, tell me how many leads…" sat on the page twice, both opening
  // the same chat. Rows arrive newest first, so the first one is kept.
  const seenQuestions = new Set();
  return workRowsNeedingYou(rows, handoffs).map((row) => {
    const kind = stoppedWorkKind(row);
    const run = row.run || {};
    const rawTitle = kind === "task" ? row.task?.title : run.title && run.title !== run.command ? run.title : "";
    const fallback = kind === "chat" ? copy.chatRun || "chat reply" : kind === "goal" ? copy.runGoal || "goal" : kind === "launched" ? copy.runLaunched || "launched run" : copy.untitledTask || "Untitled task";
    const title = cutOnWord(rawTitle) || fallback;
    const status = row.status === "failed" || row.status === "blocked" ? row.status : row.blocker ? "blocked" : row.status;
    const action = kind === "chat" ? "retry-chat" : kind === "launched" && row.status === "failed" ? "replay" : "open-chat";
    // A reply's failure is in the conversation; a task's reason is the row's
    // own blocker. A launched run that failed says only that it failed.
    const reason = kind === "task" ? cutOnWord(row.blocker || "", 120) : "";
    return {
      id: row.id,
      kind,
      member: row.owner?.name || "",
      memberId: row.owner?.id || "",
      title,
      status,
      statusLabel: labels[status] || status,
      at: row.updatedAt || "",
      action,
      reason,
      detailPath: row.detailPath || "",
      row,
      repeatKey: kind === "chat" && rawTitle ? `${row.owner?.id || ""}\u0000${String(rawTitle).trim().toLowerCase()}` : "",
    };
  }).filter((row) => {
    if (!row.repeatKey) return true;
    if (seenQuestions.has(row.repeatKey)) return false;
    seenQuestions.add(row.repeatKey);
    return true;
  });
}

// ---- counts -------------------------------------------------------------

/**
 * The sidebar count: decision rows plus unread conversations, nothing else.
 * Work that stopped is on the page with its own count but a failed reply is
 * already an unread reply, so counting it again put the same thing on the
 * badge twice. Reading an update must never acknowledge away a decision.
 */
export function workAttentionCount({ replies = [], unreadChannels = [], approvals = [], handoffs = [], memoryProposals = [], vaultRequests = [], folderRequests = [], channelProposals = [], routineProposals = [] } = {}) {
  return decisionRows({ approvals, vaultRequests, folderRequests, handoffs, channelProposals, routineProposals, memoryProposals }).length + replies.length + unreadChannels.length;
}

/**
 * The one sentence under the title, naming only what is true now:
 * "2 decisions · 1 unread · 3 stopped · 1 working". Nothing waiting reads as
 * "You're caught up" so a quiet squad reads as quiet, not as four zeroes.
 */
export function needsYouSummary({ decisions = 0, unread = 0, stopped = 0, working = 0 } = {}, copy = {}, formatNumber = (value) => String(value)) {
  const say = (count, one, many) => String(count === 1 ? one : many).replace("{count}", formatNumber(count));
  const parts = [];
  if (decisions) parts.push(say(decisions, copy.workDecisionOne || "{count} decision", copy.workDecisionMany || "{count} decisions"));
  if (unread) parts.push(say(unread, copy.workUnreadOne || "{count} unread", copy.workUnreadMany || "{count} unread"));
  if (stopped) parts.push(say(stopped, copy.workStoppedOne || "{count} stopped", copy.workStoppedMany || "{count} stopped"));
  if (working) parts.push(say(working, copy.workWorkingOne || "{count} working", copy.workWorkingMany || "{count} working"));
  if (!parts.length) return copy.workCaughtUp || "You're caught up. Nothing needs you right now.";
  return parts.join(" · ");
}
