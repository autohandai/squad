import { routineDraft, scheduleKindLabel } from './routines.js';

/** One read model for every Automation surface. Bridge schedules win over
 * stale browser copies; unlinked manual/event/webhook records remain usable. */
export function automationAgenda(local = [], routines = []) {
  const byRoutine = new Map(local.filter(item => item.routineId).map(item => [item.routineId, item]));
  const scheduled = routines.map(routine => {
    const previous = byRoutine.get(routine.id) || local.find(item => item.id === routine.legacyAutomationId);
    return {
      ...previous,
      id: previous?.id || routine.id,
      routineId: routine.id,
      agentId: routine.memberId,
      name: routine.title,
      prompt: routine.instructions,
      description: routine.instructions,
      workspace: routine.workspace,
      target: routine.workspace,
      model: routine.model || 'auto',
      workspaceSource: previous?.workspaceSource || 'local',
      triggerType: 'schedule',
      routine: routineDraft(routine.schedule, { maxRunMinutes: routine.maxRunMinutes }),
      schedule: routine.description || scheduleKindLabel(routine.schedule),
      status: routine.enabled ? 'active' : 'paused',
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
      lastRun: routine.lastRun?.finishedAt || routine.lastRunAt || null,
      runCount: (routine.runs || []).filter(run => !['queued', 'running', 'skipped', 'missed'].includes(run.status)).length,
      runHistory: routine.runs || [],
      record: routine,
    };
  });
  const projectedIds = new Set(scheduled.map(item => item.id));
  return [...scheduled, ...local.filter(item => !item.routineId && !projectedIds.has(item.id))];
}

/** Deliver the saved answer once, including runs completed while the app
 * was closed. Never manufacture an answer from a run title or placeholder. */
// Only recent runs become direct messages: a routine's whole recorded history
// (forty daily runs) arriving in a fresh window, or after New chat cleared
// the conversation, flooded it with old answers (lane bba3108, ported).
export const AUTOMATION_REPLY_RECENT_MS = 2 * 24 * 60 * 60 * 1000;
export function reconcileAutomationReplies(conversations, routines = [], { now = Date.now(), recentMs = AUTOMATION_REPLY_RECENT_MS, startedAt = {} } = {}) {
  let next = conversations;
  for (const routine of routines) {
    if (routine.destination?.channelId) continue;
    const messages = next[routine.memberId] || [];
    const ids = new Set(messages.map(message => message.id));
    const since = Math.max(now - recentMs, Date.parse(startedAt[routine.memberId] || '') || 0);
    const additions = (routine.runs || []).filter(run => run.status === 'completed' && run.reply?.trim() && !ids.has(`automation-result-${run.id}`) && (Date.parse(run.finishedAt || '') || 0) >= since).map(run => ({
      id: `automation-result-${run.id}`, role: 'agent', status: 'complete', body: run.reply,
      source: 'automation', routineId: routine.id, runtimeId: run.memberRunId,
      startedAt: run.startedAt, completedAt: run.finishedAt, createdAt: run.finishedAt,
      time: new Date(run.finishedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      workspace: routine.workspace,
    })).reverse();
    if (!additions.length) continue;
    if (next === conversations) next = { ...conversations };
    next[routine.memberId] = [...messages, ...additions];
  }
  return next;
}
