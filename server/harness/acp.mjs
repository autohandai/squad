// Generic Agent Client Protocol adapter (ADR-0122): one adapter runs any
// registry agent (`acp:<registry id>`), Pi (`pi`) and the Autohand CLI in
// ACP mode (`autohand-acp`). The agent is spawned per turn, the bridge is
// the ACP client (initialize → session/new or session/load → session/prompt),
// `session/update` notifications become the same SDK-shaped events the other
// adapters emit, permission requests are answered from the member's access,
// and the file-system methods are served inside the member's folders. The
// session id is the resume id, so Previous chats and New chat (ADR-0113)
// work unchanged.
//
// Protocol pages read on 2026-10-14 (v1, protocolVersion 1):
//   https://agentclientprotocol.com/protocol/overview
//   https://agentclientprotocol.com/protocol/initialization
//   https://agentclientprotocol.com/protocol/session-setup
//   https://agentclientprotocol.com/protocol/prompt-turn
//   https://agentclientprotocol.com/protocol/tool-calls
//   https://agentclientprotocol.com/protocol/file-system
//   https://agentclientprotocol.com/protocol/v1/schema (UsageUpdate: used, size, cost)

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { AcpConnection, JSON_RPC_ERRORS, PROTOCOL_VERSION, rpcError } from "../acp/client.mjs";
import { agentIdFromHarnessId, findAgentSync, harnessIdFor, isAcpHarnessId, launchFor, loadRegistry } from "../acp/registry.mjs";
import { guiSafeEnv, redactHome } from "./discovery.mjs";
import { resolveAccess } from "./access.mjs";
import { formatDuration } from "../../src/lib/duration.js";
import { stopMessage } from "./stop-reason.mjs";
import { acpPromptInput } from "../attachments.mjs";

export const transport = "acp";
export const ACCESS_MODES = Object.freeze(["plan", "write", "full"]);

const READ_KINDS = new Set(["read", "search", "fetch", "think"]);
const WRITE_KINDS = new Set(["edit", "delete", "move"]);

export const capabilities = Object.freeze({
  streaming: true,
  toolEvents: true,
  resume: true,
  interrupt: true,
  modelOverride: false,
  images: false,
  permissionModes: ["restricted", "interactive", "unrestricted"],
});

const adapters = new Map();

export { isAcpHarnessId, harnessIdFor, agentIdFromHarnessId };

/** The adapter for one ACP harness id; one object per id so `adapter.id` stays the harness id. */
export function forHarnessId(harnessId) {
  const id = String(harnessId || "").trim().toLowerCase();
  if (!isAcpHarnessId(id)) return null;
  if (adapters.has(id)) return adapters.get(id);
  const agent = findAgentSync(id);
  const adapter = {
    id,
    transport,
    agentId: agentIdFromHarnessId(id),
    label: agent?.name || labelFromId(id),
    vendor: agent?.authors?.[0] || "ACP",
    executableName: agentIdFromHarnessId(id),
    capabilities,
    setup: {
      install: "Open the engine chooser; installed agents are found, npx and uvx ones are fetched on first use.",
      login: "",
      docs: agent?.website || "https://agentclientprotocol.com",
    },
    detect: (options) => detect(adapter, options),
    buildArgs,
    parseLine,
    resumeIdFrom,
    run: runAcpHarness,
  };
  adapters.set(id, adapter);
  return adapter;
}

export function labelFromId(harnessId) {
  const id = String(harnessId || "");
  if (id === "pi") return "Pi";
  if (id === "autohand-acp") return "Autohand Code (ACP)";
  return agentIdFromHarnessId(id) || id;
}

async function detect(adapter, { explicitPath = "", context = {} } = {}) {
  const registry = await loadRegistry({ network: false });
  const agent = registry.agents.find((item) => item.id === adapter.agentId) || findAgentSync(adapter.id);
  if (!agent) {
    return {
      status: "not-detected",
      version: "",
      executable: "",
      detail: `${adapter.id} is not in the ACP registry on this machine.`,
      setup: "Open the engine chooser to refresh the registry.",
    };
  }
  adapter.label = agent.name;
  adapter.vendor = agent.authors?.[0] || "ACP";
  const launch = launchFor(agent, { explicitPath, context });
  const summary = { id: agent.id, name: agent.name, description: agent.description, website: agent.website, version: agent.version, builtIn: Boolean(agent.builtIn) };
  if (!launch.available) {
    return {
      status: "not-detected",
      version: agent.version,
      executable: "",
      detail: launch.detail,
      setup: launch.setup,
      installed: false,
      fetchOnUse: false,
      agent: summary,
    };
  }
  adapter.executableName = launch.executableName || agent.id;
  return {
    status: "ready",
    version: agent.version,
    executable: redactHome(launch.command),
    executablePath: launch.command,
    launchArgs: launch.args,
    installed: launch.installed,
    fetchOnUse: launch.fetchOnUse,
    detail: launch.detail,
    setup: "",
    accessModes: [...ACCESS_MODES],
    efforts: Array.isArray(agent.efforts) ? agent.efforts : [],
    models: [],
    defaults: { model: "", effort: "" },
    agent: summary,
  };
}

/**
 * The launch command is fixed by the registry; the turn itself travels over
 * the protocol, so `args` are the launch args and the prompt, instructions
 * and access go in `turn` for `runAcpHarness`.
 */
export function buildArgs({ prompt, workspace, model = "", access = "", effort = "", appendSystemPrompt = "", addDirs = [], resumeId = "", launchArgs = [], mcpServers = [], attachments = [] }) {
  const args = Array.isArray(launchArgs) ? launchArgs.map(String) : [];
  return {
    args,
    displayArgs: [...args, resumeId ? "<acp: resumed session>" : "<acp: new session>"],
    turn: {
      prompt: String(prompt || ""),
      instructions: String(appendSystemPrompt || ""),
      workspace: String(workspace || ""),
      addDirs: Array.isArray(addDirs) ? addDirs.filter(Boolean) : [],
      access: resolveAccess({ access }),
      resumeId: String(resumeId || ""),
      model: String(model || ""),
      effort: String(effort || ""),
      mcpServers,
      attachments,
    },
  };
}

/** Kept for the adapter contract; the ACP runner reads the protocol itself. */
export function parseLine(line, state) {
  const text = String(line || "").trim();
  return text ? [{ type: "raw", stream: "stdout", output: text, timestamp: state.timestamp() }] : [];
}

export function resumeIdFrom(state) {
  return state?.resumeId || "";
}

/** ACP v1 stdio is mandatory; HTTP is negotiated during initialization. */
export function acpMcpServers(servers = [], capabilities = {}) {
  return servers.map(server => {
    if (server.url) {
      const type = server.transport === "sse" ? "sse" : "http";
      if (!capabilities[type]) throw new Error(`The selected ACP agent does not support ${type} MCP server ${server.name}.`);
      return { type, name: server.name, url: server.url, headers: Object.entries(server.headers || {}).map(([name, value]) => ({ name, value: String(value) })) };
    }
    if (!server.name || !server.command) throw new Error("A managed MCP server needs a name and command.");
    return { name: server.name, command: server.command, args: server.args || [], env: Object.entries(server.env || {}).map(([name, value]) => ({ name, value: String(value) })) };
  });
}

// ---------------------------------------------------------------------------
// Pure helpers (checked by scripts/check-acp.mjs).
// ---------------------------------------------------------------------------

export function isInsideDirs(path, dirs) {
  const target = resolve(String(path || ""));
  return (Array.isArray(dirs) ? dirs : []).some((dir) => {
    const base = resolve(String(dir || ""));
    return Boolean(base) && (target === base || target.startsWith(base.endsWith(sep) ? base : base + sep));
  });
}

/**
 * Answer a `session/request_permission` from the member's access: full
 * allows everything, write allows reads, commands and edits inside the
 * member's folders, plan allows only reads, searches, fetches and thoughts.
 */
export function decidePermission({ access = "full", toolCall = {}, options = [], allowedDirs = [] } = {}) {
  const kind = String(toolCall?.kind || "other");
  const locations = (Array.isArray(toolCall?.locations) ? toolCall.locations : []).map((item) => String(item?.path || "")).filter(Boolean);
  let allowed = false;
  let reason = "";
  if (access === "full") {
    allowed = true;
    reason = "full access";
  } else if (access === "plan") {
    allowed = READ_KINDS.has(kind);
    reason = allowed ? "reading is allowed in plan mode" : `${kind} is refused in plan mode`;
  } else if (WRITE_KINDS.has(kind)) {
    const outside = locations.filter((path) => !isInsideDirs(path, allowedDirs));
    allowed = outside.length === 0;
    reason = allowed ? "edits inside the member's folders are allowed" : `${outside[0]} is outside the member's folders`;
  } else {
    allowed = true;
    reason = `${kind} is allowed with edit access`;
  }
  const list = Array.isArray(options) ? options.filter((item) => item && item.optionId) : [];
  const pick = (...kinds) => kinds.map((wanted) => list.find((item) => item.kind === wanted)).find(Boolean) || null;
  const option = allowed
    ? (access === "full" ? pick("allow_always", "allow_once") : pick("allow_once", "allow_always"))
    : pick("reject_once", "reject_always");
  return { allowed, reason, kind, optionId: option?.optionId || "", optionName: option?.name || "" };
}

export function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if (item.type === "content") return blockText(item.content);
      if (item.type === "diff") return `${item.path || ""}\n${diffSummary(item)}`.trim();
      if (item.type === "terminal") return `terminal ${item.terminalId || ""}`.trim();
      return blockText(item);
    })
    .filter(Boolean)
    .join("\n");
}

function blockText(block) {
  if (!block || typeof block !== "object") return "";
  if (block.type === "text") return String(block.text || "");
  if (block.type === "resource") return String(block.resource?.text || block.resource?.uri || "");
  if (block.type === "resource_link") return String(block.uri || block.name || "");
  return "";
}

function diffSummary(item) {
  const before = String(item.oldText ?? "").split("\n").length;
  const after = String(item.newText ?? "").split("\n").length;
  return item.oldText === null || item.oldText === undefined ? `new file, ${after} lines` : `${before} → ${after} lines`;
}

function toolArgs(update) {
  if (update.rawInput && typeof update.rawInput === "object") return update.rawInput;
  const args = {};
  if (update.title) args.title = update.title;
  if (update.kind) args.kind = update.kind;
  if (Array.isArray(update.locations) && update.locations.length) args.locations = update.locations.map((item) => item?.path).filter(Boolean);
  return args;
}

export function newAcpState(timestamp = () => new Date().toISOString()) {
  return { resumeId: "", sequence: 0, text: "", messageId: "", tools: new Map(), loading: false, warnings: [], timestamp };
}

function flushMessage(state) {
  if (!state.text) return [];
  const event = { type: "message_end", messageId: state.messageId || `acp-message-${state.sequence += 1}`, content: state.text, timestamp: state.timestamp() };
  state.text = "";
  state.messageId = "";
  return [event];
}

/** Pure: one `session/update` into SDK-shaped events. `state` persists across updates. */
export function eventsFromUpdate(update, state) {
  if (!update || typeof update !== "object") return [];
  const timestamp = state.timestamp();
  const kind = String(update.sessionUpdate || "");
  switch (kind) {
    case "agent_message_chunk": {
      const text = blockText(update.content);
      if (!text) return [];
      if (update.messageId && state.messageId && update.messageId !== state.messageId) {
        const ended = flushMessage(state);
        state.messageId = String(update.messageId);
        state.text = text;
        return [...ended, { type: "message_update", messageId: state.messageId, delta: text, timestamp }];
      }
      if (!state.messageId) state.messageId = String(update.messageId || `acp-message-${state.sequence += 1}`);
      state.text += text;
      return [{ type: "message_update", messageId: state.messageId, delta: text, timestamp }];
    }
    case "agent_thought_chunk": {
      const thought = blockText(update.content);
      return thought ? [{ type: "message_update", messageId: state.messageId || "", delta: "", thought, timestamp }] : [];
    }
    case "user_message_chunk":
      return [];
    case "tool_call": {
      const toolId = String(update.toolCallId || `acp-tool-${state.sequence += 1}`);
      const toolName = String(update.name || update.kind || update.title || "tool");
      state.tools.set(toolId, { name: toolName, title: String(update.title || "") });
      const events = [...flushMessage(state), { type: "tool_start", toolId, toolName, args: toolArgs(update), timestamp }];
      if (update.status === "completed" || update.status === "failed") events.push(...toolEnd(toolId, toolName, update, timestamp));
      return events;
    }
    case "tool_call_update": {
      const toolId = String(update.toolCallId || "");
      if (!toolId) return [];
      let known = state.tools.get(toolId);
      const events = [];
      if (!known) {
        known = { name: String(update.name || update.kind || update.title || "tool"), title: String(update.title || "") };
        state.tools.set(toolId, known);
        events.push(...flushMessage(state), { type: "tool_start", toolId, toolName: known.name, args: toolArgs(update), timestamp });
      }
      if (update.status === "completed" || update.status === "failed") {
        events.push(...toolEnd(toolId, known.name, update, timestamp));
        return events;
      }
      const output = contentText(update.content);
      if (output) events.push({ type: "tool_update", toolId, toolName: known.name, output, stream: "stdout", timestamp });
      return events;
    }
    case "plan":
      return [{
        type: "plan_update",
        source: "acp",
        plan: (Array.isArray(update.entries) ? update.entries : []).map((entry) => ({ step: String(entry?.content || ""), status: String(entry?.status || "pending"), priority: String(entry?.priority || "") })),
        timestamp,
      }];
    case "usage_update": {
      const used = Number(update.used);
      const size = Number(update.size);
      const usage = { used: Number.isFinite(used) ? used : 0, size: Number.isFinite(size) ? size : 0 };
      if (usage.size > 0) usage.modelUsage = { acp: { contextWindow: usage.size, inputTokens: usage.used } };
      const costUsd = Number(update.cost?.amount);
      return [{ type: "usage", usage, ...(Number.isFinite(costUsd) ? { costUsd } : {}), timestamp }];
    }
    default:
      return [{ type: "status", status: kind || "acp_update", timestamp }];
  }
}

function toolEnd(toolId, toolName, update, timestamp) {
  const success = update.status !== "failed";
  const output = contentText(update.content) || (typeof update.rawOutput === "string" ? update.rawOutput : update.rawOutput ? JSON.stringify(update.rawOutput).slice(0, 4000) : "");
  return [{
    type: "tool_end",
    toolId,
    toolName,
    success,
    output: success ? output : "",
    error: success ? "" : output || `${toolName} failed`,
    timestamp,
  }];
}

// ---------------------------------------------------------------------------
// The runner: spawn, speak the protocol, resolve like runExternalHarness.
// ---------------------------------------------------------------------------

function clampLines(text, line, limit) {
  const start = Number.isFinite(Number(line)) && Number(line) > 0 ? Number(line) - 1 : 0;
  const count = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : undefined;
  if (!start && !count) return text;
  const lines = String(text).split("\n");
  return lines.slice(start, count ? start + count : undefined).join("\n");
}

/**
 * Run one turn over ACP. Resolves with the same shape as `runExternalHarness`
 * in registry.mjs: { events, rawStdout, rawStderr, exitCode, resumeId, error,
 * timedOut, timeoutKind, stopped, stalled }.
 */
export function runAcpHarness({
  adapter,
  executable,
  args = [],
  cwd,
  env = {},
  turn = {},
  timeoutMs = 300000,
  inactivityMs = 0,
  firstEventTimeoutMs = 180000,
  signal,
  onEvent = () => {},
  terminate,
  clientVersion = "",
}) {
  return new Promise((resolvePromise) => {
    const events = [];
    let rawStdout = "";
    let rawStderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutKind = "";
    let stopped = false;
    let stalled = false;
    let sawEvent = false;
    let exitCode = null;
    let failure = "";
    let abortHandler = null;
    let killTimer = null;
    const state = newAcpState();
    state.resumeId = "";
    const access = ACCESS_MODES.includes(turn.access) ? turn.access : "full";
    const allowedDirs = [turn.workspace || cwd, ...(turn.addDirs || [])].filter(Boolean);
    const label = adapter?.label || "ACP agent";
    const isWindows = process.platform === "win32";
    const shell = isWindows && /\.(cmd|bat)$/i.test(String(executable));

    const child = spawn(executable, args, {
      cwd,
      env: guiSafeEnv({ ...env, FORCE_COLOR: "0", NO_COLOR: "1" }),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell,
      detached: !isWindows,
    });
    child.stdin.on("error", () => {});

    const stopChild = () => {
      if (typeof terminate === "function") terminate(child);
      else child.kill("SIGTERM");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutKind = "runtime";
      stopChild();
    }, timeoutMs);
    let inactivityTimer = null;
    const armInactivity = () => {
      if (!(inactivityMs > 0) || settled || timedOut || stopped || stalled) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        timeoutKind = "inactivity";
        stopChild();
      }, inactivityMs);
    };
    armInactivity();
    let firstEventTimer = setTimeout(() => {
      if (!sawEvent) {
        stalled = true;
        stopChild();
      }
    }, firstEventTimeoutMs);

    const deliver = (event) => {
      if (!event) return;
      if (event.type === "raw") {
        events.push(event);
        return;
      }
      sawEvent = true;
      armInactivity();
      if (firstEventTimer) {
        clearTimeout(firstEventTimer);
        firstEventTimer = null;
      }
      events.push(event);
      try {
        onEvent(event);
      } catch {
        // Listener failures must not break the stream.
      }
    };

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      rawStderr += text;
      deliver({ type: "tool_update", toolId: "harness-stderr", toolName: label, output: text, stream: "stderr", timestamp: state.timestamp() });
    });

    const connection = new AcpConnection(child, {
      onLine: (line) => {
        rawStdout += `${line}\n`;
        armInactivity();
      },
      onRaw: (line) => deliver({ type: "raw", stream: "stdout", output: line, timestamp: state.timestamp() }),
      onNotification: (method, params) => {
        if (method !== "session/update") {
          deliver({ type: "status", status: method.replace(/\W+/g, "_"), timestamp: state.timestamp() });
          return;
        }
        if (state.loading) return; // replayed history from session/load
        for (const event of eventsFromUpdate(params?.update, state)) deliver(event);
      },
      onRequest: async (method, params) => {
        if (method === "session/request_permission") {
          if (stopped) return { outcome: { outcome: "cancelled" } };
          const toolCall = params?.toolCall && typeof params.toolCall === "object" ? params.toolCall : {};
          const toolId = String(toolCall.toolCallId || "");
          if (toolId && !state.tools.has(toolId)) {
            for (const event of eventsFromUpdate({ ...toolCall, sessionUpdate: "tool_call" }, state)) deliver(event);
          }
          const decision = decidePermission({ access, toolCall, options: params?.options, allowedDirs });
          deliver({
            type: "permission_request",
            tool: state.tools.get(toolId)?.name || toolCall.title || "tool",
            description: `${decision.allowed ? "allowed" : "refused"} (${decision.reason})`,
            context: { toolCallId: toolId, kind: decision.kind, access, option: decision.optionName || decision.optionId },
            timestamp: state.timestamp(),
          });
          return { outcome: decision.optionId ? { outcome: "selected", optionId: decision.optionId } : { outcome: "cancelled" } };
        }
        if (method === "fs/read_text_file") {
          const path = String(params?.path || "");
          if (!isAbsolute(path)) throw rpcError(JSON_RPC_ERRORS.invalidParams, "path must be absolute");
          if (access !== "full" && !isInsideDirs(path, allowedDirs) && !(turn.attachments || []).some(file => resolve(file.path) === resolve(path))) throw rpcError(JSON_RPC_ERRORS.refused, `${path} is outside the member's folders`);
          const content = await readFile(path, "utf8");
          return { content: clampLines(content, params?.line, params?.limit) };
        }
        if (method === "fs/write_text_file") {
          const path = String(params?.path || "");
          if (!isAbsolute(path)) throw rpcError(JSON_RPC_ERRORS.invalidParams, "path must be absolute");
          if (access === "plan") throw rpcError(JSON_RPC_ERRORS.refused, "writes are refused in plan mode");
          if (access !== "full" && !isInsideDirs(path, allowedDirs)) throw rpcError(JSON_RPC_ERRORS.refused, `${path} is outside the member's folders`);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, String(params?.content ?? ""), "utf8");
          deliver({ type: "tool_update", toolId: "acp-fs", toolName: "fs/write_text_file", output: `wrote ${path}`, stream: "stdout", timestamp: state.timestamp() });
          return {};
        }
        throw rpcError(JSON_RPC_ERRORS.methodNotFound, `${method} is not served by Autohand Squad`);
      },
    });

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (firstEventTimer) clearTimeout(firstEventTimer);
      if (killTimer) clearTimeout(killTimer);
      if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
      connection.close();
      let error = "";
      if (timedOut) {
        error = timeoutKind === "inactivity"
          ? `${label} stopped after ${formatDuration(inactivityMs)} without activity. Retry to continue.`
          : `${label} stopped after ${formatDuration(timeoutMs)} (maximum runtime). Retry to continue.`;
      } else if (stopped) error = stopMessage(signal);
      else if (stalled) error = `${label} did not answer initialize within ${formatDuration(firstEventTimeoutMs)}. Check that it starts in a terminal and retry.`;
      else if (failure) error = failure;
      else {
        const errorEvent = events.find((event) => event.type === "error");
        if (errorEvent) error = String(errorEvent.message || "");
      }
      resolvePromise({ events, rawStdout, rawStderr, exitCode, resumeId: state.resumeId, error, timedOut, timeoutKind, stopped, stalled });
    };

    let sessionId = "";
    const endProcess = () => {
      try { child.stdin.end(); } catch {}
      killTimer = setTimeout(() => { if (!settled) stopChild(); }, 1500);
    };

    abortHandler = () => {
      stopped = true;
      if (sessionId) connection.notify("session/cancel", { sessionId });
      killTimer = setTimeout(() => { if (!settled) stopChild(); }, 2000);
    };
    if (signal?.aborted) abortHandler();
    else if (signal) signal.addEventListener("abort", abortHandler, { once: true });

    child.on("error", (error) => {
      failure = failure || `${label} could not start: ${error.message}`;
      finish();
    });
    child.on("close", (code) => {
      exitCode = code;
      finish();
    });

    (async () => {
      const init = await connection.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: "autohand-squad", version: clientVersion || "dev" },
      }, { timeoutMs: firstEventTimeoutMs });
      sawEvent = true;
      if (firstEventTimer) {
        clearTimeout(firstEventTimer);
        firstEventTimer = null;
      }
      const agentCapabilities = init?.agentCapabilities && typeof init.agentCapabilities === "object" ? init.agentCapabilities : {};
      const mcpServers = acpMcpServers(turn.mcpServers, agentCapabilities.mcpCapabilities || {});
      const authMethods = Array.isArray(init?.authMethods) ? init.authMethods : [];
      let resumed = false;
      let created = null;
      if (turn.resumeId && agentCapabilities.loadSession) {
        state.loading = true;
        try {
          created = await connection.request("session/load", { sessionId: turn.resumeId, cwd, mcpServers }, { timeoutMs: 120000 });
          sessionId = turn.resumeId;
          resumed = true;
        } catch (error) {
          state.warnings.push(`session/load failed: ${error?.message || error}`);
        } finally {
          state.loading = false;
        }
      }
      if (!sessionId) {
        try {
          created = await connection.request("session/new", { cwd, mcpServers }, { timeoutMs: 120000 });
        } catch (error) {
          if (Number(error?.code) === JSON_RPC_ERRORS.refused && authMethods.length) {
            throw new Error(`${label} needs sign-in first (${authMethods.map((method) => method?.name || method?.id).filter(Boolean).join(", ")}). Sign in with its own CLI and retry.`);
          }
          throw error;
        }
        sessionId = String(created?.sessionId || "");
      }
      if (!sessionId) throw new Error(`${label} returned no session id`);
      state.resumeId = sessionId;
      let selectedModel = String(created?.models?.currentModelId || "");
      if (turn.model) {
        const option = created?.configOptions?.find(item => item.category === "model" || item.id === "model");
        if (option) await connection.request("session/set_config_option", { sessionId, configId: option.id, value: turn.model }, { timeoutMs: 30000 });
        else if (created?.models?.availableModels?.length) await connection.request("session/set_model", { sessionId, modelId: turn.model }, { timeoutMs: 30000 });
        else throw new Error(`${label} does not report selectable models. Choose its engine default.`);
        selectedModel = turn.model;
      }
      deliver({ type: "agent_start", model: selectedModel, sessionId, resumed, timestamp: state.timestamp() });
      const modes = created?.modes && typeof created.modes === "object" ? created.modes : null;
      if (access === "plan" && modes?.availableModes?.some((mode) => mode?.id === "plan") && modes.currentModeId !== "plan") {
        await connection.request("session/set_mode", { sessionId, modeId: "plan" }, { timeoutMs: 30000 }).catch(() => {});
      }
      if (stopped) return;
      const text = turn.instructions
        ? `<operating_instructions>\n${turn.instructions}\n</operating_instructions>\n\n${turn.prompt}`
        : turn.prompt;
      deliver({ type: "status", status: "turn_started", timestamp: state.timestamp() });
      const result = await connection.request("session/prompt", { sessionId, prompt: await acpPromptInput(text, turn.attachments, agentCapabilities.promptCapabilities) });
      for (const event of flushMessage(state)) deliver(event);
      const stopReason = String(result?.stopReason || "end_turn");
      deliver({ type: "agent_end", reason: stopReason, timestamp: state.timestamp() });
    })()
      .catch((error) => {
        if (!stopped && !timedOut && !stalled) {
          failure = String(error?.message || error);
          deliver({ type: "error", message: failure, timestamp: state.timestamp() });
        }
      })
      .finally(() => {
        if (!settled) endProcess();
      });
  });
}
