#!/usr/bin/env node
// Routine answers become direct messages only while they are recent and
// belong to the current conversation (lane bba3108, ported onto main's
// reconcileAutomationReplies).
import assert from "node:assert/strict";
import { reconcileAutomationReplies, AUTOMATION_REPLY_RECENT_MS } from "../src/lib/automation-agenda.js";

const now = Date.parse("2026-11-03T09:00:00.000Z");
const run = (id, finishedAt) => ({ id, status: "completed", reply: `Reply ${id}`, startedAt: finishedAt, finishedAt });
const routines = [{ id: "r1", memberId: "noah", workspace: "/w", runs: [run("old", "2026-10-20T09:00:00.000Z"), run("yesterday", "2026-11-02T09:00:00.000Z"), run("today", "2026-11-03T08:00:00.000Z")] }];

const fresh = reconcileAutomationReplies({}, routines, { now });
assert.deepEqual(fresh.noah.map((m) => m.id).sort(), ["automation-result-today", "automation-result-yesterday"], "a run older than two days is not posted");
assert.equal(AUTOMATION_REPLY_RECENT_MS, 2 * 24 * 60 * 60 * 1000);

const afterNewChat = reconcileAutomationReplies({}, routines, { now, startedAt: { noah: "2026-11-03T00:00:00.000Z" } });
assert.deepEqual(afterNewChat.noah.map((m) => m.id), ["automation-result-today"], "a run from before New chat stays out of the new conversation");

const again = reconcileAutomationReplies(fresh, routines, { now });
assert.equal(again, fresh, "nothing new: the same object comes back");

const channel = reconcileAutomationReplies({}, [{ ...routines[0], destination: { channelId: "general" } }], { now });
assert.equal(channel.noah, undefined, "a routine that posts to a channel never lands in direct messages");
console.log("check-automation-replies: ok");
