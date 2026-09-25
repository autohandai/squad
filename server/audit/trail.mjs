// Per-member audit trail (ADR-0018).
//
// One append-only JSONL file per member at `<squadStateDir>/audit/<memberId>.jsonl`.
// Every line is an OpenTelemetry LogRecord (the same shape server/otel-logs.mjs
// writes inside its ResourceLogs envelopes) plus an `id`, so a file can be
// exported as-is and read by the same tooling that reads web.otlp.jsonl:
//
//   { "id": "…", "timeUnixNano": "…", "severityNumber": 9, "severityText": "INFO",
//     "body": { "stringValue": "Finished run: Fix flaky test" },
//     "attributes": [ { "key": "autohand.member.id", "value": { "stringValue": "asq_kai" } },
//                     { "key": "event.name", "value": { "stringValue": "run.finished" } },
//                     { "key": "autohand.activity.kind", "value": { "stringValue": "run" } },
//                     { "key": "autohand.run.id", "value": { "stringValue": "run_1" } }, … ],
//     "traceId": "…", "spanId": "…" }
//
// Everything here is pure file I/O with no bridge dependencies, so
// scripts/check-audit.mjs can exercise it in a temp directory.

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { SEVERITY, anyValue, attributesFromObject, attributesToObject, severityText, spanIdFor, traceIdFor } from "../otel-logs.mjs";

export const AUDIT_DIR = "audit";
export const ACTIVITY_KINDS = Object.freeze(["message", "run", "edit", "shell", "handoff", "approval"]);
export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 500;

// Attribute keys, kept in one place so the bridge, the check, and the web app
// agree. Ref keys map a ref name (as the web app sees it) to its attribute.
export const ATTR = Object.freeze({
  memberId: "autohand.member.id",
  eventName: "event.name",
  kind: "autohand.activity.kind",
  status: "autohand.activity.status",
  source: "autohand.activity.source",
});
export const REF_ATTRS = Object.freeze({
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

/** File-system safe member id; never lets a caller escape the audit folder. */
export function safeMemberId(memberId) {
  const text = String(memberId || "").trim();
  if (!text) return "";
  const safe = text.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^\.+/, "");
  return safe.slice(0, 128);
}

export function auditDir(stateDir) {
  return join(stateDir, AUDIT_DIR);
}

export function exportPath(stateDir, memberId) {
  const id = safeMemberId(memberId);
  if (!id) throw new Error("member id is required");
  return join(auditDir(stateDir), `${id}.jsonl`);
}

function nowNano(ms = Date.now()) {
  return `${BigInt(Math.floor(ms)) * 1_000_000n + (process.hrtime.bigint() % 1_000_000n)}`;
}

function toNano(timestamp) {
  if (timestamp === undefined || timestamp === null || timestamp === "") return nowNano();
  if (typeof timestamp === "bigint") return timestamp.toString();
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) return nowNano(timestamp);
  const text = String(timestamp).trim();
  if (/^\d{16,}$/.test(text)) return text; // already nanoseconds
  if (/^\d{1,15}$/.test(text)) return nowNano(Number(text)); // milliseconds
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? nowNano(parsed) : nowNano();
}

export function newRecordId(timeUnixNano = nowNano()) {
  return `${timeUnixNano}-${randomBytes(4).toString("hex")}`;
}

export function isLogRecord(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.attributes) && value.timeUnixNano && value.body && typeof value.body === "object");
}

/**
 * Build one audit LogRecord.
 *
 *   buildRecord({ memberId, kind, eventName, summary, refs: { runId, channelId }, status, timestamp, severityNumber, attributes })
 *
 * `refs` become flat attributes (see REF_ATTRS) so any OTLP consumer can
 * filter on `autohand.run.id`; unknown ref names are kept under
 * `autohand.ref.<name>`.
 */
export function buildRecord(spec = {}) {
  const memberId = String(spec.memberId || "").trim();
  if (!memberId) throw new Error("audit record needs a memberId");
  const kind = ACTIVITY_KINDS.includes(spec.kind) ? spec.kind : "run";
  const eventName = String(spec.eventName || `web.${kind}`).trim();
  const timeUnixNano = toNano(spec.timestamp);
  const refs = spec.refs && typeof spec.refs === "object" ? spec.refs : {};
  const refAttributes = {};
  for (const [name, value] of Object.entries(refs)) {
    if (value === undefined || value === null || value === "") continue;
    refAttributes[REF_ATTRS[name] || `autohand.ref.${name}`] = typeof value === "object" ? JSON.stringify(value) : value;
  }
  const attributes = {
    [ATTR.memberId]: memberId,
    [ATTR.eventName]: eventName,
    [ATTR.kind]: kind,
    [ATTR.status]: spec.status || "",
    [ATTR.source]: spec.source || "bridge",
    ...refAttributes,
    ...(spec.attributes && typeof spec.attributes === "object" ? spec.attributes : {}),
  };
  const severityNumber = Number(spec.severityNumber) || SEVERITY.INFO;
  const traceSeed = refs.runId || refs.workflowId || refs.taskId || "";
  const record = {
    id: spec.id || newRecordId(timeUnixNano),
    timeUnixNano,
    observedTimeUnixNano: nowNano(),
    severityNumber,
    severityText: severityText(severityNumber),
    body: anyValue(String(spec.summary || eventName).slice(0, 1000)),
    attributes: attributesFromObject(attributes),
    droppedAttributesCount: 0,
  };
  if (traceSeed) {
    record.traceId = traceIdFor(traceSeed);
    record.spanId = spanIdFor(`${traceSeed}:${eventName}`);
  }
  return record;
}

/** Decode a stored LogRecord into the flat shape the web app renders. */
export function decodeRecord(record) {
  if (!isLogRecord(record)) return null;
  const attributes = attributesToObject(record.attributes);
  const refs = {};
  for (const [name, key] of Object.entries(REF_ATTRS)) {
    if (attributes[key] !== undefined && attributes[key] !== "") refs[name] = attributes[key];
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith("autohand.ref.") && value !== "") refs[key.slice("autohand.ref.".length)] = value;
  }
  let nano = 0n;
  try {
    nano = BigInt(record.timeUnixNano);
  } catch {
    nano = 0n;
  }
  const body = record.body && typeof record.body === "object" && "stringValue" in record.body ? record.body.stringValue : "";
  return {
    id: String(record.id || ""),
    at: new Date(Number(nano / 1_000_000n)).toISOString(),
    timeUnixNano: String(record.timeUnixNano),
    memberId: String(attributes[ATTR.memberId] || ""),
    kind: String(attributes[ATTR.kind] || "run"),
    eventName: String(attributes[ATTR.eventName] || ""),
    status: String(attributes[ATTR.status] || ""),
    source: String(attributes[ATTR.source] || ""),
    summary: String(body || attributes[ATTR.eventName] || ""),
    severityNumber: Number(record.severityNumber) || SEVERITY.INFO,
    refs,
    attributes,
    traceId: record.traceId || "",
    spanId: record.spanId || "",
  };
}

function memberIdOf(record) {
  const entry = record.attributes.find((item) => item.key === ATTR.memberId);
  return String(entry?.value?.stringValue || "");
}

// Appends are chained per file so concurrent events never interleave lines.
const writeChains = new Map();

/**
 * Append one record. Accepts a built LogRecord or a `buildRecord` spec.
 * Resolves to the stored record once the line is on disk.
 */
export async function appendRecord(stateDir, record) {
  const built = isLogRecord(record) ? record : buildRecord(record);
  const memberId = memberIdOf(built);
  const file = exportPath(stateDir, memberId);
  const line = `${JSON.stringify(built)}\n`;
  const previous = writeChains.get(file) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => mkdir(auditDir(stateDir), { recursive: true }))
    .then(() => appendFile(file, line, "utf8"));
  writeChains.set(file, next);
  await next;
  return built;
}

/** Wait until every pending append has landed (used by checks and shutdown). */
export async function flushAppends() {
  await Promise.all(Array.from(writeChains.values()).map((chain) => chain.catch(() => {})));
}

function parseLine(line) {
  const text = line.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isLogRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function compareNewestFirst(a, b) {
  if (a.nano === b.nano) return a.record.id < b.record.id ? 1 : a.record.id > b.record.id ? -1 : 0;
  return a.nano < b.nano ? 1 : -1;
}

function cutoffNano(before) {
  const text = String(before || "").trim();
  if (!text) return null;
  if (/^\d{16,}$/.test(text)) return BigInt(text);
  if (/^\d{1,15}$/.test(text)) return BigInt(text) * 1_000_000n;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? BigInt(parsed) * 1_000_000n : null;
}

/** Read every stored record for a member, newest first, corrupt lines dropped. */
export async function readAllRecords(stateDir, memberId) {
  const file = exportPath(stateDir, memberId);
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], dropped: 0 };
    throw error;
  }
  const entries = [];
  let dropped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const record = parseLine(line);
    if (!record) {
      dropped += 1;
      continue;
    }
    let nano = 0n;
    try {
      nano = BigInt(record.timeUnixNano);
    } catch {
      nano = 0n;
    }
    entries.push({ nano, record });
  }
  entries.sort(compareNewestFirst);
  return { records: entries.map((entry) => entry.record), dropped };
}

/**
 * Page through a member's records, newest first.
 *
 *   readRecords(stateDir, memberId, { before, limit, kind, decode })
 *
 * `before` is a cursor: a record id (returns the records after it in newest-
 * first order) or a time (ISO string, epoch ms, or nanoseconds; returns
 * records strictly older). `kind` narrows to one activity kind. Records come
 * back decoded (see `decodeRecord`) unless `decode: false`.
 */
export async function readRecords(stateDir, memberId, { before = "", limit = DEFAULT_PAGE, kind = "", decode = true } = {}) {
  const pageSize = Math.max(1, Math.min(MAX_PAGE, Number(limit) || DEFAULT_PAGE));
  const { records: all, dropped } = await readAllRecords(stateDir, memberId);
  let start = 0;
  const cursor = String(before || "").trim();
  if (cursor) {
    const index = all.findIndex((record) => record.id === cursor);
    if (index >= 0) start = index + 1;
    else {
      const cutoff = cutoffNano(cursor);
      if (cutoff !== null) {
        start = all.findIndex((record) => {
          try {
            return BigInt(record.timeUnixNano) < cutoff;
          } catch {
            return false;
          }
        });
        if (start < 0) start = all.length;
      }
    }
  }
  const wanted = kind && ACTIVITY_KINDS.includes(kind) ? kind : "";
  const page = [];
  let index = start;
  for (; index < all.length && page.length < pageSize; index += 1) {
    const record = all[index];
    if (wanted) {
      const entry = record.attributes.find((item) => item.key === ATTR.kind);
      if (String(entry?.value?.stringValue || "") !== wanted) continue;
    }
    page.push(record);
  }
  let hasMore = false;
  for (; index < all.length; index += 1) {
    if (!wanted) {
      hasMore = true;
      break;
    }
    const entry = all[index].attributes.find((item) => item.key === ATTR.kind);
    if (String(entry?.value?.stringValue || "") === wanted) {
      hasMore = true;
      break;
    }
  }
  const last = page[page.length - 1];
  return {
    records: decode ? page.map(decodeRecord) : page,
    hasMore,
    nextBefore: hasMore && last ? last.id : "",
    total: all.length,
    dropped,
  };
}

/** Size of a member's trail, for HTTP headers; `null` when nothing is stored yet. */
export async function exportStats(stateDir, memberId) {
  try {
    const info = await stat(exportPath(stateDir, memberId));
    return { size: info.size, modifiedAt: info.mtime.toISOString() };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** A readable stream of the raw JSONL file, for the export download. */
export function exportStream(stateDir, memberId) {
  return createReadStream(exportPath(stateDir, memberId), { encoding: "utf8" });
}
