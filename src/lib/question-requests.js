// Questions a member asked the person during a reply (squad_ask), and which
// of them still wait for an answer (ADR-0161 §2.1).
//
// The bridge sends a `question_request` event with the question and any
// options, and a `question_answered` event once the person answers, the
// wait runs out or the reply ends. Both live in the message's stream events;
// the chat shows a card for every question without an answer event yet.

export const QUESTION_ANSWER_MAX = 4000;

export function pendingQuestionRequests(message) {
  const events = Array.isArray(message?.streamEvents) ? message.streamEvents : [];
  const answered = new Set(Object.keys(message?.questionAnswers && typeof message.questionAnswers === "object" ? message.questionAnswers : {}));
  for (const event of events) if (event?.type === "question_answered" && event.requestId) answered.add(String(event.requestId));
  const pending = [];
  const seen = new Set();
  for (const event of events) {
    if (event?.type !== "question_request" || !event.requestId) continue;
    const requestId = String(event.requestId);
    if (answered.has(requestId) || seen.has(requestId)) continue;
    seen.add(requestId);
    pending.push({
      requestId,
      question: String(event.question || "").trim(),
      options: (Array.isArray(event.options) ? event.options : []).map((option) => String(option || "").trim()).filter(Boolean).slice(0, 6),
      timestamp: String(event.timestamp || ""),
    });
  }
  return pending;
}

/** How a question reads in the running reply's one-line status. */
export function questionActivityLabel(event) {
  if (event?.type === "question_request") return "Waiting for your answer...";
  if (event?.type === "question_answered") return event.answer ? "Answer received; continuing..." : "No answer; continuing...";
  return "";
}
