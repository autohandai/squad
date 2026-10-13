/** A transient wait is not an answer and must not survive a terminal state. */
export function withoutThinkingPlaceholder(body) {
  return String(body || "").replace(/^[^\n]{1,120} is thinking(?:\.{3}|…)(?:\s*\n|\s*(?=This request was interrupted)|\s*$)/, "").trim();
}

/** An ordinary request cannot survive a bridge restart; durable goals recover separately. */
export function recoverInterruptedChats(conversations, serverStartedAt) {
  const restartedAt = Date.parse(serverStartedAt || "");
  if (!Number.isFinite(restartedAt)) return conversations;
  let next = conversations;
  for (const [memberId, messages] of Object.entries(conversations || {})) {
    if (!Array.isArray(messages)) continue;
    let changed = false;
    const recovered = messages.map((message) => {
      if (message?.interrupted && message.status === "error") {
        const body = withoutThinkingPlaceholder(message.body);
        if (body === message.body) return message;
        changed = true;
        return { ...message, body };
      }
      const beganAt = Date.parse(message?.startedAt || "");
      if (message?.status !== "loading" || message.goalId || !Number.isFinite(beganAt) || beganAt >= restartedAt) return message;
      changed = true;
      return { ...message, status: "error", interrupted: true, activityLabel: "", completedAt: serverStartedAt,
        body: `${withoutThinkingPlaceholder(message.body)}\n\nThis request was interrupted when Squad restarted. No final update was received. Retry to continue.`.trim(),
        ...(message.progress ? { progress: { ...message.progress, outcome: "interrupted" } } : {}) };
    });
    if (changed) { if (next === conversations) next = { ...conversations }; next[memberId] = recovered; }
  }
  return next;
}

/** Accepted browser-owned handoffs cannot remain active across a bridge epoch. */
export function recoverInterruptedHandoffs(tasks, serverStartedAt) {
  const restartedAt = Date.parse(serverStartedAt || "");
  if (!Array.isArray(tasks) || !Number.isFinite(restartedAt)) return tasks;
  let changed = false;
  const recovered = tasks.map(task => {
    if (!task || task.goalId || ["completed", "cancelled"].includes(task.status)) return task;
    const handoffs = Array.isArray(task.handoffs) ? task.handoffs : [];
    const interrupted = handoffs.filter(handoff => {
      if (!handoff || typeof handoff !== "object") return false;
      const acceptedAt = Date.parse(handoff.acceptedAt || handoff.createdAt || "");
      return handoff.status === "accepted" && (!Number.isFinite(acceptedAt) || acceptedAt < restartedAt);
    });
    if (!interrupted.length) return task;
    changed = true;
    const records = new Set(interrupted);
    const ids = new Set(interrupted.map(handoff => handoff.id).filter(id => typeof id === "string" && id));
    const reason = "Squad restarted before the accepted handoff returned a final result. Review saved evidence before retrying the checkpoint.";
    return {
      ...task, status: "blocked", updatedAt: serverStartedAt, summary: reason,
      handoffs: handoffs.map(handoff => records.has(handoff) ? { ...handoff, status: "failed", interrupted: true, failureReason: reason, updatedAt: serverStartedAt, completedAt: "" } : handoff),
      assignments: (Array.isArray(task.assignments) ? task.assignments : []).map(assignment => ids.has(assignment?.handoffId) ? { ...assignment, status: "failed", failureReason: reason, updatedAt: serverStartedAt } : assignment),
      timeline: [...(Array.isArray(task.timeline) ? task.timeline : []), ...interrupted.map(handoff => ({ id: `recovery-${handoff.id}-${serverStartedAt}`, type: "handoff.interrupted", evidenceType: "risk", handoffId: handoff.id, at: serverStartedAt, actorAgentId: handoff.toAgentId, targetAgentId: handoff.fromAgentId, summary: reason }))],
    };
  });
  return changed ? recovered : tasks;
}

/** Rebuild only a completed parent's result from saved child receipts, never execute work. */
export function recoverCompletedHandoffParents(tasks, at = new Date().toISOString()) {
  const returns = [];
  if (!Array.isArray(tasks)) return { tasks, returns };
  const next = tasks.map(task => {
    if (!task || task.goalId || ["completed", "cancelled"].includes(task.status) || !Array.isArray(task.handoffs)) return task;
    let handoffs = task.handoffs;
    // Children may themselves be recovered parents. A bounded bottom-up pass
    // reaches the root while cycles or unresolved children stay blocked.
    for (let pass = 0; pass < handoffs.length; pass++) {
      let changed = false;
      handoffs = handoffs.map(handoff => {
        if (handoff?.status !== "failed" || !handoff.waitingForChildren || !handoff.ownCompletedAt || !handoff.ownReply) return handoff;
        const children = handoffs.filter(child => child?.parentHandoffId === handoff.id);
        if (!children.length || children.some(child => child.status !== "completed" || !child.result)) return handoff;
        changed = true;
        const result = [handoff.ownReply, ...children.map(child => `${child.toAgentId} returned:\n${child.result}`)].join("\n\n");
        returns.push({ taskId: task.id, handoffId: handoff.id, fromAgentId: handoff.fromAgentId, toAgentId: handoff.toAgentId, result });
        return { ...handoff, status: "completed", result, failureReason: "", interrupted: false, waitingForChildren: false, completedAt: at, updatedAt: at };
      });
      if (!changed) break;
    }
    if (!returns.some(result => result.taskId === task.id)) return task;
    const completed = handoffs.every(handoff => ["completed", "cancelled", "rerouted"].includes(handoff?.status));
    const results = returns.filter(result => result.taskId === task.id);
    return { ...task, handoffs, status: completed ? "completed" : "blocked", updatedAt: at,
      ...(completed ? { agentId: task.originAgentId || task.agentId, currentOwnerId: task.originAgentId || task.currentOwnerId } : {}),
      assignments: (task.assignments || []).map(assignment => { const result = results.find(item => item.handoffId === assignment?.handoffId); return result ? { ...assignment, status: "completed", result: result.result, failureReason: "", updatedAt: at } : assignment; }),
      timeline: [...(task.timeline || []), ...results.map(result => ({ id: `recovered-result-${result.handoffId}-${at}`, type: "handoff.result", evidenceType: "handoff", handoffId: result.handoffId, at, actorAgentId: result.toAgentId, targetAgentId: result.fromAgentId, summary: "Recovered the completed result from saved child receipts; no source execution was repeated.", content: result.result }))],
    };
  });
  return { tasks: returns.length ? next : tasks, returns };
}
