// Member routines route plug-in (ADR-0110): member automations with a real
// schedule kept on the bridge, run history, a run limit, and schedule
// proposals a member makes from chat.
//
// Timing. This module does not tick. It registers with the workflows
// scheduler (server/routes/workflows.route.mjs) and is called from that
// loop with the same clock; `tickRoutines` is exported for the check.
//
// Dispatch. A due routine starts through the shared bridge executor when the
// bridge knows the member (a channel-action copy registered by any earlier
// chat or run) and the routine names a workspace; it then runs with the app
// closed. Otherwise the run waits as an app dispatch, the way app-dispatched
// workflow steps do, and the routine row says "needs Squad open".
//
// Storage: `~/.autohand/squad/routines.json` via server/routines/store.mjs.

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { detectRecurringWork } from "../../src/lib/work-plans.js";

import { registerTickParticipant, schedulerNow, startBridgeMemberRun } from "./workflows.route.mjs";
import {
  ACTIVE_RUN_STATUSES,
  STORE_FILE,
  activeRun,
  createRoutinesStore,
  lastRun,
  normalizeProposal,
  normalizeRun,
  routineInputFrom,
  upsertRun,
  validateRoutine,
} from "../routines/store.mjs";
import {
  describeSchedule,
  formatOccurrence,
  isValidTimeZone,
  nextOccurrence,
  nextOccurrences,
  normalizeSchedule,
  validateSchedule,
  wallClockNow,
} from "../routines/schedule.mjs";

export const name = "routines";

const MAX_LATE_MS = 12 * 60 * 60_000;
const PROPOSAL_TTL_MS = 24 * 60 * 60_000;
const PROPOSAL_KEYS = new Set(["type", "title", "instructions", "schedule", "timezone", "timeZone"]);

let store = null;
let bridgeContext = null;
let listening = false;
let unregisterTick = null;

function log(ctx, severity, message, attributes = {}) {
  ctx.logEvent(severity, message, { "event.domain": "autohand.squad", ...attributes });
}

function runAttributes(routine, run, extra = {}) {
  return {
    "autohand.routine.id": routine.id,
    "autohand.routine.title": routine.title,
    "autohand.routine.run_id": run?.id || "",
    "autohand.routine.status": run?.status || "",
    "autohand.member.id": routine.memberId,
    ...extra,
  };
}

async function ensureStore(ctx) {
  if (!store) store = createRoutinesStore(join(ctx.squadStateDir, STORE_FILE), { now: () => schedulerNow().toISOString() });
  await store.load();
  return store;
}

function changed(ctx) {
  ctx.emit("routines.changed", {});
}

// Members the bridge can run on its own: any member a chat or run has
// registered with the channel-action manager (ADR-0075), which also gives
// the launch description `startRun` needs when the app is closed.
async function knownMembers(ctx) {
  const state = await ctx.readChannelsState().catch(() => null);
  const access = state?.agentChannelAccess && typeof state.agentChannelAccess === "object" ? state.agentChannelAccess : {};
  const known = new Map();
  for (const [id, record] of Object.entries(access)) if (record && !record.removed && record.agent) known.set(id, record);
  return known;
}

function canRunOnBridge(routine, known) {
  return Boolean(routine.workspace) && known.has(routine.memberId);
}

function routinePrompt(routine) {
  return routine.instructions;
}

function isoOrNull(date) {
  return date ? date.toISOString() : null;
}

function publicRoutine(routine, known, now = schedulerNow()) {
  return {
    ...routine,
    description: describeSchedule(routine.schedule),
    problems: validateSchedule(routine.schedule),
    needsApp: !canRunOnBridge(routine, known),
    next: nextOccurrences(routine.schedule, now, 3).map((date) => date.toISOString()),
    activeRun: activeRun(routine),
    lastRun: lastRun(routine),
  };
}

function publicProposal(proposal, now = schedulerNow()) {
  return {
    ...proposal,
    description: describeSchedule(proposal.schedule),
    timeZone: proposal.schedule?.timeZone || "",
    next: proposal.status === "proposed" ? nextOccurrences(proposal.schedule, now, 3).map((date) => date.toISOString()) : [],
    expired: Boolean(proposal.expiresAt && proposal.expiresAt < now.toISOString()),
  };
}

function describeDispatch(routine, run) {
  return {
    runId: run.id,
    routineId: routine.id,
    memberId: routine.memberId,
    title: routine.title,
    prompt: routinePrompt(routine),
    workspace: routine.workspace,
    model: routine.model,
    scheduledFor: run.scheduledFor,
    maxRunMinutes: routine.maxRunMinutes,
  };
}

// ---------------------------------------------------------------------------
// Runs

async function startRoutineRun(ctx, routine, { trigger, scheduledFor, now, known }) {
  const nowIso = now.toISOString();
  const run = normalizeRun({ trigger, scheduledFor, queuedAt: nowIso, status: "queued", dispatch: canRunOnBridge(routine, known) ? "bridge" : "app" }, routine.id);
  if (run.dispatch === "bridge") {
    try {
      const access = known.get(routine.memberId);
      const memberRun = await startBridgeMemberRun(ctx, {
        memberId: routine.memberId,
        agent: access?.agent,
        prompt: routinePrompt(routine),
        workspace: routine.workspace,
        title: routine.title,
        marker: { routineId: routine.id, routineRunId: run.id, ...(routine.model && routine.model !== "auto" ? { model: routine.model } : {}) },
      });
      run.memberRunId = memberRun?.id || "";
      run.status = "running";
      run.startedAt = nowIso;
      log(ctx, ctx.SEVERITY.INFO, `routine ${routine.title} started on the bridge (${trigger})`, runAttributes(routine, run, { "event.name": "routine.run.started", "autohand.run.id": run.memberRunId, "autohand.routine.trigger": trigger }));
    } catch (error) {
      run.status = "failed";
      run.finishedAt = nowIso;
      run.reason = `Could not start: ${error?.message || error}`;
      log(ctx, ctx.SEVERITY.ERROR, `routine ${routine.title} could not start: ${error?.message || error}`, runAttributes(routine, run, { "event.name": "routine.run.failed" }));
    }
  } else {
    run.reason = "Waiting for Squad to open.";
    log(ctx, ctx.SEVERITY.INFO, `routine ${routine.title} waits for the app to dispatch it (${trigger})`, runAttributes(routine, run, { "event.name": "routine.run.queued", "autohand.routine.trigger": trigger }));
  }
  ctx.emit("routine.run", { routineId: routine.id, routineTitle: routine.title, runId: run.id, memberId: routine.memberId, status: run.status, dispatch: run.dispatch, trigger });
  return { ...upsertRun(routine, run), lastRunAt: nowIso };
}

function settleRun(routine, run, patch) {
  return upsertRun(routine, { ...run, ...patch });
}

/** One scheduler window: fire, skip or miss every due routine, then enforce run limits. Exported for the check. */
export async function tickRoutines(ctx, { now = schedulerNow() } = {}) {
  await ensureStore(ctx);
  const known = await knownMembers(ctx);
  let dirty = false;
  const fired = [];
  for (const routine of store.routines()) {
    if (!routine.enabled) continue;
    if (!routine.nextAt) {
      const next = nextOccurrence(routine.schedule, now);
      if (next) {
        store.replaceRoutine({ ...routine, nextAt: next.toISOString() });
        dirty = true;
      }
      continue;
    }
    const due = new Date(routine.nextAt);
    if (!Number.isFinite(due.getTime()) || due.getTime() > now.getTime()) continue;
    let current = routine;
    const timeZone = routine.schedule.timeZone;
    if (now.getTime() - due.getTime() > MAX_LATE_MS) {
      current = upsertRun(current, normalizeRun({ trigger: "schedule", scheduledFor: due, queuedAt: now, finishedAt: now, status: "missed", reason: `Missed: the bridge was not running at ${formatOccurrence(due, timeZone)} (${timeZone}).` }, current.id));
      log(ctx, ctx.SEVERITY.WARN, `routine ${routine.title} missed ${due.toISOString()}`, runAttributes(routine, null, { "event.name": "routine.run.missed" }));
    } else if (activeRun(current)) {
      current = upsertRun(current, normalizeRun({ trigger: "schedule", scheduledFor: due, queuedAt: now, finishedAt: now, status: "skipped", reason: "Skipped: the previous run was still active." }, current.id));
      log(ctx, ctx.SEVERITY.INFO, `routine ${routine.title} skipped ${due.toISOString()}: previous run still active`, runAttributes(routine, activeRun(current), { "event.name": "routine.run.skipped" }));
    } else {
      current = await startRoutineRun(ctx, current, { trigger: "schedule", scheduledFor: due, now, known });
      fired.push({ routineId: routine.id, runId: current.runs[0]?.id || "" });
    }
    const next = nextOccurrence(current.schedule, now);
    store.replaceRoutine({ ...current, nextAt: isoOrNull(next), updatedAt: now.toISOString() });
    dirty = true;
  }
  if (await enforceRunLimits(ctx, now)) dirty = true;
  if (dirty) {
    await store.save();
    changed(ctx);
  }
  return fired;
}

async function enforceRunLimits(ctx, now) {
  let dirty = false;
  for (const routine of store.routines()) {
    for (const run of routine.runs || []) {
      if (run.status === "running" && routine.maxRunMinutes > 0 && run.startedAt && now.getTime() - Date.parse(run.startedAt) >= routine.maxRunMinutes * 60_000) {
        if (run.memberRunId) await ctx.stopRun?.(run.memberRunId, `routine run limit of ${routine.maxRunMinutes} min reached`).catch(() => false);
        store.replaceRoutine(settleRun(store.routine(routine.id), run, { status: "stopped", finishedAt: now.toISOString(), reason: `Stopped at the ${routine.maxRunMinutes} minute run limit.` }));
        log(ctx, ctx.SEVERITY.WARN, `routine ${routine.title} stopped at its ${routine.maxRunMinutes} minute run limit`, runAttributes(routine, run, { "event.name": "routine.run.stopped", "autohand.run.id": run.memberRunId }));
        dirty = true;
      } else if (run.status === "queued" && run.dispatch === "app" && run.queuedAt && now.getTime() - Date.parse(run.queuedAt) > MAX_LATE_MS) {
        store.replaceRoutine(settleRun(store.routine(routine.id), run, { status: "missed", finishedAt: now.toISOString(), reason: "Missed: Squad was not open within 12 hours." }));
        dirty = true;
      }
    }
  }
  return dirty;
}

function onMemberRunFinished(ctx, event) {
  const memberRunId = String(event?.runId || "");
  if (!memberRunId || !store?.state) return;
  for (const routine of store.routines()) {
    const run = (routine.runs || []).find((item) => item.memberRunId === memberRunId);
    if (!run) continue;
    if (run.status !== "running") return;
    const status = event.status === "completed" ? "completed" : event.status === "stopped" ? "stopped" : "failed";
    const nowIso = schedulerNow().toISOString();
    store.replaceRoutine(settleRun(routine, run, { status, finishedAt: nowIso, preview: String(event.title || "").slice(0, 400), reason: status === "failed" ? "The member run failed." : status === "stopped" ? "The member run was stopped." : "" }));
    log(ctx, status === "completed" ? ctx.SEVERITY.INFO : ctx.SEVERITY.WARN, `routine ${routine.title} ${status}`, runAttributes(routine, { ...run, status }, { "event.name": `routine.run.${status}`, "autohand.run.id": memberRunId }));
    ctx.emit("routine.finished", { routineId: routine.id, routineTitle: routine.title, runId: run.id, memberId: routine.memberId, status, memberRunId, preview: String(event.title || "").slice(0, 400) });
    void store.save().then(() => changed(ctx));
    return;
  }
}

/**
 * Attach a note to a routine's current or latest run (ADR-0124): the work
 * plan calls it when the member or the person marks the linked task done,
 * so the routine's history shows it. False when the routine has no runs.
 */
export async function noteRoutineRun(ctx, routineId, note) {
  await ensureStore(ctx);
  const routine = store.routine(String(routineId || ""));
  if (!routine) return false;
  const run = activeRun(routine) || lastRun(routine) || (routine.runs || [])[0];
  if (!run) return false;
  store.replaceRoutine(settleRun(routine, run, { note: String(note || "").slice(0, 400) }));
  await store.save();
  changed(ctx);
  return true;
}

async function recoverInterruptedRuns(ctx) {
  const nowIso = schedulerNow().toISOString();
  let dirty = false;
  for (const routine of store.routines()) {
    for (const run of routine.runs || []) {
      if (run.status !== "running") continue;
      const live = run.memberRunId && ctx.runs?.get?.(run.memberRunId);
      if (live && ctx.isLiveRun?.(live)) continue;
      store.replaceRoutine(settleRun(store.routine(routine.id), run, { status: "interrupted", finishedAt: nowIso, reason: "The bridge restarted during this run. It was not replayed." }));
      dirty = true;
    }
  }
  if (dirty) await store.save();
}

// ---------------------------------------------------------------------------
// Schedule proposals from chat (SQUAD_ACTION: {"type":"schedule", ...})

function receiptOf(proposal) {
  return { id: proposal.id, type: "schedule", actorId: proposal.memberId, status: proposal.status, message: proposal.message, title: proposal.title };
}

async function proposeSchedule({ id, context, raw, digest, signal, declined }) {
  const ctx = bridgeContext;
  await ensureStore(ctx);
  const now = schedulerNow();
  const existing = store.proposal(id);
  if (existing) {
    if (existing.digest !== digest) return { id, type: "schedule", actorId: context.actorId, status: "failed", message: "This request ID was already used for a different schedule proposal." };
    return receiptOf(existing);
  }
  const timeZone = raw.timezone || raw.timeZone || raw.schedule?.timeZone || "";
  const record = normalizeProposal({
    id,
    memberId: context.actorId,
    workspace: context.workspace,
    requestId: context.requestId,
    digest,
    title: raw.title,
    instructions: raw.instructions,
    schedule: { ...(raw.schedule && typeof raw.schedule === "object" ? raw.schedule : {}), timeZone },
    status: "proposed",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
  }, { now: now.toISOString() });
  try {
    if (signal?.aborted || declined) throw new Error("this turn was stopped before the proposal could be recorded");
    if (!context.identityValid) throw new Error("the action identity does not match the executing member");
    const extra = Object.keys(raw).filter((key) => !PROPOSAL_KEYS.has(key));
    if (extra.length) throw new Error("schedule proposals may only contain type, title, instructions, schedule and timezone");
    if (!record.title) throw new Error("give the proposed routine a title");
    if (!record.instructions) throw new Error("say what the routine should do");
    if (!isValidTimeZone(timeZone)) throw new Error("an IANA timezone such as Europe/London is required");
    if (record.schedule.kind === "interval" && !record.schedule.startDate) {
      const wall = wallClockNow(timeZone, now);
      record.schedule = normalizeSchedule({ ...record.schedule, startDate: wall.date, startTime: wall.time });
    }
    const problems = validateSchedule(record.schedule);
    if (problems.length) throw new Error(`the schedule is incomplete (${problems.join(", ")})`);
    const next = nextOccurrences(record.schedule, now, 3);
    if (!next.length) throw new Error("the schedule never runs");
    record.message = `Proposed routine “${record.title}”: ${describeSchedule(record.schedule)} (${timeZone}). Next: ${formatOccurrence(next[0], timeZone)}. Nothing is scheduled until you confirm it in Squad.`;
    log(ctx, ctx.SEVERITY.INFO, `routine proposed by ${context.actorId}: ${record.title}`, { "event.name": "routine.proposed", "autohand.member.id": context.actorId, "autohand.routine.proposal_id": id });
  } catch (error) {
    record.status = "failed";
    record.message = `Schedule proposal not recorded: ${error?.message || error}.`;
    log(ctx, ctx.SEVERITY.WARN, `routine proposal rejected: ${error?.message || error}`, { "event.name": "routine.proposal.rejected", "autohand.member.id": context.actorId });
  }
  store.replaceProposal(record);
  await store.save();
  changed(ctx);
  return receiptOf(record);
}

async function decideProposal(ctx, id, confirm) {
  const proposal = store.proposal(id);
  if (!proposal) throw Object.assign(new Error("schedule proposal not found"), { status: 404 });
  if (confirm && proposal.status === "confirmed") return { proposal, routine: store.routine(proposal.routineId) };
  if (!confirm && proposal.status === "declined") return { proposal, routine: null };
  if (proposal.status !== "proposed") throw Object.assign(new Error("this schedule proposal is already resolved"), { status: 409 });
  const now = schedulerNow();
  const nowIso = now.toISOString();
  let routine = null;
  if (confirm) {
    if (proposal.expiresAt && proposal.expiresAt < nowIso) throw Object.assign(new Error("this proposal expired; ask the member to propose it again"), { status: 409 });
    routine = routineInputFrom({ memberId: proposal.memberId, title: proposal.title, instructions: proposal.instructions, workspace: proposal.workspace, schedule: proposal.schedule, enabled: true }, null, { now: nowIso });
    const problems = [...validateRoutine(routine), ...validateSchedule(routine.schedule)];
    if (problems.length) throw Object.assign(new Error(`the proposal is incomplete: ${problems.join(", ")}`), { status: 409 });
    routine = { ...routine, source: "chat", proposalId: proposal.id, nextAt: isoOrNull(nextOccurrence(routine.schedule, now)) };
    store.replaceRoutine(routine);
    store.replaceProposal({ ...proposal, status: "confirmed", routineId: routine.id, message: "You confirmed this routine.", decidedAt: nowIso, updatedAt: nowIso });
    log(ctx, ctx.SEVERITY.INFO, `routine ${routine.title} confirmed from chat`, runAttributes(routine, null, { "event.name": "routine.confirmed", "autohand.routine.proposal_id": proposal.id }));
  } else {
    store.replaceProposal({ ...proposal, status: "declined", message: "You declined this schedule proposal.", decidedAt: nowIso, updatedAt: nowIso });
    log(ctx, ctx.SEVERITY.INFO, `routine proposal declined: ${proposal.title}`, { "event.name": "routine.declined", "autohand.routine.proposal_id": proposal.id, "autohand.member.id": proposal.memberId });
  }
  await store.save();
  changed(ctx);
  return { proposal: store.proposal(id), routine };
}

// ---------------------------------------------------------------------------
// Plain-English drafts (ADR-0125): the New Automation dialog's one sentence
// becomes a proposal through a bounded one-off run of the member itself, on
// its own engine, which must answer with the schedule action (or with one
// question). The run is an ordinary visible run; it neither resumes nor
// replaces the member's conversation session. The proposal it records is
// resolved at once as drafted, because the person confirms it by saving the
// dialog, not in Needs you.

const DRAFT_TIMEOUT_MS = Number(process.env.AUTOHAND_SQUAD_DRAFT_TIMEOUT_MS) || 180_000;
const DRAFT_TEXT_LIMIT = 2000;

function draftPrompt({ text, question, answer, timeZone, memberName }) {
  const followUp = question && answer ? `\nYou asked: "${question}". They answered: "${answer}".` : "";
  return `Draft an automation: ${text}${followUp}

The person typed the line above into Squad's New Automation dialog for you${memberName ? ` (${memberName})` : ""}. Turn it into one routine for yourself. Do not do the work now. Reply with exactly one schedule action line in the format from your instructions: a short title (under 60 characters), instructions written as what you will do on each run, the schedule, and the timezone (the person's is ${timeZone}). If the days or the time cannot be inferred at all, reply with exactly one short question instead and no action.`;
}

async function waitForRun(ctx, runId, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const run = ctx.runs?.get?.(runId);
    if (run && run.finishedAt && !ctx.isLiveRun?.(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await ctx.stopRun?.(runId, "automation draft took too long").catch(() => false);
  return null;
}

function lastQuestion(reply) {
  const text = String(reply || "").replace(/SQUAD_ACTION:.*$/gm, "").trim();
  const questions = text.match(/[^.!?\n]*\?/g);
  return (questions ? questions.at(-1) : text).trim().slice(0, 300);
}

async function draftAutomation(ctx, body, now) {
  const memberId = String(body?.memberId || "").trim();
  const text = String(body?.text || "").replace(/\s+/g, " ").trim().slice(0, DRAFT_TEXT_LIMIT);
  const workspace = String(body?.workspace || "").trim();
  if (!memberId) throw Object.assign(new Error("memberId is required"), { status: 400 });
  if (!text) throw Object.assign(new Error("say what should happen, and when"), { status: 400 });
  if (!workspace) throw Object.assign(new Error("choose a folder for the automation"), { status: 400 });
  const known = await knownMembers(ctx);
  const access = known.get(memberId);
  const agent = body?.agent && typeof body.agent === "object" && !Array.isArray(body.agent) ? { ...body.agent, id: memberId } : access?.agent;
  if (!agent) throw Object.assign(new Error("this member has not chatted yet; send it a message first"), { status: 409 });
  if (await ctx.isMemberBusy?.(memberId)) throw Object.assign(new Error(`${agent.name || "The member"} is working; draft again when the reply finishes`), { status: 409 });
  const timeZone = isValidTimeZone(body?.timeZone) ? body.timeZone : "UTC";
  const summary = await ctx.startRun({
    agentId: memberId,
    agent,
    profile: String(body?.profile || access?.profile || ""),
    workspace,
    prompt: draftPrompt({ text, question: String(body?.question || "").slice(0, 300), answer: String(body?.answer || "").slice(0, 600), timeZone, memberName: agent.name }),
    title: `Draft an automation: ${text}`.slice(0, 140),
    mode: "prompt",
    requestId: `draft-${randomUUID()}`,
    resumeSession: false,
    ephemeralSession: true,
  });
  const run = await waitForRun(ctx, summary.id, DRAFT_TIMEOUT_MS);
  if (!run) throw Object.assign(new Error(`${agent.name || "The member"} did not answer within ${Math.round(DRAFT_TIMEOUT_MS / 1000)} seconds`), { status: 504 });
  if (run.status !== "completed") throw Object.assign(new Error(`${agent.name || "The member"} could not draft it (${run.status})`), { status: 502, runId: run.id });
  await ensureStore(ctx);
  const action = (run.channelActions || []).find((item) => item?.type === "schedule" && item.status === "proposed");
  const proposal = action ? store.proposal(action.id) : null;
  const reply = String(run.reply || "").replace(/\n*Proposed routine “[\s\S]*$/, "").replace(/SQUAD_ACTION:.*$/gm, "").trim().slice(0, 600);
  if (proposal) {
    const nowIso = now.toISOString();
    store.replaceProposal({ ...proposal, status: "declined", message: "Drafted in New Automation; saving it there creates the routine.", decidedAt: nowIso, updatedAt: nowIso });
    await store.save();
    changed(ctx);
    log(ctx, ctx.SEVERITY.INFO, `automation drafted by ${memberId}: ${proposal.title}`, { "event.name": "routine.drafted", "autohand.member.id": memberId, "autohand.routine.proposal_id": proposal.id, "autohand.run.id": run.id });
    return { status: "proposed", runId: run.id, reply, draft: { title: proposal.title, instructions: proposal.instructions, schedule: proposal.schedule, timeZone: proposal.schedule.timeZone, description: describeSchedule(proposal.schedule), next: nextOccurrences(proposal.schedule, now, 3).map((date) => date.toISOString()) } };
  }
  const failed = (run.channelActions || []).find((item) => item?.type === "schedule" && item.status === "failed");
  if (/\?/.test(reply) && !failed) return { status: "question", runId: run.id, question: lastQuestion(reply) };
  const found = detectRecurringWork(text);
  if (found) {
    const schedule = normalizeSchedule({ ...found.schedule, timeZone });
    if (!validateSchedule(schedule).length) {
      return { status: "read-from-words", runId: run.id, reply: failed?.message || reply, draft: { title: found.title, instructions: found.instructions, schedule, timeZone, description: describeSchedule(schedule), next: nextOccurrences(schedule, now, 3).map((date) => date.toISOString()) } };
    }
  }
  return { status: "question", runId: run.id, question: failed?.message || lastQuestion(reply) || "When should this run?" };
}

// ---------------------------------------------------------------------------
// Lifecycle

export async function init(ctx) {
  bridgeContext = ctx;
  await ensureStore(ctx);
  await recoverInterruptedRuns(ctx);
  if (!listening && ctx.events?.on) {
    ctx.events.on("run.finished", (event) => onMemberRunFinished(bridgeContext, event));
    listening = true;
  }
  if (unregisterTick) unregisterTick();
  unregisterTick = registerTickParticipant((tickCtx, window) => tickRoutines(tickCtx, window));
  try {
    ctx.agentChannelActions?.registerHandler?.("schedule", proposeSchedule);
  } catch (error) {
    log(ctx, ctx.SEVERITY.WARN, `routines: schedule proposals unavailable: ${error?.message || error}`, { "event.name": "routine.proposals.unavailable" });
  }
  const enabled = store.routines().filter((routine) => routine.enabled).length;
  log(ctx, ctx.SEVERITY.INFO, `routines loaded: ${store.routines().length} (${enabled} enabled)`, { "event.name": "routine.store.loaded" });
}

// ---------------------------------------------------------------------------
// Routes

const ROUTINE = /^\/api\/routines\/([^/]+)$/;
const ROUTINE_RUN = /^\/api\/routines\/([^/]+)\/run$/;
const RUN_STEP = /^\/api\/routines\/runs\/([^/]+)\/(started|finished)$/;
const PROPOSAL_DECISION = /^\/api\/routines\/proposals\/([^/]+)\/(confirm|decline)$/;

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fail(ctx, res, status, error) {
  ctx.json(res, status, { success: false, error });
  return true;
}

function ok(ctx, res, status, data) {
  ctx.json(res, status, { success: true, data });
  return true;
}

function withIntervalAnchor(body, now) {
  const schedule = body?.schedule && typeof body.schedule === "object" ? body.schedule : {};
  if (schedule.kind !== "interval" || schedule.startDate) return body;
  const timeZone = isValidTimeZone(schedule.timeZone) ? schedule.timeZone : "UTC";
  const wall = wallClockNow(timeZone, now);
  return { ...body, schedule: { ...schedule, startDate: wall.date, startTime: schedule.startTime || wall.time } };
}

export async function handle(req, res, url, ctx) {
  const path = url.pathname;
  if (!path.startsWith("/api/routines")) return false;
  await ensureStore(ctx);
  const now = schedulerNow();

  if (path === "/api/routines" && req.method === "GET") {
    const known = await knownMembers(ctx);
    const memberId = String(url.searchParams.get("memberId") || "");
    const routines = store.routines().filter((routine) => !memberId || routine.memberId === memberId).map((routine) => publicRoutine(routine, known, now));
    return ok(ctx, res, 200, { routines, now: now.toISOString() });
  }

  if (path === "/api/routines" && req.method === "POST") {
    const body = withIntervalAnchor(await ctx.readBody(req), now);
    const routine = routineInputFrom(body, null, { now: now.toISOString(), defaultTimeZone: body?.timeZone });
    const problems = [...validateRoutine(routine), ...validateSchedule(routine.schedule).map((field) => `schedule.${field}`)];
    if (problems.length) return fail(ctx, res, 400, `routine is incomplete: ${problems.join(", ")}`);
    if (store.routine(routine.id)) return fail(ctx, res, 409, "routine id already exists");
    const saved = store.replaceRoutine({ ...routine, nextAt: isoOrNull(nextOccurrence(routine.schedule, now)) });
    await store.save();
    changed(ctx);
    log(ctx, ctx.SEVERITY.INFO, `routine ${saved.title} created`, runAttributes(saved, null, { "event.name": "routine.created", "autohand.routine.kind": saved.schedule.kind }));
    return ok(ctx, res, 201, publicRoutine(saved, await knownMembers(ctx), now));
  }

  // POST /api/routines/preview { schedule } — the rule in words and the next three dates.
  if (path === "/api/routines/preview" && req.method === "POST") {
    const body = withIntervalAnchor(await ctx.readBody(req), now);
    const schedule = normalizeSchedule(body?.schedule, { defaultTimeZone: body?.timeZone });
    const problems = validateSchedule(schedule);
    const next = problems.length ? [] : nextOccurrences(schedule, now, 3);
    return ok(ctx, res, 200, {
      schedule,
      problems,
      description: describeSchedule(schedule),
      timeZone: schedule.timeZone,
      next: next.map((date) => date.toISOString()),
      nextLabels: next.map((date) => formatOccurrence(date, schedule.timeZone)),
      now: now.toISOString(),
    });
  }

  // POST /api/routines/draft { memberId, text, workspace, timeZone, agent?, profile?, question?, answer? }
  if (path === "/api/routines/draft" && req.method === "POST") {
    try {
      return ok(ctx, res, 200, await draftAutomation(ctx, await ctx.readBody(req), now));
    } catch (error) {
      return fail(ctx, res, error.status || 500, error.message);
    }
  }

  // GET /api/routines/pending — queued runs the app has to dispatch.
  if (path === "/api/routines/pending" && req.method === "GET") {
    const dispatches = [];
    for (const routine of store.routines()) {
      for (const run of routine.runs || []) if (run.status === "queued" && run.dispatch === "app") dispatches.push(describeDispatch(routine, run));
    }
    return ok(ctx, res, 200, { dispatches });
  }

  if (path === "/api/routines/proposals" && req.method === "GET") {
    const memberId = String(url.searchParams.get("memberId") || "");
    const status = String(url.searchParams.get("status") || "");
    const proposals = store.proposals().filter((proposal) => (!memberId || proposal.memberId === memberId) && (!status || proposal.status === status)).map((proposal) => publicProposal(proposal, now));
    return ok(ctx, res, 200, { proposals });
  }

  let match = path.match(PROPOSAL_DECISION);
  if (match && req.method === "POST") {
    try {
      const result = await decideProposal(ctx, decode(match[1]), match[2] === "confirm");
      const known = await knownMembers(ctx);
      return ok(ctx, res, 200, { proposal: publicProposal(result.proposal, now), routine: result.routine ? publicRoutine(result.routine, known, now) : null });
    } catch (error) {
      return fail(ctx, res, error.status || 500, error.message);
    }
  }

  // POST /api/routines/runs/:runId/started | finished — bookkeeping for app-dispatched runs.
  match = path.match(RUN_STEP);
  if (match && req.method === "POST") {
    const runId = decode(match[1]);
    const routine = store.routines().find((item) => (item.runs || []).some((run) => run.id === runId));
    const run = routine?.runs.find((item) => item.id === runId);
    if (!routine || !run) return fail(ctx, res, 404, "routine run not found");
    const body = await ctx.readBody(req);
    const nowIso = now.toISOString();
    if (match[2] === "started") {
      if (run.status !== "queued") return fail(ctx, res, 409, `run is ${run.status}`);
      const started = { ...run, status: "running", startedAt: nowIso, memberRunId: String(body?.memberRunId || ""), reason: "" };
      store.replaceRoutine({ ...settleRun(routine, run, started), lastRunAt: nowIso });
      log(ctx, ctx.SEVERITY.INFO, `routine ${routine.title} started by the app`, runAttributes(routine, started, { "event.name": "routine.run.started", "autohand.run.id": started.memberRunId }));
    } else {
      if (!ACTIVE_RUN_STATUSES.includes(run.status)) return fail(ctx, res, 409, `run is ${run.status}`);
      const status = body?.status === "completed" ? "completed" : "failed";
      store.replaceRoutine(settleRun(routine, run, { status, finishedAt: nowIso, preview: String(body?.preview || "").slice(0, 400), reason: status === "failed" ? String(body?.reason || body?.preview || "The app reported a failure.").slice(0, 400) : "" }));
      log(ctx, status === "completed" ? ctx.SEVERITY.INFO : ctx.SEVERITY.WARN, `routine ${routine.title} ${status} (app)`, runAttributes(routine, { ...run, status }, { "event.name": `routine.run.${status}` }));
    }
    await store.save();
    changed(ctx);
    return ok(ctx, res, 200, publicRoutine(store.routine(routine.id), await knownMembers(ctx), now));
  }

  // POST /api/routines/:id/run — manual start through the same dispatch path.
  match = path.match(ROUTINE_RUN);
  if (match && req.method === "POST") {
    const routine = store.routine(decode(match[1]));
    if (!routine) return fail(ctx, res, 404, "routine not found");
    if (activeRun(routine)) return fail(ctx, res, 409, "the previous run is still active");
    const known = await knownMembers(ctx);
    const started = await startRoutineRun(ctx, routine, { trigger: "manual", scheduledFor: now, now, known });
    store.replaceRoutine({ ...started, updatedAt: now.toISOString() });
    await store.save();
    changed(ctx);
    const run = started.runs[0];
    return ok(ctx, res, 202, { routine: publicRoutine(started, known, now), run, dispatch: run.status === "queued" && run.dispatch === "app" ? describeDispatch(started, run) : null });
  }

  match = path.match(ROUTINE);
  if (match) {
    const existing = store.routine(decode(match[1]));
    if (!existing) return fail(ctx, res, 404, "routine not found");
    if (req.method === "GET") return ok(ctx, res, 200, publicRoutine(existing, await knownMembers(ctx), now));
    if (req.method === "PUT" || req.method === "PATCH") {
      const body = withIntervalAnchor(await ctx.readBody(req), now);
      const routine = routineInputFrom(body, existing, { now: now.toISOString(), defaultTimeZone: body?.timeZone });
      const problems = [...validateRoutine(routine), ...validateSchedule(routine.schedule).map((field) => `schedule.${field}`)];
      if (problems.length) return fail(ctx, res, 400, `routine is incomplete: ${problems.join(", ")}`);
      const scheduleChanged = JSON.stringify(routine.schedule) !== JSON.stringify(existing.schedule) || (routine.enabled && !existing.enabled);
      const saved = store.replaceRoutine({ ...routine, nextAt: scheduleChanged ? isoOrNull(nextOccurrence(routine.schedule, now)) : existing.nextAt });
      await store.save();
      changed(ctx);
      log(ctx, ctx.SEVERITY.INFO, `routine ${saved.title} updated`, runAttributes(saved, null, { "event.name": "routine.updated", "autohand.routine.enabled": saved.enabled }));
      return ok(ctx, res, 200, publicRoutine(saved, await knownMembers(ctx), now));
    }
    if (req.method === "DELETE") {
      const removed = store.removeRoutine(existing.id);
      await store.save();
      changed(ctx);
      log(ctx, ctx.SEVERITY.INFO, `routine ${existing.title} deleted`, runAttributes(existing, null, { "event.name": "routine.deleted" }));
      return ok(ctx, res, 200, removed);
    }
  }

  return false;
}
