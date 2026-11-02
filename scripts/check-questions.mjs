#!/usr/bin/env node
// Questions a member asks the person mid-reply (squad_ask, ADR-0161 §2.1):
// the registry behind the chat card and the browser's pending-question
// helper. Deterministic, no bridge.
import assert from "node:assert/strict";

import { PersonQuestionError, PersonQuestions } from "../server/questions.mjs";
import { pendingQuestionRequests, questionActivityLabel } from "../src/lib/question-requests.js";
import { normalizeActivity } from "../src/lib/activity.js";

const sent = [];
const questions = new PersonQuestions({ now: () => "2026-11-02T10:00:00.000Z", waitMs: 60 });

// Nobody watching: the member is told to ask in its reply instead.
assert.throws(() => questions.ask({ runId: "run-goal", agentId: "cos", question: "Which pie first?" }), (error) => error instanceof PersonQuestionError && error.status === 409 && /Finish the reply with the question/.test(error.message));

// A watched reply: the card event goes to the window, the answer comes back as the tool result.
const detach = questions.attach("run-1", (event) => sent.push(event));
const asked = questions.ask({ runId: "run-1", agentId: "cos", question: "  Which pie should we feature first?  ", options: ["Apple", "Cherry", ""] });
assert.equal(sent.length, 1);
assert.equal(sent[0].type, "question_request");
assert.equal(sent[0].question, "Which pie should we feature first?");
assert.deepEqual(sent[0].options, ["Apple", "Cherry"], "empty options are dropped");
assert.match(sent[0].requestId, /^ask-/);
assert.equal(questions.list("cos").length, 1);
assert.equal(questions.list("other").length, 0);
assert.throws(() => questions.answer(sent[0].requestId, "   "), (error) => error.status === 400, "an empty answer is refused");
const answered = questions.answer(sent[0].requestId, " Cherry, the seasonal one ");
assert.equal(answered.answer, "Cherry, the seasonal one");
assert.deepEqual(await asked, { status: "answered", answer: "Cherry, the seasonal one", reason: "" });
assert.equal(sent.at(-1).type, "question_answered");
assert.equal(sent.at(-1).answer, "Cherry, the seasonal one");
assert.equal(sent.at(-1).source, "person");
assert.throws(() => questions.answer(sent[0].requestId, "again"), (error) => error.status === 410, "a question is answered once");
assert.equal(questions.list().length, 0);

// The wait runs out: the member hears "no answer" and the window hears why.
const late = questions.ask({ runId: "run-1", agentId: "cos", question: "Still there?" });
assert.deepEqual(await late, { status: "unanswered", answer: "", reason: "no answer yet" });
assert.equal(sent.at(-1).type, "question_answered");
assert.equal(sent.at(-1).source, "timeout");

// The reply ends with a question open.
const open = questions.ask({ runId: "run-1", agentId: "cos", question: "Budget?" });
assert.equal(questions.settleRun("run-1", { reason: "the reply was stopped" }), 1);
assert.deepEqual(await open, { status: "unanswered", answer: "", reason: "the reply was stopped" });
assert.equal(sent.at(-1).source, "closed");
detach();
assert.equal(questions.watched("run-1"), false);
assert.throws(() => questions.ask({ runId: "run-1", agentId: "cos", question: "Anyone?" }), (error) => error.status === 409, "a detached reply is unwatched again");

// --- the browser's view -----------------------------------------------------
const message = { streamEvents: [
  { type: "question_request", requestId: "ask-1", question: "Which pie first?", options: ["Apple", "Cherry"], timestamp: "t1" },
  { type: "question_request", requestId: "ask-2", question: "Budget?", timestamp: "t2" },
  { type: "question_answered", requestId: "ask-2", answer: "", source: "timeout", reason: "no answer yet", timestamp: "t3" },
] };
const pending = pendingQuestionRequests(message);
assert.deepEqual(pending.map((request) => request.requestId), ["ask-1"], "an answered or expired question has no card");
assert.deepEqual(pending[0].options, ["Apple", "Cherry"]);
assert.equal(pendingQuestionRequests({ ...message, questionAnswers: { "ask-1": "Apple" } }).length, 0, "the window's own answer hides the card before the event comes back");
assert.equal(questionActivityLabel({ type: "question_request" }), "Waiting for your answer...");
assert.equal(questionActivityLabel({ type: "question_answered", answer: "Apple" }), "Answer received; continuing...");
assert.equal(questionActivityLabel({ type: "question_answered", answer: "" }), "No answer; continuing...");

// Work details: one approval-style row per question, closed by the answer.
const items = normalizeActivity([
  { type: "question_request", requestId: "ask-1", question: "Which pie first?", options: ["Apple", "Cherry"], timestamp: "2026-11-02T10:00:00.000Z" },
  { type: "question_answered", requestId: "ask-1", answer: "Cherry", source: "person", timestamp: "2026-11-02T10:00:05.000Z" },
  { type: "question_request", requestId: "ask-2", question: "Budget?", timestamp: "2026-11-02T10:00:06.000Z" },
  { type: "question_answered", requestId: "ask-2", answer: "", source: "closed", reason: "the reply ended", timestamp: "2026-11-02T10:00:09.000Z" },
], { status: "completed" });
const rows = items.filter((item) => item.kind === "approval");
assert.equal(rows.length, 2);
assert.equal(rows[0].object, "Asks you: Which pie first?");
assert.equal(rows[0].state, "done");
assert.equal(rows[0].outcome, "answered: Cherry");
assert.equal(rows[0].detail, "Options: Apple · Cherry");
assert.equal(rows[1].state, "failed");
assert.equal(rows[1].outcome, "no answer (the reply ended)");

console.log("check-questions: ok");
