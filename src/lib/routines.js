// Member routines (ADR-0110): pure browser helpers. No React, no DOM, no
// timers. Schedule arithmetic lives on the bridge
// (server/routines/schedule.mjs); the app sends a schedule and shows what
// the bridge computed, so there is one calendar implementation.
//
// draft shape (the Automations editor's Schedule section)
//   { kind: manual|once|weekdays|interval|monthly|yearly|cron, timeZone, time,
//     date, days, everyMinutes, startDate, startTime, day, month, cron, maxRunMinutes }

export const ROUTINE_KINDS = [
  { id: "manual", label: "Manual only" },
  { id: "once", label: "Once" },
  { id: "weekdays", label: "Weekdays" },
  { id: "interval", label: "Every N minutes" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
  { id: "cron", label: "Custom cron" },
];

export const RUN_LIMIT_OPTIONS = [
  { minutes: 0, label: "No limit" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 480, label: "8 hours" },
];

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function timeZoneChoices() {
  try {
    const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC"];
  }
}

function todayIn(timeZone) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
  } catch {
    const now = new Date();
    return { date: now.toISOString().slice(0, 10), time: "09:00" };
  }
}

/** An editor draft with every field present, from a saved schedule or nothing. */
export function routineDraft(schedule = null, { timeZone = browserTimeZone(), maxRunMinutes = 0 } = {}) {
  const source = schedule && typeof schedule === "object" ? schedule : {};
  const zone = source.timeZone || timeZone;
  const today = todayIn(zone);
  return {
    kind: ROUTINE_KINDS.some((kind) => kind.id === source.kind) ? source.kind : "manual",
    timeZone: zone,
    time: source.time || "09:00",
    date: source.date || today.date,
    days: Array.isArray(source.days) && source.days.length ? source.days : [1, 2, 3, 4, 5],
    everyMinutes: Number(source.everyMinutes) || 60,
    startDate: source.startDate || today.date,
    startTime: source.startTime || today.time,
    day: source.day === "last" ? "last" : Number(source.day) || 1,
    month: Number(source.month) || 1,
    cron: source.cron || "",
    maxRunMinutes: Number(maxRunMinutes) || 0,
  };
}

/**
 * The draft for an automation: its bridge schedule when it has one, else a
 * mapping of the legacy daily/weekdays/weekly fields (which never ran) onto
 * the real kinds so an existing automation keeps its intent.
 */
export function routineDraftFromAutomation(automation, { timeZone = browserTimeZone() } = {}) {
  if (automation?.routine && typeof automation.routine === "object") return routineDraft(automation.routine, { timeZone, maxRunMinutes: automation.routine.maxRunMinutes });
  const frequency = String(automation?.scheduleFrequency || "");
  const time = automation?.scheduleTime || "09:00";
  if (frequency === "daily") return routineDraft({ kind: "weekdays", days: [0, 1, 2, 3, 4, 5, 6], time }, { timeZone });
  if (frequency === "weekdays") return routineDraft({ kind: "weekdays", days: [1, 2, 3, 4, 5], time }, { timeZone });
  if (frequency === "weekly") return routineDraft({ kind: "weekdays", days: [1], time }, { timeZone });
  return routineDraft(null, { timeZone });
}

/** The schedule the bridge stores, from a draft; null for manual. */
export function scheduleFromDraft(draft) {
  if (!draft || draft.kind === "manual") return null;
  const base = { kind: draft.kind, timeZone: draft.timeZone, time: draft.time };
  switch (draft.kind) {
    case "once":
      return { ...base, date: draft.date };
    case "weekdays":
      return { ...base, days: draft.days };
    case "interval":
      return { ...base, everyMinutes: draft.everyMinutes, startDate: draft.startDate, startTime: draft.startTime };
    case "monthly":
      return { ...base, day: draft.day };
    case "yearly":
      return { ...base, month: draft.month, day: draft.day };
    case "cron":
      return { ...base, cron: draft.cron };
    default:
      return null;
  }
}

/** The routine record to send with an automation (title, instructions, workspace, model, schedule). */
export function routinePayloadFromAutomation(automation, draft = automation?.routine) {
  const schedule = scheduleFromDraft(draft);
  if (!schedule) return null;
  return {
    memberId: automation.agentId,
    title: automation.name,
    instructions: automation.prompt || automation.description,
    workspace: automation.workspace || "",
    model: automation.model && automation.model !== "auto" ? automation.model : "",
    enabled: automation.status !== "paused",
    schedule,
    maxRunMinutes: Number(draft?.maxRunMinutes) || 0,
  };
}

/** A short label for a schedule without calendar arithmetic ("Weekdays", "Every 15 minutes"). */
export function scheduleKindLabel(schedule) {
  if (!schedule || !schedule.kind || schedule.kind === "manual") return "Manual only";
  if (schedule.kind === "interval") return `Every ${schedule.everyMinutes} minutes`;
  if (schedule.kind === "cron") return `Custom cron ${schedule.cron || ""}`.trim();
  const kind = ROUTINE_KINDS.find((item) => item.id === schedule.kind)?.label || "Schedule";
  return schedule.time ? `${kind} at ${schedule.time}` : kind;
}

/** "Tue 14 Oct, 09:00" in `timeZone`, for a bridge ISO instant. */
export function formatInZone(value, timeZone, locale = undefined, { year = false } = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: timeZone || undefined, weekday: "short", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit" }).format(date);
  } catch {
    return date.toISOString();
  }
}

export const RUN_STATUS_WORDS = {
  queued: "Waiting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  skipped: "Skipped",
  missed: "Missed",
  interrupted: "Interrupted",
};

export function runStatusWord(status) {
  return RUN_STATUS_WORDS[status] || String(status || "");
}

/** Tone for a status dot: ok | busy | bad | quiet | warn. */
export function runStatusTone(status) {
  if (status === "completed") return "ok";
  if (status === "running" || status === "queued") return "busy";
  if (status === "failed" || status === "interrupted") return "bad";
  if (status === "stopped" || status === "missed") return "warn";
  return "quiet";
}

/** What the routine row says about its next run. */
export function routineNextLabel(routine, locale = undefined) {
  if (!routine) return "";
  if (!routine.enabled) return "Paused";
  if (routine.activeRun) return routine.activeRun.status === "queued" ? "Waiting for Squad to open" : "Running now";
  if (!routine.nextAt) return routine.schedule?.kind === "once" ? "Done" : "No upcoming run";
  return `Next ${formatInZone(routine.nextAt, routine.schedule?.timeZone, locale)}`;
}

/**
 * The instruction that makes a member keep its own work plan (ADR-0124):
 * add tasks when the person gives it work, mark them done, and answer a
 * sitrep from the plan. Short on purpose; the two examples are the format.
 */
export function taskActionInstruction() {
  return `Keep your own work plan in Squad. When the person gives you work, add it as tasks; when you finish one, mark it done; when they describe recurring work, propose the schedule (above) AND add the matching task. Asked for a sitrep or "what are you working on", answer from "Your work plan" below, never from memory. Each task action is one line exactly like: SQUAD_ACTION: {"type":"task","op":"add","title":"Send the NZ batch","detail":"20 ICP-matched leads, personalised","due":"2026-10-15"} or SQUAD_ACTION: {"type":"task","op":"done","id":"t_ab12cd","outcome":"18 sent, 2 bounced"}. Ops: add (title, optional detail and due YYYY-MM-DD), done (id or exact title, optional outcome), update (id, then any of title, detail, due, status open|doing|blocked). Up to five actions per reply. The bridge records each one and appends a receipt; do not claim a task exists before that receipt.`;
}

/**
 * The instruction appended to a member's context so it sets up repeating
 * work from plain English (ADR-0110, extended by ADR-0125): propose a
 * routine when the person describes repeating work or asks for the same
 * thing again, ask one short question when a detail is missing, and repeat
 * the action when the person agrees. Two short examples; the format line
 * appears once so the action is never written twice by accident.
 */
export const REPEAT_WORK_MARKER = "Set up repeating work yourself.";

export function scheduleActionInstruction(timeZone = browserTimeZone()) {
  return `${REPEAT_WORK_MARKER} When the person describes work that repeats ("every weekday morning", "keep doing this", "as usual") or asks you for the same thing a second time, propose a routine with the schedule action below instead of only doing it once. If the time, the days, the time zone, where the result should go or which folder to work in is missing and you cannot tell from the conversation, ask exactly one short question first, then propose. When the person says "yes", "do it" or "sounds good" to a routine you described but have not proposed, include the action in that reply so it is recorded. Example: the person says "pull yesterday's signups for me again"; you do it and ask "Shall I do this every weekday? What time, and should the summary come here?". Example: they answer "8am, here"; you reply with the action line for weekdays at 08:00. To schedule, include one line exactly like: SQUAD_ACTION: {"type":"schedule","title":"Morning report","instructions":"what to do each time","schedule":{"kind":"weekdays","days":[1,2,3,4,5],"time":"09:00"},"timezone":"${timeZone}"}. Kinds: once {"kind":"once","date":"YYYY-MM-DD","time":"HH:MM"}; weekdays {"kind":"weekdays","days":[0-6, 0 is Sunday],"time":"HH:MM"}; interval {"kind":"interval","everyMinutes":5-1440}; monthly {"kind":"monthly","day":1-31 or "last","time":"HH:MM"}; yearly {"kind":"yearly","month":1-12,"day":1-31,"time":"HH:MM"}; cron {"kind":"cron","cron":"minute hour day-of-month month day-of-week"}. The person's timezone is ${timeZone} unless they say otherwise; always include an IANA timezone. The bridge records it as a proposal and the person confirms it in Squad; never claim anything is scheduled before that confirmation.`;
}
