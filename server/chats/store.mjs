// Previous chats (ADR-0113): one JSON file per conversation that was put
// away with New chat, under <squadStateDir>/chats/<memberId>/, with a small
// index the list reads. Members live in the browser, so the record is what
// the browser sends: its messages, when it started, which engine ran it, and
// the harness session ids the bridge captured at the same moment.
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const CHATS_DIR = "chats";
export const MAX_CHATS_PER_MEMBER = 100;
export const MAX_MESSAGES_PER_CHAT = 400;
export const MAX_CHAT_BYTES = 4 * 1024 * 1024;

const MEMBER_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const CHAT_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validMemberId(value) {
  return MEMBER_ID.test(String(value || ""));
}

export function validChatId(value) {
  return CHAT_ID.test(String(value || ""));
}

function isoOrEmpty(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/** The first thing the person asked, as the chat's name. */
export function chatTitleFrom(messages, fallback = "Chat") {
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== "user") continue;
    const text = String(message.body || "").replace(/\s+/g, " ").trim();
    if (text) return text.length > 96 ? `${text.slice(0, 95)}…` : text;
  }
  return fallback;
}

export function countTurns(messages) {
  return (Array.isArray(messages) ? messages : []).filter((message) => message?.role === "user").length;
}

/**
 * Keep the record within one file's budget. Order of sacrifice: older
 * messages beyond the cap, then the raw stream events (the reply text and
 * the trace stay), then the trace events themselves.
 */
export function boundMessages(input) {
  const messages = (Array.isArray(input) ? input : [])
    .filter((message) => isPlainObject(message) && typeof message.id === "string" && message.id && typeof message.role === "string")
    .slice(-MAX_MESSAGES_PER_CHAT);
  const size = (list) => JSON.stringify(list).length;
  if (size(messages) <= MAX_CHAT_BYTES) return { messages, limited: false };
  const withoutStream = messages.map((message) => {
    if (!Array.isArray(message.streamEvents)) return message;
    const { streamEvents: _dropped, ...rest } = message;
    return { ...rest, workDetailsLimited: true };
  });
  if (size(withoutStream) <= MAX_CHAT_BYTES) return { messages: withoutStream, limited: true };
  const withoutTrace = withoutStream.map((message) => {
    if (!isPlainObject(message.trace)) return message;
    const { events: _events, ...trace } = message.trace;
    return { ...message, trace };
  });
  if (size(withoutTrace) <= MAX_CHAT_BYTES) return { messages: withoutTrace, limited: true };
  return { messages: withoutTrace.map(({ id, role, body, time, status, authorName, startedAt, completedAt, durationMs }) => ({ id, role, body: String(body || "").slice(0, 20000), time, status, authorName, startedAt, completedAt, durationMs, workDetailsLimited: true })), limited: true };
}

/** Build the record stored on disk from what the browser sent. */
export function buildChatRecord(memberId, input, { id, now = new Date().toISOString(), sessions = {} } = {}) {
  const bounded = boundMessages(input?.messages);
  if (!bounded.messages.length) throw Object.assign(new Error("a chat needs at least one message"), { status: 400 });
  const startedAt = isoOrEmpty(input?.startedAt) || isoOrEmpty(bounded.messages[0]?.startedAt) || now;
  const endedAt = isoOrEmpty(input?.endedAt) || now;
  const harness = /^[a-z0-9-]{1,40}$/.test(String(input?.harness || "")) ? String(input.harness) : "";
  return {
    id,
    memberId,
    title: String(input?.title || "").trim().slice(0, 120) || chatTitleFrom(bounded.messages),
    startedAt,
    endedAt,
    createdAt: now,
    harness,
    workspace: String(input?.workspace || "").slice(0, 1024),
    messageCount: bounded.messages.length,
    turns: countTurns(bounded.messages),
    limited: bounded.limited,
    sessions: isPlainObject(sessions) ? sessions : {},
    digest: chatDigest(bounded.messages),
    messages: bounded.messages,
  };
}

/** A two-line digest for recall (ADR-0115): what was asked first, what was answered last. */
export function chatDigest(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const firstQuestion = list.find((message) => message?.role === "user" && String(message.body || "").trim());
  const lastReply = [...list].reverse().find((message) => message?.role === "agent" && String(message.body || "").trim() && message.status !== "error");
  const clip = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
  return { firstQuestion: clip(firstQuestion?.body), lastReply: clip(lastReply?.body) };
}

export function chatSummary(record) {
  const sessionCount = Object.values(record?.sessions || {}).reduce((total, entries) => total + Object.keys(isPlainObject(entries) ? entries : {}).length, 0);
  return {
    digest: isPlainObject(record?.digest) ? record.digest : chatDigest(record?.messages),
    id: record.id,
    memberId: record.memberId,
    title: record.title,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    createdAt: record.createdAt,
    harness: record.harness,
    workspace: record.workspace,
    messageCount: record.messageCount,
    turns: record.turns,
    limited: Boolean(record.limited),
    resumable: sessionCount > 0,
  };
}

export class ChatStore {
  constructor({ squadStateDir }) {
    this.root = join(squadStateDir, CHATS_DIR);
  }

  memberDir(memberId) {
    if (!validMemberId(memberId)) throw Object.assign(new Error("member id is invalid"), { status: 400 });
    return join(this.root, memberId);
  }

  filePath(memberId, chatId) {
    if (!validChatId(chatId)) throw Object.assign(new Error("chat id is invalid"), { status: 400 });
    return join(this.memberDir(memberId), `${chatId}.json`);
  }

  async readRecord(path) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      return isPlainObject(parsed) && typeof parsed.id === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Newest first. `index.json` (summaries with digests, rewritten on every
   * save and remove) answers the list and recall without opening the
   * records; when it is missing the files are scanned and it is rebuilt.
   */
  async list(memberId) {
    const dir = this.memberDir(memberId);
    const indexed = await this.readIndex(dir);
    if (indexed) return indexed;
    return this.rebuildIndex(memberId);
  }

  async readIndex(dir) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
      return Array.isArray(parsed?.chats) ? parsed.chats.filter((item) => isPlainObject(item) && typeof item.id === "string") : null;
    } catch {
      return null;
    }
  }

  async rebuildIndex(memberId) {
    const dir = this.memberDir(memberId);
    let names = [];
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith(".json") && name !== "index.json");
    } catch {
      return [];
    }
    const records = await Promise.all(names.map((name) => this.readRecord(join(dir, name))));
    const chats = records
      .filter(Boolean)
      .map(chatSummary)
      .sort((a, b) => Date.parse(b.endedAt || b.createdAt || 0) - Date.parse(a.endedAt || a.createdAt || 0));
    // Always rewrite: removing the last chat must empty the index, not leave it stale.
    await this.writeIndex(dir, chats).catch(() => {});
    return chats;
  }

  async writeIndex(dir, chats) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "index.json");
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, chats }), "utf8");
    await rename(temp, path);
  }

  /** Every member's summaries, for recall across the squad (ADR-0115). */
  async listAll() {
    let members = [];
    try {
      members = await readdir(this.root);
    } catch {
      return [];
    }
    const lists = await Promise.all(members.filter(validMemberId).map((memberId) => this.list(memberId).catch(() => [])));
    return lists.flat();
  }

  async get(memberId, chatId) {
    return this.readRecord(this.filePath(memberId, chatId));
  }

  async save(record) {
    const path = this.filePath(record.memberId, record.id);
    await mkdir(this.memberDir(record.memberId), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(record), "utf8");
    await rename(temp, path);
    await this.prune(record.memberId);
    await this.rebuildIndex(record.memberId);
    return chatSummary(record);
  }

  async remove(memberId, chatId) {
    const path = this.filePath(memberId, chatId);
    const existed = Boolean(await this.readRecord(path));
    await rm(path, { force: true });
    if (existed) await this.rebuildIndex(memberId);
    return existed;
  }

  /** Keep the newest MAX_CHATS_PER_MEMBER; the rest are deleted oldest first. */
  async prune(memberId) {
    const summaries = await this.rebuildIndex(memberId);
    for (const stale of summaries.slice(MAX_CHATS_PER_MEMBER)) {
      await rm(this.filePath(memberId, stale.id), { force: true });
    }
  }
}
