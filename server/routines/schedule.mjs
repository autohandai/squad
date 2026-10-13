// Routine schedules (ADR-0110): the schedule shapes a member automation can
// carry, their normalisation and validation, and next-occurrence arithmetic
// in an IANA timezone. Pure functions, no dependencies, no timers: the
// bridge route (server/routes/routines.route.mjs) and the check
// (scripts/check-routines.mjs) both import this file.
//
// Shapes
//   schedule  { kind, timeZone, time: "HH:MM", ...per kind }
//   once      { date: "YYYY-MM-DD" }
//   weekdays  { days: [0..6] }                     0 = Sunday
//   interval  { everyMinutes: 5..1440, startDate, startTime }   elapsed time from the anchor
//   monthly   { day: 1..31 | "last" }
//   yearly    { month: 1..12, day: 1..31 }
//   cron      { cron: "minute hour day-of-month month day-of-week" }
//
// Timezones go through Intl only. A wall-clock time that does not exist
// (spring-forward gap) moves forward through the gap; a wall-clock time that
// exists twice (fall-back hour) runs once, at its first occurrence. Interval
// schedules count elapsed minutes from their anchor and never see a clock
// change.

export const SCHEDULE_KINDS = ["once", "weekdays", "interval", "monthly", "yearly", "cron"];
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 1440;
export const MAX_RUN_MINUTES = 24 * 60;
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const CRON_ALIASES = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function text(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function int(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Timezones

const formatters = new Map();

function formatter(timeZone) {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `date` in `timeZone`; weekday is 0 (Sunday) to 6. */
export function zonedParts(date, timeZone) {
  const parts = {};
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type === "weekday") parts.weekday = DAY_NAMES.indexOf(part.value.slice(0, 3).toLowerCase());
    else if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  if (parts.hour === 24) parts.hour = 0;
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second || 0, weekday: parts.weekday };
}

// A wall-clock instant as a number: the same fields read as if they were UTC.
// Calendar arithmetic happens on these numbers and `wallToUtc` turns the
// result back into a real instant.
function naive(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, 0);
}

function partsOfNaive(ms) {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), weekday: d.getUTCDay() };
}

function offsetAt(timeZone, utcMs) {
  return naive(zonedParts(new Date(utcMs), timeZone)) - utcMs;
}

/** UTC offset of `timeZone` at `date`, in minutes (east positive). */
export function timeZoneOffsetMinutes(timeZone, date = new Date()) {
  return Math.round(offsetAt(timeZone, date.getTime()) / MINUTE);
}

/**
 * The instant at which `timeZone` reads the wall-clock `parts`
 * ({ year, month, day, hour, minute }). Through a spring-forward gap the
 * time moves forward by the gap; in a fall-back hour the first occurrence
 * wins.
 */
export function wallToUtc(timeZone, parts) {
  const wanted = naive({ ...parts, second: 0 });
  const offsets = [...new Set([offsetAt(timeZone, wanted - DAY), offsetAt(timeZone, wanted), offsetAt(timeZone, wanted + DAY)])];
  const candidates = offsets.map((offset) => wanted - offset);
  const exact = candidates.filter((candidate) => naive(zonedParts(new Date(candidate), timeZone)) === wanted);
  if (exact.length) return new Date(Math.min(...exact));
  const after = candidates.filter((candidate) => naive(zonedParts(new Date(candidate), timeZone)) > wanted);
  return new Date(after.length ? Math.min(...after) : candidates[0]);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Normalisation and validation

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseTime(value) {
  const match = TIME_PATTERN.exec(text(value, 5));
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function parseDate(value) {
  const match = DATE_PATTERN.exec(text(value, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function normalizeTime(value, fallback = "09:00") {
  const parsed = parseTime(value);
  if (!parsed) return fallback;
  return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
}

export function normalizeSchedule(input = {}, { defaultTimeZone = "UTC" } = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const kind = SCHEDULE_KINDS.includes(source.kind) ? source.kind : "weekdays";
  const timeZone = isValidTimeZone(source.timeZone) ? source.timeZone : isValidTimeZone(defaultTimeZone) ? defaultTimeZone : "UTC";
  const schedule = { kind, timeZone, time: normalizeTime(source.time) };
  if (kind === "once") schedule.date = text(source.date, 10);
  if (kind === "weekdays") {
    const days = Array.isArray(source.days) ? source.days.map((day) => int(day, -1)).filter((day) => day >= 0 && day <= 6) : [1, 2, 3, 4, 5];
    schedule.days = [...new Set(days)].sort((a, b) => a - b);
  }
  if (kind === "interval") {
    schedule.everyMinutes = Math.min(Math.max(int(source.everyMinutes, 60), MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES);
    schedule.startDate = text(source.startDate, 10);
    schedule.startTime = normalizeTime(source.startTime, "00:00");
  }
  if (kind === "monthly") schedule.day = source.day === "last" ? "last" : Math.min(Math.max(int(source.day, 1), 1), 31);
  if (kind === "yearly") {
    schedule.month = Math.min(Math.max(int(source.month, 1), 1), 12);
    schedule.day = Math.min(Math.max(int(source.day, 1), 1), 31);
  }
  if (kind === "cron") schedule.cron = text(source.cron, 120);
  return schedule;
}

/** Field names that are missing or invalid; empty when the schedule can run. */
export function validateSchedule(schedule) {
  const problems = [];
  if (!schedule || typeof schedule !== "object") return ["schedule"];
  if (!SCHEDULE_KINDS.includes(schedule.kind)) problems.push("kind");
  if (!isValidTimeZone(schedule.timeZone)) problems.push("timeZone");
  if (schedule.kind !== "interval" && schedule.kind !== "cron" && !parseTime(schedule.time)) problems.push("time");
  if (schedule.kind === "once" && !parseDate(schedule.date)) problems.push("date");
  if (schedule.kind === "weekdays" && !(Array.isArray(schedule.days) && schedule.days.length)) problems.push("days");
  if (schedule.kind === "interval") {
    const every = int(schedule.everyMinutes, 0);
    if (every < MIN_INTERVAL_MINUTES || every > MAX_INTERVAL_MINUTES) problems.push("everyMinutes");
    if (!parseDate(schedule.startDate)) problems.push("startDate");
    if (!parseTime(schedule.startTime)) problems.push("startTime");
  }
  if (schedule.kind === "monthly" && schedule.day !== "last" && !(int(schedule.day, 0) >= 1 && int(schedule.day, 0) <= 31)) problems.push("day");
  if (schedule.kind === "yearly") {
    const month = int(schedule.month, 0);
    const day = int(schedule.day, 0);
    if (month < 1 || month > 12) problems.push("month");
    else if (day < 1 || day > daysInMonth(2000, month)) problems.push("day");
  }
  if (schedule.kind === "cron" && !parseCron(schedule.cron)) problems.push("cron");
  return problems;
}

// ---------------------------------------------------------------------------
// Cron

function parseField(field, min, max, names = []) {
  const values = new Set();
  let last = false;
  const source = String(field || "").trim().toLowerCase();
  if (!source) return null;
  const restricted = source !== "*";
  for (const piece of source.split(",")) {
    let [range, stepText] = piece.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    if (range === "l" && min === 1 && max === 31) {
      last = true;
      continue;
    }
    let start;
    let end;
    if (range === "*" || range === "") {
      start = min;
      end = max;
    } else {
      const [from, to] = range.split("-");
      const resolve = (token) => {
        if (token === undefined) return undefined;
        const named = names.indexOf(token);
        if (named >= 0) return named + (names === MONTH_NAMES ? 1 : 0);
        return /^\d+$/.test(token) ? Number(token) : NaN;
      };
      start = resolve(from);
      end = to === undefined ? (stepText === undefined ? start : max) : resolve(to);
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    }
    if (start < min || end > max || end < start) return null;
    for (let value = start; value <= end; value += step) values.add(value === 7 && max === 7 ? 0 : value);
  }
  return { values, restricted, last };
}

/** Parse a five-field cron expression (or an @daily style alias); null when invalid. */
export function parseCron(expression) {
  const source = text(expression, 120).toLowerCase();
  const expanded = CRON_ALIASES[source] || source;
  const fields = expanded.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return null;
  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dayOfMonth = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12, MONTH_NAMES);
  const dayOfWeek = parseField(fields[4], 0, 7, DAY_NAMES);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return { minute, hour, dayOfMonth, month, dayOfWeek, expression: expanded };
}

function cronDayMatches(schedule, parts) {
  const lastDay = daysInMonth(parts.year, parts.month);
  const domOk = schedule.dayOfMonth.values.has(parts.day) || (schedule.dayOfMonth.last && parts.day === lastDay);
  const dowOk = schedule.dayOfWeek.values.has(parts.weekday);
  // Vixie cron: when both day fields are restricted, either one matching is enough.
  if (schedule.dayOfMonth.restricted && schedule.dayOfWeek.restricted) return domOk || dowOk;
  if (schedule.dayOfMonth.restricted) return domOk;
  if (schedule.dayOfWeek.restricted) return dowOk;
  return true;
}

function nextCronOccurrence(parsed, after, timeZone) {
  const start = zonedParts(after, timeZone);
  let t = naive({ ...start, second: 0 }) + MINUTE;
  const limit = t + 5 * 366 * DAY;
  for (let guard = 0; guard < 400000 && t <= limit; guard += 1) {
    const parts = partsOfNaive(t);
    if (!parsed.month.values.has(parts.month)) {
      t = Date.UTC(parts.year, parts.month, 1, 0, 0, 0, 0);
      continue;
    }
    if (!cronDayMatches(parsed, parts)) {
      t = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0, 0);
      continue;
    }
    if (!parsed.hour.values.has(parts.hour)) {
      t = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minute.values.has(parts.minute)) {
      t += MINUTE;
      continue;
    }
    const at = wallToUtc(timeZone, parts);
    if (at.getTime() > after.getTime()) return at;
    t += MINUTE;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Next occurrence

function atWall(timeZone, date, time) {
  return wallToUtc(timeZone, { year: date.year, month: date.month, day: date.day, hour: time.hour, minute: time.minute });
}

/**
 * The first occurrence strictly after `after`, or null when the schedule has
 * none (an invalid schedule, a once that already passed, a yearly 29 Feb more
 * than eight years away).
 */
export function nextOccurrence(schedule, after = new Date()) {
  if (validateSchedule(schedule).length) return null;
  const from = new Date(after);
  if (!Number.isFinite(from.getTime())) return null;
  const timeZone = schedule.timeZone;
  const time = parseTime(schedule.time) || { hour: 9, minute: 0 };
  if (schedule.kind === "once") {
    const at = atWall(timeZone, parseDate(schedule.date), time);
    return at.getTime() > from.getTime() ? at : null;
  }
  if (schedule.kind === "interval") {
    const anchor = atWall(timeZone, parseDate(schedule.startDate), parseTime(schedule.startTime)).getTime();
    const step = schedule.everyMinutes * MINUTE;
    if (from.getTime() < anchor) return new Date(anchor);
    return new Date(anchor + (Math.floor((from.getTime() - anchor) / step) + 1) * step);
  }
  if (schedule.kind === "cron") return nextCronOccurrence(parseCron(schedule.cron), from, timeZone);
  const start = zonedParts(from, timeZone);
  if (schedule.kind === "weekdays") {
    const today = naive({ ...start, hour: 0, minute: 0, second: 0 });
    for (let offset = 0; offset <= 14; offset += 1) {
      const date = partsOfNaive(today + offset * DAY);
      if (!schedule.days.includes(date.weekday)) continue;
      const at = atWall(timeZone, date, time);
      if (at.getTime() > from.getTime()) return at;
    }
    return null;
  }
  if (schedule.kind === "monthly") {
    for (let offset = 0; offset <= 60; offset += 1) {
      const index = start.month - 1 + offset;
      const year = start.year + Math.floor(index / 12);
      const month = (index % 12) + 1;
      const last = daysInMonth(year, month);
      const day = schedule.day === "last" ? last : schedule.day;
      if (day > last) continue;
      const at = atWall(timeZone, { year, month, day }, time);
      if (at.getTime() > from.getTime()) return at;
    }
    return null;
  }
  if (schedule.kind === "yearly") {
    for (let offset = 0; offset <= 8; offset += 1) {
      const year = start.year + offset;
      if (schedule.day > daysInMonth(year, schedule.month)) continue;
      const at = atWall(timeZone, { year, month: schedule.month, day: schedule.day }, time);
      if (at.getTime() > from.getTime()) return at;
    }
    return null;
  }
  return null;
}

/** Up to `count` occurrences strictly after `after`, in order. */
export function nextOccurrences(schedule, after = new Date(), count = 3) {
  const list = [];
  let cursor = new Date(after);
  for (let index = 0; index < count; index += 1) {
    const next = nextOccurrence(schedule, cursor);
    if (!next) break;
    list.push(next);
    cursor = next;
  }
  return list;
}

// ---------------------------------------------------------------------------
// Words

function ordinal(day) {
  const n = Number(day);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
}

function dateWords(value) {
  const date = parseDate(value);
  if (!date) return String(value || "");
  return `${date.day} ${MONTH_LABELS[date.month - 1]} ${date.year}`;
}

/** The rule in words, without the timezone: "Weekdays (Mon–Fri) at 09:00". */
export function describeSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") return "";
  const time = normalizeTime(schedule.time);
  switch (schedule.kind) {
    case "once":
      return `Once on ${dateWords(schedule.date)} at ${time}`;
    case "weekdays": {
      const days = Array.isArray(schedule.days) ? [...new Set(schedule.days)].sort((a, b) => a - b) : [];
      const key = days.join(",");
      const label = key === "0,1,2,3,4,5,6" ? "Every day" : key === "1,2,3,4,5" ? "Weekdays (Mon–Fri)" : key === "0,6" ? "Weekends" : days.map((day) => DAY_LABELS[day]).join(", ");
      return `${label || "No days"} at ${time}`;
    }
    case "interval": {
      const every = int(schedule.everyMinutes, 0);
      const amount = every % 60 === 0 ? `${every / 60} hour${every === 60 ? "" : "s"}` : `${every} minutes`;
      return `Every ${amount} from ${dateWords(schedule.startDate)} ${normalizeTime(schedule.startTime, "00:00")}`;
    }
    case "monthly":
      return `Monthly on the ${schedule.day === "last" ? "last day" : ordinal(schedule.day)} at ${time}`;
    case "yearly":
      return `Yearly on ${int(schedule.day, 1)} ${MONTH_LABELS[int(schedule.month, 1) - 1]} at ${time}`;
    case "cron":
      return `Custom cron ${text(schedule.cron, 120)}`;
    default:
      return "";
  }
}

/** "Tue 14 Oct 2026, 09:00" in the schedule's zone. */
export function formatOccurrence(date, timeZone) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return "";
  const parts = zonedParts(value, timeZone);
  return `${DAY_LABELS[parts.weekday]} ${parts.day} ${MONTH_LABELS[parts.month - 1]} ${parts.year}, ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** Today's date and current time as wall-clock strings in `timeZone`. */
export function wallClockNow(timeZone, now = new Date()) {
  const parts = zonedParts(now, timeZone);
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}
