// Activity normaliser: folds a harness event stream into semantic activity
// items. Pure and dependency-free so the same module runs in the bridge
// (`server/routes/activity.route.mjs`), in Node checks, and in the browser
// (`src/lib/activity.js` re-exports it).
//
// Input shapes, detected per entry:
//   - chat stream events, the output of `chatStreamEventFromSdkEvent` in
//     server.mjs: message_delta, message_end, tool_start { tool }, tool_update,
//     tool_end, permission_request, error, status
//   - raw harness / SDK events: message_update, message_end, tool_start
//     { toolId, toolName }, tool_update, tool_end, permission_request, error,
//     agent_start, agent_end, usage, raw, status
//   - trace events (`sdkTraceFromEvents`, `normalizeTrace` in App.jsx):
//     tool_call { call }, tool_result { result }, thought, assistant_event,
//     step, status, error, permission_request
//   - run log lines (`appendLog` in server.mjs): { source, line, at } with
//     sources system, channel, permission, sdk, tool, stdout, stderr
//
// Output: ActivityItem[]
//   { id, kind, verb, object, outcome, state, quiet, startedAt, endedAt, detail, refs }
//   kind:  tool | edit | shell | message | thought | plan | approval | error | status
//   state: pending | done | failed
//   quiet: true for rows a feed collapses by default (reads, thoughts, status)
//
// Ids are deterministic: they depend only on the events seen so far, so a
// live feed that re-normalises a growing event list keeps every row's id and
// the UI can update rows in place.

const READ_TOOL_RE =
  /^(read|read_file|read_files|view|view_file|cat|open|open_file|get_file|list|list_dir|list_files|list_directory|ls|tree|glob|grep|rg|ripgrep|search|search_files|file_search|codebase_search|semantic_search|find|find_files|web_?search|web_?fetch|fetch|fetch_url|todo_?read|notebook_?read|memory_?read|get|inspect|stat|git_(status|log|diff|blame|show))$/i;
const EDIT_TOOL_RE =
  /^(write|write_file|write_files|create|create_file|edit|edit_file|multi_?edit|str_?replace(_based_edit_tool|_editor)?|replace|replace_in_file|apply_patch|apply_diff|patch|insert|delete_file|remove_file|move_file|rename_file|mkdir|notebook_?edit|file_change|save|save_file|update_file)$/i;
const SHELL_TOOL_RE =
  /^(bash|sh|zsh|shell|shell_command|local_shell|run_shell|run_command|run_terminal_cmd|command|command_execution|exec|execute|execute_command|terminal|terminal_command|process|run|npm|bun|cargo|make|pytest|node)$/i;
const SEARCH_TOOL_RE = /^(glob|grep|rg|ripgrep|search|search_files|file_search|codebase_search|semantic_search|find|find_files|web_?search)$/i;
const LIST_TOOL_RE = /^(list|list_dir|list_files|list_directory|ls|tree)$/i;
const FETCH_TOOL_RE = /^(web_?fetch|fetch|fetch_url)$/i;
const FAILED_TEXT_RE = /\b(error|failed|panic|fatal)\b/i;
const FAILED_RESULT_RE = /^(error|failed|fatal|traceback|exception)\b|exit(?:ed with)? code [1-9]|command failed|non-zero exit/i;
const TOOL_LOG_START_RE = /^started (\S+)\s*(.*)$/s;
const TOOL_LOG_END_RE = /^(.+?) (completed|failed) at (\S+)$/;
const PERMISSION_LOG_RE = /^(.+?) requested permission:\s*(.*)$/s;
const OUTCOME_MAX = 120;
const DETAIL_MAX = 24000;

// ---------------------------------------------------------------------------
// Shape detection

export function isLogLine(entry) {
  return Boolean(entry) && typeof entry === "object" && typeof entry.line === "string" && !("type" in entry);
}

function isEvent(entry) {
  return Boolean(entry) && typeof entry === "object" && typeof entry.type === "string";
}

// ---------------------------------------------------------------------------
// Small helpers

function text(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function clamp(value, max) {
  const str = text(value);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function firstLine(value) {
  return text(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function stringify(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toolBaseName(name) {
  const raw = text(name).trim();
  if (!raw) return "tool";
  // "mcp__server__tool", "server.tool", "functions.read_file" → last segment.
  const parts = raw.split(/__|\.|\//).filter(Boolean);
  return parts[parts.length - 1] || raw;
}

export function classifyTool(name) {
  const base = toolBaseName(name);
  if (EDIT_TOOL_RE.test(base)) return { kind: "edit", verb: "edit", quiet: false };
  if (SHELL_TOOL_RE.test(base)) return { kind: "shell", verb: "run", quiet: false };
  if (SEARCH_TOOL_RE.test(base)) return { kind: "tool", verb: "search", quiet: true };
  if (LIST_TOOL_RE.test(base)) return { kind: "tool", verb: "list", quiet: true };
  if (FETCH_TOOL_RE.test(base)) return { kind: "tool", verb: "fetch", quiet: true };
  if (READ_TOOL_RE.test(base)) return { kind: "tool", verb: "read", quiet: true };
  return { kind: "tool", verb: "call", quiet: false };
}

function firstString(args, keys) {
  if (!args || typeof args !== "object") return "";
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length && typeof value[0] === "string") return value.join(" ");
  }
  return "";
}

const PATH_KEYS = ["path", "file_path", "filePath", "file", "filename", "target_file", "notebook_path", "directory", "dir", "cwd"];
const COMMAND_KEYS = ["command", "cmd", "script"];
const PATTERN_KEYS = ["pattern", "query", "glob", "regex", "search"];
const URL_KEYS = ["url", "uri", "href"];

export function toolObject(name, args) {
  const { kind, verb } = classifyTool(name);
  if (args && typeof args === "object" && Array.isArray(args.changes) && args.changes.length) {
    const paths = args.changes.map((change) => text(change?.path)).filter(Boolean);
    if (paths.length === 1) return paths[0];
    if (paths.length > 1) return `${paths.length} files`;
  }
  if (kind === "shell") return firstLine(firstString(args, COMMAND_KEYS)) || toolBaseName(name);
  if (verb === "search") return firstString(args, PATTERN_KEYS) || firstString(args, PATH_KEYS) || toolBaseName(name);
  if (verb === "fetch") return firstString(args, URL_KEYS) || firstString(args, PATTERN_KEYS) || toolBaseName(name);
  return firstString(args, PATH_KEYS) || firstString(args, COMMAND_KEYS) || firstString(args, URL_KEYS) || firstString(args, PATTERN_KEYS) || toolBaseName(name);
}

function toolRefs(args) {
  const refs = [];
  if (!args || typeof args !== "object") return refs;
  const path = firstString(args, PATH_KEYS);
  if (path) refs.push({ type: "file", value: path });
  if (Array.isArray(args.changes)) {
    for (const change of args.changes) {
      const changePath = text(change?.path);
      if (changePath) refs.push({ type: "file", value: changePath });
    }
  }
  const command = firstString(args, COMMAND_KEYS);
  if (command) refs.push({ type: "command", value: firstLine(command) });
  const url = firstString(args, URL_KEYS);
  if (url) refs.push({ type: "url", value: url });
  return refs;
}

function outcomeFrom(output, failed) {
  const line = firstLine(output);
  if (!line) return failed ? "failed" : "";
  return clamp(line, OUTCOME_MAX);
}

function appendDetail(current, addition) {
  const extra = text(addition);
  if (!extra) return current;
  const base = text(current);
  const joined = base ? `${base}${base.endsWith("\n") ? "" : "\n"}${extra}` : extra;
  return joined.length > DETAIL_MAX ? `${joined.slice(0, DETAIL_MAX)}\n[detail truncated]` : joined;
}

// ---------------------------------------------------------------------------
// The fold

class Feed {
  constructor(options = {}) {
    this.options = options;
    this.items = [];
    this.byId = new Map();
    this.counters = new Map();
    this.openMessage = null;
    this.openThought = null;
    this.openStatus = null;
    this.openStderr = null;
    this.openApproval = null;
    this.pendingLogTools = []; // run-log tools have no ids; closed by name, LIFO
    this.logArgs = null; // multi-line JSON args after a "started <tool> {" log line
    this.messageOrdinals = new Map();
  }

  next(prefix) {
    const n = (this.counters.get(prefix) || 0) + 1;
    this.counters.set(prefix, n);
    return n;
  }

  add(item) {
    const full = {
      id: item.id,
      kind: item.kind,
      verb: item.verb || "",
      object: item.object || "",
      outcome: item.outcome || "",
      state: item.state || "done",
      quiet: Boolean(item.quiet),
      startedAt: item.startedAt || "",
      endedAt: item.endedAt || "",
      detail: item.detail || "",
      refs: Array.isArray(item.refs) ? item.refs : [],
    };
    this.items.push(full);
    this.byId.set(full.id, full);
    return full;
  }

  closeText() {
    if (this.openMessage) {
      if (this.openMessage.state === "pending") this.openMessage.state = "done";
      this.openMessage = null;
    }
    if (this.openThought) {
      this.openThought.state = "done";
      this.openThought = null;
    }
  }

  closeRuns() {
    this.openStatus = null;
    this.openStderr = null;
  }

  resolveApproval(at) {
    if (!this.openApproval) return;
    if (this.openApproval.state === "pending") {
      this.openApproval.state = "done";
      this.openApproval.endedAt = at || this.openApproval.endedAt;
      this.openApproval.outcome = this.openApproval.outcome || "answered";
    }
    this.openApproval = null;
  }

  // -- messages -------------------------------------------------------------

  messageDelta({ messageId, delta, thought, at }) {
    this.closeRuns();
    if (thought) {
      if (!this.openThought) {
        this.openThought = this.add({
          id: `thought:${this.next("thought")}`,
          kind: "thought",
          verb: "think",
          state: "pending",
          quiet: true,
          startedAt: at,
        });
      }
      this.openThought.detail = appendDetail(this.openThought.detail, thought);
      this.openThought.object = clamp(firstLine(this.openThought.detail), OUTCOME_MAX);
      this.openThought.endedAt = at;
    }
    if (delta) {
      if (this.openThought && !thought) {
        this.openThought.state = "done";
        this.openThought = null;
      }
      const key = text(messageId);
      if (!this.openMessage || this.openMessage.messageKey !== key) {
        if (this.openMessage) this.openMessage.state = "done";
        const ordinal = this.next("message");
        this.openMessage = this.add({
          id: key ? `message:${key}:${ordinal}` : `message:${ordinal}`,
          kind: "message",
          verb: "say",
          state: "pending",
          startedAt: at,
        });
        this.openMessage.messageKey = key;
      }
      this.openMessage.detail = `${this.openMessage.detail}${delta}`;
      this.openMessage.object = clamp(firstLine(this.openMessage.detail), OUTCOME_MAX);
      this.openMessage.endedAt = at;
    }
  }

  messageEnd({ messageId, content, at }) {
    this.closeRuns();
    this.resolveApproval(at);
    const body = text(content);
    if (this.openMessage) {
      const item = this.openMessage;
      if (body) item.detail = body;
      item.object = clamp(firstLine(item.detail), OUTCOME_MAX);
      item.state = "done";
      item.endedAt = at || item.endedAt;
      this.openMessage = null;
      return item;
    }
    if (!body) return null;
    const key = text(messageId);
    const ordinal = this.next("message");
    return this.add({
      id: key ? `message:${key}:${ordinal}` : `message:${ordinal}`,
      kind: "message",
      verb: "say",
      object: clamp(firstLine(body), OUTCOME_MAX),
      detail: body,
      startedAt: at,
      endedAt: at,
    });
  }

  thought({ thought, reflection, at }) {
    this.closeRuns();
    const body = [text(thought), text(reflection)].filter(Boolean).join("\n\n");
    if (!body) return null;
    return this.add({
      id: `thought:${this.next("thought")}`,
      kind: "thought",
      verb: "think",
      object: clamp(firstLine(body), OUTCOME_MAX),
      detail: body,
      quiet: true,
      startedAt: at,
      endedAt: at,
    });
  }

  // -- tools ----------------------------------------------------------------

  toolId(rawId) {
    const id = text(rawId).trim();
    return id ? `tool:${id}` : `tool:anon:${this.next("tool")}`;
  }

  toolStart({ id, name, args, at }) {
    this.closeText();
    this.closeRuns();
    this.resolveApproval(at);
    const itemId = this.toolId(id);
    const existing = this.byId.get(itemId);
    if (existing) return existing; // the trace listed the same call twice
    const cls = classifyTool(name);
    const argsText = stringify(args);
    return this.add({
      id: itemId,
      kind: cls.kind,
      verb: cls.verb,
      object: clamp(toolObject(name, args), 200),
      state: "pending",
      quiet: cls.quiet,
      startedAt: at,
      detail: argsText,
      refs: toolRefs(args),
    });
  }

  toolUpdate({ id, name, output, stream, at }) {
    const itemId = this.toolId(id);
    let item = this.byId.get(itemId);
    if (!item) {
      // Output for an unknown tool id: harness stderr, local runtime chatter.
      this.closeRuns();
      item = this.add({
        id: itemId,
        kind: "status",
        verb: "output",
        object: toolBaseName(name || id || "runtime"),
        quiet: true,
        startedAt: at,
      });
    }
    if (output) item.detail = appendDetail(item.detail, stream === "stderr" ? `[stderr] ${output}` : output);
    item.endedAt = at;
    if (item.state !== "pending" && item.kind !== "status" && !item.outcome) item.outcome = outcomeFrom(output, false);
    return item;
  }

  toolEnd({ id, name, success, output, error, at }) {
    this.closeRuns();
    const itemId = this.toolId(id);
    let item = this.byId.get(itemId);
    if (!item) {
      const cls = classifyTool(name);
      item = this.add({
        id: itemId,
        kind: cls.kind,
        verb: cls.verb,
        object: toolBaseName(name),
        quiet: cls.quiet,
        startedAt: at,
      });
    }
    const failed = success === false || Boolean(error);
    const result = text(error) || text(output);
    if (result) item.detail = appendDetail(item.detail, failed && error ? `[error] ${result}` : result);
    item.state = failed ? "failed" : "done";
    if (failed) item.quiet = false;
    item.outcome = outcomeFrom(result, failed);
    item.endedAt = at || item.endedAt;
    return item;
  }

  // -- everything else ------------------------------------------------------

  status({ status, label, at }) {
    this.closeText();
    this.openStderr = null;
    const name = text(status) || "status";
    const title = text(label) || name.replace(/_/g, " ");
    if (name === "todo_list") {
      this.openStatus = null;
      return this.add({ id: `plan:${this.next("plan")}`, kind: "plan", verb: "plan", object: title, startedAt: at, endedAt: at });
    }
    if (this.openStatus) {
      this.openStatus.object = title;
      this.openStatus.detail = appendDetail(this.openStatus.detail, title);
      this.openStatus.endedAt = at;
      return this.openStatus;
    }
    this.openStatus = this.add({
      id: `status:${this.next("status")}`,
      kind: "status",
      verb: "status",
      object: title,
      detail: title,
      quiet: true,
      startedAt: at,
      endedAt: at,
    });
    return this.openStatus;
  }

  error({ message, at }) {
    this.closeText();
    this.closeRuns();
    this.resolveApproval(at);
    const body = text(message) || "Agent stream failed";
    return this.add({
      id: `error:${this.next("error")}`,
      kind: "error",
      verb: "fail",
      object: clamp(firstLine(body), OUTCOME_MAX),
      outcome: clamp(firstLine(body), OUTCOME_MAX),
      state: "failed",
      detail: body,
      startedAt: at,
      endedAt: at,
    });
  }

  approval({ title, detail, at }) {
    this.closeText();
    this.closeRuns();
    this.resolveApproval(at);
    this.openApproval = this.add({
      id: `approval:${this.next("approval")}`,
      kind: "approval",
      verb: "ask",
      object: clamp(text(title) || "Permission requested", OUTCOME_MAX),
      state: "pending",
      detail: text(detail),
      startedAt: at,
    });
    return this.openApproval;
  }

  plan({ index, title, at }) {
    this.closeText();
    this.closeRuns();
    return this.add({
      id: `plan:${this.next("plan")}`,
      kind: "plan",
      verb: "plan",
      object: clamp(`${Number.isFinite(Number(index)) && index !== null ? `${index}. ` : ""}${text(title)}`, 200),
      startedAt: at,
      endedAt: at,
    });
  }

  // -- run log lines --------------------------------------------------------

  logLine({ source, line, at }) {
    const src = text(source);
    const body = text(line);
    if (!body.trim()) return;

    if (this.logArgs) {
      // Continuation of a pretty-printed JSON args block: appendLog splits one
      // chunk into lines that all carry source "tool".
      if (src === "tool" && !TOOL_LOG_END_RE.test(body) && !TOOL_LOG_START_RE.test(body)) {
        this.logArgs.lines.push(body);
        this.logArgs.depth += (body.match(/[{[]/g) || []).length - (body.match(/[}\]]/g) || []).length;
        if (this.logArgs.depth <= 0) this.flushLogArgs();
        return;
      }
      this.flushLogArgs();
    }

    if (src === "tool") {
      const end = body.match(TOOL_LOG_END_RE);
      if (end) {
        const name = end[1];
        const failed = end[2] === "failed";
        const index = findLastIndex(this.pendingLogTools, (item) => item.toolName === name);
        const item = index === -1 ? null : this.pendingLogTools.splice(index, 1)[0];
        if (item) {
          item.state = failed ? "failed" : "done";
          if (failed) item.quiet = false;
          item.outcome = outcomeFrom(item.output, failed);
          item.endedAt = end[3] || at;
          delete item.output;
        } else {
          const cls = classifyTool(name);
          this.add({ id: `tool:log:${this.next("tool")}`, kind: cls.kind, verb: cls.verb, object: toolBaseName(name), state: failed ? "failed" : "done", quiet: cls.quiet && !failed, outcome: failed ? "failed" : "", startedAt: at, endedAt: at });
        }
        return;
      }
      const start = body.match(TOOL_LOG_START_RE);
      if (start) {
        const rest = start[2].trim();
        const depth = (rest.match(/[{[]/g) || []).length - (rest.match(/[}\]]/g) || []).length;
        if (rest && depth > 0) {
          this.logArgs = { name: start[1], lines: [rest], depth, at };
          return;
        }
        this.openLogTool(start[1], rest ? parseJson(rest) ?? rest : {}, at);
        return;
      }
      this.status({ status: "tool", label: body, at });
      return;
    }

    if (src === "stdout" || src === "stderr") {
      const open = this.pendingLogTools[this.pendingLogTools.length - 1];
      if (open) {
        open.output = appendDetail(open.output, body);
        open.detail = appendDetail(open.detail, src === "stderr" ? `[stderr] ${body}` : body);
        open.endedAt = at;
        return;
      }
      if (src === "stdout") {
        this.messageDelta({ messageId: "", delta: `${body}\n`, at });
        return;
      }
      if (FAILED_TEXT_RE.test(body)) {
        this.error({ message: body, at });
        return;
      }
      this.closeText();
      this.openStatus = null;
      if (!this.openStderr) {
        this.openStderr = this.add({ id: `status:stderr:${this.next("stderr")}`, kind: "status", verb: "output", object: "stderr", quiet: true, startedAt: at });
      }
      this.openStderr.detail = appendDetail(this.openStderr.detail, body);
      this.openStderr.object = clamp(body, OUTCOME_MAX);
      this.openStderr.endedAt = at;
      return;
    }

    if (src === "permission") {
      const match = body.match(PERMISSION_LOG_RE);
      this.approval({ title: match ? `${match[1]}: ${match[2] || "permission requested"}` : body, detail: body, at });
      return;
    }

    if (src === "system" && /\b(failed|error|fatal)\b/i.test(body)) {
      this.error({ message: body, at });
      return;
    }

    // system, channel, sdk and anything else: a quiet status row.
    this.status({ status: src, label: body, at });
  }

  openLogTool(name, args, at) {
    const cls = classifyTool(name);
    const item = this.add({
      id: `tool:log:${this.next("tool")}`,
      kind: cls.kind,
      verb: cls.verb,
      object: clamp(toolObject(name, args), 200),
      state: "pending",
      quiet: cls.quiet,
      startedAt: at,
      detail: stringify(args),
      refs: toolRefs(args),
    });
    item.toolName = name;
    item.output = "";
    this.closeText();
    this.closeRuns();
    this.resolveApproval(at);
    this.pendingLogTools.push(item);
    return item;
  }

  flushLogArgs() {
    const { name, lines, at } = this.logArgs;
    this.logArgs = null;
    const raw = lines.join("\n");
    this.openLogTool(name, parseJson(raw) ?? raw, at);
  }

  // -- finish ---------------------------------------------------------------

  finish() {
    if (this.logArgs) this.flushLogArgs();
    const status = text(this.options.status);
    const finished = status && status !== "running" && status !== "queued" && status !== "launching";
    for (const item of this.items) {
      delete item.messageKey;
      delete item.toolName;
      delete item.output;
      if (item.state !== "pending") continue;
      if (item.kind === "message" || item.kind === "thought") {
        if (finished || !this.options.live) item.state = "done";
        continue;
      }
      if (!finished) continue;
      item.state = status === "completed" ? "done" : "failed";
      if (item.state === "failed") {
        item.quiet = false;
        item.outcome = item.outcome || `run ${status} before this finished`;
      } else {
        item.outcome = item.outcome || "no result recorded";
      }
    }
    return this.items;
  }
}

function findLastIndex(list, predicate) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (predicate(list[index])) return index;
  }
  return -1;
}

function eventTime(event) {
  return text(event.timestamp || event.at || event.time || event.tool?.timestamp || event.call?.timestamp || event.result?.timestamp || "");
}

function foldEvent(feed, event) {
  const at = eventTime(event);
  switch (event.type) {
    case "message_delta":
    case "message_update":
      feed.messageDelta({ messageId: event.messageId, delta: text(event.delta), thought: text(event.thought), at });
      return;
    case "message_end":
      feed.messageEnd({ messageId: event.messageId, content: event.content, at });
      return;
    case "assistant_event":
    case "assistant":
      feed.messageEnd({ messageId: "", content: event.content, at });
      return;
    case "thought":
      feed.thought({ thought: event.thought, reflection: event.reflection, at });
      return;
    case "tool_start":
      feed.toolStart({
        id: event.tool?.id ?? event.toolId,
        name: event.tool?.name ?? event.toolName,
        args: event.tool?.args ?? event.args ?? {},
        at,
      });
      return;
    case "tool_call":
      feed.toolStart({ id: event.call?.id ?? event.id, name: event.call?.name ?? event.name, args: event.call?.args ?? event.args ?? {}, at });
      return;
    case "tool_update":
      feed.toolUpdate({ id: event.toolId, name: event.toolName, output: text(event.output), stream: event.stream, at });
      return;
    case "tool_end":
      feed.toolEnd({ id: event.toolId, name: event.toolName, success: event.success, output: event.output, error: event.error, at });
      return;
    case "tool_result": {
      const result = event.result || event;
      const content = text(result.content ?? result.output);
      feed.toolEnd({ id: result.id, name: result.name, success: !FAILED_RESULT_RE.test(firstLine(content)), output: content, at });
      return;
    }
    case "permission_request":
      feed.approval({ title: event.title || event.description || event.tool, detail: event.content ?? stringify(event.context), at });
      return;
    case "error":
      feed.error({ message: event.error || event.message || event.title || event.content, at });
      return;
    case "step":
      feed.plan({ index: event.index, title: event.title, at });
      return;
    case "agent_start":
      feed.status({ status: "agent_start", label: event.model ? `Agent started · ${event.model}` : "Agent started", at });
      return;
    case "agent_end":
      feed.status({ status: "agent_end", label: `Agent ended · ${event.reason || "completed"}`, at });
      return;
    case "usage":
      feed.status({ status: "usage", label: usageLabel(event), at });
      return;
    case "raw":
      feed.toolUpdate({ id: "raw", name: "raw", output: text(event.output), stream: event.stream, at });
      return;
    case "status":
      feed.status({ status: event.status, label: event.label || event.title, at });
      return;
    default:
      feed.status({ status: event.type, label: event.title || event.label || event.type.replace(/_/g, " "), at });
  }
}

function usageLabel(event) {
  const usage = event.usage && typeof event.usage === "object" ? event.usage : {};
  const input = Number(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens);
  const output = Number(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens);
  const parts = [];
  if (Number.isFinite(input)) parts.push(`${input} in`);
  if (Number.isFinite(output)) parts.push(`${output} out`);
  return parts.length ? `Usage · ${parts.join(" / ")} tokens` : "Usage recorded";
}

/**
 * Fold events (any mix of stream events, raw SDK events, trace events, and
 * run log lines) into semantic activity items.
 *
 * options.status: the run/reply status ("running" | "completed" | "failed" |
 *   "stopped"). When the run has ended, still-pending rows resolve to done or
 *   failed so nothing spins forever.
 * options.live: true while events are still arriving; keeps an open message
 *   pending. Defaults to false, so a normalised snapshot has no pending text.
 */
export function normalizeActivity(events, options = {}) {
  const feed = new Feed(options);
  const list = Array.isArray(events) ? events : [];
  for (const entry of list) {
    if (isLogLine(entry)) feed.logLine(entry);
    else if (isEvent(entry)) foldEvent(feed, entry);
    else if (typeof entry === "string" && entry.trim()) feed.logLine({ source: "stdout", line: entry, at: "" });
  }
  return feed.finish();
}

/**
 * Activity from a chat trace object as the web app stores it on a message
 * (`message.trace`: { events, toolCalls, toolResults, messages, thoughts }).
 * Trace `events` carry tool calls but, for live traces, results only live in
 * `toolResults`; this merges them so every call resolves.
 */
export function activityFromTrace(trace, options = {}) {
  if (!trace || typeof trace !== "object") return [];
  const events = Array.isArray(trace.events) ? [...trace.events] : [];
  const seenResults = new Set(events.filter((event) => event?.type === "tool_result").map((event) => text(event.result?.id || event.id)));
  const seenCalls = new Set(events.filter((event) => event?.type === "tool_call").map((event) => text(event.call?.id)));
  for (const call of Array.isArray(trace.toolCalls) ? trace.toolCalls : []) {
    if (call?.id && seenCalls.has(text(call.id))) continue;
    events.push({ type: "tool_call", call, timestamp: call?.timestamp || "" });
  }
  for (const result of Array.isArray(trace.toolResults) ? trace.toolResults : []) {
    if (result?.id && seenResults.has(text(result.id))) continue;
    events.push({ type: "tool_result", result, timestamp: result?.timestamp || "" });
  }
  if (!events.some((event) => event?.type === "assistant_event" || event?.type === "message_end")) {
    for (const message of Array.isArray(trace.messages) ? trace.messages : []) {
      events.push({ type: "assistant_event", content: message?.content, timestamp: message?.timestamp || "" });
    }
  }
  if (!events.some((event) => event?.type === "thought")) {
    for (const thought of Array.isArray(trace.thoughts) ? trace.thoughts : []) {
      events.push({ type: "thought", ...thought });
    }
  }
  events.sort((a, b) => {
    const ta = Date.parse(eventTime(a));
    const tb = Date.parse(eventTime(b));
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return 0; // Array.prototype.sort is stable
  });
  return normalizeActivity(events, options);
}

// ---------------------------------------------------------------------------
// Summaries and collapsing

const VERB_NOUNS = {
  read: ["file", "files"],
  list: ["folder", "folders"],
  search: ["search", "searches"],
  fetch: ["page", "pages"],
  think: ["thought", "thoughts"],
  status: ["status update", "status updates"],
  output: ["output line", "output lines"],
};

function plural(count, [one, many]) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "read 12 files · 3 searches · 2 thoughts" for the quiet items given. */
export function summarizeQuiet(items) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.quiet) continue;
    const verb = VERB_NOUNS[item.verb] ? item.verb : "status";
    counts.set(verb, (counts.get(verb) || 0) + 1);
  }
  if (!counts.size) return "";
  // Most informative first: by count, then by a fixed order with status last.
  const order = Object.keys(VERB_NOUNS);
  const entries = [...counts].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
  const parts = [];
  for (const [verb, count] of entries) {
    const nouns = VERB_NOUNS[verb];
    if (verb === "read" || verb === "list" || verb === "fetch") parts.push(`${verb} ${plural(count, nouns)}`);
    else parts.push(plural(count, nouns));
  }
  return parts.join(" · ");
}

/**
 * Rows for a feed: prominent items stay where they are; each run of
 * consecutive quiet items becomes one summary row
 * `{ id: "summary:<first id>", kind: "summary", label, items }`.
 */
export function collapseActivity(items) {
  const rows = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length === 1 && run[0].kind !== "status" && run[0].kind !== "thought") {
      rows.push(run[0]);
    } else {
      rows.push({ id: `summary:${run[0].id}`, kind: "summary", label: summarizeQuiet(run), items: run, state: run.some((item) => item.state === "pending") ? "pending" : "done" });
    }
    run = [];
  };
  for (const item of Array.isArray(items) ? items : []) {
    if (item.quiet && item.state !== "failed") run.push(item);
    else {
      flush();
      rows.push(item);
    }
  }
  flush();
  return rows;
}

/** Counts for a "steps · tools · failures" summary line. */
export function activityStats(items) {
  const list = Array.isArray(items) ? items : [];
  const tools = list.filter((item) => item.kind === "tool" || item.kind === "edit" || item.kind === "shell").length;
  const failed = list.filter((item) => item.state === "failed").length;
  const pending = list.filter((item) => item.state === "pending").length;
  return { rows: list.length, tools, failed, pending, quiet: list.filter((item) => item.quiet).length };
}
