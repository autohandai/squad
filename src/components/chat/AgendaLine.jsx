import { Button } from "@/components/ui/button";

function ago(value, now = Date.now()) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.max(0, Math.round((now - ms) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

const STATUS_WORDS = { completed: "done", failed: "failed", stopped: "stopped", interrupted: "interrupted", paused: "paused", blocked: "blocked", cancelled: "cancelled" };

/**
 * One quiet line above the composer when the member is working on its own
 * (ADR-0125): what it picked up, and Stop. After it finishes, the same line
 * says how it ended, for the rest of the day. Nothing when the switch is off.
 */
export function AgendaLine({ agenda, memberName = "The member", onStop, stopping = false, copy = {}, className = "" }) {
  if (!agenda?.enabled) return null;
  const current = agenda.current;
  const last = !current && agenda.last && agenda.last.finishedAt && Date.now() - Date.parse(agenda.last.finishedAt) < 12 * 60 * 60_000 ? agenda.last : null;
  if (!current && !last) return null;
  return (
    <div className={`flex min-w-0 items-center gap-2 text-xs text-muted-foreground ${className}`} data-testid="agenda-line">
      <span className={`size-1.5 shrink-0 rounded-full ${current ? "animate-pulse bg-primary" : "bg-muted-foreground/50"}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {current
          ? (copy.agendaWorking || "{name} is working on “{title}” on its own").replace("{name}", memberName).replace("{title}", current.title)
          : (copy.agendaWorked || "{name} worked on “{title}” on its own · {status} · {ago}").replace("{name}", memberName).replace("{title}", last.title).replace("{status}", STATUS_WORDS[last.status] || last.status).replace("{ago}", ago(last.finishedAt))}
      </span>
      {current ? (
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={stopping} onClick={() => onStop?.()}>
          {copy.agendaStop || "Stop"}
        </Button>
      ) : null}
    </div>
  );
}
