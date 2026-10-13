// Member work plans (ADR-0124): pure helpers shared by the app and the bridge.
// No React, no DOM, no timers, no file access. The store lives on the bridge
// (server/work/store.mjs); this module says what a task looks like, what the
// member is told about its plan, and how a person's message is read for
// recurring work when the model did not propose a schedule itself.
//
// task shape (bridge-owned)
//   { id, memberId, title, detail, status: open|doing|done|blocked, due: YYYY-MM-DD|"",
//     recurring: routine id|"", source: member|person|handoff|routine, outcome,
//     lastOutcome: { at, status, preview }|null, createdAt, updatedAt, history: [{ at, by, event, note }] }

export const WORK_TASK_STATUSES = ["open", "doing", "done", "blocked"];
export const OPEN_WORK_STATUSES = new Set(["open", "doing", "blocked"]);
export const WORK_PLAN_HEADING = "Your work plan";
export const WORK_PLAN_BUDGET_CHARS = 2600;
export const WORK_PLAN_LIMITS = Object.freeze({ tasks: 12, routines: 6, goals: 4, queued: 4 });

export function isOpenWorkTask(task) {
  return OPEN_WORK_STATUSES.has(task?.status);
}

/** The status in a word the row can print. */
export function workStatusWord(status, copy = {}) {
  const words = { open: copy.workOpen || "open", doing: copy.workDoing || "doing", done: copy.workDone || "done", blocked: copy.workBlocked || "blocked" };
  return words[status] || String(status || "");
}

/** The presence-vocabulary status a StatusDot understands, from a plan status. */
export function workDotStatus(status) {
  if (status === "doing") return "running";
  if (status === "blocked") return "blocked";
  if (status === "done") return "completed";
  return "idle";
}

function dayKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** "due today", "due tomorrow", "due 15 Oct", "overdue 2 days"; nothing without a due date. */
export function dueLabel(due, { now = Date.now(), copy = {} } = {}) {
  const value = String(due || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const target = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(target)) return "";
  const today = Date.parse(`${dayKey(new Date(now))}T00:00:00Z`);
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return copy.dueToday || "due today";
  if (days === 1) return copy.dueTomorrow || "due tomorrow";
  if (days < 0) return (copy.overdueDays || "overdue {count} days").replace("{count}", String(-days)).replace("{days}", -days === 1 ? "day" : "days");
  const date = new Date(target);
  const label = `${date.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]}`;
  return (copy.dueOn || "due {date}").replace("{date}", label);
}

export function relativeAge(value, now = Date.now()) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.max(0, Math.round((now - ms) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function clip(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function inZone(iso, timeZone) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || undefined, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Pure. `sources` is { memberName, tasks, routines (bridge public routines:
 * description, next[], lastRun), goals (public goal records), queued (queue
 * items with text) }. Returns { text, counts }. The block is always present
 * on a direct-message turn, even when empty, so a sitrep is answered from
 * facts rather than from whatever the session remembers.
 */
export function buildWorkPlanBlock(sources = {}, { now = Date.now(), budget = WORK_PLAN_BUDGET_CHARS, limits = WORK_PLAN_LIMITS } = {}) {
  const routines = Array.isArray(sources.routines) ? sources.routines : [];
  const routineById = new Map(routines.map((routine) => [routine.id, routine]));
  const tasks = (Array.isArray(sources.tasks) ? sources.tasks : []).filter(isOpenWorkTask).sort((a, b) => {
    const order = { doing: 0, blocked: 1, open: 2 };
    const byStatus = (order[a.status] ?? 3) - (order[b.status] ?? 3);
    if (byStatus) return byStatus;
    return String(a.due || "9999").localeCompare(String(b.due || "9999")) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  }).slice(0, limits.tasks);
  const goals = (Array.isArray(sources.goals) ? sources.goals : []).filter((goal) => ["running", "paused"].includes(goal?.status)).slice(0, limits.goals);
  const queued = (Array.isArray(sources.queued) ? sources.queued : []).filter((item) => item?.status === "queued").slice(0, limits.queued);
  const counts = { tasks: tasks.length, routines: Math.min(routines.length, limits.routines), goals: goals.length, queued: queued.length };
  const sections = [];

  if (tasks.length) {
    sections.push(["Open tasks (id, title, status, due; mark them done when finished):", ...tasks.map((task) => {
      const parts = [workStatusWord(task.status)];
      const due = dueLabel(task.due, { now });
      if (due) parts.push(due);
      const routine = task.recurring ? routineById.get(task.recurring) : null;
      if (routine) parts.push(`recurring: ${routine.description || "scheduled"}${routine.next?.[0] ? `, next ${inZone(routine.next[0], routine.schedule?.timeZone)}` : ""}`);
      else if (task.recurring) parts.push("recurring");
      if (task.lastOutcome?.status) parts.push(`last run ${task.lastOutcome.status} ${relativeAge(task.lastOutcome.at, now)}${task.lastOutcome.preview ? `: "${clip(task.lastOutcome.preview, 80)}"` : ""}`);
      else if (task.source === "person") parts.push("added by the person");
      else if (task.source === "handoff") parts.push("handed to you");
      return `- [${task.id}] ${clip(task.title, 90)}${task.detail ? ` — ${clip(task.detail, 120)}` : ""} (${parts.join(", ")})`;
    })].join("\n"));
  }

  const listedRoutines = routines.slice(0, limits.routines);
  if (listedRoutines.length) {
    sections.push(["Your routines (scheduled on the bridge):", ...listedRoutines.map((routine) => {
      const zone = routine.schedule?.timeZone || "";
      const parts = [routine.description || "scheduled"];
      if (!routine.enabled) parts.push("paused");
      else if (routine.next?.[0]) parts.push(`next ${inZone(routine.next[0], zone)}${zone ? ` ${zone}` : ""}`);
      if (routine.activeRun) parts.push("running now");
      else if (routine.lastRun) parts.push(`last run ${routine.lastRun.status} ${relativeAge(routine.lastRun.finishedAt || routine.lastRun.startedAt, now)}`);
      return `- ${clip(routine.title, 80)}: ${parts.join(", ")}`;
    })].join("\n"));
  }

  if (goals.length) {
    // No turn counts or timestamps here: the warm SDK session keys on the
    // system prompt (ADR-0030), and a line that changes every goal turn
    // cold-started the engine on each one (check:goal-bridge found it).
    sections.push(["Goals you are pursuing:", ...goals.map((goal) => `- "${clip(goal.prompt || goal.summary || goal.title, 100)}" (${goal.status})`)].join("\n"));
  }

  if (queued.length) {
    sections.push(["Follow-ups queued for you (they run after this turn):", ...queued.map((item) => `- "${clip(item.text || item.prompt, 100)}"`)].join("\n"));
  }

  const intro = `${WORK_PLAN_HEADING} (facts from Squad, not memory; answer "what are you working on" from this and keep it current with task actions):`;
  const body = sections.length ? sections.join("\n\n") : "Nothing is planned: no open tasks, no routines, no goals, no queued follow-ups. If the person describes work for you, add tasks; if it recurs, propose the schedule as well.";
  let text = `${intro}\n${body}`;
  if (text.length > budget) text = `${text.slice(0, budget - 1)}…`;
  return { text, counts };
}

// ---------------------------------------------------------------------------
// Recurring work in plain English (the bridge-side safety net, ADR-0124)
//
// The member should propose the schedule itself; when its reply carries no
// schedule action and the person's message names recurring work, the bridge
// offers "Schedule this?" with a schedule read from these phrases. English
// only, first match wins, no negation or question detection beyond the
// guard below. Limits are listed in docs/integration/work.md.

const DAY_NAMES = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const PERIOD_TIME = { morning: "09:00", afternoon: "14:00", evening: "18:00", night: "20:00", noon: "12:00", lunchtime: "12:00" };
const GUARD = /^(?:do|does|did|don't|do not|never|stop|should|would|could|can|is|are|was|were|will|why|what|when|how|who)\b/i;

function timeIn(sentence) {
  const explicit = sentence.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i);
  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = explicit[2] ? Number(explicit[2]) : 0;
    const suffix = (explicit[3] || "").replace(/\./g, "").toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const period = sentence.match(/\b(morning|afternoon|evening|night|noon|lunchtime)s?\b/i);
  return period ? PERIOD_TIME[period[1].toLowerCase()] : "";
}

function sentenceAround(text, index) {
  const before = text.slice(0, index);
  const after = text.slice(index);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), before.lastIndexOf("! "), before.lastIndexOf("? ")) + 1;
  const endMatch = after.match(/[.!?\n]/);
  const end = index + (endMatch ? endMatch.index : after.length);
  return text.slice(start, end).trim();
}

function titleFrom(sentence, phrase) {
  const stripped = sentence
    .replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ")
    .replace(/\b(?:please|can you|could you|i want you to|i need you to|you should|make sure( to| you)?|from now on|going forward|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|in the\s+(?:morning|afternoon|evening)|(?:every|each)\s+\w+)\b/gi, " ")
    .replace(/^\W+|\W+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const title = stripped || sentence;
  const cut = title.length > 60 ? `${title.slice(0, 57).replace(/\s+\S*$/, "")}…` : title;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/**
 * The first recurring-work phrase in `text`, with the schedule it implies.
 * Returns null when nothing matches or the sentence is a question or a
 * negation. The schedule carries no time zone; the caller adds one.
 */
export function detectRecurringWork(text) {
  const source = String(text || "");
  if (!source.trim()) return null;
  const rules = [
    { re: /\b(?:every|each)\s+(?:week\s?day|working day|business day)(?:s)?(?:\s+(?:morning|afternoon|evening|night))?\b/i, build: (m, s) => ({ kind: "weekdays", days: [1, 2, 3, 4, 5], time: timeIn(s) || "09:00" }) },
    { re: /\b(?:week\s?day|working day)\s+(?:mornings|afternoons|evenings)\b/i, build: (m, s) => ({ kind: "weekdays", days: [1, 2, 3, 4, 5], time: timeIn(s) || "09:00" }) },
    { re: /\btwice\s+(?:a|per|every)\s+day\b/i, build: () => ({ kind: "cron", cron: "0 9,15 * * *" }) },
    { re: /\b(?:three|3)\s+times\s+(?:a|per)\s+day\b/i, build: () => ({ kind: "cron", cron: "0 9,13,17 * * *" }) },
    { re: /\b(?:every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun)(?:s)?(?:\s+(?:morning|afternoon|evening|night))?\b/i, build: (m, s) => ({ kind: "weekdays", days: [DAY_NAMES[m[1].toLowerCase()]], time: timeIn(s) || "09:00" }) },
    { re: /\b(?:every|each)\s+(?:day|morning|afternoon|evening|night)\b|\bdaily\b|\bonce\s+a\s+day\b/i, build: (m, s) => ({ kind: "weekdays", days: [0, 1, 2, 3, 4, 5, 6], time: timeIn(s) || "09:00" }) },
    { re: /\b(?:every|each)\s+(\d{1,3}|two|three|four|five|six|eight|twelve)\s+(hours?|minutes?|mins?)\b/i, build: (m) => {
      const n = NUMBER_WORDS[m[1].toLowerCase()] || Number(m[1]);
      const minutes = /^h/i.test(m[2]) ? n * 60 : n;
      return minutes >= 5 && minutes <= 1440 ? { kind: "interval", everyMinutes: minutes } : null;
    } },
    { re: /\b(?:every|each)\s+hour\b|\bhourly\b/i, build: () => ({ kind: "interval", everyMinutes: 60 }) },
    { re: /\bweekly\b|\b(?:every|each)\s+week\b|\bonce\s+a\s+week\b/i, build: (m, s) => ({ kind: "weekdays", days: [1], time: timeIn(s) || "09:00" }) },
    { re: /\b(?:end|last day)\s+of\s+(?:the|every|each)\s+month\b/i, build: (m, s) => ({ kind: "monthly", day: "last", time: timeIn(s) || "09:00" }) },
    { re: /\bmonthly\b|\b(?:every|each)\s+month\b|\bonce\s+a\s+month\b|\bfirst\s+of\s+(?:the|every|each)\s+month\b/i, build: (m, s) => ({ kind: "monthly", day: 1, time: timeIn(s) || "09:00" }) },
  ];
  for (const rule of rules) {
    const match = source.match(rule.re);
    if (!match) continue;
    const sentence = sentenceAround(source, match.index);
    if (GUARD.test(sentence)) return null;
    const schedule = rule.build(match, sentence);
    if (!schedule) return null;
    return { phrase: match[0], schedule, title: titleFrom(sentence, match[0]), instructions: clip(sentence, 600) || clip(source, 600) };
  }
  return null;
}

/** True when a reply's channel actions already carry a schedule proposal. */
export function replyProposedSchedule(actions = []) {
  return (Array.isArray(actions) ? actions : []).some((action) => action?.type === "schedule" && action.status !== "failed");
}

// ---------------------------------------------------------------------------
// Repeated asks (ADR-0125)
//
// detectRecurringWork above reads a schedule out of a sentence and feeds the
// "Schedule this?" line, so it must only match phrases that imply a rule.
// "Again", "as usual" and "like yesterday" say the work repeats without
// saying when; they never produce an offer with an invented schedule. They
// only make the bridge ask the member, on its next turn, to propose a
// routine or ask the person when.

const REPEAT_RULES = [
  /\b(?:like|same as)\s+(?:yesterday|last time|last week|before|usual)\b/i,
  /\bas\s+usual\b/i,
  /\bkeep\s+(?:doing|sending|checking|pulling|posting|running|updating)\b/i,
  /\bthe\s+usual\b/i,
  /\b(?:do|run|send|pull|post|prepare|write|check|make|draft|update|compile|share)\b[^.?!\n]{0,80}?\bagain\b/i,
];
const NOT_REPEAT = /\b(?:try|say|said|tell|explain|ask|repeat that|read)\b[^.?!\n]{0,20}\bagain\b|\bnever again\b|\bagain\?/i;

/** `{ phrase }` when the message asks for repeated work without a schedule; null otherwise. */
export function detectRepeatRequest(text) {
  const source = String(text || "");
  if (!source.trim()) return null;
  for (const rule of REPEAT_RULES) {
    const match = source.match(rule);
    if (!match) continue;
    const sentence = sentenceAround(source, match.index);
    if (GUARD.test(sentence) || NOT_REPEAT.test(sentence)) continue;
    return { phrase: match[0].length > 40 ? match[0].replace(/^(\w+)[\s\S]*?(\bagain)$/i, "$1 … $2") : match[0] };
  }
  return null;
}

const STOP_WORDS = new Set("the a an and or to of for in on at by with from me my you your our we us it its this that these those is are was be can could would please pls just then also into about".split(" "));

function contentWords(text) {
  return new Set(String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

/**
 * The earlier prompt this one repeats, or null. Pure. Word-set overlap
 * (Jaccard) of at least `threshold` on messages with at least four content
 * words, so "thanks" twice is not a pattern.
 */
export function similarRequest(prompt, previous = [], { threshold = 0.6, minWords = 4 } = {}) {
  const words = contentWords(prompt);
  if (words.size < minWords) return null;
  for (const earlier of Array.isArray(previous) ? previous : []) {
    const other = contentWords(earlier);
    if (other.size < minWords) continue;
    let shared = 0;
    for (const word of words) if (other.has(word)) shared += 1;
    const union = words.size + other.size - shared;
    if (union && shared / union >= threshold) return String(earlier);
  }
  return null;
}

/**
 * What the bridge noticed about the person's last message, or null. The
 * order is the strength of the signal: a schedule in words, a repeat word,
 * then a near-identical earlier ask.
 */
export function repeatedWorkSignal(prompt, previousPrompts = []) {
  const recurring = detectRecurringWork(prompt);
  if (recurring) return { kind: "recurring", phrase: recurring.phrase };
  const repeat = detectRepeatRequest(prompt);
  if (repeat) return { kind: "repeat", phrase: repeat.phrase };
  const earlier = similarRequest(prompt, previousPrompts);
  if (earlier) return { kind: "same-ask", phrase: clip(earlier, 80) };
  return null;
}

/** The one line the next turn's prompt carries when the last reply proposed no routine. */
export function automationNudgeLine(signal) {
  if (!signal?.phrase) return "";
  const said = signal.kind === "same-ask" ? `asked for the same thing again ("${signal.phrase}")` : `said "${signal.phrase}"`;
  return `(Squad note: in their previous message the person ${said} and no routine was proposed. If this is work they want done regularly, propose it with the schedule action now, or ask them one short question about the missing detail. Do not mention this note.)`;
}

// ---------------------------------------------------------------------------
// The agenda (ADR-0125): what a member with "Keep working between messages"
// on should start next, if anything. Pure. Routines and queued follow-ups
// are never picked here; the scheduler and the queue dispatcher start them.

// Goal pauses that are not a person's decision and need no review.
const RESUMABLE_GOAL_PAUSES = [/bridge restarted/i, /runtime boundary/i, /Keep working between messages resumes it/i];

export function goalIsResumable(goal) {
  return goal?.status === "paused" && RESUMABLE_GOAL_PAUSES.some((pattern) => pattern.test(String(goal.pauseReason || "")));
}

/**
 * `{ kind: "goal", goal } | { kind: "task", task } | null`. `attempted` is
 * the set of item keys ("goal:<id>", "task:<id>") the agenda already
 * started today; an item is tried at most once a day.
 */
export function nextAgendaItem({ tasks = [], goals = [], attempted = new Set() } = {}) {
  const tried = attempted instanceof Set ? attempted : new Set(attempted || []);
  const goal = (Array.isArray(goals) ? goals : []).find((item) => goalIsResumable(item) && !tried.has(`goal:${item.id}`));
  if (goal) return { kind: "goal", key: `goal:${goal.id}`, title: clip(goal.prompt || goal.summary || goal.title || "Goal", 90), goal };
  const task = (Array.isArray(tasks) ? tasks : [])
    .filter((item) => item?.status === "open" && !item.recurring && !tried.has(`task:${item.id}`))
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0];
  if (task) return { kind: "task", key: `task:${task.id}`, title: clip(task.title, 90), task };
  return null;
}

/** The prompt of an agenda run for a task: the task, and how to report it. */
export function agendaTaskPrompt(task) {
  const detail = task?.detail ? `\nDetail: ${clip(task.detail, 600)}` : "";
  const due = dueLabel(task?.due);
  return `You are idle and the person has asked you to keep working between messages. This task is open on your plan: [${task?.id}] ${clip(task?.title, 120)}${due ? ` (${due})` : ""}.${detail}\nWork on it now within your access and folders. When it is finished, mark it done with a task action and an outcome. If you are blocked or need the person, mark it blocked with an update and say exactly what you need. Do not start other tasks in this run.`;
}
