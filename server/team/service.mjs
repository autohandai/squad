// The team as members see it (ADR-0134): a managed MCP server every member
// gets on every engine (Autohand, Claude, Codex), through the same seam the
// vault and Computer Use use (ADR-0070, ADR-0104). It runs on the bridge, so
// a member can reach a teammate, save something for the whole team, rename
// itself or propose a schedule whether or not the Squad window is open, and
// a Claude member can talk to a Codex member as easily as to another Claude.
//
// Tools are real tool calls, not text the reply has to carry, so they work
// in the middle of a turn and the member sees the result before it answers.
// Profile and schedule changes reuse the SQUAD_ACTION handlers (ADR-0126,
// ADR-0110): one validation path, one receipt shape, which the browser
// already applies.

import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";

import { cleanMemoryText, createTeamStore } from "./store.mjs";
import { validateArgs } from "../control-plane/control-plane.mjs";
import { PROFILE_LIMITS } from "../../src/lib/member-shaping.js";

export const TEAM_MCP_SERVER_NAME = "autohand-squad";
export const TEAM_MAX_DEPTH = 3;
export const TEAM_WAIT_SECONDS = 45;
// The pinned Autohand CLI (0.9.7) fails any MCP request after 30 s
// (MCP_REQUEST_TIMEOUT_MS in its McpClientManager, not configurable per
// server), so a 45 s wait for a teammate ended as "MCP request tools/call
// timed out after 30000ms" while the teammate was still answering. An
// Autohand member waits at most this long and gets a delivery id instead.
export const AUTOHAND_TEAM_WAIT_SECONDS = 25;
const BUSY_WAIT_MS = 10 * 60 * 1000;
const BUSY_POLL_MS = 2000;
const REPLY_CHARS = 6000;

const TOOLS = [
  {
    name: "squad_team",
    description: "List your Squad teammates: name, role, the engine each runs on and whether they are working right now. Use it before messaging someone whose exact name you do not know.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "squad_message",
    description: "Send a message to one teammate and get their reply. Works across engines: a Claude member can ask a Codex or Autohand member and the other way round. The teammate answers in their own run with their own tools and permissions. Waits up to wait_seconds for the reply; if they need longer, you get a delivery id and the reply arrives through squad_replies.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "The teammate's name (first name is enough) or id." },
        message: { type: "string", description: "What you need from them, self-contained: they have not seen your conversation." },
        wait_seconds: { type: "integer", minimum: 0, maximum: 50, description: `How long to wait for the reply (default ${TEAM_WAIT_SECONDS}). 0 sends and returns at once.` },
        request_id: { type: "string", minLength: 1, maxLength: 128, description: "Reuse this id when retrying the same message; Squad delivers it once." },
      },
      required: ["to", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "squad_replies",
    description: "Replies to messages you sent with squad_message that were still running when it returned. Each reply is returned once.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "squad_remember",
    description: "Save something to remember, immediately and without asking. Use it whenever the person says 'remember', 'keep in mind', 'note that', 'from now on', or tells you a durable fact or preference. scope 'team' (default) is shared with every teammate on every engine; 'me' is yours only. Never save secrets, passwords or keys.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "One self-contained sentence, written so a teammate who was not here understands it. Include who it is about." },
        scope: { type: "string", enum: ["team", "me", "project"], description: "team (shared, default), me (only you), or project (members working in this turn's folder)." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "squad_recall",
    description: "Read what the team and you have saved. Optional query filters by words.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "squad_forget",
    description: "Remove a saved memory by id (from squad_recall) when the person says it is wrong or no longer true. You can remove what you saved and your own memories.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "squad_set_profile",
    description: "Change your own Squad profile when the person asks: a new name ('your name is Robert', 'I'll call you Robert'), a new role, instructions, personality or skills. Send only the fields that change. Squad shows the change in the app straight away and tells your teammates.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: PROFILE_LIMITS.name },
        role: { type: "string", minLength: 1, maxLength: PROFILE_LIMITS.role },
        description: { type: "string", maxLength: PROFILE_LIMITS.description, description: "What you own and are responsible for; an empty string clears it." },
        instructions: { type: "string", maxLength: PROFILE_LIMITS.instructions },
        personality: { type: "string", maxLength: PROFILE_LIMITS.personality },
        skills: { type: "array", maxItems: PROFILE_LIMITS.skills, items: { type: "string", maxLength: PROFILE_LIMITS.skill } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "squad_schedule",
    description: "Propose work that runs later or repeats: a one-off reminder ('remind me tomorrow at 9 to call Sam'), a daily report, a weekly check. Squad's own scheduler runs it on whichever engine you use; the person confirms the proposal in Squad once. For a reminder, write instructions like 'Remind Igor to call Sam about the contract'.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        instructions: { type: "string", description: "What to do each time it runs." },
        schedule: {
          type: "object",
          description: 'One of: {"kind":"once","date":"YYYY-MM-DD","time":"HH:MM"}, {"kind":"weekdays","days":[1,2,3,4,5],"time":"HH:MM"} (0 is Sunday), {"kind":"interval","everyMinutes":5-1440}, {"kind":"monthly","day":1-31|"last","time":"HH:MM"}, {"kind":"yearly","month":1-12,"day":1-31,"time":"HH:MM"}, {"kind":"cron","cron":"m h dom mon dow"}.',
        },
        timezone: { type: "string", description: "IANA zone, e.g. Pacific/Auckland. Leave it out to use the person's own zone." },
      },
      required: ["title", "instructions", "schedule"],
      additionalProperties: false,
    },
  },
  {
    name: "squad_get_profile",
    description: "Read your persisted name, role, description, instructions, personality and selected skills. Use the returned revision to verify a profile change. Teammates' public roles, capabilities and project folders are in squad_team.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "squad_update_memory",
    description: "Correct a memory you saved, or one personal to you, by its id from squad_recall. Its scope stays the same; other members' memories can only be edited by the person.",
    inputSchema: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 128 }, text: { type: "string", minLength: 1, maxLength: 500 } }, required: ["id", "text"], additionalProperties: false },
  },
  {
    name: "squad_channels",
    description: "List channels you belong to, with ids, purpose, members and reply display mode. Listing a channel does not grant access to any teammate's project files.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "squad_channel_messages",
    description: "Read recent messages in a channel you belong to, optionally restricted to one thread. Returns persisted pending, failed and completed states without presenting unfinished work as a reply.",
    inputSchema: { type: "object", properties: { channel_id: { type: "string", minLength: 1, maxLength: 200 }, thread_id: { type: "string", maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["channel_id"], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "squad_post_channel",
    description: "Publish your message in a channel you belong to, optionally in an existing thread. This records a message; it does not dispatch everyone or claim they have replied. Use squad_message to ask a specific teammate to do work.",
    inputSchema: { type: "object", properties: { channel_id: { type: "string", minLength: 1, maxLength: 200 }, thread_id: { type: "string", maxLength: 200 }, text: { type: "string", minLength: 1, maxLength: 8000 }, request_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["channel_id", "text"], additionalProperties: false },
  },
  {
    name: "squad_create_channel",
    description: "Create or propose a channel with existing teammates in your current project. Uses your current channel-creation permission: allowed creates it, ask leaves a proposal, blocked refuses it. A proposed channel needs the person's approval.",
    inputSchema: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 60 }, members: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 200 } }, purpose: { type: "string", maxLength: 8000 } }, required: ["name"], additionalProperties: false },
  },
  {
    name: "squad_work_plan",
    description: "Read your own persisted work plan, including task ids and their current states. Use squad_task to add, update or finish one. A teammate's plan is theirs; ask them with squad_message.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "squad_task",
    description: "Add, update or finish a task on your own Squad work plan. Uses the same operation and receipts as the Tasks view. For update or done, use an id from squad_work_plan. A task records a commitment; scheduling work later uses squad_schedule.",
    inputSchema: { type: "object", properties: { op: { type: "string", enum: ["add", "update", "done"] }, id: { type: "string", maxLength: 200 }, title: { type: "string", minLength: 1, maxLength: 160 }, detail: { type: "string", maxLength: 2000 }, due: { type: "string", maxLength: 10 }, status: { type: "string", enum: ["open", "doing", "blocked", "done"] }, outcome: { type: "string", maxLength: 2000 } }, required: ["op"], additionalProperties: false },
  },
];

export const TEAM_TOOL_NAMES = TOOLS.map((tool) => tool.name);

const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], structuredContent: typeof value === "string" ? { message: value } : value });
const failure = (message) => ({ content: [{ type: "text", text: message }], structuredContent: { error: message }, isError: true });
const clip = (value, limit) => { const s = String(value ?? ""); return s.length > limit ? `${s.slice(0, limit)}…` : s; };
const nameKey = (value) => String(value || "").replace(/^@/, "").trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export class TeamError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * Who `to` means among the teammates: exact id, full name, name without
 * spaces, or a first name only one teammate has. Punctuation and a leading
 * @ are ignored ("@Eva," is Eva).
 */
export function resolveTeammate(to, members = []) {
  const key = nameKey(to);
  if (!key) return { member: null, reason: "say which teammate" };
  const byId = members.find((member) => nameKey(member.id) === key);
  if (byId) return { member: byId };
  const full = members.filter((member) => nameKey(member.name) === key);
  if (full.length === 1) return { member: full[0] };
  const first = members.filter((member) => nameKey(String(member.name || "").split(/\s+/)[0]) === key);
  if (first.length === 1) return { member: first[0] };
  if (full.length > 1 || first.length > 1) return { member: null, reason: `more than one teammate is called ${to}; use their id from squad_team` };
  // A name a teammate went by before a rename, while nobody has it now: a
  // member whose context still says "Max" reaches Robert instead of nobody.
  const former = members.filter((member) => (member.formerNames || []).some((name) => nameKey(name) === key || nameKey(String(name).split(/\s+/)[0]) === key));
  if (former.length === 1) return { member: former[0] };
  return { member: null, reason: `no teammate called ${to}; squad_team lists who is on the team` };
}

/** The prompt a teammate receives. */
export function teamMessagePrompt(from, message) {
  const who = `${from.name || "A teammate"}${from.role ? ` (${from.role})` : ""}`;
  return [
    `Message from ${who}, your Squad teammate:`,
    "",
    String(message || "").trim(),
    "",
    `Answer ${from.name || "them"} directly: your reply goes back to them. Do what is asked within your role and permissions, and say plainly if you cannot.`,
  ].join("\n");
}

/** The lines a member reads about its team every turn. */
export function teamInstructions({ memory = [], memberId = "", depth = 0 } = {}) {
  const team = memory.filter((entry) => entry.scope === "team");
  const own = memory.filter((entry) => entry.scope === "member" && entry.memberId === memberId);
  const project = memory.filter((entry) => entry.scope === "project");
  const lines = [
    `Your team is reachable through Squad's ${TEAM_MCP_SERVER_NAME} MCP server, on any engine:`,
    "- squad_team lists teammates; squad_message asks one and returns their reply (squad_replies collects late ones).",
    "- squad_get_profile reads your saved profile; squad_set_profile changes name, role, description, instructions, personality and skills. A verbal promise does not change Squad.",
    "- squad_channels and squad_channel_messages read your channels; squad_post_channel publishes a message there; squad_create_channel uses your existing creation permission.",
    "- squad_update_memory corrects a saved entry; squad_forget removes one. Project memories stay with this turn's workspace; personal memories stay with you.",
    "- squad_work_plan reads your commitments and ids; squad_task adds, updates or completes your own tasks, with the same receipts as the Tasks view.",
    "- When the person says remember, keep in mind, note that, or from now on, call squad_remember in that turn (scope team unless it is only about you). Do not only say you will remember: a memory exists only once squad_remember has saved it.",
    "- When the person gives you a new name or role ('your name is Robert', 'I'll call you Robert', 'be our QA lead'), call squad_set_profile with the change, then confirm. Squad tells your teammates.",
    "- For a reminder or anything that should happen later or repeat, call squad_schedule; the person confirms it once in Squad.",
    depth >= TEAM_MAX_DEPTH - 1 ? "- You are answering a teammate's message several hops deep: finish this yourself and do not message further teammates." : "",
  ];
  const sections = [lines.filter(Boolean).join("\n")];
  // The newest 60 and 40 travel in the prompt; the rest only through
  // squad_recall, which a member did not know to call: past 60 entries the
  // oldest disappeared without a word.
  const older = (count, shown) => (count > shown ? [`- (${count - shown} older ${count - shown === 1 ? "entry is" : "entries are"} not shown here; squad_recall finds them)`] : []);
  if (team.length) sections.push(["Team memory (shared by every member):", ...older(team.length, 60), ...team.slice(-60).map((entry) => `- ${entry.text}${entry.authorName ? ` (saved by ${entry.authorName})` : ""}`)].join("\n"));
  if (own.length) sections.push(["Your own memory:", ...older(own.length, 40), ...own.slice(-40).map((entry) => `- ${entry.text}`)].join("\n"));
  if (project.length) sections.push(["Memory for the current project:", ...older(project.length, 40), ...project.slice(-40).map(entry => `- ${entry.text}`)].join("\n"));
  return sections.join("\n\n");
}

export function createTeamService({ stateDir, rootDir, bridgeUrl, nodePath = process.execPath, members, isBusy, deliver, runAction, getProfile, getWorkPlan, channels = {}, emit = () => {} }) {
  const store = createTeamStore({ stateDir });
  const sessions = new Map();
  const byToken = new Map();
  const receipts = new Map();
  const live = new Map();
  const deliveriesByMember = new Map();

  function publicSession(session) {
    return { id: session.id, memberId: session.memberId, runId: session.runId };
  }

  /**
   * A member's connection for one turn. The credential is per member and
   * stable, like the vault's, so the launch config (part of a warm SDK
   * session's key, ADR-0030) does not change between turns.
   */
  async function openWork({ memberId, runId = "", workspace = "", depth = 0, channel = null, maxWaitSeconds = 50 }) {
    if (typeof memberId !== "string" || !memberId.trim()) throw new TeamError("A member identity is required.");
    const owner = memberId.trim();
    let session = sessions.get(owner);
    if (!session) {
      session = { id: randomUUID(), memberId: owner, runId: "", workspace: "", depth: 0, token: randomBytes(32).toString("hex") };
      sessions.set(owner, session);
      byToken.set(session.token, session);
    }
    session.runId = String(runId || "");
    session.active = true;
    session.workspace = String(workspace || "");
    session.depth = Math.max(0, Number(depth) || 0);
    // The channel thread this turn answers in, so a teammate's reply can be
    // shown there (bug hunt 2026-10, channels).
    session.channel = channel?.channelId && channel?.threadId ? channel : null;
    session.maxWaitSeconds = Math.max(0, Math.min(50, Number(maxWaitSeconds) || 0));
    const memory = await store.memoryFor(owner, session.workspace);
    const mcpServer = {
      name: TEAM_MCP_SERVER_NAME,
      transport: "stdio",
      stdioFraming: "newline",
      command: nodePath,
      args: [join(rootDir, "server", "team", "mcp-server.mjs"), "--mcp"],
      autoConnect: true,
      env: { AUTOHAND_SQUAD_TEAM_URL: `${new URL("/api/team/mcp", bridgeUrl)}`, AUTOHAND_SQUAD_TEAM_TOKEN: session.token },
    };
    return { ...publicSession(session), mcpServer, instructions: teamInstructions({ memory, memberId: owner, depth: session.depth }) };
  }

  /** Receipts the turn's tools produced, for the reply's channelActions. */
  function takeReceipts(runId) {
    const list = receipts.get(String(runId || "")) || [];
    receipts.delete(String(runId || ""));
    return list;
  }

  function addReceipt(session, receipt) {
    if (!session.runId || !receipt) return;
    receipts.set(session.runId, [...(receipts.get(session.runId) || []), receipt]);
  }

  async function teammates(selfId) {
    const state = await store.read();
    const formerNames = new Map(state.memory.filter((entry) => entry.source === "rename").map((entry) => [entry.authorId, entry.formerNames || []]));
    const list = (await members()).filter((member) => member && member.id && !member.removed).map((member) => (formerNames.has(member.id) ? { ...member, formerNames: formerNames.get(member.id) } : member));
    return { self: list.find((member) => member.id === selfId) || { id: selfId, name: selfId }, others: list.filter((member) => member.id !== selfId) };
  }

  async function waitUntilFree(memberId, signal) {
    const deadline = Date.now() + BUSY_WAIT_MS;
    while (await isBusy(memberId)) {
      if (signal?.aborted) throw new TeamError("The message was cancelled.");
      if (Date.now() > deadline) throw new TeamError("The teammate stayed busy for ten minutes; the message was not delivered.");
      await new Promise((resolve) => setTimeout(resolve, BUSY_POLL_MS));
    }
  }

  function startDelivery(delivery, { from, to, session, channel = null }) {
    const previous = deliveriesByMember.get(to.id) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      try {
        await waitUntilFree(to.id);
        await store.updateDelivery(delivery.id, { status: "running" });
        emit("team.message.started", { deliveryId: delivery.id, fromId: from.id, toId: to.id });
        const result = await deliver({ from, to, message: delivery.message, depth: session.depth + 1, deliveryId: delivery.id, channel });
        const reply = String(result?.reply || "").trim();
        const error = result?.declined ? reply || "The teammate could not take the message." : "";
        const done = await store.updateDelivery(delivery.id, { status: error ? "error" : "completed", reply: error ? "" : reply, error, runId: result?.runId || "" });
        emit("team.message.finished", { deliveryId: delivery.id, fromId: from.id, toId: to.id, status: done?.status });
        return done;
      } catch (problem) {
        const done = await store.updateDelivery(delivery.id, { status: "error", error: problem?.message || String(problem) });
        emit("team.message.finished", { deliveryId: delivery.id, fromId: from.id, toId: to.id, status: "error" });
        return done;
      } finally {
        live.delete(delivery.id);
        if (deliveriesByMember.get(to.id) === task) deliveriesByMember.delete(to.id);
      }
    });
    deliveriesByMember.set(to.id, task);
    live.set(delivery.id, task);
    return task;
  }

  function deliveryView(delivery, toName) {
    if (delivery.status === "completed") return delivery.reply?.trim()
      ? { status: "replied", from: toName, reply: clip(delivery.reply, REPLY_CHARS) }
      : { status: "completed without reply text", from: toName, deliveryId: delivery.id, note: "The teammate's run finished without an answer. Inspect its work details before retrying." };
    if (delivery.status === "error" || delivery.status === "interrupted") return { status: "not delivered", to: toName, reason: delivery.error };
    return { status: "working", to: toName, deliveryId: delivery.id, note: `${toName} is still working on it. Carry on with your own part; call squad_replies later for the answer.` };
  }

  // The rename becomes team memory, so every teammate learns it on its next
  // turn. It replaces this member's earlier rename: after Max became Robert
  // and then Rob, the team still read "Max is now called Robert." beside the
  // new line, a name that was no longer true.
  async function renameMemory(memberId, previousName, patch) {
    return store.mutate((state) => {
      const earlier = state.memory.filter((entry) => entry.source === "rename" && entry.authorId === memberId);
      const formerNames = [...new Set([...earlier.flatMap((entry) => entry.formerNames || []), previousName])].filter((name) => name && name !== patch.name && name !== previousName);
      const text = `${previousName} is now called ${patch.name}${patch.role ? `, ${patch.role}` : ""}${formerNames.length ? ` (earlier ${formerNames.join(", ")})` : ""}.`;
      state.memory = state.memory.filter((entry) => !earlier.includes(entry));
      const entry = { id: `tm_${randomUUID().slice(0, 8)}`, scope: "team", memberId: "", text: cleanMemoryText(text), authorId: memberId, authorName: patch.name, source: "rename", formerNames: [...formerNames, previousName], createdAt: new Date().toISOString() };
      state.memory.push(entry);
      return entry;
    });
  }

  async function callTool(session, name, args, operationId) {
    if (!record(args)) return failure("Arguments must be an object.");
    const schema = TOOLS.find(tool => tool.name === name)?.inputSchema;
    const errors = validateArgs(schema, args);
    if (errors.length) return failure(errors.join("; "));
    const operation = { ...session, operationId };
    try {
      switch (name) {
        case "squad_team": {
          const { self, others } = await teammates(session.memberId);
          const rows = await Promise.all(others.map(async (member) => ({ id: member.id, name: member.name, role: member.role || "", description: member.description || "", skills: member.skills || [], projects: member.projects || [], engine: member.engine || "", working: await isBusy(member.id).catch(() => false) })));
          return text({ you: { id: self.id, name: self.name, role: self.role || "" }, teammates: rows });
        }
        case "squad_message": {
          const body = String(args.message || "").trim();
          if (!body) return failure("Say what you need from them in message.");
          if (body.length > 8000) return failure("Keep the message under 8000 characters; link to files for the rest.");
          if (session.depth >= TEAM_MAX_DEPTH) return failure("This conversation is already several teammates deep. Finish the work yourself and report back.");
          const { self, others } = await teammates(session.memberId);
          const { member: to, reason } = resolveTeammate(args.to, others);
          if (!to) return failure(`Not sent: ${reason}.`);
          const delivery = await store.addDelivery({ fromId: self.id, fromName: self.name, toId: to.id, toName: to.name, message: body, runId: "", fromRunId: session.runId, requestId: args.request_id || operationId });
          addReceipt(session, { id: `team-message-${delivery.id}`, type: "team_message", actorId: self.id, status: "applied", deliveryId: delivery.id, toId: to.id, message: `Asked ${to.name}.` });
          if (delivery.duplicate && !["queued", "running"].includes(delivery.status)) return text({ deliveryId: delivery.id, duplicate: true, ...deliveryView(delivery, to.name) });
          const task = delivery.duplicate ? live.get(delivery.id) : startDelivery(delivery, { from: self, to, session: operation, channel: session.channel });
          const wait = Math.max(0, Math.min(session.maxWaitSeconds ?? 50, Number.isFinite(Number(args.wait_seconds)) ? Number(args.wait_seconds) : TEAM_WAIT_SECONDS));
          let timeout;
          let settled;
          try { settled = wait && task ? await Promise.race([task, new Promise(resolve => { timeout = setTimeout(() => resolve(null), wait * 1000); })]) : null; }
          finally { clearTimeout(timeout); }
          if (settled) await store.updateDelivery(delivery.id, { readAt: new Date().toISOString() });
          return text(deliveryView(settled || delivery, to.name));
        }
        case "squad_replies": {
          const { replies, waiting } = await store.takeReplies(session.memberId);
          return text({ replies: replies.map((delivery) => ({ deliveryId: delivery.id, ...deliveryView(delivery, delivery.toName) })), stillWorking: waiting });
        }
        case "squad_remember": {
          const { self } = await teammates(session.memberId);
          const scope = args.scope === "me" ? "member" : args.scope === "project" ? "project" : "team";
          const entry = await store.remember({ text: args.text, scope, memberId: session.memberId, workspace: session.workspace, authorId: self.id, authorName: self.name });
          emit("team.memory.changed", { memberId: session.memberId, id: entry.id });
          addReceipt(session, { id: `team-memory-${entry.id}`, type: "team_memory", actorId: self.id, status: "applied", memoryId: entry.id, scope, message: entry.duplicate ? "" : `Remembered${scope === "team" ? " for the team" : ""}: ${entry.text}` });
          return text({ saved: !entry.duplicate, alreadyKnown: Boolean(entry.duplicate), id: entry.id, scope: scope === "member" ? "me" : scope, text: entry.text });
        }
        case "squad_recall": {
          const query = String(args.query || "").toLowerCase().split(/\s+/).filter(Boolean);
          const memory = (await store.memoryFor(session.memberId, session.workspace)).filter((entry) => query.every((word) => entry.text.toLowerCase().includes(word)));
          return text({ memories: memory.map((entry) => ({ id: entry.id, scope: entry.scope === "member" ? "me" : entry.scope, ...(entry.workspace ? { workspace: entry.workspace } : {}), text: entry.text, savedBy: entry.authorName || "", at: entry.updatedAt || entry.createdAt })) });
        }
        case "squad_forget": {
          const entry = await store.forget(String(args.id || ""), { actorId: session.memberId });
          emit("team.memory.changed", { memberId: session.memberId, id: entry.id });
          return text({ removed: entry.id, text: entry.text });
        }
        case "squad_set_profile": {
          const receipt = await runAction("profile", { ...args, op: "set" }, operation);
          addReceipt(session, receipt);
          if (receipt?.status !== "applied") return failure(receipt?.message || "Profile not changed.");
          // The rename reaches team memory from the member copy's own
          // update (renamed, below), which every way of renaming passes.
          // Live run, 2026-10-16: a Codex member renamed itself and then also
          // saved the rename with squad_remember, so the team read it twice.
          return text({ changed: Object.keys(receipt.patch || {}), patch: receipt.patch, revision: receipt.profileRevision, message: receipt.message, note: receipt.patch?.name ? "Squad has already told your teammates the new name; do not save it again." : "" });
        }
        case "squad_schedule": {
          const receipt = await runAction("schedule", { ...args, type: "schedule" }, operation);
          addReceipt(session, receipt);
          if (!receipt || ["failed", "blocked"].includes(receipt.status)) return failure(receipt?.message || "The schedule was not recorded.");
          return text({ status: receipt.status, message: receipt.message, note: "Tell the person it is waiting for their confirmation in Squad; do not say it is scheduled until they confirm." });
        }
        case "squad_get_profile": {
          if (!getProfile) return failure("Profile reading is unavailable in this runtime.");
          return text(await getProfile(session.memberId));
        }
        case "squad_update_memory": {
          const entry = await store.updateMemory(args.id, args.text, { actorId: session.memberId });
          emit("team.memory.changed", { memberId: session.memberId, id: entry.id });
          return text({ updated: entry.id, text: entry.text, scope: entry.scope });
        }
        case "squad_channels": return text({ channels: await channels.list(session.memberId) });
        case "squad_channel_messages": return text(await channels.read(session.memberId, args));
        case "squad_post_channel": return text(await channels.post(session.memberId, { ...args, request_id: args.request_id || operationId }));
        case "squad_create_channel": {
          const receipt = await runAction("create_channel", args, operation);
          addReceipt(session, receipt);
          if (!receipt || ["failed", "blocked"].includes(receipt.status)) return failure(receipt?.message || "Channel not created.");
          return text({ status: receipt.status, channelId: receipt.channelId || null, proposalId: receipt.id, message: receipt.message });
        }
        case "squad_work_plan": return getWorkPlan ? text({ tasks: await getWorkPlan(session.memberId) }) : failure("The work plan is unavailable in this runtime.");
        case "squad_task": {
          const receipt = await runAction("task", args, operation);
          addReceipt(session, receipt);
          if (!receipt || ["failed", "blocked"].includes(receipt.status)) return failure(receipt?.message || "Task not changed.");
          return text({ status: receipt.status, taskId: receipt.taskId, message: receipt.message });
        }
        default:
          return failure("This team tool is not available through Squad.");
      }
    } catch (error) {
      return failure(error?.message || "The team request failed.");
    }
  }

  async function dispatch(token, request) {
    const registered = typeof token === "string" ? byToken.get(token) : null;
    const session = registered && { ...registered, channel: registered.channel && { ...registered.channel } };
    if (!session) throw new TeamError("Team session has expired.", 401);
    if (!record(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") throw new TeamError("Invalid team request.");
    if (request.method === "initialize") {
      return { protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(request.params?.protocolVersion) ? request.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "autohand-squad-team", version: "1" } };
    }
    if (request.method === "ping" || request.method.startsWith("notifications/")) return {};
    const actor = (await members()).find(member => member.id === session.memberId && !member.removed);
    if (!actor) throw new TeamError("This member is no longer available.", 401);
    if (request.method === "tools/list") return { tools: TOOLS };
    if (request.method !== "tools/call") throw new TeamError("Unsupported team method.");
    if (!registered.active || registered.runId !== session.runId || byToken.get(token) !== registered) throw new TeamError("This member has no active Squad turn.", 401);
    const name = request.params?.name;
    if (!TEAM_TOOL_NAMES.includes(name)) throw new TeamError("This team tool is not available through Squad.", 403);
    const operationId = `${session.runId}:${String(request.id ?? randomUUID())}`;
    return callTool(session, name, request.params?.arguments ?? {}, operationId);
  }

  function closeMember(memberId) {
    const session = sessions.get(String(memberId || ""));
    if (!session) return;
    sessions.delete(session.memberId);
    byToken.delete(session.token);
  }

  return {
    store,
    tools: TOOLS,
    openWork,
    takeReceipts,
    dispatch,
    closeMember,
    finishWork: runId => {
      for (const session of sessions.values()) if (session.runId === runId) session.active = false;
    },
    recover: () => store.recover(),
    pending: () => [...live.keys()],
    // The person's own edits from the app go through these.
    remember: (input) => store.remember({ ...input, text: cleanMemoryText(input?.text), source: "person" }),
    updateMemory: (id, text) => store.updateMemory(id, text, { person: true }),
    renamed: async (memberId, previousName, patch) => {
      const entry = await renameMemory(memberId, previousName, patch);
      emit("team.memory.changed", { memberId, id: entry.id });
      return entry;
    },
    forget: (id) => store.forget(id, { person: true }),
    close: () => { sessions.clear(); byToken.clear(); receipts.clear(); },
  };
}
