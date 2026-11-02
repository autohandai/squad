// Permission requests a member raised during a reply, and which of them the
// person still has to answer (ADR-0161).
//
// The bridge forwards the engine's `permission_request` events with their
// request id and answers each one with a `permission_resolved` event once the
// person decides or the turn ends. Both live in the message's stream events;
// the chat shows a card for every request that has no resolution yet.

export const PERMISSION_CHOICES = Object.freeze([
  { id: "allow_once", label: "Allow once", variant: "outline" },
  { id: "allow_session", label: "Allow for this reply", variant: "ghost" },
  { id: "deny_once", label: "Deny", variant: "ghost" },
]);

export function pendingPermissionRequests(message) {
  const events = Array.isArray(message?.streamEvents) ? message.streamEvents : [];
  const decided = new Set(Object.keys(message?.permissionDecisions && typeof message.permissionDecisions === "object" ? message.permissionDecisions : {}));
  for (const event of events) if (event?.type === "permission_resolved" && event.requestId) decided.add(String(event.requestId));
  const pending = [];
  const seen = new Set();
  for (const event of events) {
    if (event?.type !== "permission_request" || !event.requestId) continue;
    const requestId = String(event.requestId);
    if (decided.has(requestId) || seen.has(requestId)) continue;
    seen.add(requestId);
    pending.push({
      requestId,
      tool: String(event.tool || "tool"),
      title: String(event.title || event.description || `Allow ${event.tool || "this tool"}?`),
      context: event.context && typeof event.context === "object" ? event.context : {},
      timestamp: String(event.timestamp || ""),
    });
  }
  return pending;
}

/** One line of detail for the card: the command, the path or nothing. */
export function permissionRequestDetail(request) {
  const context = request?.context || {};
  if (context.command) return String(context.command).slice(0, 400);
  if (context.path) return String(context.path).slice(0, 400);
  if (Array.isArray(context.args) && context.args.length) return context.args.map(String).join(" ").slice(0, 400);
  return "";
}

/** How a resolved request reads in Work details. */
export function permissionDecisionLabel(decision, source = "person") {
  if (source === "closed") return "Not answered before the reply ended; denied";
  switch (decision) {
    case "allow_once": return "Allowed once";
    case "allow_session": return "Allowed for this reply";
    case "deny_session": return "Denied for this reply";
    case "deny_once": return "Denied";
    default: return String(decision || "");
  }
}
