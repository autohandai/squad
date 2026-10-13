// "Your work plan" (ADR-0124): the block a member receives on every
// direct-message turn, next to "Earlier conversations" (ADR-0115), built
// from facts the bridge already holds: the member's tasks (work.json), its
// routines with the next occurrence and last outcome (routines.json), its
// goals (the goal manager) and the follow-ups queued for it (queues.json).
// Nothing is written. The text itself comes from src/lib/work-plans.js so
// the app can show exactly what the member is told.

import { join } from "node:path";

import { readPersistentJson } from "../persistent-json.mjs";
import { STORE_FILE as ROUTINES_FILE, activeRun, lastRun, normalizeRoutine } from "../routines/store.mjs";
import { describeSchedule, nextOccurrences } from "../routines/schedule.mjs";
import { schedulerNow } from "../routes/workflows.route.mjs";
import { STORE_FILE as WORK_FILE, workStoreFor } from "./store.mjs";
import { buildWorkPlanBlock } from "../../src/lib/work-plans.js";

export { buildWorkPlanBlock };

async function memberRoutines(squadStateDir, memberId, now) {
  const saved = await readPersistentJson(join(squadStateDir, ROUTINES_FILE), null).catch(() => null);
  const stamp = now.toISOString();
  return (Array.isArray(saved?.routines) ? saved.routines : [])
    .map((routine) => normalizeRoutine(routine, { now: stamp }))
    .filter((routine) => routine.memberId === memberId)
    .map((routine) => ({
      id: routine.id,
      title: routine.title,
      enabled: routine.enabled,
      schedule: routine.schedule,
      description: describeSchedule(routine.schedule),
      next: routine.enabled ? nextOccurrences(routine.schedule, now, 1).map((date) => date.toISOString()) : [],
      activeRun: activeRun(routine),
      lastRun: lastRun(routine),
    }));
}

async function queuedFollowUps(squadStateDir, memberId) {
  const saved = await readPersistentJson(join(squadStateDir, "queues.json"), null).catch(() => null);
  return (Array.isArray(saved?.items) ? saved.items : []).filter((item) => item && item.memberId === memberId && item.status === "queued").map((item) => ({ text: String(item.text || item.prompt || ""), status: "queued" }));
}

/** Gather the sources from the bridge. Every read is optional; a missing one contributes nothing. */
export async function collectWorkPlanSources({ memberId, squadStateDir, goals = null, memberName = "" }) {
  const id = String(memberId || "");
  const now = schedulerNow();
  const store = workStoreFor(join(squadStateDir, WORK_FILE));
  const [tasks, routines, goalList, queued] = await Promise.all([
    store.load().then(() => store.tasks(id)).catch(() => []),
    memberRoutines(squadStateDir, id, now).catch(() => []),
    goals?.list ? goals.list(id).catch(() => []) : [],
    queuedFollowUps(squadStateDir, id).catch(() => []),
  ]);
  return { memberId: id, memberName, tasks, routines, goals: goalList, queued, now: now.getTime() };
}

/** The block and its counts for one member; `{ text: "", counts }` never happens: an empty plan still says so. */
export async function workPlanFor(options) {
  const sources = await collectWorkPlanSources(options);
  return buildWorkPlanBlock(sources, { now: sources.now });
}
