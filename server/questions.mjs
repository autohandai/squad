// A member's question to the person, answered from the Squad chat
// (ADR-0161 §2.1).
//
// The CLI's `ask_followup_question` cannot reach a Squad window: in RPC mode
// it has no callback, and under `--yes` it answered itself "Yes". Squad blocks
// that tool and offers `squad_ask` instead: the member calls it when it needs
// an answer before it can continue, the bridge shows a card in the live
// reply, and the person's answer comes back as the tool's result. A turn
// nobody is watching (a goal, a queued follow-up, a channel thread) gets a
// refusal at once, so the member finishes with the question in its reply.

import { randomUUID } from "node:crypto";

export const QUESTION_WAIT_MS = 10 * 60_000;
export const QUESTION_MAX_CHARS = 2000;
export const ANSWER_MAX_CHARS = 4000;
export const QUESTION_MAX_OPTIONS = 6;

export class PersonQuestionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function summary(pending) {
  return {
    requestId: pending.requestId,
    runId: pending.runId,
    agentId: pending.agentId,
    question: pending.question,
    options: pending.options,
    createdAt: pending.createdAt,
  };
}

export class PersonQuestions {
  constructor({ log = () => {}, now = () => new Date().toISOString(), waitMs = QUESTION_WAIT_MS } = {}) {
    this.pending = new Map();
    this.streams = new Map();
    this.log = log;
    this.now = now;
    this.waitMs = waitMs;
  }

  /** A live reply's stream: `send(event)` reaches the window that shows it. */
  attach(runId, send) {
    if (!runId || typeof send !== "function") return () => {};
    this.streams.set(String(runId), send);
    return () => { if (this.streams.get(String(runId)) === send) this.streams.delete(String(runId)); };
  }

  watched(runId) {
    return this.streams.has(String(runId || ""));
  }

  /**
   * The member asks. Resolves with { status: "answered", answer } when the
   * person answers, { status: "unanswered", reason } when the wait or the
   * turn ends first. Rejects only for a turn nobody watches.
   */
  ask({ runId, agentId, question, options = [], waitMs }) {
    const send = this.streams.get(String(runId || ""));
    if (!send) throw new PersonQuestionError("No person is watching this reply, so a question here would wait on nobody. Finish the reply with the question instead; the person answers in their next message.", 409);
    const text = String(question || "").trim().slice(0, QUESTION_MAX_CHARS);
    if (!text) throw new PersonQuestionError("A question needs text.", 400);
    const choices = (Array.isArray(options) ? options : []).map((option) => String(option || "").trim()).filter(Boolean).slice(0, QUESTION_MAX_OPTIONS);
    const requestId = `ask-${randomUUID()}`;
    const createdAt = this.now();
    const pending = { requestId, runId: String(runId), agentId: String(agentId || ""), question: text, options: choices, createdAt, send };
    this.pending.set(requestId, pending);
    send({ type: "question_request", requestId, question: text, options: choices, timestamp: createdAt });
    return new Promise((resolve) => {
      pending.resolve = resolve;
      // Referenced on purpose: it is cleared by the answer or when the reply
      // ends, and while a reply waits on the person the loop must stay up.
      const budget = Number.isSafeInteger(waitMs) && waitMs > 0 ? Math.min(waitMs, this.waitMs) : this.waitMs;
      pending.timer = setTimeout(() => this.close(requestId, { status: "unanswered", reason: "no answer yet", source: "timeout" }), budget);
    });
  }

  list(agentId = "") {
    return Array.from(this.pending.values())
      .filter((pending) => !agentId || pending.agentId === agentId)
      .map(summary);
  }

  /** The person answered from the card. */
  answer(requestId, value) {
    const pending = this.pending.get(String(requestId || ""));
    if (!pending) throw new PersonQuestionError("This question is no longer waiting; the reply may have moved on.", 410);
    const answer = String(value ?? "").trim().slice(0, ANSWER_MAX_CHARS);
    if (!answer) throw new PersonQuestionError("An answer needs text.", 400);
    this.close(pending.requestId, { status: "answered", answer, source: "person" });
    return { ...summary(pending), answer };
  }

  /** The reply ended with questions still open: the member hears "no answer". */
  settleRun(runId, { reason = "the reply ended" } = {}) {
    const open = Array.from(this.pending.values()).filter((pending) => pending.runId === String(runId || ""));
    for (const pending of open) this.close(pending.requestId, { status: "unanswered", reason, source: "closed" });
    return open.length;
  }

  close(requestId, outcome) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if (pending.timer) clearTimeout(pending.timer);
    const at = this.now();
    try {
      pending.send({ type: "question_answered", requestId, answer: outcome.answer || "", source: outcome.source, reason: outcome.reason || "", timestamp: at });
    } catch (error) {
      this.log(`question ${requestId}: the window could not be told (${error?.message || error})`);
    }
    pending.resolve?.({ status: outcome.status, answer: outcome.answer || "", reason: outcome.reason || "" });
  }

  stats() {
    return { pending: this.pending.size, watched: this.streams.size };
  }
}
