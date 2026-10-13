// Sessions started outside Squad, seen through lifecycle hooks (ADR-0127).
//
// Each prompt becomes one run in the bridge's run list with mode "external":
// UserPromptSubmit opens it, PostToolUse adds a tool row, Stop closes it with
// the last reply, SessionEnd closes anything still open. Runs carry no member
// (the app shows them on a member whose engine and folders match, and in All
// work); they are persisted with the other finished runs.
import { open } from "node:fs/promises";

export const EXTERNAL_MODE = "external";
const MAX_LOGS = 400;

function isoOr(value, fallback) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function title(prompt) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text || "Session outside Squad";
}

/** Pure: the last assistant text in a Claude Code transcript (JSONL). */
export function lastAssistantText(jsonl) {
  const lines = String(jsonl || "").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const message = entry?.message;
      if (entry?.type !== "assistant" || !Array.isArray(message?.content)) continue;
      const text = message.content.filter((part) => part?.type === "text" && part.text).map((part) => part.text).join("\n").trim();
      if (text) return text;
    } catch {
      // A torn last line while the engine is still writing.
    }
  }
  return "";
}

async function readTail(path, bytes = 256 * 1024) {
  if (!path) return "";
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * `runs` is the bridge's Map; `persist()` saves finished runs; `emit(name,
 * payload)` reaches the event bus. Returns { runId } or null when the event
 * opened or touched nothing.
 */
export function createExternalSessions({ runs, persist = () => {}, emit = () => {}, now = () => new Date().toISOString() }) {
  const current = new Map(); // `${engine}:${sessionId}` → run id of the open prompt
  const counts = new Map();

  const log = (run, source, line) => {
    if (run.logs.length >= MAX_LOGS) return;
    run.logs.push({ source, line: String(line).slice(0, 4000), at: now() });
  };

  function open(engine, body) {
    const key = `${engine}:${body.sessionId}`;
    close(engine, body, "stopped", "A new prompt started before the previous one reported its end.");
    const index = (counts.get(key) || 0) + 1;
    counts.set(key, index);
    const id = `external-${engine}-${body.sessionId.slice(0, 40)}-${index}`.replace(/[^A-Za-z0-9_.:-]/g, "-");
    const at = isoOr(body.at, now());
    const run = {
      id,
      agentId: "",
      title: title(body.prompt),
      prompt: String(body.prompt || ""),
      mode: EXTERNAL_MODE,
      kind: EXTERNAL_MODE,
      external: { engine, sessionId: body.sessionId, transcriptPath: body.transcriptPath || "" },
      workspace: body.cwd || "",
      effectiveModel: { provider: engine === "codex" ? "openai" : "anthropic", model: "" },
      transport: engine,
      harness: engine,
      harnessVersion: "",
      command: `${engine === "codex" ? "codex" : "claude"} (started outside Squad)`,
      logPath: "",
      status: "running",
      exitCode: null,
      startedAt: at,
      finishedAt: null,
      contextPack: null,
      contextLayers: null,
      logs: [],
      abortController: null,
    };
    log(run, "system", `${engine === "codex" ? "Codex" : "Claude Code"} session ${body.sessionId.slice(0, 8)} in ${body.cwd || "an unknown folder"}`);
    runs.set(id, run);
    current.set(key, id);
    return run;
  }

  function close(engine, body, status, note = "") {
    const key = `${engine}:${body.sessionId}`;
    const run = runs.get(current.get(key));
    if (!run || run.status !== "running") return null;
    run.status = status;
    run.exitCode = status === "completed" ? 0 : null;
    run.finishedAt = isoOr(body.at, now());
    run.durationMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
    if (note) log(run, "system", note);
    current.delete(key);
    persist();
    emit("chat.finished", { memberId: "", status, preview: String(run.reply || "").slice(0, 140), external: engine });
    return run;
  }

  async function ingest(engine, body) {
    if (!body?.sessionId) return null;
    const key = `${engine}:${body.sessionId}`;
    switch (body.event) {
      case "UserPromptSubmit":
        return { runId: open(engine, body).id };
      case "PostToolUse": {
        const run = runs.get(current.get(key)) || open(engine, { ...body, prompt: "" });
        log(run, "tool", `${body.toolName || "tool"} ${body.toolError ? "failed" : "completed"}${body.toolInput ? ` ${body.toolInput}` : ""}`);
        if (body.toolError) log(run, "stderr", body.toolError);
        return { runId: run.id };
      }
      case "Stop": {
        const run = runs.get(current.get(key));
        if (!run) return null;
        const reply = String(body.lastAssistantMessage || "").trim() || (engine === "claude" ? lastAssistantText(await readTail(body.transcriptPath || run.external.transcriptPath)) : "");
        run.reply = reply.slice(0, 20000);
        if (reply) log(run, "stdout", reply);
        close(engine, body, "completed");
        return { runId: run.id };
      }
      case "SessionEnd": {
        const run = close(engine, body, "stopped", `Session ended${body.reason ? ` (${body.reason})` : ""}.`);
        current.delete(key);
        return run ? { runId: run.id } : null;
      }
      default:
        return null;
    }
  }

  return { ingest };
}
