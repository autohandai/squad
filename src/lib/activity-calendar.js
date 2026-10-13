// The member's activity calendar: one cell per day for the last `weeks`
// weeks, ending today, from the timestamps of what the member actually did
// (runs it ran, tasks it touched). It used to be a fixed pattern that showed
// the same busy year for every member, new ones included.
//
// Pure: no React, no DOM; scripts/check-activity-calendar.mjs imports it.

const DAY = 24 * 60 * 60 * 1000;

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * { weeks: [[{ date, count, level }] × 7], months: [{ label, week }], activeDays, total }.
 * Weeks start on Sunday; days after today are null. Levels 0–3 are relative
 * to the busiest day, so one run on one day still shows.
 */
export function activityCalendar(timestamps = [], { now = new Date(), weeks = 41, locale = "en" } = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today.getTime() - ((weeks - 1) * 7 + today.getDay()) * DAY);
  start.setHours(0, 0, 0, 0);
  const counts = new Map();
  let total = 0;
  for (const value of Array.isArray(timestamps) ? timestamps : []) {
    const ms = Date.parse(String(value || ""));
    if (!Number.isFinite(ms) || ms < start.getTime() || ms > today.getTime() + DAY) continue;
    const key = dayKey(new Date(ms));
    counts.set(key, (counts.get(key) || 0) + 1);
    total += 1;
  }
  const busiest = Math.max(0, ...counts.values());
  const level = (count) => (!count ? 0 : busiest <= 1 ? 3 : Math.max(1, Math.ceil((count / busiest) * 3)));
  const monthName = new Intl.DateTimeFormat(locale, { month: "short" });
  const grid = [];
  const months = [];
  for (let week = 0; week < weeks; week += 1) {
    const column = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
      if (date > today) { column.push(null); continue; }
      const count = counts.get(dayKey(date)) || 0;
      column.push({ date, count, level: level(count) });
      if (date.getDate() === 1 || (week === 0 && day === 0)) months.push({ label: monthName.format(date), week });
    }
    grid.push(column);
  }
  // A label squeezed into the first column before a month change is noise.
  const spaced = months.filter((month, index) => !months[index + 1] || months[index + 1].week - month.week >= 2);
  return { weeks: grid, months: spaced, activeDays: counts.size, total };
}
