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

// Updates count conversations, decisions count unresolved requests. Reading an
// update must never acknowledge away a decision that still needs a person.
export function workAttentionCount({ replies = [], unreadChannels = [], approvals = [], handoffs = [], memoryProposals = [], vaultRequests = [], folderRequests = [], rows = [] } = {}) {
  return replies.length + unreadChannels.length + approvals.length + handoffs.length + memoryProposals.length + vaultRequests.length + folderRequests.length + workRowsNeedingYou(rows, handoffs).length;
}
