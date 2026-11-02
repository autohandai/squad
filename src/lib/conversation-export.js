// Export a member conversation as it is in the window (ADR-0161 §3.2): the
// turns, when each happened, what tools each reply used and what the
// person approved, as Markdown for reading and JSON for machines. The live
// conversation exists only in the browser until New chat puts it away, so
// this is the only way to take it elsewhere while it is still open.

function toolNames(message) {
  const fromTrace = Array.isArray(message?.trace?.toolCalls) ? message.trace.toolCalls.map((call) => call?.name) : [];
  const fromStream = Array.isArray(message?.streamEvents) ? message.streamEvents.filter((event) => event?.type === "tool_start").map((event) => event?.tool?.name) : [];
  return [...new Set([...fromTrace, ...fromStream].filter(Boolean))];
}

function approvals(message) {
  const events = Array.isArray(message?.streamEvents) ? message.streamEvents : [];
  return events.filter((event) => event?.type === "permission_resolved").map((event) => ({ tool: String(event.tool || ""), decision: String(event.decision || ""), source: String(event.source || "") }));
}

function filesApplied(message) {
  const events = Array.isArray(message?.streamEvents) ? message.streamEvents : [];
  return events.filter((event) => event?.type === "status" && event.status === "changes_applied").flatMap((event) => (Array.isArray(event.files) ? event.files : []));
}

function when(message) {
  return String(message?.completedAt || message?.startedAt || message?.createdAt || message?.time || "");
}

/** The exportable record of a conversation. */
export function conversationRecord(agent, messages, { exportedAt = new Date().toISOString(), workspace = "" } = {}) {
  const list = (Array.isArray(messages) ? messages : []).filter((message) => message && message.role && !message.superseded);
  return {
    format: "autohand.squad-conversation",
    version: 1,
    exportedAt,
    member: { id: String(agent?.id || ""), name: String(agent?.name || "Member"), role: String(agent?.role || "") },
    workspace: String(workspace || agent?.workspace || ""),
    messages: list.map((message) => ({
      id: String(message.id || ""),
      role: message.role === "user" ? "person" : "member",
      at: when(message),
      status: String(message.status || ""),
      body: String(message.body || ""),
      ...(message.role !== "user" ? { tools: toolNames(message), approvals: approvals(message), filesApplied: filesApplied(message), durationMs: Number(message.durationMs) || undefined, model: message.effectiveModel?.model || undefined } : {}),
      ...(Array.isArray(message.attachments) && message.attachments.length ? { attachments: message.attachments.map((file) => String(file?.name || file?.id || "")) } : {}),
    })),
  };
}

/** The same conversation as readable Markdown. */
export function conversationMarkdown(record) {
  const lines = [`# Conversation with ${record.member.name}${record.member.role ? ` (${record.member.role})` : ""}`, ""];
  lines.push(`Exported ${record.exportedAt}${record.workspace ? ` · workspace ${record.workspace}` : ""}`, "");
  for (const message of record.messages) {
    const who = message.role === "person" ? "You" : record.member.name;
    lines.push(`## ${who}${message.at ? ` · ${message.at}` : ""}`, "");
    lines.push(message.body || "_(no text)_", "");
    const notes = [];
    if (message.tools?.length) notes.push(`Tools: ${message.tools.join(", ")}`);
    if (message.approvals?.length) notes.push(`Permissions: ${message.approvals.map((item) => `${item.tool} ${item.decision}${item.source === "closed" ? " (not answered)" : ""}`).join("; ")}`);
    if (message.filesApplied?.length) notes.push(`Files written: ${message.filesApplied.join(", ")}`);
    if (message.attachments?.length) notes.push(`Attachments: ${message.attachments.join(", ")}`);
    if (message.status && message.status !== "complete") notes.push(`Status: ${message.status}`);
    if (notes.length) lines.push(...notes.map((note) => `> ${note}`), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

/** A file name safe on every desktop: member name, date, extension. */
export function conversationFileName(record, extension) {
  const slug = String(record.member.name || "member").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "member";
  const stamp = String(record.exportedAt || "").slice(0, 16).replace(/[:T]/g, "-");
  return `squad-conversation-${slug}-${stamp}.${extension}`;
}
