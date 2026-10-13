// Durable per-member follow-up queues (ADR-0111). State lives in
// `<squadStateDir>/queues.json`, written atomically; the browser's list above
// the composer is a view of this file, never the source of truth.
//
// An item is one message the person sent while the member was busy. The
// dispatcher (./dispatcher.mjs) runs items strictly in order, one at a time,
// as bridge-owned turns. Restart recovery mirrors ADR-0066: a running item is
// marked failed with the interruption explanation, nothing is re-sent, and the
// member's queue stays paused until the person resumes it.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readPersistentJson, writePersistentJson } from "../persistent-json.mjs";

export const QUEUE_STATUSES = ["queued", "running", "done", "failed", "cancelled"];
export const RESTART_REASON = "This follow-up was interrupted when Squad restarted. No final update was received. Queue it again to continue.";
export const RESTART_PAUSE_REASON = "The bridge restarted. Resume the queue when you are ready to continue.";
export const STOP_PAUSE_REASON = "Stopped by you. Resume the queue to continue.";
export const BREAK_PAUSE_REASON = "Member is on a break. End the break, then resume the queue.";
const MAX_TEXT = 60_000;
const MAX_ATTACHMENTS = 20;

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function idOf(value) { return String(value || "").trim(); }

// The launch payload is what the browser sends with a chat; it is kept so the
// dispatcher can run the item with the same profile, workspace and policy.
// Secrets never belong in it, and the public item never carries it at all.
export function privateLaunch(payload) {
  const scrub = (value) => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:api.?key|token|secret|password|authorization|credentials|^env$)/i.test(key)).map(([key, item]) => [key, scrub(item)]));
  };
  const keys = ["agentId", "agent", "squadMembers", "workspace", "profile", "model", "policy", "transport", "timeoutMs", "canvasDir", "canvasId", "channelId", "threadId", "channel"];
  return scrub(Object.fromEntries(keys.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])));
}

export function publicItem(record) {
  const { launch, ...item } = record;
  return structuredClone(item);
}

function attachmentReferences(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ATTACHMENTS).map((entry) => {
    if (typeof entry === "string") return { id: entry.slice(0, 200) };
    if (!entry || typeof entry !== "object") return null;
    return { id: idOf(entry.id).slice(0, 200), name: String(entry.name || "").slice(0, 200), kind: String(entry.kind || entry.type || "").slice(0, 40) };
  }).filter((entry) => entry && entry.id);
}

export class QueueStore {
  constructor({ squadStateDir, now = () => Date.now() }) {
    this.filename = join(squadStateDir, "queues.json");
    this.now = now;
    this.items = new Map();
    this.members = new Map();
    this.context = new Map();
    this.writing = Promise.resolve();
    this.ready = this.load();
  }

  at() { return new Date(this.now()).toISOString(); }

  async load() {
    const saved = await readPersistentJson(this.filename, { version: 1, items: [], members: {}, context: {} });
    let changed = false;
    const interrupted = new Set();
    for (const record of Array.isArray(saved.items) ? saved.items : []) {
      if (!record?.id || !record.memberId) continue;
      if (record.status === "running") {
        // The previous process died with this turn in flight; nothing came
        // back and re-sending it silently is not this module's call.
        Object.assign(record, { status: "failed", error: RESTART_REASON, interrupted: true, finishedAt: this.at(), updatedAt: this.at() });
        interrupted.add(record.memberId); changed = true;
      }
      this.items.set(record.id, record);
    }
    for (const [memberId, record] of Object.entries(saved.members || {})) {
      if (!memberId || !record || typeof record !== "object") continue;
      this.members.set(memberId, { paused: Boolean(record.paused), pauseReason: String(record.pauseReason || ""), updatedAt: String(record.updatedAt || "") });
    }
    for (const memberId of new Set([...interrupted, ...[...this.items.values()].filter((item) => item.status === "queued").map((item) => item.memberId)])) {
      const member = this.members.get(memberId) || { paused: false, pauseReason: "", updatedAt: "" };
      if (!member.paused || member.pauseReason !== RESTART_PAUSE_REASON) {
        this.members.set(memberId, { paused: true, pauseReason: RESTART_PAUSE_REASON, updatedAt: this.at() }); changed = true;
      }
    }
    for (const [memberId, record] of Object.entries(saved.context || {})) if (memberId && record && typeof record === "object") this.context.set(memberId, record);
    if (changed) await this.save();
  }

  save() {
    const snapshot = {
      version: 1,
      items: structuredClone([...this.items.values()]),
      members: Object.fromEntries(this.members),
      context: Object.fromEntries(this.context),
    };
    this.writing = this.writing.catch(() => {}).then(() => writePersistentJson(this.filename, snapshot));
    return this.writing;
  }

  memberState(memberId) {
    return this.members.get(memberId) || { paused: false, pauseReason: "", updatedAt: "" };
  }

  /** Items for one member in queue order; finished items keep their place for the conversation. */
  itemsFor(memberId) {
    return [...this.items.values()].filter((item) => item.memberId === memberId);
  }

  async list(memberId = "") {
    await this.ready;
    const ids = memberId ? [memberId] : [...new Set([...this.items.values()].map((item) => item.memberId).concat([...this.members.keys()]))];
    const queues = {};
    for (const id of ids) {
      const state = this.memberState(id);
      queues[id] = { memberId: id, paused: state.paused, pauseReason: state.pauseReason, updatedAt: state.updatedAt, items: this.itemsFor(id).map(publicItem) };
    }
    return queues;
  }

  async get(id) {
    await this.ready;
    const item = this.items.get(idOf(id));
    if (!item) throw fail("queue item not found", 404);
    return item;
  }

  async enqueue(payload) {
    await this.ready;
    const memberId = idOf(payload.agentId || payload.agent?.id || payload.memberId);
    const text = String(payload.text ?? payload.prompt ?? "").trim().slice(0, MAX_TEXT);
    if (!memberId || !text) throw fail("member and follow-up text are required");
    const at = this.at();
    const item = {
      id: randomUUID(), memberId, workspace: String(payload.workspace || ""), text,
      attachments: attachmentReferences(payload.attachments), status: "queued",
      createdAt: at, updatedAt: at, startedAt: null, finishedAt: null, reply: "", error: "", progress: null,
      launch: privateLaunch(payload),
    };
    this.items.set(item.id, item);
    try { await this.save(); } catch (error) { this.items.delete(item.id); throw error; }
    return publicItem(item);
  }

  async update(id, patch) {
    const item = await this.get(id);
    if (item.status !== "queued") throw fail("Only a queued follow-up can be edited.", 409);
    const text = String(patch.text ?? patch.prompt ?? "").trim().slice(0, MAX_TEXT);
    if (!text) throw fail("follow-up text is required");
    Object.assign(item, { text, updatedAt: this.at() });
    await this.save();
    return publicItem(item);
  }

  /** Reorder the queued items of a member; `ids` lists the queued ids in their new order. */
  async reorder(memberId, ids) {
    await this.ready;
    const queued = this.itemsFor(memberId).filter((item) => item.status === "queued");
    const wanted = (Array.isArray(ids) ? ids : []).map(idOf);
    const known = new Set(queued.map((item) => item.id));
    if (wanted.length !== known.size || wanted.some((id) => !known.has(id)) || new Set(wanted).size !== wanted.length) throw fail("reorder must list every queued follow-up of the member exactly once");
    // Rebuild the map so iteration order (and the file) follows the request;
    // other members' items and finished items stay where they were.
    const positions = queued.map((item) => item.id);
    const byId = new Map(queued.map((item) => [item.id, item]));
    let cursor = 0;
    const rebuilt = new Map();
    for (const [id, item] of this.items) {
      if (positions.includes(id)) { const next = byId.get(wanted[cursor++]); next.updatedAt = this.at(); rebuilt.set(next.id, next); }
      else rebuilt.set(id, item);
    }
    this.items = rebuilt;
    await this.save();
    return this.itemsFor(memberId).map(publicItem);
  }

  async cancel(id) {
    const item = await this.get(id);
    if (["done", "failed", "cancelled"].includes(item.status)) return publicItem(item);
    const wasRunning = item.status === "running";
    Object.assign(item, { status: "cancelled", finishedAt: this.at(), updatedAt: this.at() });
    await this.save();
    return { ...publicItem(item), wasRunning };
  }

  async setPaused(memberId, paused, reason = "") {
    await this.ready;
    const id = idOf(memberId);
    if (!id) throw fail("member id is required");
    this.members.set(id, { paused: Boolean(paused), pauseReason: paused ? String(reason || "Paused by you.") : "", updatedAt: this.at() });
    await this.save();
    return { memberId: id, ...this.memberState(id) };
  }

  /** Cancel every queued item of a member (a fresh conversation). */
  async clear(memberId) {
    await this.ready;
    const cleared = [];
    for (const item of this.itemsFor(memberId)) if (item.status === "queued") { Object.assign(item, { status: "cancelled", finishedAt: this.at(), updatedAt: this.at() }); cleared.push(item.id); }
    if (cleared.length) await this.save();
    return cleared;
  }

  nextQueued(memberId) {
    return this.itemsFor(memberId).find((item) => item.status === "queued") || null;
  }

  runningFor(memberId) {
    return this.itemsFor(memberId).find((item) => item.status === "running") || null;
  }

  async transition(item, patch) {
    Object.assign(item, patch, { updatedAt: this.at() });
    await this.save();
    return item;
  }

  async recordContext(memberId, record) {
    await this.ready;
    const id = idOf(memberId);
    if (!id) return null;
    if (!record) this.context.delete(id); else this.context.set(id, record);
    await this.save();
    return record;
  }

  async contexts() { await this.ready; return Object.fromEntries(this.context); }
}
