// Always-on members route plug-in (ADR-0125): "Keep working between
// messages". With the member's switch on, the bridge starts the next item
// on the member's agenda itself when the member is idle: a goal paused for a
// reason that is not a person's decision (resumed through the goal manager),
// else an open task from its work plan (an ordinary bridge run under the
// member's own engine, access and folders, the routine path). One item at a
// time, at most the daily cap a day, never within the idle period after the
// person's last message, and a person's message stops it at once.
//
// Routines and queued follow-ups are never started here: the scheduler
// (ADR-0110) and the queue dispatcher (ADR-0111) already start them.
//
//   GET  /api/agenda                  every member with settings, and today's starts
//   GET  /api/agenda/:memberId        one member
//   PUT  /api/agenda/:memberId        { enabled, dailyCap }
//   POST /api/agenda/:memberId/stop   stop the item the agenda started
//
// Storage: `<squadStateDir>/always-on.json` via server/agenda/store.mjs.

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { AgendaStore, DEFAULT_DAILY_CAP, dayKeyIn } from "../agenda/store.mjs";
import { STORE_FILE as WORK_FILE, workStoreFor } from "../work/store.mjs";
import { readPersistentJson } from "../persistent-json.mjs";
import { agendaTaskPrompt, nextAgendaItem } from "../../src/lib/work-plans.js";

export const name = "agenda";

const TICK_MS = Number(process.env.AUTOHAND_SQUAD_AGENDA_TICK_MS) || 30_000;
const IDLE_MS = Number.isFinite(Number(process.env.AUTOHAND_SQUAD_AGENDA_IDLE_MS)) && process.env.AUTOHAND_SQUAD_AGENDA_IDLE_MS !== "" ? Number(process.env.AUTOHAND_SQUAD_AGENDA_IDLE_MS) : 10 * 60_000;
export const PERSON_PAUSE_REASON = "Paused because you sent a message. Keep working between messages resumes it once the member is idle again.";

let store = null;
let bridgeContext = null;
let timer = null;
let ticking = false;
let listening = false;
const bootedAt = Date.now();
// memberId -> { key, kind, title, runId, goalId, startedAt }
const current = new Map();
// memberId -> ms of the person's last message to that member
const personAt = new Map();
// memberId -> one sentence on why nothing started, for the app
const waiting = new Map();

function log(ctx, severity, message, attributes = {}) {
  ctx.logEvent(severity, message, { "event.domain": "autohand.squad", ...attributes });
}

function today() {
  return dayKeyIn(new Date());
}

function publicState(memberId) {
  const settings = store.settings(memberId);
  const day = store.today(memberId, today());
  const starts = day.starts || [];
  const live = current.get(memberId) || null;
  const last = [...starts].reverse().find((item) => item.finishedAt) || null;
  return {
    memberId,
    enabled: settings.enabled,
    dailyCap: settings.dailyCap,
    today: { date: day.date, count: starts.length, cap: settings.dailyCap },
    current: live ? { key: live.key, kind: live.kind, title: live.title, runId: live.runId || "", goalId: live.goalId || "", startedAt: live.startedAt } : null,
    last: last ? { key: last.key, kind: last.kind, title: last.title, runId: last.runId || "", goalId: last.goalId || "", startedAt: last.at, finishedAt: last.finishedAt, status: last.status, reason: last.reason || "" } : null,
    waiting: settings.enabled ? waiting.get(memberId) || "" : "",
    idleMs: IDLE_MS,
  };
}

// The launch description the bridge already holds for a member: the copy
// any earlier chat or run registered (the routine path), else the saved
// member profile.
async function memberLaunch(ctx, memberId) {
  const state = await ctx.readChannelsState().catch(() => null);
  const record = state?.agentChannelAccess?.[memberId];
  const saved = ctx.agentsDir ? await readPersistentJson(join(ctx.agentsDir, memberId, "profile.json"), null).catch(() => null) : null;
  const agent = record && !record.removed && record.agent ? record.agent : saved;
  if (!agent) return null;
  const projects = Array.isArray(agent.projects) ? agent.projects : Array.isArray(saved?.projects) ? saved.projects : [];
  const workspace = String(agent.workspace || saved?.workspace || projects.find((project) => project?.path)?.path || "");
  return { agent: { ...agent, id: memberId }, profile: String(record?.profile || ""), workspace };
}

async function queuedFor(ctx, memberId) {
  const saved = await readPersistentJson(join(ctx.squadStateDir, "queues.json"), null).catch(() => null);
  return (Array.isArray(saved?.items) ? saved.items : []).some((item) => item?.memberId === memberId && ["queued", "running"].includes(item.status));
}

async function planTasks(ctx, memberId) {
  const work = workStoreFor(join(ctx.squadStateDir, WORK_FILE));
  await work.load();
  return work.tasks(memberId);
}

// ---------------------------------------------------------------------------
// The item in flight

async function settleIfFinished(ctx, memberId) {
  const live = current.get(memberId);
  if (!live) return false;
  let status = "";
  if (live.kind === "task") {
    const run = ctx.runs?.get?.(live.runId);
    if (!run) status = "interrupted";
    else if (!ctx.isLiveRun?.(run)) status = run.status || "completed";
  } else {
    const goal = await ctx.goals.get(live.goalId).catch(() => null);
    if (!goal) status = "interrupted";
    else if (goal.status !== "running") status = goal.status === "paused" ? "paused" : goal.status;
  }
  if (!status) return true;
  current.delete(memberId);
  await store.settleStart(memberId, live.key, { status, finishedAt: new Date().toISOString() });
  log(ctx, ctx.SEVERITY.INFO, `agenda: ${memberId} finished ${live.kind} ${live.title} (${status})`, { "event.name": "agenda.finished", "autohand.member.id": memberId, "autohand.agenda.kind": live.kind, "autohand.agenda.status": status, "autohand.run.id": live.runId || "" });
  ctx.emit("agenda.changed", { memberId });
  return false;
}

async function stopCurrent(ctx, memberId, reason) {
  const live = current.get(memberId);
  if (!live) return false;
  if (live.kind === "task" && live.runId) await ctx.stopRun?.(live.runId, reason).catch(() => false);
  if (live.kind === "goal" && live.goalId) await ctx.goals.pauseForMember(memberId, PERSON_PAUSE_REASON).catch(() => []);
  current.delete(memberId);
  await store.settleStart(memberId, live.key, { status: "stopped", finishedAt: new Date().toISOString(), reason });
  log(ctx, ctx.SEVERITY.INFO, `agenda: stopped ${live.title} for ${memberId}: ${reason}`, { "event.name": "agenda.stopped", "autohand.member.id": memberId, "autohand.run.id": live.runId || "" });
  ctx.emit("agenda.changed", { memberId });
  return true;
}

// ---------------------------------------------------------------------------
// One tick: for each member with the switch on, settle, then maybe start one.

async function considerMember(ctx, memberId, now) {
  if (await settleIfFinished(ctx, memberId)) return;
  const settings = store.settings(memberId);
  const lastPerson = Math.max(personAt.get(memberId) || 0, bootedAt);
  if (now - lastPerson < IDLE_MS) return void waiting.set(memberId, "Waiting for a quiet moment after your last message.");
  const day = store.today(memberId, today());
  if (day.starts.length >= settings.dailyCap) return void waiting.set(memberId, `Today's limit of ${settings.dailyCap} is reached.`);
  if ((await ctx.availability?.get?.(memberId, {}).catch(() => null))?.onBreak) return void waiting.set(memberId, "On a break.");
  if (await ctx.isMemberBusy?.(memberId)) return void waiting.set(memberId, "");
  if (await queuedFor(ctx, memberId)) return void waiting.set(memberId, "");
  const [tasks, goals] = await Promise.all([planTasks(ctx, memberId).catch(() => []), ctx.goals.list(memberId).catch(() => [])]);
  const attempted = new Set(day.starts.map((item) => item.key));
  const item = nextAgendaItem({ tasks, goals, attempted });
  if (!item) return void waiting.set(memberId, "Nothing open on the plan.");
  const startedAt = new Date().toISOString();
  if (item.kind === "goal") {
    await ctx.goals.control(item.goal.id, "resume");
    current.set(memberId, { key: item.key, kind: "goal", title: item.title, goalId: item.goal.id, startedAt });
    await store.recordStart(memberId, day.date, { at: startedAt, key: item.key, kind: "goal", title: item.title, goalId: item.goal.id, status: "running" });
  } else {
    const launch = await memberLaunch(ctx, memberId);
    if (!launch) return void waiting.set(memberId, "Send this member a message once so Squad can run it on its own.");
    if (!launch.workspace) return void waiting.set(memberId, "Give this member a folder so it can work on its own.");
    const run = await ctx.startRun({
      agentId: memberId,
      agent: launch.agent,
      profile: launch.profile,
      workspace: launch.workspace,
      prompt: agendaTaskPrompt(item.task),
      title: `On its own: ${item.title}`,
      mode: "prompt",
      requestId: `agenda-${randomUUID()}`,
      agenda: { key: item.key, taskId: item.task.id },
    });
    current.set(memberId, { key: item.key, kind: "task", title: item.title, runId: run.id, taskId: item.task.id, startedAt });
    await store.recordStart(memberId, day.date, { at: startedAt, key: item.key, kind: "task", title: item.title, runId: run.id, status: "running" });
  }
  waiting.delete(memberId);
  const live = current.get(memberId);
  log(ctx, ctx.SEVERITY.INFO, `agenda: ${memberId} started ${item.kind} ${item.title} on its own (${day.starts.length + 1} of ${settings.dailyCap} today)`, { "event.name": "agenda.started", "autohand.member.id": memberId, "autohand.agenda.kind": item.kind, "autohand.run.id": live.runId || "", "autohand.goal.id": live.goalId || "" });
  ctx.emit("agenda.started", { memberId, kind: item.kind, title: item.title, runId: live.runId || "", goalId: live.goalId || "" });
}

export async function tickAgenda(ctx = bridgeContext, { now = Date.now() } = {}) {
  if (ticking || !ctx) return;
  ticking = true;
  try {
    await store.ready;
    const members = new Set([...store.enabledMembers(), ...current.keys()]);
    for (const memberId of members) {
      try {
        if (!store.settings(memberId).enabled) {
          await stopCurrent(ctx, memberId, "Keep working between messages was turned off.");
          continue;
        }
        await considerMember(ctx, memberId, now);
      } catch (error) {
        waiting.set(memberId, `Could not start: ${error?.message || error}`);
        log(ctx, ctx.SEVERITY.WARN, `agenda: ${memberId} could not start: ${error?.message || error}`, { "event.name": "agenda.failed", "autohand.member.id": memberId });
      }
    }
  } finally {
    ticking = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void tickAgenda().catch(() => {}).finally(schedule);
  }, TICK_MS);
  timer.unref?.();
}

// ---------------------------------------------------------------------------
// Lifecycle

export async function init(ctx) {
  bridgeContext = ctx;
  if (!store) store = new AgendaStore(ctx.squadStateDir);
  await store.ready;
  // Starts recorded as running by a bridge that has since exited were cut short.
  for (const day of Object.values(store.state.days)) {
    for (const start of day?.starts || []) if (!start.finishedAt) Object.assign(start, { status: "interrupted", finishedAt: new Date().toISOString(), reason: "The bridge restarted." });
  }
  await store.save();
  if (!listening && ctx.events?.on) {
    ctx.events.on("chat.started", (event) => {
      const memberId = String(event?.memberId || "");
      if (!memberId || !event.person) return;
      personAt.set(memberId, Date.now());
      if (current.has(memberId)) void stopCurrent(bridgeContext, memberId, "You sent a message.").catch(() => {});
    });
    ctx.events.on("chat.finished", (event) => {
      const memberId = String(event?.memberId || "");
      if (memberId && personAt.has(memberId)) personAt.set(memberId, Math.max(personAt.get(memberId), Date.now()));
    });
    listening = true;
  }
  schedule();
  log(ctx, ctx.SEVERITY.INFO, `agenda loaded: ${store.enabledMembers().length} members keep working between messages`, { "event.name": "agenda.loaded" });
}

// ---------------------------------------------------------------------------
// Routes

const MEMBER = /^\/api\/agenda\/([^/]+)$/;
const MEMBER_STOP = /^\/api\/agenda\/([^/]+)\/stop$/;

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function handle(req, res, url, ctx) {
  const path = url.pathname;
  if (path !== "/api/agenda" && !path.startsWith("/api/agenda/")) return false;
  if (!store) store = new AgendaStore(ctx.squadStateDir);
  await store.ready;

  if (path === "/api/agenda" && req.method === "GET") {
    const ids = new Set([...Object.keys(store.state.members), ...current.keys()]);
    ctx.json(res, 200, { success: true, data: { members: [...ids].map(publicState), defaults: { dailyCap: DEFAULT_DAILY_CAP, idleMs: IDLE_MS } } });
    return true;
  }

  let match = path.match(MEMBER_STOP);
  if (match && req.method === "POST") {
    const memberId = decode(match[1]);
    const stopped = await stopCurrent(ctx, memberId, "Stopped by you.");
    // A person's stop counts as their message: the idle period starts again.
    personAt.set(memberId, Date.now());
    ctx.json(res, 200, { success: true, data: { stopped, ...publicState(memberId) } });
    return true;
  }

  match = path.match(MEMBER);
  if (match) {
    const memberId = decode(match[1]).trim();
    if (!memberId) return false;
    if (req.method === "GET") {
      ctx.json(res, 200, { success: true, data: publicState(memberId) });
      return true;
    }
    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await ctx.readBody(req);
      const patch = {};
      if (body?.enabled !== undefined) patch.enabled = body.enabled === true;
      if (body?.dailyCap !== undefined) patch.dailyCap = body.dailyCap;
      const settings = await store.setSettings(memberId, patch);
      if (!settings.enabled) await stopCurrent(ctx, memberId, "Keep working between messages was turned off.");
      log(ctx, ctx.SEVERITY.INFO, `agenda: ${memberId} keep working ${settings.enabled ? "on" : "off"} (cap ${settings.dailyCap})`, { "event.name": "agenda.settings", "autohand.member.id": memberId, "autohand.agenda.enabled": settings.enabled });
      ctx.emit("agenda.changed", { memberId });
      if (settings.enabled) setImmediate(() => void tickAgenda().catch(() => {}));
      ctx.json(res, 200, { success: true, data: publicState(memberId) });
      return true;
    }
  }
  return false;
}
