// Goal state comes from the bridge, not from whether a streamed reply ended.
export function isGoalRunning(goal) {
  return goal?.status === "running";
}

export function latestMemberGoal(goals, memberId) {
  const matching = (Array.isArray(goals) ? goals : []).filter((goal) => goal.agentId === memberId);
  return matching.find(isGoalRunning) || matching.find((goal) => goal.status === "paused") || matching[0] || null;
}

export function goalProgress(goal) {
  return {
    items: (goal?.checklist || []).map((item) => ({ id: item.id, title: item.title, status: item.status })),
    summary: goal?.summary || "",
    outcome: goal?.status || "",
  };
}

export function goalMessagePatch(goal) {
  const running = isGoalRunning(goal);
  const status = running ? "loading" : goal.status === "failed" ? "error" : "complete";
  const summary = String(goal.summary || goal.latestReply || "").trim();
  const fallback = goal.status === "paused" ? `Goal paused${goal.pauseReason ? `: ${goal.pauseReason}` : "."}`
    : goal.status === "blocked" ? "Goal blocked. Your input is needed."
      : goal.status === "cancelled" ? "Goal cancelled."
        : running ? "Working towards the goal." : "No work summary was recorded.";
  return {
    goalId: goal.id,
    goal,
    goalUpdatedAt: goal.updatedAt,
    progress: goalProgress(goal),
    body: summary || fallback,
    status,
    activityLabel: running ? "Working towards the goal" : "",
    workspace: goal.workspace,
    startedAt: goal.startedAt,
    completedAt: running ? null : goal.finishedAt || goal.pausedAt || goal.updatedAt,
  };
}

/** Rehydrate/reconcile durable goal messages without duplicating live SSE rows. */
export function reconcileGoalMessages(current, goals, members, locale = "en") {
  let next = current;
  for (const goal of Array.isArray(goals) ? goals : []) {
    const member = members.find((item) => item.id === goal.agentId);
    if (!member || !goal.id) continue;
    const messages = next[member.id] || [];
    const existing = messages.find((message) => message.goalId === goal.id);
    // /new deliberately starts another conversation; old goals stay in the
    // bridge's history but must not refill the conversation just cleared.
    if (!existing && member.conversationStartedAt && goal.startedAt < member.conversationStartedAt) continue;
    if (existing?.goalUpdatedAt === goal.updatedAt && existing.goal?.status === goal.status) continue;
    const patch = goalMessagePatch(goal);
    // Polling must not replace an in-flight text delta with last turn's text.
    if (existing && isGoalRunning(goal) && existing.status === "loading") patch.body = existing.body;
    const message = {
      id: existing?.id || `goal-${goal.id}-a`, role: "agent",
      time: existing?.time || new Date(goal.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      createdAt: existing?.createdAt || goal.startedAt,
      ...existing, ...patch,
    };
    if (next === current) next = { ...current };
    next[member.id] = existing ? messages.map((item) => item.id === existing.id ? message : item) : insertByTime(messages, message);
  }
  return next;
}

// A goal rehydrated after its neighbours were saved must not become the
// newest message: place it before the first message that is known to be
// later. Messages without a timestamp are left where they are.
function insertByTime(messages, message) {
  const at = String(message.createdAt || "");
  const index = at ? messages.findIndex((item) => String(item.createdAt || item.startedAt || "") > at) : -1;
  return index < 0 ? [...messages, message] : [...messages.slice(0, index), message, ...messages.slice(index)];
}
