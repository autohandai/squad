import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/**
 * New Automation, plain English first (ADR-0125): one sentence, which the
 * member's own engine turns into a name, instructions and a schedule
 * (POST /api/routines/draft). The caller shows the result in the existing
 * schedule control for confirmation; nothing runs until Save.
 *
 *   state   { status: idle|drafting|question|proposed|read-from-words|error, question, error, reply }
 */
export function AutomationPlainEnglish({ memberName = "The member", engineLabel = "", text, onTextChange, answer = "", onAnswerChange, state = { status: "idle" }, onDraft, copy = {} }) {
  const drafting = state.status === "drafting";
  const canDraft = Boolean(String(text || "").trim()) && !drafting;
  return (
    <section className="grid gap-2" data-testid="automation-plain-english">
      <label className="text-sm font-semibold text-foreground" htmlFor="automation-plain-english">
        {copy.automationPlainLabel || "What should happen, and when?"}
      </label>
      <Textarea
        id="automation-plain-english"
        value={text}
        onChange={(event) => onTextChange?.(event.target.value.slice(0, 2000))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canDraft) {
            event.preventDefault();
            onDraft?.();
          }
        }}
        placeholder={copy.automationPlainPlaceholder || "Every weekday at 8am, pull yesterday's signups and post a short summary here."}
        className="min-h-[88px] resize-y text-sm"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
          {drafting ? (
            <span className="inline-flex items-center gap-1.5"><Spinner className="size-3.5" />{(copy.automationDrafting || "{name} is drafting it…").replace("{name}", memberName)}</span>
          ) : (copy.automationPlainHint || "{name} turns this into a schedule{engine}. Nothing runs until you save.").replace("{name}", memberName).replace("{engine}", engineLabel ? ` with ${engineLabel}` : "")}
        </p>
        <Button type="button" size="sm" variant={state.status === "proposed" || state.status === "read-from-words" ? "outline" : "default"} disabled={!canDraft} onClick={() => onDraft?.()}>
          {state.status === "idle" || state.status === "error" ? copy.automationDraft || "Draft it" : copy.automationDraftAgain || "Draft again"}
        </Button>
      </div>
      {state.status === "error" ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.status === "question" ? (
        <div className="grid gap-2 border-t border-border/70 pt-3">
          <p className="text-sm"><span className="text-muted-foreground">{(copy.automationAsks || "{name} asks:").replace("{name}", memberName)}</span> {state.question}</p>
          <Input
            value={answer}
            onChange={(event) => onAnswerChange?.(event.target.value.slice(0, 600))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && answer.trim()) {
                event.preventDefault();
                onDraft?.();
              }
            }}
            placeholder={copy.automationAnswer || "Your answer"}
            aria-label={copy.automationAnswer || "Your answer"}
            className="h-9 text-sm"
          />
        </div>
      ) : null}
    </section>
  );
}
