#!/usr/bin/env node
// The activity calendar shows what the member did, nothing more (bug hunt 2026-10, #24–#25).
import assert from "node:assert/strict";
import { activityCalendar } from "../src/lib/activity-calendar.js";

const now = new Date(2026, 9, 14, 12); // 14 Oct 2026, a Wednesday
const empty = activityCalendar([], { now });
assert.equal(empty.weeks.length, 41);
assert.ok(empty.weeks.every((week) => week.length === 7));
assert.equal(empty.activeDays, 0);
assert.ok(empty.weeks.flat().filter(Boolean).every((cell) => cell.level === 0), "a new member has an empty calendar");
assert.equal(empty.months.at(-1).label, "Oct", "the calendar ends this month");
const last = empty.weeks.at(-1);
assert.equal(last[3].date.getDate(), 14, "today is the Wednesday of the last week");
assert.equal(last[4], null, "no cells after today");

const busy = activityCalendar(["2026-10-14T09:00:00", "2026-10-14T10:00:00", "2026-10-13T09:00:00", "2026-02-01T00:00:00", "nonsense", "2024-01-01T00:00:00"], { now });
assert.equal(busy.total, 4, "invalid and out-of-range timestamps are ignored");
assert.equal(busy.activeDays, 3);
assert.equal(busy.weeks.at(-1)[3].level, 3, "the busiest day is the darkest");
assert.ok(busy.weeks.at(-1)[2].level >= 1 && busy.weeks.at(-1)[2].level < 3);
const single = activityCalendar(["2026-10-01T09:00:00"], { now });
assert.equal(single.weeks.flat().filter((cell) => cell?.level).length, 1);
console.log("check-activity-calendar: ok");
