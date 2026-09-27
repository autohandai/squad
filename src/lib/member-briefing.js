// What a member has to report when you open its chat, built from the audit
// trail (ADR-0018) rather than from the model. Every line is something that
// actually happened, so the member's own opening words can be checked against
// it instead of being a generic introduction.
//
// Pure: no React, no DOM, so scripts/check-member-briefing.mjs can import it
// from Node. See docs/adrs/ADR-0028-member-briefing.md.

/** Kinds in the order a person cares about them. What it learned leads. */
const ORDER = ["skill", "memory", "run", "edit", "shell", "handoff", "approval", "message"];
const MAX_LINES = 5;

/**
 * `{ since, lines: [{ kind, text, count }] }` from audit records.
 * Records at or before `since` are not news.
 */
export function buildBriefing(records, { since = "", copy = {} } = {}) {
  const fresh = (Array.isArray(records) ? records : []).filter((record) => {
    if (!record || typeof record !== "object") return false;
    if (!since) return true;
    return String(record.at || "") > String(since);
  });

  const byKind = new Map();
  for (const record of fresh) {
    const kind = String(record.kind || "").trim() || "message";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(record);
  }

  const lines = [];
  for (const kind of ORDER) {
    const group = byKind.get(kind);
    if (!group?.length) continue;
    const text = describe(kind, group, copy);
    if (text) lines.push({ kind, text, count: group.length });
  }
  return { since, lines: lines.slice(0, MAX_LINES) };
}

export function hasNews(briefing) {
  return Boolean(briefing?.lines?.length);
}

/**
 * The same facts, addressed to the member, so its first reply agrees with
 * what the person is looking at instead of introducing itself from nothing.
 */
export function briefingContext(briefing) {
  if (!hasNews(briefing)) return "";
  const lines = briefing.lines.map((line) => `- ${line.text}`).join("\n");
  return [
    "<since_last_visit>",
    "This is what you actually did since this person last opened this conversation.",
    "Open by telling them what changed, in one or two sentences, in your own voice.",
    "State only what is listed here: do not invent skills, lessons or work.",
    lines,
    "</since_last_visit>",
  ].join("\n");
}

function describe(kind, group, copy) {
  const count = group.length;
  switch (kind) {
    case "skill":
      // Naming the skill matters more than counting them.
      return count === 1 ? clean(group[0].summary) : `${count} ${copy.briefingSkills || "new skills"}: ${group.map((r) => skillName(r)).filter(Boolean).join(", ")}`;
    case "memory":
      return count === 1 ? clean(group[0].summary) : `${count} ${copy.briefingLessons || "new things learned"}`;
    case "run": {
      const failed = group.filter((record) => isFailure(record)).length;
      const noun = count === 1 ? copy.briefingRun || "task" : copy.briefingRuns || "tasks";
      return failed ? `${count} ${noun}, ${failed} ${copy.briefingFailed || "failed"}` : `${count} ${noun}`;
    }
    case "edit": {
      const paths = new Set(group.map((record) => String(record.refs?.path || record.summary || "")).filter(Boolean));
      const noun = paths.size === 1 ? copy.briefingFile || "file" : copy.briefingFiles || "files";
      return `${copy.briefingEdited || "Edited"} ${paths.size} ${noun}`;
    }
    case "shell":
      return `${count} ${count === 1 ? copy.briefingCommand || "command" : copy.briefingCommands || "commands"}`;
    case "handoff":
      return `${count} ${count === 1 ? copy.briefingHandoff || "handoff" : copy.briefingHandoffs || "handoffs"}`;
    case "approval":
      return `${count} ${count === 1 ? copy.briefingApproval || "approval" : copy.briefingApprovals || "approvals"}`;
    default:
      return `${count} ${count === 1 ? copy.briefingReply || "reply" : copy.briefingReplies || "replies"}`;
  }
}

function isFailure(record) {
  return String(record?.status || "") === "failed" || /\bfailed\b/i.test(String(record?.summary || ""));
}

function skillName(record) {
  const text = clean(record?.summary);
  const match = text.match(/skill\s+(.+)$/i);
  return match ? match[1] : text;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
