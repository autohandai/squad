// Claude Code adapter (`claude -p --output-format stream-json --verbose`).
// Emits SDK-shaped events so the existing stream, trace, and reply helpers in
// server.mjs work unchanged.

import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { compareVersions, fileExists, findExecutable, homeDir, parseVersion, probe, redactHome } from "./discovery.mjs";
import { resolveAccess } from "./access.mjs";

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
  login: "claude auth login",
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
      signIn: { label: "Sign in with your Claude account", alternative: "or set ANTHROPIC_API_KEY" },
    };
  }
  const account = claudeAccount(executable);
  const options = claudeOptions(executable);
  if (account.checked && !account.signedIn) {
    return {
      status: "setup-required",
      version,
      executable: redactHome(executable),
      executablePath: executable,
      detail: "Claude Code is installed but not signed in.",
      setup: "claude auth login",
      signIn: { label: "Sign in with your Claude account", alternative: "or set ANTHROPIC_API_KEY" },
    };
  }
  return {
    status: "ready",
    version,
    executable: redactHome(executable),
    executablePath: executable,
    detail: account.email
      ? `Claude Code ${version} is signed in as ${account.email}${account.subscription ? ` (${account.subscription})` : ""}.`
      : `Claude Code ${version} is available.`,
    setup: "",
    account,
    ...options,
  };
}

/**
 * What this installed Claude Code accepts (ADR-0114), read from its own
 * `--help` so the app never offers a flag the binary does not have:
 * `--effort` choices, `--permission-mode` choices, the model aliases named
 * in the `--model` paragraph, plus the models Claude Code itself cached in
 * ~/.claude.json and the default model from ~/.claude/settings.json.
 */
function claudeOptions(executable) {
  const help = probe(executable, ["--help"], { timeoutMs: 10000 });
  const parsed = parseClaudeHelp(help.ok ? help.stdout : "");
  const home = claudeHome();
  let defaultModel = "";
  try { defaultModel = String(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).model || ""); } catch {}
  const models = parsed.modelAliases.map((alias) => ({ id: alias, label: alias.charAt(0).toUpperCase() + alias.slice(1), detail: `latest ${alias}` }));
  try {
    const cache = JSON.parse(readFileSync(join(homeDir, ".claude.json"), "utf8")).additionalModelOptionsCache;
    for (const item of Array.isArray(cache) ? cache : []) {
      const value = String(item?.value || "").trim();
      if (value && !models.some((model) => model.id === value)) models.push({ id: value, label: `${String(item.label || value)}${/\[1m\]$/.test(value) ? " (1M context)" : ""}`, detail: String(item.description || "") });
    }
  } catch {}
  return {
    models,
    efforts: parsed.efforts,
    permissionModeChoices: parsed.permissionModes,
    accessModes: ["plan", "write", "full"],
    defaults: { model: defaultModel, effort: "" },
  };
}

/**
 * Folders that are Claude Code's own and must be reachable whatever the
 * member's folders are (ADR-0116): `--restricted` confines the file tools to
 * the working directory and `--add-dir` folders, which blocked plan mode
 * from writing its plan to ~/.claude/plans. Only that subfolder is added;
 * ~/.claude itself holds credentials and settings.
 */
export function engineDirs() {
  const plans = join(claudeHome(), "plans");
  try { mkdirSync(plans, { recursive: true }); } catch {}
  return [plans];
}

/** Pure: pull the option lists out of `claude --help` text. */
export function parseClaudeHelp(text) {
  const source = String(text || "");
  const choices = (flag) => {
    const match = source.match(new RegExp(`${flag} <[a-z]+>[\\s\\S]{0,400}?\\(choices: ([^)]*)\\)`));
    return match ? match[1].split(",").map((item) => item.replace(/["\s]/g, "")).filter(Boolean) : [];
  };
  const effortMatch = source.match(/--effort <level>[\s\S]{0,200}?\(([^)]*)\)/);
  const efforts = effortMatch ? effortMatch[1].split(",").map((item) => item.replace(/["\s]/g, "")).filter((item) => /^[a-z]+$/.test(item)) : [];
  const modelParagraph = source.match(/--model <model>([\s\S]{0,400}?)(?:\n\s{2}-|\n\s*$)/);
  const modelAliases = modelParagraph ? Array.from(modelParagraph[1].matchAll(/'([a-z0-9.-]+)'/g)).map((match) => match[1]) : [];
  for (const alias of ["fable", "opus", "sonnet", "haiku"]) if (!modelAliases.includes(alias) && modelAliases.length) modelAliases.push(alias);
  return { efforts, permissionModes: choices("--permission-mode"), modelAliases };
}

// `claude auth status` prints JSON (loggedIn, authMethod, email, subscriptionType)
// without the credential. Older builds lack the command; then we keep the
// file-based detection above.
function claudeAccount(executable) {
  const result = probe(executable, ["auth", "status"], { timeoutMs: 10000 });
  try {
    const parsed = JSON.parse(String(result.stdout || "").trim());
    return {
      checked: true,
      signedIn: parsed.loggedIn === true,
      method: parsed.authMethod || "",
      email: parsed.email || "",
      subscription: parsed.subscriptionType || "",
      label: parsed.email || parsed.authMethod || "",
    };
  } catch {
    return { checked: false, signedIn: looksSignedIn(), method: "", email: "", subscription: "", label: "" };
  }
}

// Access (ADR-0114): an explicit choice from the composer or the member's
// engine settings wins; otherwise the member's permission level and the
// launch policy decide, exactly as before.
function permissionArgs(permissions = {}, policy = "", access = "") {
  const resolved = resolveAccess({ access, permissionMode: permissions.permissionMode, policy });
  if (resolved === "full") {
    return ["--permission-mode", "bypassPermissions", "--dangerously-skip-permissions"];
  }
  if (resolved === "plan") {
    return ["--permission-mode", "plan", "--restricted"];
  }
  return ["--permission-mode", "acceptEdits"];
}

export function buildArgs({ prompt, workspace, model, permissions = {}, policy = "", access = "", effort = "", efforts = [], appendSystemPrompt = "", addDirs = [], resumeId = "" }) {
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
  for (const flag of permissionArgs(permissions, policy, access)) {
    args.push(flag);
    display.push(flag);
  }
  // Reasoning effort only when this binary advertises it (detect reads
  // `--help`); an unknown list lets the value through so a newer CLI works.
  if (effort && (!Array.isArray(efforts) || !efforts.length || efforts.includes(effort))) {
    args.push("--effort", effort);
    display.push("--effort", effort);
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
    if (event.usage) {
      // Current Claude Code builds also report per-model usage with the
      // model's context window; the member context gauge needs that window
      // (ADR-0111). Older builds omit it and the gauge stays absent.
      const modelUsage = event.modelUsage && typeof event.modelUsage === "object" ? event.modelUsage : null;
      events.push({ type: "usage", usage: modelUsage ? { ...event.usage, modelUsage } : event.usage, costUsd: event.total_cost_usd, timestamp });
    }
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
