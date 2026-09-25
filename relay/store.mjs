// Relay storage: one JSON document per workspace under <dataDir>/workspaces.
//
// This is the whole persistence contract of the relay. A Postgres-backed
// store only has to implement the same five methods (listChannels,
// putChannels, putMessage, listMessages, workspaces) with the same
// last-writer-wins rules, and relay/server.mjs needs no change.
//
// Records:
//   channel  { id, name, memberIds, visibility, updatedAt, ... }
//   message  { id, channelId, role, agentId, body, updatedAt, origin?, ... }
//
// Last-writer-wins per record id: an incoming record replaces the stored one
// only when its `updatedAt` (ISO string) is strictly newer. Equal timestamps
// keep the stored record, so a replayed write is a no-op.

import { mkdir, readFile, rename, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const WORKSPACE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function normalizeWorkspaceId(value) {
  const id = String(value || "").trim().toLowerCase();
  return WORKSPACE_ID.test(id) ? id : "";
}

export function isNewer(candidate, current) {
  if (!current) return true;
  return String(candidate?.updatedAt || "") > String(current?.updatedAt || "");
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeChannel(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const name = String(item.name || "").trim();
  if (!id || !name) return null;
  const createdAt = String(item.createdAt || nowIso());
  return {
    ...item,
    id,
    name: name.slice(0, 80),
    memberIds: Array.isArray(item.memberIds) ? item.memberIds.map((v) => String(v || "").trim()).filter(Boolean) : [],
    createdAt,
    updatedAt: String(item.updatedAt || createdAt),
  };
}

function normalizeMessage(item, channelId = "") {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const channel = String(item.channelId || channelId || "").trim();
  if (!id || !channel) return null;
  const createdAt = String(item.createdAt || nowIso());
  return {
    ...item,
    id,
    channelId: channel,
    body: String(item.body ?? ""),
    createdAt,
    updatedAt: String(item.updatedAt || createdAt),
  };
}

export function createStore({ dataDir, maxMessagesPerWorkspace = 20_000 } = {}) {
  if (!dataDir) throw new Error("store needs a dataDir");
  const workspacesDir = join(dataDir, "workspaces");
  const cache = new Map(); // ws -> { channels: Map, messages: Map, updatedAt }
  const queues = new Map(); // ws -> Promise (serialises writes per workspace)

  function fileFor(ws) {
    return join(workspacesDir, `${ws}.json`);
  }

  async function load(ws) {
    if (cache.has(ws)) return cache.get(ws);
    const doc = { channels: new Map(), messages: new Map(), updatedAt: "" };
    try {
      const raw = JSON.parse(await readFile(fileFor(ws), "utf8"));
      for (const channel of Array.isArray(raw?.channels) ? raw.channels : []) {
        const record = normalizeChannel(channel);
        if (record) doc.channels.set(record.id, record);
      }
      for (const message of Array.isArray(raw?.messages) ? raw.messages : []) {
        const record = normalizeMessage(message);
        if (record) doc.messages.set(record.id, record);
      }
      doc.updatedAt = String(raw?.updatedAt || "");
    } catch {
      // A missing or unreadable file is an empty workspace.
    }
    cache.set(ws, doc);
    return doc;
  }

  async function persist(ws, doc) {
    await mkdir(workspacesDir, { recursive: true });
    const messages = Array.from(doc.messages.values());
    if (messages.length > maxMessagesPerWorkspace) {
      messages.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
      for (const stale of messages.splice(0, messages.length - maxMessagesPerWorkspace)) doc.messages.delete(stale.id);
    }
    const body = JSON.stringify(
      { version: 1, workspace: ws, updatedAt: doc.updatedAt, channels: Array.from(doc.channels.values()), messages },
      null,
      2
    );
    const target = fileFor(ws);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${body}\n`, "utf8");
    await rename(temp, target);
  }

  function serialized(ws, task) {
    const previous = queues.get(ws) || Promise.resolve();
    const next = previous.then(task, task);
    queues.set(ws, next.catch(() => {}));
    return next;
  }

  return {
    async workspaces() {
      try {
        return (await readdir(workspacesDir)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
      } catch {
        return [];
      }
    },

    async listChannels(ws) {
      const doc = await load(ws);
      return { channels: Array.from(doc.channels.values()), updatedAt: doc.updatedAt };
    },

    /** Merge channels (LWW by id). Returns { channels, changed }. */
    putChannels(ws, input) {
      return serialized(ws, async () => {
        const doc = await load(ws);
        const list = Array.isArray(input) ? input : Array.isArray(input?.channels) ? input.channels : [];
        const changed = [];
        for (const item of list) {
          const record = normalizeChannel(item);
          if (!record) continue;
          if (isNewer(record, doc.channels.get(record.id))) {
            doc.channels.set(record.id, record);
            changed.push(record);
          }
        }
        if (changed.length) {
          doc.updatedAt = nowIso();
          await persist(ws, doc);
        }
        return { channels: Array.from(doc.channels.values()), changed, updatedAt: doc.updatedAt };
      });
    },

    /** Store one message (LWW by id). Returns { message, changed }. */
    putMessage(ws, channelId, input) {
      return serialized(ws, async () => {
        const doc = await load(ws);
        const record = normalizeMessage(input, channelId);
        if (!record) throw Object.assign(new Error("message needs an id and a channelId"), { status: 400 });
        const current = doc.messages.get(record.id);
        if (!isNewer(record, current)) return { message: current, changed: false };
        doc.messages.set(record.id, record);
        doc.updatedAt = nowIso();
        await persist(ws, doc);
        return { message: record, changed: true };
      });
    },

    async listMessages(ws, { channelId = "", since = "", limit = 1000 } = {}) {
      const doc = await load(ws);
      const cursor = String(since || "");
      const list = [];
      for (const message of doc.messages.values()) {
        if (channelId && message.channelId !== channelId) continue;
        if (cursor && String(message.updatedAt) < cursor) continue;
        list.push(message);
      }
      list.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)) || a.id.localeCompare(b.id));
      const max = Math.max(1, Math.min(Number(limit) || 1000, 5000));
      return { messages: list.slice(0, max), truncated: list.length > max, updatedAt: doc.updatedAt };
    },
  };
}
