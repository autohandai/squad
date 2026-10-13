// Routine store (ADR-0110): member automations with a real schedule, their
// run history, and schedule proposals a member made from chat. Persisted as
// `routines.json` in the squad state directory through the same atomic
// rename as goals.json (server/persistent-json.mjs). Pure except for the
// file; the route owns timing and dispatch.
//
// Shapes
//   routine   { id, memberId, title, instructions, workspace, model, enabled, schedule,
//               maxRunMinutes, source: editor|chat, proposalId, nextAt, lastRunAt, runs,
//               createdAt, updatedAt }
//   run       { id, routineId, trigger: schedule|manual, scheduledFor, queuedAt, startedAt,
//               finishedAt, status, dispatch: bridge|app|"", memberRunId, reason, preview, note }
//   status    queued | running | completed | failed | stopped | skipped | missed | interrupted
//   proposal  { id, type: "schedule", memberId, workspace, requestId, digest, title,
//               instructions, schedule, status: proposed|confirmed|declined|failed, message,
//               routineId, createdAt, updatedAt, decidedAt, expiresAt }

import { randomUUID } from "node:crypto";

import { readPersistentJson, writePersistentJson } from "../persistent-json.mjs";
import { normalizeSchedule, MAX_RUN_MINUTES } from "./schedule.mjs";

export const STORE_FILE = "routines.json";
export const RUN_STATUSES = ["queued", "running", "completed", "failed", "stopped", "skipped", "missed", "interrupted"];
export const ACTIVE_RUN_STATUSES = ["queued", "running"];
export const PROPOSAL_STATUSES = ["proposed", "confirmed", "declined", "failed"];
export const MAX_RUNS_KEPT = 40;
export const MAX_TITLE = 120;
export const MAX_INSTRUCTIONS = 12000;

function text(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function createRoutineId() {
  return `routine-${randomUUID()}`;
}

export function createRunId() {
  return `rrun-${randomUUID()}`;
}

export function normalizeRun(input, routineId = "") {
  const source = input && typeof input === "object" ? input : {};
  return {
    id: text(source.id, 80) || createRunId(),
    routineId: text(source.routineId, 80) || routineId,
    trigger: source.trigger === "manual" ? "manual" : "schedule",
    scheduledFor: iso(source.scheduledFor),
    queuedAt: iso(source.queuedAt),
    startedAt: iso(source.startedAt),
    finishedAt: iso(source.finishedAt),
    status: RUN_STATUSES.includes(source.status) ? source.status : "failed",
    dispatch: ["bridge", "app"].includes(source.dispatch) ? source.dispatch : "",
    memberRunId: text(source.memberRunId, 80),
    reason: text(source.reason, 400),
    preview: text(source.preview, 400),
    // A note the work plan attaches (ADR-0124): "Marked done by the member".
    note: text(source.note, 400),
  };
}

export function normalizeRoutine(input, { now = new Date().toISOString(), defaultTimeZone = "UTC" } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const id = text(source.id, 80) || createRoutineId();
  const createdAt = iso(source.createdAt) || now;
  const minutes = Number(source.maxRunMinutes);
  return {
    id,
    memberId: text(source.memberId, 120),
    title: text(source.title, MAX_TITLE) || "Untitled routine",
    instructions: text(source.instructions, MAX_INSTRUCTIONS),
    workspace: text(source.workspace, 1000),
    model: text(source.model, 120),
    enabled: source.enabled !== false,
    schedule: normalizeSchedule(source.schedule, { defaultTimeZone }),
    maxRunMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.round(minutes), MAX_RUN_MINUTES) : 0,
    source: source.source === "chat" ? "chat" : "editor",
    proposalId: text(source.proposalId, 120),
    nextAt: iso(source.nextAt),
    lastRunAt: iso(source.lastRunAt),
    runs: (Array.isArray(source.runs) ? source.runs : []).map((run) => normalizeRun(run, id)).slice(0, MAX_RUNS_KEPT),
    createdAt,
    updatedAt: iso(source.updatedAt) || createdAt,
  };
}

export function normalizeProposal(input, { now = new Date().toISOString() } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const createdAt = iso(source.createdAt) || now;
  return {
    id: text(source.id, 120),
    type: "schedule",
    memberId: text(source.memberId, 120),
    workspace: text(source.workspace, 1000),
    requestId: text(source.requestId, 200),
    digest: text(source.digest, 64),
    title: text(source.title, MAX_TITLE),
    instructions: text(source.instructions, MAX_INSTRUCTIONS),
    schedule: normalizeSchedule(source.schedule),
    status: PROPOSAL_STATUSES.includes(source.status) ? source.status : "failed",
    message: text(source.message, 600),
    routineId: text(source.routineId, 80),
    createdAt,
    updatedAt: iso(source.updatedAt) || createdAt,
    decidedAt: iso(source.decidedAt),
    expiresAt: iso(source.expiresAt),
  };
}

/** Routine fields a client may set; everything else is bridge-owned. */
export function routineInputFrom(body, existing = null, { now, defaultTimeZone } = {}) {
  const source = body && typeof body === "object" ? body : {};
  const merged = existing
    ? { ...existing, ...pick(source, ["title", "instructions", "workspace", "model", "enabled", "schedule", "maxRunMinutes"]), id: existing.id, memberId: existing.memberId, runs: existing.runs, createdAt: existing.createdAt, source: existing.source, proposalId: existing.proposalId, updatedAt: now }
    : { ...pick(source, ["memberId", "title", "instructions", "workspace", "model", "enabled", "schedule", "maxRunMinutes"]), runs: [], createdAt: now, updatedAt: now, source: "editor" };
  return normalizeRoutine(merged, { now, defaultTimeZone });
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

export function validateRoutine(routine) {
  const problems = [];
  if (!routine.memberId) problems.push("memberId");
  if (!routine.title) problems.push("title");
  if (!routine.instructions) problems.push("instructions");
  return problems;
}

export function activeRun(routine) {
  return (routine.runs || []).find((run) => ACTIVE_RUN_STATUSES.includes(run.status)) || null;
}

/** The most recently finished run: skipped and missed records never count. */
export function lastRun(routine) {
  const finished = (routine.runs || []).filter((run) => !ACTIVE_RUN_STATUSES.includes(run.status) && run.status !== "skipped" && run.status !== "missed");
  finished.sort((a, b) => String(b.finishedAt || b.startedAt || "").localeCompare(String(a.finishedAt || a.startedAt || "")));
  return finished[0] || null;
}

export function upsertRun(routine, run) {
  const runs = routine.runs || [];
  const exists = runs.some((item) => item.id === run.id);
  const next = exists ? runs.map((item) => (item.id === run.id ? run : item)) : [run, ...runs];
  return { ...routine, runs: next.slice(0, MAX_RUNS_KEPT) };
}

// ---------------------------------------------------------------------------
// Store

export function createRoutinesStore(path, { now = () => new Date().toISOString(), defaultTimeZone = "UTC" } = {}) {
  let state = null;
  let writing = Promise.resolve();

  async function load() {
    if (state) return state;
    const saved = await readPersistentJson(path, { version: 1, routines: [], proposals: [] });
    const stamp = now();
    state = {
      version: 1,
      routines: (Array.isArray(saved?.routines) ? saved.routines : []).map((routine) => normalizeRoutine(routine, { now: stamp, defaultTimeZone })).filter((routine) => routine.memberId),
      proposals: (Array.isArray(saved?.proposals) ? saved.proposals : []).map((proposal) => normalizeProposal(proposal, { now: stamp })).filter((proposal) => proposal.id),
    };
    return state;
  }

  function save() {
    const snapshot = { version: 1, updatedAt: now(), routines: structuredClone(state.routines), proposals: structuredClone(state.proposals) };
    writing = writing.catch(() => {}).then(() => writePersistentJson(path, snapshot));
    return writing;
  }

  return {
    load,
    save,
    get state() {
      return state;
    },
    routines() {
      return state?.routines || [];
    },
    proposals() {
      return state?.proposals || [];
    },
    routine(id) {
      return (state?.routines || []).find((item) => item.id === id) || null;
    },
    proposal(id) {
      return (state?.proposals || []).find((item) => item.id === id) || null;
    },
    replaceRoutine(routine) {
      const exists = state.routines.some((item) => item.id === routine.id);
      state.routines = exists ? state.routines.map((item) => (item.id === routine.id ? routine : item)) : [routine, ...state.routines];
      return routine;
    },
    removeRoutine(id) {
      const found = state.routines.find((item) => item.id === id) || null;
      state.routines = state.routines.filter((item) => item.id !== id);
      return found;
    },
    replaceProposal(proposal) {
      const exists = state.proposals.some((item) => item.id === proposal.id);
      state.proposals = exists ? state.proposals.map((item) => (item.id === proposal.id ? proposal : item)) : [proposal, ...state.proposals];
      return proposal;
    },
  };
}
