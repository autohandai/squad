// The team's shared state on the bridge (ADR-0134): memory every member can
// read whichever engine it runs on, and the messages members send each other.
// One JSON file, one mutation queue, written atomically like the other
// bridge stores. No secrets are kept here; `remember` refuses text that looks
// like one.

import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import { looksLikeCredential } from "../../src/lib/secret-scan.js";
import { readPersistentJson, writePersistentJson } from "../persistent-json.mjs";

export const TEAM_MEMORY_LIMIT = 200;
export const TEAM_MEMORY_TEXT_LIMIT = 500;
export const TEAM_DELIVERY_LIMIT = 200;
export const MEMORY_SCOPES = Object.freeze(["team", "member", "project"]);

const SECRET_SHAPES = [/\bsk-[A-Za-z0-9_-]{12,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{16}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(?:password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*\S{6,}/i];

const at = () => new Date().toISOString();
const empty = () => ({ version: 1, memory: [], deliveries: [] });

// The shared detector as well as these: on its own this list let a GitHub
// fine-grained token, a GitLab token, a Google key, a JWT and a password
// inside a URL into team memory, and so into every member's prompt.
export function looksSecret(text) {
  const value = String(text || "");
  return SECRET_SHAPES.some((shape) => shape.test(value)) || looksLikeCredential(value);
}

/** One line of memory, checked. Throws with a reason the member can read. */
export function cleanMemoryText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("say what to remember");
  if (text.length > TEAM_MEMORY_TEXT_LIMIT) throw new Error(`keep a memory under ${TEAM_MEMORY_TEXT_LIMIT} characters; save the gist`);
  if (looksSecret(text)) throw new Error("that looks like a password or key; secrets belong in the vault, never in memory");
  return text;
}

/**
 * What makes two memories the same: words, not case, spacing or the full
 * stop. Exact text was compared, so "Igor prefers short replies." and
 * "Igor prefers short replies" were two entries in every member's prompt.
 */
export function memoryKey(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function createTeamStore({ stateDir }) {
  const file = join(stateDir, "team.json");
  let queue = Promise.resolve();

  async function read() {
    const value = await readPersistentJson(file, empty());
    if (!value || typeof value !== "object" || Array.isArray(value)) return empty();
    return { ...empty(), ...value, memory: Array.isArray(value.memory) ? value.memory : [], deliveries: Array.isArray(value.deliveries) ? value.deliveries : [] };
  }

  function mutate(operation) {
    const next = queue.then(async () => {
      const state = await read();
      const result = await operation(state);
      if (state.memory.length > TEAM_MEMORY_LIMIT) throw new Error(`Team memory is full (${TEAM_MEMORY_LIMIT} entries). Update or forget an existing entry before adding another.`);
      const pending = state.deliveries.filter(item => ["queued", "running"].includes(item.status));
      const finished = state.deliveries.filter(item => !["queued", "running"].includes(item.status));
      const available = Math.max(0, TEAM_DELIVERY_LIMIT - pending.length);
      state.deliveries = [...(available ? finished.slice(-available) : []), ...pending];
      await writePersistentJson(file, state);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  }

  async function remember({ text, scope = "team", memberId = "", workspace = "", authorId = "", authorName = "", source = "member" }) {
    const clean = cleanMemoryText(text);
    if (!MEMORY_SCOPES.includes(scope)) throw new Error("Memory scope must be team, member or project.");
    const kind = scope;
    if (kind === "member" && !memberId) throw new Error("a personal memory needs its member");
    if (kind === "project" && !workspace) throw new Error("a project memory needs the current workspace");
    const folder = kind === "project" ? resolve(workspace) : "";
    return mutate((state) => {
      const key = memoryKey(clean);
      const same = state.memory.find((entry) => entry.scope === kind && (kind !== "member" || entry.memberId === memberId) && (kind !== "project" || entry.workspace === folder) && memoryKey(entry.text) === key);
      if (same) return { ...same, duplicate: true };
      const entry = { id: `tm_${randomUUID()}`, scope: kind, memberId: kind === "member" ? memberId : "", ...(folder ? { workspace: folder } : {}), text: clean, authorId, authorName, source, createdAt: at() };
      state.memory.push(entry);
      return entry;
    });
  }

  async function updateMemory(id, text, { actorId = "", person = false } = {}) {
    const clean = cleanMemoryText(text);
    return mutate(state => {
      const entry = state.memory.find(item => item.id === id);
      if (!entry) throw Object.assign(new Error("That memory does not exist; call squad_recall for the current list."), { status: 404 });
      if (!person && entry.authorId !== actorId && entry.memberId !== actorId) throw Object.assign(new Error("Only the member who saved a memory, or the person, can update it."), { status: 403 });
      const duplicate = state.memory.find(item => item.id !== id && item.scope === entry.scope && item.memberId === entry.memberId && item.workspace === entry.workspace && memoryKey(item.text) === memoryKey(clean));
      if (duplicate) throw new Error(`That fact is already saved as ${duplicate.id}; forget the duplicate instead.`);
      entry.text = clean;
      entry.updatedAt = at();
      return { ...entry };
    });
  }

  async function forget(id, { actorId = "", person = false } = {}) {
    return mutate((state) => {
      const entry = state.memory.find((item) => item.id === id);
      if (!entry) throw Object.assign(new Error("that memory does not exist (any more); call squad_recall for the current list"), { status: 404 });
      // A member removes what it wrote or what is its own; the person removes anything.
      if (!person && entry.authorId !== actorId && entry.memberId !== actorId) throw Object.assign(new Error("only the member who saved a memory, or the person, can remove it"), { status: 403 });
      state.memory = state.memory.filter((item) => item.id !== id);
      // Only an explicit deletion creates a sync tombstone. Local retention or
      // an absent file must never be mistaken for a cloud delete.
      state.memoryTombstones = [...(state.memoryTombstones || []).filter(item => item.id !== id), { id, deletedAt: at() }];
      return entry;
    });
  }

  /** What a member knows: every team entry, plus its own. */
  async function memoryFor(memberId, workspace = "") {
    const state = await read();
    return state.memory.filter((entry) => entry.scope === "team" || (entry.scope === "member" && entry.memberId === memberId) || (entry.scope === "project" && workspace && entry.workspace === resolve(workspace)));
  }

  async function addDelivery(record) {
    return mutate((state) => {
      if (record.requestId) {
        const previous = state.deliveries.find(item => item.fromId === record.fromId && item.requestId === record.requestId);
        if (previous) {
          if (previous.toId !== record.toId || previous.message !== record.message) throw new Error("This request_id was already used for a different message.");
          return { ...previous, duplicate: true };
        }
      }
      if (state.deliveries.filter(item => ["queued", "running"].includes(item.status)).length >= TEAM_DELIVERY_LIMIT) throw new Error("Too many teammate messages are pending. Wait for replies before sending more.");
      const delivery = { id: `td_${randomUUID()}`, status: "queued", reply: "", error: "", createdAt: at(), updatedAt: at(), readAt: "", ...record };
      state.deliveries.push(delivery);
      return delivery;
    });
  }

  async function updateDelivery(id, patch) {
    return mutate((state) => {
      const delivery = state.deliveries.find((item) => item.id === id);
      if (!delivery) return null;
      Object.assign(delivery, patch, { updatedAt: at() });
      return { ...delivery };
    });
  }

  async function takeReplies(memberId) {
    return mutate(state => {
      const replies = state.deliveries.filter(delivery => delivery.fromId === memberId && !delivery.readAt && ["completed", "error", "interrupted"].includes(delivery.status));
      const waiting = state.deliveries.filter(delivery => delivery.fromId === memberId && ["queued", "running"].includes(delivery.status)).map(delivery => delivery.toName);
      for (const delivery of replies) delivery.readAt = at();
      return { replies: structuredClone(replies), waiting };
    });
  }

  /** Deliveries still running when the bridge stopped never finish; say so. */
  async function recover() {
    return mutate((state) => {
      let count = 0;
      for (const delivery of state.deliveries) {
        if (delivery.status === "queued" || delivery.status === "running") {
          delivery.status = "interrupted";
          delivery.error = "Squad restarted before the teammate answered. Send the message again.";
          delivery.updatedAt = at();
          count += 1;
        }
      }
      return count;
    });
  }

  return { file, read, mutate, remember, updateMemory, forget, memoryFor, addDelivery, updateDelivery, takeReplies, recover };
}
