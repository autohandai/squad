import { useEffect, useRef, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_ANSWER_MAX } from "@/lib/question-requests";

/**
 * A member paused mid-reply to ask the person something (squad_ask,
 * ADR-0161 §2.1). One divider row per waiting question: the question, its
 * options as buttons when it offered any, and a short answer field. The
 * answer goes back to the member as the tool's result; the reply continues.
 *
 *   requests  pendingQuestionRequests(message)
 *   onAnswer  (request, answer) => Promise
 */
export function QuestionCard({ requests = [], memberName = "The member", onAnswer, copy = {} }) {
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  const firstId = requests[0]?.requestId || "";
  useEffect(() => {
    if (firstId) rootRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [firstId]);
  if (!requests.length) return null;

  async function answer(request, value) {
    const text = String(value || "").trim().slice(0, QUESTION_ANSWER_MAX);
    if (!text || busy) return;
    setBusy(request.requestId);
    setError("");
    try {
      await onAnswer?.(request, text);
      setDrafts((current) => ({ ...current, [request.requestId]: "" }));
    } catch (failure) {
      setError(failure?.message || "Could not send that answer. Try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div ref={rootRef} className="mt-3 border-t border-border/70 pt-3 text-sm" data-testid="question-card" role="group" aria-label={`${memberName} asks you a question`}>
      {requests.map((request) => {
        const draft = drafts[request.requestId] ?? "";
        return (
          <div key={request.requestId} className="py-1.5" data-testid="question-request" data-request-id={request.requestId}>
            <div className="flex items-start gap-3">
              <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="min-w-0 flex-1">
                <span className="text-foreground">{memberName}</span>{" "}
                <span className="text-muted-foreground">{copy.questionAsks || "asks you:"}</span>{" "}
                <span className="whitespace-pre-wrap text-foreground">{request.question}</span>
              </p>
            </div>
            {request.options.length ? (
              <div className="mt-2 flex flex-wrap gap-1 pl-7">
                {request.options.map((option) => (
                  <Button key={option} type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={Boolean(busy)} onClick={() => answer(request, option)}>
                    {option}
                  </Button>
                ))}
              </div>
            ) : null}
            <form
              className="mt-2 flex items-end gap-2 pl-7"
              onSubmit={(event) => { event.preventDefault(); void answer(request, draft); }}
            >
              <Textarea
                value={draft}
                rows={1}
                maxLength={QUESTION_ANSWER_MAX}
                placeholder={request.options.length ? copy.questionOr || "Or type an answer…" : copy.questionAnswer || "Type your answer…"}
                aria-label={copy.questionAnswer || "Your answer"}
                className="min-h-8 flex-1 resize-none text-sm"
                onChange={(event) => setDrafts((current) => ({ ...current, [request.requestId]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void answer(request, draft); } }}
              />
              <Button type="submit" size="sm" variant="outline" className="h-8" disabled={Boolean(busy) || !draft.trim()}>
                {busy === request.requestId ? copy.sending || "Sending…" : copy.send || "Send"}
              </Button>
            </form>
          </div>
        );
      })}
      <p className="mt-1 text-xs text-muted-foreground">{copy.questionNote || "Your answer goes straight back to the member; the reply continues from there."}</p>
      {error ? <p className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
