// Claude Code adapter (`claude -p --output-format stream-json --verbose`).
// Emits SDK-shaped events so the existing stream, trace, and reply helpers in
// server.mjs work unchanged.

import { join } from "node:path";
import { compareVersions, fileExists, findExecutable, homeDir, parseVersion, probe, redactHome } from "./discovery.mjs";

export const id = "claude";
export const label = "Claude Code";
export const vendor = "Anthropic";
export const executableName = "claude";
export const minimumVersion = "1.0.0";

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
  install: "npm install -g @anthropic-ai/claude-code  (or: brew install --cask claude-code)",
  login: "claude  (then run /login)",
  docs: "https://docs.anthropic.com/en/docs/claude-code/cli-reference",
};

function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || join(homeDir, ".claude");
}

function looksSignedIn() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const home = claudeHome();
  // Claude Code keeps OAuth in the keychain on macOS and in .credentials.json
  // elsewhere; either a credentials file or an existing config indicates a
  // completed first run. We never read the secret itself.
  return fileExists(join(home, ".credentials.json")) || fileExists(join(homeDir, ".claude.json"));
}

export async function detect({ explicitPath = "" } = {}) {
  const executable = findExecutable(executableName, { explicitPath });
  if (!executable) {
    return {
      status: "not-detected",
      version: "",
      executable: "",
      detail: "Claude Code was not found on this machine.",
      setup: setup.install,
    };
  }
  const result = probe(executable, ["--version"], { timeoutMs: 10000 });
  if (!result.ok) {
    return {
      status: "unsupported",
      version: "",
      executable: redactHome(executable),
      executablePath: executable,
      detail: `Claude Code did not report a version: ${result.error}`,
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
      detail: `Claude Code ${version} is older than ${minimumVersion}.`,
      setup: "claude update",
    };
  }
  if (!looksSignedIn()) {
    return {
      status: "setup-required",
      version,
      executable: redactHome(executable),
      executablePath: executable,
      detail: "Claude Code is installed but has not completed sign-in.",
      setup: setup.login,
    };
  }
  return {
    status: "ready",
    version,
    executable: redactHome(executable),
    executablePath: executable,
    detail: `Claude Code ${version} is available.`,
    setup: "",
  };
}

function permissionArgs(permissions = {}, policy = "") {
  if (permissions.permissionMode === "unrestricted") {
    return ["--permission-mode", "bypassPermissions", "--dangerously-skip-permissions"];
  }
  if (permissions.permissionMode === "restricted" || policy === "restricted") {
    return ["--permission-mode", "plan", "--restricted"];
  }
  return ["--permission-mode", "acceptEdits"];
}

export function buildArgs({ prompt, workspace, model, permissions = {}, policy = "", appendSystemPrompt = "", addDirs = [], resumeId = "" }) {
  // The prompt is passed right after `-p`: `--add-dir` is variadic in the
  // Claude CLI and would otherwise consume a trailing prompt argument.
  const args = ["-p", String(prompt || ""), "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  const display = ["-p", "<prompt>", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (resumeId) {
    args.push("--resume", resumeId);
    display.push("--resume", "<session>");
  }
  if (model) {
    args.push("--model", model);
    display.push("--model", model);
  }
  for (const flag of permissionArgs(permissions, policy)) {
    args.push(flag);
    display.push(flag);
  }
  if (appendSystemPrompt) {
    args.push("--append-system-prompt", appendSystemPrompt);
    display.push("--append-system-prompt", "<agent-profile>");
  }
  for (const dir of [workspace, ...addDirs].filter(Boolean)) {
    args.push("--add-dir", dir);
    display.push("--add-dir", "<dir>");
  }
  return { args, displayArgs: display };
}

function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block === "string" ? block : block?.type === "text" ? block.text || "" : ""))
    .filter(Boolean)
    .join("\n");
}

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
  if (event?.session_id && !state.resumeId) state.resumeId = String(event.session_id);
  const type = String(event?.type || "");

  if (type === "system") {
    if (event.subtype === "init") {
      return [{ type: "agent_start", model: event.model || "", sessionId: state.resumeId, timestamp }];
    }
    return [{ type: "status", status: `system_${event.subtype || "event"}`, timestamp }];
  }

  if (type === "stream_event") {
    const inner = event.event || {};
    if (inner.type === "content_block_delta") {
      const delta = inner.delta || {};
      if (delta.type === "text_delta" && delta.text) {
        state.sawDelta = true;
        return [{ type: "message_update", messageId: state.resumeId, delta: String(delta.text), timestamp }];
      }
      if (delta.type === "thinking_delta" && delta.thinking) {
        return [{ type: "message_update", messageId: state.resumeId, delta: "", thought: String(delta.thinking), timestamp }];
      }
    }
    return [];
  }

  if (type === "assistant") {
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    const events = [];
    const messageText = blockText(content);
    if (messageText) {
      events.push({ type: "message_end", messageId: String(event.message?.id || ""), content: messageText, timestamp });
    }
    for (const block of content) {
      if (block?.type === "tool_use") {
        const toolId = String(block.id || `tool-${state.sequence += 1}`);
        state.toolNames.set(toolId, String(block.name || "tool"));
        events.push({ type: "tool_start", toolId, toolName: String(block.name || "tool"), args: block.input || {}, timestamp });
      }
    }
    return events;
  }

  if (type === "user") {
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    const events = [];
    for (const block of content) {
      if (block?.type === "tool_result") {
        const toolId = String(block.tool_use_id || "");
        const output = blockText(block.content);
        const failed = block.is_error === true;
        events.push({
          type: "tool_end",
          toolId,
          toolName: state.toolNames.get(toolId) || "tool",
          success: !failed,
          output: failed ? "" : output,
          error: failed ? output || "tool failed" : "",
          timestamp,
        });
      }
    }
    return events;
  }

  if (type === "result") {
    const events = [];
    if (event.usage) events.push({ type: "usage", usage: event.usage, costUsd: event.total_cost_usd, timestamp });
    if (event.is_error || String(event.subtype || "").startsWith("error")) {
      events.push({ type: "error", message: event.result || event.error || `Claude Code ended with ${event.subtype || "an error"}`, timestamp });
    } else {
      if (event.result && !state.sawDelta) {
        events.push({ type: "message_end", messageId: state.resumeId, content: String(event.result), timestamp });
      }
      events.push({ type: "agent_end", reason: event.subtype || "completed", timestamp });
    }
    return events;
  }

  return [{ type: "status", status: type || "claude_event", timestamp }];
}

export function resumeIdFrom(state) {
  return state?.resumeId || "";
}
