// What to ask a member when you open its chat.
//
// The prompts are built from that member's own role, skills and workspace, so
// a data engineer is asked about its pipelines rather than about responsive
// layout. They interpolate rather than enumerate: three shapes that make
// sense for any role beat a per-role list nobody maintains.
//
// Pure: no React, no DOM, so scripts/check-member-suggestions.mjs can import
// it from Node. See docs/adrs/ADR-0032-member-suggestions.md.

export const SUGGESTION_LIMIT = 3;

/** "react-component-architecture" -> "react component architecture". */
export function readableSkill(skill) {
  const raw = typeof skill === "string" ? skill : skill?.name || skill?.id || "";
  return String(raw).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Three prompts for this member. Always three, always sentences, never a
 * placeholder: a member with nothing configured falls back to asks that work
 * for anyone.
 */
export function suggestionsFor(agent, context = {}) {
  const source = agent && typeof agent === "object" ? agent : {};
  const live = contextAsks(source, context && typeof context === "object" ? context : {});
  const role = clean(source.role) || "squad member";
  const skills = (Array.isArray(source.skills) ? source.skills : []).map(readableSkill).filter(Boolean);
  const project = projectName(source.workspace);
  const where = project ? ` in ${project}` : "";
  const first = skills[0] || "";
  const second = skills[1] || first;

  const subject = project || "this project";
  const asks = [];
  if (first) {
    asks.push(`With ${first} in mind, look at ${subject} and tell me the three things most worth fixing.`);
  }
  asks.push(`As ${withArticle(role)}, what would you take ownership of${where}? Start with what worries you most.`);
  if (second) {
    asks.push(`Find the weakest part of ${subject} when it comes to ${second}, then fix it and show me the change.`);
  }
  // Fillers, in order, for a member with few or no skills.
  asks.push(`Walk me through ${subject} the way ${withArticle(role)} would read it.`);
  asks.push(`What would you change first${where}, and what would you leave alone?`);
  if (!live.length) return asks.slice(0, SUGGESTION_LIMIT);
  // What the member can do right now leads (ADR-0265): its latest work, then
  // what its connectors reach, then its role and skills. The tail rotates by
  // day so the welcome is not the same three lines forever.
  const [lead, ...rest] = live;
  const pool = [...rest, ...asks];
  const offset = pool.length ? Math.abs(Number(context.day ?? dayNumber())) % pool.length : 0;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  return [...new Set([lead, ...rotated])].slice(0, SUGGESTION_LIMIT);
}

function dayNumber() {
  return Math.floor(Date.now() / 86_400_000);
}

// Connector names → something worth asking for. Matched on the name a person
// sees ("Gmail", "Google Calendar", "GitHub", …); anything else gets a
// generic ask that still names it.
const CONNECTOR_ASKS = [
  [/gmail|mail/i, () => "Go through my unread email and draft replies to the three that matter most."],
  [/calendar/i, () => "Look at my calendar this week and tell me what to move, skip or prepare for."],
  [/github|gitlab/i, (where) => `Review the open pull requests${where} and tell me which to merge first and why.`],
  [/linear|jira/i, () => "Which issues are blocking the team this week, and who should take them?"],
  [/notion|drive|docs|confluence/i, (where, name) => `Find the latest plan in ${name} and turn it into tasks for the squad.`],
  [/slack/i, () => "Summarise what I missed in Slack today and what needs a reply from me."],
  [/hubspot|salesforce|crm/i, (where, name) => `Which deals in ${name} need attention this week, and what should I say to each?`],
  [/figma/i, () => "Look at the latest Figma file and list what's missing before we can build it."],
];

function contextAsks(agent, context) {
  const asks = [];
  const project = projectName(agent.workspace);
  const where = project ? ` in ${project}` : "";
  const chief = /chief of staff/i.test(`${agent.role || ""} ${agent.name || ""}`);
  const work = (Array.isArray(context.recentWork) ? context.recentWork : []).filter((item) => clean(item?.title));
  const stopped = work.find((item) => /fail|stop|error|block/i.test(String(item.status || "")));
  if (stopped) asks.push(`“${quoteTitle(stopped.title)}” didn’t finish${stopped.memberName && chief ? ` for ${clean(stopped.memberName)}` : ""}. Find out why and get it done.`);
  const done = work.find((item) => item !== stopped);
  if (done) asks.push(chief && done.memberName ? `${clean(done.memberName)} worked on “${quoteTitle(done.title)}”. What should happen next, and who should do it?` : `Follow up on “${quoteTitle(done.title)}”: what is still open?`);
  for (const connector of (Array.isArray(context.connectors) ? context.connectors : []).slice(0, 6)) {
    const name = clean(connector?.name || connector);
    if (!name) continue;
    const match = CONNECTOR_ASKS.find(([pattern]) => pattern.test(name));
    asks.push(match ? match[1](where, name) : `Use ${name} to take one recurring chore off my plate. Suggest which.`);
    if (asks.length >= 4) break;
  }
  if (chief) {
    const squad = (Array.isArray(context.squad) ? context.squad : []).map(clean).filter((name) => name && name !== clean(agent.name));
    asks.push(squad.length
      ? `Look at what ${squad.length > 3 ? `${squad.slice(0, 3).join(", ")} and the others` : squad.length > 1 ? `${squad.slice(0, -1).join(", ")} and ${squad.at(-1)}` : squad[0]} ${squad.length > 1 ? "are" : "is"} doing and tell me what needs my attention today.`
      : "Which members should this squad have for the work I do? Propose a team.");
    if (!(context.connectors || []).length) asks.push("Which tools should I connect so you can take work off my plate? Start with the one that saves me most time.");
  }
  return [...new Set(asks)];
}

function quoteTitle(title) {
  const text = clean(title);
  return text.length > 70 ? `${text.slice(0, 69).replace(/\s+\S*$/, "")}…` : text;
}

/** "a QA Engineer", "an Operations Lead", "an SRE". */
function withArticle(role) {
  const word = role.split(" ")[0] || "";
  const acronym = /^[A-Z]{2,}$/.test(word);
  const vowelSound = acronym ? /^[AEFHILMNORSX]/.test(word) : /^[aeiou]/i.test(word) && !/^(uni|use|usu|one|eu)/i.test(word);
  return `${vowelSound ? "an" : "a"} ${role}`;
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** The folder name, which is what a person calls the project. */
function projectName(workspace) {
  const path = clean(workspace);
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
