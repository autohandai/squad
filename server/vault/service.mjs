// The vault as members see it: a managed MCP server with four tools, scoped
// to one member's work through a per-session credential the bridge issues
// (the same seam Computer Use uses, ADR-0070). Values never cross this
// boundary; a request ends the member's turn with a "waiting for the person"
// result and the outcome arrives as text on its next turn. See ADR-0104.

import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";

import { VAULT_FIELDS, VaultError } from "./crypto.mjs";
import { createVaultRequests } from "./requests.mjs";
import { createVaultStore } from "./store.mjs";

export const VAULT_MCP_SERVER_NAME = "autohand-vault";
export const VAULT_TOOL_NAMES = ["vault_list", "request_secret", "request_payment_approval", "vault_fill"];

export const WORKSTATION_REFUSAL = "vault_fill types a saved value only inside a member workstation browser, after checking the page's site. This member runs on this Mac, where there is no workstation, so nothing was filled. Ask the person to give this member its own workstation (Runs on → workstation) or to complete this step themselves.";

const TOOLS = [
  {
    name: "vault_list",
    description: "List the person's saved vault items: logins, cards and personal details. Returns labels, kinds and masked hints only (for example “Visa ···· 4242”), never a value.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "request_secret",
    description: "Ask the person for a login, card or personal details through a secure form in the chat. The values go straight into their vault; you later receive only the new item's id and masked hint. Calling this ends your turn: stop and wait for the person.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["login", "card", "identity"], description: "What is needed." },
        label: { type: "string", description: "What the item is for, for example “GitHub login”." },
        reason: { type: "string", description: "One sentence on why it is needed." },
        saveToVault: { type: "boolean", description: "Keep it for next time (default true) or this task only." },
      },
      required: ["kind", "label"],
      additionalProperties: false,
    },
  },
  {
    name: "request_payment_approval",
    description: "Ask the person to approve a payment before it happens. They choose Approve with a saved card, I'll pay myself, or Decline. Calling this ends your turn: stop and wait; the decision reaches your next turn with the card's id and hint only.",
    inputSchema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Who is being paid." },
        amount: { type: "string", description: "The amount as a number, for example “19.99”." },
        currency: { type: "string", description: "Three-letter currency code, for example USD." },
        site: { type: "string", description: "The checkout site's hostname." },
        reason: { type: "string", description: "What the payment is for." },
      },
      required: ["merchant", "amount", "currency"],
      additionalProperties: false,
    },
  },
  {
    name: "vault_fill",
    description: "Type one field of a vault item into the page in a member workstation browser, after checking the site. On a member that runs on this Mac it refuses and explains why.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The vault item id, from vault_list or a request outcome." },
        field: { type: "string", description: `One of: ${Object.entries(VAULT_FIELDS).map(([kind, fields]) => `${kind}: ${fields.join(", ")}`).join("; ")}.` },
      },
      required: ["itemId", "field"],
      additionalProperties: false,
    },
  },
];

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

export function createVaultService({ stateDir, rootDir, homeDir, bridgeUrl, emit = () => {}, store = createVaultStore({ stateDir, homeDir }), requests = createVaultRequests({ stateDir, emit }), nodePath = process.execPath }) {
  const sessions = new Map(); // by member id: one credential per member while the bridge runs
  const byToken = new Map();

  function publicSession(session) {
    return { id: session.id, memberId: session.memberId, runId: session.runId, createdAt: session.createdAt };
  }

  /**
   * The managed server entry for one piece of work. The credential is per
   * member and stable across turns so a warm SDK session keeps its key (the
   * launch config is part of that key); only the outcome text changes, and
   * only on the turn that delivers it. The return value carries the secret:
   * keep it out of status and summaries.
   */
  async function openWork({ memberId, runId = "", channelId = "", scope = "" }) {
    if (typeof memberId !== "string" || !memberId.trim()) throw new VaultError("A member identity is required.");
    const owner = memberId.trim();
    const key = JSON.stringify([owner, String(scope)]);
    let session = sessions.get(key);
    if (!session) {
      session = { id: randomUUID(), memberId: owner, scope: String(scope), runId: "", channelId: "", createdAt: new Date().toISOString(), token: randomBytes(32).toString("hex") };
      sessions.set(key, session);
      byToken.set(session.token, session);
    }
    session.runId = String(runId);
    session.channelId = String(channelId || "");
    const outcomes = await requests.takeOutcomes(owner);
    const mcpServer = {
      name: VAULT_MCP_SERVER_NAME,
      transport: "stdio",
      stdioFraming: "newline",
      command: nodePath,
      args: [join(rootDir, "server", "vault", "mcp-server.mjs"), "--mcp"],
      autoConnect: true,
      env: { AUTOHAND_SQUAD_VAULT_URL: `${new URL("/api/vault/mcp", bridgeUrl)}`, AUTOHAND_SQUAD_VAULT_TOKEN: session.token },
    };
    return { ...publicSession(session), mcpServer, instructions: instructionsFor(outcomes) };
  }

  /** Invalidate a member's credential (member stopped, profile reset). */
  function closeMember(memberId) {
    for (const [key, session] of sessions) if (session.memberId === memberId) {
      sessions.delete(key); byToken.delete(session.token);
    }
  }

  async function callTool(session, name, args) {
    if (!record(args)) return failure("Arguments must be an object.");
    try {
      switch (name) {
        case "vault_list": {
          const items = await store.list();
          return text({ items: items.map((item) => ({ id: item.id, kind: item.kind, label: item.label, hint: item.hint, site: item.site })), note: "Hints only. To use an item, ask for vault_fill inside a workstation; to add one, call request_secret." });
        }
        case "request_secret": {
          const request = await requests.createSecret(session.memberId, { runId: session.runId, channelId: session.channelId }, args);
          return text({ status: "waiting_for_person", requestId: request.id, message: `A secure form for “${request.request.label}” is now in the chat. Your turn ends here: stop and tell the person you are waiting for them to fill it. The outcome reaches your next turn as the item's id and hint.` });
        }
        case "request_payment_approval": {
          const request = await requests.createPayment(session.memberId, { runId: session.runId, channelId: session.channelId }, args);
          return text({ status: "waiting_for_person", requestId: request.id, message: `The person is asked to approve ${request.request.amount} ${request.request.currency} to ${request.request.merchant}. Your turn ends here: stop and say you are waiting for their decision. It reaches your next turn as approved (with the card's id and hint), paid by them, or declined.` });
        }
        case "vault_fill": {
          const item = await store.get(String(args.itemId || ""));
          if (!item) return failure("That vault item doesn't exist (any more). Call vault_list.");
          if (!VAULT_FIELDS[item.kind]?.includes(String(args.field || ""))) return failure(`A ${item.kind} has no "${args.field}". Fields: ${VAULT_FIELDS[item.kind].join(", ")}.`);
          return failure(WORKSTATION_REFUSAL);
        }
        default:
          return failure("This vault tool is not available through Squad.");
      }
    } catch (error) {
      return failure(error?.message || "The vault request failed.");
    }
  }

  async function dispatch(token, request) {
    const session = typeof token === "string" ? byToken.get(token) : null;
    if (!session) throw new VaultError("Vault session has expired.", 401);
    if (!record(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") throw new VaultError("Invalid vault request.");
    if (request.method === "initialize") {
      return { protocolVersion: ["2024-11-05", "2025-06-18"].includes(request.params?.protocolVersion) ? request.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "autohand-squad-vault", version: "1" } };
    }
    if (request.method === "ping" || request.method.startsWith("notifications/")) return {};
    if (request.method === "tools/list") return { tools: TOOLS };
    if (request.method !== "tools/call") throw new VaultError("Unsupported vault method.");
    const name = request.params?.name;
    if (!VAULT_TOOL_NAMES.includes(name)) throw new VaultError("This vault tool is not available through Squad.", 403);
    return callTool(session, name, request.params?.arguments ?? {});
  }

  return {
    store,
    requests,
    tools: TOOLS,
    openWork,
    closeMember,
    finishWork: runId => {
      for (const [key, session] of sessions) if (session.scope && session.runId === runId) {
        sessions.delete(key); byToken.delete(session.token);
      }
    },
    dispatch,
    sessions: () => [...sessions.values()].map(publicSession),
    close: () => { sessions.clear(); byToken.clear(); },
  };
}

/** System-prompt text for a turn: how the tools behave, plus any outcomes since the last turn. */
export function instructionsFor(outcomes = []) {
  const lines = [
    "The person's vault is available through Squad's autohand-vault MCP server: vault_list shows labels and masked hints only; request_secret and request_payment_approval put a secure form or an approval row in the chat and END your turn, so after calling one stop and say you are waiting; vault_fill works only inside a member workstation and refuses on this Mac. You never see a saved value and must never ask the person to paste one into the chat.",
  ];
  if (outcomes.length) lines.push(`Since your last turn the person answered:\n${outcomes.map((item) => `- ${item.text}`).join("\n")}`);
  return lines.join("\n\n");
}
