// The chief of staff: reviews a member against what it actually did and
// proposes a few concrete improvements. It is deliberately dull. Three rules,
// each with evidence you can point at:
//
//   1. A failure that keeps happening is worth remembering.
//   2. A command it runs often enough is a routine worth naming as a skill.
//   3. A memory that has sat untouched for a month is worth re-checking.
//
// Every proposal carries the evidence that produced it, so nothing is
// suggested on a hunch, and a review is capped so it stays something a person
// can act on rather than a backlog.
//
// Pure: no React, no DOM, so scripts/check-chief-of-staff.mjs can import it
// from Node. See docs/adrs/ADR-0029-chief-of-staff.md.

/** The same failure this many times stops being bad luck. */
export const MIN_FAILURES_TO_REMEMBER = 2;
/** The same command this many times is a routine, not a one-off. */
export const MIN_RUNS_TO_LEARN = 3;
/** A memory older than this wants confirming. */
export const STALE_MEMORY_DAYS = 30;
/** Never hand a person more than this at once. */
export const MAX_PROPOSALS = 3;

/**
 * `{ hasWork, proposals: [proposal], observations }` for one member.
 * A proposal is `{ kind, text, evidence, skillName?, memoryId? }` where kind
 * is "memory.add", "skill.add" or "memory.confirm".
 */
export function reviewMember(input) {
  const agent = input && typeof input === "object" ? input.agent : null;
  const records = Array.isArray(input?.records) ? input.records : [];
  const now = input?.now instanceof Date ? input.now : new Date();
  if (!agent || typeof agent !== "object") return empty();

  const skills = Array.isArray(agent.skills) ? agent.skills : [];
  const memory = Array.isArray(agent.memory) ? agent.memory : [];

  const proposals = [
    ...lessonsFromFailures(records, memory),
    ...skillsFromRoutines(records, skills),
    ...staleMemories(memory, now),
  ];

  return {
    hasWork: proposals.length > 0,
    observations: { records: records.length, skills: skills.length, memory: memory.length },
    proposals: proposals.slice(0, MAX_PROPOSALS),
  };
}

/** One short sentence describing what a proposal would do. */
export function proposalSummary(proposal, copy = {}) {
  if (!proposal) return "";
  switch (proposal.kind) {
    case "memory.add":
      return `${copy.chiefRemember || "Remember"}: ${proposal.text}`;
    case "skill.add":
      return `${copy.chiefAddSkill || "Add the skill"} ${proposal.text}`;
    case "memory.confirm":
      return `${copy.chiefConfirm || "Still true?"} ${proposal.text}`;
    default:
      return "";
  }
}

/** The patch that carries out a proposal. `{}` when there is nothing to do. */
export function applyProposal(agent, proposal, now = new Date()) {
  if (!agent || !proposal) return {};
  const at = now.toISOString();
  switch (proposal.kind) {
    case "memory.add": {
      const memory = Array.isArray(agent.memory) ? agent.memory : [];
      return { memory: [...memory, { id: `mem_${slug(proposal.text)}`, text: proposal.text, at, source: "chief-of-staff" }] };
    }
    case "skill.add": {
      const skills = Array.isArray(agent.skills) ? agent.skills : [];
      return { skills: [...skills, { id: `skill_${slug(proposal.text)}`, name: proposal.text, at, source: "chief-of-staff" }] };
    }
    case "memory.confirm": {
      const memory = Array.isArray(agent.memory) ? agent.memory : [];
      // Confirming refreshes the entry rather than adding a second copy.
      return { memory: memory.map((entry) => (entryId(entry) === proposal.memoryId ? { ...entry, at, confirmedAt: at } : entry)) };
    }
    default:
      return {};
  }
}

// --- rules -----------------------------------------------------------------

function lessonsFromFailures(records, memory) {
  const counts = new Map();
  for (const record of records) {
    if (!isFailure(record)) continue;
    const lesson = lessonText(record.summary);
    if (!lesson) continue;
    counts.set(lesson, (counts.get(lesson) || 0) + 1);
  }
  const known = memory.map((entry) => normalize(entryText(entry)));
  const out = [];
  for (const [lesson, count] of counts) {
    if (count < MIN_FAILURES_TO_REMEMBER) continue;
    if (known.some((text) => text.includes(normalize(lesson)) || normalize(lesson).includes(text))) continue;
    out.push({ kind: "memory.add", text: lesson, evidence: { count, of: "failures" } });
  }
  return out.sort((a, b) => b.evidence.count - a.evidence.count);
}

function skillsFromRoutines(records, skills) {
  const counts = new Map();
  for (const record of records) {
    if (String(record?.kind || "") !== "shell") continue;
    const command = String(record?.refs?.command || "").trim() || commandFromSummary(record?.summary);
    if (!command) continue;
    counts.set(command, (counts.get(command) || 0) + 1);
  }
  const known = skills.map((skill) => normalize(skill?.name || skill?.id || skill));
  const out = [];
  for (const [command, count] of counts) {
    if (count < MIN_RUNS_TO_LEARN) continue;
    if (known.some((name) => name.includes(normalize(command)))) continue;
    out.push({ kind: "skill.add", text: `Run ${command}`, skillName: command, evidence: { count, of: "commands" } });
  }
  return out.sort((a, b) => b.evidence.count - a.evidence.count);
}

function staleMemories(memory, now) {
  const cutoff = now.getTime() - STALE_MEMORY_DAYS * 86_400_000;
  const out = [];
  for (const entry of memory) {
    const at = Date.parse(entry?.confirmedAt || entry?.at || "");
    if (!Number.isFinite(at) || at > cutoff) continue;
    const text = entryText(entry);
    if (!text) continue;
    out.push({ kind: "memory.confirm", text, memoryId: entryId(entry), evidence: { age: Math.round((now.getTime() - at) / 86_400_000), of: "days" } });
  }
  // Oldest first: the least trustworthy memory is the one worth checking.
  return out.sort((a, b) => b.evidence.age - a.evidence.age);
}

// --- helpers ---------------------------------------------------------------

function empty() {
  return { hasWork: false, observations: { records: 0, skills: 0, memory: 0 }, proposals: [] };
}

function isFailure(record) {
  return String(record?.status || "") === "failed" || /\bfailed\b/i.test(String(record?.summary || ""));
}

/** "Run failed: the build needs Node 24" -> "the build needs Node 24". */
function lessonText(summary) {
  const text = String(summary || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const afterColon = text.split(":").slice(1).join(":").trim();
  return (afterColon || text).slice(0, 160);
}

/** "Ran bun run build" -> "bun run build". */
function commandFromSummary(summary) {
  const match = String(summary || "").trim().match(/^Ran\s+(.+)$/i);
  return match ? match[1].trim().slice(0, 120) : "";
}

function entryText(entry) {
  return String(entry?.text || entry?.body || entry?.title || entry || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function entryId(entry) {
  return String(entry?.id || entryText(entry));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-").slice(0, 48) || String(Date.now());
}
