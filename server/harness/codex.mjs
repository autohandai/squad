// Codex CLI adapter (`codex exec --json`). Emits SDK-shaped events so the
// existing stream, trace, and reply helpers in server.mjs work unchanged.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { compareVersions, fileExists, findExecutable, homeDir, parseVersion, probe, redactHome } from "./discovery.mjs";

export const id = "codex";
export const label = "Codex";
export const vendor = "OpenAI";
export const executableName = "codex";
export const minimumVersion = "0.40.0";

export const capabilities = {
  streaming: true,
  toolEvents: true,
  resume: true,
  interrupt: true,
  modelOverride: true,
  images: false,
  permissionModes: ["restricted", "interactive", "unrestricted"],
};

export const setup = {
  install: "npm install -g @openai/codex  (or: brew install codex)",
  login: "codex login",
  docs: "https://developers.openai.com/codex/cli",
};

function codexHome() {
  return process.env.CODEX_HOME || join(homeDir, ".codex");
}

export async function detect({ explicitPath = "" } = {}) {
  const executable = findExecutable(executableName, { explicitPath });
  if (!executable) {
    return {
      status: "not-detected",
      version: "",
      executable: "",
      detail: "Codex CLI was not found on this machine.",
      setup: setup.install,
    };
  }
  const result = probe(executable, ["--version"], { timeoutMs: 8000 });
  if (!result.ok) {
    return {
      status: "unsupported",
      version: "",
      executable: redactHome(executable),
      executablePath: executable,
      detail: `Codex did not report a version: ${result.error}`,
      setup: setup.install,
    };
  }
  const version = parseVersion(result.stdout);
  if (compareVersions(version, minimumVersion) < 0) {
    return {
      status: "unsupported",
      version,
      executable: redactHome(executable),
      executablePath: executable,
      detail: `Codex ${version} is older than ${minimumVersion}; \`codex exec --json\` is required.`,
      setup: "codex update",
    };
  }
  const authFile = join(codexHome(), "auth.json");
  const authenticated = fileExists(authFile) || Boolean(process.env.OPENAI_API_KEY);
  if (!authenticated) {
    return {
      status: "setup-required",
      version,
      executable: redactHome(executable),
      executablePath: executable,
      detail: "Codex is installed but not signed in.",
      setup: setup.login,
    };
  }
  return {
    status: "ready",
    version,
    executable: redactHome(executable),
    executablePath: executable,
    detail: `Codex ${version} is signed in.`,
    setup: "",
  };
}

function sandboxFor(permissionMode, policy) {
  if (permissionMode === "unrestricted") return "danger-full-access";
  if (permissionMode === "restricted" || policy === "restricted") return "read-only";
  return "workspace-write";
}

/**
 * Build the non-interactive command. Prompt goes last. `resumeId` switches to
 * `codex exec resume <thread>` which keeps the same thread on disk.
 */
export function buildArgs({ prompt, workspace, model, permissions = {}, policy = "", appendSystemPrompt = "", addDirs = [], resumeId = "" }) {
  const args = ["exec"];
  const display = ["exec"];
  if (resumeId) {
    args.push("resume", resumeId);
    display.push("resume", "<thread>");
  }
  args.push("--json", "--skip-git-repo-check", "--color", "never");
  display.push("--json", "--skip-git-repo-check", "--color", "never");
  if (!resumeId) {
    args.push("-C", workspace);
    display.push("-C", workspace);
    const sandbox = sandboxFor(permissions.permissionMode, policy);
    args.push("--sandbox", sandbox);
    display.push("--sandbox", sandbox);
    for (const dir of addDirs) {
      args.push("--add-dir", dir);
      display.push("--add-dir", "<dir>");
    }
  }
  if (model) {
    args.push("-m", model);
    display.push("-m", model);
  }
  let finalPrompt = String(prompt || "");
  if (appendSystemPrompt && !resumeId) {
    // Codex exec has no system-prompt flag; the member profile is prepended
    // as operating instructions inside the first turn.
    finalPrompt = `<operating_instructions>\n${appendSystemPrompt}\n</operating_instructions>\n\n${finalPrompt}`;
  }
  args.push(finalPrompt);
  display.push("<prompt>");
  return { args, displayArgs: display };
}

function itemToolName(item) {
  switch (item?.type) {
    case "command_execution":
      return "shell";
    case "file_change":
      return "apply_patch";
    case "mcp_tool_call":
      return `${item.server || "mcp"}.${item.tool || "tool"}`;
    case "web_search":
      return "web_search";
    default:
      return String(item?.type || "tool");
  }
}

function itemArgs(item) {
  switch (item?.type) {
    case "command_execution":
      return { command: item.command || "" };
    case "file_change":
      return { changes: Array.isArray(item.changes) ? item.changes : [] };
    case "mcp_tool_call":
      return item.arguments && typeof item.arguments === "object" ? item.arguments : {};
    case "web_search":
      return { query: item.query || "" };
    default:
      return {};
  }
}

function itemOutput(item) {
  switch (item?.type) {
    case "command_execution":
      return String(item.aggregated_output || item.output || "");
    case "file_change":
      return (Array.isArray(item.changes) ? item.changes : [])
        .map((change) => `${change.kind || "update"} ${change.path || ""}`.trim())
        .join("\n");
    case "mcp_tool_call":
      return typeof item.result === "string" ? item.result : item.result ? JSON.stringify(item.result) : "";
    case "web_search":
      return String(item.query || "");
    default:
      return "";
  }
}

function itemSucceeded(item) {
  if (item?.type === "command_execution") {
    if (typeof item.exit_code === "number") return item.exit_code === 0;
    return item.status !== "failed";
  }
  return item?.status !== "failed" && !item?.error;
}

/**
 * Parse one JSONL line into SDK-shaped events. `state` persists across lines:
 * { resumeId, startedTools:Set, timestamp() }.
 */
export function parseLine(line, state) {
  const text = String(line || "").trim();
  if (!text) return [];
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return [{ type: "raw", stream: "stdout", output: text, timestamp: state.timestamp() }];
  }
  const timestamp = state.timestamp();
  const type = String(event?.type || "");

  if (type === "thread.started") {
    if (event.thread_id) state.resumeId = String(event.thread_id);
    return [{ type: "agent_start", model: event.model || "", sessionId: state.resumeId, timestamp }];
  }
  if (type === "turn.started") return [{ type: "status", status: "turn_started", timestamp }];
  if (type === "turn.completed") {
    const events = [];
    if (event.usage) events.push({ type: "usage", usage: event.usage, timestamp });
    events.push({ type: "agent_end", reason: "completed", timestamp });
    return events;
  }
  if (type === "turn.failed") {
    return [{ type: "error", message: event?.error?.message || "Codex turn failed", timestamp }];
  }
  if (type === "error") {
    return [{ type: "error", message: event.message || "Codex error", timestamp }];
  }
  const item = event?.item;
  if (!item || typeof item !== "object") {
    return [{ type: "status", status: type || "codex_event", timestamp }];
  }
  const itemId = String(item.id || `${item.type}-${state.sequence += 1}`);
  if (item.type === "agent_message") {
    if (type === "item.completed") {
      return [{ type: "message_end", messageId: itemId, content: String(item.text || ""), timestamp }];
    }
    return [];
  }
  if (item.type === "reasoning") {
    if (type === "item.completed" && item.text) {
      return [{ type: "message_update", messageId: itemId, delta: "", thought: String(item.text), timestamp }];
    }
    return [];
  }
  if (item.type === "error") {
    // Codex reports non-fatal diagnostics (for example a shortened skills
    // budget) as error items while the turn continues. Only `turn.failed` or a
    // top-level error ends the turn, so surface these as warnings.
    state.warnings.push(String(item.message || "Codex reported a warning"));
    return [{ type: "tool_update", toolId: "codex-warning", toolName: "Codex", output: String(item.message || ""), stream: "stderr", timestamp }];
  }
  if (item.type === "todo_list") {
    return [{ type: "status", status: "todo_list", timestamp }];
  }
  const toolName = itemToolName(item);
  if (type === "item.started") {
    state.startedTools.add(itemId);
    return [{ type: "tool_start", toolId: itemId, toolName, args: itemArgs(item), timestamp }];
  }
  if (type === "item.completed") {
    const events = [];
    if (!state.startedTools.has(itemId)) {
      events.push({ type: "tool_start", toolId: itemId, toolName, args: itemArgs(item), timestamp });
    }
    const success = itemSucceeded(item);
    events.push({
      type: "tool_end",
      toolId: itemId,
      toolName,
      success,
      output: success ? itemOutput(item) : "",
      error: success ? "" : itemOutput(item) || item.error || `${toolName} failed`,
      timestamp,
    });
    return events;
  }
  if (type === "item.updated") {
    const output = itemOutput(item);
    return output ? [{ type: "tool_update", toolId: itemId, toolName, output, stream: "stdout", timestamp }] : [];
  }
  return [{ type: "status", status: type || "codex_event", timestamp }];
}

export function resumeIdFrom(state) {
  return state?.resumeId || "";
}

export function sessionStorePath(agentHome) {
  return join(agentHome, "harness-sessions.json");
}

export function isInstalledForTests() {
  return existsSync(codexHome());
}
