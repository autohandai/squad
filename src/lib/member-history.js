// Member history (ADR-0018): pure helpers for the profile "History" section.
// No React, no DOM, so scripts/check-audit.mjs can import this from Node.

// Mirrors ACTIVITY_KINDS in server/audit/trail.mjs; scripts/check-audit.mjs
// asserts the two agree, so a kind added there must be added here.
export const HISTORY_KINDS = Object.freeze(["message", "run", "edit", "shell", "handoff", "approval", "skill", "memory"]);
export const HISTORY_FILTERS = Object.freeze(["all", ...HISTORY_KINDS]);
export const HISTORY_PAGE = 50;

const KIND_LABELS = Object.freeze({
  all: "All",
  message: "Messages",
  run: "Runs",
  edit: "Edits",
  shell: "Shell",
  handoff: "Handoffs",
  approval: "Approvals",
  skill: "Skills",
  memory: "Memory",
});

const KIND_SINGULAR = Object.freeze({
  message: "Message",
  run: "Run",
  edit: "Edit",
  shell: "Shell",
  handoff: "Handoff",
  approval: "Approval",
  skill: "Skill",
  memory: "Memory",
});

/** Filter-chip label: copy.historyKinds.<kind> with a literal fallback. */
export function kindLabel(kind, copy = {}) {
  return copy?.historyKinds?.[kind] || KIND_LABELS[kind] || String(kind || "");
}

/** Row label (singular) for a record kind. */
export function kindTitle(kind, copy = {}) {
  return copy?.historyKindTitles?.[kind] || KIND_SINGULAR[kind] || kindLabel(kind, copy);
}

export function normalizeFilter(filter) {
  return HISTORY_FILTERS.includes(filter) ? filter : "all";
}

// --- OTLP decoding (mirror of server/otel-logs.mjs fromAnyValue, kept local
// so the browser bundle does not import server code) ---------------------

function fromAnyValue(value) {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if ("intValue" in value) {
    const parsed = Number(value.intValue);
    return Number.isSafeInteger(parsed) ? parsed : value.intValue;
  }
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fromAnyValue);
  if ("kvlistValue" in value) {
    return Object.fromEntries((value.kvlistValue?.values || []).map((entry) => [entry.key, fromAnyValue(entry.value)]));
  }
  return undefined;
}

const REF_ATTRS = Object.freeze({
  runId: "autohand.run.id",
  channelId: "autohand.channel.id",
  taskId: "autohand.task.id",
  workflowId: "autohand.workflow.id",
  stepId: "autohand.workflow.step_id",
  messageId: "autohand.message.id",
  threadId: "autohand.thread.id",
  memberId: "autohand.related_member.id",
  workspace: "autohand.workspace",
  path: "autohand.file.path",
  command: "autohand.shell.command",
  exitCode: "process.exit_code",
});

function nanoToIso(timeUnixNano) {
  const text = String(timeUnixNano || "");
  if (!/^\d+$/.test(text)) return "";
  const ms = text.length > 6 ? Number(text.slice(0, -6)) : 0;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/**
 * Accept either a decoded record from `GET /api/members/:id/activity` or a
 * raw OTLP LogRecord line from the export, and return the flat shape the
 * component renders: `{ id, at, kind, eventName, summary, status, refs }`.
 */
export function normalizeRecord(input) {
  if (!input || typeof input !== "object") return null;
  if (Array.isArray(input.attributes)) {
    const attributes = Object.fromEntries(input.attributes.map((entry) => [entry.key, fromAnyValue(entry.value)]));
    const refs = {};
    for (const [name, key] of Object.entries(REF_ATTRS)) {
      if (attributes[key] !== undefined && attributes[key] !== "") refs[name] = attributes[key];
    }
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith("autohand.ref.") && value !== "") refs[key.slice("autohand.ref.".length)] = value;
    }
    return {
      id: String(input.id || ""),
      at: nanoToIso(input.timeUnixNano),
      memberId: String(attributes["autohand.member.id"] || ""),
      kind: String(attributes["autohand.activity.kind"] || "run"),
      eventName: String(attributes["event.name"] || ""),
      status: String(attributes["autohand.activity.status"] || ""),
      source: String(attributes["autohand.activity.source"] || ""),
      summary: String(fromAnyValue(input.body) || ""),
      refs,
    };
  }
  if (input.attributes !== undefined && (typeof input.attributes !== "object" || input.attributes === null)) return null;
  if (!(input.at || input.timeUnixNano || input.kind)) return null;
  return {
    id: String(input.id || ""),
    at: input.at || nanoToIso(input.timeUnixNano) || "",
    memberId: String(input.memberId || ""),
    kind: HISTORY_KINDS.includes(input.kind) ? input.kind : "run",
    eventName: String(input.eventName || ""),
    status: String(input.status || ""),
    source: String(input.source || ""),
    summary: String(input.summary || ""),
    refs: input.refs && typeof input.refs === "object" ? { ...input.refs } : {},
  };
}

/** The value to hand a relative-time formatter (ISO string, or "" when unknown). */
export function recordTime(record) {
  if (!record) return "";
  if (record.at) return record.at;
  return nanoToIso(record.timeUnixNano);
}

export function filterRecords(records = [], filter = "all") {
  const wanted = normalizeFilter(filter);
  const list = records.map(normalizeRecord).filter(Boolean);
  return wanted === "all" ? list : list.filter((record) => record.kind === wanted);
}

/** Merge a loaded page into the list: dedupe by id, newest first. */
export function mergeRecords(existing = [], incoming = []) {
  const byId = new Map();
  for (const record of [...existing, ...incoming].map(normalizeRecord)) {
    if (record && record.id && !byId.has(record.id)) byId.set(record.id, record);
  }
  return Array.from(byId.values()).sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
}

/** Cursor for the next page: the oldest id currently shown. */
export function nextCursor(records = []) {
  const list = mergeRecords(records);
  return list.length ? list[list.length - 1].id : "";
}

function dayKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dayLabel(iso, { now = Date.now(), locale = "en-US", copy = {} } = {}) {
  const key = dayKey(iso);
  if (!key) return "";
  const today = dayKey(new Date(now).toISOString());
  const yesterday = dayKey(new Date(now - 24 * 60 * 60 * 1000).toISOString());
  if (key === today) return copy.today || "Today";
  if (key === yesterday) return copy.yesterday || "Yesterday";
  try {
    return new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
  } catch {
    return key;
  }
}

/** Group newest-first records by calendar day: `[{ day, label, records }]`. */
export function groupRecordsByDay(records = [], options = {}) {
  const groups = [];
  for (const record of withoutEchoedMentions(mergeRecords(records))) {
    const day = dayKey(record.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.records.push(record);
    else groups.push({ day, label: dayLabel(record.at, options), records: [record] });
  }
  return groups;
}

export function relativeTime(value, { now = Date.now(), locale = "en-US", copy = {} } = {}) {
  if (!value) return "";
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = now - ms;
  const sec = Math.round(diff / 1000);
  if (diff < 0 || sec < 45) return copy.justNow || "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ${copy.ago || "ago"}`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ${copy.ago || "ago"}`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ${copy.ago || "ago"}`;
  try {
    return new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric" });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * Links a row can offer, in display order. Each is `{ type, id, label }`;
 * the component hands them to `renderLink(ref)`.
 */
export function recordLinks(record, copy = {}) {
  const refs = record?.refs || {};
  const links = [];
  if (refs.runId) links.push({ type: "run", id: String(refs.runId), label: copy.historyOpenRun || "Run" });
  if (refs.channelId) links.push({ type: "channel", id: String(refs.channelId), label: copy.historyOpenChannel || "Channel", messageId: refs.messageId ? String(refs.messageId) : "" });
  if (refs.taskId) links.push({ type: "task", id: String(refs.taskId), label: copy.historyOpenTask || "Task" });
  if (refs.workflowId) links.push({ type: "workflow", id: String(refs.workflowId), label: copy.historyOpenApproval || "Approval" });
  if (refs.memberId) links.push({ type: "member", id: String(refs.memberId), label: copy.historyOpenMember || "Member" });
  return links;
}

/**
 * Row text. Summaries are written by the bridge as "Replied in channel:
 * <first 140 characters of the reply>", so a row showed raw markdown
 * ("**Selected repository for this run:** - `/Users/igorcosta/Documents/a")
 * cut mid-word, and the empty-reply fallback ("Autohand returned no chat
 * text.") as if the member had said it. The preview is read as plain text,
 * cut on a word, and the fallback says what happened.
 */
export function recordSummary(record, copy = {}) {
  const normalized = normalizeRecord(record);
  if (!normalized) return "";
  if (!normalized.summary) return `${kindTitle(normalized.kind, copy)}${normalized.eventName ? ` · ${normalized.eventName}` : ""}`;
  const match = /^([^:]{1,40}):\s+([\s\S]*)$/.exec(normalized.summary);
  if (!match) return normalized.summary === "Stopped" ? copy.historyStopped || "Stopped by you" : normalized.summary;
  const [, lead, rest] = match;
  if (/^Replied/.test(lead) && /^\s*⚠️?\s*(The request was malformed|This message was blocked|You've reached your)/i.test(rest)) {
    return `${lead.replace(/^Replied/, "Could not reply")}: ${plainPreview(rest.replace(/^\s*⚠️?\s*/, ""))}`;
  }
  if (/^[^\n]{1,80} returned no chat text\.?$/.test(rest.trim())) return `${lead}, with no text`;
  return `${lead}: ${plainPreview(rest)}`;
}

/** Markdown preview as one plain sentence, cut on a word with "…". */
export function plainPreview(value, max = 120) {
  // The bridge stored previews hard-cut at 140 characters; one that long was
  // cut, even if removing markdown makes it shorter here.
  const truncatedAtSource = String(value || "").trim().length >= 130;
  let text = String(value || "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`?/g, "$1")
    .replace(/\*\*([^*]*)\*\*?/g, "$1")
    .replace(/(^|\s)[-*•]\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > max || truncatedAtSource) {
    // Drop the last, possibly half, word and close with an ellipsis.
    const limit = Math.min(max, text.length);
    const head = text.slice(0, limit);
    const cut = head.lastIndexOf(" ");
    text = `${(cut > limit * 0.5 ? head.slice(0, cut) : head).replace(/[\s,;:.\-–—]+$/, "")}…`;
  }
  return text;
}

/**
 * A mention and the reply to it carry the same text a few seconds apart
 * ("Mentioned: @Iris — from my side…" over "Replied in channel: @Iris —
 * from my side…"). Keep the reply.
 */
export function withoutEchoedMentions(records = []) {
  const replies = records.filter((record) => record?.eventName === "chat.finished");
  return records.filter((record) => {
    if (record?.eventName !== "mention.received") return true;
    const text = String(record.summary || "").replace(/^Mentioned:\s*/, "").slice(0, 60);
    const at = Date.parse(record.at || "");
    return !replies.some((reply) => String(reply.summary || "").includes(text) && Math.abs(Date.parse(reply.at || "") - at) < 10 * 60 * 1000);
  });
}

/** Is the record a failure worth marking in the list? */
export function recordFailed(record) {
  const status = String(record?.status || "").toLowerCase();
  if (status === "failed" || status === "error") return true;
  // The engine reports some refusals as an ordinary reply ("⚠️ The request
  // was malformed… blocked by Autohand's safety check"); the row said
  // "Replied:" in plain text as if it had answered.
  return /^Replied[^:]*:\s*⚠️?\s*(The request was malformed|This message was blocked|You've reached your)/i.test(String(record?.summary || ""));
}
