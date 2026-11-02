// Permission requests from an Autohand member, answered from the Squad chat
// (ADR-0161).
//
// In RPC mode the CLI does not prompt on a terminal: it sends a
// `permission_request` notification and waits 30 s for the client to
// acknowledge it, then an hour for the decision; without either it denies.
// Squad showed "Waiting for permission…" and never answered, so every write,
// search and command a member asked about ended declined. This registry keeps
// the pending requests of live turns, acknowledges each one at once so the
// person has time to decide, forwards the decision over the SDK, and denies
// whatever is still open when the turn ends.

const DECISIONS = new Map([
  ["allow", "allow_once"],
  ["allow_once", "allow_once"],
  ["allow_session", "allow_session"],
  ["deny", "deny_once"],
  ["deny_once", "deny_once"],
  ["deny_session", "deny_session"],
]);

import { ENGINE_CLEANUP_MS, withDeadline } from "./deadline.mjs";

export const PERMISSION_DECISIONS = Object.freeze([...new Set(DECISIONS.values())]);

export function normalizePermissionDecision(value) {
  return DECISIONS.get(String(value || "").trim()) || "";
}

export class PermissionApprovalError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function summary(pending) {
  return {
    requestId: pending.requestId,
    runId: pending.runId,
    agentId: pending.agentId,
    tool: pending.tool,
    description: pending.description,
    context: pending.context,
    options: pending.options,
    createdAt: pending.createdAt,
    acknowledged: pending.acknowledged,
  };
}

export class PermissionApprovals {
  constructor({ log = () => {}, now = () => new Date().toISOString() } = {}) {
    this.pending = new Map();
    // "Allow for this reply": the CLI's allow_session remembers the exact
    // target (one file path), so six new files asked six more times; a demo
    // build answered seventeen cards. Squad keeps the choice per run and tool
    // and answers the rest of that reply itself (ADR-0161).
    this.replyAllows = new Set();
    this.log = log;
    this.now = now;
  }

  /**
   * A `permission_request` SDK event arrived on a live turn. Records it,
   * acknowledges it to the CLI (best effort; the SDK call is fire-and-forget
   * here because the event loop must keep draining the stream) and returns the
   * event the browser renders as an approval card.
   */
  request(event, { sdk, runId, agentId, send }) {
    const requestId = String(event?.requestId || "").trim();
    if (!requestId) return null;
    const pending = {
      requestId,
      runId: String(runId || ""),
      agentId: String(agentId || ""),
      tool: String(event.tool || "tool"),
      description: String(event.description || event.tool || "Permission requested"),
      context: event.context && typeof event.context === "object" ? event.context : {},
      options: Array.isArray(event.options) ? event.options.map(String) : [],
      createdAt: String(event.timestamp || this.now()),
      acknowledged: false,
      sdk,
      send: typeof send === "function" ? send : () => {},
    };
    if (this.replyAllows.has(`${pending.runId}:${pending.tool}`)) {
      // Already allowed for this reply: answer at once, and tell the browser
      // as a resolved request so Work details still records it.
      Promise.resolve()
        .then(() => sdk.permissionResponse({ requestId, decision: "allow_once" }))
        .catch((error) => this.log(`permission ${requestId} could not be auto-allowed: ${error?.message || error}`));
      pending.send({ type: "permission_resolved", requestId, tool: pending.tool, decision: "allow_session", source: "reply", timestamp: pending.createdAt });
      return null;
    }
    this.pending.set(requestId, pending);
    // The Agent SDK names this `acknowledgePermission` (RPC
    // `autohand.permissionAcknowledged`). Without it the CLI denies after
    // 30 s; a live review lost a shell command that way while the card sat
    // unanswered for 47 s.
    const acknowledge = typeof sdk?.acknowledgePermission === "function" ? sdk.acknowledgePermission.bind(sdk)
      : typeof sdk?.permissionAcknowledged === "function" ? sdk.permissionAcknowledged.bind(sdk)
      : typeof sdk?.client?.acknowledgePermission === "function" ? sdk.client.acknowledgePermission.bind(sdk.client) : null;
    if (acknowledge) {
      Promise.resolve()
        .then(() => acknowledge({ requestId }))
        .then(() => { pending.acknowledged = true; })
        .catch((error) => this.log(`permission ${requestId} could not be acknowledged: ${error?.message || error}`));
    } else {
      this.log(`permission ${requestId} cannot be acknowledged: the SDK has no acknowledge method, so the engine will deny it in 30 seconds`);
    }
    return {
      type: "permission_request",
      requestId,
      tool: pending.tool,
      title: pending.description,
      description: pending.description,
      context: pending.context,
      options: pending.options,
      timestamp: pending.createdAt,
    };
  }

  list(agentId = "") {
    return Array.from(this.pending.values())
      .filter((pending) => !agentId || pending.agentId === agentId)
      .map(summary);
  }

  /** The person decided. Only session-or-once scopes are offered, so no decision writes the member's allowList. */
  async decide(requestId, value, { source = "person" } = {}) {
    const pending = this.pending.get(String(requestId || ""));
    if (!pending) throw new PermissionApprovalError("This permission request is no longer waiting; the turn may have ended.", 410);
    const decision = normalizePermissionDecision(value);
    if (!decision) throw new PermissionApprovalError(`Choose one of ${PERMISSION_DECISIONS.join(", ")}.`, 400);
    this.pending.delete(pending.requestId);
    if (decision === "allow_session" && pending.runId) this.replyAllows.add(`${pending.runId}:${pending.tool}`);
    try {
      await pending.sdk.permissionResponse({ requestId: pending.requestId, decision });
    } catch (error) {
      throw new PermissionApprovalError(`The engine did not take the decision: ${error?.message || error}`, 502);
    }
    const resolved = { type: "permission_resolved", requestId: pending.requestId, tool: pending.tool, decision, source, timestamp: this.now() };
    pending.send(resolved);
    return { ...summary(pending), decision, source };
  }

  /** The turn ended (finished, stopped, failed): nothing can be answered now, so say so to the engine and the browser. */
  async settleRun(runId, { reason = "turn ended" } = {}) {
    for (const key of Array.from(this.replyAllows)) if (key.startsWith(`${String(runId || "")}:`)) this.replyAllows.delete(key);
    const open = Array.from(this.pending.values()).filter((pending) => pending.runId === String(runId || ""));
    for (const pending of open) {
      this.pending.delete(pending.requestId);
      // Bounded: at the end of a turn whose engine stopped answering, this
      // request would otherwise wait five minutes (ADR-0161 §13).
      await withDeadline(pending.sdk?.permissionResponse?.({ requestId: pending.requestId, decision: "deny_once" }), ENGINE_CLEANUP_MS, "the permission reply").catch(() => {});
      pending.send({ type: "permission_resolved", requestId: pending.requestId, tool: pending.tool, decision: "deny_once", source: "closed", reason, timestamp: this.now() });
    }
    return open.length;
  }

  stats() {
    return { pending: this.pending.size };
  }
}
