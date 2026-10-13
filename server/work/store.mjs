// Member work plans (ADR-0124): the tasks a member keeps for itself, the
// ones a person adds for it, and the recurring item a routine run creates.
// Persisted as `work.json` in the squad state directory through the same
// atomic rename as goals and routines (server/persistent-json.mjs). Pure
// except for the file; the route owns events and dispatch.
//
// Shapes
//   task     { id, memberId, title, detail, status: open|doing|done|blocked, due: YYYY-MM-DD|"",
//              recurring: routine id|"", source: member|person|handoff|routine, outcome,
//              lastOutcome: { at, status, preview }|null, createdAt, updatedAt, doneAt,
//              history: [{ at, by: member|person|routine|bridge, event, note }] }
//   receipt  { id, digest, taskId, status: added|done|updated|failed, message, at }
//            one per SQUAD_ACTION (member id + request id + index), so a replayed
//            turn returns the same answer instead of a second task.

import { randomBytes } from "node:crypto";

import { readPersistentJson, writePersistentJson } from "../persistent-json.mjs";
import { WORK_TASK_STATUSES } from "../../src/lib/work-plans.js";

export const STORE_FILE = "work.json";
export const MAX_TITLE = 160;
export const MAX_DETAIL = 2000;
export const MAX_HISTORY = 30;
export const MAX_RECEIPTS = 500;
export const MAX_TASKS_PER_MEMBER = 400;
export const TASK_SOURCES = ["member", "person", "handoff", "routine"];

function text(value, max = 4000) {
  return String(value ?? "").replace(/\s+$/g, "").trim().slice(0, max);
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeDue(value) {
  const raw = text(value, 40);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const stamp = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isFinite(stamp) ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export function createTaskId() {
  return `t_${randomBytes(4).toString("base64url").replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase().padEnd(6, "x")}`;
}

export function normalizeHistoryEntry(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  return { at: iso(source.at) || new Date().toISOString(), by: ["member", "person", "routine", "bridge"].includes(source.by) ? source.by : "bridge", event: text(source.event, 60) || "updated", note: text(source.note, 400) };
}

export function normalizeTask(input, { now = new Date().toISOString() } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const createdAt = iso(source.createdAt) || now;
  const outcome = source.lastOutcome && typeof source.lastOutcome === "object" ? { at: iso(source.lastOutcome.at) || now, status: text(source.lastOutcome.status, 30), preview: text(source.lastOutcome.preview, 400) } : null;
  return {
    id: text(source.id, 40) || createTaskId(),
    memberId: text(source.memberId, 120),
    title: text(source.title, MAX_TITLE),
    detail: text(source.detail, MAX_DETAIL),
    status: WORK_TASK_STATUSES.includes(source.status) ? source.status : "open",
    due: normalizeDue(source.due),
    recurring: text(source.recurring, 80),
    source: TASK_SOURCES.includes(source.source) ? source.source : "member",
    outcome: text(source.outcome, 600),
    lastOutcome: outcome,
    createdAt,
    updatedAt: iso(source.updatedAt) || createdAt,
    doneAt: iso(source.doneAt),
    history: (Array.isArray(source.history) ? source.history : []).map(normalizeHistoryEntry).slice(-MAX_HISTORY),
  };
}

/** Fields a client or a member may set; everything else is bridge-owned. */
export function taskInputFrom(body, existing = null, { now, memberId = "", source = "person", by = "person" } = {}) {
  const input = body && typeof body === "object" ? body : {};
  const stamp = now || new Date().toISOString();
  if (existing) {
    const patch = {};
    for (const key of ["title", "detail", "due", "status", "outcome", "recurring"]) if (key in input) patch[key] = input[key];
    const next = normalizeTask({ ...existing, ...patch, id: existing.id, memberId: existing.memberId, source: existing.source, createdAt: existing.createdAt, updatedAt: stamp }, { now: stamp });
    const changes = Object.keys(patch).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(existing[key]));
    if (next.status === "done" && existing.status !== "done") next.doneAt = stamp;
    if (next.status !== "done") next.doneAt = null;
    if (changes.length) next.history = [...existing.history, normalizeHistoryEntry({ at: stamp, by, event: next.status === "done" && existing.status !== "done" ? "done" : existing.status === "done" && next.status !== "done" ? "reopened" : "updated", note: changes.map((key) => key === "status" ? `status ${next.status}` : key === "outcome" ? `outcome: ${next.outcome}` : key).join(", ") })].slice(-MAX_HISTORY);
    return next;
  }
  const task = normalizeTask({ ...input, id: "", memberId, source, createdAt: stamp, updatedAt: stamp, history: [] }, { now: stamp });
  task.doneAt = task.status === "done" ? stamp : null;
  task.history = [normalizeHistoryEntry({ at: stamp, by, event: "added", note: source === "routine" ? "created by a routine run" : "" })];
  return task;
}

export function validateTask(task) {
  const problems = [];
  if (!task.memberId) problems.push("memberId");
  if (!task.title) problems.push("title");
  return problems;
}

export function findByTitle(tasks, title, memberId) {
  const key = text(title, MAX_TITLE).toLowerCase();
  if (!key) return null;
  const open = tasks.filter((task) => task.memberId === memberId && task.status !== "done" && task.title.toLowerCase() === key);
  if (open.length === 1) return open[0];
  if (open.length > 1) return null;
  const any = tasks.filter((task) => task.memberId === memberId && task.title.toLowerCase() === key);
  return any.length === 1 ? any[0] : null;
}

// ---------------------------------------------------------------------------
// Store

const stores = new Map();

/** One store per path, so the route and the recall builder share it. */
export function workStoreFor(path, options = {}) {
  if (!stores.has(path)) stores.set(path, createWorkStore(path, options));
  return stores.get(path);
}

export function createWorkStore(path, { now = () => new Date().toISOString() } = {}) {
  let state = null;
  let writing = Promise.resolve();

  async function load() {
    if (state) return state;
    const saved = await readPersistentJson(path, { version: 1, tasks: [], receipts: [] });
    const stamp = now();
    state = {
      version: 1,
      tasks: (Array.isArray(saved?.tasks) ? saved.tasks : []).map((task) => normalizeTask(task, { now: stamp })).filter((task) => task.memberId && task.title),
      receipts: (Array.isArray(saved?.receipts) ? saved.receipts : []).filter((receipt) => receipt && receipt.id).slice(-MAX_RECEIPTS),
    };
    return state;
  }

  function save() {
    const snapshot = { version: 1, updatedAt: now(), tasks: structuredClone(state.tasks), receipts: structuredClone(state.receipts) };
    writing = writing.catch(() => {}).then(() => writePersistentJson(path, snapshot));
    return writing;
  }

  return {
    load,
    save,
    get state() {
      return state;
    },
    tasks(memberId = "") {
      const list = state?.tasks || [];
      return memberId ? list.filter((task) => task.memberId === memberId) : list;
    },
    task(id) {
      return (state?.tasks || []).find((item) => item.id === id) || null;
    },
    recurringTask(routineId, memberId = "") {
      return (state?.tasks || []).find((item) => item.recurring === routineId && (!memberId || item.memberId === memberId)) || null;
    },
    replaceTask(task) {
      const exists = state.tasks.some((item) => item.id === task.id);
      state.tasks = exists ? state.tasks.map((item) => (item.id === task.id ? task : item)) : [task, ...state.tasks];
      const mine = state.tasks.filter((item) => item.memberId === task.memberId);
      if (mine.length > MAX_TASKS_PER_MEMBER) {
        const drop = new Set(mine.filter((item) => item.status === "done").sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).slice(0, mine.length - MAX_TASKS_PER_MEMBER).map((item) => item.id));
        state.tasks = state.tasks.filter((item) => !drop.has(item.id));
      }
      return task;
    },
    removeTask(id) {
      const found = state.tasks.find((item) => item.id === id) || null;
      state.tasks = state.tasks.filter((item) => item.id !== id);
      return found;
    },
    receipt(id) {
      return (state?.receipts || []).find((item) => item.id === id) || null;
    },
    recordReceipt(receipt) {
      state.receipts = [...state.receipts.filter((item) => item.id !== receipt.id), receipt].slice(-MAX_RECEIPTS);
      return receipt;
    },
  };
}
